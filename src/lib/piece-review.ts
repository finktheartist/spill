import {partInfo} from './catalog';
import {pieceConfidence} from './piece-confidence';
import type {Box,Inventory,InvEntry,OtherEntry,PartObservation} from './inventory';
import type {PartKind} from './bricks';
export interface PieceReviewRow {
 key:string;quantity:number;label:string;color:string;kind?:PartKind;partId?:string;entry?:InvEntry;other?:OtherEntry;photo?:number;box?:Box;observation?:PartObservation;
 confidence:ReturnType<typeof pieceConfidence>;matched:boolean;confirmedCount:number;
}
/** One row per photographed observation; count-only imports retain a clearly
 * labelled group because they have no evidence for individual copies. */
export function pieceReviewRows(inv:Inventory):PieceReviewRow[]{
 const rows:PieceReviewRow[]=[];
 for(const e of Object.values(inv.parts)){
  if(e.count<=0)continue;
  const info=partInfo(e.kind.partId),used=e.boxes.slice(0,e.count),occurrences=new Map<string,number>();
  for(const b of used){
   const base=`${e.kind.partId}@${b.photo}:${b.box.join(',')}`,ordinal=occurrences.get(base)??0;occurrences.set(base,ordinal+1);
   rows.push({key:`${base}#${ordinal}`,quantity:1,label:info?.name??e.kind.partId,color:e.kind.color,kind:e.kind,partId:e.kind.partId,entry:e,photo:b.photo,box:b.box,observation:b,matched:!!info,confirmedCount:b.confirmed?1:0,confidence:observationConfidence(e,b)});
  }
  const n=e.count-used.length;
  if(n){const checked=Math.max(0,Math.min(n,(e.confirmedCount??0)-used.filter(b=>b.confirmed).length));rows.push({key:`${e.kind.partId}@count`,quantity:n,label:info?.name??e.kind.partId,color:e.kind.color,kind:e.kind,partId:e.kind.partId,entry:e,matched:!!info,confirmedCount:checked,confidence:pieceConfidence({...e,confirmed:checked===n})});}
 }
 const occurrences=new Map<string,number>();
 for(const o of inv.others){
  const b=o.boxes.find(b=>inv.photos.some(p=>p.id===b.photo))??o.boxes[0],base=`other@${b?`${b.photo}:${b.box.join(',')}`:o.description}:${o.catalog?.num??''}`,ordinal=occurrences.get(base)??0;occurrences.set(base,ordinal+1);
  rows.push({key:`${base}#${ordinal}`,quantity:1,label:o.catalog?.name??o.description??'Unidentified piece',color:o.color,other:o,photo:b?.photo,box:b?.box,matched:!!o.catalog,confirmedCount:o.confirmed?1:0,confidence:pieceConfidence(o)});
 }
 return rows;
}
export const unmatchedPieceCount=(inv:Inventory)=>pieceReviewRows(inv).filter(r=>!r.matched).reduce((n,r)=>n+r.quantity,0);
export function observationConfidence(e:Inventory['parts'][string],b:PartObservation){return pieceConfidence({...e,...b,modelConfidence:b.modelConfidence===undefined?(b.confirmed?null:b.confidence??e.modelConfidence):b.modelConfidence,confirmed:b.confirmed===true});}

/** Queue traversal uses captured observation identities; occurrence labels can renumber after deletion. */
export function sameReviewObservation(a:PieceReviewRow,b:PieceReviewRow):boolean {
 if(a.observation||b.observation)return !!a.observation&&a.observation===b.observation;
 if(a.other||b.other)return !!a.other&&a.other===b.other;
 return a.key===b.key&&a.entry===b.entry;
}
