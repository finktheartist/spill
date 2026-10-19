import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyDetections,recheck,type Detection} from './gemini';
import {parsePartId} from './bricks';
import {counts,editPiece,emptyInventory,observationKey,proposedCounts,reviewOtherPiece} from './inventory';
import {readInventorySnapshot} from './inventory-snapshot';
import {PieceEditor} from '../components/PieceEditor';
vi.mock('./render',async original=>({...await original<typeof import('./render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const box:[number,number,number,number]=[100,100,200,300],k=parsePartId('plate-1x2-white')!;
const original:Detection={kind:k,description:'white plate',color:'white',box,confidence:.4};
const raw={type:'plate',size:'1x2',color:'white',description:'thin white rectangle with two studs',heightPlates:1,studsOnTop:2,outline:'rectangle' as const,topShape:'flat' as const,studLayout:'grid' as const,confidence:.4};
describe('scan clues reach review without becoming identity or stock',()=>{
 it('retains feature-only improvements of an unchanged close-up identity',()=>{
  const next=recheck(original,raw)!;expect(next.kind?.partId).toBe(k.partId);expect(next.reviewEvidence).toEqual({description:raw.description,size:'1x2',features:{heightPlates:1,studsOnTop:2,outline:'rectangle',topShape:'flat',studLayout:'grid'}});
  expect(recheck(next,raw)).toBeNull();
 });
 it('stores each observation independently and leaves unconfirmed quantities excluded',()=>{
  const a=recheck(original,raw)!,b={...a,box:[300,100,400,300] as typeof box,reviewEvidence:{description:'partially covered white plate',size:'1x2'}};
  const inv=applyDetections(emptyInventory(),[a,b],1),entry=inv.parts[k.partId];
  expect(entry.count).toBe(2);expect(counts(inv)).toEqual({});expect(entry.boxes.map(b=>b.reviewEvidence?.description)).toEqual([raw.description,b.reviewEvidence.description]);
  expect(applyDetections(inv,[a],1)).toEqual(inv);
 });
 it('keeps unknown mold clues available without choosing a supported substitute',()=>{
  const d=recheck(original,{type:'unknown',size:'3x3',color:'white',description:'smooth round disk',confidence:.3,heightPlates:1,studsOnTop:0,outline:'round',topShape:'flat',studLayout:'none'})!;
  const inv=applyDetections(emptyInventory(),[d],1);
  expect(counts(inv)).toEqual({});expect(Object.keys(inv.parts)).toHaveLength(0);expect(inv.others[0].unknown).toBe(true);expect(inv.others[0].reviewEvidence?.features?.outline).toBe('round');
  const confirmed=reviewOtherPiece(inv,inv.others[0],{kind:parsePartId('roundtile-3x3-white')!});
  expect(counts(confirmed)).toEqual({'roundtile-3x3-white':1});expect(confirmed.parts['roundtile-3x3-white'].boxes[0].reviewEvidence).toEqual(d.reviewEvidence);
 });
 it('roundtrips original clues, confidence, crop and locks without adding stock',()=>{
  const d=recheck(original,raw)!,inv=applyDetections(emptyInventory(),[d],1),checked=editPiece(inv,box,1,{kind:k},k.partId,false,inv.parts[k.partId].boxes[0]);
  const saved=readInventorySnapshot({stock:counts(checked),observedStock:proposedCounts(checked),inventory:checked}),b=saved.parts[k.partId].boxes[0];
  expect(b.reviewEvidence).toEqual(d.reviewEvidence);expect(b.confidence).toBe(1);expect(b.modelConfidence).toBe(.4);expect(b.box).toEqual(box);expect(saved.manualLocks).toContain(observationKey(1,box));expect(counts(saved)).toEqual({[k.partId]:1});
 });
 it('preserves the original observation clues when a native reading is corrected to an unsupported exact mold',()=>{
  const d=recheck(original,raw)!,inv=applyDetections(emptyInventory(),[d],1),observation=inv.parts[k.partId].boxes[0];
  const corrected=editPiece(inv,box,1,{name:'Printed end-stud plate',catalog:{num:'92593pr0001',name:'Printed end-stud plate',color:'white'}},k.partId,false,observation);
  expect(corrected.others[0].reviewEvidence).toEqual(d.reviewEvidence);expect(corrected.others[0].catalog?.num).toBe('92593pr0001');expect(counts(corrected)).toEqual({});
 });
 it('restores special observation clues and drops malformed evidence without changing its ledger',()=>{
  const inv={...emptyInventory(),others:[{description:'special part',color:'white',unknown:true,confirmed:false,confidence:.3,boxes:[{photo:1,box}],reviewEvidence:{description:'smooth disk',size:'3x3',features:{outline:'round' as const,studsOnTop:0}}}]};
  const restored=readInventorySnapshot({observedStock:{},inventory:inv});expect(restored.others[0].reviewEvidence).toEqual(inv.others[0].reviewEvidence);expect(counts(restored)).toEqual({});
  const malformed=structuredClone(inv) as unknown as {others:{reviewEvidence:unknown}[]};malformed.others[0].reviewEvidence={features:{studsOnTop:NaN,confirmed:true},kind:k};
  expect(readInventorySnapshot({observedStock:{},inventory:malformed}).others[0].reviewEvidence).toBeUndefined();
 });
 it('gives an unknown a comparison area and a full-catalog escape without selecting an identity',()=>{
  const html=renderToStaticMarkup(createElement(PieceEditor,{current:{description:'smooth round tile 3x3',color:'dark-blue',unknown:true},onApply:()=>{},onClose:()=>{}}));
  expect(html).toContain('aria-label="Matching catalog pieces"');expect(html).toContain('None of these? Search all pieces');
  expect(html).not.toContain('Selected:');expect(html).toMatch(/disabled=""[^>]*>Use selected piece/);
 });
});
