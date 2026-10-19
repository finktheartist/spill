import { afterEach, expect, it, vi } from 'vitest';
import { designBuild, type BuildEvent } from './gemini';
import { surveyRobot } from './connection-models';
import { parsePartId } from './bricks';
import { constructionIssues } from './construction';
import type { Inventory } from './inventory';
const seed=surveyRobot(),inv:Inventory={source:'sample',photos:[],others:[],parts:Object.fromEntries(Object.entries(seed.stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:1,boxes:[]}]))};
const idea={name:'Survey machine',pitch:'A robot with a centered head and arms.',estimatedParts:32,difficulty:3,keyParts:[]};
const good={looksLike:'robot',recognizable:4,complete:4,impressive:4,colors:4,fixes:[]};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
const options={experimentalKit:'connections-v2' as const,techniqueMode:'off' as const,views:()=>['data:image/jpeg;base64,AA==']};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('dispatches to attachment programs, checks exact stock, and reviews untitled renders',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply(seed.program)).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];const build=await designBuild(inv,idea,e=>events.push(e),options);
 expect(build?.engine).toBe('connections-v2');expect(constructionIssues(build!,seed.stock,24)).toEqual([]);expect(fetch).toHaveBeenCalledTimes(3);
 expect(events.at(-1)?.phase).toBe('ready');
 const first=JSON.parse(fetch.mock.calls[0][1].body);expect(first.generationConfig.responseSchema.properties.operations).toBeDefined();
 const judge=JSON.parse(fetch.mock.calls[1][1].body);expect(JSON.stringify(judge)).not.toContain('Survey machine');
});
it('rejects a missing connector atomically and allows just one complete repair',async()=>{
 const bad=structuredClone(seed.program);bad.operations[12].parentPort='imaginary:0';
 const fetch=vi.fn().mockImplementation(async () => reply(bad));vi.stubGlobal('fetch',fetch);const events:BuildEvent[]=[];
 expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(fetch).toHaveBeenCalledTimes(2);
 expect(events.some(e=>e.phase==='preview'||e.phase==='ready')).toBe(false);expect(events.at(-1)?.phase).toBe('failed');
});
it('retains the visual threshold and requires images instead of declaring technical validity finished',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply(seed.program)).mockResolvedValueOnce(reply({...good,impressive:3})).mockResolvedValueOnce(reply({matchesSubject:true})).mockImplementation(async () => reply({focus:'No feasible improvement',updates:[],remove:[],add:[]}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(fetch).toHaveBeenCalledTimes(6);expect(events.some(e=>e.phase==='ready')).toBe(false);
 fetch.mockClear();expect(await designBuild(inv,idea,()=>{},{experimentalKit:'connections-v2'})).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
it('never pads a small connected sketch to bypass the 20-part floor',async()=>{
 const program={...seed.program,operations:seed.program.operations.slice(0,4)};
 const fetch=vi.fn().mockImplementation(async () => reply(program));vi.stubGlobal('fetch',fetch);const events:BuildEvent[]=[];
 expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(events.some(e=>e.phase==='preview'||e.phase==='ready')).toBe(false);expect(fetch).toHaveBeenCalledTimes(2);
});
it('ends a stalled generation at its explicit deadline without reporting ready',async()=>{
 vi.useFakeTimers();
 try{
  vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}))));
  const events:BuildEvent[]=[];const pending=designBuild(inv,idea,e=>events.push(e),options);
  await vi.advanceTimersByTimeAsync(180000);expect(await pending).toBeNull();
  expect(events.at(-1)).toMatchObject({phase:'failed',reason:expect.stringContaining('time limit')});expect(events.some(e=>e.phase==='ready')).toBe(false);
 }finally{vi.useRealTimers();}
});
it('routes an invalid model proposal through connector fitting before independent review',async()=>{
 const {default:program}=await import('./fixtures/connection-trial-stock.json');
 const fetch=vi.fn().mockResolvedValueOnce(reply(program)).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];const build=await designBuild(inv,idea,e=>events.push(e),options);
 expect(build).not.toBeNull();expect(constructionIssues(build!,seed.stock,24)).toEqual([]);expect(fetch).toHaveBeenCalledTimes(3);
 expect(events.find(e=>e.phase==='connectionsFitted')).toMatchObject({changed:2});expect(events.at(-1)?.phase).toBe('ready');
});

it('uses the connector engine for a normal idea that reserves a confirmed specialty part',async()=>{
 const partId=Object.keys(seed.stock).find(id=>/^(jumper|sidebrick|bracket)-/.test(id))!;expect(partId).toBeTruthy();
 const fetch=vi.fn().mockResolvedValueOnce(reply(seed.program)).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const build=await designBuild(inv,{...idea,name:'Compact display',keyParts:[{partId,count:1}]},()=>{},{views:options.views,techniqueMode:'off'});
 expect(build?.engine).toBe('connections-v2');expect(fetch).toHaveBeenCalledTimes(3);expect(JSON.parse(fetch.mock.calls[0][1].body).generationConfig.responseSchema.properties.operations).toBeDefined();
});

it('keeps required connector geometry when a studied module cannot fit',async()=>{
 const {default:fixture}=await import('./fixtures/small-pile-stock.json');
 const photo:Inventory={source:'photo',photos:[],others:[],parts:Object.fromEntries(Object.entries(fixture.stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:.8,boxes:[]}]))};
 const fetch=vi.fn().mockImplementation(async () => reply({}));vi.stubGlobal('fetch',fetch);const debug:{label:string;data:any}[]=[];
 expect(await designBuild(photo,{name:'Retro Arcade Cabinet',pitch:'A cabinet using a jumper control.',estimatedParts:30,difficulty:3,keyParts:[{partId:'jumper-1x2-blue',count:1}]},()=>{},{views:options.views,debug:(label,data)=>debug.push({label,data})})).toBeNull();
 expect(debug.find(d=>d.label==='techniqueFallback')?.data.to).toBe('connection-builder');
 expect(fetch.mock.calls.slice(-2).every(c=>JSON.parse(c[1].body).generationConfig.responseSchema.properties.operations)).toBe(true);
});
