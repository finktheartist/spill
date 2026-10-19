import { expect, it } from 'vitest';
import { FOX_RECIPES } from './fox-recipes';
import { libraryFor, matchRecipe } from './library';
import { counts, sampleInventory } from './inventory';
import { constructionIssues } from './construction';
import { assemblyCandidates } from './library-context';
import scans from './fixtures/library-stock.json';

it.each([
  ['sample', counts(sampleInventory()), 'fox-anatomical-sloped'],
  ['photo4', scans.photo4, 'fox-anatomical-layered'],
] as const)('offers the anatomical fox first using only the unchanged %s stock', (_name, stock, id) => {
  const before = structuredClone(stock);
  const fox = libraryFor(stock).find(e => e.id === 'fox')!;
  expect(fox.match?.recipeId).toBe(id);
  expect(fox.example.source?.recipeId).toBe('fox-anatomical-curved');
  const build = fox.match!.build;
  expect(constructionIssues(build, stock, 24)).toEqual([]);
  for (let n = 1; n <= build.steps.length; n++) {
    expect(constructionIssues({ ...build, steps: build.steps.slice(0, n) }, stock, 24).filter(i => i.kind !== 'loose')).toEqual([]);
  }
  for (const [part, used] of Object.entries(fox.match!.parts)) expect(used).toBeLessThanOrEqual(stock[part as keyof typeof stock]);
  expect(assemblyCandidates('fox', stock, 90)[0]?.recipeId).toBe(id);
  expect(stock).toEqual(before);
}, 15000);

it('does not label a reference fox as ready without its defining parts', () => {
  expect(FOX_RECIPES.every(r => matchRecipe(r, {}) === null)).toBe(true);
  const noEyes = { ...scans.photo4, 'tile-1x1-black': 0 };
  expect(matchRecipe(FOX_RECIPES.find(r => r.id.endsWith('layered'))!, noEyes)).toBeNull();
});
