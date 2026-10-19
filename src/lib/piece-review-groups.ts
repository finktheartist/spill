import {editPiece,reviewOtherPiece,reviewUnboxedPart,type Inventory,type Resolution} from './inventory';
import {pieceReviewRows,sameReviewObservation,type PieceReviewRow} from './piece-review';
import {isViablePiece} from './piece-gallery';

export interface PieceReviewGroup {key:string;rows:PieceReviewRow[];quantity:number;confirmedCount:number}
/** Group predictions, never physical observations. Unknown descriptions do not
 * establish a shared mold identity; printed variants and colors stay separate. */
export function pieceReviewGroupKey(row:PieceReviewRow):string {
 if(row.partId)return JSON.stringify(['native',row.partId,row.color]);
 if(row.other?.catalog)return JSON.stringify(['catalog',row.other.catalog.num,row.color,row.other.catalog.color]);
 return JSON.stringify(['unidentified',row.key]);
}
export function pieceReviewGroups(rows:PieceReviewRow[]):PieceReviewGroup[]{
 const groups=new Map<string,PieceReviewGroup>();
 for(const row of rows){
  const key=pieceReviewGroupKey(row),group=groups.get(key)??{key,rows:[],quantity:0,confirmedCount:0};
  group.rows.push(row);group.quantity+=row.quantity;group.confirmedCount+=row.confirmedCount;groups.set(key,group);
 }
 return [...groups.values()];
}

/** Apply exactly the selected snapshot, atomically. A concurrent replacement or
 * quantity edit rejects the action; later scan arrivals never inherit a check.
 * Photo observations retain their own evidence, locks and model-score semantics. */
export function applyPieceReviewGroup(inv:Inventory,selected:PieceReviewRow[],resolution:Resolution):Inventory {
 if(!selected.length||('kind'in resolution&&!isViablePiece(resolution.kind)))return inv;
 const key=pieceReviewGroupKey(selected[0]);
 if(selected.some(row=>pieceReviewGroupKey(row)!==key))return inv;
 const latest=pieceReviewRows(inv),found=new Set<PieceReviewRow>();
 for(const row of selected){
  const current=latest.find(now=>sameReviewObservation(row,now));
  if(!current||found.has(current)||current.quantity!==row.quantity||current.confirmedCount!==row.confirmedCount||pieceReviewGroupKey(current)!==key)return inv;
  found.add(current);
 }
 let next=inv;
 for(const row of selected){
  if(row.other)next=reviewOtherPiece(next,row.other,resolution);
  else if(row.observation&&row.partId&&row.box&&row.photo!==undefined)next=editPiece(next,row.box,row.photo,resolution,row.partId,false,row.observation);
  else if(row.partId)next=reviewUnboxedPart(next,row.partId,resolution,row.quantity,next.parts[row.partId]);
  else return inv;
 }
 return next;
}
