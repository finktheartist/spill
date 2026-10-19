import {parsePartId,partId} from './bricks';
import {emptyInventory,proposedCounts,type Box,type Inventory} from './inventory';
import {readPieceReviewEvidence} from './piece-review-evidence';

/** Keep current reviews on same-stock restores, but recover missing source evidence. */
export function inventoryForRestoredRun(current:Inventory,imported:Inventory):Inventory {
 const a=proposedCounts(current),b=proposedCounts(imported),ids=Object.keys(a);
 if(ids.length!==Object.keys(b).length||ids.some(id=>a[id]!==b[id]))return imported;
 // Catalog-only observations now contribute exact build stock. Matching native
 // counts alone cannot establish that two saved piles are the same inventory.
 // Ignore review scores/confirmation here so same-identity newer reviews win.
 const otherIdentities=(inv:Inventory)=>JSON.stringify(inv.others.map(o=>JSON.stringify(o.catalog?[o.catalog.num,o.catalog.color,o.color,o.unknown===true]:[null,o.description,o.color,o.unknown===true])).sort());
 if(otherIdentities(current)!==otherIdentities(imported))return imported;
 const referenced=new Set([...Object.values(current.parts).flatMap(e=>e.boxes.map(b=>b.photo)),...current.others.flatMap(o=>o.boxes.map(b=>b.photo))]);
 const recovered=imported.photos.filter(p=>referenced.has(p.id)&&!current.photos.some(old=>old.id===p.id));
 if(recovered.length)return {...current,photos:[...current.photos,...recovered]};
 const entries=Object.values(current.parts);
 const countOnly=!current.others.length&&!current.manualLocks?.length&&entries.every(e=>!e.boxes.length&&!(e.confirmedCount&&e.confirmedCount>0)&&e.confidence!==1);
 const sourceIds=new Set(imported.photos.map(p=>p.id));
 const hasPhotoEvidence=Object.values(imported.parts).some(e=>e.boxes.some(b=>sourceIds.has(b.photo)))||imported.others.some(o=>o.boxes.some(b=>sourceIds.has(b.photo)));
 return countOnly&&hasPhotoEvidence?imported:current;
}

/** Local snapshot import. Older count-only scans remain unconfirmed. New
 * snapshots retain their existing human/scan evidence without adding stock. */
export function readInventorySnapshot(raw:unknown):Inventory{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Choose a saved inventory with an exact stock object.');
 const source=raw as Record<string,unknown>,stock=source.observedStock??source.stock;
 if(!stock||typeof stock!=='object'||Array.isArray(stock)||Object.keys(stock).length>500)throw Error('Saved inventory needs a bounded stock object.');
 const inv=emptyInventory();let total=0;
 for(const [id,n]of Object.entries(stock)){
  const k=parsePartId(id);
  if(!k||partId(k.type,k.w,k.d,k.color)!==id||!Number.isSafeInteger(n)||(n as number)<0||(n as number)>2000)throw Error(`Invalid saved inventory entry: ${id}.`);
  total+=n as number;if(total>2000)throw Error('Saved inventory exceeds 2000 pieces.');
  if(n)inv.parts[id]={kind:k,count:n as number,boxes:[],confidence:.5,confidenceSource:'unrecorded',modelConfidence:null};
 }
 const saved=source.inventory as Inventory|undefined;
 if(!total&&(!saved||!Array.isArray(saved.others)||!saved.others.length))throw Error('Saved inventory is empty.');
 if(saved&&typeof saved==='object'&&!Array.isArray(saved)&&saved.parts&&typeof saved.parts==='object'){
  const validBox=(b:unknown):b is Box=>Array.isArray(b)&&b.length===4&&b.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000)&&b[2]>b[0]&&b[3]>b[1];
  for(const [id,entry]of Object.entries(inv.parts)){
   const e=saved.parts[id];if(!e||e.count!==entry.count||e.kind?.partId!==id)continue;
   if(!Number.isFinite(e.confidence)||e.confidence<0||e.confidence>1||!Array.isArray(e.boxes)||e.boxes.length>2000)throw Error(`Invalid saved review evidence: ${id}.`);
   if(e.confirmedCount!==undefined&&(!Number.isSafeInteger(e.confirmedCount)||e.confirmedCount<0||e.confirmedCount>e.count))throw Error(`Invalid saved confirmation: ${id}.`);
   const evidence=(e:{modelConfidence?:number|null;confidenceSource?:string})=>{
    if(e.modelConfidence!==undefined&&e.modelConfidence!==null&&(!Number.isFinite(e.modelConfidence)||e.modelConfidence<0||e.modelConfidence>1))throw Error('Invalid model confidence.');
    return {modelConfidence:e.modelConfidence,confidenceSource:e.confidenceSource==='model'?'model' as const:e.confidenceSource==='unrecorded'?'unrecorded' as const:undefined};
   };
   const boxes=e.boxes.map(b=>{
    if(!b||!Number.isSafeInteger(b.photo)||!validBox(b.box)||(b.confidence!==undefined&&(!Number.isFinite(b.confidence)||b.confidence<0||b.confidence>1))||(b.confirmed!==undefined&&typeof b.confirmed!=='boolean'))throw Error(`Invalid saved observation: ${id}.`);
    return {photo:b.photo,box:[...b.box] as Box,confidence:b.confidence,confirmed:b.confirmed,...evidence(b),reviewEvidence:readPieceReviewEvidence(b.reviewEvidence)};
   });
   inv.parts[id]={...entry,confidence:e.confidence,confirmedCount:e.confirmedCount,boxes,...evidence(e),...(!e.boxes.length&&e.modelConfidence===undefined&&e.confidenceSource===undefined?{modelConfidence:null,confidenceSource:'unrecorded' as const}:{})};
  }
  if(Array.isArray(saved.photos)&&saved.photos.length<=32)inv.photos=saved.photos.filter(p=>p&&Number.isSafeInteger(p.id)&&typeof p.url==='string'&&p.url.length<25_000_000&&/^data:image\/(jpeg|png|webp);base64,/.test(p.url)&&(p.ref===undefined||Number.isSafeInteger(p.ref))).map(p=>({id:p.id,url:p.url,ref:p.ref}));
  if(Array.isArray(saved.manualLocks)&&saved.manualLocks.length<=4000)inv.manualLocks=saved.manualLocks.filter(k=>{try{const v=JSON.parse(k);return Array.isArray(v)&&v.length===5&&Number.isSafeInteger(v[0])&&validBox(v.slice(1));}catch{return false;}});
  if(Array.isArray(saved.others)&&saved.others.length<=2000)inv.others=saved.others.filter(o=>o&&typeof o.description==='string'&&o.description.length<=500&&typeof o.color==='string'&&o.color.length<=80&&Array.isArray(o.boxes)&&o.boxes.length<=32&&o.boxes.every(b=>Number.isSafeInteger(b.photo)&&validBox(b.box))).map(o=>({description:o.description,color:o.color,unknown:o.unknown===true,confirmed:o.confirmed===true,confidence:Number.isFinite(o.confidence)?o.confidence:undefined,modelConfidence:o.modelConfidence===null?null:Number.isFinite(o.modelConfidence)?o.modelConfidence:undefined,confidenceSource:o.confidenceSource==='model'?'model':o.confidenceSource==='unrecorded'?'unrecorded':undefined,catalog:o.catalog&&/^[a-zA-Z0-9._-]{1,80}$/.test(o.catalog.num)&&typeof o.catalog.name==='string'&&o.catalog.name.length<=500&&typeof o.catalog.color==='string'?{num:o.catalog.num,name:o.catalog.name,color:o.catalog.color}:undefined,reviewEvidence:readPieceReviewEvidence(o.reviewEvidence),boxes:o.boxes.map(b=>({photo:b.photo,box:[...b.box] as Box}))}));
 }
 if(!total&&!inv.others.length)throw Error('Saved inventory is empty.');
 return inv;
}
