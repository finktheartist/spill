/** Native Gemini REST continuation. No retry, model fallback or partial action.
 * Gemini response handling with bounded continuation when supported.
 * The caller owns the overall deadline and the transport for each hop.
 */
import type { RateLimitRetry } from './gemini-rate-limit';
export const GEMINI_INITIAL_TOKENS = 32768;
export const GEMINI_TOTAL_TOKENS = 98304;
export interface NativePart extends Record<string, unknown> {
  text?: string; thought?: boolean; thoughtSignature?: string;
}
export interface NativeContent { role?: 'user' | 'model'; parts: NativePart[] }
export interface GeminiRequest extends Record<string, unknown> {
  contents: NativeContent[];
  generationConfig: Record<string, unknown> & {maxOutputTokens: number};
  continuationToken?: string;
}
export interface NativeUsage extends Record<string, unknown> {
  promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number;
  totalTokenCount?: number; initialPromptTokenCount?: number | null;
}
export interface NativeCandidate extends Record<string, unknown> {
  index?: number; content?: NativeContent; finishReason?: string; continuationToken?: string;
}
export interface NativeResponse extends Record<string, unknown> {
  modelVersion: string; candidates: NativeCandidate[]; usageMetadata?: NativeUsage;
}
export interface GeminiHopReceipt {
  hop: number; status: number; elapsedMs: number; maxOutputTokens: number;
  finishReason: string | null; modelVersion: string | null;
  hasContinuationToken: boolean; usageMetadata: Record<string,number> | null;
}
export type GeminiHopEvent = {phase:'start'; hop:number; request:GeminiRequest} |
  {phase:'complete'; hop:number; request:GeminiRequest; raw:string; data:unknown; status:number; elapsedMs:number};
export interface GeminiProgress {
  phase:'start'|'complete'; hop:number; maxOutputTokens:number;
  status?:number; elapsedMs?:number; finishReason?:string;
  /** Transport retry of this same native hop, not a new reasoning request. */
  retry?:RateLimitRetry;
}
export type GeminiProgressCallback = (progress:GeminiProgress) => void | Promise<void>;
export interface GenerateDecisionOptions {
  body:unknown;
  fetchHop:(request:GeminiRequest,context:{hop:number; signal?:AbortSignal})=>Promise<Response>;
  signal?:AbortSignal; maxTotalTokens?:number; maxHops?:number;
  onHop?:(event:GeminiHopEvent)=>void|Promise<void>;
}
export interface DecisionResult {
  response:NativeResponse & {candidates:[NativeCandidate & {finishReason:'STOP'; content:NativeContent}]};
  hops:GeminiHopReceipt[]; initialPromptTokenCount:number|null;
}
const clone = <T>(value:T):T => structuredClone(value);
const object = (value:unknown):value is Record<string,unknown> => value!==null && typeof value==='object' && !Array.isArray(value);
export class DecisionDecodeError extends Error {
  readonly hops:GeminiHopReceipt[];
  constructor(message:string,hops:GeminiHopReceipt[]=[],options?:ErrorOptions,public status?:number) {
    super(message,options);this.name='DecisionDecodeError';this.hops=clone(hops);
  }
}

async function abortable<T>(run:()=>T|Promise<T>,signal?:AbortSignal):Promise<T> {
  if(signal?.aborted)throw signal.reason??new DOMException('Stopped','AbortError');
  if(!signal)return await run();
  let onAbort:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(signal.reason??new DOMException('Stopped','AbortError'));
    signal.addEventListener('abort',onAbort,{once:true});
  });
  try {
    if(signal.aborted)onAbort();
    return await Promise.race([Promise.resolve().then(()=>{
      if(signal.aborted)throw signal.reason??new DOMException('Stopped','AbortError');return run();
    }),cancelled]);
  } finally {signal.removeEventListener('abort',onAbort);}
}
function validateBody(body:unknown):asserts body is GeminiRequest {
  if(!object(body)||!Array.isArray(body.contents)||!body.contents.length||!object(body.generationConfig))throw new DecisionDecodeError('Provide original native contents and generationConfig.');
  const config=body.generationConfig,thinking=config.thinkingConfig;
  if(body.continuationToken!==undefined||config.continuationToken!==undefined)throw new DecisionDecodeError('A fresh decision must not contain a prepaid continuation token.');
  if(config.maxOutputTokens!==GEMINI_INITIAL_TOKENS)throw new DecisionDecodeError('The first non-streaming request must use maxOutputTokens 32768.');
  if(!object(thinking)||thinking.thinkingLevel!=='high'||thinking.thinkingBudget!==undefined)throw new DecisionDecodeError('Gemini/high is required without a conflicting thinkingBudget.');
  if(config.candidateCount!==undefined&&config.candidateCount!==1)throw new DecisionDecodeError('Continuation decisions require exactly one candidate.');
  if(body.model!==undefined)throw new DecisionDecodeError('Model selection belongs to the server configuration.');
  if(body.contents.some(c=>!object(c)||!Array.isArray(c.parts)||!c.parts.length||!c.parts.every(object)||(c.role!==undefined&&c.role!=='user'&&c.role!=='model')))throw new DecisionDecodeError('Each original content needs native parts and an optional user/model role.');
  let nodes=0;
  const visit=(value:unknown,depth:number,ancestors:Set<object>)=>{
    if(++nodes>200000||depth>64)throw new DecisionDecodeError('Native request exceeds bounded JSON depth/size.');
    if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
    if(!object(value)&&!Array.isArray(value))throw new DecisionDecodeError('Native request must contain only finite JSON values.');
    if(ancestors.has(value))throw new DecisionDecodeError('Native request must not be cyclic.');
    if(object(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new DecisionDecodeError('Native request must use plain JSON objects.');
    ancestors.add(value);for(const child of Object.values(value))visit(child,depth+1,ancestors);ancestors.delete(value);
  };
  visit(body,0,new Set());
}
function validateUsage(usage:unknown):asserts usage is NativeUsage|undefined {
  if(usage===undefined)return;
  if(!object(usage))throw Error('Malformed native usageMetadata.');
  for(const [key,value] of Object.entries(usage)){
    if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<0))throw Error(`Malformed native usage count ${key}.`);
    if(key.endsWith('TokenCount')&&typeof value!=='number')throw Error(`Malformed native usage count ${key}.`);
  }
}
function validateResponse(data:unknown):asserts data is NativeResponse {
  if(!object(data)||data.error!==undefined||(object(data.promptFeedback)&&data.promptFeedback.blockReason))throw Error('Gemini returned an error or blocked prompt.');
  if(typeof data.modelVersion!=='string'||!/^gemini-[a-z0-9][a-z0-9._-]*$/.test(data.modelVersion))throw Error('Gemini model drift or missing modelVersion.');
  if(!Array.isArray(data.candidates)||data.candidates.length!==1||!object(data.candidates[0]))throw Error('Expected exactly one native candidate with index 0.');
  const c=data.candidates[0];if(c.index!==undefined&&c.index!==0)throw Error('Expected native candidate index 0.');
  if(c.content!==undefined){
    if(!object(c.content)||(c.content.role!==undefined&&c.content.role!=='model')||!Array.isArray(c.content.parts)||!c.content.parts.every(object))throw Error('Malformed native candidate content/parts.');
    for(const p of c.content.parts)if((p.text!==undefined&&typeof p.text!=='string')||(p.thought!==undefined&&typeof p.thought!=='boolean')||(p.thoughtSignature!==undefined&&typeof p.thoughtSignature!=='string'))throw Error('Malformed native part text, thought flag or signature.');
  }
  validateUsage(data.usageMetadata);
}
/** Small progress objects intentionally exclude all request/response parts and
 * opaque continuation tokens; the raw helper event is available only by opt-in. */
export function decisionProgress(event:GeminiHopEvent):GeminiProgress {
  const base={phase:event.phase,hop:event.hop,maxOutputTokens:event.request.generationConfig.maxOutputTokens};
  if(event.phase==='start')return base;
  const candidate=object(event.data)&&Array.isArray(event.data.candidates)?event.data.candidates[0]:undefined;
  return {...base,status:event.status,elapsedMs:event.elapsedMs,...(object(candidate)&&typeof candidate.finishReason==='string'?{finishReason:candidate.finishReason}:{})};
}

/** Exactly one decision: start at 32768, escalate once on MAX_TOKENS, then keep
 * that total on CONTINUATION. Never append partial output to original contents.
 * Every native part stays separate, including signed/empty/thought parts.
 * Numeric top-level usage counts sum; first-hop prompt size is separate.
 */
export async function generateDecision({body,fetchHop,signal,maxTotalTokens=GEMINI_TOTAL_TOKENS,maxHops=3,onHop}:GenerateDecisionOptions):Promise<DecisionResult> {
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  validateBody(body);
  if(typeof fetchHop!=='function'||(onHop!==undefined&&typeof onHop!=='function'))throw new DecisionDecodeError('Provide fetchHop and optional onHop callback.');
  if(!Number.isSafeInteger(maxTotalTokens)||maxTotalTokens<=GEMINI_INITIAL_TOKENS||maxTotalTokens>GEMINI_TOTAL_TOKENS)throw new DecisionDecodeError('maxTotalTokens must be an integer above 32768 and at most 98304.');
  if(!Number.isSafeInteger(maxHops)||maxHops<1||maxHops>3)throw new DecisionDecodeError('maxHops must be an integer from 1 to 3.');
  if(signal!==undefined&&!(signal instanceof AbortSignal))throw new DecisionDecodeError('signal must be an AbortSignal.');
  const original=clone(body),parts:NativePart[]=[],hops:GeminiHopReceipt[]=[],tokens=new Set<string>(),counts:Record<string,number>={};
  let ceiling=GEMINI_INITIAL_TOKENS,token:string|undefined,initialPromptTokenCount:number|null=null,generated=0;
  let responseModel:string|undefined;
  const notify=async(event:GeminiHopEvent)=>{if(onHop)await abortable(()=>onHop(clone(event)),signal);};
  try {
    for(let hop=1;hop<=maxHops;hop++){
      const request=clone(original);request.generationConfig.maxOutputTokens=ceiling;if(token!==undefined)request.continuationToken=token;
      await notify({phase:'start',hop,request});const started=performance.now();
      const wire=await abortable(()=>fetchHop(clone(request),{hop,signal}),signal);
      if(!wire||typeof wire.text!=='function'||!Number.isInteger(wire.status))throw Error('fetchHop must return a native Response.');
      const raw=await abortable(()=>wire.text(),signal);let data:unknown=null,parseError:unknown;
      try{data=JSON.parse(raw);}catch(error){parseError=error;}
      const elapsedMs=Math.round(performance.now()-started),candidate=object(data)&&Array.isArray(data.candidates)&&object(data.candidates[0])?data.candidates[0]:undefined;
      hops.push({hop,status:wire.status,elapsedMs,maxOutputTokens:ceiling,
        finishReason:typeof candidate?.finishReason==='string'?candidate.finishReason:null,
        modelVersion:object(data)&&typeof data.modelVersion==='string'?data.modelVersion:null,
        hasContinuationToken:typeof candidate?.continuationToken==='string'&&candidate.continuationToken.length>0,
        usageMetadata:object(data)&&object(data.usageMetadata)?Object.fromEntries(Object.entries(data.usageMetadata).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&Number.isSafeInteger(entry[1])&&entry[1]>=0)):null});
      await notify({phase:'complete',hop,request,raw,data,status:wire.status,elapsedMs});
      if(signal?.aborted)throw new DOMException('Stopped','AbortError');
      if(wire.status<200||wire.status>=300)throw new DecisionDecodeError(`Gemini hop ${hop} failed with HTTP ${wire.status}.`,hops,undefined,wire.status);
      if(parseError)throw Error(`Gemini hop ${hop} returned invalid JSON.`,{cause:parseError});
      validateResponse(data);
      if(responseModel!==undefined&&data.modelVersion!==responseModel)throw Error('Gemini model drift during continuation.');
      responseModel=data.modelVersion;
      const c=data.candidates[0],usage=data.usageMetadata??{};
      if(hop===1)initialPromptTokenCount=usage.promptTokenCount??null;
      for(const [key,value] of Object.entries(usage))if(typeof value==='number'&&key!=='initialPromptTokenCount'){
        counts[key]=(counts[key]??0)+value;if(!Number.isSafeInteger(counts[key]))throw Error('Aggregated usage exceeds safe integer bounds.');
      }
      generated+=(usage.candidatesTokenCount??0)+(usage.thoughtsTokenCount??0);
      if(generated>ceiling)throw Error('Native generated-token usage exceeds selected total ceiling.');
      parts.push(...clone(c.content?.parts??[]));
      if(c.finishReason==='STOP'){
        const response=clone(data),finished={...response.candidates[0],finishReason:'STOP' as const,content:{...(c.content??{}),role:'model' as const,parts}};
        delete finished.continuationToken;
        return {response:{...response,candidates:[finished],usageMetadata:{...(response.usageMetadata??{}),...counts,initialPromptTokenCount}},hops:clone(hops),initialPromptTokenCount};
      }
      if(c.finishReason!=='CONTINUATION'&&c.finishReason!=='MAX_TOKENS')throw Error('Gemini decision stopped incompletely.');
      const next=c.continuationToken;if(typeof next!=='string'||!next.trim())throw Error('Missing continuation token after incomplete generation.');
      if(tokens.has(next))throw Error('Repeated continuation token; refusing duplicate hop.');tokens.add(next);
      if(c.finishReason==='MAX_TOKENS'){
        if(ceiling!==GEMINI_INITIAL_TOKENS)throw Error(`Gemini exhausted maxTotalTokens ${maxTotalTokens}; no actionable result.`);ceiling=maxTotalTokens;
      }
      if(generated>=ceiling)throw Error('Continuation has no remaining token budget.');
      if(hop===maxHops)throw Error(`Gemini decision exceeded the ${maxHops}-hop cap before STOP.`);
      token=next;
    }
    throw Error('Gemini decision did not reach STOP.');
  } catch(error) {
    // Existing generation callers distinguish cancellation from failed design.
    if(signal?.aborted)throw new DOMException('Stopped','AbortError');
    if(error instanceof DecisionDecodeError||error instanceof Error&&error.name==='AbortError')throw error;
    throw new DecisionDecodeError(error instanceof Error?error.message:'Gemini decision failed.',hops,{cause:error});
  }
}
