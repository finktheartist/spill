import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parsePartId,type Build,type Placed} from './bricks';
import {nativeKindForCatalog,partInfo,shoppingList} from './catalog';
import {addPart,confirmedCatalogKind,counts,editPiece,emptyInventory,needsReviewCount,observationKey,proposedCounts,reviewPartType,type OtherEntry} from './inventory';
import {inventoryForRestoredRun,readInventorySnapshot} from './inventory-snapshot';
import {pieceReviewRows} from './piece-review';
import {applyPieceReviewGroup} from './piece-review-groups';
import {checkFeatures} from './identify';
import {scanKindIssue} from './gemini';
import {catalogContract} from './whole-model-catalog';
import {createBench,editBench,finishBench} from './whole-model-workbench';
import {constructionIssues} from './construction';
import {planBuildInstructions} from './instruction-order';
import {inspectSpecialParts} from './assembly-composer/special-parts';
import {ConfidenceReview} from '../components/ConfidenceReview';
import {PieceEditor} from '../components/PieceEditor';
vi.mock('./render',async original=>({...await original<typeof import('./render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const molds=[['92593','endstudplate-1x4-azure'],['33909','edgeplate-2x2-reddish-brown'],['67095','roundtile-3x3-dark-blue'],['27925','quartertile-2x2-blue']] as const;
const other=(num='92593',color='azure',confirmed=true):OtherEntry=>({description:'preserved special part',color,catalog:{num,name:`Exact ${num}`,color},boxes:[{photo:1,box:[0,0,50,100]}],confirmed,confidence:.2,modelConfidence:.2,confidenceSource:'model'});
const p=(partId:string,x=0,y=0,z=0):Placed=>({partId,x,y,z,rot:0});
const demo=()=>[p('plate-6x8-white'),p(molds[0][1],0,0,1),p('tile-1x1-red',0,0,2),p('tile-1x1-red',3,0,2),p(molds[1][1],4,0,1),p('tile-1x1-red',4,1,2),p('plate-1x1-white',0,3,1),p(molds[3][1],0,3,2),p('plate-1x1-white',6,4,1),p(molds[2][1],5,3,2)];
const stockOf=(ps:Placed[])=>ps.reduce<Record<string,number>>((s,p)=>(s[p.partId]=(s[p.partId]??0)+1,s),{});

describe('qualified special molds through inventory and normal build route',()=>{
 it('maps only exact native molds and manufactured colors',()=>{
  for(const [num,id]of molds){expect(nativeKindForCatalog(num,parsePartId(id)!.color)?.partId).toBe(id);expect(partInfo(id)?.number).toBe(num);}
  for(const num of ['41740','92593pr0001','92593x',' 92593','4599498'])expect(nativeKindForCatalog(num,'azure')).toBeNull();
  expect(nativeKindForCatalog('67095','trans-clear')).toBeNull();expect(nativeKindForCatalog('67095','Dark Blue')).toBeNull();
 });
 it('counts each confirmed exact catalog observation once and preserves its identity and evidence',()=>{
  const inv={...emptyInventory(),others:molds.map(([num,id])=>other(num,parsePartId(id)!.color))},before=structuredClone(inv);
  expect(counts(inv)).toEqual(Object.fromEntries(molds.map(([,id])=>[id,1])));expect(counts(inv)).toEqual(counts(inv));expect(inv).toEqual(before);
  expect(pieceReviewRows(inv).every(r=>r.other&&r.confidence.score===.2&&r.confirmedCount===1)).toBe(true);
 });
 it('does not promote uncertain, unidentified, wrong-color or variant records',()=>{
  const good=other();
  for(const o of [{...good,confirmed:false},{...good,unknown:true},{...good,color:'blue'},{...good,catalog:{...good.catalog!,num:'41740'}},{...good,catalog:undefined}])expect(confirmedCatalogKind(o)).toBeNull();
  expect(counts({...emptyInventory(),others:[other('92593','azure',false)]})).toEqual({});
 });
 it('requires human confirmation for newly supported native readings as well as catalog-only readings',()=>{
  for(const [,id]of molds){
   const k=parsePartId(id)!,inv=addPart(emptyInventory(),k,1,{photo:1,box:[0,0,50,100]},.99,undefined,false);
   expect(counts(inv)).toEqual({});expect(scanKindIssue(k)).toMatch(/human confirmation/);expect(checkFeatures(k.type,k.w,k.d,{})).toHaveProperty('other');
   expect(counts(addPart(inv,k,1))).toEqual({[id]:1});
  }
 });
 it('roundtrips existing human matches and locks without duplicating derived stock',()=>{
  const o=other(),inv=addPart({...emptyInventory(),others:[o],manualLocks:[observationKey(1,o.boxes[0].box)]},parsePartId(molds[0][1])!,2);
  const restored=readInventorySnapshot({stock:counts(inv),observedStock:proposedCounts(inv),inventory:inv});
  expect(counts(restored)).toEqual({[molds[0][1]]:3});expect(restored.manualLocks).toEqual(inv.manualLocks);expect(restored.others[0]).toMatchObject(o);
  expect(counts(readInventorySnapshot({stock:counts(inv)}))).toEqual({});
 });
 it('restores different catalog stock while preserving newer reviews of the same exact identities',()=>{
  const current={...emptyInventory(),others:[other()]},different={...emptyInventory(),others:[other('33909','reddish-brown')]};
  expect(inventoryForRestoredRun(current,different)).toBe(different);
  const oldSame={...current,others:[{...other(),confirmed:false,modelConfidence:.99}]};
  expect(inventoryForRestoredRun(current,oldSame)).toBe(current);
  const duplicate={...current,others:[other(),other()]};expect(inventoryForRestoredRun(current,duplicate)).toBe(duplicate);
 });
 it('reviews high-confidence old native guesses without losing their crop or score',()=>{
  const k=parsePartId(molds[0][1])!,box:[number,number,number,number]=[0,0,50,100];
  const inv=addPart(emptyInventory(),k,1,{photo:1,box},.99,undefined,false),e=inv.parts[k.partId];
  expect(needsReviewCount(e)).toBe(1);
  const next=editPiece(inv,box,1,{kind:k},k.partId,true,e.boxes[0]);
  expect(counts(next)).toEqual({[k.partId]:1});expect(pieceReviewRows(next)[0].confidence.score).toBe(.99);expect(next.parts[k.partId].boxes[0].box).toEqual(box);
  const grouped=reviewPartType(inv,k.partId,{kind:k},true,e);
  expect(counts(grouped)).toEqual({[k.partId]:1});expect(grouped.parts[k.partId].boxes[0].box).toEqual(box);
 });
 it('group correction converts selected catalog observations without double billing',()=>{
  const inv={...emptyInventory(),others:[other(),{...other(),boxes:[{photo:1,box:[100,0,150,100] as [number,number,number,number]}]}]};
  const rows=pieceReviewRows(inv),next=applyPieceReviewGroup(inv,rows,{kind:parsePartId(molds[0][1])!});
  expect(counts(inv)).toEqual({[molds[0][1]]:2});expect(next.others).toHaveLength(0);expect(counts(next)).toEqual(counts(inv));expect(next.parts[molds[0][1]].confirmedCount).toBe(2);
 });
 it('exposes real ports, profiles and shaping roles to the normal planner',()=>{
  const stock=Object.fromEntries(molds.map(([,id])=>[id,1])),text=catalogContract(stock),capabilities=inspectSpecialParts(stock);
  for(const [,id]of molds)expect(text).toContain(id.replace(/-(azure|reddish-brown|dark-blue|blue)$/,''));
  expect(text).toContain('convex body sections');expect(capabilities.every(c=>c.status==='usable')).toBe(true);
  expect(capabilities.find(c=>c.type==='endstudplate')?.connectorConstraints.join(' ')).toMatch(/two ends/);
  expect(capabilities.find(c=>c.type==='quartertile')?.ports.filter(p=>p.kind==='grip')).toHaveLength(2);
 });
 it('commits all four molds using exact stock and orders foundations before details',()=>{
  const parts=demo(),stock=stockOf(parts),first=editBench(createBench(stock),{remove:[],add:parts.slice(0,8)});
  expect(first.issues).toEqual([]);const result=editBench(first.state,{remove:[],add:parts.slice(8)});
  expect(result.issues).toEqual([]);expect(result.accepted).toBe(true);expect(finishBench(result.state).accepted).toBe(true);
  const b:Build={engine:'connections-v2',name:'Connector demonstration',description:'Controlled geometry, not a generated subject.',steps:parts.slice().reverse().map(part=>({caption:'Input',parts:[part]}))};
  const ordered=planBuildInstructions(b).build;
  expect(ordered.steps[0].parts[0].partId).toBe('plate-6x8-white');expect(constructionIssues(ordered,stock,24)).toEqual([]);
  expect(shoppingList(ordered,stock).getCount).toBe(0);
  const scarce={...stock,[molds[0][1]]:0};expect(constructionIssues(ordered,scarce,24).length).toBeGreaterThan(0);
 });
 it('labels a supported saved catalog match honestly in the review',()=>{
  const rows=pieceReviewRows({...emptyInventory(),others:[other()]});
  const html=renderToStaticMarkup(createElement(ConfidenceReview,{rows,onReview:()=>{},onReviewAll:()=>{}}));
  expect(html).toContain('Available in builds');expect(html).not.toContain('not yet supported in builds');expect(html).toContain('#92593');
  const mixed=renderToStaticMarkup(createElement(ConfidenceReview,{rows:pieceReviewRows({...emptyInventory(),others:[other(),other('92593','azure',false)]}),onReview:()=>{},onReviewAll:()=>{}}));
  expect(mixed).toContain('1 of 2 available in builds');
  const editor=renderToStaticMarkup(createElement(PieceEditor,{current:{description:'Exact92593',color:'azure',catalog:other().catalog},onApply:()=>{},onClose:()=>{}}));
  expect(editor).toContain('Confirming this exact match makes the selected copies available');expect(editor).not.toContain('kept out of builds until its exact connections are supported');
 });
});
