import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePartId, voxels, type Build } from './bricks';
import { isMade } from './catalog';
import { constructionIssues } from './construction';
import { counts, sampleInventory } from './inventory';
import { buildCounts, libraryFor, matchFamily, matchRecipe, recipeExample } from './library';
import { RECIPES, type Recipe } from './library-recipes';
import { BuildLibrary } from '../components/BuildLibrary';
import scans from './fixtures/library-stock.json';
import pile from './fixtures/large-pile-stock.json';
import { partCount } from './bricks';
import { MIN_FINISHED_PARTS } from './finished-build';

const volume = (b: Build) => [...new Set(b.steps.flatMap(s => s.parts.flatMap(p => voxels(parsePartId(p.partId)!, p).map(v => v.join(',')))))].sort();

describe('the authored build library', () => {
  it.each(RECIPES.map(r => [r.id, r] as const))('%s has a valid model and supported assembly order', (_id, recipe) => {
    const build = recipeExample(recipe), stock = buildCounts(build);
    expect(constructionIssues(build, stock, 24)).toEqual([]);
    expect(Object.keys(stock).every(isMade)).toBe(true);
    // Feet/base plates may be laid out separately until the connecting step; nothing floats during assembly.
    for (let n = 1; n <= build.steps.length; n++) {
      expect(constructionIssues({ ...build, steps: build.steps.slice(0, n) }, stock, 24).filter(i => i.kind !== 'loose')).toEqual([]);
    }
    const match = matchRecipe(recipe, stock);
    expect(match).not.toBeNull();
    expect(match!.build.source).toEqual({ kind: 'library', recipeId: recipe.id });
    expect(volume(match!.build)).toEqual(volume(build));
  });

  it('fits diverse independent designs and structural variants to the unchanged sample bucket', () => {
    const stock = counts(sampleInventory()), before = structuredClone(stock);
    const entries = libraryFor(stock), matches = entries.flatMap(e => e.match ? [e.match] : []);
    expect(matches.length).toBeGreaterThanOrEqual(5);
    expect(entries.every(e => partCount(e.example) >= MIN_FINISHED_PARTS)).toBe(true);
    expect(matches.every(m => partCount(m.build) >= MIN_FINISHED_PARTS)).toBe(true);
    expect(entries.flatMap(e => e.matches ?? []).length).toBeGreaterThan(matches.length);
    for (const m of entries.flatMap(e => e.matches ?? [])) {
      expect(constructionIssues(m.build, stock, 24)).toEqual([]);
      expect(m.build.steps.map(s => s.caption)).toEqual(RECIPES.find(r => r.id === m.recipeId)!.steps.map(s => s.caption));
      expect(volume(m.build)).toEqual(volume(recipeExample(RECIPES.find(r => r.id === m.recipeId)!)));
    }
    expect(stock).toEqual(before);
    expect(libraryFor(stock)).toEqual(entries);
  }, 30000);

  it.each([['photo3', 'bench-12'], ['photo4', 'bench-10']] as const)('adapts the bench size to %s', (name, recipeId) => {
    const bench = matchFamily(RECIPES.filter(r => r.family === 'bench'), scans[name]);
    expect(bench.matches?.map(m => m.recipeId)).toContain(recipeId);
    for (const m of bench.matches ?? []) expect(constructionIssues(m.build, scans[name], 24)).toEqual([]);
    expect(libraryFor(scans[name]).some(e => e.id === 'bench')).toBe(false); // internal modules remain useful, but under 20 pieces
  }, 20000);

  it('does not offer the lighthouse when the lantern pieces are missing', () => {
    const stock = counts(sampleInventory());
    for (const id of Object.keys(stock)) if (id.includes('trans-')) delete stock[id];
    expect(matchFamily(RECIPES.filter(r => r.family === 'lighthouse'), stock).match).toBeNull();
  });

  it('does not invent stock from loose wheels, invalid counts or unknown sizes', () => {
    const bad = { 'wheel-1x1-black': 50, 'plate-2x4-red': NaN, 'brick-2x2-white': -10, 'brick-1x2-black': 0.5, 'plate-7x7-white': 99 };
    expect(libraryFor(bad).every(e => e.match === null)).toBe(true);
    expect(libraryFor({}).every(e => e.match === null)).toBe(true);
  });

  it('recolors the whole bench coherently when its reference color is absent', () => {
    const recipe = RECIPES.find(r => r.id === 'bench-10')!;
    const stock = Object.fromEntries(Object.entries(buildCounts(recipeExample(recipe))).map(([id, n]) => [id.replace('reddish-brown', 'blue'), n]));
    const match = matchRecipe(recipe, stock)!;
    expect(match.palette.body).toBe('blue');
    expect(Object.keys(match.parts).every(id => id.endsWith('-blue'))).toBe(true);
  });

  it('preserves facial contrast instead of making all-black robot features', () => {
    const recipe = RECIPES.find(r => r.id === 'robot')!;
    const stock: Record<string, number> = {};
    for (const [id, n] of Object.entries(buildCounts(recipeExample(recipe)))) {
      const k = parsePartId(id)!; const black = `${k.type}-${k.w}x${k.d}-black`;
      stock[black] = (stock[black] ?? 0) + n;
    }
    expect(matchRecipe(recipe, stock)).toBeNull();
  });
});

describe('safe substitutions', () => {
  const recipe: Recipe = {
    id: 'bridge-test', family: 'test', name: 'Bridge', pitch: '', features: [], palette: { body: 'red', trim: 'white' }, contrast: [],
    steps: [
      { caption: 'Foot', parts: [{ shape: 'brick-1x2', role: 'body', x: 1, y: 0, z: 0, rot: 0 }] },
      { caption: 'Bridge', parts: [{ shape: 'plate-1x4', role: 'trim', x: 0, y: 0, z: 3, rot: 0 }] },
    ],
  };
  it('accepts two replacements only when both actually attach', () => {
    const match = matchRecipe(recipe, { 'brick-1x2-red': 1, 'plate-1x2-white': 2 });
    expect(match?.substitutions).toBe(1);
    expect(match?.parts).toEqual({ 'brick-1x2-red': 1, 'plate-1x2-white': 2 });
  });
  it('rejects the same counts when the support leaves a replacement floating', () => {
    const offCenter = structuredClone(recipe); offCenter.steps[0].parts[0].x = 0;
    expect(matchRecipe(offCenter, { 'brick-1x2-red': 1, 'plate-1x2-white': 2 })).toBeNull();
  });
  it('never turns a larger piece into a smaller one or substitutes a tile for a connecting plate', () => {
    expect(matchRecipe(recipe, { 'brick-1x2-red': 1, 'plate-1x6-white': 1 })).toBeNull();
    expect(matchRecipe(recipe, { 'brick-1x2-red': 1, 'tile-1x4-white': 1 })).toBeNull();
  });
  it('does not double-spend a part shared by two color roles', () => {
    const same = structuredClone(recipe);
    same.steps = [{ caption: 'Stack', parts: [
      { shape: 'plate-1x2', role: 'body', x: 0, y: 0, z: 0, rot: 0 },
      { shape: 'plate-1x2', role: 'trim', x: 0, y: 0, z: 1, rot: 0 },
    ] }];
    expect(matchRecipe(same, { 'plate-1x2-red': 1 })).toBeNull();
    expect(matchRecipe(same, { 'plate-1x2-red': 2 })).not.toBeNull();
  });
});

it('offers Build this only for ready library entries and labels the empty state honestly', () => {
  const stock = pile.stock;
  const html = renderToStaticMarkup(createElement(BuildLibrary, { entries: libraryFor(stock), bucket: stock, onOpen: () => {}, onRemix: () => {} }));
  expect(html.match(/>Build this /g)).toHaveLength(6); // paginate before creating WebGL contexts
  expect(html).toContain('Library pages');
  expect(html).toContain('at least 20 pieces');
  expect(html).not.toContain('AI review passed');
  const empty = renderToStaticMarkup(createElement(BuildLibrary, { entries: libraryFor({}), bucket: {}, onOpen: () => {}, onRemix: () => {} }));
  expect(empty).toContain('No library design matches this bucket yet.');
  expect(empty).not.toContain('>Build this ');
}, 30000);
