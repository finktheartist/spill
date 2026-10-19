import {describe,expect,it} from 'vitest';
import {CATALOG,COLOR_NAMES,parsePartId,type Build,type Placed} from './bricks';
import {connectionPairs,definition,frame} from './connections';
import {attachmentMap,constructionIssues} from './construction';
import photo from '../../test/fixtures/photo-stock.json';
import {catalogContract,wholeModelCatalog} from './whole-model-catalog';
import {
 createBench,inspectBench,editBench,finishWithPolicy,
 type BenchEdit,type BenchState,type CompletionPolicy,
} from './whole-model-workbench';

const p=(partId:string,z=0,x=0,y=0,rot=0):Placed=>({partId,x,y,z,rot});
const flat=(build:Build)=>build.steps.flatMap(step=>step.parts);
const poseKeys=(parts:Placed[])=>parts.map(({partId,x,y,z,rot})=>JSON.stringify([partId,x,y,z,rot])).sort();
const smallStock={'plate-1x2-tan':1,'brick-1x1-tan':2,'tile-1x1-tan':1};
function pair():BenchState {
 const result=editBench(createBench(smallStock),{remove:[],add:[p('plate-1x2-tan'),p('brick-1x1-tan',1)]});
 expect(result.accepted,result.issues.join('\n')).toBe(true);
 return result.state;
}
function addBatches(state:BenchState,parts:Placed[]):BenchState {
 for(let i=0;i<parts.length;i+=8){
  const result=editBench(state,{remove:[],add:parts.slice(i,i+8)});
  expect(result.accepted,result.issues.join('\n')).toBe(true);
  state=result.state;
 }
 return state;
}
function tiledBody(bricks:number,base='plate-8x8-blue'):Placed[] {
 return [p(base),...Array.from({length:bricks},(_,i)=>p('brick-1x1-tan',1+3*Math.floor(i/64),i%8,Math.floor((i%64)/8)))];
}

describe('exact stock and bounded model are independent',()=>{
 it('clones and freezes the full ledger; an empty bench has no ready model',()=>{
  const stock={...smallStock},state=createBench(stock),view=inspectBench(state);
  expect(state).toEqual({stock:smallStock,revision:0,nextId:1,pieces:[]});
  stock['brick-1x1-tan']=99;
  expect(state.stock).toEqual(smallStock);expect(Object.isFrozen(state.stock)).toBe(true);
  expect(()=>{state.stock['brick-1x1-tan']=99;}).toThrow();
  view.remaining['brick-1x1-tan']=77;
  expect(inspectBench(state)).toMatchObject({remaining:smallStock,total:0,complete:false,build:null,attachments:'',issues:[]});
  expect(finishWithPolicy(state).accepted).toBe(false);
 });

 it('accepts 408/2000 available pieces without requiring them all in a model',()=>{
  for(const n of [252,408,2000])expect(createBench({'brick-1x1-tan':n}).stock).toEqual({'brick-1x1-tan':n});
  const state=addBatches(createBench({'plate-8x8-blue':1,'brick-1x1-tan':1999}),tiledBody(19));
  const result=finishWithPolicy(state);
  expect(result.accepted).toBe(true);expect(result.inspection.total).toBe(20);
  expect(result.inspection.complete).toBe(false);
  expect(result.inspection.remaining).toEqual({'brick-1x1-tan':1980});
  expect(finishWithPolicy(state,{mode:'exact',minParts:20}).accepted).toBe(false);
 });

 it('rejects malformed counts, more than 2000 total and more than 500 exact IDs',()=>{
  const invalid:Record<string,number>[]=[{},{'brick-1x1-tan':0},{'brick-1x1-tan':-1},{'brick-1x1-tan':.5},{'brick-1x1-tan':NaN},{'brick-1x1-tan':Infinity},{'brick-1x1-tan':2001},{'brick-1x1-tan':2000,'plate-1x1-blue':1}];
  for(const stock of invalid)expect(()=>createBench(stock)).toThrow();
  const ids=(['brick','plate'] as const).flatMap(type=>CATALOG[type].flatMap(size=>COLOR_NAMES.map(color=>`${type}-${size}-${color}`)));
  expect(ids.length).toBeGreaterThan(500);
  expect(Object.keys(createBench(Object.fromEntries(ids.slice(0,500).map(id=>[id,1]))).stock)).toHaveLength(500);
  expect(()=>createBench(Object.fromEntries(ids.slice(0,501).map(id=>[id,1])))).toThrow();
 });

 it('never aliases unsupported photo shapes or QA-only molds',()=>{
  const unsupported=['plate-16x16-bright-green','plate-3x8-tan','tile-2x5-tan','cone-2x2-dark-gray','profilebrick-1x2-tan','panel-1x2-tan','wheel-1x1-black','brick-01x01-tan','brick-1x1-constructor'];
  for(const id of unsupported){expect(()=>createBench({[id]:1})).toThrow();expect(()=>catalogContract({[id]:1})).toThrow();}
  expect(()=>createBench(photo.stock)).toThrow();
  // Explicit test-only exclusion receipt; no production filter or alias is hidden.
  const excluded:string[]=[],supported:Record<string,number>={};
  for(const [id,n] of Object.entries(photo.stock)){
   try{const kind=parsePartId(id);if(!kind)throw Error('unknown');definition(kind);supported[id]=n;}
   catch{excluded.push(id);}
  }
  expect(excluded.sort()).toEqual(['plate-16x16-bright-green']);
  expect(Object.values(supported).reduce((a,b)=>a+b,0)).toBe(251);
  expect(createBench(supported).stock).toEqual(supported);
 });

 it('limits the actual model to 80 parts even with 2000 available',()=>{
  const state=addBatches(createBench({'plate-8x8-blue':1,'brick-1x1-tan':1999}),tiledBody(79));
  expect(finishWithPolicy(state).accepted).toBe(true);
  const before=JSON.stringify(state),extra=editBench(state,{remove:[],add:[p('brick-1x1-tan',4,7,1)]});
  expect(extra.accepted).toBe(false);expect(extra.issues.join()).toContain('80 pieces');
  expect(extra.state).toEqual(state);expect(JSON.stringify(state)).toBe(before);
  expect(extra.state.nextId).toBe(81);expect(extra.inspection.total).toBe(80);
 },15000);
});

describe('native geometry and literal editable poses',()=>{
 it('orders by actual mating contacts, preserving poses, stable IDs and real bounds',()=>{
  const add=[p('brick-1x1-tan',1,3,2),p('plate-1x2-tan',0,3,2)],result=editBench(createBench(smallStock),{remove:[],add});
  expect(result.accepted,result.issues.join()).toBe(true);
  expect(result.state.pieces.map(p=>p.id)).toEqual(['p1','p2']);
  expect(result.inspection.partIndexToId).toEqual(['p2','p1']);
  expect(poseKeys(flat(result.candidate!))).toEqual(poseKeys(add));
  expect(result.inspection.bounds).toEqual({minLdu:[60,40,0],maxLdu:[100,60,32],sizeStuds:[2,1,1.6]});
  const ordered=flat(result.candidate!);
  expect(connectionPairs(frame(ordered[0]),frame(ordered[1]))).toContainEqual(['stud:0:0','grip:0:0']);
  expect(result.inspection.attachments).toBe(attachmentMap(result.candidate!));
  expect(constructionIssues(result.candidate!,smallStock,24)).toEqual([]);
 });

 it('requires the real centered half-stud jumper contact',()=>{
  const initial=editBench(createBench({'jumper-2x2-tan':1,'brick-1x1-tan':1}),{remove:[],add:[p('jumper-2x2-tan')]}).state;
  const wrong=editBench(initial,{remove:[],add:[p('brick-1x1-tan',1)]});
  expect(wrong.accepted).toBe(false);expect(wrong.state).toEqual(initial);expect(wrong.candidate).not.toBeNull();
  const right=editBench(initial,{remove:[],add:[p('brick-1x1-tan',1,.5,.5)]});
  expect(right.accepted).toBe(true);
  expect(connectionPairs(frame(flat(right.candidate!)[0]),frame(flat(right.candidate!)[1]))).toContainEqual(['stud:center','grip:0:0']);
 });

 it('uses the real stepped curved grip, rejecting a guessed flat-bottom contact',()=>{
  const initial=createBench({'plate-1x1-tan':1,'curve-1x2-red':1});
  const wrong=editBench(initial,{remove:[],add:[p('plate-1x1-tan',0,0,1),p('curve-1x2-red',1)]});
  expect(wrong.accepted).toBe(false);expect(wrong.candidate).not.toBeNull();expect(wrong.state).toEqual(initial);
  const right=editBench(initial,{remove:[],add:[p('plate-1x1-tan',0,0,1),p('curve-1x2-red')]});
  expect(right.accepted,right.issues.join()).toBe(true);
  expect(constructionIssues(right.candidate!,initial.stock,24)).toEqual([]);
 });

 it('checks real rotated bounds against 24 studs without moving a submitted pose',()=>{
  const initial=createBench({'plate-1x2-tan':1});
  const outside=editBench(initial,{remove:[],add:[p('plate-1x2-tan',0,23)]});
  expect(outside.accepted).toBe(false);expect(outside.issues.join()).toContain('24 stud');
  expect(flat(outside.candidate!)[0].x).toBe(23);
  const inside=editBench(initial,{remove:[],add:[p('plate-1x2-tan',0,23,0,90)]});
  expect(inside.accepted).toBe(true);expect(inside.inspection.bounds?.maxLdu[0]).toBe(480);
 });

 it('accepts exactly 24 studs of actual height, then rejects the next plate atomically',()=>{
  const state=addBatches(createBench({'plate-1x1-tan':80}),Array.from({length:60},(_,z)=>p('plate-1x1-tan',z)));
  expect(inspectBench(state).bounds?.sizeStuds).toEqual([1,1,24]);
  expect(finishWithPolicy(state).accepted).toBe(true);
  const before=JSON.stringify(state),tooTall=editBench(state,{remove:[],add:[p('plate-1x1-tan',60)]});
  expect(tooTall.accepted).toBe(false);expect(tooTall.issues.join()).toContain('z-axis solid span 488 LDU exceeds 24 studs');
  expect(tooTall.state).toEqual(state);expect(tooTall.state.nextId).toBe(61);
  expect(flat(tooTall.candidate!).at(-1)?.z).toBe(60);
  expect(JSON.stringify(state)).toBe(before);
 });

 it('rejects a contact-valid 80-plate tower through both completion policies after serialization',()=>{
  const stock={'plate-1x1-tan':80},pieces=Array.from({length:80},(_,z)=>({id:`p${z+1}`,...p('plate-1x1-tan',z)}));
  const state:BenchState=JSON.parse(JSON.stringify({stock,pieces,nextId:81,revision:1}));
  const physical:Build={name:'Tall stack',description:'Boundary regression only',engine:'connections-v2',steps:pieces.map(piece=>({caption:'Attach',parts:[piece]}))};
  expect(constructionIssues(physical,stock,24)).toEqual([]);
  expect(inspectBench(state).bounds?.sizeStuds[2]).toBe(32);
  for(const mode of ['subset','exact'] as const){
   const result=finishWithPolicy(state,{mode,minParts:20});
   expect(result.accepted).toBe(false);expect(result.issues.join()).toContain('z-axis solid span 640 LDU exceeds 24 studs');
  }
 });

 it('checks actual x/y spans at the boundary as well as the existing absolute footprint gate',()=>{
  for(const rot of [0,90]){
   const at=(id:string,z:number,distance:number)=>p(id,z,rot===0?distance:0,rot===90?distance:0,rot);
   const stock={'plate-1x12-tan':2,'plate-1x2-tan':2};
   const initial=editBench(createBench(stock),{remove:[],add:[at('plate-1x12-tan',0,0),at('plate-1x12-tan',1,11),at('plate-1x2-tan',2,22)]});
   expect(initial.accepted,initial.issues.join()).toBe(true);
   expect(initial.inspection.bounds?.sizeStuds[rot===0?0:1]).toBe(24);
   const beyond=editBench(initial.state,{remove:[],add:[at('plate-1x2-tan',3,23)]});
   expect(beyond.accepted).toBe(false);expect(beyond.issues.join()).toContain(`${rot===0?'x':'y'}-axis solid span 500 LDU exceeds 24 studs`);
   expect(beyond.state).toEqual(initial.state);
  }
 });

 it('replaces an early support and can reposition the entire body atomically',()=>{
  const initial=pair(),saved=JSON.stringify(initial);
  const missing=editBench(initial,{remove:['p1'],add:[]});
  expect(missing.accepted).toBe(false);expect(missing.state).toEqual(initial);
  expect(flat(missing.candidate!)[0].z).toBe(1);
  const revised=editBench(initial,{remove:['p1'],add:[p('plate-1x2-tan',0,0,0,90)]});
  expect(revised.accepted).toBe(true);expect(revised.state.pieces.map(p=>p.id)).toEqual(['p2','p3']);
  expect(revised.state.pieces[0]).toEqual(initial.pieces[1]);
  expect(revised.inspection.partIndexToId).toEqual(['p3','p2']);
  const moved=editBench(revised.state,{remove:['p2','p3'],add:revised.state.pieces.map(({partId,x,y,z,rot})=>({partId,x:x+5,y:y+4,z,rot}))});
  expect(moved.accepted).toBe(true);expect(moved.state.pieces.map(p=>p.id)).toEqual(['p4','p5']);
  expect(moved.inspection.bounds?.minLdu).toEqual([100,80,0]);
  expect(JSON.stringify(initial)).toBe(saved);
 });
});

describe('atomic rejection and completion policy',()=>{
 it('rolls back overspending without burning IDs and preserves interpretable rejected geometry',()=>{
  const initial=pair(),before=JSON.stringify(initial);
  const bad=editBench(initial,{remove:[],add:[p('brick-1x1-tan',1,1),p('brick-1x1-tan',4)]});
  expect(bad.accepted).toBe(false);expect(bad.issues.join()).toContain('bucket has 2');
  expect(flat(bad.candidate!)).toHaveLength(4);expect(bad.state).toEqual(initial);
  expect(bad.inspection.total).toBe(2);expect(JSON.stringify(initial)).toBe(before);
  const good=editBench(bad.state,{remove:[],add:[p('brick-1x1-tan',1,1)]});
  expect(good.accepted).toBe(true);expect(good.state.pieces.at(-1)?.id).toBe('p3');
 });

 it('rejects actual overlap, disconnected contact, nongrounding and unmatched studs',()=>{
  const cases=[
   [p('plate-1x2-tan'),p('brick-1x1-tan')],
   [p('plate-1x2-tan'),p('brick-1x1-tan',0,3)],
   [p('plate-1x2-tan',1)],
   [p('plate-1x2-tan'),p('brick-1x1-tan',1,.5)],
  ];
  for(const add of cases){const initial=createBench(smallStock),bad=editBench(initial,{remove:[],add});expect(bad.accepted).toBe(false);expect(bad.issues.length).toBeGreaterThan(0);expect(bad.candidate).not.toBeNull();expect(bad.state).toEqual(initial);}
 });

 it('rejects malformed poses, invented IDs, state/stock injection, noops and duplicate removals',()=>{
  const initial=pair();
  const invalid:unknown[]=[
   {remove:[],add:[]},{remove:['p1'],add:[p('plate-1x2-tan')]},{remove:['p999'],add:[]},{remove:['p1','p1'],add:[]},
   {remove:[],add:[{...p('brick-1x1-tan',4),id:'p99'}]},{remove:[],add:[p('brick-1x1-tan',4)],stock:{'brick-1x1-tan':999}},
   ...[{x:.25},{y:.25},{z:.5},{x:NaN},{z:Infinity},{rot:45},{orientation:[1,0,0,0,1,0,0,0,1]},{partId:'brick-01x01-tan'},{partId:'brick-1x1-constructor'},{x:1001}].map(extra=>({remove:[],add:[{...p('brick-1x1-tan',4),...extra}]})),null,
  ];
  for(const edit of invalid){const bad=editBench(initial,edit as BenchEdit);expect(bad.accepted).toBe(false);expect(bad.state).toEqual(initial);expect(bad.state.nextId).toBe(3);}
 });

 it('keeps the eight-part transaction cap and renders a safe nine-part rejection',()=>{
  const initial=createBench({'plate-1x1-tan':10}),add=Array.from({length:9},(_,i)=>p('plate-1x1-tan',i));
  const bad=editBench(initial,{remove:[],add});
  expect(bad.accepted).toBe(false);expect(bad.issues.join()).toContain('at most8');
  expect(flat(bad.candidate!)).toHaveLength(9);expect(bad.state).toEqual(initial);
  const committed=addBatches(initial,add),tooManyRemoved=editBench(committed,{remove:committed.pieces.map(p=>p.id),add:[]});
  expect(tooManyRemoved.accepted).toBe(false);expect(tooManyRemoved.state).toEqual(committed);
 });

 it('permits dismantling to empty, refunds stock and never reuses retired IDs',()=>{
  const initial=pair(),reset=editBench(initial,{remove:['p1','p2'],add:[]});
  expect(reset.accepted).toBe(true);expect(reset.state).toMatchObject({pieces:[],nextId:3,revision:2});
  expect(reset.inspection.remaining).toEqual(smallStock);expect(reset.candidate).toBeNull();
  expect(finishWithPolicy(reset.state,{mode:'subset',minParts:1}).accepted).toBe(false);
  const rebuilt=editBench(reset.state,{remove:[],add:[p('plate-1x2-tan')]});
  expect(rebuilt.accepted).toBe(true);expect(rebuilt.state.pieces[0].id).toBe('p3');
 });

 it('enforces the explicit subset/exact minimum and rejects malformed policies',()=>{
  const state=pair();
  expect(finishWithPolicy(state).accepted).toBe(false);
  expect(finishWithPolicy(state,{mode:'subset',minParts:2}).accepted).toBe(true);
  expect(finishWithPolicy(state,{mode:'exact',minParts:2}).accepted).toBe(false);
  const exact=editBench(createBench({'brick-1x1-tan':1}),{remove:[],add:[p('brick-1x1-tan')]}).state;
  expect(finishWithPolicy(exact,{mode:'exact',minParts:1}).accepted).toBe(true);
  for(const mode of ['exact','subset'] as const)expect(finishWithPolicy(exact,{mode,minParts:2}).accepted).toBe(false);
  for(const policy of [null,{},[],{mode:'other',minParts:2},{mode:'subset',minParts:0},{mode:'subset',minParts:81},{mode:'subset',minParts:1.5},{mode:'subset',minParts:2,ignorePhysics:true}])expect(finishWithPolicy(state,policy as CompletionPolicy).accepted).toBe(false);
 });

 it('rechecks geometry and stock on a serialized/tampered state before finish',()=>{
  const invalid:BenchState[]=[];
  const overlap=structuredClone(pair());overlap.pieces[1].z=0;invalid.push(overlap);
  const floating=structuredClone(pair());floating.pieces.forEach(p=>p.z++);invalid.push(floating);
  const disconnected=structuredClone(pair());disconnected.pieces[1].x=4;disconnected.pieces[1].z=0;invalid.push(disconnected);
  const overspent=structuredClone(pair());overspent.pieces.push({id:'p3',...p('brick-1x1-tan',1,1)},{id:'p4',...p('brick-1x1-tan',4)});overspent.nextId=5;invalid.push(overspent);
  for(const state of invalid){const before=JSON.stringify(state),result=finishWithPolicy(state,{mode:'subset',minParts:2});expect(result.accepted).toBe(false);expect(result.issues.length).toBeGreaterThan(0);expect(JSON.stringify(state)).toBe(before);}
 });

 it('keeps caller input, candidate, inspection and returned state independent',()=>{
  const initial=createBench(smallStock),edit={remove:[],add:[p('plate-1x2-tan')]},before=JSON.stringify({initial,edit});
  const result=editBench(initial,edit),committed=JSON.stringify(result.state);
  result.candidate!.steps[0].parts[0].x=99;result.inspection.build!.steps[0].parts[0].y=99;
  result.inspection.remaining['brick-1x1-tan']=77;
  expect(JSON.stringify(result.state)).toBe(committed);expect(JSON.stringify({initial,edit})).toBe(before);
  const final=finishWithPolicy(pair(),{mode:'subset',minParts:2});
  final.candidate!.steps[0].parts[0].x=88;final.state.pieces[0].y=77;
  expect(final.inspection.build!.steps[0].parts[0].x).toBe(0);
  expect(Object.isFrozen(final.state.stock)).toBe(true);
 });
});

it('describes only the stock/native ports and exact curved height, with no reference-specific mold promises',()=>{
 const stock={'jumper-2x2-tan':1,'curve-1x3-red':2},contract=catalogContract(stock);
 expect(wholeModelCatalog(stock)).toBe(contract);
 expect(contract).toContain('jumper-2x2-tan × 1');expect(contract).toContain('curve-1x3-red × 2');
 expect(contract).toContain('stud:center (stud, at 20,20,8');
 expect(contract).toContain('curve-1x3: height 3 plates');
 expect(contract).toContain('grip:0:2 (grip, at 10,50,8');
 expect(contract).toContain('convex body sections');
 for(const invented of ['2877','18971','3942','profilebrick','panel18971','2x2x2cone'])expect(contract).not.toContain(invented);
});
