import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {addPart,counts,editPiece,emptyInventory,isObservationLocked,proposedCounts,reviewOtherPiece,setCount,type OtherEntry} from './inventory';
import {parsePartId} from './bricks';
import {pieceReviewRows} from './piece-review';
import {applyPieceReviewGroup,pieceReviewGroups} from './piece-review-groups';
import {readInventorySnapshot} from './inventory-snapshot';
import {ConfidenceReview} from '../components/ConfidenceReview';
import {PieceEditor} from '../components/PieceEditor';
vi.mock('./render',async original=>({...await original<typeof import('./render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const red=parsePartId('brick-1x2-red')!,blue=parsePartId('brick-1x2-blue')!;
const crop=(i:number)=>({photo:1,box:[i*100,0,i*100+80,80] as [number,number,number,number]});
function pile(){let inv=emptyInventory();for(let i=0;i<3;i++)inv=addPart(inv,red,1,crop(i),[.2,.75,.94][i]);return inv;}
const other=(num?:string,color='red'):OtherEntry=>({description:'small special piece',color,boxes:[],unknown:!num,confidence:.3,...(num?{catalog:{num,name:`Mold ${num}`,color}}:{})});
describe('grouped piece review',()=>{
 it('groups identical predictions across confidence bands without merging observations or colors',()=>{
  const inv=addPart(pile(),blue,1,crop(4),.4),groups=pieceReviewGroups(pieceReviewRows(inv));
  expect(groups.map(g=>g.quantity)).toEqual([3,1]);expect(groups[0].rows.map(r=>r.confidence.tone)).toEqual(['low','medium','high']);expect(inv.parts[red.partId].boxes).toHaveLength(3);
 });
 it('keeps exact printed molds, catalog colors and unidentified descriptions separate',()=>{
  const inv={...emptyInventory(),others:[other('3004pr0001'),other('3004pr0001'),other('3004'),other('3004pr0001','blue'),other(),other()]};
  expect(pieceReviewGroups(pieceReviewRows(inv)).map(g=>g.quantity)).toEqual([2,1,1,1,1]);
 });
 it('confirms all selected copies, preserving individual scores and real manual locks',()=>{
  const inv=pile(),selected=pieceReviewRows(inv),next=applyPieceReviewGroup(inv,selected,{kind:red});
  expect(counts(next)).toEqual({[red.partId]:3});expect(next.parts[red.partId].confirmedCount).toBe(3);
  expect(pieceReviewRows(next).map(r=>r.confidence.score)).toEqual([.2,.75,.94]);
  for(const row of selected)expect(isObservationLocked(next,row.photo!,row.box!)).toBe(true);
  expect(inv.parts[red.partId].confirmedCount).toBe(0);
 });
 it('corrects a selected subset once, keeps the outlier unconfirmed and preserves total counts',()=>{
  const inv=pile(),selected=pieceReviewRows(inv).slice(0,2),next=applyPieceReviewGroup(inv,selected,{kind:blue});
  expect(proposedCounts(next)).toEqual({[red.partId]:1,[blue.partId]:2});expect(next.parts[red.partId].confirmedCount).toBe(0);expect(pieceReviewRows(next).filter(r=>r.partId===blue.partId).every(r=>r.confidence.score===null)).toBe(true);
 });
 it('does not confirm same-prediction pieces arriving after the group was opened',()=>{
  const inv=pile(),selected=pieceReviewRows(inv),arrived=addPart(inv,red,1,crop(4),.2),next=applyPieceReviewGroup(arrived,selected,{kind:red});
  expect(proposedCounts(next)).toEqual({[red.partId]:4});expect(counts(next)).toEqual({[red.partId]:3});expect(next.parts[red.partId].boxes.find(b=>b===arrived.parts[red.partId].boxes[3])?.confirmed).toBe(false);
 });
 it('rejects the entire stale group after independent correction, including duplicate legacy outlines',()=>{
  let inv=pile();inv=addPart(inv,red,1,crop(0),.2);const selected=pieceReviewRows(inv);
  const changed=editPiece(inv,selected[0].box!,1,{kind:blue},red.partId,false,selected[0].observation);
  expect(applyPieceReviewGroup(changed,selected,{kind:red})).toBe(changed);expect(changed.parts[blue.partId].count).toBe(1);
 });
 it('rejects removed members, duplicate selection, mixed identities and stale count edits',()=>{
  const inv=pile(),rows=pieceReviewRows(inv),removed=editPiece(inv,rows[0].box!,1,{remove:true},red.partId,false,rows[0].observation);
  expect(applyPieceReviewGroup(removed,rows,{kind:blue})).toBe(removed);
  expect(applyPieceReviewGroup(inv,[rows[0],rows[0]],{kind:blue})).toBe(inv);
  const mixed=addPart(inv,blue,1,crop(4),.2);expect(applyPieceReviewGroup(mixed,pieceReviewRows(mixed),{kind:red})).toBe(mixed);
  const unboxed=addPart(emptyInventory(),red,5,undefined,.2,undefined,false),snapshot=pieceReviewRows(unboxed),adjusted=setCount(unboxed,red.partId,4,false);
  expect(applyPieceReviewGroup(adjusted,snapshot,{kind:blue})).toBe(adjusted);
 });
 it('handles mixed photographed and count-only copies without fabricating crops or losing quantities',()=>{
  const inv=addPart(pile(),red,5,undefined,.2,undefined,false),next=applyPieceReviewGroup(inv,pieceReviewRows(inv),{kind:blue});
  expect(counts(next)).toEqual({[blue.partId]:8});expect(next.parts[blue.partId].boxes).toHaveLength(3);expect(proposedCounts(inv)).toEqual({[red.partId]:8});
  expect(counts(readInventorySnapshot({inventory:next,stock:counts(next),observedStock:proposedCounts(next)}))).toEqual(counts(next));
 });
 it('identifies exact special molds as a batch without granting builder geometry',()=>{
  const inv=pile(),catalog={num:'3004pr0001',name:'Printed eyes brick',color:'red'},next=applyPieceReviewGroup(inv,pieceReviewRows(inv),{name:catalog.name,catalog});
  expect(next.others).toHaveLength(3);expect(counts(next)).toEqual({});expect(next.others.every(o=>o.confirmed&&o.catalog?.num===catalog.num)).toBe(true);
  const rows=pieceReviewRows(next),revised=applyPieceReviewGroup(next,rows,{kind:blue});expect(counts(revised)).toEqual({[blue.partId]:3});
  const newer=reviewOtherPiece(next,next.others[0],{remove:true});expect(applyPieceReviewGroup(newer,rows,{kind:red})).toBe(newer);
 });
 it('removes only selected copies and keeps the other physical observations',()=>{
  const inv=pile(),rows=pieceReviewRows(inv),next=applyPieceReviewGroup(inv,rows.slice(1),{remove:true});
  expect(proposedCounts(next)).toEqual({[red.partId]:1});expect(next.parts[red.partId].boxes).toEqual([rows[0].observation]);
 });
 it('shows one group card with separate scores and explicit selection controls in the editor',()=>{
  const rows=pieceReviewRows(pile()),noop=()=>{},html=renderToStaticMarkup(createElement(ConfidenceReview,{rows,onReview:noop,onReviewAll:noop,onReviewGroup:noop}));
  expect(html.match(/class="confidence-card /g)).toHaveLength(1);expect(html).toContain('Review 3 matching pieces');expect(html).toContain('1 low confidence');expect(html).toContain('1 high confidence');
  const dialog=renderToStaticMarkup(createElement(PieceEditor,{current:{kind:red,description:'Brick',color:'red'},onApply:noop,onClose:noop,quantity:3,copies:rows.map(row=>({row})),onReviewCopy:noop}));
  expect(dialog).toContain('Apply match to 3 pieces');expect(dialog).toContain('Review separately');expect(dialog.match(/type="checkbox"/g)).toHaveLength(3);
 });
 it('leaves previously checked copies unselected in a mixed batch',()=>{
  const inv=pile(),first=pieceReviewRows(inv)[0],next=editPiece(inv,first.box!,1,{kind:red},red.partId,false,first.observation),rows=pieceReviewRows(next),noop=()=>{};
  const html=renderToStaticMarkup(createElement(PieceEditor,{current:{kind:red,description:'Brick',color:'red'},onApply:noop,onClose:noop,quantity:3,copies:rows.map(row=>({row}))}));
  expect(html).toContain('Apply match to 2 pieces');expect(html).toContain('1 already checked');
 });
});
