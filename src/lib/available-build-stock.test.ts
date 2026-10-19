import {expect,it} from 'vitest';
import {addPart,availableCount,counts,emptyInventory,needsReviewCount,pendingReviewCount,proposedCounts,sampleInventory,usableParts,type Inventory,type InvEntry} from './inventory';
import {parsePartId} from './bricks';
import {isMade} from './catalog';

const kind=(id:string)=>{const k=parsePartId(id);if(!k)throw Error(`Bad test part ${id}`);return k;};
const red=kind('brick-1x2-red'),blue=kind('plate-1x2-blue');
const at=(n:number)=>({photo:1,box:[n,n,n+10,n+10] as [number,number,number,number]});

it('exposes exactly 24 usable native copies from a mixed observed inventory without changing observations or review state',()=>{
 let inv=addPart(emptyInventory(),red,20);
 inv=addPart(inv,blue,1,at(0),.2);
 inv=addPart(inv,kind('plate-3x8-red'),2);
 inv=addPart(inv,kind('tile-2x3-tan'),3);
 inv={...inv,manualLocks:['[1,0,0,10,10]'],others:[
  {description:'Headlight brick',color:'red',catalog:{num:'4070',name:'Headlight brick',color:'red'},confirmed:true,boxes:[at(30)]},
  {description:'Unmatched special piece',color:'blue',unknown:true,confidence:.2,boxes:[at(50)]},
 ]};
 const saved=structuredClone(inv),pending=pendingReviewCount(inv);
 expect(counts(inv)).toEqual({[red.partId]:20,'tile-2x3-tan':3,'headlight-1x1-red':1});expect(usableParts(inv)).toBe(24);
 expect(proposedCounts(inv)).toEqual({[red.partId]:20,[blue.partId]:1,'plate-3x8-red':2,'tile-2x3-tan':3});
 expect(availableCount(inv.parts['plate-3x8-red'])).toBe(2);expect(needsReviewCount(inv.parts['plate-3x8-red'])).toBe(0);
 expect(pendingReviewCount(inv)).toBe(pending);expect(inv).toEqual(saved);expect(inv.others).toHaveLength(2);
});
it('keeps the existing inclusive .6 per-copy threshold and leaves low-confidence copies observed',()=>{
 let inv=addPart(emptyInventory(),red,1,at(0),.599999);
 inv=addPart(inv,red,1,at(20),.6);inv=addPart(inv,red,1,at(40),.9);
 expect(counts(inv)).toEqual({[red.partId]:2});expect(inv.parts[red.partId].count).toBe(3);
 expect(availableCount(inv.parts[red.partId])).toBe(2);expect(needsReviewCount(inv.parts[red.partId])).toBe(1);
 const legacy:Inventory={...emptyInventory(),parts:{[red.partId]:{kind:red,count:2,boxes:[],confidence:.6}}};
 expect(counts(legacy)).toEqual({[red.partId]:2});
 expect(counts({...legacy,parts:{[red.partId]:{...legacy.parts[red.partId],confidence:.599999}}})).toEqual({});
});
it('excludes a known unmanufactured native color even if manually confirmed, without recoloring or deleting it',()=>{
 const bad=kind('plate-8x8-blue');expect(isMade(bad.partId)).toBe(false);
 const inv=addPart(emptyInventory(),bad,2),saved=structuredClone(inv);
 expect(counts(inv)).toEqual({});expect(proposedCounts(inv)).toEqual({[bad.partId]:2});expect(inv).toEqual(saved);
});
it('excludes loose wheels and every unconfirmed or wrong-size wheel assembly',()=>{
 let inv=addPart(emptyInventory(),kind('wheel-1x1-black'),4);
 inv=addPart(inv,kind('wheels-4x2-black'),1,at(0),1);
 inv=addPart(inv,kind('wheels-2x2-black'),2);
 expect(counts(inv)).toEqual({});expect(inv.parts['wheel-1x1-black'].count).toBe(4);expect(inv.parts['wheels-4x2-black'].count).toBe(1);
 const legacy:InvEntry={kind:kind('wheels-4x2-black'),count:3,confidence:1,boxes:[]};
 expect(counts({...emptyInventory(),parts:{'wheels-4x2-black':legacy}})).toEqual({});
});
it('preserves explicitly confirmed complete legacy wheel assemblies without charging model-only copies',()=>{
 const wheels=kind('wheels-4x2-black');let inv=addPart(emptyInventory(),wheels,2);
 inv=addPart(inv,wheels,1,at(0),.95);
 expect(availableCount(inv.parts[wheels.partId])).toBe(3);expect(counts(inv)).toEqual({[wheels.partId]:2});
 const legacy:InvEntry={kind:wheels,count:3,confidence:.9,boxes:[{...at(10),confirmed:true},{...at(30),confirmed:false},{...at(50),confirmed:true}]};
 expect(counts({...emptyInventory(),parts:{[wheels.partId]:legacy}})).toEqual({[wheels.partId]:2});
 expect(counts(sampleInventory())['wheels-4x2-black']).toBe(4);
});
it('does not grant a supported native identity to mismatched stored kind fields',()=>{
 const inv=addPart(emptyInventory(),red,2),entry=inv.parts[red.partId];
 for(const mismatch of [{...red,w:3},{...red,color:'blue' as const},{...red,type:'plate' as const}]){
  const bad:Inventory={...inv,parts:{[red.partId]:{...entry,kind:mismatch}}};
  expect(counts(bad)).toEqual({});expect(bad.parts[red.partId].count).toBe(2);
 }
});
it('does not emit fractional or nonfinite build quantities from malformed confirmation metadata',()=>{
 const inv=addPart(emptyInventory(),red,2);
 for(const confirmedCount of [.5,NaN]){
  const bad:Inventory={...inv,parts:{[red.partId]:{...inv.parts[red.partId],confirmedCount}}};
  expect(counts(bad)).toEqual({});expect(bad.parts[red.partId].count).toBe(2);
 }
});
