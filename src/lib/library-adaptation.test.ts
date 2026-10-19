import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryCard } from '../components/BuildLibrary';
import { parsePartId, voxels, type Build } from './bricks';
import { constructionIssues } from './construction';
import { isMade, shoppingList } from './catalog';
import { libraryFor, matchContext, matchFamily, matchRecipe, recipeExample, type LibraryEntry } from './library';
import { RECIPES, type Recipe } from './library-recipes';
import { assemblyCandidates, assemblyText } from './library-context';
import pile from './fixtures/large-pile-stock.json';

const volume = (build: Build) => build.steps.flatMap(s => s.parts.flatMap(p => voxels(parsePartId(p.partId)!, p).map(v => v.join(',')))).sort();
const bridge: Recipe = {
  id: 'adaptive-bridge', family: 'adaptive-test', name: 'Bridge', pitch: '', features: [],
  palette: { body: 'red', trim: 'white', dark: 'black' }, contrast: [['body', 'dark']],
  steps: [
    { caption: 'Feet', parts: [0, 1].map(x => ({ shape: 'brick-1x1', role: 'body', x, y: 0, z: 0, rot: 0 })) },
    { caption: 'Bridge', parts: [{ shape: 'plate-1x2', role: 'trim', x: 0, y: 0, z: 3, rot: 0 }] },
    { caption: 'Detail', parts: [{ shape: 'tile-1x1', role: 'dark', x: 0, y: 0, z: 4, rot: 0 }] },
  ],
};
const multicolor = { 'brick-1x1-red': 1, 'brick-1x1-blue': 1, 'plate-1x2-white': 1, 'tile-1x1-black': 1 };

describe('inventory adaptations', () => {
  it('uses several body colors when a coherent version cannot be built', () => {
    expect(matchRecipe(bridge, multicolor, matchContext(multicolor), 'coherent')).toBeNull();
    const match = matchRecipe(bridge, multicolor)!;
    expect(match.colorMode).toBe('mixed');
    expect(match.parts).toEqual(multicolor);
    expect(volume(match.build)).toEqual(volume(recipeExample(bridge)));
    expect(constructionIssues(match.build, multicolor, 24)).toEqual([]);
  });

  it('checks every actual body color against contrasting details', () => {
    expect(matchRecipe(bridge, { ...multicolor, 'brick-1x1-blue': 0, 'brick-1x1-black': 1 })).toBeNull();
  });

  it('prefers authored structural complexity before an easier coherent variant', () => {
    const second: Recipe = { ...bridge, id: 'coherent-bridge', steps: [
      { ...bridge.steps[0], parts: [{ shape: 'brick-1x2', role: 'body', x: 0, y: 0, z: 0, rot: 0 }] },
      ...bridge.steps.slice(1),
    ] };
    const stock = { ...multicolor, 'brick-1x2-yellow': 1 };
    const family = matchFamily([bridge, second], stock);
    expect(family.match?.recipeId).toBe(bridge.id);
    expect(family.match?.colorMode).toBe('mixed');
  });

  it('can fill one rectangular slot with smaller pieces of different colors', () => {
    const plate: Recipe = { ...bridge, contrast: [], steps: [{ caption: 'Base', parts: [{ shape: 'plate-1x2', role: 'body', x: 0, y: 0, z: 0, rot: 0 }] },
      { caption: 'Bind', parts: [{ shape: 'plate-1x2', role: 'trim', x: 0, y: 0, z: 1, rot: 0 }] }] };
    const stock = { 'plate-1x1-red': 1, 'plate-1x1-blue': 1, 'plate-1x2-white': 1 };
    const match = matchRecipe(plate, stock)!;
    expect(match.parts).toEqual(stock);
    expect(constructionIssues(match.build, stock, 24)).toEqual([]);
  });

  it('replaces a brick with exactly three supported plate layers, never tiles or two layers', () => {
    const brick: Recipe = { ...bridge, contrast: [], steps: [{ caption: 'Block', parts: [{ shape: 'brick-1x2', role: 'body', x: 0, y: 0, z: 0, rot: 0 }] }] };
    const stock = { 'plate-1x2-red': 2, 'plate-1x2-blue': 1 };
    const match = matchRecipe(brick, stock)!;
    expect(match.layeredSubstitutions).toBe(1);
    expect(match.parts).toEqual(stock);
    expect(volume(match.build)).toEqual(volume(recipeExample(brick)));
    expect(constructionIssues(match.build, stock, 24)).toEqual([]);
    expect(matchRecipe(brick, { 'plate-1x2-red': 2 })).toBeNull();
    expect(matchRecipe(brick, { 'tile-1x2-red': 3 })).toBeNull();
    expect(matchRecipe(brick, { 'plate-1x4-red': 3 })).toBeNull();
  });

  it('never uses an unsupported replacement or spends shared stock twice', () => {
    const stock = { 'plate-1x1-red': 3, 'plate-1x1-blue': 2, 'plate-1x2-white': 1, 'tile-1x1-black': 1 };
    expect(matchRecipe(bridge, stock)).toBeNull(); // one plate short of six for both feet
    const unsupported = structuredClone(bridge);
    unsupported.steps[0].parts = [{ shape: 'brick-1x1', role: 'body', x: 0, y: 0, z: 0, rot: 0 }];
    expect(matchRecipe(unsupported, { 'brick-1x1-red': 1, 'plate-1x1-white': 1, 'plate-1x1-blue': 1, 'tile-1x1-black': 1 })).toBeNull();
  });
});

describe('the three-angle large-pile regression', () => {
  let entries: LibraryEntry[];
  const before = structuredClone(pile.stock);
  beforeAll(() => { entries = libraryFor(pile.stock); }, 30000);

  it('unlocks complete animals and aircraft without changing the recognized inventory', () => {
    const ready = entries.filter(e => e.match);
    expect(ready.length).toBeGreaterThanOrEqual(19);
    expect(ready.flatMap(e => e.matches ?? []).length).toBeGreaterThanOrEqual(26);
    expect(ready.map(e => e.name)).toEqual(expect.arrayContaining(['Tall Giraffe', 'Woodland Fox', 'Savanna Rhino', 'Forest Deer', 'Corner Studio', 'Expedition Plane', 'Harbor Workboat', 'Cargo Crawler', 'Workshop Robot', 'Harbor Beacon', 'Atrium Pavilion', 'Survey Lander', 'Terraced Bonsai']));
    expect(pile.stock).toEqual(before);
  });

  it('checks exact geometry, assembly steps, catalog parts, and stock for every fitting version', () => {
    for (const match of entries.flatMap(e => e.matches ?? [])) {
      expect(constructionIssues(match.build, pile.stock, 24), match.recipeId).toEqual([]);
      expect(Object.keys(match.parts).every(isMade), match.recipeId).toBe(true);
      expect(shoppingList(match.build, pile.stock).getCount, match.recipeId).toBe(0);
      const recipe = RECIPES.find(r => r.id === match.recipeId)!;
      expect(volume(match.build), match.recipeId).toEqual(volume(recipeExample(recipe)));
      for (let n = 1; n <= match.build.steps.length; n++) {
        const stage = { ...match.build, steps: match.build.steps.slice(0, n) };
        expect(constructionIssues(stage, pile.stock, 24).filter(i => i.kind !== 'loose'), match.recipeId).toEqual([]);
      }
    }
  });

  it('labels the actual mixed-color version and offers it to the AI assembly planner', () => {
    const entry = entries.find(e => e.name === 'Woodland Fox')!;
    const html = renderToStaticMarkup(createElement(LibraryCard, { entry, bucket: pile.stock, onOpen: () => {}, onRemix: () => {} }));
    expect(html).toContain('Mixed-color version');
    expect(html).toContain('Build this');
    const candidates = assemblyCandidates('fox', pile.stock, 100);
    expect(candidates.some(c => c.colorMode === 'mixed')).toBe(true);
    expect(assemblyText(candidates)).toContain('actual pieces');
  }, 15000);
});
