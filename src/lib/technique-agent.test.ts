import {saveDiscovery,loadDiscoveries} from './library-discoveries';
import { afterEach,expect,it,vi } from 'vitest';
import { designBuild,type BuildEvent } from './gemini';
import { compileTechniques,angleChoices,type TechniqueProgram } from './construction-techniques';
import { parsePartId } from './bricks';
import { constructionIssues } from './construction';
import type { Inventory } from './inventory';

// Capability fixture for dispatch/contract tests, not an aesthetic benchmark.
const stock={'plate-4x6-light-gray':1,'brick-2x4-white':16,'plate-2x4-blue':1,'plate-1x1-light-gray':2};
const inv:Inventory={source:'sample',photos:[],others:[],parts:Object.fromEntries(Object.entries(stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:1,boxes:[]}]))};
const choice=angleChoices(stock).find(c=>c.panel==='plate-2x4-blue'&&c.hand===1)!;
const program:TechniqueProgram={name:'Control tower',description:'Test assembly',operations:[{kind:'part',id:'base',partId:'plate-4x6-light-gray',parent:'',parentPort:'',childPort:'',twist:0},...Array.from({length:16},(_,i)=>({kind:'part' as const,id:`body${i}`,partId:'brick-2x4-white',parent:i?`body${i-1}`:'base',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0})),{kind:'technique',id:'roof',choiceId:choice.id,parent:'body15',parentPort:'stud:0:0',twist:0}]};
const plan={choiceId:choice.id,feature:'Angled upper deck',outline:'Narrow tower with a projecting deck',scale:'Four studs across',reason:'The deck gives the upper outline a diagonal'};
const idea={name:'Control tower',pitch:'A tower with a distinct upper deck',estimatedParts:20,difficulty:3,keyParts:[]};
const good={looksLike:'control tower',recognizable:4,complete:4,impressive:4,colors:4,fixes:[]};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
const options={views:()=>['data:image/jpeg;base64,AA==']};
const strictOptions={...options,experimentalKit:'connections-v2' as const};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('the normal bucket route selects a feature, executes its macro and independently reviews the full build',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(program)).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[],trace:{label:string;data:any}[]=[];
 const build=await designBuild(inv,idea,e=>events.push(e),{...options,debug:(label,data)=>trace.push({label,data})});
 expect(build?.steps).toHaveLength(20);expect(constructionIssues(build!,stock,24)).toEqual([]);expect(build!.requiredContacts).toHaveLength(2);
 expect(events.at(-1)?.phase).toBe('ready');expect(fetch).toHaveBeenCalledTimes(4);
 const labels=trace.map(t=>t.label);expect(labels.indexOf('techniquePlan')).toBeLessThan(labels.indexOf('techniqueExpansion'));
 expect(trace.find(t=>t.label==='techniqueExpansion')!.data.receipts).toHaveLength(1);
 expect(build!.steps.at(-1)!.caption).toContain('BOTH supports');
 expect(JSON.stringify(JSON.parse(fetch.mock.calls[2][1].body))).not.toContain('Control tower');
});
it('a valid whole model cannot omit the selected technique',async()=>{
 const wrong={...program,operations:program.operations.filter(c=>c.kind==='part')};
 const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(wrong)).mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(wrong));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),strictOptions)).toBeNull();
 expect(fetch).toHaveBeenCalledTimes(4);expect(events.some(e=>e.phase==='preview'||e.phase==='ready')).toBe(false);
 expect(events.some(e=>e.phase==='issues'&&e.summary.includes('defining construction'))).toBe(true);
});
it('appearance failure remains failure after technique execution, preserving the stronger draft',async()=>{
 const fetch=vi.fn();for(const score of [3,2])fetch.mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(program)).mockResolvedValueOnce(reply({...good,impressive:score})).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();
 expect(events.some(e=>e.phase==='ready')).toBe(false);expect(events.filter(e=>e.phase==='judged').at(-1)).toMatchObject({verdict:{impressive:3}});
});
it('rejects an unavailable technique before asking for a whole model',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply({...plan,choiceId:'unverified-lowell-sphere'}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),strictOptions)).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);expect(events.some(e=>e.phase==='preview')).toBe(false);
});
it('cancellation after planning cannot start assembly generation',async()=>{
 const controller=new AbortController(),fetch=vi.fn().mockResolvedValueOnce(reply(plan));vi.stubGlobal('fetch',fetch);
 expect(await designBuild(inv,idea,e=>{if(e.phase==='planned')controller.abort();},{...options,signal:controller.signal})).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps both-anchor requirements when a qualified discovery is saved and reloaded',()=>{
 const {build}=compileTechniques(program,stock);let data='';const storage={getItem:()=>data,setItem:(_key:string,value:string)=>{data=value;}};
 expect(saveDiscovery(build,{...good,review:'blind-v1',subjectMatched:true},stock,storage).status).toBe('saved');
 const loaded=loadDiscoveries(storage)[0].build;expect(loaded.requiredContacts).toEqual(build.requiredContacts);
 const envelope=JSON.parse(data);envelope.items[0].build.requiredContacts[1].bPort='grip:999:999';data=JSON.stringify(envelope);
 expect(loadDiscoveries(storage)).toEqual([]);
});

it('normal requests release failed technique reservations and return to the existing bucket planner',async()=>{
 const controller=new AbortController();let fallbackSchema:any;
 const fetch=vi.fn().mockResolvedValueOnce(reply({...plan,choiceId:'not-available'})).mockImplementationOnce(async(_url,init)=>{
  fallbackSchema=JSON.parse(init.body).generationConfig.responseSchema;controller.abort();throw new DOMException('Stopped','AbortError');
 });vi.stubGlobal('fetch',fetch);
 const trace:{label:string;data:any}[]=[],events:BuildEvent[]=[];
 expect(await designBuild(inv,idea,e=>events.push(e),{...options,signal:controller.signal,debug:(label,data)=>trace.push({label,data})})).toBeNull();
 expect(trace.find(t=>t.label==='techniqueFallback')?.data).toMatchObject({to:'existing-bucket-builder',reservationsReleased:true});
 expect(fallbackSchema.properties.features).toBeDefined();expect(fallbackSchema.properties.choiceId).toBeUndefined();
 expect(events.some(e=>e.phase==='kept'&&e.reason.includes('Replanning'))).toBe(true);expect(events.some(e=>e.phase==='ready')).toBe(false);
});
