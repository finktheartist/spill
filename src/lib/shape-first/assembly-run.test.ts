import {afterEach,describe,expect,it,vi} from 'vitest';
import stock from '../fixtures/atlas-photo-pile-20261013-stock.json';
import {constructionIssues} from '../construction';
import {partCount} from '../bricks';
import {runShapeTab,type ShapeVerdict} from './run';
import {pileReach,smallPile,type RankedIdea} from './pipeline';

const idea:RankedIdea={name:'Twin-Boom Seaplane',pitch:'Long thin wings, curved cockpit, paired floats and a distinct twin-boom tail.',why:'The pile has matched long plates.',length:12,width:16,height:6,palette:[{role:'body',color:'black',cells:24}],cells:24,worst:1,shortfall:0};
const verdict:ShapeVerdict={looksLike:'a twin-boom floatplane',named:true,recognizable:4,complete:4,colors:3,impressive:4,pass:true,fixes:[]};
afterEach(()=>vi.unstubAllGlobals());
describe('complete assembly in the real build flow',()=>{
 it.each([true,false])('keeps stock-valid modules and the blind recognition gate (named=%s)',async named=>{
  const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify({choiceId:'layout-1',reason:'The long thin wing and clear tail make a plane.'})}]}}]})));
  vi.stubGlobal('fetch',fetch);
  const judge=vi.fn().mockImplementation(async(build)=>{
   expect(constructionIssues(build,stock,24)).toEqual([]);
   expect(partCount(build)).toBeGreaterThanOrEqual(20);
   return {...verdict,named,pass:named};
  });
  const changes:unknown[]=[];
  const result=await runShapeTab('pile',stock,s=>changes.push(s),{ideas:[idea],views:()=>['data:image/jpeg;base64,AA=='],judge});
  const slot=result.slots[0];
  expect(slot.stats?.assemblyFirst).toBe(true);expect(slot.features).toHaveLength(10);
  expect(slot.features!.flatMap(f=>f.indices).length).toBe(slot.stats?.parts);
  expect(new Set(slot.features!.flatMap(f=>f.indices)).size).toBe(slot.stats?.parts);
  expect(slot.stats?.onPalette).toBeUndefined();expect(changes.length).toBeGreaterThan(2);
  if(named){expect(slot.phase).toBe('ready');expect(slot.build).toBeDefined();expect(slot.stats?.parts).toBe(partCount(slot.build!));}
  else{expect(slot.phase).toBe('failed');expect(slot.unrecognized).toBe(true);expect(slot.build).toBeUndefined();}
  for(const [,request] of fetch.mock.calls){const body=JSON.parse(request.body);expect(body.generationConfig.responseSchema.properties.choiceId).toBeDefined();expect(body.generationConfig.responseSchema.properties.parts).toBeUndefined();}
 });
 it('allows a complete compact model from a larger pile without padding to sculpture size',async()=>{
  const larger=Object.fromEntries(Object.entries(stock).map(([id,n])=>[id,n*40]));
  expect(smallPile(pileReach(larger))).toBe(false);
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify({choiceId:'layout-1',reason:'Compact but complete.'})}]}}]}))));
  const run=await runShapeTab('pile',larger,()=>{},{ideas:[idea],views:()=>['data:image/jpeg;base64,AA=='],judge:async()=>verdict});
  expect(run.slots[0].phase).toBe('ready');expect(run.slots[0].smallModel).toBe(true);
  expect(run.slots[0].stats?.parts).toBeGreaterThanOrEqual(20);expect(run.slots[0].stats?.parts).toBeLessThan(40);
  expect(constructionIssues(run.slots[0].build!,larger,24)).toEqual([]);
 });
});
