import {expect,it} from 'vitest';
import {addPart,counts,emptyInventory,reviewOtherPiece,type Box,type Inventory,type OtherEntry} from './inventory';
import {inventoryForRestoredRun,readInventorySnapshot} from './inventory-snapshot';
import {parsePartId} from './bricks';
import {pieceReviewRows} from './piece-review';
const kind=parsePartId('brick-1x2-red')!,box:Box=[100,200,300,400],photo={id:5,url:'data:image/png;base64,iVBORw0KGgo='};
const withPhoto=()=>({...addPart(emptyInventory(),kind,1,{photo:photo.id,box},.4),photos:[photo]});
const special:OtherEntry={description:'Unknown clip',color:'red',unknown:true,confidence:.3,boxes:[{photo:99,box:[0,0,100,100]},{photo:photo.id,box}]};

it('selects available special-part source evidence rather than a dangling first photo reference',()=>{
 const inv={...emptyInventory(),photos:[photo],others:[special]},[row]=pieceReviewRows(inv);
 expect(row.photo).toBe(photo.id);expect(row.box).toBe(box);expect(row.quantity).toBe(1);expect(row.other).toBe(special);
});
it('retains that available source when a special observation is confirmed as a native part',()=>{
 const inv={...emptyInventory(),photos:[photo],others:[special]},next=reviewOtherPiece(inv,special,{kind});
 expect(counts(next)).toEqual({[kind.partId]:1});expect(next.parts[kind.partId].boxes).toHaveLength(1);expect(pieceReviewRows(next)[0].photo).toBe(photo.id);
 expect(next.manualLocks).toHaveLength(2);expect(inv.others[0]).toBe(special);
});
it('retains an honest dangling reference if none of an observations photos is available',()=>{
 const [row]=pieceReviewRows({...emptyInventory(),others:[special]});expect(row.photo).toBe(99);expect(row.other).toBe(special);
});
it('restores richer photo-bearing evidence over an equal count-only import',()=>{
 const old=readInventorySnapshot({stock:{[kind.partId]:1}}),incoming=withPhoto(),next=inventoryForRestoredRun(old,incoming);
 expect(next).toBe(incoming);expect(pieceReviewRows(next)[0].photo).toBe(photo.id);expect(next.parts[kind.partId].confirmedCount).toBe(0);
});
it('recovers missing photo links without replacing current human edits or observations',()=>{
 const source=withPhoto(),entry={...source.parts[kind.partId],confirmedCount:1,boxes:source.parts[kind.partId].boxes.map(b=>({...b,confirmed:true}))};
 const current:Inventory={...source,photos:[],parts:{[kind.partId]:entry},manualLocks:['[5,100,200,300,400]']};
 const next=inventoryForRestoredRun(current,source);expect(next.photos).toEqual([photo]);expect(next.parts).toBe(current.parts);expect(next.manualLocks).toBe(current.manualLocks);expect(next.others).toBe(current.others);expect(current.photos).toEqual([]);
});
it('preserves current human-confirmed count-only stock and richer same-stock current evidence',()=>{
 const incoming=withPhoto(),manual=addPart(emptyInventory(),kind,1);
 expect(inventoryForRestoredRun(manual,incoming)).toBe(manual);expect(inventoryForRestoredRun(incoming,manual)).toBe(incoming);
});
it('does not manufacture source links from unrelated photos or discard a different restored ledger',()=>{
 const current=readInventorySnapshot({stock:{[kind.partId]:1}}),unlinked={...current,photos:[photo]};
 expect(inventoryForRestoredRun(current,unlinked)).toBe(current);
 const different=addPart(emptyInventory(),kind,2);expect(inventoryForRestoredRun(current,different)).toBe(different);
});
