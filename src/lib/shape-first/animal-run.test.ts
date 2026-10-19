import {afterEach,describe,expect,it,vi} from 'vitest';
import stock from '../fixtures/atlas-photo-pile-20261013-stock.json';
import {constructionIssues} from '../construction';
import {partCount} from '../bricks';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {runShapeTab,type ShapeVerdict} from './run';
import type {RankedIdea} from './pipeline';
// This suite covers the recorded-layout fallback; fresh whole generation has
// separate real-compiler tests in animal-first-whole.test.ts.
const whole=vi.hoisted(()=>vi.fn(async()=>({candidates:[],blueprints:[],designs:[],planningAttempts:0,attempts:0,rejected:[]})));
vi.mock('./whole-animal-synthesis',async original=>({...await original<typeof import('./whole-animal-synthesis')>(),synthesizeWholeAnimals:whole}));
// Keep API/claim regressions independent of wall-clock allocation deadlines.
// These recorded plans still compile through the REAL shared-stock connector
// engine and species validator; animals.test.ts covers live allocation itself.
vi.mock('../assembly-composer/animals',async importOriginal=>{
 const original=await importOriginal<typeof import('../assembly-composer/animals')>();
 const {default:fixture}=await import('../fixtures/animal-route-plans.json');
 const {animalRelatedKinds,animalKindName}=await import('../assembly-composer/animal-subjects');
 return {...original,animalModulePlans:(_stock:Record<string,number>,requested:string)=>animalRelatedKinds(requested).flatMap(kind=>fixture.plans.filter(p=>p.name===animalKindName(kind)))};
});
const idea=(name:string):RankedIdea=>({name,pitch:`Requested ${name}`,why:'A requested animal',length:10,width:4,height:6,palette:[],cells:80,worst:1,shortfall:0,atlas:{briefId:'original-fox',approachId:'original-fox'}});
const verdict:ShapeVerdict={looksLike:'a dog',named:true,recognizable:4,complete:4,colors:3,impressive:4,pass:true,fixes:[]};
const views=()=>['data:image/jpeg;base64,AA=='];
const fetchChoice=(wanted?:string)=>vi.fn().mockImplementation(async(_url,request)=>{
 const body=JSON.parse(request.body),menu=/MENU: (\[[\s\S]*\])$/.exec(body.contents[0].parts[0].text);
 const choices=body.generationConfig.responseSchema.properties.choiceId.enum;
 const offered:{id:string;name:string}[]=menu?JSON.parse(menu[1]):[],choice=offered.find(c=>c.name===wanted&&choices.includes(c.id))?.id??choices[0];
 return new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify({choiceId:choice,reason:'Selected actual complete anatomy.'})}]}}]}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('complete animals in the normal build flow',()=>{
 it('builds three actual stock-bound anatomies with distinct silhouettes and complete receipts',async()=>{
  vi.stubGlobal('fetch',fetchChoice());
  const judge=vi.fn(async build=>{expect(constructionIssues(build,stock,24)).toEqual([]);expect(partCount(build)).toBeGreaterThanOrEqual(20);return verdict;});
  const run=await runShapeTab('pile',stock,()=>{},{ideas:['Dog','Fox','Bear'].map(idea),views,judge});
  expect(run.slots.map(s=>s.phase),JSON.stringify(run.slots.map(s=>({name:s.idea.name,log:s.log.at(-1)})))).toEqual(['ready','ready','ready']);expect(run.slots.map(s=>s.requestedName)).toEqual(['Dog','Fox','Bear']);
  expect(new Set(run.slots.map(s=>animalSilhouetteKey(s.build!))).size).toBe(3);
  expect(whole).not.toHaveBeenCalled();
  for(const slot of run.slots){expect(['Dog','Fox','Bear']).toContain(slot.idea.name);expect(slot.build?.name).toBe(slot.idea.name);if(slot.idea.name!==slot.requestedName){expect(slot.replaced).toBe(slot.requestedName);expect(slot.idea.why).toContain(`Adapted “${slot.requestedName}”`);}expect(slot.stats?.assemblyFamily).toBe('animal');expect(slot.stats?.onPalette).toBeUndefined();expect(slot.program).toBeUndefined();expect(slot.idea.atlas).toBeUndefined();expect(slot.features!.flatMap(f=>f.indices)).toHaveLength(slot.stats!.parts);expect(new Set(slot.features!.flatMap(f=>f.indices)).size).toBe(slot.stats!.parts);}
 },30000);
 it('requires explicit whole-model opt-in and labels an existing-layout fallback as library work',async()=>{
  vi.stubGlobal('fetch',fetchChoice('Dog'));
  const run=await runShapeTab('pile',stock,()=>{},{wholeModel:true,ideas:[idea('Fox')],views,judge:async()=>verdict});
  expect(whole).toHaveBeenCalledOnce();expect(run.slots[0].build?.source?.kind).toBe('library');
  expect(run.slots[0].log.some(l=>l.text.includes('From the Spill library'))).toBe(true);
 },30000);
 it('judges and displays the actual Dog when a Fox request is adapted',async()=>{
  vi.stubGlobal('fetch',fetchChoice('Dog'));const judge=vi.fn(async(_build,actual)=>{expect(actual.name).toBe('Dog');return verdict;});
  const run=await runShapeTab('pile',stock,()=>{},{ideas:[idea('Fox')],views,judge});const slot=run.slots[0];
  expect(slot.phase).toBe('ready');expect(slot.idea.name).toBe('Dog');expect(slot.build?.name).toBe('Dog');expect(slot.requestedName).toBe('Fox');expect(slot.replaced).toBe('Fox');expect(slot.idea.why).toContain('Adapted “Fox”');
 },30000);
 it('withholds an unrecognized complete animal without exposing another slot’s preview',async()=>{
  vi.stubGlobal('fetch',fetchChoice());const run=await runShapeTab('pile',stock,()=>{},{ideas:[idea('Fox')],views,judge:async()=>({...verdict,named:false,pass:false})});
  expect(run.slots[0].phase).toBe('failed');expect(run.slots[0].unrecognized).toBe(true);expect(run.slots[0].build).toBeUndefined();expect(run.slots[0].stats?.assemblyFamily).toBe('animal');
 },30000);
});
