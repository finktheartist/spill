import { afterEach, expect, it, vi } from 'vitest';
import { refinedAnimalCandidates, refinedMuzzleScope, refinedBackScope } from './refined-animal-modules';
import { moduleParts, modulePrompt, moduleReplacement } from './module-refinement';
import { constructionIssues, constructionKey } from './construction';
import { parsePartId, placedKey } from './bricks';
import { designBuild, refineBucketBuild, refineModuleSequence, passes, type BuildEvent } from './gemini';
import { draftRefinementWins } from './build-quality';
import type { Inventory } from './inventory';
import data from '../../test/fixtures/photo-stock.json';

const have = data.stock, seed = refinedAnimalCandidates(have).find(c => c.recipeId === 'components:refined-hound-tall-swept')!;
const original = seed.build, scope = refinedMuzzleScope(seed, have)!;
const inv: Inventory = { source: 'photo', photos: [], others: [], parts: Object.fromEntries(Object.entries(have).map(([id,count]) => [id, { kind: parsePartId(id)!, count, confidence: 1, boxes: [] }])) };
const idea = { name: 'Hound dog', pitch: 'Standing hound with a shaped muzzle.', estimatedParts: 55, difficulty: 2, keyParts: [], mode: 'bucket' as const };
const before = { looksLike: 'dog', recognizable: 4, complete: 3, colors: 4, impressive: 3, fixes: ['Narrow the chin.'] };
const after = { ...before, complete: 4, impressive: 4 };
const replacement = () => moduleParts(original, scope).map((p, i) => i === 0 ? { ...p, partId: 'plate-2x2-white', x: p.x + 1 } : { ...p });
const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('narrows a muzzle with real spare stock while preserving every locked placement', () => {
 const result = moduleReplacement(original, scope, replacement(), have, 120);
 expect(result.issues).toEqual([]); expect(result.build).toBeDefined();
 expect(constructionIssues(result.build!, have, 24)).toEqual([]);
 const fixed = original.steps.flatMap(s => s.parts).filter((_, i) => !scope.indices.includes(i));
 const candidate = result.build!.steps.flatMap(s => s.parts).map(placedKey);
 for (const p of fixed) expect(candidate.filter(k => k === placedKey(p))).toHaveLength(1);
 expect(constructionKey(result.build!)).not.toBe(constructionKey(original));
 expect(original.steps.flatMap(s => s.parts)[scope.indices[0]].partId).toBe('plate-2x4-white');
});

it('creates exact, compact muzzle tasks for every available refined stance', () => {
 for (const match of refinedAnimalCandidates(have)) {
  const local = refinedMuzzleScope(match, have)!;
  expect(local.indices).toHaveLength(4);
  expect(moduleReplacement(match.build, local, moduleParts(match.build, local), have, 120).build).toBe(match.build);
  expect(modulePrompt(match.build, local).length).toBeLessThan(6500);
  expect(modulePrompt(match.build, local)).not.toContain('Point the narrow front');
  expect(Object.keys(local.stock).length).toBeLessThan(30);
 }
});

it('treats empty or reordered identical modules as unchanged', () => {
 expect(moduleReplacement(original, scope, [], have, 120).build).toBe(original);
 expect(moduleReplacement(original, scope, moduleParts(original, scope).reverse(), have, 120).build).toBe(original);
});

it('rejects stale receipts, malformed parts, excess count, bounds, and missing connections atomically', () => {
 expect(moduleReplacement({ ...original, steps: [] }, scope, [], have, 120).issues.join()).toContain('stale');
 for (const raw of [null, [{}], Array(7).fill(replacement()[0])]) expect(moduleReplacement(original, scope, raw, have, 120).build).toBeUndefined();
 const escaped = replacement(); escaped[0].x = 12;
 expect(moduleReplacement(original, scope, escaped, have, 120).issues.join()).toContain('bounds');
 expect(moduleReplacement(original, scope, replacement().slice(1), have, 120).issues.join()).toContain('connection cells');
});

it('rejects local overdraft and overlap with a locked cheek, even with enough global stock', () => {
 const borrowed = replacement(); borrowed.push({ ...borrowed[0] });
 expect(moduleReplacement(original, scope, borrowed, have, 120).issues.join()).toContain('Module stock exceeded');
 const collision = replacement(); collision[2].x = 1;
 const result = moduleReplacement(original, scope, collision, have, 120);
 expect(result.build).toBeUndefined(); expect(result.issues.join()).toMatch(/overlap/i);
});

it('routes the real pipeline through a small module schema and the existing two visual gates', async () => {
 vi.spyOn(Math, 'random').mockReturnValue(0); // candidate A
 const fetch = vi.fn()
  .mockResolvedValueOnce(reply({ assemblyId: seed.recipeId, features: [], colorZones: [] }))
  .mockResolvedValueOnce(reply(before))
  .mockResolvedValueOnce(reply({ matchesSubject: true }))
  .mockResolvedValueOnce(reply({ parts: replacement(), changes: ['Narrower chin.'] }))
  .mockResolvedValueOnce(reply({ a: after, b: before, preferred: 'A', reason: 'Narrower chin.' }))
  .mockResolvedValueOnce(reply(after))
  .mockResolvedValueOnce(reply({ matchesSubject: true }))
  .mockResolvedValueOnce(reply({ parts: [], changes: [] }));
 vi.stubGlobal('fetch', fetch);
 const events: BuildEvent[] = [];
 const build = await designBuild(inv, idea, e => events.push(e), { experimentalKit: 'refined-hound', views: () => ['data:image/jpeg;base64,AA=='] });
 expect(build).not.toBeNull(); expect(constructionKey(build!)).not.toBe(constructionKey(original));
 expect(events.find(e => e.phase === 'compared')).toMatchObject({ selected: 'refinement' });
 expect(events.some(e => e.phase === 'ready')).toBe(true);
 expect(fetch).toHaveBeenCalledTimes(8);
 const request = JSON.parse(fetch.mock.calls[3][1].body);
 expect(request.generationConfig.responseSchema.properties.parts.maxItems).toBe(6);
 expect(request.generationConfig.responseSchema.properties.moves).toBeUndefined();
 expect(request.contents[0].parts.at(-1).text.length).toBeLessThan(6500);
});

it('keeps the original when a locally valid edit is not visibly better', async () => {
 const fetch = vi.fn().mockResolvedValueOnce(reply({ parts: replacement(), changes: ['Narrower chin.'] }))
  .mockResolvedValueOnce(reply({ a: before, b: before, preferred: 'tie', reason: 'No meaningful improvement.' }));
 vi.stubGlobal('fetch', fetch);
 const result = await refineBucketBuild(inv, idea, original, before, () => {}, { views: () => ['data:image/jpeg;base64,AA=='] }, undefined, 120, scope);
 expect(result.build).toBe(original); expect(result.improved).toBe(false);
 expect(fetch).toHaveBeenCalledTimes(2);
});

it('allows one bounded repair and preserves the whole original after two invalid modules', async () => {
 const fetch = vi.fn().mockImplementation(async () => reply({ parts: [{ partId: 'plate-1x2-black', x: 2, y: 2, z: 22, rot: 0 }], changes: [] }));
 vi.stubGlobal('fetch', fetch);
 const result = await refineBucketBuild(inv, idea, original, before, () => {}, { views: () => ['data:image/jpeg;base64,AA=='] }, undefined, 120, scope);
 expect(result.build).toBe(original); expect(result.improved).toBe(false);
 expect(fetch).toHaveBeenCalledTimes(2);
});

it('retains an A/B-preferred local draft inside the same score band, without passing it as finished', () => {
 expect(draftRefinementWins(before, before, true)).toBe(true);
 expect(passes(before)).toBe(false);
 expect(draftRefinementWins(before, before, false)).toBe(false);
 expect(draftRefinementWins(before, {...before, colors:3}, true)).toBe(false);
 expect(draftRefinementWins(before, {...before, subjectMatched:false}, true)).toBe(false);
 expect(draftRefinementWins(before, {...before, recognizable:3}, true)).toBe(false);
});

it('hands the retained draft and recomputed stock to the next module even below the finished threshold', async () => {
 vi.spyOn(Math, 'random').mockReturnValue(0);
 const fetch = vi.fn().mockResolvedValueOnce(reply({parts:replacement(),changes:['Narrow the chin.']}))
  .mockResolvedValueOnce(reply({a:before,b:before,preferred:'A',reason:'Less white shelf.'}))
  .mockResolvedValueOnce(reply(before)).mockResolvedValueOnce(reply({matchesSubject:true}))
  .mockResolvedValueOnce(reply({parts:[],changes:[]}));
 vi.stubGlobal('fetch',fetch);
 let nextDraft:typeof original|undefined;
 const result=await refineModuleSequence(inv,idea,original,before,[
  {id:scope.id,scope:()=>scope},
  {id:'shoulder',scope:(draft,stock)=>{nextDraft=draft;const next=refinedBackScope(seed,draft,stock)!;expect(next.originalKey).toBe(constructionKey(draft));return next;}},
 ],()=>{},{views:()=>['data:image/jpeg;base64,AA==']},120);
 expect(nextDraft).not.toBe(original);
 expect(result.build).toBe(nextDraft);
 expect(result.improved).toBe(true);expect(passes(result.verdict)).toBe(false);
 expect(constructionIssues(result.build,have,24)).toEqual([]);
 expect(fetch).toHaveBeenCalledTimes(5);
});

it('accumulates two preferred valid edits on one draft and one inventory ledger',async()=>{
 vi.spyOn(Math,'random').mockReturnValue(0);
 const narrowed=moduleReplacement(original,scope,replacement(),have,120).build!;
 const shoulder=refinedBackScope(seed,narrowed,have)!;
 const [x,y,z]=shoulder.min;
 const newShoulder=[...moduleParts(narrowed,shoulder),
  {partId:'plate-1x2-medium-nougat',x:x+1,y,z:z+1,rot:0},
  {partId:'cheese-1x1-medium-nougat',x:x+1,y,z:z+2,rot:270},
  {partId:'cheese-1x1-medium-nougat',x:x+2,y,z:z+2,rot:90}];
 const fetch=vi.fn();
 for(const parts of [replacement(),newShoulder])fetch.mockResolvedValueOnce(reply({parts,changes:['Local shape improvement.']}))
  .mockResolvedValueOnce(reply({a:before,b:before,preferred:'A',reason:'Clearer local contour.'}))
  .mockResolvedValueOnce(reply(before)).mockResolvedValueOnce(reply({matchesSubject:true}));
 vi.stubGlobal('fetch',fetch);
 const result=await refineModuleSequence(inv,idea,original,before,[{id:'muzzle',scope:()=>scope},{id:'shoulder',scope:(draft,stock)=>refinedBackScope(seed,draft,stock)}],()=>{},{views:()=>['data:image/jpeg;base64,AA==']},120);
 expect(fetch).toHaveBeenCalledTimes(8);
 expect(constructionIssues(result.build,have,24)).toEqual([]);
 const parts=result.build.steps.flatMap(s=>s.parts);
 expect(parts.some(p=>p.partId==='plate-2x2-white'&&p.x===2&&p.z===17)).toBe(true);
 expect(parts.filter(p=>p.partId==='cheese-1x1-medium-nougat')).toHaveLength(2);
 expect(passes(result.verdict)).toBe(false);
});
