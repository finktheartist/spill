import {afterEach,describe,it,expect,vi} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import fixtures from '../fixtures/fox-improv-test-layouts.json';
import {createFoxImprovContext,composeFoxImprovisation} from '../assembly-composer/animal-improv';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {foxLayoutProposal,type FoxHeadLayout} from './fox-head-layout';
import {synthesizeFoxHeads,foxSynthesisPrompt,foxSynthesisSchema} from './animal-improviser';
import {foxTechniqueChoices} from './fox-techniques';
import type {FoxTechniqueLayout} from './fox-technique-layout';
import {buildAnimalFirst} from './animal-first';
import type {ShapeVerdict} from './run';
import type {RankedIdea} from './pipeline';
const discover=vi.hoisted(()=>vi.fn(()=>{throw Error('Authored discovery must not be used for a successful runtime synthesis.');}));
vi.mock('./animal-discovery',()=>({discoverAnimalCompositions:discover}));
const layout=(index=0)=>structuredClone(fixtures.layouts[index]) as FoxHeadLayout;
const techniqueLayout=():FoxTechniqueLayout=>{
 const raw=layout(1);
 return {...raw,parts:raw.parts.filter((_,i)=>![3,5,6,8].includes(i)),techniques:[0,3].map(x=>({
  choiceId:'fox-technique:raised-eye-ledge:reddish-brown:reddish-brown',x,y:0,z:5.2,rot:90,roles:['head','head'],
 }))};
};
const response=(layouts:FoxHeadLayout[])=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify({reasoning:'Test-only geometry, not provider proof',layouts})}]}}]}));
const verdict=(strong=true):ShapeVerdict=>({looksLike:'Fox',recognizable:strong?4:3,complete:4,colors:4,impressive:strong?4:2,fixes:strong?[]:['Reduce the head block and reshape cheeks'],pass:strong,named:true});
const idea:RankedIdea={name:'Fox',pitch:'Fox',why:'',length:12,width:4,height:8,palette:[{role:'coat',color:'reddish-brown',cells:40}],worst:.5,cells:40,shortfall:0};
afterEach(()=>{vi.unstubAllGlobals();discover.mockClear();});
describe('runtime Fox synthesis orchestration',()=>{
 it('uses measured geometry and remaining stock without providing complete head templates',()=>{
  const prompt=foxSynthesisPrompt(createFoxImprovContext(large.stock)!,'Fox');
  expect(prompt).toContain('WORLD STUDS');expect(prompt).toContain('curve-1x2-black');
  for(const id of ['authored-low','authored-curved','shallow-face','broad-cheeks','tapered-neck'])expect(prompt).not.toContain(id);
 });
 it('accepts only real composed geometry and deduplicates repeated contours',async()=>{
  const repeated=layout();repeated.id='same-contour';
  const fetch=vi.fn().mockImplementation(async () => response([layout(),repeated]));vi.stubGlobal('fetch',fetch);
  const result=await synthesizeFoxHeads({...large.stock},'Fox');
  expect(result.candidates).toHaveLength(1);expect(result.rejected[0].reason).toContain('already proposed');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('offers only remaining-stock techniques by default and keeps the controlled arm free of them',async()=>{
  const context=createFoxImprovContext(large.stock)!,choices=foxTechniqueChoices(context.available);
  expect(choices.length).toBeGreaterThan(0);
  expect(foxSynthesisPrompt(context,'Fox',choices)).toContain('free parts PLUS all expanded technique pieces');
  expect(JSON.stringify(foxSynthesisSchema(context,choices))).toContain('choiceId');
  const fetch=vi.fn().mockImplementation(async()=>response([layout()]));vi.stubGlobal('fetch',fetch);
  const enabled=await synthesizeFoxHeads({...large.stock},'Fox');
  const disabled=await synthesizeFoxHeads({...large.stock},'Fox',{techniques:false});
  const on=JSON.parse(fetch.mock.calls[0][1].body),off=JSON.parse(fetch.mock.calls[1][1].body);
  expect(JSON.stringify(on.contents)).toContain('SMALL CONSTRUCTION TECHNIQUES');
  expect(JSON.stringify(off.contents)).not.toContain('SMALL CONSTRUCTION TECHNIQUES');
  expect(enabled.techniqueUses?.[0].uses).toEqual([]);expect(disabled.candidates).toEqual(enabled.candidates);
 });
 it('rejects duplicate accepted IDs so a technique receipt cannot identify the wrong geometry',async()=>{
  const first=layout(),second=layout(1);second.id=first.id;
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => response([first,second])));
  const result=await synthesizeFoxHeads({...large.stock},'Fox');
  expect(result.candidates).toHaveLength(1);expect(result.rejected[0].reason).toContain('already uses this ID');
  expect(result.techniqueUses).toHaveLength(1);
 });
 it('accepts actual tiny supports inside a full fresh head and proves their pieces survive composition',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => response([techniqueLayout()])));
  const result=await synthesizeFoxHeads({...large.stock},'Fox');
  expect(result.candidates).toHaveLength(1);expect(result.techniqueUses?.[0].uses).toHaveLength(2);
  expect(result.techniqueUses?.[0].uses.map(u=>u.targetParts.length)).toEqual([2,2]);
  const expected=composeFoxImprovisation(result.context!,foxLayoutProposal(result.context!,layout(1)));
  expect(animalSilhouetteKey(result.candidates[0].build)).toBe(animalSilhouetteKey(expected.build));
  expect(result.candidates[0].remaining).toEqual(expected.remaining);
 });
 it('bills repeated supports and free pieces together, rejecting a scarce singleton overspend',async()=>{
  const stock={...large.stock,'plate-1x2-reddish-brown':1};
  expect(foxTechniqueChoices(createFoxImprovContext(stock)!.available).some(c=>c.id===techniqueLayout().techniques![0].choiceId)).toBe(true);
  const fetch=vi.fn().mockImplementation(async()=>response([techniqueLayout()]));vi.stubGlobal('fetch',fetch);
  const result=await synthesizeFoxHeads(stock,'Fox');
  expect(result.candidates).toEqual([]);expect(result.techniqueUses).toEqual([]);expect(fetch).toHaveBeenCalledTimes(6);
  expect(result.rejected.some(r=>r.reason.includes('plate-1x2-reddish-brown'))).toBe(true);
 });
 it('returns actual compiler failures for repair instead of silently moving parts',async()=>{
  const bad=layout();bad.parts.find(p=>p.role==='eye-left')!.x+=.25;
  const fetch=vi.fn().mockResolvedValueOnce(response([bad])).mockResolvedValueOnce(response([layout()]));vi.stubGlobal('fetch',fetch);
  const result=await synthesizeFoxHeads({...large.stock},'Fox');expect(result.attempts).toBe(2);expect(result.candidates).toHaveLength(1);
  const request=JSON.parse(fetch.mock.calls[1][1].body);expect(JSON.stringify(request.contents)).toContain('No real connector path');expect(JSON.stringify(request.contents)).toContain('headPartIndices');
 });
 it('fails closed on stale stock and pre-aborted work',async()=>{
  const stock={...large.stock},fetch=vi.fn().mockImplementation(async()=>{stock['curve-1x2-black']=0;return response([layout()]);});vi.stubGlobal('fetch',fetch);
  await expect(synthesizeFoxHeads(stock,'Fox')).rejects.toThrow('inventory changed');
  const ctl=new AbortController();ctl.abort();await expect(synthesizeFoxHeads({...large.stock},'Fox',{signal:ctl.signal})).rejects.toMatchObject({name:'AbortError'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('bounds malformed/failed proposals at six calls and leaves unsupported requests untouched',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>response([]));vi.stubGlobal('fetch',fetch);
  expect((await synthesizeFoxHeads({...large.stock},'Fox')).attempts).toBe(6);expect(fetch).toHaveBeenCalledTimes(6);
  expect((await synthesizeFoxHeads({...large.stock},'Lion')).context).toBeNull();expect(fetch).toHaveBeenCalledTimes(6);
 });
 it('keeps the legacy comparison route on freshly synthesized geometry when construction succeeds',async()=>{
  const fetch=vi.fn().mockImplementation(async () => response([layout(1)]));vi.stubGlobal('fetch',fetch);
  const result=await buildAnimalFirst(idea,{...large.stock},{wholeModel:false,minParts:40,views:()=>[],judge:async()=>verdict()});
  expect(result?.composition.plan.id).toMatch(/^animal-improv:fox:/);expect(result?.build.steps.flatMap(s=>s.parts)).toHaveLength(40);expect(discover).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('reconstructs the whole head from criticism, preserves the body and releases the replaced shape',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response([layout(1)])).mockResolvedValueOnce(response([layout()]));vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockResolvedValueOnce(verdict(false)).mockResolvedValueOnce(verdict()),release=vi.fn();
  const result=await buildAnimalFirst(idea,{...large.stock},{wholeModel:false,minParts:20,views:()=>[],judge,claim:()=>true,release});
  expect(result?.reviewed).toBe(2);expect(result?.revised).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);expect(release).toHaveBeenCalledTimes(1);expect(discover).not.toHaveBeenCalled();
  const context=createFoxImprovContext(large.stock)!,first=composeFoxImprovisation(context,foxLayoutProposal(context,layout(1)));
  expect(animalSilhouetteKey(result!.composition.build)).not.toBe(animalSilhouetteKey(first.build));
  expect(result!.composition.plan.nodes.filter(n=>n.id!=='head-neck')).toEqual(first.plan.nodes.filter(n=>n.id!=='head-neck'));
  expect(JSON.stringify(JSON.parse(fetch.mock.calls[1][1].body).contents)).toContain('Reduce the head block');
 });
});
