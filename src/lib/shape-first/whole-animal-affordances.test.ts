import { afterEach, describe, expect, it, vi } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import medium from '../fixtures/atlas-photo-pile-20261013-stock.json';
import small from '../fixtures/small-pile-stock.json';
import { parsePartId } from '../bricks';
import { compileConnections, connectionPairs, frame, validateConnections } from '../connections';
import * as earSeeds from '../assembly-composer/animal-ear-seed';
import { wholeAnimalEarAffordances } from './whole-animal-affordances';

afterEach(() => vi.restoreAllMocks());
const ears = { 'slope-2x2-black': 2 };
const proof = (stock: Record<string, number>, choice: ReturnType<typeof wholeAnimalEarAffordances>[number]) => {
  expect(choice.operations).toHaveLength(3); expect(choice.parts).toHaveLength(3);
  expect(choice.spec.leftId).toBe(choice.spec.rightId);
  expect(choice.operations.map(op => op.role)).toEqual(['head', 'ear-left', 'ear-right']);
  const program = { name: 'Ear affordance proof', description: 'Three-piece component test only.', rootRotation: choice.rootRotation, operations: choice.operations };
  const build = compileConnections(program, choice.cost), actual = build.steps.flatMap(s => s.parts), ff = actual.map(frame);
  expect(validateConnections(build, stock, 24)).toEqual([]);
  expect(actual.reduce((cost, p) => { cost[p.partId] = (cost[p.partId] ?? 0) + 1; return cost; }, {} as Record<string, number>)).toEqual(choice.cost);
  for (const [i, p] of choice.parts.entries()) {
    const expected = frame({ ...p, z: p.z / .4 }), bounds = choice.roleBounds[p.role as keyof typeof choice.roleBounds];
    expect(ff[i].rotation).toEqual(expected.rotation); ff[i].translation.forEach((n, a) => expect(n).toBeCloseTo(expected.translation[a], 10));
    bounds.min.forEach((n, a) => expect(n).toBeCloseTo(ff[i].bounds.min[a] / 20, 10)); bounds.max.forEach((n, a) => expect(n).toBeCloseTo(ff[i].bounds.max[a] / 20, 10));
    expect(bounds.sizeStuds).toEqual(bounds.max.map((n, a) => n - bounds.min[a]));
    expect(choice.available[p.partId]).toBe(stock[p.partId]); expect(choice.cost[p.partId]).toBeLessThanOrEqual(stock[p.partId]);
    if (i) expect(connectionPairs(ff[0], ff[i]).length).toBeGreaterThan(0);
  }
  expect(choice.sizeStuds).toEqual([0, 1, 2].map(a => (Math.max(...ff.map(f => f.bounds.max[a])) - Math.min(...ff.map(f => f.bounds.min[a]))) / 20));
};

describe('compiled whole-animal ear affordances', () => {
  it('exposes real programs, mating ports, stock cost and frame-derived role bounds on 408 stock', () => {
    const stock: Record<string, number> = { ...large.stock }, before = JSON.stringify(stock), compileSpecs = vi.spyOn(earSeeds, 'animalEarSeeds');
    const choices = wholeAnimalEarAffordances(stock);
    expect(choices.length).toBeGreaterThan(0); expect(choices.length).toBeLessThanOrEqual(12); expect(compileSpecs.mock.calls.length).toBeLessThanOrEqual(64);
    for (const choice of choices) { proof(stock, choice); expect(choice.availability).toContain('Independent three-piece'); expect(choice.availability).toContain(`2 of ${stock[choice.spec.leftId]}`); }
    expect(JSON.stringify(stock)).toBe(before);
  });

  it('proves a three-wide carrier with paired 2x2 ears occupies FIVE studs, while four-wide fits four', () => {
    for (const [carrierId, width] of [['plate-2x3-tan', 5], ['plate-2x4-reddish-brown', 4]] as const) {
      const stock = { ...ears, [carrierId]: 1 }, choices = wholeAnimalEarAffordances(stock), horizontal = choices.find(c => c.rootRotation === 0)!;
      expect(horizontal).toBeDefined(); expect(horizontal.spec.carrierId).toBe(carrierId); expect(horizontal.sizeStuds[0]).toBe(width);
      expect(horizontal.roleBounds.head.sizeStuds[0]).toBe(width === 5 ? 3 : 4);
      proof(stock, horizontal);
      if (width === 5) { expect(horizontal.roleBounds['ear-left'].min[0]).toBeLessThan(horizontal.roleBounds.head.min[0]); expect(horizontal.roleBounds['ear-right'].max[0]).toBeGreaterThan(horizontal.roleBounds.head.max[0]); }
    }
  });

  it('includes true height/pose alternatives and collapses color changes and symmetric carrier yaws', () => {
    const stock = { ...ears, 'plate-2x3-tan': 1, 'plate-2x3-dark-brown': 4, 'brick-2x3-tan': 2 };
    const choices = wholeAnimalEarAffordances(stock), keys = choices.map(c => JSON.stringify(c.parts.map(p => [p.role, parsePartId(p.partId)!.type, p.x, p.y, p.z, p.role === 'head' ? p.rot % 180 : p.rot])));
    expect(new Set(keys).size).toBe(choices.length);
    expect(choices.filter(c => c.spec.carrierId.startsWith('plate-')).every(c => c.spec.carrierId === 'plate-2x3-dark-brown')).toBe(true);
    expect(new Set(choices.map(c => c.roleBounds.head.sizeStuds[2]))).toEqual(new Set([.4, 1.2]));
    expect(choices.some(c => c.rootRotation === 90)).toBe(true); expect(choices.some(c => c.rootRotation === 180)).toBe(false);
  });

  it('fails closed for missing pairs, singleton specialists, absent carriers, unknown IDs and unsupported palettes', () => {
    const unavailable: Record<string, number>[] = [{}, { ...ears }, { 'slope-2x2-black': 1, 'plate-2x3-tan': 2 }, { 'slope-2x2-white': 2, 'plate-2x3-tan': 2 },
      { 'slope-2x2-green': 2, 'plate-2x3-tan': 2 }, { ...ears, 'plate-2x3-blue': 2 }, { ...ears, 'tile-2x3-tan': 2 },
      { 'slope-2x2-invented': 2, 'plate-2x3-tan': 2 }, { ...ears, 'plate-99x99-tan': 1 }, { ...ears, 'curve-1x2-black': 2 }];
    for (const stock of unavailable) expect(wholeAnimalEarAffordances(stock)).toEqual([]);
    const rare = { ...ears, 'plate-2x3-tan': 1 };
    expect(wholeAnimalEarAffordances(rare).length).toBeGreaterThan(0);
    expect(wholeAnimalEarAffordances({ ...rare, 'plate-2x3-tan': 0 })).toEqual([]);
    expect(wholeAnimalEarAffordances({ ...rare, 'slope-2x2-black': 1 })).toEqual([]);
  });

  it('uses actual cheese profiles if an owned identical dark pair and real carrier compile', () => {
    const stock = { 'cheese-1x1-black': 2, 'plate-1x3-tan': 1 }, choices = wholeAnimalEarAffordances(stock);
    expect(choices.length).toBeGreaterThan(0);
    for (const c of choices) { expect(c.spec.leftId).toBe('cheese-1x1-black'); proof(stock, c); }
  });

  it('preserves wholeAnimalStock malformed-ledger errors, even when no usable ear pair exists', () => {
    for (const stock of [null, [], { 'plate-2x3-tan': -1 }, { 'plate-2x3-tan': NaN }, { unknown: .5 }, { unknown: Infinity }, { ['x'.repeat(81)]: 1 },
      Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`unknown-${i}`, 0]))]) expect(() => wholeAnimalEarAffordances(stock as Record<string, number>)).toThrow();
  });

  it('returns deterministic fresh records without reserving stock or sharing mutable results', () => {
    const stock = { ...ears, 'plate-2x3-tan': 1 }, before = JSON.stringify(stock), first = wholeAnimalEarAffordances(stock), original = structuredClone(first);
    first[0].parts[0].x = 999; first[0].cost[first[0].spec.leftId] = 99; first[0].roleBounds.head.min[0] = -99; first[0].spec.carrierId = 'invented'; first[0].available['slope-2x2-black'] = 0;
    const reversed = Object.fromEntries(Object.entries(stock).reverse());
    expect(wholeAnimalEarAffordances(reversed)).toEqual(original); expect(JSON.stringify(stock)).toBe(before);
    expect(wholeAnimalEarAffordances(small.stock)).toEqual([]); expect(wholeAnimalEarAffordances(medium)).toEqual([]);
  });
});
