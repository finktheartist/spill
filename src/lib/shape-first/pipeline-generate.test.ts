import {afterEach,describe,it,expect,vi} from 'vitest';
import {generate} from './pipeline';
import {judgeBuild} from '../gemini';
const contents=[{role:'user' as const,parts:[{text:'Original stock and action request'}]}];
const reply=(finishReason='STOP',token?:string)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason,continuationToken:token,content:{role:'model',parts:[{text:'{"ok":true}'}]}}]}),{status:200});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const limited=(wait='1')=>new Response('{"error":{"code":429}}',{status:429,headers:{'Retry-After':wait}});
const native=(finishReason:string,text:string,token?:string)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason,...(token?{continuationToken:token}:{}),content:{role:'model',parts:[{text}]}}]}));
describe('transport 429 delivery recovery around native decisions',()=>{
 it('redelivers byte-identical first-hop requests and reports every HTTP response separately from native hops',async()=>{
  vi.useFakeTimers();const fetch=vi.fn().mockResolvedValueOnce(limited('1')).mockResolvedValueOnce(limited('2')).mockResolvedValueOnce(reply());
  vi.stubGlobal('fetch',fetch);const progress=vi.fn();
  const pending=generate<{ok:boolean}>(contents,{type:'OBJECT'},undefined,'low',progress);
  await vi.advanceTimersByTimeAsync(1000);expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);const out=await pending;
  expect(out.json).toEqual({ok:true});expect(out.hops).toHaveLength(1);
  expect(out.deliveryAttempts?.map(a=>[a.hop,a.attempt,a.status])).toEqual([[1,1,429],[1,2,429],[1,3,200]]);
  expect(fetch.mock.calls.map(c=>c[1].body)).toEqual(Array(3).fill(fetch.mock.calls[0][1].body));
  expect(JSON.parse(fetch.mock.calls[0][1].body).generationConfig).toMatchObject({maxOutputTokens:32768,thinkingConfig:{thinkingLevel:'high'}});
  const retries=progress.mock.calls.map(([event])=>event).filter(e=>e.retry);
  expect(retries).toMatchObject([{phase:'start',hop:1,maxOutputTokens:32768,status:429,retry:{attempt:1,nextAttempt:2,waitMs:1000}},{phase:'start',hop:1,maxOutputTokens:32768,status:429,retry:{attempt:2,nextAttempt:3,waitMs:2000}}]);
  expect(JSON.stringify({retries,deliveries:out.deliveryAttempts})).not.toMatch(/parts|contents|continuationToken|Original stock/);
 });
 it('retries the exact continuation hop with its current token and 98304 ceiling without a new first hop',async()=>{
  vi.useFakeTimers();const fetch=vi.fn().mockResolvedValueOnce(native('MAX_TOKENS','','test-continued-state')).mockResolvedValueOnce(limited()).mockResolvedValueOnce(native('STOP','{"ok":true}'));
  vi.stubGlobal('fetch',fetch);const progress=vi.fn(),pending=generate(contents,{},undefined,'medium',undefined,progress);
  await vi.advanceTimersByTimeAsync(1000);const out=await pending;
  expect(fetch).toHaveBeenCalledTimes(3);const first=JSON.parse(fetch.mock.calls[0][1].body),next=JSON.parse(fetch.mock.calls[1][1].body);
  expect(next).toEqual({...first,generationConfig:{...first.generationConfig,maxOutputTokens:98304},continuationToken:'test-continued-state'});
  expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[1][1].body);
  expect(out.hops?.map(h=>[h.hop,h.finishReason])).toEqual([[1,'MAX_TOKENS'],[2,'STOP']]);
  expect(out.deliveryAttempts?.map(a=>[a.hop,a.attempt,a.status])).toEqual([[1,1,200],[2,1,429],[2,2,200]]);
  expect(progress.mock.calls.map(([e])=>e).filter(e=>e.retry)).toMatchObject([{hop:2,maxOutputTokens:98304,status:429,retry:{waitMs:1000}}]);
 });
 it('classic wrapper also redelivers the same request after 429 before its separate subject match',async()=>{
  vi.useFakeTimers();const verdict={looksLike:'Castle',recognizable:4,complete:4,colors:4,impressive:4,fixes:[]};
  const fetch=vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(native('STOP',JSON.stringify(verdict))).mockResolvedValueOnce(native('STOP','{"matchesSubject":true}'));
  vi.stubGlobal('fetch',fetch);const pending=judgeBuild({name:'Castle',pitch:'A castle',estimatedParts:43,difficulty:2,keyParts:[]},['data:image/png;base64,test'],43,43);
  await vi.advanceTimersByTimeAsync(1000);expect((await pending).named).toBe(true);expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);expect(fetch.mock.calls[2][1].body).not.toBe(fetch.mock.calls[0][1].body);
 });
 it('cancels the 429 wait before any redelivery or native continuation can run',async()=>{
  vi.useFakeTimers();const ctl=new AbortController(),fetch=vi.fn().mockResolvedValueOnce(limited('30'));vi.stubGlobal('fetch',fetch);
  const pending=generate(contents,{},ctl.signal),caught=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(1000);ctl.abort();await caught;await vi.advanceTimersByTimeAsync(60000);expect(fetch).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 });
 it('returns exhausted 429 to the decoder and never restarts the logical decision',async()=>{
  vi.useFakeTimers();const fetch=vi.fn().mockImplementation(async()=>limited('1'));vi.stubGlobal('fetch',fetch);
  const pending=generate(contents,{}),caught=expect(pending).rejects.toMatchObject({status:429});
  await vi.advanceTimersByTimeAsync(3000);await caught;expect(fetch).toHaveBeenCalledTimes(4);expect(new Set(fetch.mock.calls.map(c=>c[1].body)).size).toBe(1);
 });
});
describe('native generation failure and cancellation boundaries',()=>{
 it.each(['network','http'])('fails closed without restarting the original decision after %s error',async kind=>{
  const fetch=vi.fn();
  if(kind==='network')fetch.mockRejectedValueOnce(new Error('Disconnected'));
  else fetch.mockResolvedValueOnce(new Response('{}',{status:503,headers:{'Retry-After':'600'}}));
  vi.stubGlobal('fetch',fetch);await expect(generate(contents,{})).rejects.toThrow(kind==='network'?'Disconnected':'HTTP 503');
  expect(fetch).toHaveBeenCalledOnce();
 });
 it('does not restart a paid decision when a continuation fails',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply('MAX_TOKENS','test-state')).mockResolvedValueOnce(new Response('{}',{status:503}));
  vi.stubGlobal('fetch',fetch);await expect(generate(contents,{})).rejects.toThrow('HTTP 503');expect(fetch).toHaveBeenCalledTimes(2);
  const first=JSON.parse(fetch.mock.calls[0][1].body),second=JSON.parse(fetch.mock.calls[1][1].body);
  expect(first.generationConfig.maxOutputTokens).toBe(32768);expect(second.generationConfig.maxOutputTokens).toBe(98304);
  expect(second.contents).toEqual(first.contents);expect(second.continuationToken).toBe('test-state');
 });
 it('does not parse action JSON from an incomplete response without a continuation token',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply('MAX_TOKENS'));vi.stubGlobal('fetch',fetch);
  await expect(generate(contents,{})).rejects.toThrow('Missing continuation token');expect(fetch).toHaveBeenCalledOnce();
 });
 it('settles cancellation while a dispatched request ignores AbortSignal',async()=>{
  const ctl=new AbortController();let started!:()=>void;const dispatched=new Promise<void>(resolve=>{started=resolve;});
  const fetch=vi.fn(()=>{started();return new Promise<Response>(()=>{});});vi.stubGlobal('fetch',fetch);
  const pending=generate(contents,{},ctl.signal);await dispatched;ctl.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(fetch).toHaveBeenCalledOnce();
 });
 it('does not call the provider for an already stopped request',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(generate(contents,{},AbortSignal.abort())).rejects.toMatchObject({name:'AbortError'});expect(fetch).not.toHaveBeenCalled();
 });
});
