import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchWithRateLimitRetry,type RateLimitRetry} from './gemini-rate-limit';
import {generateDecision,type GeminiRequest} from './gemini-decode';

const native=(reason='STOP',token?:string)=>({modelVersion:'gemini-test-model',candidates:[{index:0,finishReason:reason,content:{role:'model',parts:[{text:reason==='STOP'?'{}':''}]},...(token?{continuationToken:token}:{})}]});
const reply=(status=200,retryAfter?:string)=>new Response(JSON.stringify(status===200?native():{error:{code:status}}),{status,headers:retryAfter===undefined?{}:{'Retry-After':retryAfter}});
const body=()=>({contents:[{role:'user' as const,parts:[{text:'Original stock/schema'},{thoughtSignature:'test-signed-part'}]}],generationConfig:{maxOutputTokens:32768,thinkingConfig:{thinkingLevel:'high'},responseJsonSchema:{type:'object'}}});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it('retries 429 twice with byte-identical serialized contents/schema/token and preserves final Response',async()=>{
  const request={...body(),continuationToken:'test-opaque-continuation'},serialized=JSON.stringify(request),seen:string[]=[],events:RateLimitRetry[]=[];
  const final=reply(),replies=[reply(429,'1'),reply(429,'2'),final];
  const fetchAttempt=vi.fn(async(raw:string)=>{seen.push(raw);return replies[seen.length-1];});
  const pending=fetchWithRateLimitRetry({body:serialized,fetchAttempt,onRetry:e=>{events.push({...e});e.waitMs=60000;}});
  await vi.advanceTimersByTimeAsync(1000);expect(fetchAttempt).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);const result=await pending;
  expect(seen).toEqual([serialized,serialized,serialized]);expect(JSON.parse(seen[2]).continuationToken).toBe('test-opaque-continuation');
  expect(result.response).toBe(final);expect(final.bodyUsed).toBe(false);expect(await final.json()).toEqual(native());
  expect(events.map(e=>[e.attempt,e.nextAttempt,e.waitMs])).toEqual([[1,2,1000],[2,3,2000]]);
  expect(result.attempts.map(a=>a.disposition)).toEqual(['retry','retry','response']);
  expect(JSON.stringify({events,attempts:result.attempts})).not.toMatch(/test-opaque|contents|schema|thoughtSignature|continuationToken/);
});
it('can wrap a continued native hop without restarting reasoning or changing its ceiling',async()=>{
  const requests:GeminiRequest[]=[],serialized:string[]=[],events:RateLimitRetry[]=[];
  const decision=generateDecision({body:body(),fetchHop:async(request)=>{
    requests.push(structuredClone(request));let count=0;
    const result=await fetchWithRateLimitRetry({body:JSON.stringify(request),fetchAttempt:async raw=>{
      serialized.push(raw);count++;
      if(requests.length===1)return new Response(JSON.stringify(native('MAX_TOKENS','test-state')));
      return count===1?reply(429,'1'):new Response(JSON.stringify(native()));
    },onRetry:e=>{events.push(e);}});return result.response;
  }});
  await vi.advanceTimersByTimeAsync(1000);const result=await decision;
  expect(requests).toHaveLength(2);expect(serialized).toHaveLength(3);expect(serialized[1]).toBe(serialized[2]);
  expect(JSON.parse(serialized[1])).toEqual({...body(),generationConfig:{...body().generationConfig,maxOutputTokens:98304},continuationToken:'test-state'});
  expect(result.hops).toHaveLength(2);expect(events).toHaveLength(1);expect(result.response.candidates[0].finishReason).toBe('STOP');
});
it('defaults missing or malformed Retry-After to 30 seconds, then returns the unread fourth 429',async()=>{
  const replies=[reply(429),reply(429,'not a date'),reply(429,'-1'),reply(429)],fetchAttempt=vi.fn(async()=>replies[fetchAttempt.mock.calls.length-1]);
  const pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt});
  await vi.advanceTimersByTimeAsync(89999);expect(fetchAttempt).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);const out=await pending;
  expect(fetchAttempt).toHaveBeenCalledTimes(4);expect(out.response).toBe(replies[3]);expect(out.response.bodyUsed).toBe(false);
  expect(out.attempts.map(a=>a.waitMs)).toEqual([30000,30000,30000,30000]);expect(out.attempts[3].disposition).toBe('retries-exhausted');
  expect(await out.response.json()).toEqual({error:{code:429}});expect(vi.getTimerCount()).toBe(0);
});
it('honors HTTP-date and the exact 60-second boundary; refuses larger seconds/dates without clamping',async()=>{
  for(const header of ['60','Thu, 15 Oct 2026 12:01:00 GMT']){
    const first=reply(429,header),fetchAttempt=vi.fn(async()=>fetchAttempt.mock.calls.length===1?first:reply());
    const pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt});await vi.advanceTimersByTimeAsync(59999);expect(fetchAttempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);expect((await pending).attempts[0].waitMs).toBe(60000);vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  }
  for(const header of ['61','60.001','Thu, 15 Oct 2026 12:01:01 GMT','999999999999999999999999999999999999999999']){
    const last=reply(429,header),fetchAttempt=vi.fn(async()=>last),onRetry=vi.fn();
    const out=await fetchWithRateLimitRetry({body:'{}',fetchAttempt,onRetry});expect(fetchAttempt).toHaveBeenCalledOnce();expect(onRetry).not.toHaveBeenCalled();
    expect(out.response).toBe(last);expect(out.response.bodyUsed).toBe(false);expect(out.attempts[0]).toMatchObject({disposition:'wait-exceeds-limit',retrying:false});expect(out.attempts[0].waitMs).toBeGreaterThan(60000);
  }
});
it('supports past dates/zero waits and a smaller explicit retry bound',async()=>{
  const fetchAttempt=vi.fn(async()=>reply(429,'Wed, 14 Oct 2026 12:00:00 GMT'));
  const pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt,maxRetries:1});await vi.runAllTimersAsync();const out=await pending;
  expect(fetchAttempt).toHaveBeenCalledTimes(2);expect(out.attempts[0].waitMs).toBe(0);expect(out.attempts[1].disposition).toBe('retries-exhausted');
  const none=vi.fn(async()=>reply(429,'0'));expect((await fetchWithRateLimitRetry({body:'{}',fetchAttempt:none,maxRetries:0})).attempts[0].disposition).toBe('retries-exhausted');expect(none).toHaveBeenCalledOnce();
});
it.each([200,400,401,408,500,503])('never retries HTTP %s or consumes its final response',async status=>{
  const wire=reply(status,'0'),fetchAttempt=vi.fn(async()=>wire),onRetry=vi.fn();
  const out=await fetchWithRateLimitRetry({body:'{}',fetchAttempt,onRetry});expect(out.response).toBe(wire);expect(wire.bodyUsed).toBe(false);expect(fetchAttempt).toHaveBeenCalledOnce();expect(onRetry).not.toHaveBeenCalled();expect(out.attempts[0].disposition).toBe('response');
});
it('does not retry network failures, including a network failure after one 429',async()=>{
  const error=new TypeError('test socket closed'),fetchAttempt=vi.fn(async()=>{throw error;});
  await expect(fetchWithRateLimitRetry({body:'{}',fetchAttempt})).rejects.toBe(error);expect(fetchAttempt).toHaveBeenCalledOnce();
  const later=vi.fn(async()=>{if(later.mock.calls.length===1)return reply(429,'1');throw error;});
  const pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt:later});const caught=expect(pending).rejects.toBe(error);await vi.advanceTimersByTimeAsync(1000);await caught;expect(later).toHaveBeenCalledTimes(2);
});
it('cancellation before dispatch or during a wait prevents any subsequent fetch and clears listeners/timers',async()=>{
  const stopped=new AbortController();stopped.abort();const unused=vi.fn(async()=>reply());
  await expect(fetchWithRateLimitRetry({body:'{}',fetchAttempt:unused,signal:stopped.signal})).rejects.toMatchObject({name:'AbortError'});expect(unused).not.toHaveBeenCalled();
  const ctl=new AbortController(),added=vi.spyOn(ctl.signal,'addEventListener'),removed=vi.spyOn(ctl.signal,'removeEventListener');
  const fetchAttempt=vi.fn(async()=>reply(429,'30')),pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt,signal:ctl.signal});
  const caught=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.advanceTimersByTimeAsync(1000);ctl.abort();await caught;await vi.advanceTimersByTimeAsync(60000);
  expect(fetchAttempt).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);expect(removed.mock.calls.map(c=>c[1])).toEqual(added.mock.calls.map(c=>c[1]));
});
it('cancellation wins against an ignored fetch, its late 429, and abort just before fetch resolves',async()=>{
  const ctl=new AbortController();let resolve!:(r:Response)=>void;const fetchAttempt=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));
  const pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt,signal:ctl.signal}),caught=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(0);ctl.abort();await caught;resolve(reply(429,'0'));await vi.runAllTimersAsync();expect(fetchAttempt).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  const after=new AbortController(),last=vi.fn(async()=>{after.abort();return reply();});
  await expect(fetchWithRateLimitRetry({body:'{}',fetchAttempt:last,signal:after.signal})).rejects.toMatchObject({name:'AbortError'});expect(last).toHaveBeenCalledOnce();
});
it('awaits retry notification, aborts an ignored callback, and never retries after persistence fails',async()=>{
  const ctl=new AbortController(),fetchAttempt=vi.fn(async()=>reply(429,'0'));
  const pending=fetchWithRateLimitRetry({body:'{}',fetchAttempt,signal:ctl.signal,onRetry:()=>new Promise<void>(()=>{})}),caught=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(0);ctl.abort();await caught;expect(fetchAttempt).toHaveBeenCalledOnce();
  const other=vi.fn(async()=>reply(429,'0')),error=new Error('test persistence failure');
  await expect(fetchWithRateLimitRetry({body:'{}',fetchAttempt:other,onRetry:()=>{throw error;}})).rejects.toBe(error);expect(other).toHaveBeenCalledOnce();
});
it('cleans abort listeners on success/exhaustion and rejects unsafe policies before fetch',async()=>{
  for(const status of [200,429]){
    const ctl=new AbortController(),add=vi.spyOn(ctl.signal,'addEventListener'),remove=vi.spyOn(ctl.signal,'removeEventListener');
    await fetchWithRateLimitRetry({body:'{}',signal:ctl.signal,fetchAttempt:async()=>reply(status),maxRetries:0});expect(remove.mock.calls.map(c=>c[1])).toEqual(add.mock.calls.map(c=>c[1]));
  }
  const fetchAttempt=vi.fn(async()=>reply());
  for(const maxRetries of [-1,1.5,4,Infinity,NaN])await expect(fetchWithRateLimitRetry({body:'{}',fetchAttempt,maxRetries})).rejects.toThrow(/0 to 3/);
  await expect(fetchWithRateLimitRetry({body:'',fetchAttempt})).rejects.toThrow(/serialized body/);expect(fetchAttempt).not.toHaveBeenCalled();
});
