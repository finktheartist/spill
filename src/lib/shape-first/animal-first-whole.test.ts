import {afterEach,describe,it,expect,vi} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts,testBlueprint} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal,wholeAnimalIssues} from '../assembly-composer/animal-whole';
import {wholeAnimalBodyKey} from './whole-animal-synthesis';
import type {ShapeVerdict} from './run';
import type {RankedIdea} from './pipeline';
const mocks=vi.hoisted(()=>({whole:vi.fn(),legacy:vi.fn(),discover:vi.fn(),generate:vi.fn()}));
vi.mock('./whole-animal-synthesis',async original=>({...await original<typeof import('./whole-animal-synthesis')>(),synthesizeWholeAnimals:mocks.whole}));
vi.mock('./animal-improviser',()=>({synthesizeFoxHeads:mocks.legacy}));
vi.mock('./animal-discovery',()=>({discoverAnimalCompositions:mocks.discover}));
vi.mock('./pipeline',async original=>({...await original<typeof import('./pipeline')>(),generate:mocks.generate}));
import {buildAnimalFirst} from './animal-first';
const idea:RankedIdea={name:'Fennec fox',pitch:'Fox',why:'',length:12,width:4,height:8,palette:[{role:'coat',color:'reddish-brown',cells:40}],worst:.5,cells:40,shortfall:0};
const verdict=(ok=true):ShapeVerdict=>({looksLike:'Fox',recognizable:4,complete:4,colors:4,impressive:ok?4:2,fixes:ok?[]:['Rework the body proportions and stance'],pass:ok,named:true});
const compositions=()=>authoredWholeAnimalTestLayouts().map(l=>composeWholeAnimal(large.stock,l));
const result=(candidates:ReturnType<typeof compositions>)=>({candidates,blueprints:[],designs:[],planningAttempts:1,attempts:1,rejected:[]});
afterEach(()=>vi.clearAllMocks());
describe('opted-in animal route uses editable whole-body construction',()=>{
 it('uses the opted-in whole generator, preserves request and provides human captions over unchanged construction',async()=>{
  const [c]=compositions(),before=JSON.stringify(c);mocks.whole.mockResolvedValueOnce(result([c]));
  const out=await buildAnimalFirst(idea,{...large.stock},{wholeModel:true,minParts:40,views:()=>[],judge:async()=>verdict()});
  expect(out?.composition).toBe(c);expect(JSON.stringify(c)).toBe(before);expect(out?.build.steps.flatMap(s=>s.parts)).toEqual(c.build.steps.flatMap(s=>s.parts));expect(out?.build.steps.some(s=>s.caption.includes('gap beneath the belly open'))).toBe(true);
  expect(out?.requestedName).toBe('Fennec fox');expect(out?.idea.name).toBe('Fox');expect(wholeAnimalIssues(c)).toEqual([]);expect(mocks.legacy).not.toHaveBeenCalled();expect(mocks.discover).not.toHaveBeenCalled();
  expect(mocks.whole.mock.calls[0][2].minParts).toBe(40);
 });
 it('replans any anatomy from whole-model criticism with the original pile and excludes already offered body contours',async()=>{
  const [a,b]=compositions(),stock={...large.stock},held=new Set(),release=vi.fn(c=>held.delete(c));mocks.whole.mockResolvedValueOnce(result([a])).mockResolvedValueOnce(result([b]));
  const judge=vi.fn().mockResolvedValueOnce(verdict(false)).mockResolvedValueOnce(verdict());
  const out=await buildAnimalFirst(idea,stock,{wholeModel:true,minParts:40,views:()=>[],judge,claim:c=>{held.add(c);return true;},release});
  expect(out?.composition).toBe(b);expect(out?.reviewed).toBe(2);expect(out?.revised).toBe(true);expect([...held]).toEqual([b.build]);expect(release).toHaveBeenCalledWith(a.build);
  const args=mocks.whole.mock.calls[1];expect(args[0]).toBe(stock);expect(args[2].critique.composition).toBe(a);expect(args[2].avoidBodyKeys).toEqual([wholeAnimalBodyKey(a)]);expect(wholeAnimalBodyKey(a)).not.toBe(wholeAnimalBodyKey(b));
 });
 it('does not retain a reviewed model after inventory changes or caller cancellation',async()=>{
  const [c]=compositions(),stock={...large.stock},release=vi.fn();mocks.whole.mockResolvedValueOnce(result([c]));
  await expect(buildAnimalFirst(idea,stock,{wholeModel:true,minParts:40,views:()=>[],claim:()=>true,release,judge:async()=>{stock['plate-1x1-pink']=0;return verdict();}})).rejects.toThrow('inventory changed');expect(release).toHaveBeenCalledWith(c.build);
  const ctl=new AbortController();mocks.whole.mockResolvedValueOnce(result([c]));await expect(buildAnimalFirst(idea,{...large.stock},{wholeModel:true,minParts:40,views:()=>[],signal:ctl.signal,judge:async()=>{ctl.abort();return verdict();}})).rejects.toMatchObject({name:'AbortError'});
 });
 it('reviews an already compiled alternative before spending the remaining review budget on regeneration',async()=>{
  const [a,b]=compositions();mocks.whole.mockResolvedValueOnce(result([a,b]));
  mocks.generate.mockResolvedValueOnce({json:{choiceId:'animal-1',reason:'Compare this silhouette first'}});
  const judge=vi.fn().mockResolvedValueOnce(verdict(false)).mockResolvedValueOnce(verdict());
  const out=await buildAnimalFirst(idea,{...large.stock},{wholeModel:true,minParts:40,views:()=>[],judge});
  expect(out?.composition).toBe(b);expect(out?.reviewed).toBe(2);expect(mocks.whole).toHaveBeenCalledOnce();
 });
 it('labels authored fallback honestly and never silently pays for the head-only path',async()=>{
  mocks.whole.mockResolvedValueOnce(result([]));mocks.discover.mockResolvedValueOnce({found:{candidates:[],attempts:0,rejected:0,exhausted:false},planCount:0});
  expect(await buildAnimalFirst(idea,{...large.stock},{wholeModel:true,minParts:40,views:()=>[],judge:vi.fn()})).toBeNull();expect(mocks.legacy).not.toHaveBeenCalled();expect(mocks.discover).toHaveBeenCalledOnce();
 });
 it('binds revision design evidence to the actual composition when a provider reuses an earlier ID',async()=>{
  const [a,b]=compositions(),oldPlan=testBlueprint(a),newPlan=testBlueprint(b);newPlan.description='Actual revised wider crouching anatomy';b.plan.id=a.plan.id;
  mocks.whole.mockResolvedValueOnce({...result([a]),designs:[{compositionId:a.plan.id,blueprint:oldPlan,uses:[]}]}).mockResolvedValueOnce({...result([b]),designs:[{compositionId:b.plan.id,blueprint:newPlan,uses:[]}]});
  const judge=vi.fn().mockResolvedValueOnce(verdict(false)).mockResolvedValueOnce(verdict()),out=await buildAnimalFirst(idea,{...large.stock},{wholeModel:true,minParts:40,views:()=>[],judge});expect(out?.composition).toBe(b);expect(out?.design?.blueprint).toBe(newPlan);expect(out?.design?.blueprint).not.toBe(oldPlan);
 });

});
