import { describe, expect, it } from 'vitest';
import { cleanComposition, compositionText, designLanguageText, patternsFor } from './design-language';
import { allocateFeatures, qualityPlanText, type QualityPlan } from './build-quality';
import { assemblyCandidates } from './library-context';
import { buildCounts, matchRecipe, recipeExample } from './library';
import { parsePartId } from './bricks';
import { DEVELOPED_RECIPES } from './developed-recipes';
import { RECIPES } from './library-recipes';
import { strategyForRecipe } from './construction-families';
import { constructionIssues } from './construction';
import pile from './fixtures/large-pile-stock.json';

const composition = {
  dominantForm: 'A broad floor under four slender piers',
  depthLayers: ['Entrance one stud ahead of the piers', 'Roof one stud beyond the wall', 'Lantern inset by one stud'],
  focalPoint: 'Open entrance with a visible floor behind it',
  techniques: ['recessed-bay', 'projecting-ledges', 'stepped-massing'],
};
describe('a reusable spatial construction language', () => {
  it('selects relevant rules for different subjects while keeping general contour rules', () => {
    for (const [subject, technique] of [['pavilion', 'recessed-bay'], ['workboat', 'layered-hull'], ['bonsai', 'offset-branching'], ['robot', 'framed-face'], ['lander', 'paired-pods']]) {
      expect(patternsFor(subject).map(p => p.id)).toContain(technique);
      expect(patternsFor(subject).map(p => p.id)).toContain('stepped-massing');
    }
    expect(patternsFor('boat').map(p => p.id)).not.toContain('framed-face');
    expect(designLanguageText('pavilion')).toContain('every placement must still use the listed stock');
    expect(designLanguageText('unlisted sculpture')).toContain('contour-shaping');
  });
  it('preserves the composition through allocation without reserving imaginary stock', () => {
    const stock = { 'plate-2x4-white': 1, 'brick-1x2-red': 20 };
    const allocation = allocateFeatures({ features: [], colorZones: [], composition }, stock, 40);
    expect(allocation.plan.composition).toEqual(composition);
    expect(allocation.core).toEqual(stock);
    expect(allocation.reserved).toEqual({});
    expect(qualityPlanText(allocation.plan)).toContain('Entrance one stud ahead');
    expect(qualityPlanText(allocation.plan)).toContain('Bridge the jambs with a lintel touching both');
  });
  it('bounds malformed plans and drops unknown or duplicate techniques', () => {
    expect(cleanComposition(null)).toBeUndefined();
    expect(cleanComposition({ dominantForm: [], techniques: 'recessed-bay' })).toBeUndefined();
    const value = cleanComposition({ dominantForm: 'x'.repeat(1000), focalPoint: {}, depthLayers: ['y'.repeat(800), null, ...Array(20).fill('layer')], techniques: ['flying-hinge', 'recessed-bay', 'recessed-bay', 'framed-face', 'paired-pods', 'offset-branching'] })!;
    expect(value.dominantForm).toHaveLength(240);
    expect(value.depthLayers.length).toBeLessThanOrEqual(4);
    expect(value.depthLayers[0]).toHaveLength(180);
    expect(value.techniques).toEqual(['recessed-bay', 'framed-face', 'paired-pods']);
    expect(compositionText(value)).not.toContain('flying-hinge');
    expect(allocateFeatures({ composition: false } as unknown as QualityPlan, {}, 40).plan.composition).toBeUndefined();
  });
});

describe('diverse checked starting shapes', () => {
  it('fills broad building requests with distinct fitting families before variants', () => {
    const seeds = assemblyCandidates('building', pile.stock, 100);
    const families = seeds.map(s => RECIPES.find(r => r.id === s.recipeId)!.family);
    expect(new Set(families.slice(0, 3)).size).toBe(3);
    expect(families).toEqual(expect.arrayContaining(['townhouse', 'lighthouse', 'atrium-pavilion']));
    expect(seeds.length).toBeLessThanOrEqual(4);
    for (const seed of seeds) expect(constructionIssues(seed.build, pile.stock, 24)).toEqual([]);
  });
  it('keeps broad machine requests in their family and named spacecraft requests relevant', () => {
    const machines = assemblyCandidates('machine', pile.stock, 100);
    expect(machines.length).toBeGreaterThan(0);
    expect(machines.every(s => strategyForRecipe(RECIPES.find(r => r.id === s.recipeId)!).id === 'machines')).toBe(true);
    const spacecraft = assemblyCandidates('spacecraft', pile.stock, 100);
    expect(spacecraft.some(s => s.recipeId.startsWith('survey-lander'))).toBe(true);
    expect(spacecraft.some(s => s.recipeId.includes('plane'))).toBe(false);
  });
});


it('preserves foliage colors in mixed-stock trees and rejects a neutral-only canopy', () => {
  const tree = DEVELOPED_RECIPES.find(r => r.id === 'terraced-bonsai-tall')!;
  const neutral = Object.fromEntries(Object.entries(buildCounts(recipeExample(tree))).map(([id, count]) => [id.replace(/-green$/, '-white'), count]));
  expect(matchRecipe(tree, neutral)).toBeNull();
  const fitted = matchRecipe(tree, pile.stock)!;
  expect(fitted).not.toBeNull();
  const leafSteps = tree.steps.flatMap((step, i) => step.parts.some(p => p.role === 'foliage') ? [i] : []);
  const leafColors = leafSteps.flatMap(i => fitted.build.steps[i].parts.map(p => parsePartId(p.partId)!.color));
  expect(leafColors).toEqual(expect.arrayContaining(['bright-green', 'green', 'dark-green']));
  expect(leafColors.some(c => ['white', 'tan', 'reddish-brown', 'light-gray', 'black'].includes(c))).toBe(false);
  expect(constructionIssues(fitted.build, pile.stock, 24)).toEqual([]);
});
