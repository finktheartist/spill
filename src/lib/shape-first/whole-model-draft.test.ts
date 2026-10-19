import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {checkpointDraftBuild,wholeModelRequestResult} from './whole-model-draft';
import {createBench,editBench,finishWithPolicy} from '../whole-model-workbench';
import {constructionIssues} from '../construction';
import {partCount,type Build} from '../bricks';
import {readCriticalReview} from './whole-model-review';
import type {WholeModelCheckpoint} from './whole-model-checkpoint';
import type {WholeModelResult} from './whole-model';
import {Builds,newCard,weak,type Card} from '../../screens/Builds';
import {ShapeCard} from '../../components/ShapeCards';
import {Instructions} from '../../screens/Instructions';
import {invalidateRequestStock} from '../request-stock-freshness';

vi.mock('../render',async original=>({...await original<typeof import('../render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const id='plate-1x1-black',stock={[id]:30};
const idea={name:'Tower',pitch:'A tall tower',why:'Test only',length:1,width:1,height:4,palette:[],cells:20,worst:1,shortfall:0};
const typedIdea={name:idea.name,pitch:idea.pitch,estimatedParts:20,difficulty:1,keyParts:[],request:idea.name,mode:'bucket' as const};
const critique=readCriticalReview({features:[{role:'shaft',observation:'Blocky shaft',blocking:true,fix:'Resolve the outline'},{role:'cap',observation:'Flat cap',blocking:false,fix:'None'}],massing:{observation:'Narrow',blocking:false,fix:'None'},support:{observation:'Grounded',blocking:false,fix:'None'}});
const unidentified={looksLike:'unidentifiable block assembly',named:false,recognizable:1,complete:2,colors:2,impressive:2,pass:false,fixes:['Resolve the outline']};
function checkpoint(n=20):WholeModelCheckpoint {
 let state=createBench(stock);for(let z=0;z<n;z+=8)state=editBench(state,{remove:[],add:Array.from({length:Math.min(8,n-z)},(_,i)=>({partId:id,x:0,y:0,z:z+i,rot:0}))}).state;
 return {version:1,idea,stock:{...stock},state,decisions:4,revisions:0,reviews:1,review:critique,reviewRevision:state.revision};
}
function result():WholeModelResult {return {build:checkpointDraftBuild(checkpoint(),stock)!,verdict:unidentified,review:critique,decisions:4,revisions:0,unused:10,excluded:[],resumed:false};}
const noop=()=>{};
function cardHtml(card:Card) {return renderToStaticMarkup(createElement(Builds,{slots:[],tried:1,ideasState:{status:'done'},requests:[card],bucket:stock,library:[],onOpenLibrary:noop,onOpen:noop,onRetry:noop,onRetryIdeas:noop,onRequest:noop,onOpenRequest:noop,onRetryRequest:noop,onSuggest:noop,onDifferent:noop,onBench:noop}));}
const poses=(b:Build)=>b.steps.flatMap(s=>s.parts).map(p=>JSON.stringify(p)).sort();

describe('draft access without visual promotion',()=>{
 it('recovers the exact reviewed geometry, counts and contacts without mutating checkpoint or stock',()=>{
  const c=checkpoint(),before=structuredClone(c),b=checkpointDraftBuild(c,stock)!;
  expect(partCount(b)).toBe(20);expect(poses(b)).toEqual(poses(finishWithPolicy(c.state,{mode:'subset',minParts:20}).candidate!));
  expect(constructionIssues(b,stock,24)).toEqual([]);expect(b.source?.kind).toBe('discovery');expect(c).toEqual(before);expect(stock[id]).toBe(30);expect(c.review?.pass).toBe(false);
 });
 it('does not unlock an arbitrary twenty-piece preview that has never reached review',()=>{
  const c=checkpoint();delete c.review;delete c.reviewRevision;c.reviews=0;expect(checkpointDraftBuild(c,stock)).toBeUndefined();
 });
 it('keeps an undersized preview unavailable even if a review receipt is fabricated',()=>{
  expect(()=>checkpointDraftBuild(checkpoint(8),stock)).toThrow('digitally finishable');
  const c=checkpoint(8);delete c.review;delete c.reviewRevision;c.reviews=0;expect(checkpointDraftBuild(c,stock)).toBeUndefined();
 });
 it('refuses changed stock, stale reviews and tampered colliding geometry',()=>{
  expect(()=>checkpointDraftBuild(checkpoint(),{[id]:29})).toThrow('inventory differs');
  const stale=checkpoint();stale.reviewRevision!--;expect(()=>checkpointDraftBuild(stale,stock)).toThrow('revision');
  const bad=checkpoint();bad.state.pieces[1].z=0;expect(()=>checkpointDraftBuild(bad,stock)).toThrow('physical checks');
 });
 it('retains failed typed-review evidence and exposes draft parts/instructions without a quality pass',()=>{
  const a=result(),c=wholeModelRequestResult({...newCard(typedIdea),key:"typed-draft-test"},a),html=cardHtml(c);
  expect(c.build).toBe(a.build);expect(c.verdict).toBe(a.verdict);expect(c.phase).toBe('failed');expect(c.craftPass).toBe(false);
  expect(html).toContain('Build this draft');expect(html).toContain('Parts list');expect(html).toContain('unidentifiable block assembly');expect(html).not.toContain('AI review passed');
 });
 it('also allows a recognized weak draft while keeping weak() and its failed quality state intact',()=>{
  const a=result();a.verdict={...unidentified,named:true,recognizable:3};const c=wholeModelRequestResult({...newCard(typedIdea),key:"typed-draft-test"},a);
  expect(c.phase).toBe('ready');expect(weak(c)).toBe(true);expect(c.craftPass).toBe(false);expect(cardHtml(c)).toContain('Build this draft');
 });
 it('does not expose typed preview, stale stock, undersized or active construction as draft instructions',()=>{
  const c=wholeModelRequestResult({...newCard(typedIdea),key:"typed-draft-test"},result());
  for(const blocked of [{...c,build:undefined,preview:c.build},{...c,instructionsReady:undefined},{...c,phase:'designing' as const},{...c,build:{...c.build!,steps:[{caption:'Too small',parts:c.build!.steps.flatMap(s=>s.parts).slice(0,8)}]}}])expect(cardHtml(blocked)).not.toContain('Build this draft');
 });
 it('does not mislabel an unrecognized draft as approved even with contradictory passing scores',()=>{
  const a=result();a.verdict={...a.verdict,pass:true};const c=wholeModelRequestResult({...newCard(typedIdea),key:"typed-draft-test"},a);
  expect(c.phase).toBe('failed');expect(c.craftPass).toBe(false);expect(c.log.at(-1)?.tone).toBe('note');
 });
 it('withdraws draft instructions after stock becomes insufficient, even without a continuation checkpoint',()=>{
  const c=wholeModelRequestResult({...newCard(typedIdea),key:'typed-draft-test'},result());
  const changed=invalidateRequestStock([c],{[id]:19})[0];
  expect(changed.build).toBeUndefined();expect(changed.instructionsReady).toBe(false);expect(changed.preview).toBe(c.build);expect(cardHtml(changed)).not.toContain('Build this draft');
  expect(invalidateRequestStock([c],{[id]:25})[0]).toBe(c);
 });
 it('invalidates a recovered draft continuation when the exact original stock ledger changes',()=>{
  const c={...wholeModelRequestResult({...newCard(typedIdea),key:'typed-draft-test'},result()),checkpoint:checkpoint()};
  const changed=invalidateRequestStock([c],{[id]:29})[0];expect(changed.build).toBeUndefined();expect(changed.checkpoint).toBeUndefined();expect(changed.instructionsReady).toBe(false);
 });
 it('keeps recovered drafts explicitly unapproved, and does not unlock the same arbitrary shape preview',()=>{
  const c=checkpoint(),b=checkpointDraftBuild(c,stock)!,slot={key:'x',idea,phase:'failed' as const,startedAt:0,checkpoint:c,build:b,instructionsReady:true,unrecognized:true,log:[]};
  const html=renderToStaticMarkup(createElement(ShapeCard,{slot,mode:'pile',onBuild:noop,onList:noop}));
  expect(html).toContain('subject not recognized');expect(html).toContain('Build this draft');expect(html).not.toContain('AI review passed');
  const preview=renderToStaticMarkup(createElement(ShapeCard,{slot:{...slot,build:undefined,preview:b,instructionsReady:undefined},mode:'pile',onBuild:noop,onList:noop}));expect(preview).not.toContain('Build this draft');
 });
 it('carries the draft warning into instructions and leaves normal instruction copy unchanged',()=>{
  const props={build:result().build,bucketTotal:30,model:'gemini-test-model',onBack:noop};
  const draft=renderToStaticMarkup(createElement(Instructions,{...props,draft:true}));expect(draft).toContain('Draft instructions');expect(draft).toContain('subject and appearance are not approved');expect(draft).not.toContain('your saved library');
  const approved=renderToStaticMarkup(createElement(Instructions,props));expect(approved).not.toContain('Draft instructions');
 });
});
