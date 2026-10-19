import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {addPart,counts,editPiece,emptyInventory,reviewOtherPiece,reviewPartType,reviewUnboxedPart,setCount,type OtherEntry} from './inventory';
import {parsePartId} from './bricks';
import {pieceReviewRows,unmatchedPieceCount} from './piece-review';
import {readInventorySnapshot} from './inventory-snapshot';
import {ConfidenceReview} from '../components/ConfidenceReview';
import {Parts} from '../screens/Parts';
vi.mock('./render',async original=>({...await original<typeof import('./render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const red=parsePartId('brick-1x2-red')!,blue=parsePartId('brick-1x2-blue')!,box:[number,number,number,number]=[10,10,100,100];
const catalog={num:'4070',name:'Brick Special 1 x 1 with Headlight',color:'red'};
const other:OtherEntry={description:'special unknown',color:'red',boxes:[{photo:1,box}],unknown:true,confidence:.35,modelConfidence:.35};
const noop=()=>{};
describe('complete confidence and catalog review',()=>{
 it('keeps separate confidence per physical observation, including confident readings',()=>{
  let inv=addPart(emptyInventory(),red,1,{photo:1,box},.94);inv=addPart(inv,red,1,{photo:1,box:[200,200,300,300]},.7);inv=addPart(inv,red,1,{photo:1,box:[400,400,500,500]},.2);
  const rows=pieceReviewRows(inv);expect(rows.map(r=>r.confidence.tone)).toEqual(['high','medium','low']);expect(rows.every(r=>r.quantity===1&&r.matched)).toBe(true);expect(new Set(rows.map(r=>r.key)).size).toBe(3);
 });
 it('shows gray for count-only legacy imports instead of inventing a 50 percent score',()=>{
  const inv=readInventorySnapshot({stock:{[red.partId]:3}}),rows=pieceReviewRows(inv);expect(rows).toHaveLength(1);expect(rows[0].quantity).toBe(3);expect(rows[0].confidence.score).toBeNull();
  const checked=reviewPartType(inv,red.partId,{kind:red});expect(pieceReviewRows(checked)[0].confidence.score).toBeNull();expect(pieceReviewRows(checked)[0].confirmedCount).toBe(3);
 });
 it('retains a model score when its exact original guess is confirmed without changing it to 100 percent',()=>{
  const inv=addPart(emptyInventory(),red,1,{photo:1,box},.72),next=editPiece(inv,box,1,{kind:red},red.partId);
  expect(pieceReviewRows(next)[0].confidence.score).toBe(.72);expect(pieceReviewRows(next)[0].confidence.confirmed).toBe(true);expect(counts(next)).toEqual({[red.partId]:1});
  const revised=editPiece(inv,box,1,{kind:blue},red.partId);expect(pieceReviewRows(revised)[0].confidence.score).toBeNull();expect(pieceReviewRows(revised)[0].confirmedCount).toBe(1);
 });
 it('catalog matches resolve unknowns without adding substitute bricks or geometry',()=>{
  const inv={...emptyInventory(),others:[other]},next=reviewOtherPiece(inv,other,{name:catalog.name,catalog});
  expect(unmatchedPieceCount(inv)).toBe(1);expect(unmatchedPieceCount(next)).toBe(0);expect(next.others[0].catalog).toEqual(catalog);expect(counts(next)).toEqual({'headlight-1x1-red':1});expect(pieceReviewRows(next)[0].confirmedCount).toBe(1);
  expect(reviewOtherPiece(next,other,{kind:red})).toBe(next);expect(other.unknown).toBe(true);
 });
 it('allows a catalog match or removal when the old observation has no source photo',()=>{
  const original={...other,boxes:[]},inv={...emptyInventory(),others:[original]};
  expect(unmatchedPieceCount(reviewOtherPiece(inv,original,{name:catalog.name,catalog}))).toBe(0);expect(reviewOtherPiece(inv,original,{remove:true}).others).toEqual([]);
 });
 it('moves an authored native group to its exact special-part identity while preserving total physical counts',()=>{
  const inv=addPart(emptyInventory(),red,3),next=reviewPartType(inv,red.partId,{name:catalog.name,catalog});
  expect(counts(next)).toEqual({'headlight-1x1-red':3});expect(next.others).toHaveLength(3);expect(next.others.every(o=>o.catalog?.num==='4070')).toBe(true);expect(unmatchedPieceCount(next)).toBe(0);
 });
 it('selects the exact observation reference on shared legacy outlines and rejects stale callbacks',()=>{
  let inv=addPart(emptyInventory(),red,1,{photo:1,box},1,undefined,true);inv=addPart(inv,red,1,{photo:1,box},.8);
  const selected=pieceReviewRows(inv)[1].observation!,next=editPiece(inv,box,1,{kind:blue},red.partId,false,selected);
  expect(counts(next)).toEqual({[red.partId]:1,[blue.partId]:1});expect(next.parts[red.partId].confirmedCount).toBe(1);
  expect(editPiece(next,box,1,{kind:blue},red.partId,false,selected)).toBe(next);
 });
 it('can export and restore a pile containing only identified special pieces',()=>{
  const inv={...emptyInventory(),others:[{...other,catalog,confirmed:true,modelConfidence:null}]};
  const read=readInventorySnapshot({stock:{},observedStock:{},inventory:inv});expect(read.others[0].catalog?.num).toBe('4070');expect(unmatchedPieceCount(read)).toBe(0);expect(counts(read)).toEqual({});
 });
 it('reclassifies only an unboxed group while preserving photographed copies of the same type',()=>{
  let inv=addPart(emptyInventory(),red,1,{photo:1,box},.9);inv=addPart(inv,red,1,{photo:1,box:[200,200,300,300]},.9);inv=addPart(inv,red,3);
  const next=reviewUnboxedPart(inv,red.partId,{kind:blue},3);expect(next.parts[red.partId].count).toBe(2);expect(next.parts[red.partId].boxes).toEqual(inv.parts[red.partId].boxes);expect(counts(next)).toEqual({[red.partId]:2,[blue.partId]:3});
  expect(reviewUnboxedPart(inv,red.partId,{kind:blue},4)).toBe(inv);
 });
 it('never invents model certainty by reconfirming legacy human-checked records without saved model scores',()=>{
  const inv=emptyInventory();inv.parts[red.partId]={kind:red,count:1,confidence:1,confirmedCount:1,boxes:[{photo:1,box,confidence:1,confirmed:true}]};
  expect(pieceReviewRows(inv)[0].confidence.score).toBeNull();
  expect(pieceReviewRows(editPiece(inv,box,1,{kind:red},red.partId))[0].confidence.score).toBeNull();
  expect(pieceReviewRows(setCount(inv,red.partId,1))[0].confidence.score).toBeNull();
  const unboxed={...inv,parts:{[red.partId]:{...inv.parts[red.partId],boxes:[]}}};
  expect(pieceReviewRows(reviewUnboxedPart(unboxed,red.partId,{kind:red},1))[0].confidence.score).toBeNull();
 });
 it('round trips confidence and exact special catalog identifiers',()=>{
  let inv=addPart(emptyInventory(),red,1,{photo:1,box},.9);inv={...inv,others:[{...other,catalog,confirmed:true,modelConfidence:null}]};
  const read=readInventorySnapshot({stock:counts(inv),observedStock:{[red.partId]:1},inventory:inv});expect(read.others[0].catalog).toEqual(catalog);expect(pieceReviewRows(read).map(r=>r.confidence.score)).toEqual([.9,null]);
 });
 it('offers every confidence band and every-piece review without presenting confirmation as a model score',()=>{
  let inv=addPart(emptyInventory(),red,1,{photo:1,box},.94);inv=addPart(inv,blue,1);
  const html=renderToStaticMarkup(createElement(ConfidenceReview,{rows:pieceReviewRows(inv),onReview:noop,onReviewAll:noop}));
  expect(html).toContain('94%');expect(html).toContain('Checked by you');expect(html).toContain('No scan score');expect(html).toContain('Review every piece');expect(html).toContain('not a calibrated probability');
 });
 it('allows usable-stock designs while unmatched observations remain excluded and reviewable',()=>{
  const inv={...addPart(emptyInventory(),red,30),others:[other]};
  const html=renderToStaticMarkup(createElement(Parts,{inv,scans:[],onCount:noop,onAddPart:noop,onPhoto:noop,onRetry:noop,onNext:noop,onRequest:noop,onBench:noop,onAnglePhoto:noop,onResolve:noop,onConfirmOutline:noop,onReviewType:noop,onReviewOther:noop}));
  expect(unmatchedPieceCount(inv)).toBe(1);expect(counts(inv)).toEqual({[red.partId]:30});
  expect(html).toContain('Review or correct');expect(html).toContain('1 observation still needs an exact catalog match');
  expect(html).not.toMatch(/disabled=""[^>]*>Build with available pieces/);
 });
});
