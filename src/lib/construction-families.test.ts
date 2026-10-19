import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryCard } from '../components/BuildLibrary';
import { familyPlanText, strategiesFor, strategyForRecipe } from './construction-families';
import { FAMILY_RECIPES } from './family-recipes';
import { RECIPES, type Recipe } from './library-recipes';
import { buildCounts, closestRecipe, featureAllocation, libraryFor, matchFamily, matchRecipe, recipeExample, type LibraryEntry } from './library';
import { entryMatches, familyReadiness, planForSubject, relatedBuilds } from './library-planner';
import { constructionIssues } from './construction';
import { isMade } from './catalog';
import { assemblyCandidates, assemblyText } from './library-context';
import { counts, sampleInventory } from './inventory';
import { designBuild, type Idea } from './gemini';

const frame: Recipe = {
  id: 'shared-ledger', family: 'test', name: 'Test tower', pitch: '', features: [], palette: { body: 'red', trim: 'red' }, contrast: [],
  steps: Array.from({ length: 5 }, (_, z) => ({ caption: `Level ${z}`, feature: { name: z < 3 ? 'Supporting frame' : 'Crown', kind: z < 3 ? 'structure' as const : 'identity' as const }, parts: [{ shape: 'plate-1x2', role: z < 3 ? 'body' as const : 'trim' as const, x: 0, y: 0, z, rot: 0 }] })),
};
const robot = FAMILY_RECIPES.find(r => r.family === 'scout-robot')!;

describe('whole feature planning', () => {
  it('compiles different subjects on shared structures, with all required features', () => {
    expect(FAMILY_RECIPES.length).toBeGreaterThanOrEqual(12);
    for (const r of FAMILY_RECIPES) {
      expect(r.modules!.length).toBeGreaterThanOrEqual(3);
      expect(r.steps.every(s => s.feature?.name)).toBe(true);
    }
    const frameIds = (family: string) => FAMILY_RECIPES.filter(r => r.family === family).map(r => r.modules![0].id);
    expect(frameIds('scout-robot')).toEqual(frameIds('space-explorer'));
    const aircraft = FAMILY_RECIPES.filter(r => r.family === 'survey-plane');
    expect(aircraft).toHaveLength(4);
    for (const r of aircraft) expect(r.modules!.map(m => m.parent)).toEqual([undefined, 'structure', 'structure', 'structure']);
  });

  it('accounts for every actual split piece exactly once, while reserving defining features first', () => {
    const stock = counts(sampleInventory());
    const r = RECIPES.find(r => r.id === 'cottage-6-slopes') ?? RECIPES.find(r => r.family === 'cottage')!;
    const match = matchRecipe(r, stock)!;
    expect(match).not.toBeNull();
    const allocation = featureAllocation(r, match.build, stock);
    const used: Record<string, number> = {};
    for (const f of allocation) for (const [id, n] of Object.entries(f.parts)) used[id] = (used[id] ?? 0) + n;
    expect(used).toEqual(buildCounts(match.build));
    expect(allocation.flatMap(f => f.missing)).toEqual([]);
    expect(allocation[0].kind).toBe('identity');
    expect(assemblyText([match])).toContain('already included, never add these counts again');
  });

  it('recognizes all object groups and applies category-specific craft rules', () => {
    const cases = { fox: 'animals', foxes: 'animals', horse: 'animals', rhinoceros: 'animals', building: 'buildings', cars: 'road-vehicles', buses: 'road-vehicles', airplanes: 'aircraft', boats: 'watercraft', characters: 'characters', machines: 'machines', furniture: 'objects', plants: 'nature' };
    for (const [name, group] of Object.entries(cases)) {
      expect(strategiesFor(name).map(f => f.id)).toContain(group);
      expect(familyPlanText(name)).toContain('one shared stock ledger');
    }
    expect(familyPlanText('machines')).toContain('static models honestly');
    expect(familyPlanText('airplanes')).toContain('separated tail');
    expect(strategyForRecipe(RECIPES.find(r => r.id === 'biplane')!).id).toBe('aircraft');
    expect(strategyForRecipe(RECIPES.find(r => r.id === 'robot')!).id).toBe('characters');
  });
});

describe('explicit near fits', () => {
  it('keeps missing eyes attached in the complete plan and off the ready list', () => {
    const stock = buildCounts(recipeExample(robot)); delete stock['brick-1x1-black'];
    const before = structuredClone(stock), entry = matchFamily([robot], stock);
    expect(entry.match).toBeNull();
    expect(entry.matches).toEqual([]);
    expect(entry.near?.missing).toEqual([{ partId: 'brick-1x1-black', count: 2 }]);
    const near = entry.near!;
    expect(near.features.find(f => f.name === 'Separate eyes and antenna')?.missing).toEqual(near.missing);
    const supplemented = { ...stock, 'brick-1x1-black': 2 };
    expect(constructionIssues(near.match.build, supplemented, 24)).toEqual([]);
    expect(Object.keys(near.match.parts).every(isMade)).toBe(true);
    expect(stock).toEqual(before);
    const html = renderToStaticMarkup(createElement(LibraryCard, { entry, bucket: stock, onOpen: () => {}, onRemix: () => {} }));
    expect(html).toContain('Almost there · 2 missing');
    expect(html).toContain('Missing parts');
    expect(html).toContain('including the missing pieces');
    expect(html).not.toContain('Build this');
    expect(html).not.toContain('Remix on the workbench');
  });

  it('counts a shortage only once across shared color roles and never deletes a support', () => {
    const stock = { 'plate-1x2-red': 4 };
    expect(matchRecipe(frame, stock)).toBeNull();
    const near = closestRecipe(frame, stock)!;
    expect(near.missing).toEqual([{ partId: 'plate-1x2-red', count: 1 }]);
    expect(near.match.build.steps).toHaveLength(5);
    expect(near.ownedCount).toBe(4);
    expect(near.features.find(f => f.name === 'Crown')!.missing).toEqual([]);
    expect(near.features.find(f => f.name === 'Supporting frame')!.missing).toEqual(near.missing);
    expect(constructionIssues(near.match.build, near.match.parts, 24)).toEqual([]);
  });

  it('rejects large deficits, empty or invalid inventory, and complete fits', () => {
    expect(closestRecipe(frame, {})).toBeNull();
    expect(closestRecipe(frame, { 'plate-1x2-red': 3 })).toBeNull();
    expect(closestRecipe(frame, { 'plate-1x2-red': NaN, 'brick-1x1-white': -9 })).toBeNull();
    expect(closestRecipe(frame, { 'plate-1x2-red': 5 })).toBeNull();
    expect(closestRecipe(frame, { 'plate-1x2-red': 4 }, 0)).toBeNull();
  });
});

describe('honest related choices', () => {
  const example = recipeExample(robot), match = matchRecipe(robot, buildCounts(example))!;
  const entry = (name: string, strategy: LibraryEntry['strategy'], animalBase?: LibraryEntry['animalBase'], ready = true): LibraryEntry => ({ id: name.toLowerCase(), name, pitch: '', features: [], example, match: ready ? match : null, strategy, animalBase });
  const entries = [entry('Fox', 'animals', 'quadruped', false), entry('Dog', 'animals', 'quadruped'), entry('Cat', 'animals', 'quadruped'), entry('Owl', 'animals', 'bird'), entry('Pickup', 'road-vehicles'), entry('Bus', 'road-vehicles'), entry('Plane', 'aircraft'), entry('Gantry', 'machines')];

  it('offers complete same-body animals without turning them into the requested species', () => {
    expect(relatedBuilds(entries, 'fox').map(e => e.name)).toEqual(['Cat', 'Dog']);
    expect(relatedBuilds(entries, 'wolf').map(e => e.name)).toEqual(['Cat', 'Dog']);
    expect(relatedBuilds(entries, 'four-legged animal').map(e => e.name)).toEqual(['Cat', 'Dog']);
    expect(planForSubject(entries, 'fox').ready).toEqual([]);
    expect(planForSubject(entries, 'fox').alternatives.map(e => e.name)).toEqual(['Cat', 'Dog']);
    expect(entryMatches(entries[1], 'fox')).toBe(false);
  });

  it('generalizes by construction family and keeps unrelated objects out', () => {
    expect(relatedBuilds(entries, 'car').map(e => e.name)).toEqual(['Bus', 'Pickup']);
    expect(relatedBuilds(entries, 'forklift').map(e => e.name)).toEqual(['Gantry']);
    expect(relatedBuilds(entries, 'octopus')).toEqual([]);
    expect(relatedBuilds(entries, '')).toEqual([]);
    expect(familyReadiness(entries).find(f => f.id === 'animals')?.ready).toBe(3);
  });

  it('retrieves valid complete category seeds, never a near fit needing extra parts', () => {
    const have = counts(sampleInventory());
    for (const name of ['building', 'machine', 'plane', 'character']) {
      const available = name === 'plane' ? buildCounts(recipeExample(RECIPES.find(r => r.id === 'survey-plane-expedition')!)) : have;
      const seeds = assemblyCandidates(name, available, 90);
      expect(seeds.length, name).toBeGreaterThan(0);
      for (const seed of seeds) expect(constructionIssues(seed.build, available, 24)).toEqual([]);
    }
    const stock = buildCounts(recipeExample(robot)); delete stock['brick-1x1-black'];
    expect(assemblyCandidates('scout robot', stock, 90).some(m => m.recipeId === robot.id)).toBe(false);
    expect(assemblyCandidates('forklift', have, 90)).toEqual([]);
  });
});

afterEach(() => vi.unstubAllGlobals());
it('passes machine structures and defining-feature allocations through the real planning flow', async () => {
  const inv = sampleInventory(), stock = counts(inv), seed = assemblyCandidates('gantry', stock, 90)[0];
  expect(seed).toBeDefined();
  const reply = (value: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 }));
  const fetch = vi.fn().mockResolvedValueOnce(reply({ assemblyId: seed.recipeId, features: [], colorZones: [] })).mockImplementation(async () => reply({ steps: [] }));
  vi.stubGlobal('fetch', fetch);
  const idea: Idea = { name: 'Workshop Gantry', pitch: 'Static supported frame with an open loading area.', estimatedParts: 25, difficulty: 1, keyParts: [] };
  const build = await designBuild(inv, idea, () => {});
  expect(build).not.toBeNull();
  expect(build!.steps).toEqual(seed.build.steps);
  expect(constructionIssues(build!, stock, 24)).toEqual([]);
  const prompts = fetch.mock.calls.map(c => JSON.parse(c[1].body).contents[0].parts.map((p: { text?: string }) => p.text ?? '').join('\n'));
  expect(prompts[0]).toContain('CONSTRUCTION FAMILY PLAN');
  expect(prompts[0]).toContain('static models honestly');
  expect(prompts[0]).toContain('Feature allocations');
  expect(prompts[1]).toContain('Remaining pieces only');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('partitions the real sample into ready, near and example choices without inventing stock', () => {
  const stock = counts(sampleInventory()), before = structuredClone(stock), entries = libraryFor(stock);
  const plan = planForSubject(entries, '');
  expect(plan.ready.length + plan.almost.length + plan.examples.length).toBe(entries.length);
  expect(plan.almost.length).toBeGreaterThan(0);
  for (const e of plan.almost) {
    expect(e.match).toBeNull();
    expect(e.near!.missingCount).toBeLessThanOrEqual(6);
    expect(e.near!.ownedCount / (e.near!.ownedCount + e.near!.missingCount)).toBeGreaterThanOrEqual(0.8);
    expect(constructionIssues(e.near!.match.build, e.near!.match.parts, 24)).toEqual([]);
  }
  expect(stock).toEqual(before);
}, 15000);
