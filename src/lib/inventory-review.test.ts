import {describe,it,expect} from 'vitest';
import {parsePartId} from './bricks';
import {addPart,counts,editPiece,emptyInventory,pendingReviewCount,setCount,reviewPartType,clearPhotoObservations,isObservationLocked,proposedCounts} from './inventory';
import {readInventorySnapshot} from './inventory-snapshot';
const red=parsePartId('brick-1x2-red')!,blue=parsePartId('brick-1x2-blue')!;
const box:[number,number,number,number]=[10,20,100,200],at={photo:3,box};
describe('uncertain inventory and human corrections',()=>{
 it('keeps uncertain readings out while retaining confident and manually added pieces',()=>{
  let inv=addPart(emptyInventory(),red,1,at,.2);inv=addPart(inv,red,1,{photo:3,box:[200,200,300,300]},.9);inv=addPart(inv,red,1);
  expect(counts(inv)).toEqual({[red.partId]:2});expect(pendingReviewCount(inv)).toBe(1);
  const checked=editPiece(inv,[...box],3,{kind:red});expect(counts(checked)).toEqual({[red.partId]:3});expect(pendingReviewCount(checked)).toBe(0);expect(isObservationLocked(checked,3,box)).toBe(true);
 });
 it('replaces the current photo crop once and never resurrects a removed observation',()=>{
  const inv=addPart(emptyInventory(),red,1,at,.2),next=editPiece(inv,[...box],3,{kind:blue});
  expect(counts(next)).toEqual({[blue.partId]:1});expect(inv.parts[red.partId].count).toBe(1);
  const removed=editPiece(next,box,3,{remove:true});expect(editPiece(removed,box,3,{kind:red})).toEqual(removed);
 });
 it('human row correction preserves the total and exact selected kind',()=>{
  const inv=addPart(emptyInventory(),red,3,undefined,.2,undefined,false);
  expect(counts(inv)).toEqual({});const next=reviewPartType(inv,red.partId,{kind:blue});
  expect(counts(next)).toEqual({[blue.partId]:3});expect(proposedCounts(inv)).toEqual({[red.partId]:3});
  expect(counts(setCount(next,blue.partId,0))).toEqual({});
 });
 it('retry replaces machine detections while retaining manual fixes',()=>{
  let inv=addPart(emptyInventory(),red,1,at,.2);inv=editPiece(inv,box,3,{kind:blue});inv=addPart(inv,red,1,{photo:3,box:[300,300,400,400]},.9);
  const next=clearPhotoObservations(inv,3);expect(counts(next)).toEqual({[blue.partId]:1});expect(proposedCounts(next)).toEqual({[blue.partId]:1});
 });
 it('edits the selected uncertain identity when a legacy outline is shared with a known piece',()=>{
  let inv=addPart(emptyInventory(),red,1,at,1,undefined,true);inv=addPart(inv,blue,1,at,.2);
  const next=editPiece(inv,[...box],3,{kind:blue},blue.partId);
  expect(counts(next)).toEqual({[red.partId]:1,[blue.partId]:1});expect(pendingReviewCount(next)).toBe(0);expect(next.parts[red.partId]).toEqual(inv.parts[red.partId]);
  expect(editPiece(next,box,3,{kind:red},'brick-1x3-red')).toBe(next);
 });
 it('uncertain-only crop confirmation leaves a known identical copy on the same legacy outline intact',()=>{
  let inv=addPart(emptyInventory(),red,1,at,1,undefined,true);inv=addPart(inv,red,1,at,.2);
  const next=editPiece(inv,box,3,{kind:blue},red.partId,true);
  expect(counts(next)).toEqual({[red.partId]:1,[blue.partId]:1});expect(pendingReviewCount(next)).toBe(0);expect(next.parts[red.partId].confirmedCount).toBe(1);
 });
 it('count adjustments do not silently confirm uncertain identities',()=>{
  const inv=addPart(emptyInventory(),red,10,undefined,.2,undefined,false),next=setCount(inv,red.partId,9,false);
  expect(counts(next)).toEqual({});expect(pendingReviewCount(next)).toBe(9);
 });
 it('uncertain-only gallery corrections preserve known copies of the same type',()=>{
  let inv=addPart(emptyInventory(),red,3);inv=addPart(inv,red,2,undefined,.2,undefined,false);
  const next=reviewPartType(inv,red.partId,{kind:blue},true);expect(counts(next)).toEqual({[red.partId]:3,[blue.partId]:2});expect(pendingReviewCount(next)).toBe(0);expect(inv.parts[red.partId].count).toBe(5);
  const confirm=reviewPartType(inv,red.partId,{kind:red},true);expect(counts(confirm)).toEqual({[red.partId]:5});
 });
 it('round trips review evidence and keeps count-only saved estimates pending',()=>{
  let inv=addPart(emptyInventory(),red,1,at,.2);inv=addPart(inv,red,1);inv=addPart(inv,blue,1,undefined,.2,undefined,false);
  const restored=readInventorySnapshot({stock:counts(inv),observedStock:proposedCounts(inv),inventory:inv});expect(counts(restored)).toEqual(counts(inv));expect(pendingReviewCount(restored)).toBe(2);
  expect(counts(readInventorySnapshot({stock:{[red.partId]:3}}))).toEqual({});
 });
});
