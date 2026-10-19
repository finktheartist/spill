import { afterEach, expect, it, vi } from 'vitest';
import { designBuild, type BuildEvent } from './gemini';
import { refinedAnimalCandidates } from './refined-animal-modules';
import { builderAssemblies } from './library-context';
import { parsePartId } from './bricks';
import { counts, type Inventory } from './inventory';
import data from '../../test/fixtures/photo-stock.json';

const inv:Inventory={source:'photo',photos:[],others:[],parts:Object.fromEntries(Object.entries(data.stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:1,boxes:[]}]))};
const idea={name:'Standing hound',pitch:'A complete dog with hanging ears, a shaped muzzle, four paws and a tail.',estimatedParts:55,difficulty:2,keyParts:[],mode:'bucket' as const};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
afterEach(()=>vi.unstubAllGlobals());

it('offers only stock-fitting prototype options and executes the chosen component geometry',async()=>{
 const candidates=refinedAnimalCandidates(counts(inv)),seed=candidates.find(c=>c.recipeId==='components:refined-hound-low-upright')!;
 const fetch=vi.fn().mockImplementation(async () => reply({assemblyId:seed.recipeId,features:[],colorZones:[]}));
 vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];
 const build=await designBuild(inv,idea,e=>events.push(e),{experimentalKit:'refined-hound'});
 expect(build?.steps).toEqual(seed.build.steps);
 expect(fetch).toHaveBeenCalledTimes(1);
 const body=JSON.parse(fetch.mock.calls[0][1].body);
 expect(body.generationConfig.responseSchema.properties.assemblyId.enum).toEqual(['none',...candidates.map(c=>c.recipeId)]);
 expect(body.generationConfig.responseSchema.properties.assemblyId.enum).not.toContain('components:refined-hound-tall-upright');
 expect(events.some(e=>e.phase==='section')).toBe(false);
 // No views in this test means execution proof only, never an appearance pass.
});

it('keeps the real appearance gate and bounded refinement for experimental assemblies',async()=>{
 const seed=refinedAnimalCandidates(counts(inv))[0];
 const fetch=vi.fn()
  .mockResolvedValueOnce(reply({assemblyId:seed.recipeId,features:[],colorZones:[]}))
  .mockResolvedValueOnce(reply({looksLike:'brown dog',recognizable:4,complete:3,colors:4,impressive:3,fixes:['Shape the torso.']}))
  .mockResolvedValueOnce(reply({matchesSubject:true}))
  .mockImplementation(async () => reply({parts:[],changes:[]}));
 vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];
 const build=await designBuild(inv,idea,e=>events.push(e),{experimentalKit:'refined-hound',views:()=>['data:image/jpeg;base64,AA==']});
 expect(build).toBeNull();expect(fetch).toHaveBeenCalledTimes(5);
 expect(events.some(e=>e.phase==='ready')).toBe(false);
 expect(events.some(e=>e.phase==='failed'&&e.reason.includes('visual quality'))).toBe(true);
 expect(events.findIndex(e=>e.phase==='judged')).toBeLessThan(events.findIndex(e=>e.phase==='rebuilding'));
 expect(builderAssemblies(idea.name,counts(inv),120).some(m=>m.recipeId.startsWith('components:refined-hound-'))).toBe(false);
});

it('executes a silhouette plan as geometry instead of rebuilding its outline from text',async()=>{
 const {contourCandidates}=await import('./contour-animals');
 const seed=contourCandidates(counts(inv)).find(m=>m.recipeId==='contour:duck')!;
 const fetch=vi.fn().mockImplementation(async () => reply({assemblyId:seed.recipeId,features:[],colorZones:[]}));
 vi.stubGlobal('fetch',fetch);
 const build=await designBuild(inv,{...idea,name:'Duck'},()=>{},{experimentalKit:'contour-animals'});
 expect(build?.steps).toEqual(seed.build.steps);
 expect(fetch).toHaveBeenCalledTimes(1);
 const prompt=JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0].text;
 expect(prompt).toContain('EXPERIMENTAL SILHOUETTE PLAN');
 expect(prompt).toContain('Flat bill projects below the eyes');
});
