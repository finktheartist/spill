import { afterEach,describe,expect,it,vi } from 'vitest';
import { buildFeatureFirst,seedChoices } from './feature-first';
import type { RankedIdea } from './pipeline';
import type { ShapeVerdict } from './run';
import { runShapeTab } from './run';
const stock={'plate-2x2-white':1,'curve-2x2-white':1,'plate-1x2-white':18};
const idea:RankedIdea={name:'Dog head',pitch:'A dog with a rounded head',why:'',length:6,width:4,height:6,palette:[{role:'coat',color:'white',cells:40}],worst:1,cells:40,shortfall:0,features:[{feature:'Rounded head',part:'curve',color:'white',pieces:[{partId:'curve-2x2-white',count:1}],carriers:[{partId:'plate-2x2-white',count:1}]},{feature:'Plate base',part:'plate',color:'white',pieces:[{partId:'plate-1x2-white',count:2}],carriers:[]}]};
const choice=seedChoices(idea,stock).find(c=>c.studyId==='rounded-muzzle')!;
const plan={choiceId:choice.id,rotation:0,pose:'Upright',traits:['Rounded head','Narrow body'],bodySize:[4,4,6],colors:['white']};
const body={reasoning:'Structural fixture only',parts:Array.from({length:18},(_,i)=>({partId:'plate-1x2-white',x:0,y:i%2,z:-1-Math.floor(i/2),rot:0,role:'Support'}))};
const verdict:ShapeVerdict={looksLike:'dog',recognizable:4,complete:4,colors:4,impressive:4,fixes:[],named:true,pass:true};
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
const views=()=>['data:image/jpeg;base64,AA=='];
afterEach(()=>vi.unstubAllGlobals());
describe('feature-first orchestration',()=>{
 it('sends the reserved geometry and reduced stock before body generation, then blind reviews',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue(verdict),result=await buildFeatureFirst(idea,stock,{minParts:20,views,judge});
  expect(result?.feature.choiceId).toBe(choice.id);expect(judge).toHaveBeenCalledTimes(1);
  const text=JSON.parse(fetch.mock.calls[1][1].body).contents[0].parts.at(-1).text;
  expect(text).toContain('SEED GEOMETRY');expect(text).toContain('REMAINING STOCK after reservation (body may use ONLY these IDs and counts): {"plate-1x2-white":18}');
 });
 it('fails boundedly without reviewing invalid construction',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockImplementation(async()=>reply({...body,parts:[]}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn();await expect(buildFeatureFirst(idea,stock,{minParts:20,views,judge})).rejects.toThrow(/could not connect/);
  expect(fetch).toHaveBeenCalledTimes(5);expect(judge).not.toHaveBeenCalled();
 });
 it('supplies actual per-choice dimensions and repairs one oversized plan before body generation',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply({...plan,bodySize:[9,4,6]})).mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue(verdict),r=await buildFeatureFirst(idea,stock,{minParts:20,views,judge});
  expect(r?.build.steps).toHaveLength(20);expect(fetch).toHaveBeenCalledTimes(3);expect(judge).toHaveBeenCalledTimes(1);
  const first=JSON.parse(fetch.mock.calls[0][1].body),repair=JSON.parse(fetch.mock.calls[1][1].body);
  expect(first.contents[0].parts.at(-1).text).toContain('EXACT PER-CHOICE BODY LIMITS');
  expect(first.contents[0].parts.at(-1).text).toContain('"ceiling":6');
  expect(first.generationConfig.responseSchema.properties.choiceId.enum).toContain(choice.id);
  expect(repair.contents.at(-1).parts[0].text).toContain('Original stock is unchanged');
  expect(repair.contents.at(-1).parts[0].text).toContain('between 1 and 6 studs');
 });
 it('stops after one plan repair and never reviews or reserves an invalid plan',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>reply({...plan,bodySize:[9,4,6]}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn();await expect(buildFeatureFirst(idea,stock,{minParts:20,views,judge})).rejects.toThrow(/remained invalid after one repair/);
  expect(fetch).toHaveBeenCalledTimes(2);expect(judge).not.toHaveBeenCalled();
 });
 it('does not accept a response after cancellation',async()=>{
  const c=new AbortController();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{c.abort();return reply(plan);}));
  const judge=vi.fn();await expect(buildFeatureFirst(idea,stock,{minParts:20,views,judge,signal:c.signal})).rejects.toMatchObject({name:'AbortError'});expect(judge).not.toHaveBeenCalled();
 });
 it('retains the first complete construction when a whole-body revision fails',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body)).mockImplementation(async()=>reply({...body,parts:[]}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue({...verdict,pass:false,impressive:2});
  const r=await buildFeatureFirst(idea,stock,{minParts:20,views,judge});expect(r?.revised).toBe(false);expect(r?.build.steps).toHaveLength(20);expect(judge).toHaveBeenCalledTimes(1);
 });
 it('retains a reviewed candidate if the revision service fails, but never after user cancellation',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body)).mockImplementation(async () => new Response(JSON.stringify({error:{message:'Revision unavailable'}}),{status:400}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue({...verdict,pass:false});
  const r=await buildFeatureFirst(idea,stock,{minParts:20,views,judge});expect(r?.build.steps).toHaveLength(20);expect(r?.revised).toBe(false);
  const c=new AbortController();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body)).mockImplementation(async()=>{c.abort();return reply(body);}));
  await expect(buildFeatureFirst(idea,stock,{minParts:20,views,judge,signal:c.signal})).rejects.toMatchObject({name:'AbortError'});
 });
 it('routes the normal small-pile run through reservation before any shape worker and withholds unnamed results',async()=>{
  const pile={...stock,'brick-2x2-white':20};
  for(const named of [true,false]){
   const fetch=vi.fn().mockResolvedValueOnce(reply({ideas:[idea]})).mockResolvedValueOnce(reply({ideas:[]})).mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body));vi.stubGlobal('fetch',fetch);
   const worker=vi.fn();vi.stubGlobal('Worker',worker);
   const r=await runShapeTab('pile',pile,()=>{},{views,judge:async()=>({...verdict,named})});
   expect(worker).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(4);
   expect(r.slots[0].phase).toBe(named?'ready':'failed');expect(!!r.slots[0].build).toBe(named);
   if(named){expect(r.slots[0].stats?.featureFirst).toBe(true);expect(r.slots[0].stats?.onPalette).toBeUndefined();}
  }
 });
});
