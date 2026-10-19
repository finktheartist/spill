import {COLORS,parsePartId,partId,type Build,type Placed} from '../bricks';
import {definition} from '../connections';
import {createBench,editBench,inspectBench,finishWithPolicy,type BenchState,type BenchResult} from '../whole-model-workbench';
import {generate,type RankedIdea} from './pipeline';
import type {ShapeVerdict} from './run';
import {wholeModelPrompt} from './whole-model-prompt';
import {reviewWholeModel,readCriticalReview,type WholeModelReview} from './whole-model-review';
import {validateCheckpoint,type WholeModelCheckpoint} from './whole-model-checkpoint';

interface Action {action:'edit'|'inspect'|'finish';observation:string;plan:string;remove:string[];add:Placed[]}
export interface WholeModelEvent {phase:'building'|'revising'|'judging';text:string;build?:Build}
export interface WholeModelResult {build:Build;verdict:ShapeVerdict;review:WholeModelReview;decisions:number;revisions:number;unused:number;excluded:string[];resumed:boolean}
export interface WholeModelOptions {
 signal?:AbortSignal;views:(build:Build)=>string[];judge:(build:Build,idea:RankedIdea,signal?:AbortSignal)=>Promise<ShapeVerdict>;
 onProgress?:(event:WholeModelEvent)=>void;debug?:(label:string,data:unknown)=>void;
 onCheckpoint?:(checkpoint:WholeModelCheckpoint)=>void;resume?:WholeModelCheckpoint;resumeFeedback?:string;
 /** Bounded downward overrides for deterministic integration tests. */
 maxDecisions?:number;maxMillis?:number;minParts?:number;
 criticalReview?:(idea:RankedIdea,images:string[],signal?:AbortSignal)=>Promise<WholeModelReview>;
}
const jsonKey=(x:Record<string,number>)=>JSON.stringify(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)));
const msg=(e:unknown)=>e instanceof Error?e.message:String(e);
const clone=<T>(x:T):T=>structuredClone(x);
const flat=(b:Build|null)=>b?.steps.flatMap(s=>s.parts)??[];

/** Unsupported catalog IDs are disclosed and never aliased to a plain brick. */
export function supportedWholeStock(input:Record<string,number>){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>500)throw Error('The workbench needs a bounded exact stock object.');
 const stock:Record<string,number>={},excluded:string[]=[];let total=0;
 for(const [id,n]of Object.entries(input)){
  if(!Number.isSafeInteger(n)||n<0||n>2000)throw Error(`Invalid stock count for ${id}.`);
  total+=n;if(total>2000)throw Error('The saved stock exceeds the 2000-piece workbench capacity.');
  if(!n)continue;
  try{const k=parsePartId(id);if(!k||!Object.hasOwn(COLORS,k.color)||partId(k.type,k.w,k.d,k.color)!==id)throw Error('Unsupported');definition(k);stock[id]=n;}catch{excluded.push(`${id} × ${n}`);}
 }
 return {stock,excluded};
}
function actionFrom(raw:unknown):Action{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Expected one workbench action.');
 const v=raw as Action;
 if(!['edit','inspect','finish'].includes(v.action)||typeof v.observation!=='string'||v.observation.length>4000||typeof v.plan!=='string'||v.plan.length>4000||!Array.isArray(v.remove)||!Array.isArray(v.add))throw Error('Action needs action, concise observation/plan, remove[] and add[].');
 if(v.action!=='edit'&&(v.remove.length||v.add.length))throw Error('Inspect and finish require empty remove/add arrays.');
 return v;
}
function stateResult(state:BenchState,issues:string[]=[]):BenchResult{
 const inspection=inspectBench(state);return {accepted:!issues.length,state:clone(state),candidate:inspection.build,inspection,issues};
}
function imageParts(images:string[],label:string):Record<string,unknown>[] {
 if(images.length!==4)throw Error('Whole-model editing requires four real quarter/front/side/rear renders.');
 return images.flatMap((image,i)=>{
  const m=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image);if(!m)throw Error('The model renderer returned an invalid image.');
  return [{text:`${label} — ${['quarter','front','side','rear'][i]}`},{inlineData:{mimeType:m[1],data:m[2]}}];
 });
}

/** Empty-state, literal whole-model edits. No recipe discovery, seeded chassis,
 * coordinate repair or authored fallback exists on this path. Commit follows
 * actual rendering and cancellation/freshness checks. */
export async function buildWholeModel(idea:RankedIdea,input:Record<string,number>,opts:WholeModelOptions):Promise<WholeModelResult>{
 const maxDecisions=opts.maxDecisions??18,maxMillis=opts.maxMillis??45*60*1000,minParts=opts.minParts??20;
 if(!Number.isSafeInteger(maxDecisions)||maxDecisions<1||maxDecisions>18||!Number.isFinite(maxMillis)||maxMillis<=0||maxMillis>45*60*1000||!Number.isSafeInteger(minParts)||minParts<20||minParts>80)throw Error('Invalid bounded whole-model budget.');
 const initialStockKey=jsonKey(input),{stock,excluded}=supportedWholeStock(input),ctl=new AbortController();
 const stop=()=>ctl.abort(opts.signal?.reason??new DOMException('Stopped','AbortError'));
 opts.signal?.addEventListener('abort',stop,{once:true});if(opts.signal?.aborted)stop();
 const timer=setTimeout(()=>ctl.abort(new Error('Whole-model construction reached its 45-minute maximum.')),maxMillis),deadline=Date.now()+maxMillis;
 const active=()=>{if(ctl.signal.aborted)throw ctl.signal.reason??new DOMException('Stopped','AbortError');if(Date.now()>=deadline)throw Error('Whole-model construction deadline reached.');if(jsonKey(input)!==initialStockKey)throw Error('The inventory changed during whole-model construction. Start again with the corrected pile.');};
 let checkpoint:WholeModelCheckpoint|undefined;
 try{
  active();const retained=opts.resume?validateCheckpoint(opts.resume,input):undefined;
  if(retained&&retained.idea.name!==idea.name)throw Error('A resumed draft must retain its actual requested subject.');
  const previous={decisions:retained?.decisions??0,revisions:retained?.revisions??0,reviews:retained?.reviews??0};
  let state=retained?clone(retained.state):createBench(stock),lastImages:string[]=[],decisions=0,revisions=0,reviews=0,finished=false,
   review:WholeModelReview|undefined=retained?.review?clone(retained.review):undefined,reviewRevision:number|undefined=retained?.reviewRevision;
  const persist=()=>{
   const raw={version:1,idea:JSON.parse(JSON.stringify(idea)),stock:{...input},state:clone(state),decisions:previous.decisions+decisions,revisions:previous.revisions+revisions,reviews:previous.reviews+reviews,
    ...(review&&reviewRevision===state.revision?{review:clone(review),reviewRevision}:{} )};
   checkpoint=validateCheckpoint(raw,input);opts.onCheckpoint?.(clone(checkpoint));
  };
  if(Object.values(stock).reduce((a,b)=>a+b,0)<minParts)throw Error(`This pile has fewer than ${minParts} supported pieces for an editable model.`);
  const initial=wholeModelPrompt(idea,stock,minParts,maxDecisions,!!retained);
  let contents:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[{text:initial.text}]}];
  if(retained){
   const inspection=inspectBench(state);lastImages=inspection.build?opts.views(inspection.build):[];active();
   contents[0].parts.push({text:'RETAINED PHYSICAL CHECKPOINT — previous thinking is not restored. Stock and poses have been independently revalidated.\n'+JSON.stringify({acceptedState:state,used:inspection.used,remaining:inspection.remaining,orderedPartIndexToStableId:inspection.partIndexToId,freeMatingPortsLdu:inspection.attachments})});
   if(lastImages.length)contents[0].parts.push(...imageParts(lastImages,'RETAINED ACCEPTED DRAFT'));
   const feedback=opts.resumeFeedback??retained.review?.fixes.join('; ');
   if(feedback)contents[0].parts.push({text:'Previous visual feedback, not a current quality pass: '+feedback.slice(0,4000)});
   contents[0].parts.push({text:'Inspect these actual views and revise underlying geometry before finishing. A prior physical pass or saved review never establishes current craft.'});
  }
  persist();
  opts.onProgress?.({phase:'building',text:retained?`Continuing ${state.pieces.length} retained pieces in a fresh bounded edit session.`:'Starting empty; all parts and all major forms stay editable.'});
  if(excluded.length)opts.onProgress?.({phase:'building',text:`Not modeled by the connection catalog: ${excluded.join(', ')}.`});
  opts.debug?.('wholeModelStart',{subject:idea.name,stock,minParts,maxDecisions,maxMillis,excluded,initialState:retained?'checkpoint':'empty',...(retained?{checkpoint:clone(retained)}:{})});
  while(decisions<maxDecisions){
   active();const index=++decisions;persist();
   opts.onProgress?.({phase:reviews?'revising':'building',text:`Design decision ${index}/${maxDecisions} · ${state.pieces.length} pieces placed`});
   const r=await generate<unknown>(contents,initial.schema,ctl.signal,'high',p=>{
    active();if(p.retry)opts.onProgress?.({phase:reviews?'revising':'building',text:`Rate limited; retrying the exact request after ${Math.ceil(p.retry.waitMs/1000)}s (${p.retry.nextAttempt}/4).`});
    else if(p.phase==='start'&&p.hop>1)opts.onProgress?.({phase:reviews?'revising':'building',text:`Decision ${index}: resuming the same reasoning (hop ${p.hop}/3)…`});
   });active();
   const before=clone(state);let action:Action|undefined,result:BenchResult;
   try{
    action=actionFrom(r.json);
    result=action.action==='edit'?editBench(state,{remove:action.remove,add:action.add}):action.action==='finish'?finishWithPolicy(state,{mode:'subset',minParts}):stateResult(state);
   }catch(e){result=stateResult(state,[msg(e)]);}
   active();
   const parts:Record<string,unknown>[]=[];
   // A failed render leaves both the accepted ledger and visible preview intact.
   let acceptedImages:string[]=[];
   if(result.inspection.build&&flat(result.inspection.build).length){acceptedImages=opts.views(result.inspection.build);parts.push(...imageParts(acceptedImages,'ACCEPTED STATE'));active();}
   if(!result.accepted&&flat(result.candidate).length){const rejected=opts.views(result.candidate!);parts.push(...imageParts(rejected,'REJECTED PROPOSAL, not accepted inventory'));active();}
   state=clone(result.state);lastImages=acceptedImages;
   if(result.accepted&&action?.action==='edit'&&action.remove.length)revisions++;
   persist();
   const inspection=result.inspection;
   const feedback:Record<string,unknown>={decision:index,status:result.accepted?'accepted':'rejected-no-state-change',issues:result.issues,
    acceptedState:{revision:state.revision,pieces:state.pieces,used:inspection.used,remaining:inspection.remaining,total:inspection.total,bounds:inspection.bounds},
    orderedPartIndexToStableId:inspection.partIndexToId,freeMatingPortsLdu:inspection.attachments,decisionsLeft:maxDecisions-index,
    contract:'Use acceptedState IDs and stock only. Every earlier part remains editable, including foundation and body. No human/code geometry repair occurred.'};
   if(!result.accepted&&result.candidate&&action?.action==='edit'){
    const key=(p:Placed)=>JSON.stringify([p.partId,p.x,p.y,p.z,p.rot]);
    const pool=[...before.pieces.filter(p=>!action.remove.includes(p.id)).map(p=>({label:p.id,...p})),...action.add.map((p,i)=>({label:`proposed-add-${i+1}`,...p}))];
    feedback.rejectedProposalOrderedParts=flat(result.candidate).map((p,index)=>{
     const at=pool.findIndex(q=>key(p)===key(q)),matched=at>=0?pool.splice(at,1)[0]:null;
     return {indexZeroBased:index,partNumberOneBased:index+1,label:matched?.label??'unmapped-proposal-piece',...p};
    });
    feedback.rejectedProposalLabelRule='Validator indices refer to this rejected proposal. proposed-add labels are not accepted IDs and cannot be removed. Use acceptedState stable IDs for removals.';
   }
   parts.unshift({text:'WORKBENCH RESULT\n'+JSON.stringify(feedback)});
   if(!lastImages.length)parts.push({text:'Accepted state is EMPTY; no current geometry exists to render.'});
   contents.push(r.content,{role:'user',parts});
   opts.debug?.('wholeModelDecision',{subject:idea.name,index,action,accepted:result.accepted,issues:result.issues,beforeRevision:before.revision,state:clone(state),inspection:{used:inspection.used,remaining:inspection.remaining,total:inspection.total},seconds:r.seconds,hops:r.hops,deliveryAttempts:r.deliveryAttempts,initialPromptTokenCount:r.initialPromptTokenCount});
   opts.onProgress?.({phase:reviews?'revising':'building',text:result.accepted?`${inspection.total} pieces · ${action?.observation||'Actual views checked'}${revisions?' · earlier pieces revised':''}`:`Edit rejected without changing the build: ${result.issues.slice(0,2).join(' ')}`});
   if(action?.action==='finish'&&result.accepted){
    if(!inspection.build||lastImages.length!==4)throw Error('A complete model needs actual views before visual review.');
    opts.onProgress?.({phase:'judging',text:'Checking defining forms, substitute shapes and rear supports…'});
    review=readCriticalReview(await (opts.criticalReview??reviewWholeModel)(idea,[...lastImages],ctl.signal));active();reviews++;reviewRevision=state.revision;persist();
    opts.debug?.('wholeModelCriticalReview',{subject:idea.name,review,revision:state.revision});
    if(review.pass||reviews>=3||index>=maxDecisions){finished=true;break;}
    contents.push({role:'user',parts:[{text:`INDEPENDENT CRITICAL-FEATURE REVIEW of current accepted renders:\n${JSON.stringify(review)}\nThe digital stock/contact gates passed, but these visible problems prevent a craft pass. Rework the actual underlying forms using removals/additions; the whole body and foundation remain editable. Acknowledge the visible issue through changed geometry, not a new caption. Then inspect and finish again. ${maxDecisions-index}decisions remain.`}]});
    opts.onProgress?.({phase:'revising',text:`Reworking visible problems: ${review.fixes.join('; ')}`});
   }
  }
  active();
  if(!finished||!review)throw Error('The editable model did not finish within its decision budget. No library recipe was substituted.');
  const final=finishWithPolicy(state,{mode:'subset',minParts});
  if(!final.accepted||!final.candidate)throw Error(`Final model failed digital qualification: ${final.issues.join('; ')}`);
  const build:Build={...clone(final.candidate),name:idea.name,description:idea.pitch,source:{kind:'discovery',recipeId:'whole-model:editable'}};
  opts.onProgress?.({phase:'judging',text:'Independent blind review of the complete miniature…'});
  const blind=await opts.judge(clone(build),idea,ctl.signal);active();
  const verdict={...blind,pass:blind.pass&&review.pass,fixes:[...review.fixes,...blind.fixes].slice(0,6)};
  const result={build,verdict,review,decisions,revisions,unused:Object.values(input).reduce((a,b)=>a+b,0)-state.pieces.length,excluded,resumed:!!retained};
  opts.debug?.('wholeModelComplete',{...result,build:clone(build)});
  return result;
 }catch(error){opts.debug?.('wholeModelStopped',{subject:idea.name,error:msg(error),checkpoint:checkpoint?clone(checkpoint):undefined});throw error;}
 finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
}
