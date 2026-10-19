import {COLORS,parsePartId,partId} from '../bricks';
import {definition} from '../connections';
import {createBench,editBench,finishWithPolicy,inspectBench,type BenchState} from '../whole-model-workbench';
import type {RankedIdea} from './pipeline';
import {readCriticalReview,type WholeModelReview} from './whole-model-review';

/** Physical recovery only: resuming requires an explicitly started, separately
 * bounded fresh reasoning session. No native model history is stored here. */
export interface WholeModelCheckpoint {
 version:1;
 idea:RankedIdea;
 /** Original, unfiltered inventory, including explicitly unsupported IDs. */
 stock:Record<string,number>;
 state:BenchState;
 decisions:number;
 revisions:number;
 reviews:number;
 /** Present only when the latest review describes this exact state revision. */
 review?:WholeModelReview;
 reviewRevision?:number;
}

type ObjectValue=Record<string,unknown>;
const object=(v:unknown):v is ObjectValue=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function fail(message:string):never {throw Error(`Cannot recover whole-model checkpoint: ${message}`);}
const same=(a:unknown,b:unknown):boolean=>{
 if(a===b)return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 if(object(a)&&object(b)){
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
 }
 return false;
};
const text=(v:unknown,max=4000):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const natural=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const forbidden=new Set(['__proto__','prototype','constructor','content','contents','candidates','thought','thoughts','thoughtsignature','signature','continuationtoken']);

/** Bounded JSON clone, rejecting accessors, cycles, nonfinite values and native
 * reasoning fields rather than serializing a live provider response. */
function dataClone<T>(input:T):T {
 let nodes=0,characters=0;
 const parents=new Set<object>();
 const copy=(v:unknown,depth:number):unknown=>{
  if(++nodes>30000||depth>20)fail('data exceeds the bounded JSON checkpoint format.');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('nonfinite JSON number.');return v;}
  if(typeof v==='string'){characters+=v.length;if(v.length>50000||characters>1000000)fail('checkpoint text is too large.');return v;}
  if(!Array.isArray(v)&&!object(v))fail('checkpoint values must be plain serializable JSON.');
  if(parents.has(v as object))fail('cyclic checkpoint data.');parents.add(v as object);
  let result:unknown;
  if(Array.isArray(v)){
   if(v.length>2000)fail('checkpoint array is too large.');
   result=Array.from(v,x=>copy(x,depth+1));
  }else{
   const entries=Object.entries(Object.getOwnPropertyDescriptors(v));if(entries.length>2000)fail('checkpoint object is too large.');
   result=Object.fromEntries(entries.map(([k,d])=>{
    if(forbidden.has(k.toLowerCase())||!Object.hasOwn(d,'value'))fail('native reasoning, unsafe keys or accessors cannot enter a checkpoint.');
    return [k,copy(d.value,depth+1)];
   }));
  }
  parents.delete(v as object);return result;
 };
 return copy(input,0) as T;
}

function rawStock(value:unknown):Record<string,number> {
 if(!object(value)||Object.keys(value).length>500)fail('stock must contain at most 500 exact IDs.');
 const stock=dataClone(value);let total=0;
 for(const [id,n]of Object.entries(stock)){
  if(!text(id,200)||!natural(n)||n>2000)fail(`invalid integer stock count for ${id}.`);
  total+=n;
 }
 if(total<1||total>2000)fail('stock must contain 1–2000 pieces.');
 return stock as Record<string,number>;
}

/** Mirrors the native canonical qualification, without importing the async
 * editor or substituting any unsupported shape. */
function supportedStock(stock:Record<string,number>):Record<string,number> {
 const supported:Record<string,number>={};
 for(const [id,n]of Object.entries(stock)){
  if(!n)continue;
  try{
   const k=parsePartId(id);
   if(!k||!Object.hasOwn(COLORS,k.color)||partId(k.type,k.w,k.d,k.color)!==id)continue;
   definition(k);supported[id]=n;
  }catch{/* Retained in the raw ledger, never aliased into supported stock. */}
 }
 // Also establishes the core's nonempty, exact, bounded stock contract.
 return {...createBench(supported).stock};
}

function readIdea(raw:unknown):RankedIdea {
 if(!object(raw))fail('the selected pile slot has no ranked idea.');
 // Preserve only the idea contract; never carry slot/debug/provider envelopes.
 const keys=['name','pitch','why','length','width','height','palette','features','discovery','atlas','construction','opportunity','pieceOpportunity','worst','cells','shortfall'];
 const idea=dataClone(Object.fromEntries(keys.filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]])));
 if(!['name','pitch','why'].every(k=>text(idea[k]))||!['length','width','height'].every(k=>typeof idea[k]==='number'&&Number.isFinite(idea[k])&&(idea[k] as number)>0)||!['worst','cells','shortfall'].every(k=>typeof idea[k]==='number'&&Number.isFinite(idea[k])&&(idea[k] as number)>=0)||!Array.isArray(idea.palette)||idea.palette.length>100)fail('malformed ranked idea.');
 for(const p of idea.palette)if(!object(p)||!text(p.role)||!text(p.color,100)||typeof p.cells!=='number'||!Number.isFinite(p.cells)||p.cells<0||(p.real!==undefined&&!text(p.real,100)))fail('malformed idea palette.');
 return idea as unknown as RankedIdea;
}

function checkedReview(raw:unknown):WholeModelReview {
 const copy=dataClone(raw),review=readCriticalReview(copy);
 if(!same(copy,review))fail('review pass/fixes do not match its actual blocking gates.');
 return review;
}

/** Returns an independent validated snapshot, or throws. This validates digital
 * stock/geometry, never visual quality, real stability or provider continuity.
 * Historical counters do not grant or extend a resumed session's 18/45m budget. */
export function validateCheckpoint(raw:unknown,currentStock:Record<string,number>):WholeModelCheckpoint {
 if(!object(raw)||raw.version!==1||Object.keys(raw).some(k=>!['version','idea','stock','state','decisions','revisions','reviews','review','reviewRevision'].includes(k)))fail('unknown checkpoint version or fields.');
 const c=dataClone(raw),stock=rawStock(c.stock),current=rawStock(currentStock);
 if(!same(stock,current))fail('the current raw inventory differs from the original stock.');
 const supported=supportedStock(stock);
 if(!object(c.state)||!same(c.state.stock,supported))fail('state stock differs from the canonical supported inventory.');
 const state=c.state as unknown as BenchState,inspection=inspectBench(state);
 if(inspection.issues.length)fail(`state fails native physical checks: ${inspection.issues.join('; ')}`);
 if(!natural(c.decisions)||!natural(c.revisions)||!natural(c.reviews)||c.revisions>state.revision||state.revision>c.decisions||c.reviews>c.decisions||(state.nextId-1)/8>state.revision||(state.revision===0&&(state.nextId!==1||state.pieces.length)))fail('inconsistent integer counters or stable-ID history.');
 const idea=readIdea(c.idea);
 const result:WholeModelCheckpoint={version:1,idea,stock,state:{...state,stock:Object.freeze({...state.stock})},decisions:c.decisions,revisions:c.revisions,reviews:c.reviews};
 if(c.review!==undefined||c.reviewRevision!==undefined){
  if(c.review===undefined||!natural(c.reviewRevision)||c.reviewRevision!==state.revision||!c.reviews)fail('review does not describe the retained geometry revision.');
  if(!finishWithPolicy(state,{mode:'subset',minParts:20}).accepted)fail('a review requires a digitally finishable model.');
  result.review=checkedReview(c.review);result.reviewRevision=c.reviewRevision;
 }
 return result;
}

interface LoggedAction {action:'edit'|'inspect'|'finish';observation:string;plan:string;remove:string[];add:Parameters<typeof editBench>[1]['add']}
function readAction(raw:unknown):LoggedAction|undefined {
 // Failed action parsing is logged with an absent action; only an unchanged
 // rejected state may be recovered from such a record.
 if(raw===undefined)return undefined;
 const v=dataClone(raw);
 if(!object(v)||!['edit','inspect','finish'].includes(v.action as string)||typeof v.observation!=='string'||v.observation.length>4000||typeof v.plan!=='string'||v.plan.length>4000||!Array.isArray(v.remove)||!Array.isArray(v.add)||(v.action!=='edit'&&(v.remove.length||v.add.length)))fail('decision action is not a literal editor action.');
 return v as unknown as LoggedAction;
}

/** Replays the selected subject's complete committed debug trace. Failed final
 * generation/review calls need not have a decision record: the last verified
 * physical state remains recoverable. Ambiguous/missing sources fail closed. */
export function checkpointFromRun(runExport:unknown,subjectName:string):WholeModelCheckpoint {
 if(!object(runExport)||!text(subjectName)||!Array.isArray(runExport.debug)||runExport.debug.length>20000)fail('missing bounded debug source.');
 const pile=object(runExport.shapeRuns)&&object(runExport.shapeRuns.pile)?runExport.shapeRuns.pile:undefined;
 const slots=pile&&Array.isArray(pile.slots)?pile.slots:[];
 const matching=slots.filter(s=>object(s)&&object(s.idea)&&s.idea.name===subjectName);
 if(matching.length!==1)fail('a unique matching shapeRuns.pile slot idea is required.');
 const idea=readIdea((matching[0] as ObjectValue).idea),stock=rawStock(runExport.stock),supported=supportedStock(stock);
 const events=runExport.debug.filter(e=>object(e)&&['wholeModelStart','wholeModelDecision','wholeModelCriticalReview'].includes(e.label as string)&&object(e.data)&&e.data.subject===subjectName) as {label:string;data:ObjectValue}[];
 if(events.filter(e=>e.label==='wholeModelStart').length!==1||events[0]?.label!=='wholeModelStart')fail('a unique original wholeModelStart must precede all subject decisions.');
 const start=events[0].data;
 if(start.initialState!=='empty'||!same(start.stock,supported)||!natural(start.minParts)||start.minParts<20||start.minParts>80||!natural(start.maxDecisions)||start.maxDecisions<1||start.maxDecisions>18||typeof start.maxMillis!=='number'||!Number.isFinite(start.maxMillis)||start.maxMillis<=0||start.maxMillis>45*60*1000||!Array.isArray(start.excluded))fail('start stock or bounded empty-state contract is incompatible.');
 const excluded=Object.entries(stock).filter(([id,n])=>n&&!Object.hasOwn(supported,id)).map(([id,n])=>`${id} × ${n}`).sort();
 if(!same([...start.excluded].sort(),excluded))fail('original unsupported-stock receipt differs from the raw inventory.');
 if(Object.values(supported).reduce((a,b)=>a+b,0)<start.minParts)fail('start inventory cannot satisfy its minimum piece policy.');
 let state=createBench(supported),decisions=0,revisions=0,reviews=0,review:WholeModelReview|undefined,reviewRevision:number|undefined,pendingReview=false,closed=false;
 for(const {label,data}of events.slice(1)){
  if(closed)fail('decision/review records occur after the source session finished.');
  if(label==='wholeModelCriticalReview'){
   if(!pendingReview||data.revision!==state.revision)fail('review is not attached to the immediately preceding accepted finish.');
   review=checkedReview(data.review);reviewRevision=state.revision;reviews++;pendingReview=false;
   if(review.pass||reviews>=3||decisions>=start.maxDecisions)closed=true;
   continue;
  }
  if(pendingReview||data.index!==decisions+1||data.beforeRevision!==state.revision||decisions>=start.maxDecisions||typeof data.accepted!=='boolean'||!Array.isArray(data.issues)||!data.issues.every(s=>typeof s==='string'))fail('decision sequence, revision or result fields are incompatible.');
  const action=readAction(data.action);
  const result=action?.action==='edit'?editBench(state,{remove:action.remove,add:action.add}):action?.action==='finish'?finishWithPolicy(state,{mode:'subset',minParts:start.minParts}):undefined;
  const accepted=result?result.accepted:!!action,next=result?.state??state,inspection=result?.inspection??inspectBench(state);
  if(data.accepted!==accepted||!same(data.state,next)||!same(data.inspection,{used:inspection.used,remaining:inspection.remaining,total:inspection.total})||(!accepted&&!data.issues.length)||(accepted&&data.issues.length))fail(`decision ${data.index} disagrees with literal kernel replay; recorded state/poses may have been overwritten.`);
  state=next;decisions++;
  if(accepted&&action?.action==='edit'){
   if(action.remove.length)revisions++;
   review=undefined;reviewRevision=undefined;
  }
  pendingReview=accepted&&action?.action==='finish';
 }
 const checkpoint:WholeModelCheckpoint={version:1,idea,stock,state,decisions,revisions,reviews};
 if(review!==undefined){checkpoint.review=review;checkpoint.reviewRevision=reviewRevision;}
 return validateCheckpoint(checkpoint,stock);
}
