import {afterEach,describe,it,expect,vi} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts,testBlueprint} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal,wholeAnimalIssues} from '../assembly-composer/animal-whole';
import {animalBlueprintIssues,validateAnimalBlueprint} from './animal-blueprint';
const mock=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock('./pipeline',()=>({generate:mock.generate}));
import {synthesizeWholeAnimals,wholeAnimalBodyKey,expandWholeAnimalProposal} from './whole-animal-synthesis';
const response=(json:unknown)=>({json,content:{role:'model',parts:[{text:JSON.stringify(json)}]},seconds:0});
const fixtures=()=>authoredWholeAnimalTestLayouts().map(layout=>{const c=composeWholeAnimal(large.stock,layout),blueprint=testBlueprint(c);return {layout,c,blueprint};});
afterEach(()=>vi.clearAllMocks());
describe('stock-led whole-animal synthesis',()=>{
 it('plans before placement, then compiles two genuinely different whole bodies without importing their recipes into prompts',async()=>{
  const f=fixtures();for(const x of f){expect(validateAnimalBlueprint(x.blueprint,large.stock).issues).toEqual([]);expect(animalBlueprintIssues(x.c,x.blueprint,large.stock)).toEqual([]);}
  mock.generate.mockResolvedValueOnce(response({reasoning:'Test only',blueprints:f.map(x=>x.blueprint)}));
  f.forEach(x=>mock.generate.mockResolvedValueOnce(response({reasoning:'Test only',layouts:[{...x.layout,blueprintId:x.blueprint.id}]})));
  const before=JSON.stringify(large.stock),trace:unknown[]=[];
  const result=await synthesizeWholeAnimals(large.stock,'Fennec fox',{staged:false,minParts:40,debug:(_label,data)=>{trace.push(data);if(data&&typeof data==='object'&&'accepted'in data)(data as {accepted:unknown[]}).accepted=[];}});
  expect(result.candidates).toHaveLength(2);expect(result.planningAttempts).toBe(1);expect(result.attempts).toBe(2);expect(result.rejected).toEqual([]);expect(JSON.stringify(large.stock)).toBe(before);
  expect(new Set(result.candidates.map(wholeAnimalBodyKey)).size).toBe(2);result.candidates.forEach(c=>expect(wholeAnimalIssues(c)).toEqual([]));
  const prompt=JSON.stringify(mock.generate.mock.calls[0][0]);expect(prompt).toContain('THREE materially different');expect(prompt).toContain('ORIGINAL complete inventory');expect(prompt).not.toContain('test-compact');expect(prompt).toContain('No fixed 21-piece body');expect(trace.length).toBeGreaterThan(0);
 });
 it('rejects a broken full construction and gives the other plan a turn before repair',async()=>{
  const f=fixtures(),bad={...f[0].layout,id:'broken',parts:f[0].layout.parts.filter(p=>p.role!=='leg-front-left')};
  mock.generate.mockResolvedValueOnce(response({blueprints:f.map(x=>x.blueprint)})).mockResolvedValueOnce(response({layouts:[{...bad,blueprintId:f[0].blueprint.id}]})).mockResolvedValueOnce(response({layouts:[{...f[1].layout,blueprintId:f[1].blueprint.id}]})).mockResolvedValueOnce(response({layouts:[{...f[0].layout,blueprintId:f[0].blueprint.id}]}));
  const result=await synthesizeWholeAnimals(large.stock,'Fox',{staged:false,minParts:40});expect(result.attempts).toBe(3);expect(result.candidates).toHaveLength(2);expect(result.rejected).toHaveLength(1);
  expect(JSON.stringify(mock.generate.mock.calls[2][0])).toContain('test-wide-crouching');expect(JSON.stringify(mock.generate.mock.calls[3][0])).toContain('No new acceptable whole construction');
 });
 it('ignores paint/head-only changes as body diversity and refuses an already-offered body',async()=>{
  const f=fixtures()[0],clone=structuredClone(f.c);for(const r of clone.receipts.filter(r=>r.role==='head'))for(const i of r.indices)clone.build.steps[i].parts[0].x+=.25;
  expect(wholeAnimalBodyKey(clone)).toBe(wholeAnimalBodyKey(f.c));
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValue(response({layouts:[{...f.layout,blueprintId:f.blueprint.id}]}));
  const result=await synthesizeWholeAnimals(large.stock,'Fox',{staged:false,minParts:40,maxCandidates:1,avoidBodyKeys:[wholeAnimalBodyKey(f.c)]});expect(result.candidates).toEqual([]);expect(result.attempts).toBe(6);expect(result.rejected.every(r=>r.reason.includes('contour was already offered'))).toBe(true);
 });
 it('rejects cancellation and a changed original inventory after provider await',async()=>{
  const ctl=new AbortController();ctl.abort();await expect(synthesizeWholeAnimals(large.stock,'Fox',{signal:ctl.signal})).rejects.toMatchObject({name:'AbortError'});expect(mock.generate).not.toHaveBeenCalled();
  const stock={...large.stock};mock.generate.mockImplementationOnce(async()=>{stock['plate-1x2-reddish-brown']--;return response({blueprints:[]});});
  await expect(synthesizeWholeAnimals(stock,'Fox')).rejects.toThrow('inventory changed');
 });
 it('never invents unsupported technique topology or expands over the whole budget',()=>{
  const f=fixtures()[0];expect(()=>expandWholeAnimalProposal({...f.layout,blueprintId:f.blueprint.id,techniques:[{choiceId:'absent',x:0,y:0,z:0,rot:0,roles:['head']}]},large.stock)).toThrow('offered technique');
 });
 it('cleans up a deadline when rendering the prior model throws and never calls a provider for unsupported subjects',async()=>{
  expect((await synthesizeWholeAnimals(large.stock,'Lion')).candidates).toEqual([]);expect(mock.generate).not.toHaveBeenCalled();
  const f=fixtures()[0];vi.useFakeTimers();
  try{await expect(synthesizeWholeAnimals(large.stock,'Fox',{critique:{composition:f.c,verdict:{looksLike:'Fox',named:true,pass:false,recognizable:4,complete:4,colors:4,impressive:2,fixes:[]}},views:()=>{throw Error('Renderer stopped');}})).rejects.toThrow('Renderer stopped');expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
 });

 it('retains an already checked complete candidate if a later provider request fails, while stock changes still invalidate it',async()=>{
  const f=fixtures();mock.generate.mockResolvedValueOnce(response({blueprints:f.map(x=>x.blueprint)})).mockResolvedValueOnce(response({layouts:[{...f[0].layout,blueprintId:f[0].blueprint.id}]})).mockRejectedValueOnce(Error('Provider timed out'));
  const result=await synthesizeWholeAnimals({...large.stock},'Fox',{staged:false,minParts:40});expect(result.candidates).toHaveLength(1);expect(result.rejected.at(-1)?.reason).toBe('Provider timed out');expect(wholeAnimalIssues(result.candidates[0])).toEqual([]);
  const stock={...large.stock};mock.generate.mockResolvedValueOnce(response({blueprints:f.map(x=>x.blueprint)})).mockResolvedValueOnce(response({layouts:[{...f[0].layout,blueprintId:f[0].blueprint.id}]})).mockImplementationOnce(async()=>{stock['plate-1x1-pink']=0;throw Error('Provider stopped');});
  await expect(synthesizeWholeAnimals(stock,'Fox',{staged:false,minParts:40})).rejects.toThrow('inventory changed');
 });

 it('retains a complete checked model at its own deadline but respects user cancellation after acceptance',async()=>{
  const f=fixtures();vi.useFakeTimers();
  try{
   mock.generate.mockResolvedValueOnce(response({blueprints:f.map(x=>x.blueprint)})).mockResolvedValueOnce(response({layouts:[{...f[0].layout,blueprintId:f[0].blueprint.id}]})).mockImplementationOnce(async()=>{vi.advanceTimersByTime(480000);throw new DOMException('Budget ended','AbortError');});
   const out=await synthesizeWholeAnimals({...large.stock},'Fox',{staged:false,minParts:40});expect(out.candidates).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
   const ctl=new AbortController();mock.generate.mockResolvedValueOnce(response({blueprints:f.map(x=>x.blueprint)})).mockResolvedValueOnce(response({layouts:[{...f[0].layout,blueprintId:f[0].blueprint.id}]})).mockImplementationOnce(async()=>{ctl.abort();throw new DOMException('User stopped','AbortError');});
   await expect(synthesizeWholeAnimals({...large.stock},'Fox',{staged:false,minParts:40,signal:ctl.signal})).rejects.toMatchObject({name:'AbortError'});
  }finally{vi.useRealTimers();}
 });

});
