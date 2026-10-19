import {afterEach,expect,it,vi} from 'vitest';
import {designBuild,type BuildEvent} from './gemini';
import * as allocator from './animal-anatomy-fit';
import {animalAnatomyIssues,type AnimalSpec} from './animal-anatomy';
import {parsePartId} from './bricks';
import {constructionIssues} from './construction';
import type {Inventory} from './inventory';
import kit from './fixtures/large-pile-stock.json';
const inv:Inventory={source:'photo',photos:[],others:[],parts:Object.fromEntries(Object.entries(kit.stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:.8,boxes:[]}]))};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
const base:AnimalSpec={bodyLength:8,legHeight:4,neckHeight:0,body:'lean',muzzle:2,head:'narrow',face:'sloped',ears:'drop',legs:'slender',tail:'low',color:'reddish-brown',accent:'tan'};
const specs:AnimalSpec[]=[base,{...base,bodyLength:6,muzzle:1,body:'full',ears:'curved',tail:'stub'},{...base,bodyLength:6,legHeight:1,muzzle:1,body:'full',ears:'alert',tail:'stub'}];
const plans=specs.map((spec,i)=>({name:`Animal ${i+1}`,reason:'Distinct proportions',spec}));
const good={looksLike:'small brick dog',recognizable:4,complete:4,impressive:4,colors:4,fixes:[]};
const idea={name:'Four-legged animal',pitch:'A well proportioned quadruped',estimatedParts:35,difficulty:3,keyParts:[]};
const views=()=>['data:image/jpeg;base64,AA=='];
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('opted-in animal requests plan distinct shapes before allocation and compare all successful builds anonymously',async()=>{
 const allocate=vi.spyOn(allocator,'allocateAnimalTarget'),debug:{label:string;data:any}[]=[],events:BuildEvent[]=[];
 const fetch=vi.fn().mockImplementationOnce(async()=>{expect(allocate).not.toHaveBeenCalled();return reply({plans});});
 for(const score of [3,4,3])fetch.mockResolvedValueOnce(reply({...good,impressive:score})).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const build=await designBuild(inv,idea,e=>events.push(e),{views,animalAnatomyMode:'auto',debug:(label,data)=>debug.push({label,data})});
 expect(fetch).toHaveBeenCalledTimes(7);expect(allocate).toHaveBeenCalledTimes(3);expect(build?.name).toBe('Animal 2');expect(events.at(-1)?.phase).toBe('ready');
 const c=debug.find(d=>d.label==='animalSelected')!.data.candidate;expect(animalAnatomyIssues(build!,c.contract)).toEqual([]);expect(constructionIssues(build!,kit.stock,24)).toEqual([]);
 const blind=fetch.mock.calls[1][1].body;expect(blind).not.toContain('Animal 1');expect(blind).not.toContain('bodyLength');expect(blind).not.toContain('Four-legged animal');
});
it('does not review renamed or recolored duplicate geometry and never promotes weak drafts',async()=>{
 const same=[plans[0],{...plans[0],name:'New label'},{...plans[0],spec:{...base,color:'dark-azure'}}];
 const fetch=vi.fn().mockResolvedValueOnce(reply({plans:same})).mockResolvedValueOnce(reply({...good,impressive:3})).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply({plans:[plans[0]]}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),{views,animalAnatomyMode:'auto'})).toBeNull();expect(fetch).toHaveBeenCalledTimes(4);expect(events.filter(e=>e.phase==='looking')).toHaveLength(1);expect(events.some(e=>e.phase==='ready')).toBe(false);expect(events.filter(e=>e.phase==='judged').at(-1)).toMatchObject({verdict:{impressive:3},pass:false});
});
it('replans allocation failures explicitly without free-form bricks or an invented fallback animal',async()=>{
 const bad={...plans[0],spec:{...base,ears:'curved',tail:'low'}};
 const fetch=vi.fn().mockResolvedValueOnce(reply({plans:[bad,bad,bad]})).mockResolvedValueOnce(reply({plans:[plans[1]]})).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const trace:string[]=[];expect(await designBuild(inv,idea,()=>{},{views,animalAnatomyMode:'auto',debug:label=>trace.push(label)})).not.toBeNull();expect(fetch).toHaveBeenCalledTimes(4);expect(trace).not.toContain('connectionProgram');expect(fetch.mock.calls[1][1].body).toContain('stock');
});
it('cancels at the preview boundary before paying for a review',async()=>{
 const controller=new AbortController(),fetch=vi.fn().mockImplementation(async () => reply({plans}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>{events.push(e);if(e.phase==='preview')controller.abort();},{views,animalAnatomyMode:'auto',signal:controller.signal})).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);expect(events.some(e=>e.phase==='ready')).toBe(false);
});
it('validates geometry returned by a worker before showing or judging it',async()=>{
 const original=allocator.allocateAnimalTarget;vi.spyOn(allocator,'allocateAnimalTarget').mockImplementation(async(...args)=>{const result=await original(...args);result.candidates[0].build.steps[0].parts[0].z+=1;return result;});
 const fetch=vi.fn().mockImplementation(async () => reply({plans}));vi.stubGlobal('fetch',fetch);const events:BuildEvent[]=[];
 expect(await designBuild(inv,idea,e=>events.push(e),{views,animalAnatomyMode:'auto'})).toBeNull();expect(events.some(e=>e.phase==='preview'||e.phase==='ready'||e.phase==='looking')).toBe(false);expect(fetch).toHaveBeenCalledTimes(2);
});
it('keeps a visually polished wrong subject out of finished results',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply({plans}));for(let i=0;i<3;i++)fetch.mockResolvedValueOnce(reply({...good,looksLike:'a small airplane'})).mockResolvedValueOnce(reply({matchesSubject:false}));fetch.mockResolvedValueOnce(reply({plans:[plans[0]]}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),{views,animalAnatomyMode:'auto'})).toBeNull();expect(events.some(e=>e.phase==='ready')).toBe(false);
});
