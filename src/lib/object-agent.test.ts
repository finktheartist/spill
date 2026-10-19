import {afterEach,expect,it,vi} from 'vitest';
import {designBuild,type BuildEvent} from './gemini';
import * as allocator from './object-layout-fit';
import {objectLayoutIssues} from './object-layout';
import {parsePartId} from './bricks';
import {constructionIssues} from './construction';
import type {Inventory} from './inventory';
import kit from './fixtures/surface-stock.json';
const inv:Inventory={source:'sample',photos:[],others:[],parts:Object.fromEntries(Object.entries(kit.stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:1,boxes:[]}]))};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
const good={looksLike:'robot bust',recognizable:4,complete:4,impressive:4,colors:4,fixes:[]};
const bust={shoulderWidth:6,torsoHeight:6,neckHeight:1,face:'eyes',reason:'Compact head above shaped shoulders'};
const idea={name:'Survey robot bust',pitch:'An expressive robot bust',estimatedParts:32,difficulty:3,keyParts:[]};
const options={views:()=>['data:image/jpeg;base64,AA==']};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
for(const [name,plan]of [['Survey robot bust',bust],['Coastal launch boat',{length:8,cabinLength:4,cabinPosition:'aft',roof:'flat'}]] as const)it(`normal ${name} requests freeze geometry, allocate locally, then receive an anonymous review`,async()=>{
 const allocate=vi.spyOn(allocator,'allocateObjectTarget'),trace:{label:string;data:any}[]=[],events:BuildEvent[]=[];
 const fetch=vi.fn().mockImplementationOnce(async()=>{expect(allocate).not.toHaveBeenCalled();return reply(plan);}).mockResolvedValueOnce(reply({...good,looksLike:name})).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const build=await designBuild(inv,{...idea,name},e=>events.push(e),{...options,debug:(label,data)=>{if(label==='objectTarget')expect(allocate).not.toHaveBeenCalled();trace.push({label,data});}});
 expect(build).not.toBeNull();expect(fetch).toHaveBeenCalledTimes(3);expect(events.at(-1)?.phase).toBe('ready');
 const c=trace.find(t=>t.label==='objectAllocation')!.data.candidates[0];expect(objectLayoutIssues(build!,c.contract)).toEqual([]);expect(constructionIssues(build!,kit.stock,24)).toEqual([]);
 const blind=JSON.stringify(JSON.parse(fetch.mock.calls[1][1].body));expect(blind).not.toContain(name);expect(blind).not.toContain('shoulderWidth');
 expect(trace.some(t=>t.label==='techniqueProgram')).toBe(false);
});
it('replans missing stock without falling back to unconstrained blocks',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply({...bust,face:'eyes'})).mockResolvedValueOnce(reply({...bust,face:'visor'})).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const sparse=structuredClone(inv);delete sparse.parts['roundtile-1x1-white'];sparse.parts['tile-2x2-black']={kind:parsePartId('tile-2x2-black')!,count:1,confidence:1,boxes:[]};const events:BuildEvent[]=[];
 expect(await designBuild(sparse,idea,e=>events.push(e),options)).not.toBeNull();expect(fetch).toHaveBeenCalledTimes(4);
 expect(events.filter(e=>e.phase==='preview')).toHaveLength(1);
 expect(JSON.parse(fetch.mock.calls[1][1].body).contents[0].parts[0].text).toContain('Missing stock');
});
it('construction success never promotes a weak draft, and restores the stronger attempt',async()=>{
 const fetch=vi.fn();for(const [torsoHeight,score]of [[6,3],[9,2]])fetch.mockResolvedValueOnce(reply({...bust,torsoHeight})).mockResolvedValueOnce(reply({...good,impressive:score})).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(events.some(e=>e.phase==='ready')).toBe(false);
 expect(events.filter(e=>e.phase==='judged').at(-1)).toMatchObject({verdict:{impressive:3},pass:false});
 expect(events.filter(e=>e.phase==='preview').at(-1)).toEqual(events.find(e=>e.phase==='preview'));
});
it('does not pay to review the same rejected layout twice',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply(bust)).mockResolvedValueOnce(reply({...good,impressive:2})).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply(bust));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(fetch).toHaveBeenCalledTimes(4);
 expect(events.filter(e=>e.phase==='looking')).toHaveLength(1);expect(events.some(e=>e.phase==='ready')).toBe(false);
});
it('does not allocate or judge after cancellation at the planning boundary',async()=>{
 const allocate=vi.spyOn(allocator,'allocateObjectTarget'),controller=new AbortController(),fetch=vi.fn().mockResolvedValueOnce(reply(bust));vi.stubGlobal('fetch',fetch);
 expect(await designBuild(inv,idea,e=>{if(e.phase==='planned')controller.abort();},{...options,signal:controller.signal})).toBeNull();
 expect(allocate).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects an allocator result that changes the frozen target',async()=>{
 const original=allocator.allocateObjectTarget;
 vi.spyOn(allocator,'allocateObjectTarget').mockImplementation(async(...args)=>{const result=await original(...args);result.candidates[0].target.description='Changed';return result;});
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => reply(bust)));const events:BuildEvent[]=[];
 expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(events.some(e=>e.phase==='ready'||e.phase==='preview')).toBe(false);
});
