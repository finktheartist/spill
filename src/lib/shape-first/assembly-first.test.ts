import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {AssemblyComposition} from '../assembly-composer/types';
import type {RankedIdea} from './pipeline';
import type {ShapeVerdict} from './run';
const mock=vi.hoisted(()=>({plans:vi.fn(),issues:vi.fn(),search:vi.fn()}));
vi.mock('../assembly-composer/aircraft',()=>({aircraftModulePlans:mock.plans,aircraftCompositionIssues:mock.issues}));
vi.mock('../assembly-composer/compose',()=>({searchModuleCompositions:mock.search}));
import {buildAssemblyFirst} from './assembly-first';
const stock={'plate-2x2-white':20,'plate-1x2-white':20,'brick-2x2-white':20};
const idea:RankedIdea={name:'Seaplane',pitch:'Long wings, tail and separated floats',why:'',length:10,width:12,height:4,palette:[{role:'body',color:'white',cells:80}],cells:80,worst:1,shortfall:0};
const verdict:ShapeVerdict={looksLike:'seaplane',recognizable:4,complete:4,colors:3,impressive:4,fixes:[],named:true,pass:true};
const views=()=>['data:image/jpeg;base64,AA=='];
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
function fixture(partId:string,z:number,id:string):AssemblyComposition {
 const build={name:'Seaplane',description:'Orchestration fixture only',steps:Array.from({length:20},(_,i)=>({caption:'Fixture layer',parts:[{partId,x:0,y:0,z:i*z,rot:0}]}))};
 return {plan:{id,name:'Seaplane',description:'Fixture',nodes:[]},build,remaining:{},size:[2,2,8],receipts:[{id:'body',role:'fuselage',optionId:id,cost:{[partId]:20},indices:Array.from({length:20},(_,i)=>i)}]};
}
let candidates:AssemblyComposition[];
beforeEach(()=>{
 candidates=[fixture('plate-2x2-white',1,'first'),fixture('plate-1x2-white',1,'second'),fixture('brick-2x2-white',3,'third')];
 mock.plans.mockReturnValue([]);mock.issues.mockReturnValue([]);mock.search.mockImplementation(()=>({candidates,attempts:3,rejected:0,exhausted:false}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('complete assembly orchestration',()=>{
 it('does not call the provider for unrelated subjects or empty feasible search',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await buildAssemblyFirst({...idea,name:'Dog'},stock,{minParts:20,views,judge:vi.fn()})).toBeNull();
  candidates=[];expect(await buildAssemblyFirst(idea,stock,{minParts:20,views,judge:vi.fn()})).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it('selects only compiled complete layouts and reviews actual geometry without asking for raw coordinates',async()=>{
  const fetch=vi.fn().mockImplementation(async () => reply({choiceId:'layout-2',reason:'A clear thin outline.'}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue(verdict),result=await buildAssemblyFirst(idea,stock,{minParts:20,views,judge});
  expect(result?.composition.plan.id).toBe('second');expect(result?.features[0].indices).toHaveLength(20);expect(judge).toHaveBeenCalledTimes(1);
  const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body.generationConfig.responseSchema.properties.parts).toBeUndefined();expect(body.generationConfig.responseSchema.properties.choiceId.enum).toHaveLength(3);
  const prompt=JSON.stringify(body.contents);expect(prompt).toContain('already assembled');expect(prompt).toContain('immutable modules');expect(prompt).toContain('LAYOUT 2');
  expect(mock.search.mock.calls[0][2]).toMatchObject({minParts:20,maxParts:80});
 });
 it('tries unreviewed alternatives and retains clearer identity within bounded color tradeoffs',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply({choiceId:'layout-1',reason:'First candidate.'})).mockResolvedValueOnce(reply({choiceId:'layout-2',reason:'Better tail.'}));vi.stubGlobal('fetch',fetch);
  const first={...verdict,named:false,pass:false,recognizable:2,complete:2,colors:3,impressive:2};
  const next={...first,named:true,recognizable:3,colors:2};
  const judge=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next).mockResolvedValueOnce(first);
  const result=await buildAssemblyFirst(idea,stock,{minParts:20,views,judge});
  expect(result?.composition.plan.id).toBe('second');expect(result?.reviewed).toBe(3);expect(result?.revised).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);
  const second=JSON.parse(fetch.mock.calls[1][1].body);expect(second.generationConfig.responseSchema.properties.choiceId.enum).not.toContain('layout-1');
 });
 it('allows only one invalid layout-selection repair before failing',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>reply({choiceId:'invented',reason:'Unavailable.'})));
  const judge=vi.fn();await expect(buildAssemblyFirst(idea,stock,{minParts:20,views,judge})).rejects.toThrow(/after one repair/);
  expect(fetch).toHaveBeenCalledTimes(2);expect(judge).not.toHaveBeenCalled();
 });
 it('returns the qualified arrangement rather than an earlier highly recognizable weak draft',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply({choiceId:'layout-1',reason:'First.'})).mockResolvedValueOnce(reply({choiceId:'layout-2',reason:'More complete.'}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValueOnce({...verdict,pass:false,recognizable:5,complete:3,impressive:3,colors:5}).mockResolvedValueOnce(verdict);
  const result=await buildAssemblyFirst(idea,stock,{minParts:20,views,judge});
  expect(result?.composition.plan.id).toBe('second');expect(result?.verdict.pass).toBe(true);expect(result?.reviewed).toBe(2);
 });
 it('retains the reviewed draft on a later service failure and rejects late results after cancellation',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply({choiceId:'layout-1',reason:'First.'})).mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'Unavailable'}}),{status:400}));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValue({...verdict,pass:false,impressive:2});
  expect((await buildAssemblyFirst(idea,stock,{minParts:20,views,judge}))?.composition.plan.id).toBe('first');
  const ctl=new AbortController();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{ctl.abort();return reply({choiceId:'layout-1',reason:'Late.'});}));
  await expect(buildAssemblyFirst(idea,stock,{signal:ctl.signal,minParts:20,views,judge})).rejects.toMatchObject({name:'AbortError'});
 });
 it('rechecks actual geometry and the part floor after rendering before judging',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => reply({choiceId:'layout-1',reason:'First.'})));
  const judge=vi.fn(),mutatingViews=(build:typeof candidates[0]['build'])=>{build.steps.pop();return views();};
  await expect(buildAssemblyFirst(idea,stock,{minParts:20,views:mutatingViews,judge})).rejects.toThrow(/purposeful parts/);expect(judge).not.toHaveBeenCalled();
 });
});
