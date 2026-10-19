import {popularMold} from './popular-molds';
import { parsePartId, partId, type ColorName, type PartKind, type PartType } from './bricks';
import { isViablePiece } from './piece-gallery';
import {nativeKindForCatalog} from './catalog';
import {specialMold} from './special-mold-geometry';
import {connectorMold} from './connector-mold-geometry';
import {readPieceReviewEvidence,type PieceReviewEvidence} from './piece-review-evidence';

export type Box = [number, number, number, number]; // ymin, xmin, ymax, xmax on 0–1000
/** ref: an angled photo of the pile in photo `ref`, used only to cross-check it (never counted). */
export interface Photo { id: number; url: string; ref?: number }
export interface ConfidenceRecord {modelConfidence?:number|null;confidenceSource?:'model'|'unrecorded'}
export interface PartObservation extends ConfidenceRecord {photo:number;box:Box;confidence?:number;confirmed?:boolean;reviewEvidence?:PieceReviewEvidence}
export interface CatalogMatch {num:string;name:string;color:string;img?:string}
export interface InvEntry extends ConfidenceRecord {
  kind: PartKind; count: number; boxes: PartObservation[]; confidence: number;
  /** Copies explicitly checked by the person; machine confidence is not confirmation. */
  confirmedCount?:number;
  /** Stand-ins counted as this shape because they build exactly like it, by name: { "log brick 1x2": 9 }. */
  aka?: Record<string, number>;
}
/** Catalog-only or unidentified observations. A confirmed exact catalog match
 * can become builder stock when support for that precise mold is added. */
export interface OtherEntry extends ConfidenceRecord { description: string; color: string; boxes: { photo: number; box: Box }[]; unknown?: boolean;confidence?:number;confirmed?:boolean;catalog?:CatalogMatch;reviewEvidence?:PieceReviewEvidence }
export interface Inventory { parts: Record<string, InvEntry>; others: OtherEntry[]; photos: Photo[]; source: 'photo' | 'sample';manualLocks?:string[] }

export const emptyInventory = (): Inventory => ({ parts: {}, others: [], photos: [], source: 'photo' });

export const totalParts = (inv: Inventory) => Object.values(inv.parts).reduce((s, e) => s + e.count, 0);
export const colorCount = (inv: Inventory) => new Set([...Object.values(inv.parts).filter(e => e.count > 0).map(e => e.kind.color),...inv.others.flatMap(o=>{const k=confirmedCatalogKind(o);return k?[k.color]:[];})]).size;
export const observationKey=(photo:number,box:Box)=>JSON.stringify([photo,...box]);
const sameBox=(a:Box,b:Box)=>a.every((v,i)=>v===b[i]);
/** Protect reviewed outlines from modest tile jitter. IoU requires comparable size, not containment of smaller real pieces. */
export function isObservationLocked(inv:Inventory,photo:number,box:Box):boolean {
 const area=(b:Box)=>Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
 return (inv.manualLocks??[]).some(key=>{
  let values:unknown;try{values=JSON.parse(key);}catch{return false;}
  if(!Array.isArray(values)||values.length!==5||!values.every(Number.isFinite))return false;
  const [id,...b]=values as number[];if(id!==photo)return false;
  const old=b as Box;if(sameBox(old,box))return true;
  const intersection=area([Math.max(old[0],box[0]),Math.max(old[1],box[1]),Math.min(old[2],box[2]),Math.min(old[3],box[3])]);
  return intersection/(area(old)+area(box)-intersection||1)>=.7;
 });
}
function lock(inv:Inventory,photo:number,box:Box):Inventory {return {...inv,manualLocks:[...new Set([...(inv.manualLocks??[]),observationKey(photo,box)])]};}
/** Uncertain photo readings are review candidates, not build stock. */
export function availableCount(e:InvEntry):number {
 if(!Number.isSafeInteger(e.count)||e.count<=0)return 0;
 if(specialMold(e.kind)||connectorMold(e.kind)||popularMold(e.kind)){
  const manual=Number.isSafeInteger(e.confirmedCount)?e.confirmedCount!:e.boxes.filter(b=>b.confirmed===true).length;
  return Math.max(0,Math.min(e.count,manual));
 }
 if(e.confirmedCount===undefined)return e.confidence>=.6?e.count:0;
 const manual=Math.max(0,Math.min(e.count,e.confirmedCount));
 const scanned=e.boxes.filter(b=>!b.confirmed&&(b.confidence??e.confidence)>=.6).length;
 return Math.min(e.count,manual+scanned);
}
export const observationNeedsReview=(e:InvEntry,b:PartObservation)=>!b.confirmed&&(!!specialMold(e.kind)||!!connectorMold(e.kind)||!!popularMold(e.kind)||(b.confidence??e.confidence)<.6);
export const needsReviewCount=(e:InvEntry)=>Math.max(0,e.count-availableCount(e));
export const pendingReviewCount=(inv:Inventory)=>Object.values(inv.parts).reduce((n,e)=>n+needsReviewCount(e),0);
export const proposedCounts=(inv:Inventory)=>Object.fromEntries(Object.values(inv.parts).filter(e=>e.kind.type!=='wheel'&&Number.isSafeInteger(e.count)&&e.count>0).map(e=>[e.kind.partId,e.count]));
/** Build stock is the confidence-eligible subset of exact implemented,
 * manufactured native molds. Observed unsupported pieces remain in inventory.
 * Loose wheels supply no axle; legacy complete assemblies need manual evidence.
 */
export function counts(inv: Inventory): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of Object.values(inv.parts)) {
    if (e.count <= 0) continue;
    const n=availableCount(e);if(!Number.isSafeInteger(n)||n<=0)continue;
    const k=parsePartId(e.kind.partId);
    if(!k||k.type!==e.kind.type||k.w!==e.kind.w||k.d!==e.kind.d||k.color!==e.kind.color||k.type==='wheel')continue;
    if(k.type==='wheels'){
      if(k.w!==4||k.d!==2)continue;
      const confirmed=Number.isSafeInteger(e.confirmedCount)?e.confirmedCount!:e.boxes.filter(b=>b.confirmed===true).length;
      const ready=Math.min(n,Math.max(0,confirmed));if(ready>0)out[k.partId]=ready;
    }else if(isViablePiece(k))out[k.partId]=n;
  }
  for(const o of inv.others){
    const k=confirmedCatalogKind(o);
    if(k)out[k.partId]=(out[k.partId]??0)+1;
  }
  return out;
}

/** Derived support, never an identity migration. Preserve the original catalog
 * record, crop, confidence and manual lock so old saves remain reviewable. */
export function confirmedCatalogKind(o:OtherEntry):PartKind|null {
  if(o.confirmed!==true||o.unknown===true||!o.catalog||o.catalog.color!==o.color)return null;
  const k=nativeKindForCatalog(o.catalog.num,o.catalog.color);
  return k&&isViablePiece(k)?k:null;
}

export const usableParts = (inv: Inventory) => Object.values(counts(inv)).reduce((s, n) => s + n, 0);

export function addPart(inv: Inventory, kind: PartKind, n: number, box?: { photo: number; box: Box }, confidence = 1, aka?: string,confirmed=box===undefined,reviewEvidence?:PieceReviewEvidence): Inventory {
  if(!Number.isSafeInteger(n)||n<0||n>2000)throw Error('Piece counts must be whole numbers between 0 and 2000.');
  if(!n)return inv;
  const prev = inv.parts[kind.partId];
  const manual=prev?.confirmedCount??(prev&&!prev.boxes.length&&prev.confidence===1?prev.count:0);
  const found=box?{...box,confidence,confirmed,modelConfidence:confirmed?null:confidence,confidenceSource:'model' as const,...(reviewEvidence?{reviewEvidence:readPieceReviewEvidence(reviewEvidence)}:{})}:undefined;
  const names = (a?: Record<string, number>) => (aka ? { ...a, [aka]: (a?.[aka] ?? 0) + n } : a);
  const entry: InvEntry = prev
    ? { ...prev, modelConfidence:!confirmed&&typeof prev.modelConfidence==='number'?Math.min(prev.modelConfidence,confidence):prev.modelConfidence,count: prev.count + n,confirmedCount:manual+(confirmed?n:0), boxes: found ? [...prev.boxes, found] : prev.boxes, confidence: Math.min(prev.confidence, confidence), aka: names(prev.aka) }
    : { kind, count: n,modelConfidence:confirmed?null:confidence,confidenceSource:'model',confirmedCount:confirmed?n:0, boxes: found ? [found] : [], confidence, aka: names() };
  const next={ ...inv, parts: { ...inv.parts, [kind.partId]: entry } };
  return confirmed&&box?lock(next,box.photo,box.box):next;
}

/** Take one found part back out, by the box it was found at (used when a close-up corrects a reading). */
export function removeFound(inv: Inventory, id: string | null, box: Box, aka?: string,photo?:number,uncertainOnly=false,expectedObservation?:PartObservation): Inventory {
  if (id) {
    const e = inv.parts[id];
    if (!e) return inv;
    // one part at a time: a stack or a clump puts several of the same part on one outline
    const at = e.boxes.findIndex(b => (!expectedObservation||b===expectedObservation)&&(photo===undefined||b.photo===photo)&&sameBox(b.box,box)&&(!uncertainOnly||observationNeedsReview(e,b)));
    if (at < 0) return inv;
    const boxes = e.boxes.filter((_, j) => j !== at);
    const parts = { ...inv.parts };
    let names = e.aka;
    if (aka && names?.[aka]) { names = { ...names, [aka]: names[aka] - 1 }; if (!names[aka]) delete names[aka]; }
    if (e.count <= 1 && !boxes.length) delete parts[id];
    else parts[id] = { ...e, count: Math.max(0, e.count - 1),confirmedCount:e.confirmedCount===undefined?undefined:Math.min(e.count-1,Math.max(0,e.confirmedCount-(e.boxes[at].confirmed?1:0))), boxes, aka: names && Object.keys(names).length ? names : undefined };
    return { ...inv, parts };
  }
  const i = inv.others.findIndex(o => o.boxes.some(b => (photo===undefined||b.photo===photo)&&sameBox(b.box,box)));
  return i < 0 ? inv : { ...inv, others: inv.others.filter((_, j) => j !== i) };
}

/** What the person says an outlined extra piece is: a part the builder knows, a name for something else, or not a part. */
export type Resolution = { kind: PartKind } | { name: string;catalog?:CatalogMatch } | { remove: true };

/** Replace whatever was read at this box (a counted part or an extra piece) with what the person says it is. */
export function editPiece(inv: Inventory, box: Box, photo: number, r: Resolution,expectedId?:string,uncertainOnly=false,expectedObservation?:PartObservation): Inventory {
  const owner = Object.values(inv.parts).find(e => (!expectedId||e.kind.partId===expectedId)&&e.boxes.some(b => (!expectedObservation||b===expectedObservation)&&b.photo===photo&&sameBox(b.box,box)&&(!uncertainOnly||observationNeedsReview(e,b))));
  if (!owner) return expectedId?inv:resolveOther(inv, box, photo, r);
  const color = owner.kind.color;
  const previous=expectedObservation??owner.boxes.find(b=>b.photo===photo&&sameBox(b.box,box)&&(!uncertainOnly||observationNeedsReview(owner,b)))!;
  const next = lock(removeFound(inv, owner.kind.partId, box,undefined,photo,uncertainOnly,expectedObservation),photo,box);
  if ('kind' in r) {
    const result=addPart(next,r.kind,1,{photo,box},1,undefined,true),entry=result.parts[r.kind.partId],last=entry.boxes.length-1;
    entry.boxes[last]={...entry.boxes[last],reviewEvidence:readPieceReviewEvidence(previous.reviewEvidence),modelConfidence:r.kind.partId===owner.kind.partId?(previous.modelConfidence===undefined?previous.confirmed?null:previous.confidence??owner.modelConfidence??owner.confidence:previous.modelConfidence):null,confidenceSource:previous.confidenceSource??owner.confidenceSource};
    return result;
  }
  if ('name' in r) return { ...next, others: [...next.others, { description: r.name, color:r.catalog?.color??color, boxes: [{ photo, box }],catalog:r.catalog,confirmed:true,modelConfidence:null,reviewEvidence:readPieceReviewEvidence(previous.reviewEvidence) }] };
  return next;
}

export function resolveOther(inv: Inventory, box: Box, photo: number, r: Resolution): Inventory {
  const o = inv.others.find(x => x.boxes.some(b => b.photo===photo&&sameBox(b.box,box)));
  if(!o)return inv;
  const next = lock(removeFound(inv, null, box,undefined,photo),photo,box);
  if ('kind' in r) return addPart(next, r.kind, 1, { photo, box }, 1,undefined,true,o.reviewEvidence);
  if ('name' in r) return { ...next, others: [...next.others, { description: r.name, color:r.catalog?.color??o.color, boxes: [{ photo, box }],catalog:r.catalog,confirmed:true,modelConfidence:null,reviewEvidence:readPieceReviewEvidence(o.reviewEvidence) }] };
  return next;
}

export function setCount(inv: Inventory, id: string, count: number,confirm=true): Inventory {
  const e = inv.parts[id];
  if (!e) return inv;
  if(!Number.isSafeInteger(count)||count<0||count>2000)throw Error('Piece counts must be whole numbers between 0 and 2000.');
  if(!confirm&&needsReviewCount(e)>0)return {...inv,parts:{...inv.parts,[id]:{...e,count,confirmedCount:Math.min(count,e.confirmedCount??0)}}};
  let next:Inventory={ ...inv, parts: { ...inv.parts, [id]: { ...e, count,confirmedCount:count,modelConfidence:e.modelConfidence===undefined?(e.confidenceSource==='unrecorded'||e.confirmedCount===e.count?null:e.confidence):e.modelConfidence,boxes:e.boxes.map(b=>({...b,modelConfidence:b.modelConfidence===undefined?b.confirmed?null:b.confidence??e.modelConfidence??e.confidence:b.modelConfidence,confirmed:true})), confidence: 1 } } };
  for(const b of e.boxes)next=lock(next,b.photo,b.box);return next;
}

/** A new attempt replaces that photo's machine observations, retaining manual fixes. */
export function clearPhotoObservations(inv:Inventory,photo:number):Inventory {
 const parts:Inventory['parts']={};
 for(const [id,e]of Object.entries(inv.parts)){
  const removed=e.boxes.filter(b=>b.photo===photo&&!isObservationLocked(inv,photo,b.box));
  const boxes=e.boxes.filter(b=>!removed.includes(b)),count=Math.max(e.confirmedCount??0,e.count-removed.length);
  if(count||boxes.length)parts[id]={...e,count,boxes};
 }
 return {...inv,parts,others:inv.others.filter(o=>!o.boxes.some(b=>b.photo===photo&&!isObservationLocked(inv,photo,b.box)))};
}

/** Correct a whole type/count when there is no individual photo crop to edit. */
export function replacePartKind(inv:Inventory,id:string,kind:PartKind):Inventory {
 const e=inv.parts[id];if(!e)return inv;if(id===kind.partId)return setCount(inv,id,e.count);
 const parts={...inv.parts};delete parts[id];let next:Inventory={...inv,parts};
 next=addPart(next,kind,e.count,undefined,1,undefined,true);
 next.parts[kind.partId]={...next.parts[kind.partId],boxes:[...next.parts[kind.partId].boxes,...e.boxes.map(b=>({...b,confirmed:true,modelConfidence:null}))]};
 for(const b of e.boxes)next=lock(next,b.photo,b.box);return next;
}

export function reviewPartType(inv:Inventory,id:string,r:Resolution,onlyUncertain=false,expectedEntry?:InvEntry):Inventory {
 const e=inv.parts[id];if(!e||(expectedEntry&&e!==expectedEntry))return inv;
 if(onlyUncertain){
  const n=needsReviewCount(e);if(!n)return inv;
  const unchecked=e.boxes.filter(b=>observationNeedsReview(e,b));
  const keep=e.boxes.filter(b=>!unchecked.includes(b)),parts={...inv.parts};
  if(e.count===n)delete parts[id];else parts[id]={...e,count:e.count-n,boxes:keep,confirmedCount:Math.min(e.count-n,e.confirmedCount??0)};
  let next:Inventory={...inv,parts};for(const b of unchecked)next=lock(next,b.photo,b.box);
  if('kind'in r){
   next=addPart(next,r.kind,n,undefined,1,undefined,true);
   next.parts[r.kind.partId]={...next.parts[r.kind.partId],boxes:[...next.parts[r.kind.partId].boxes,...unchecked.map(b=>({...b,confirmed:true,modelConfidence:r.kind.partId===id?(b.modelConfidence===undefined?b.confirmed?null:b.confidence??e.modelConfidence??e.confidence:b.modelConfidence):null}))]};
  }else if('name'in r)next={...next,others:[...next.others,...Array.from({length:n},(_,i)=>({description:r.name,color:r.catalog?.color??e.kind.color,catalog:r.catalog,confirmed:true,modelConfidence:null,boxes:unchecked[i]?[unchecked[i]]:[]}))]};
  return next;
 }
 if('kind'in r)return replacePartKind(inv,id,r.kind);
 const next=setCount(inv,id,0);
 return 'name'in r?{...next,others:[...next.others,...Array.from({length:e.count},(_,i)=>({description:r.name,color:r.catalog?.color??e.kind.color,catalog:r.catalog,confirmed:true,modelConfidence:null,boxes:e.boxes[i]?[e.boxes[i]]:[]}))]}:next;
}

/** Change only the count-only remainder shown by a grouped review row. */
export function reviewUnboxedPart(inv:Inventory,id:string,r:Resolution,expectedQuantity?:number,expectedEntry?:InvEntry):Inventory {
 const e=inv.parts[id];if(!e||(expectedEntry&&e!==expectedEntry))return inv;
 const kept=e.boxes.slice(0,e.count),n=e.count-kept.length;if(!n||(expectedQuantity!==undefined&&n!==expectedQuantity))return inv;
 const parts={...inv.parts};
 if(kept.length)parts[id]={...e,count:kept.length,boxes:kept,confirmedCount:e.confirmedCount===undefined?undefined:kept.filter(b=>b.confirmed).length};else delete parts[id];
 let next:Inventory={...inv,parts};
 if('kind'in r){next=addPart(next,r.kind,n,undefined,1,undefined,true);if(r.kind.partId===id)next.parts[id]={...next.parts[id],modelConfidence:e.modelConfidence===undefined?(e.confidenceSource==='unrecorded'||e.confirmedCount===e.count?null:e.confidence):e.modelConfidence,confidenceSource:e.confidenceSource};return next;}
 if('name'in r)return {...next,others:[...next.others,...Array.from({length:n},()=>({description:r.name,color:r.catalog?.color??e.kind.color,catalog:r.catalog,confirmed:true,modelConfidence:null,boxes:[]}))]};
 return next;
}

export function reviewOtherPiece(inv:Inventory,original:OtherEntry,r:Resolution):Inventory {
 if(!inv.others.includes(original))return inv;
 let next:Inventory={...inv,others:inv.others.filter(o=>o!==original)};
 for(const b of original.boxes)next=lock(next,b.photo,b.box);
 if('kind'in r){const b=original.boxes.find(b=>inv.photos.some(p=>p.id===b.photo))??original.boxes[0];return addPart(next,r.kind,1,b,1,undefined,true,original.reviewEvidence);}
 if('name'in r)return {...next,others:[...next.others,{description:r.name,color:r.catalog?.color??original.color,boxes:original.boxes,catalog:r.catalog,confirmed:true,modelConfidence:null,reviewEvidence:readPieceReviewEvidence(original.reviewEvidence)}]};
 return next;
}

/** The table pasted into prompts: one line per usable part kind, saying which are special versions of the shape. */
export function inventoryTable(inv: Inventory) {
  return Object.entries(counts(inv))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => {
      const note = id.startsWith('wheels-') ? ' (each is a pair of wheels on a 2x2 axle plate)' : standIns(inv.parts[id]?.aka, n);
      return `${id} × ${n}${note}`;
    })
    .join('\n');
}

/** " (9 of them are log brick 1x2)": special versions that build like the plain shape but look different. */
function standIns(aka: Record<string, number> | undefined, total: number) {
  const bits = Object.entries(aka ?? {}).filter(([, k]) => k > 0).map(([name, k]) => (k === total ? (k === 1 ? `it is a ${name}` : `all are ${name}`) : `${k} ${k === 1 ? 'is a' : 'are'} ${name}`));
  return bits.length ? ` (${bits.join(', ')})` : '';
}

/** Per-color totals of usable parts, biggest first: "red 48 (bricks 30, plates 8, slopes 10)". */
export function colorTotals(inv: Inventory) {
  const by: Record<string, Record<string, number>> = {};
  for (const [id, n] of Object.entries(counts(inv))) {
    const m = /^([a-z]+)-\d+x\d+-(.+)$/.exec(id);
    if (!m) continue;
    by[m[2]] ??= {};
    by[m[2]][m[1]] = (by[m[2]][m[1]] ?? 0) + n;
  }
  return Object.entries(by)
    .map(([color, t]) => ({ color, total: Object.values(t).reduce((a, b) => a + b, 0), types: t }))
    .sort((a, b) => b.total - a.total);
}

export function colorTable(inv: Inventory) {
  return colorTotals(inv).map(c => `${c.color} ${c.total} (${Object.entries(c.types).map(([t, n]) => `${t}s ${n}`).join(', ')})`).join('\n');
}

const TYPE_ORDER: PartType[] = ['wedgeleft', 'wedgeright', 'quarterplate', 'brick', 'plate', 'tile', 'slope', 'curve', 'invslope', 'cheese', 'roundbrick', 'roundplate', 'roundtile', 'cone', 'arch', 'cornerbrick', 'cornerplate', 'cornertile', 'wheel', 'wheels'];
export function sortedEntries(inv: Inventory) {
  return Object.values(inv.parts).sort((a, b) =>
    TYPE_ORDER.indexOf(a.kind.type) - TYPE_ORDER.indexOf(b.kind.type) ||
    a.kind.color.localeCompare(b.kind.color) ||
    a.kind.w * a.kind.d - b.kind.w * b.kind.d);
}

// The built-in sample bucket — powers "Try a sample bucket" with no camera. Big enough for detailed builds, with wheels.
const SAMPLE: [PartType, string, ColorName, number][] = [
  ['brick', '2x4', 'red', 8], ['brick', '2x4', 'blue', 6], ['brick', '2x4', 'yellow', 4], ['brick', '2x4', 'white', 6], ['brick', '2x4', 'black', 4], ['brick', '2x4', 'light-gray', 4],
  ['brick', '2x3', 'red', 2],
  ['brick', '2x2', 'red', 6], ['brick', '2x2', 'white', 6], ['brick', '2x2', 'blue', 4], ['brick', '2x2', 'green', 4], ['brick', '2x2', 'yellow', 4],
  ['brick', '1x6', 'red', 2], ['brick', '1x6', 'white', 2],
  ['brick', '1x4', 'red', 4], ['brick', '1x4', 'light-gray', 4], ['brick', '1x4', 'white', 4], ['brick', '1x4', 'blue', 2],
  ['brick', '1x2', 'yellow', 8], ['brick', '1x2', 'black', 6], ['brick', '1x2', 'white', 8], ['brick', '1x2', 'red', 6], ['brick', '1x2', 'blue', 4], ['brick', '1x2', 'trans-clear', 4],
  ['brick', '1x1', 'white', 6], ['brick', '1x1', 'yellow', 4], ['brick', '1x1', 'red', 4], ['brick', '1x1', 'trans-clear', 4],
  ['plate', '4x6', 'light-gray', 2], ['plate', '4x6', 'black', 1], ['plate', '4x4', 'green', 1],
  ['plate', '2x6', 'black', 3], ['plate', '2x6', 'light-gray', 2],
  ['plate', '2x4', 'light-gray', 4], ['plate', '2x4', 'green', 3], ['plate', '2x4', 'red', 2], ['plate', '2x4', 'white', 2],
  ['plate', '2x2', 'dark-gray', 4],
  ['plate', '1x4', 'light-gray', 4], ['plate', '1x4', 'black', 2],
  ['plate', '1x2', 'red', 6], ['plate', '1x2', 'white', 6], ['plate', '1x2', 'black', 4],
  ['tile', '1x2', 'black', 6], ['tile', '1x4', 'light-gray', 2], ['tile', '2x2', 'white', 2],
  ['slope', '2x2', 'red', 6], ['slope', '2x2', 'blue', 4], ['slope', '3x2', 'red', 2], ['slope', '1x2', 'white', 6], ['slope', '1x2', 'black', 4],
  ['wheels', '4x2', 'black', 4], // sample includes four complete wheel-and-holder assemblies
];

export function sampleInventory(): Inventory {
  let inv: Inventory = { ...emptyInventory(), source: 'sample' };
  for (const [type, size, color, n] of SAMPLE) {
    const [w, d] = size.split('x').map(Number);
    inv = addPart(inv, parsePartId(partId(type, w, d, color))!, n);
  }
  return inv;
}
