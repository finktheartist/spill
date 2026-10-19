import {describe,expect,it} from 'vitest';
import {createBench,editBench,finishWithPolicy,inspectBench,type BenchState} from '../whole-model-workbench';
import type {Placed} from '../bricks';
import type {RankedIdea} from './pipeline';
import {readCriticalReview} from './whole-model-review';
import {checkpointFromRun,validateCheckpoint,type WholeModelCheckpoint} from './whole-model-checkpoint';

const id='plate-1x1-black',white='plate-1x1-white',unsupported='panel-9x9-black';
const originalStock={[id]:252,[white]:1,[unsupported]:2};
const supported={[id]:252,[white]:1};
const idea:RankedIdea={name:'Caravel',pitch:'A compact sailing ship.',why:'A useful stock opportunity, not a recipe.',length:12,width:6,height:8,palette:[{role:'hull',color:'black',cells:20}],cells:20,worst:.5,shortfall:0,discovery:{family:'vehicles',concept:'sailing ship',form:'broad hull and high sails'}};
const p=(z:number,partId=id):Placed=>({partId,x:0,y:0,z,rot:0});
const action=(action:'edit'|'inspect'|'finish',add:Placed[]=[],remove:string[]=[])=>({action,observation:'Inspect the actual geometry.',plan:'Continue literal construction.',remove,add});
type Action=ReturnType<typeof action>;
interface Debug {label:string;data:Record<string,unknown>}
function fixture(rawStock:Record<string,number>=originalStock,nativeStock:Record<string,number>=supported){
 let state=createBench(nativeStock),index=0;
 const debug:Debug[]=[{label:'wholeModelStart',data:{subject:idea.name,stock:{...nativeStock},excluded:Object.entries(rawStock).filter(([k,n])=>n&&!Object.hasOwn(nativeStock,k)).map(([k,n])=>`${k} × ${n}`),minParts:20,maxDecisions:18,maxMillis:45*60*1000,initialState:'empty'}}];
 const run={stock:{...rawStock},shapeRuns:{pile:{slots:[{key:'caravel',idea:structuredClone(idea),phase:'failed',error:'HTTP 429'}]}},debug};
 const append=(a:Action)=>{
  const beforeRevision=state.revision;
  const result=a.action==='edit'?editBench(state,{remove:a.remove,add:a.add}):a.action==='finish'?finishWithPolicy(state):{accepted:true,state,issues:[],inspection:inspectBench(state)};
  state=structuredClone(result.state);const v=result.inspection;
  debug.push({label:'wholeModelDecision',data:{subject:idea.name,index:++index,action:structuredClone(a),accepted:result.accepted,issues:result.issues,beforeRevision,state:structuredClone(state),inspection:{used:v.used,remaining:v.remaining,total:v.total},hops:[{continuationToken:'DO NOT COPY NATIVE TOKENS'}]}});
  return result;
 };
 const addReview=(pass=false)=>{
  const form={observation:'Visible form in actual renders.',blocking:false,fix:'No critical correction needed'};
  const review=readCriticalReview({features:[{role:'hull',...form},{role:'sails',...form,blocking:!pass,fix:pass?form.fix:'Rework the sail outline.'}],massing:form,support:form});
  debug.push({label:'wholeModelCriticalReview',data:{subject:idea.name,review,revision:state.revision}});return review;
 };
 return {run,append,addReview,get state(){return structuredClone(state);}};
}
function twenty(){const f=fixture();for(const [from,n]of [[0,8],[8,8],[16,4]])expect(f.append(action('edit',Array.from({length:n},(_,i)=>p(from+i)))).accepted).toBe(true);return f;}
const checkpoint=(f:ReturnType<typeof fixture>)=>checkpointFromRun(f.run,idea.name);

describe('verified physical checkpoints without native reasoning',()=>{
 it('recovers all 64 committed pieces after a later HTTP failure, using the original pile slot identity',()=>{
  const stock={'plate-8x8-blue':1,'brick-1x1-tan':251,[unsupported]:2},native={'plate-8x8-blue':1,'brick-1x1-tan':251},f=fixture(stock,native);
  const parts:Placed[]=[{partId:'plate-8x8-blue',x:0,y:0,z:0,rot:0},...Array.from({length:63},(_,i)=>({partId:'brick-1x1-tan',x:i%8,y:Math.floor(i/8),z:1,rot:0}))];
  for(let i=0;i<parts.length;i+=8)expect(f.append(action('edit',parts.slice(i,i+8))).accepted).toBe(true);
  f.run.debug.push({label:'providerFailure',data:{subject:idea.name,error:'HTTP 429',contents:[{thought:true,thoughtSignature:'PRIVATE'}]}});
  const c=checkpoint(f);
  expect(c.state).toEqual(f.state);expect(c.state.pieces).toHaveLength(64);expect(c.decisions).toBe(8);expect(c.stock).toEqual(stock);expect(c.idea).toEqual(idea);
  expect(c.review).toBeUndefined();expect(inspectBench(c.state).issues).toEqual([]);
 });

 it('recovers a safely empty checkpoint only when a valid original start and matching slot exist',()=>{
  const c=checkpoint(fixture());expect(c).toMatchObject({decisions:0,revisions:0,reviews:0,state:{revision:0,nextId:1,pieces:[]}});
  expect(inspectBench(c.state)).toMatchObject({build:null,total:0,complete:false,issues:[]});
 });

 it('replays rejected collisions and inspection decisions without spending stock or IDs',()=>{
  const f=fixture();f.append(action('edit',[p(0),p(1)]));const retained=f.state;
  expect(f.append(action('edit',[p(0)])).accepted).toBe(false);f.append(action('inspect'));
  const c=checkpoint(f);expect(c.state).toEqual(retained);expect(c).toMatchObject({decisions:3,revisions:0,reviews:0});
 });

 it('can recover a malformed-action rejection only with the exact unchanged accepted state',()=>{
  const f=fixture(),inspection=inspectBench(f.state);
  f.run.debug.push({label:'wholeModelDecision',data:{subject:idea.name,index:1,accepted:false,issues:['Expected one workbench action.'],beforeRevision:0,state:f.state,inspection:{used:inspection.used,remaining:inspection.remaining,total:inspection.total}}});
  expect(checkpoint(f)).toMatchObject({decisions:1,state:{pieces:[],revision:0,nextId:1}});
  f.run.debug[1].data.accepted=true;expect(()=>checkpoint(f)).toThrow('kernel replay');
 });

 it('retains literal early-piece replacement and monotonic stable IDs, not instruction-order IDs',()=>{
  const f=twenty();expect(f.append(action('edit',[p(0,white)],['p1'])).accepted).toBe(true);
  const c=checkpoint(f);expect(c.revisions).toBe(1);expect(c.state.nextId).toBe(22);expect(c.state.pieces[0].id).toBe('p2');expect(c.state.pieces.at(-1)).toEqual({id:'p21',...p(0,white)});
  expect(inspectBench(c.state).partIndexToId[0]).toBe('p21');
 });

 it('retains a failed critical review only for its exact digitally finishable geometry',()=>{
  const f=twenty();expect(f.append(action('finish')).accepted).toBe(true);const review=f.addReview();
  expect(checkpoint(f)).toMatchObject({decisions:4,reviews:1,review,reviewRevision:3});expect(checkpoint(f).review?.pass).toBe(false);
 });

 it('drops obsolete visual evidence after a real repair while preserving the number of prior reviews',()=>{
  const f=twenty();f.append(action('finish'));f.addReview();f.append(action('edit',[p(19,white)],['p20']));
  const c=checkpoint(f);expect(c).toMatchObject({decisions:5,revisions:1,reviews:1});expect(c).not.toHaveProperty('review');expect(c).not.toHaveProperty('reviewRevision');
 });

 it('rejects wrong current inventory, including excluded parts and colors, and checks the original exclusion receipt',()=>{
  const f=fixture(),c=checkpoint(f);
  for(const changed of [{...originalStock,[id]:251},{...originalStock,[unsupported]:1},{[id]:252,[white]:1},{...originalStock,'plate-1x1-red':1}])expect(()=>validateCheckpoint(c,changed)).toThrow('raw inventory');
  f.run.stock[unsupported]=1;expect(()=>checkpoint(f)).toThrow('unsupported-stock receipt');
 });

 it('rejects supported ledgers that diverge from raw canonical qualification without aliasing missing molds',()=>{
  const c=checkpoint(fixture());
  for(const stateStock of [{...supported,[id]:251},{...supported,[unsupported]:2},{'brick-01x01-black':253}])expect(()=>validateCheckpoint({...c,state:{...c.state,stock:stateStock}},originalStock)).toThrow('canonical supported');
  const altered=fixture();altered.run.debug[0].data.stock={...supported,[id]:251};expect(()=>checkpoint(altered)).toThrow('start stock');
 });

 it('detects overwritten logged poses and stable-ID ownership even when the replacement geometry is itself legal',()=>{
  for(const change of ['poses','IDs']){
   const f=fixture();f.append(action('edit',[p(0),p(1)]));const state=f.run.debug[1].data.state as BenchState;
   if(change==='poses')state.pieces.forEach(p=>p.x=1);else [state.pieces[0].id,state.pieces[1].id]=[state.pieces[1].id,state.pieces[0].id];
   expect(inspectBench(state).issues).toEqual([]);expect(()=>checkpoint(f)).toThrow('kernel replay');
  }
 });

 it('rejects forged acceptance, ledger snapshots, missing decisions and incorrect before-revision evidence',()=>{
  for(const tamper of ['accepted','inspection','index','revision']){
   const f=fixture();f.append(action('edit',[p(0)]));const data=f.run.debug[1].data;
   if(tamper==='accepted')data.accepted=false;
   if(tamper==='inspection')data.inspection={used:{[id]:2},remaining:{[id]:250,[white]:1},total:2};
   if(tamper==='index')data.index=2;
   if(tamper==='revision')data.beforeRevision=1;
   expect(()=>checkpoint(f)).toThrow();
  }
 });

 it('rejects stale, detached and internally contradictory reviews, including a false promoted pass',()=>{
  const f=twenty();f.append(action('finish'));f.addReview();const c=checkpoint(f);
  expect(()=>validateCheckpoint({...c,reviewRevision:2},originalStock)).toThrow('geometry revision');
  expect(()=>validateCheckpoint({...c,review:{...c.review!,pass:true}},originalStock)).toThrow('blocking gates');
  expect(()=>validateCheckpoint({...c,review:{...c.review!,fixes:[]}},originalStock)).toThrow('blocking gates');
  const detached=fixture();detached.addReview();expect(()=>checkpoint(detached)).toThrow('preceding accepted finish');
  (f.run.debug.at(-1)!.data).revision=2;expect(()=>checkpoint(f)).toThrow('preceding accepted finish');
 });

 it('requires unique real source records rather than final builds, typed request names or ambiguous repeated sessions',()=>{
  const f=fixture();
  expect(()=>checkpointFromRun({stock:originalStock,shapeRuns:f.run.shapeRuns,debug:[]},idea.name)).toThrow('wholeModelStart');
  expect(()=>checkpointFromRun({...f.run,shapeRuns:{},requests:[{name:idea.name}]},idea.name)).toThrow('pile slot');
  const duplicate=structuredClone(f.run);duplicate.debug.push(structuredClone(duplicate.debug[0]));expect(()=>checkpointFromRun(duplicate,idea.name)).toThrow('wholeModelStart');
  const slots=structuredClone(f.run);slots.shapeRuns.pile.slots.push(structuredClone(slots.shapeRuns.pile.slots[0]));expect(()=>checkpointFromRun(slots,idea.name)).toThrow('unique matching');
  expect(()=>checkpointFromRun(f.run,'Different subject')).toThrow('pile slot');
 });

 it('revalidates native contact, overlap, upright poses, the 80-piece limit and actual 24-stud height',()=>{
  const c=checkpoint(fixture());
  const state=(parts:Placed[]):BenchState=>({stock:{...supported},revision:Math.ceil(parts.length/8),nextId:parts.length+1,pieces:parts.map((p,i)=>({id:`p${i+1}`,...p}))});
  for(const parts of [[p(0),p(2)],[p(0),p(0)],[{...p(0),rot:45}],[{...p(0),x:24}],Array.from({length:61},(_,z)=>p(z)),Array.from({length:81},(_,z)=>p(z))]){
   const s=state(parts);expect(()=>validateCheckpoint({...c,state:s,decisions:18},originalStock)).toThrow();
  }
 });

 it('requires bounded integer inventory/counters and serializable checkpoint data',()=>{
  const c=checkpoint(fixture());
  for(const n of [-1,.5,NaN,Infinity,2001])expect(()=>validateCheckpoint({...c,stock:{[id]:n}},{[id]:n})).toThrow();
  for(const field of ['decisions','revisions','reviews'])for(const n of [-1,.5,NaN,Infinity])expect(()=>validateCheckpoint({...c,[field]:n},originalStock)).toThrow();
  expect(()=>validateCheckpoint({...c,state:{...c.state,nextId:2}},originalStock)).toThrow('stable-ID history');
  expect(()=>validateCheckpoint({...c,contents:[]},originalStock)).toThrow('fields');
  expect(()=>validateCheckpoint({...c,version:2},originalStock)).toThrow('version');
  expect(()=>validateCheckpoint({...c,idea:{...idea,construction:{thoughtSignature:'PRIVATE'}}},originalStock)).toThrow('native reasoning');
 });

 it('deep-clones all retained values and never copies native thoughts, signatures, response contents or hop tokens',()=>{
  const f=twenty();f.append(action('finish'));f.addReview();
  f.run.debug.push({label:'modelContents',data:{contents:[{thought:true,thoughtSignature:'PRIVATE'}]}});
  const before=JSON.stringify(f.run),c=checkpoint(f),again=validateCheckpoint(JSON.parse(JSON.stringify(c)),originalStock);
  expect(JSON.stringify(c)).not.toMatch(/PRIVATE|DO NOT COPY|thought|signature|contents|continuationToken/);
  expect(again).toEqual(c);expect(JSON.stringify(f.run)).toBe(before);
  again.idea.palette[0].role='Changed';again.state.pieces[0].x=7;again.stock[id]=1;again.review!.features[0].observation='Changed';
  expect(c.idea.palette[0].role).toBe('hull');expect(c.state.pieces[0].x).toBe(0);expect(c.stock[id]).toBe(252);expect(c.review!.features[0].observation).not.toBe('Changed');
  expect(Object.isFrozen(c.state.stock)).toBe(true);
  const typed:WholeModelCheckpoint=c;expect(typed.version).toBe(1);
 });
});
