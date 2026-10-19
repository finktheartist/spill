import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {AssemblyComposition} from '../assembly-composer/types';
import type {RankedIdea} from './pipeline';
import type {ShapeVerdict} from './run';
const mock=vi.hoisted(()=>({plans:vi.fn(),issues:vi.fn(),search:vi.fn()}));
vi.mock('../assembly-composer/animals',()=>({animalModulePlans:mock.plans,animalCompositionIssues:mock.issues}));
vi.mock('../assembly-composer/compose',()=>({searchModuleCompositions:mock.search}));
import {buildAnimalFirst,animalMenu} from './animal-first';
const stock={'plate-2x2-white':20,'plate-1x2-white':20,'brick-2x2-white':20};
const idea:RankedIdea={name:'Fox',pitch:'A slender fox with pointed ears and a bushy tail.',why:'Original request',length:10,width:4,height:6,palette:[{role:'coat',color:'red',cells:80}],cells:80,worst:1,shortfall:0,
 atlas:{briefId:'fox-request',approachId:'fox-approach'},discovery:{family:'animals',concept:'fox',form:'lean alert canine'}};
const verdict:ShapeVerdict={looksLike:'dog',recognizable:4,complete:4,colors:3,impressive:4,fixes:[],named:true,pass:true};
const views=()=>['data:image/jpeg;base64,AA=='];
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
function fixture(name:string,id:string,partId:string,z=1):AssemblyComposition {
 const build={name,description:'Synthetic orchestration fixture; not animal-quality evidence.',steps:Array.from({length:20},(_,i)=>({caption:'Fixture layer',parts:[{partId,x:0,y:0,z:i*z,rot:0}]}))};
 return {plan:{id,name,description:`${name} fixture proportions`,nodes:[]},build,remaining:{},size:[2,2,z*8],receipts:[{id:'torso',role:'torso',optionId:id,cost:{[partId]:20},indices:Array.from({length:20},(_,i)=>i)}]};
}
let candidates:AssemblyComposition[];
beforeEach(()=>{
 candidates=[fixture('Dog','dog','plate-2x2-white'),fixture('Fox','fox','plate-1x2-white'),fixture('Bear','bear','brick-2x2-white',3)];
 mock.plans.mockReturnValue([]);mock.issues.mockReturnValue([]);mock.search.mockImplementation(()=>({candidates,attempts:3,rejected:0,exhausted:false}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('complete animal selection and honest adaptation',()=>{
 it('does not call generation for unsupported classes or an empty legal pool',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await buildAnimalFirst({...idea,name:'Dogfish'},stock,{wholeModel:false,minParts:20,views,judge:vi.fn()})).toBeNull();
  candidates=[];expect(await buildAnimalFirst(idea,stock,{minParts:20,views,judge:vi.fn()})).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it('deduplicates physical silhouettes across species labels and offers the requested kind first',()=>{
  const cloned=fixture('Fox','paint-only-fox','plate-2x2-white');
  const menu=animalMenu([candidates[0],cloned,candidates[1],candidates[2]],'Fox');
  expect(menu.map(c=>c.plan.name)).toEqual(['Fox','Dog','Bear']);expect(menu.some(c=>c.plan.id==='paint-only-fox')).toBe(false);
 });
 it('does not count brick versus plate segmentation of the same occupied body as diversity',()=>{
  const bricks=fixture('Dog','brick-body','brick-2x2-white',3),plates=fixture('Fox','plate-body','plate-2x2-white');
  plates.build.steps=Array.from({length:60},(_,i)=>({caption:'Same body split into plates',parts:[{partId:'plate-2x2-white',x:0,y:0,z:i,rot:0}]}));
  expect(animalMenu([bricks,plates],'Animal').map(c=>c.plan.id)).toEqual(['brick-body']);
 });
 it('compares three distinct requested-animal craft assemblies before a related fallback',()=>{
  const craft=['plate-1x3-white','plate-1x4-white','plate-2x3-white'].map((id,i)=>fixture('Fox',`animal-craft:fox:head-${i}`,id));
  const menu=animalMenu([...candidates,...craft],'Fennec fox');
  expect(menu.map(c=>c.plan.id)).toEqual([...craft.map(c=>c.plan.id),'dog']);
  expect(animalMenu([...candidates,...craft],'Fennec fox',2).every(c=>c.plan.id.startsWith('animal-craft:fox:'))).toBe(true);
  expect(animalMenu([...candidates,...craft],'Dog').slice(0,3).map(c=>c.plan.name)).toEqual(['Dog','Fox','Bear']);
  expect(animalMenu([...candidates,...craft],'Animal').slice(0,3).map(c=>c.plan.name)).toEqual(['Dog','Fox','Bear']);
 });
 it('gives the selector exact specialty constraints without turning inventory pairs into craft proof',async()=>{
  const fetch=vi.fn().mockImplementation(async () => reply({choiceId:'animal-1',reason:'The rendered muzzle is clearer.'}));vi.stubGlobal('fetch',fetch);
  await buildAnimalFirst(idea,{...stock,'curve-1x2-black':2,'slope-2x2-reddish-brown':1},{wholeModel:false,minParts:20,views,judge:async()=>verdict});
  const prompt=JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0].text;
  expect(prompt).toContain('"id":"curve-1x2-black","count":2,"identicalPairs":1');
  expect(prompt).toContain('no top studs');expect(prompt).toContain('"id":"slope-2x2-reddish-brown","count":1,"identicalPairs":0');
  expect(prompt).toContain('More special pieces is not a craft score');
  expect(prompt).toContain('specialPartAllocation');expect(prompt).toContain('do not prove a legal placement');
 });
 it('judges the actual Dog and preserves the Fox request as an explicit adaptation',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>reply({choiceId:'animal-2',reason:'The dog has clearer head and ear proportions.'}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue(verdict),result=await buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge});
  expect(result?.requestedName).toBe('Fox');expect(result?.idea.name).toBe('Dog');expect(result?.build.name).toBe('Dog');expect(result?.build.source).toEqual({kind:'library',recipeId:'dog'});expect(result?.adaptation).toContain('Adapted “Fox”');
  expect(result?.idea.atlas).toBeUndefined();expect(result?.idea.construction).toBeUndefined();expect(result?.idea.palette.map(p=>p.color)).toEqual(['white']);
  expect(judge.mock.calls[0][1].name).toBe('Dog');expect(mock.issues).toHaveBeenCalledWith(candidates[0],'Dog');
  const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body.generationConfig.responseSchema.properties.parts).toBeUndefined();expect(body.generationConfig.responseSchema.properties.choiceId.enum).toEqual(['animal-1','animal-2','animal-3']);
 });
 it('labels breed and open-species requests with the supported canonical anatomy',async()=>{
  candidates=[candidates[0]];vi.stubGlobal('fetch',vi.fn());
  const result=await buildAnimalFirst({...idea,name:'Dachshund'},stock,{wholeModel:false,minParts:20,views,judge:async()=>verdict});
  expect(result?.idea.name).toBe('Dog');expect(result?.adaptation).toContain('Dachshund');expect(fetch).not.toHaveBeenCalled();
  const generic=await buildAnimalFirst({...idea,name:'Cub'},stock,{wholeModel:false,minParts:20,views,judge:async()=>verdict});
  expect(generic?.idea.name).toBe('Dog');expect(generic?.adaptation).toContain('general dog');expect(generic?.adaptation).not.toContain('different animal');
 });
 it('requires one bounded repair for invalid IDs and never reviews an invented layout',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>reply({choiceId:'invented',reason:'No such candidate.'}));vi.stubGlobal('fetch',fetch);const judge=vi.fn();
  await expect(buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge})).rejects.toThrow(/after one repair/);expect(fetch).toHaveBeenCalledTimes(2);expect(judge).not.toHaveBeenCalled();
 });
 it('repairs a shape collision between parallel displayed options without a second stock ledger',async()=>{
  let unavailable=false;
  const fetch=vi.fn().mockImplementationOnce(async()=>{unavailable=true;return reply({choiceId:'animal-1',reason:'First.'});}).mockImplementationOnce(async()=>reply({choiceId:'animal-2',reason:'A different physical shape.'}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue(verdict),claim=vi.fn().mockReturnValue(true);
  const result=await buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge,claim,unavailable:b=>unavailable&&b===candidates[1].build});
  expect(result?.idea.name).toBe('Dog');expect(judge).toHaveBeenCalledTimes(1);expect(claim).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[1][1].body).generationConfig.responseSchema.properties.choiceId.enum).not.toContain('animal-1');
 });
 it('retains the stronger reviewed anatomy and does not commit after user cancellation',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply({choiceId:'animal-1',reason:'First.'})).mockResolvedValueOnce(reply({choiceId:'animal-2',reason:'More complete.'}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValueOnce({...verdict,pass:false,recognizable:5,complete:3,impressive:3}).mockResolvedValueOnce(verdict);
  expect((await buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge}))?.idea.name).toBe('Dog');
  const ctl=new AbortController();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{ctl.abort();return reply({choiceId:'animal-2',reason:'Late.'});}));
  await expect(buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge,signal:ctl.signal})).rejects.toMatchObject({name:'AbortError'});
 });
 it('rechecks actual geometry and the part floor after rendering',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>reply({choiceId:'animal-1',reason:'First.'})));const judge=vi.fn();
  await expect(buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,judge,views:build=>{build.steps.pop();return views();}})).rejects.toThrow(/purposeful pieces/);expect(judge).not.toHaveBeenCalled();
 });
 it('releases discarded shapes while retaining only the returned model',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(reply({choiceId:'animal-1',reason:'First.'})).mockResolvedValueOnce(reply({choiceId:'animal-2',reason:'Better.'})));
  const held=new Set(),claim=vi.fn(b=>{held.add(b);return true;}),release=vi.fn(b=>held.delete(b));
  const judge=vi.fn().mockResolvedValueOnce({...verdict,complete:2,impressive:2,pass:false}).mockResolvedValueOnce(verdict);
  const result=await buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge,claim,release});
  expect(result?.idea.name).toBe('Dog');expect([...held]).toEqual([candidates[0].build]);expect(release).toHaveBeenCalledWith(candidates[1].build);
 });
 it('releases a failed review and all claims when the user cancels',async()=>{
  candidates=[candidates[0]];const claim=vi.fn().mockReturnValue(true),release=vi.fn();
  await expect(buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,claim,release,judge:async()=>{throw Error('Review service failed');}})).rejects.toThrow('Review service failed');
  expect(release).toHaveBeenCalledWith(candidates[0].build);release.mockClear();
  const ctl=new AbortController();
  await expect(buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,claim,release,signal:ctl.signal,judge:async()=>{ctl.abort();return verdict;}})).rejects.toMatchObject({name:'AbortError'});
  expect(release).toHaveBeenCalledWith(candidates[0].build);
 });
 it('keeps the first reviewed lease when a later review fails',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(reply({choiceId:'animal-1',reason:'First.'})).mockResolvedValueOnce(reply({choiceId:'animal-2',reason:'Try another.'})));
  const held=new Set(),claim=vi.fn(b=>{held.add(b);return true;}),release=vi.fn(b=>held.delete(b));
  const judge=vi.fn().mockResolvedValueOnce({...verdict,complete:3,impressive:3,pass:false}).mockRejectedValueOnce(Error('Review unavailable'));
  const result=await buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,judge,claim,release});
  expect(result?.idea.name).toBe('Fox');expect([...held]).toEqual([candidates[1].build]);expect(release).toHaveBeenCalledWith(candidates[0].build);
 });
 it('does not retain geometry mutated by a review callback',async()=>{
  candidates=[candidates[0]];const release=vi.fn();
  await expect(buildAnimalFirst(idea,stock,{wholeModel:false,minParts:20,views,claim:()=>true,release,judge:async b=>{b.steps.pop();return verdict;}})).rejects.toThrow('changed during review');
  expect(release).toHaveBeenCalledWith(candidates[0].build);
 });
});
