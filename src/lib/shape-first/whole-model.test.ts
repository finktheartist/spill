import {afterEach,describe,expect,it,vi} from 'vitest';
import {generate,type RankedIdea} from './pipeline';
import {buildWholeModel,supportedWholeStock} from './whole-model';
import {readCriticalReview,type WholeModelReview} from './whole-model-review';
import {constructionIssues} from '../construction';
import {partCount,type Build} from '../bricks';
import {runShapeTab,type ShapeVerdict} from './run';
import {createBench,editBench,inspectBench} from '../whole-model-workbench';
import type {WholeModelCheckpoint} from './whole-model-checkpoint';
import {wholeModelRequestResult} from './whole-model-draft';
import {newCard} from '../../screens/Builds';
import {ShapeCard} from '../../components/ShapeCards';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('./pipeline',async original=>({...await original<typeof import('./pipeline')>(),generate:vi.fn()}));
const model=vi.mocked(generate),id='plate-1x1-black';
const stock=()=>({[id]:252,'plate-1x1-white':1,'plate-1x2-black':1});
const idea:RankedIdea={name:'Tower',pitch:'A tall narrow tower with a deliberate cap.',why:'Vertical forms fit.',length:2,width:1,height:4,palette:[],cells:20,worst:1,shortfall:0};
const verdict:ShapeVerdict={looksLike:'a tower',named:true,recognizable:4,complete:4,colors:4,impressive:4,pass:true,fixes:[]};
const images=()=>Array(4).fill('data:image/png;base64,AA==');
const review=(pass=true):WholeModelReview=>({features:[{role:'main form',observation:'Tall narrow shaft.',blocking:!pass,fix:pass?'No critical correction needed':'Widen the cap and resolve the foundation.'},{role:'support',observation:'On the table.',blocking:false,fix:'No critical correction needed'}],massing:{observation:'A narrow shaft.',blocking:false,fix:'No critical correction needed'},support:{observation:'Direct table contact.',blocking:false,fix:'No critical correction needed'},pass,fixes:pass?[]:['Widen the cap and resolve the foundation.']});
const action=(action:'edit'|'finish'|'inspect',add:unknown[]=[],remove:string[]=[])=>({action,observation:'Read actual views.',plan:'Resolve the complete form.',remove,add});
const stack=(from:number,n:number)=>Array.from({length:n},(_,i)=>({partId:id,x:0,y:0,z:from+i,rot:0}));
function replies(actions:unknown[],inspect?:(contents:unknown)=>void){let i=0;model.mockImplementation(async contents=>{
 inspect?.(structuredClone(contents));const json=actions[i++];if(!json)throw Error('Unexpected extra model call');
 return {json,seconds:1,content:{role:'model',parts:[{thought:true,text:'Signed native part',thoughtSignature:'separate-signature'},{text:JSON.stringify(json)}]},hops:[],initialPromptTokenCount:20};
});}
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
describe('normal-app whole-model editor loop',()=>{
 it('uses a subset of a full photo-size ledger, revises the foundation and cap after critical review, and preserves actual native history',async()=>{
  const history:unknown[]=[];replies([action('edit',stack(0,8)),action('edit',stack(8,8)),action('edit',stack(16,4)),action('finish'),
   action('edit',[{partId:'plate-1x1-white',x:0,y:0,z:0,rot:0},{partId:'plate-1x2-black',x:0,y:0,z:19,rot:0}],['p1','p20']),action('finish')],c=>history.push(c));
  const critical=vi.fn().mockResolvedValueOnce(review(false)).mockResolvedValueOnce(review()),judge=vi.fn(async(build:Build)=>{
   expect(constructionIssues(build,stock(),24)).toEqual([]);return verdict;
  });
  const out=await buildWholeModel(idea,stock(),{views:images,judge,criticalReview:critical,maxDecisions:8});
  expect(partCount(out.build)).toBe(20);expect(out.unused).toBe(234);expect(out.revisions).toBe(1);expect(out.decisions).toBe(6);expect(out.verdict.pass).toBe(true);
  expect(critical).toHaveBeenCalledTimes(2);expect(judge).toHaveBeenCalledOnce();
  const body=JSON.stringify(history[4]);expect(body).toContain('INDEPENDENT CRITICAL-FEATURE REVIEW');expect(body).toContain('rear');expect(body).toContain('separate-signature');expect(body).toContain('ACCEPTED STATE');
  expect(out.build.source).toEqual({kind:'discovery',recipeId:'whole-model:editable'});
 });
 it('returns actual rejection feedback and unchanged IDs before retrying; a legal unfinished build is never silently returned',async()=>{
  const requests:unknown[]=[];replies([action('edit',stack(0,8)),action('edit',[{partId:id,x:0,y:0,z:0,rot:0}]),action('inspect')],c=>requests.push(c));
  const judge=vi.fn();await expect(buildWholeModel(idea,stock(),{views:images,judge,maxDecisions:3})).rejects.toThrow('did not finish');
  expect(JSON.stringify(requests[2])).toContain('rejected-no-state-change');expect(JSON.stringify(requests[2])).toContain('p8');expect(JSON.stringify(requests[2])).not.toContain('"id":"p9"');expect(judge).not.toHaveBeenCalled();
  expect(JSON.stringify(requests[2])).toContain('rejectedProposalOrderedParts');expect(JSON.stringify(requests[2])).toContain('proposed-add-1');
 });
 it('does not continue when rendering fails, the stock changes or a stop arrives',async()=>{
  replies([action('edit',stack(0,8))]);await expect(buildWholeModel(idea,stock(),{views:()=>{throw Error('WebGL lost');},judge:vi.fn()})).rejects.toThrow('WebGL lost');expect(model).toHaveBeenCalledOnce();
  model.mockClear();replies([action('edit',stack(0,8))]);const changed=stock();await expect(buildWholeModel(idea,changed,{views:()=>{changed[id]--;return images();},judge:vi.fn()})).rejects.toThrow('inventory changed');expect(model).toHaveBeenCalledOnce();
  model.mockClear();await expect(buildWholeModel(idea,stock(),{views:images,judge:vi.fn(),signal:AbortSignal.abort()})).rejects.toMatchObject({name:'AbortError'});expect(model).not.toHaveBeenCalled();
 });
 it('keeps a recognized model a draft when critical shape failures remain after its correction allowance',async()=>{
  replies([action('edit',stack(0,8)),action('edit',stack(8,8)),action('edit',stack(16,4)),action('finish'),action('finish'),action('finish')]);
  const out=await buildWholeModel(idea,stock(),{views:images,judge:async()=>verdict,criticalReview:async()=>review(false),maxDecisions:8});
  expect(out.verdict.pass).toBe(false);expect(out.verdict.fixes.join(' ')).toContain('cap');
 });
 it('discloses unsupported stock, rejects invalid counts, and fails malformed critical evidence',()=>{
  expect(supportedWholeStock({[id]:252,'panel-9x9-black':2})).toEqual({stock:{[id]:252},excluded:['panel-9x9-black × 2']});
  expect(()=>supportedWholeStock({[id]:NaN})).toThrow('Invalid stock');expect(()=>readCriticalReview({features:[],massing:'box',support:'post'})).toThrow();
  const r=review();expect(readCriticalReview(r).pass).toBe(true);expect(readCriticalReview({...r,features:r.features.map(f=>({...f,blocking:true}))}).pass).toBe(false);
  expect(readCriticalReview({...r,massing:{observation:'Box-shaped featureless body.',blocking:true,fix:'Reshape the main form.'},pass:true}).pass).toBe(false);
  expect(readCriticalReview({...r,support:{observation:'Broad deck on one awkward stilt.',blocking:true,fix:'Rework the base.'},pass:true}).pass).toBe(false);
 });
 it('normal editable route publishes only reviewed builds and bypasses the authored animal/aircraft menus',async()=>{
  replies([action('edit',stack(0,8)),action('edit',stack(8,8)),action('edit',stack(16,4)),action('finish'),review()]);
  const judge=vi.fn(async()=>verdict);
  const out=await runShapeTab('pile',stock(),()=>{},{ideas:[{...idea,name:'Fox'}],editableModel:true,wholeViews:images,judge});
  expect(out.slots[0].phase).toBe('ready');expect(out.slots[0].stats?.wholeModel).toBe(true);expect(out.slots[0].stats?.assemblyFirst).toBeUndefined();
  expect(out.slots[0].build?.source?.kind).toBe('discovery');expect(out.slots[0].craftReview?.pass).toBe(true);expect(judge).toHaveBeenCalledOnce();
 });
 it('keeps an unrecognized completed construction available as a draft in catalog and typed results',async()=>{
  replies([action('edit',stack(0,8)),action('edit',stack(8,8)),action('edit',stack(16,4)),action('finish'),review()]);
  const unidentified={...verdict,looksLike:'unidentifiable block assembly',named:false,recognizable:1,pass:false};
  const out=await runShapeTab('pile',stock(),()=>{},{ideas:[idea],editableModel:true,wholeViews:images,judge:async()=>unidentified});
  const slot=out.slots[0];expect(slot.phase).toBe('failed');expect(slot.unrecognized).toBe(true);expect(slot.instructionsReady).toBe(true);
  expect(partCount(slot.build!)).toBe(20);expect(constructionIssues(slot.build!,stock(),24)).toEqual([]);expect(slot.verdict).toEqual(unidentified);
  const html=renderToStaticMarkup(createElement(ShapeCard,{slot,mode:'pile',onBuild:()=>{},onList:()=>{}}));
  expect(html).toContain('Build this draft');expect(html).toContain('Parts list');expect(html).toContain('subject not recognized');expect(html).toContain('unidentifiable block assembly');expect(html).not.toContain('AI review passed');
  const card=wholeModelRequestResult(newCard({name:idea.name,pitch:idea.pitch,estimatedParts:20,difficulty:1,keyParts:[],mode:'bucket',request:idea.name}),
   {build:slot.build!,verdict:slot.verdict!,review:slot.craftReview!,decisions:4,revisions:0,unused:234,excluded:[],resumed:false});
  expect(card.phase).toBe('failed');expect(card.build).toBe(slot.build);expect(card.instructionsReady).toBe(true);expect(card.craftPass).toBe(false);expect(card.verdict).toBe(slot.verdict);
 });
 it('continues exact retained poses and IDs in a fresh bounded session, reruns review, and records cumulative checkpoint counters',async()=>{
  let state=createBench(stock());for(const [z,n]of [[0,8],[8,8],[16,4]])state=editBench(state,{remove:[],add:stack(z,n)}).state;
  const retained:WholeModelCheckpoint={version:1,idea,stock:stock(),state,decisions:3,revisions:0,reviews:0},before=structuredClone(retained),history:unknown[]=[],saved:WholeModelCheckpoint[]=[];
  replies([action('edit',[{partId:'plate-1x2-black',x:0,y:0,z:19,rot:0}],['p20']),action('finish')],c=>history.push(c));
  const critical=vi.fn(async()=>review()),judge=vi.fn(async()=>verdict);
  const out=await buildWholeModel(idea,stock(),{resume:retained,onCheckpoint:c=>saved.push(c),views:images,judge,criticalReview:critical,maxDecisions:3});
  expect(out.resumed).toBe(true);expect(out.decisions).toBe(2);expect(retained).toEqual(before);expect(saved.at(-1)?.decisions).toBe(5);expect(saved.at(-1)?.state.nextId).toBe(22);
  expect(saved.at(-1)?.state.pieces.some(p=>p.id==='p1')).toBe(true);expect(saved.at(-1)?.state.pieces.some(p=>p.id==='p20')).toBe(false);
  expect(JSON.stringify(history[0])).toContain('fresh reasoning context');expect(JSON.stringify(history[0])).toContain('RETAINED ACCEPTED DRAFT');expect(JSON.stringify(history[0])).not.toContain('Signed native part');
  expect(critical).toHaveBeenCalledOnce();expect(judge).toHaveBeenCalledOnce();
 });
 it('retains the last accepted geometry checkpoint after a service failure and refuses a changed-stock resume before any call',async()=>{
  replies([action('edit',stack(0,8))]);model.mockImplementationOnce(async()=>({json:action('edit',stack(0,8)),content:{role:'model',parts:[{text:'accepted'}]},seconds:1})).mockImplementationOnce(async()=>{throw Error('HTTP 429 after bounded attempts');});
  let latest:WholeModelCheckpoint|undefined;
  await expect(buildWholeModel(idea,stock(),{views:images,judge:vi.fn(),onCheckpoint:c=>latest=c})).rejects.toThrow('429');
  expect(latest?.state.pieces).toHaveLength(8);expect(latest?.state.revision).toBe(1);expect(latest?.decisions).toBe(2);
  model.mockClear();await expect(buildWholeModel(idea,{...stock(),[id]:251},{views:images,judge:vi.fn(),resume:latest})).rejects.toThrow('inventory differs');expect(model).not.toHaveBeenCalled();
 });
 it('retains revision-matched prior critique when a resumed first request fails before editing',async()=>{
  let state=createBench(stock());for(const [z,n]of [[0,8],[8,8],[16,4]])state=editBench(state,{remove:[],add:stack(z,n)}).state;
  const prior=readCriticalReview(review(false)),retained:WholeModelCheckpoint={version:1,idea,stock:stock(),state,decisions:4,revisions:0,reviews:1,review:prior,reviewRevision:state.revision};
  const before=structuredClone(retained),saved:WholeModelCheckpoint[]=[];
  model.mockRejectedValueOnce(Error('HTTP 429 after bounded delivery retries'));
  const critical=vi.fn();
  await expect(buildWholeModel(idea,stock(),{resume:retained,onCheckpoint:c=>saved.push(c),views:images,judge:vi.fn(),criticalReview:critical})).rejects.toThrow('429');
  expect(saved.at(-1)?.state).toEqual(before.state);expect(saved.at(-1)?.review).toEqual(prior);expect(saved.at(-1)?.reviewRevision).toBe(state.revision);
  expect(saved.at(-1)?.reviews).toBe(1);expect(retained).toEqual(before);expect(critical).not.toHaveBeenCalled();
 });
 it('requires a fresh critical review even when an unchanged retained model previously passed',async()=>{
  let state=createBench(stock());for(const [z,n]of [[0,8],[8,8],[16,4]])state=editBench(state,{remove:[],add:stack(z,n)}).state;
  const retained:WholeModelCheckpoint={version:1,idea,stock:stock(),state,decisions:4,revisions:0,reviews:1,review:review(),reviewRevision:state.revision};
  replies([action('finish')]);const critical=vi.fn(async()=>review(false));
  const out=await buildWholeModel(idea,stock(),{resume:retained,views:images,judge:async()=>verdict,criticalReview:critical,maxDecisions:1});
  expect(critical).toHaveBeenCalledOnce();expect(out.review.pass).toBe(false);expect(out.verdict.pass).toBe(false);
 });
 it('shows retained failed geometry as an unfinished preview with continuation, without offering finished instructions',()=>{
  const state=editBench(createBench(stock()),{remove:[],add:stack(0,8)}).state,checkpoint:WholeModelCheckpoint={version:1,idea,stock:stock(),state,decisions:1,revisions:0,reviews:0};
  const html=renderToStaticMarkup(createElement(ShapeCard,{slot:{key:'test',idea,phase:'failed',startedAt:0,log:[],checkpoint,preview:inspectBench(state).build!},mode:'pile',onBuild:()=>{},onList:()=>{},onResume:()=>{}}));
  expect(html).toContain('Unfinished draft');expect(html).toContain('Continue this model');expect(html).not.toContain('>Build it');expect(html).not.toContain('Parts list');
 });
});
