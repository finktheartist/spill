/** Transport-only 429 recovery for ONE serialized native request/hop.
 * Does not inspect or rebuild contents, continuation tokens or native parts.
 * Not wired into generation until the caller explicitly adopts it.
 */
export const GEMINI_RATE_LIMIT_DEFAULT_WAIT_MS = 30000;
export const GEMINI_RATE_LIMIT_MAX_WAIT_MS = 60000;
export const GEMINI_RATE_LIMIT_MAX_RETRIES = 3;

export interface RateLimitAttempt {
  /** One-based physical fetch attempt, independent of native continuation hop. */
  attempt:number;
  status:number;
  /** Parsed server delay, or null for an absent/invalid Retry-After header. */
  retryAfterMs:number|null;
  /** Proposed delay; null for a non-429 response. Never silently clamped. */
  waitMs:number|null;
  retrying:boolean;
  disposition:'response'|'retry'|'retries-exhausted'|'wait-exceeds-limit';
}
export interface RateLimitRetry extends RateLimitAttempt {
  status:429; retrying:true; disposition:'retry'; waitMs:number;
  nextAttempt:number;
}
export interface RateLimitOptions {
  /** Serialize once before calling. The exact same immutable string is reused. */
  body:string;
  fetchAttempt:(body:string,context:{attempt:number;signal?:AbortSignal})=>Promise<Response>;
  signal?:AbortSignal;
  /** Additional attempts, bounded to 0..3. */
  maxRetries?:number;
  /** Awaited before the cancellable wait. Contains no body, token or headers. */
  onRetry?:(retry:RateLimitRetry)=>void|Promise<void>;
}
export interface RateLimitResult {response:Response;attempts:RateLimitAttempt[]}

function checkAbort(signal?:AbortSignal):void {
  if(signal?.aborted)throw signal.reason??new DOMException('Stopped','AbortError');
}
async function abortable<T>(run:()=>T|Promise<T>,signal?:AbortSignal):Promise<T> {
  checkAbort(signal);
  if(!signal)return await run();
  let onAbort:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(signal.reason??new DOMException('Stopped','AbortError'));
    signal.addEventListener('abort',onAbort,{once:true});
  });
  try {
    checkAbort(signal);
    const value=await Promise.race([Promise.resolve().then(()=>{checkAbort(signal);return run();}),cancelled]);
    checkAbort(signal);return value;
  } finally {signal.removeEventListener('abort',onAbort);}
}
function delay(ms:number,signal?:AbortSignal):Promise<void> {
  checkAbort(signal);
  return new Promise((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
    const onAbort=()=>{cleanup();reject(signal?.reason??new DOMException('Stopped','AbortError'));};
    timer=setTimeout(()=>{cleanup();resolve();},ms);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();
  });
}
function retryAfter(header:string|null):number|null {
  if(header===null||!header.trim())return null;
  const value=header.trim();
  if(/^\d+(?:\.\d+)?$/.test(value)){
    const ms=Number(value)*1000;
    // Huge positive numeric values must be refused, not treated as missing.
    return Number.isFinite(ms)?Math.ceil(ms):Number.MAX_VALUE;
  }
  // Avoid Date.parse treating malformed numeric delays (e.g. "-1") as dates.
  if(!/[A-Za-z]{3}/.test(value))return null;
  const date=Date.parse(value);
  return Number.isFinite(date)?Math.max(0,date-Date.now()):null;
}
function discard(response:Response):void {
  // Intermediate 429s are not returned. Release their stream without reading or
  // exposing its body; a stream ignoring cancellation cannot stall the caller.
  try {void response.body?.cancel().catch(()=>{});} catch { /* Already closed. */ }
}

/** Retry explicit 429s only. Final responses remain unread for the strict decoder.
 * HTTP errors other than 429 and transport errors are never retried. An excessive
 * Retry-After or exhausted budget returns the last 429 honestly, with receipts.
 * The caller's signal covers fetch, callbacks and waits, even ignored transports.
 */
export async function fetchWithRateLimitRetry({body,fetchAttempt,signal,maxRetries=GEMINI_RATE_LIMIT_MAX_RETRIES,onRetry}:RateLimitOptions):Promise<RateLimitResult> {
  checkAbort(signal);
  if(typeof body!=='string'||!body.length||typeof fetchAttempt!=='function'||(onRetry!==undefined&&typeof onRetry!=='function'))throw new TypeError('Provide a serialized body, fetchAttempt and optional onRetry callback.');
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0||maxRetries>GEMINI_RATE_LIMIT_MAX_RETRIES)throw new RangeError('maxRetries must be an integer from 0 to 3.');
  const attempts:RateLimitAttempt[]=[];
  for(let attempt=1;attempt<=maxRetries+1;attempt++){
    checkAbort(signal);
    const response=await abortable(async()=>{
      checkAbort(signal);
      const wire=await fetchAttempt(body,{attempt,signal});
      if(signal?.aborted){discard(wire);checkAbort(signal);}
      return wire;
    },signal);
    checkAbort(signal);
    if(!response||!Number.isInteger(response.status)||typeof response.headers?.get!=='function')throw new TypeError('fetchAttempt must return a Response.');
    if(response.status!==429){
      attempts.push({attempt,status:response.status,retryAfterMs:null,waitMs:null,retrying:false,disposition:'response'});
      return {response,attempts};
    }
    const retryAfterMs=retryAfter(response.headers.get('retry-after'));
    const waitMs=retryAfterMs??GEMINI_RATE_LIMIT_DEFAULT_WAIT_MS;
    const disposition=attempt>maxRetries?'retries-exhausted':waitMs>GEMINI_RATE_LIMIT_MAX_WAIT_MS?'wait-exceeds-limit':'retry';
    const receipt:RateLimitAttempt={attempt,status:429,retryAfterMs,waitMs,retrying:disposition==='retry',disposition};
    attempts.push(receipt);
    if(disposition!=='retry')return {response,attempts};
    if(onRetry)await abortable(()=>onRetry({...receipt,status:429,retrying:true,disposition:'retry',waitMs,nextAttempt:attempt+1}),signal);
    checkAbort(signal);discard(response);
    await delay(waitMs,signal);
  }
  throw new Error('Unreachable rate-limit retry bound.');
}
