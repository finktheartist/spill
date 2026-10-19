import { describe, expect, it } from 'vitest';
import { ANIMAL_MODULES, animalModuleCandidates, animalModulePlan, animalModuleReceipts, type AnimalHead, type AnimalStance, type AnimalTail } from './animal-modules';
import { compileComponents } from './component-kit';
import { buildCounts, recipeExample } from './library';
import { constructionIssues } from './construction';
import { parsePartId, partCount, voxels } from './bricks';
import data from '../../test/fixtures/photo-stock.json';
import reviews from '../../test/fixtures/reviews.json';

const selections: [AnimalHead, AnimalStance, AnimalTail][] = [];
for (const head of ['hound', 'terrier', 'broad'] as const)
  for (const stance of ['low', 'tall'] as const)
    for (const tail of ['swept', 'upright'] as const) selections.push([head, stance, tail]);
const stock: Record<string, number> = data.stock;
const original = structuredClone(stock);
const matches = animalModuleCandidates(stock);
const poses = (parts: ReturnType<typeof recipeExample>['steps'][number]['parts']) => parts.map(p => JSON.stringify([p.partId,p.x,p.y,p.z,p.rot])).sort();
const volume = (build: ReturnType<typeof recipeExample>) => build.steps.flatMap(s => s.parts).flatMap(p => voxels(parsePartId(p.partId)!, p).map(v => v.join(','))).sort();

describe('inventory-aware animal module kit', () => {
  it('offers eight modules and all twelve combinations without changing the saved stock', () => {
    expect(new Set(ANIMAL_MODULES.map(m => m.id)).size).toBe(8);
    expect(new Set(matches.map(m => m.recipeId)).size).toBe(12);
    expect(stock).toEqual(original);
  });

  it.each(selections)('%s / %s / %s fits with real interfaces, legal steps and no extra stock', (head, stance, tail) => {
    const { recipe, summary } = compileComponents(animalModulePlan(head, stance, tail));
    const match = matches.find(m => m.recipeId === recipe.id)!;
    expect(match).toBeDefined();
    expect(summary.interfaces).toHaveLength(3);
    expect(summary.interfaces.every(i => i.contacts >= 2)).toBe(true);
    expect(constructionIssues(match.build, stock, 24)).toEqual([]);
    expect(partCount(match.build)).toBeGreaterThanOrEqual(20);
    expect(volume(match.build)).toEqual(volume(recipeExample(recipe)));
    for (const [id, quantity] of Object.entries(match.parts)) expect(quantity).toBeLessThanOrEqual(stock[id] ?? 0);
    for (let n = 1; n <= match.build.steps.length; n++) {
      const issues = constructionIssues({ ...match.build, steps: match.build.steps.slice(0, n) }, stock, 24);
      // The four feet become connected by the later underframe steps.
      expect(issues.filter(i => i.kind !== 'loose')).toEqual([]);
    }
  });

  it.each(selections)('%s / %s / %s receipts partition the exact placed pieces and stand alone', (head, stance, tail) => {
    const match = matches.find(m => m.recipeId === `components:animal-kit-${head}-${stance}-${tail}`)!;
    const receipts = animalModuleReceipts(match);
    expect(receipts).toHaveLength(4);
    const totals: Record<string, number> = {};
    const restored = receipts.flatMap(r => r.build.steps.flatMap(s => s.parts).map(p => ({ ...p, x:p.x+r.placement[0], y:p.y+r.placement[1], z:p.z+r.placement[2] })));
    expect(poses(restored)).toEqual(poses(match.build.steps.flatMap(s => s.parts)));
    for (const receipt of receipts) {
      expect(receipt.parts).toEqual(buildCounts(receipt.build));
      expect(constructionIssues(receipt.build, receipt.parts, 24)).toEqual([]);
      for (const [id, quantity] of Object.entries(receipt.parts)) totals[id] = (totals[id] ?? 0) + quantity;
    }
    expect(totals).toEqual(match.parts);
  });

  it('rejects insufficient eye pieces and budgets instead of inventing stock', () => {
    expect(animalModuleCandidates({ ...stock, 'tile-1x1-black':1 })).toEqual([]);
    expect(animalModuleCandidates({}, 120)).toEqual([]);
    expect(animalModuleCandidates(stock, 19)).toEqual([]);
  });

  it('rejects a false head mount even if its contract label still matches', () => {
    const plan = animalModulePlan('hound', 'low', 'swept');
    plan.mounts[1].component.ports!.head.x += 12;
    expect(() => compileComponents(plan)).toThrow();
  });

  it('binds every displayed appearance review to the exact build reviewed', () => {
    expect(reviews).toHaveLength(3);
    for (const review of reviews) {
      const match = matches.find(m => m.recipeId === `components:${review.id}`)!;
      expect(review.buildSignature).toBe(JSON.stringify(match.build));
      expect(review.passes).toBe(false);
    }
  });
});
