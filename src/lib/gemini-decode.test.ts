import {afterEach,it,expect,vi} from 'vitest';
import {generateDecision,DecisionDecodeError,decisionProgress,type GeminiRequest,type NativePart,type GeminiHopEvent} from './gemini-decode';
import {generate,api} from './shape-first/pipeline';
import {judgeBuild} from './gemini';

const body=()=>({contents:[{role:'user' as const,parts:[{text:'Exact stock JSON unchanged'},{inlineData:{mimeType:'image/png',data:'test-only-image'}}]}],systemInstruction:{parts:[{text:'Original instruction'}]},tools:[{functionDeclarations:[{name:'unchanged'}]}],generationConfig:{maxOutputTokens:32768,thinkingConfig:{thinkingLevel:'high'},responseJsonSchema:{type:'object'},responseMimeType:'application/json',mediaResolution:'MEDIA_RESOLUTION_HIGH'}});
interface MockOptions {token?:unknown;parts?:NativePart[];model?:string;prompt?:number;thoughts?:number;output?:number;extra?:Record<string,unknown>}
const native=(finishReason:string|undefined,{token,parts=[],model='gemini-test-model',prompt=10,thoughts=0,output=0,extra={}}:MockOptions={})=>({candidates:[{index:0,content:{role:'model',parts},finishReason,...(token===undefined?{}:{continuationToken:token})}],modelVersion:model,responseId:'test-response',usageMetadata:{promptTokenCount:prompt,candidatesTokenCount:output,thoughtsTokenCount:thoughts,totalTokenCount:prompt+thoughts+output,cachedContentTokenCount:1},...extra});
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
function scripted(data:unknown[]){
  const requests:GeminiRequest[]=[],contexts:{hop:number;signal?:AbortSignal}[]=[];
  const fetchHop=vi.fn(async(request:GeminiRequest,context:{hop:number;signal?:AbortSignal})=>{
    requests.push(structuredClone(request));contexts.push(context);
    expect(requests.length).toBeLessThanOrEqual(data.length);
    const next=data[requests.length-1];if(next instanceof Error)throw next;return next instanceof Response?next:response(next);
  });
  return {requests,contexts,fetchHop};
}
afterEach(()=>{vi.unstubAllGlobals();api.base='';});

it('recovers the observed all-thinking MAX_TOKENS response, then preserves every signed part through CONTINUATION/STOP',async()=>{
  const original=body(),saved=structuredClone(original),controller=new AbortController();
  const a:NativePart[]=[{text:'',thoughtSignature:'test-empty-signature'}];
  const b:NativePart[]=[{text:'not actionable',thought:true,thoughtSignature:'test-thought'},{text:'{"ok":',thoughtSignature:'test-A'}];
  const c:NativePart[]=[{text:'true}',thoughtSignature:'test-B'},{functionCall:{name:'example',args:{n:1}},thoughtSignature:'test-call'}];
  const wire=scripted([native('MAX_TOKENS',{token:'test-state-a',parts:a,prompt:10,thoughts:32765}),native('CONTINUATION',{token:'test-state-b',parts:b,prompt:32775,thoughts:20000,output:5}),native('STOP',{parts:c,prompt:52780,thoughts:20,output:7})]);
  const events:GeminiHopEvent[]=[],order:string[]=[];
  const result=await generateDecision({body:original,signal:controller.signal,fetchHop:async(request,context)=>{order.push(`fetch-${context.hop}`);return wire.fetchHop(request,context);},onHop:async event=>{
    await Promise.resolve();events.push(structuredClone(event));order.push(`${event.phase}-${event.hop}`);event.request.contents[0].parts[0].text='callback mutation';
  }});
  expect(order).toEqual(['start-1','fetch-1','complete-1','start-2','fetch-2','complete-2','start-3','fetch-3','complete-3']);
  expect(original).toEqual(saved);expect(wire.requests.map(r=>r.generationConfig.maxOutputTokens)).toEqual([32768,98304,98304]);
  for(const [i,request] of wire.requests.entries()){
    const expected:GeminiRequest=structuredClone(saved);expected.generationConfig.maxOutputTokens=i?98304:32768;
    if(i)expected.continuationToken=i===1?'test-state-a':'test-state-b';expect(request).toEqual(expected);
  }
  expect(wire.contexts.every(c=>c.signal===controller.signal)).toBe(true);
  expect(result.response.candidates[0].content.parts).toEqual([...a,...b,...c]);expect(result.response.candidates[0].finishReason).toBe('STOP');expect(result.response.candidates[0].continuationToken).toBeUndefined();
  expect(result.initialPromptTokenCount).toBe(10);
  expect(result.response.usageMetadata).toEqual({promptTokenCount:85565,candidatesTokenCount:12,thoughtsTokenCount:52785,totalTokenCount:138362,cachedContentTokenCount:3,initialPromptTokenCount:10});
  for(const e of events)if(e.phase==='complete')expect(JSON.parse(e.raw)).toEqual(e.data);
  expect(result.hops).toHaveLength(3);for(const h of result.hops)expect(Object.keys(h)).not.toEqual(expect.arrayContaining(['raw','request','continuationToken']));
});
it('returns a one-hop STOP without continuation and retains independent prompt usage',async()=>{
  const wire=scripted([native('STOP',{parts:[{text:'{"ok":true}'}],prompt:19})]),out=await generateDecision({body:body(),fetchHop:wire.fetchHop});
  expect(wire.fetchHop).toHaveBeenCalledOnce();expect(out.initialPromptTokenCount).toBe(19);expect(out.hops[0].maxOutputTokens).toBe(32768);
});
it('persists exact bytes and parsed data before rejecting a model mismatch',async()=>{
  const raw=' {"modelVersion":"other-model","candidates":[{"finishReason":"STOP"}]}\n',events:GeminiHopEvent[]=[];
  await expect(generateDecision({body:body(),fetchHop:async()=>new Response(raw),onHop:e=>{events.push(e);}})).rejects.toThrow(/model drift/);
  const e=events.at(-1);expect(e?.phase).toBe('complete');if(e?.phase==='complete'){expect(e.raw).toBe(raw);expect(e.status).toBe(200);}
});
it('never returns partial action JSON after the raised ceiling is exhausted',async()=>{
  const wire=scripted([native('MAX_TOKENS',{token:'a',thoughts:32768}),native('MAX_TOKENS',{token:'b',thoughts:32768,parts:[{text:'{"ok":true}'}]})]);
  const error=await generateDecision({body:body(),fetchHop:wire.fetchHop}).catch(e=>e);
  expect(error).toBeInstanceOf(DecisionDecodeError);expect(error.message).toMatch(/exhausted/);expect(error.hops).toHaveLength(2);expect(error.response).toBeUndefined();expect(wire.fetchHop).toHaveBeenCalledTimes(2);
});
it.each(['MAX_TOKENS','CONTINUATION'])('requires a nonblank opaque token after %s',async reason=>{
  for(const token of [undefined,'','  ',123]){const wire=scripted([native(reason,{token})]);await expect(generateDecision({body:body(),fetchHop:wire.fetchHop})).rejects.toThrow(/Missing continuation token/);expect(wire.fetchHop).toHaveBeenCalledOnce();}
});
it('rejects repeated and cycling tokens before another dispatch',async()=>{
  for(const tokens of [['a','a'],['a','b','a']]){
    const wire=scripted(tokens.map((token,i)=>native(i?'CONTINUATION':'MAX_TOKENS',{token})));
    await expect(generateDecision({body:body(),fetchHop:wire.fetchHop})).rejects.toThrow(/Repeated continuation token/);expect(wire.fetchHop).toHaveBeenCalledTimes(tokens.length);
  }
});
it('enforces the three-hop cap rather than returning plausible partial JSON',async()=>{
  const wire=scripted(['a','b','c'].map((token,i)=>native(i?'CONTINUATION':'MAX_TOKENS',{token,parts:[{text:'{"ok":true}'}]})));
  await expect(generateDecision({body:body(),fetchHop:wire.fetchHop})).rejects.toThrow(/3-hop cap/);expect(wire.fetchHop).toHaveBeenCalledTimes(3);
});
it('fails closed on non-STOP reasons, missing/drifting models, blocked prompts and malformed candidates',async()=>{
  const absent:Record<string,unknown>=native('STOP');delete absent.modelVersion;
  const bad:unknown[]=[native('SAFETY'),native('RECITATION'),native(undefined),native('STOP',{model:'other-model'}),absent,native('STOP',{extra:{error:{code:400}}}),native('STOP',{extra:{promptFeedback:{blockReason:'SAFETY'}}}),native('STOP',{extra:{candidates:[]}}),native('STOP',{extra:{candidates:[{},{}]}}),native('STOP',{extra:{candidates:[{content:{parts:'text'}}]}})];
  for(const data of bad){const events:GeminiHopEvent[]=[],wire=scripted([data]);await expect(generateDecision({body:body(),fetchHop:wire.fetchHop,onHop:e=>{events.push(e);}})).rejects.toBeInstanceOf(DecisionDecodeError);expect(events.at(-1)?.phase).toBe('complete');expect(wire.fetchHop).toHaveBeenCalledOnce();}
  const wire=scripted([native('MAX_TOKENS',{token:'a'}),native('STOP',{model:'other-model'})]);await expect(generateDecision({body:body(),fetchHop:wire.fetchHop})).rejects.toThrow(/model drift/);
});
it('preserves error/status receipts and does not retry HTTP errors or invalid JSON',async()=>{
  for(const reply of [new Response('{"error":{"code":429}}',{status:429}),new Response('bad gateway',{status:502}),new Response('not JSON')]){
    const events:GeminiHopEvent[]=[],wire=scripted([reply]);const error=await generateDecision({body:body(),fetchHop:wire.fetchHop,onHop:e=>{events.push(e);}}).catch(e=>e);
    expect(error).toBeInstanceOf(DecisionDecodeError);if(reply.status!==200)expect(error.status).toBe(reply.status);
    expect(events.at(-1)).toMatchObject({phase:'complete',status:reply.status});expect(wire.fetchHop).toHaveBeenCalledOnce();
  }
});
it('stops on transport failures and awaited receipt-persistence failures without retries',async()=>{
  const wire=scripted([new Error('socket closed')]);await expect(generateDecision({body:body(),fetchHop:wire.fetchHop})).rejects.toThrow('socket closed');expect(wire.fetchHop).toHaveBeenCalledOnce();
  const uncalled=scripted([]);await expect(generateDecision({body:body(),fetchHop:uncalled.fetchHop,onHop:()=>{throw Error('persist start');}})).rejects.toThrow('persist start');expect(uncalled.fetchHop).not.toHaveBeenCalled();
  const stopped=scripted([native('MAX_TOKENS',{token:'a'})]);await expect(generateDecision({body:body(),fetchHop:stopped.fetchHop,onHop:e=>{if(e.phase==='complete')throw Error('persist complete');}})).rejects.toThrow('persist complete');expect(stopped.fetchHop).toHaveBeenCalledOnce();
});
it('preserves AbortError before dispatch and during a transport ignoring its signal',async()=>{
  const uncalled=scripted([]);await expect(generateDecision({body:body(),signal:AbortSignal.abort(),fetchHop:uncalled.fetchHop})).rejects.toMatchObject({name:'AbortError'});expect(uncalled.fetchHop).not.toHaveBeenCalled();
  const ctl=new AbortController();let started!:()=>void;const dispatched=new Promise<void>(resolve=>{started=resolve;});
  const pending=generateDecision({body:body(),signal:ctl.signal,fetchHop:()=>{started();return new Promise<Response>(()=>{});}});await dispatched;ctl.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
it('aborts while reading the response and after a completed receipt without another hop',async()=>{
  const ctl=new AbortController();let started!:()=>void;const reading=new Promise<void>(resolve=>{started=resolve;});
  const wire=new Response();vi.spyOn(wire,'text').mockImplementation(()=>{started();return new Promise<string>(()=>{});});
  const pending=generateDecision({body:body(),signal:ctl.signal,fetchHop:async()=>wire});await reading;ctl.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  const next=new AbortController(),script=scripted([native('MAX_TOKENS',{token:'a'})]);
  await expect(generateDecision({body:body(),signal:next.signal,fetchHop:script.fetchHop,onHop:e=>{if(e.phase==='complete')next.abort();}})).rejects.toMatchObject({name:'AbortError'});expect(script.fetchHop).toHaveBeenCalledOnce();
});
it('protects the next request from injected fetch mutation',async()=>{
  const original=body(),saved=structuredClone(original),wire=scripted([native('MAX_TOKENS',{token:'a'}),native('STOP')]);
  await generateDecision({body:original,fetchHop:async(request,context)=>{const reply=await wire.fetchHop(request,context);request.contents=[];request.generationConfig.thinkingConfig={thinkingLevel:'low'};return reply;}});
  expect(original).toEqual(saved);expect(wire.requests[1].contents).toEqual(saved.contents);expect(wire.requests[1].generationConfig.thinkingConfig).toEqual({thinkingLevel:'high'});
});
it('rejects malformed JSON requests and unsafe policy bounds before fetching',async()=>{
  const malformed:unknown[]=[null,{}, {...body(),generationConfig:[]},{...body(),continuationToken:'old'}];
  for(const mutate of [(b:ReturnType<typeof body>)=>{b.generationConfig.maxOutputTokens=98304;},(b:ReturnType<typeof body>)=>{b.generationConfig.thinkingConfig.thinkingLevel='low';},(b:ReturnType<typeof body>)=>{Object.assign(b.generationConfig.thinkingConfig,{thinkingBudget:1});},(b:ReturnType<typeof body>)=>{Object.assign(b.generationConfig,{candidateCount:2});},(b:ReturnType<typeof body>)=>{Object.assign(b.contents[0].parts[0],{text:undefined});}]){const input=body();mutate(input);malformed.push(input);}
  const fetchHop=vi.fn();for(const input of malformed)await expect(generateDecision({body:input,fetchHop})).rejects.toBeInstanceOf(DecisionDecodeError);
  for(const policy of [{maxHops:0},{maxHops:4},{maxHops:1.2},{maxTotalTokens:32768},{maxTotalTokens:98305},{maxTotalTokens:NaN}])await expect(generateDecision({body:body(),fetchHop,...policy})).rejects.toBeInstanceOf(DecisionDecodeError);expect(fetchHop).not.toHaveBeenCalled();
});
it('rejects malformed or over-ceiling usage and sanitizes progress',async()=>{
  for(const usage of [{thoughtsTokenCount:-1},{thoughtsTokenCount:1.2},{thoughtsTokenCount:'32768'},{thoughtsTokenCount:32769}])await expect(generateDecision({body:body(),fetchHop:async()=>response(native('STOP',{extra:{usageMetadata:usage}}))})).rejects.toThrow(/usage|ceiling/);
  const events:GeminiHopEvent[]=[];await generateDecision({body:body(),fetchHop:async()=>response(native('STOP')),onHop:e=>{events.push(e);}});
  for(const e of events)expect(Object.keys(decisionProgress(e)).every(k=>['phase','hop','maxOutputTokens','status','elapsedMs','finishReason'].includes(k))).toBe(true);
});

it('pipeline wrapper forwards continuation, high thinking and sanitized progress with compatible JSON/history return',async()=>{
  const wire=scripted([native('MAX_TOKENS',{token:'a',parts:[{text:'',thoughtSignature:'test-signed-empty'}]}),native('STOP',{parts:[{text:'{"ok":true}',thoughtSignature:'test-signed-action'}]})]);
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>wire.fetchHop(JSON.parse(String(init?.body)),{hop:wire.requests.length+1,signal:init?.signal??undefined}));vi.stubGlobal('fetch',fetch);
  const input=body().contents as GeminiRequest['contents'],saved=structuredClone(input),progress=vi.fn();
  const out=await generate<{ok:boolean}>(input as {role:'user';parts:NativePart[]}[],{type:'OBJECT'},undefined,'low',undefined,progress);
  expect(out.json).toEqual({ok:true});expect(out.content.parts).toHaveLength(2);expect(out.content.parts[0].thoughtSignature).toBe('test-signed-empty');expect(out.hops).toHaveLength(2);expect(out.initialPromptTokenCount).toBe(10);expect(input).toEqual(saved);
  expect(wire.requests.every(r=>(r.generationConfig.thinkingConfig as Record<string,unknown>).thinkingLevel==='high')).toBe(true);
  expect(progress.mock.calls.map(([p])=>p.phase)).toEqual(['start','complete','start','complete']);for(const [p] of progress.mock.calls)expect(JSON.stringify(p)).not.toMatch(/test-state|signature|parts|contents|continuationToken/);
});
it('classic gemini wrapper resumes a blind review and forces high for its later low-hint match call',async()=>{
  const verdict={looksLike:'Castle',recognizable:4,complete:4,colors:4,impressive:4,fixes:[]};
  const wire=scripted([native('MAX_TOKENS',{token:'a'}),native('STOP',{parts:[{text:JSON.stringify(verdict)}]}),native('STOP',{parts:[{text:'{"matchesSubject":true}'}]})]);
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>wire.fetchHop(JSON.parse(String(init?.body)),{hop:wire.requests.length+1,signal:init?.signal??undefined})));
  const out=await judgeBuild({name:'Castle',pitch:'A castle',estimatedParts:43,difficulty:2,keyParts:[]},['data:image/png;base64,test'],43,43);
  expect(out.named).toBe(true);expect(wire.requests).toHaveLength(3);expect(wire.requests[1].contents).toEqual(wire.requests[0].contents);expect(wire.requests[2].continuationToken).toBeUndefined();
  for(const request of wire.requests)expect(request.generationConfig.thinkingConfig).toEqual({thinkingLevel:'high'});
});
