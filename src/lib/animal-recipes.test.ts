import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIMAL_BASE_RECIPES, ANIMAL_RECIPES, ANIMAL_SPECIES, animalBaseModule } from './animal-recipes';
import { RECIPES } from './library-recipes';
import { buildCounts, matchRecipe, recipeExample } from './library';
import { animalBasesFor, animalPlanText, assemblyCandidates, assemblyText } from './library-context';
import { constructionIssues } from './construction';
import { isMade } from './catalog';
import { counts, sampleInventory } from './inventory';
import { geometryFingerprint } from './library-discoveries';
import { designBuild, type BuildEvent } from './gemini';

afterEach(() => vi.unstubAllGlobals());
const reply = (value: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 }));

describe('adaptable animal bodies', () => {
  it.each(ANIMAL_BASE_RECIPES.map(r => [r.id, r] as const))('%s is a stock-valid connected base with usable sockets', (_id, r) => {
    const build = recipeExample(r), have = buildCounts(build);
    expect(constructionIssues(build, have, 24)).toEqual([]);
    expect(Object.keys(have).every(isMade)).toBe(true);
    expect(matchRecipe(r, have)).not.toBeNull();
    expect(RECIPES.some(q => q.id === r.id)).toBe(false); // unfinished bodies are agent-only
    expect(animalBaseModule(r.animalBase!, r.id.endsWith('curved') ? 'curved' : 'sloped').ports?.head).toBeDefined();
  });
  it('has eighteen distinct species geometries with a genuinely shared root per family', () => {
    const shaped = ANIMAL_RECIPES.filter(r => r.id.endsWith('curved'));
    expect(shaped).toHaveLength(18);
    expect(new Set(shaped.map(r => geometryFingerprint(recipeExample(r)))).size).toBe(18);
    for (const base of ['quadruped', 'stocky', 'longneck', 'seated', 'bird', 'crawler']) {
      const ids = shaped.filter(r => r.animalBase === base).map(r => r.modules![0].id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(1);
    }
  });
  it('fits the developed quadruped faces without changing their exact reference inventories', () => {
    for (const id of ['fox', 'cat', 'dog']) {
      const r = ANIMAL_RECIPES.find(r => r.id === `animal-${id}-sloped`)!;
      const have = buildCounts(recipeExample(r)), before = structuredClone(have);
      const match = matchRecipe(r, have)!;
      expect(match).not.toBeNull();
      expect(constructionIssues(match.build, have, 24)).toEqual([]);
      expect(match.animalBase).toBe('quadruped');
      for (const [part, n] of Object.entries(match.parts)) expect(n).toBeLessThanOrEqual(have[part] ?? 0);
      expect(have).toEqual(before);
    }
  });
  it('can recolor a shaped body coherently without needing its reference color', () => {
    const r = ANIMAL_RECIPES.find(r => r.id === 'animal-dog-curved')!;
    const have = Object.fromEntries(Object.entries(buildCounts(recipeExample(r))).map(([id, n]) => [id.replace('-tan', '-blue'), n]));
    const m = matchRecipe(r, have)!;
    expect(m).not.toBeNull(); expect(m.palette.body).toBe('blue');
    expect(constructionIssues(m.build, have, 24)).toEqual([]);
  });
  it('retrieves anatomical relatives beyond named catalog species without inventing a fit', () => {
    const have = counts(sampleInventory()), matches = assemblyCandidates('wolf', have, 90);
    expect(ANIMAL_SPECIES.some(a => a.id === 'wolf')).toBe(false);
    expect(matches.some(m => m.recipeId === 'animal-base-quadruped-sloped')).toBe(true);
    expect(assemblyText(matches)).toContain('UNFINISHED ANIMAL BODY');
    expect(assemblyText(matches)).toContain('Open module sockets');
    expect(animalPlanText('wolf')).toContain('species');
    expect(animalBasesFor('alpaca')[0].id).toBe('longneck');
    expect(animalBasesFor('bunnies')[0].id).toBe('seated');
    expect(animalBasesFor('wolves')[0].id).toBe('quadruped');
    expect(animalBasesFor('birdhouse')).toEqual([]);
    expect(assemblyCandidates('wolf', {}, 90)).toEqual([]);
    expect(assemblyCandidates('wolf', have, 8)).toEqual([]);
  });
  it('provides a complete richer animal seed when it fits the planned budget', () => {
    const r = ANIMAL_RECIPES.find(r => r.id === 'animal-fox-curved')!, have = buildCounts(recipeExample(r));
    const matches = assemblyCandidates('fox', have, 90);
    expect(matches.some(m => m.recipeId === r.id)).toBe(true);
    expect(matches.every(m => constructionIssues(m.build, have, 24).length === 0)).toBe(true);
  });
  it('uses a requested animal base as real geometry and refuses to call an unchanged body complete', async () => {
    const inv = sampleInventory(), have = counts(inv), seed = assemblyCandidates('wolf', have, 90)[0];
    const fetch = vi.fn().mockResolvedValueOnce(reply({ assemblyId: seed.recipeId, features: [], colorZones: [] })).mockImplementation(async () => reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const result = await designBuild(inv, { name: 'Wolf', pitch: 'A wolf with pointed ears and a long tail.', difficulty: 2, estimatedParts: 35, keyParts: [] }, e => events.push(e));
    expect(result).toBeNull();
    expect(events.some(e => e.phase === 'ready')).toBe(false);
    expect(events.some(e => e.phase === 'failed' && e.reason.includes('head'))).toBe(true);
    const prompts = fetch.mock.calls.map(c => JSON.parse(c[1].body).contents[0].parts.map((p: { text?: string }) => p.text ?? '').join('\n'));
    expect(prompts[0]).toContain('ANIMAL CONSTRUCTION FAMILIES');
    expect(prompts[1]).toContain('Remaining pieces only');
    expect(prompts[1]).toContain('The existing parts are FIXED');
  });
});
