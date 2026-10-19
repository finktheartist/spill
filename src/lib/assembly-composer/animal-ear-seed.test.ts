import { describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import type { Placed } from '../bricks';
import { compileConnections, connectionPairs, frame, requiredContactIssues, validateConnections, type ConnectionProgram } from '../connections';
import { composeModules } from './compose';
import type { AssemblyPlan } from './types';
import { composeWholeAnimal, wholeAnimalIssues } from './animal-whole';
import { authoredWholeAnimalTestLayouts } from '../../../test/whole-animal-fixtures';
import { animalEarSeeds, type AnimalEarSeed, type AnimalEarSeedSpec } from './animal-ear-seed';

const spec: AnimalEarSeedSpec = { leftId: 'slope-2x2-black', rightId: 'slope-2x2-black', carrierId: 'plate-2x4-reddish-brown' };
const program = (s: AnimalEarSeed): ConnectionProgram => ({ name: 'Ear seed test', description: 'Three-piece physical fixture; no whole-animal or visual qualification.', rootRotation: s.rootRotation, operations: s.operations });
const poses = (s: AnimalEarSeed): Placed[] => s.parts.map(p => ({ ...p, z: p.z / .4 }));
const count = (parts: Placed[]) => {
  const used: Record<string, number> = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
};
/** Independent exact convex-plane intersections, rather than copying the
 * factory's sampling check. All vertex pairs include every true hull edge;
 * extra diagonal intersections stay inside the convex cross-section. */
function upperGap(parts: Placed[]) {
  const ears = parts.slice(1).map(frame), z = ears[0].bounds.min[2] + .85 * (ears[0].bounds.max[2] - ears[0].bounds.min[2]);
  const spans = ears.map(f => {
    const xs: number[] = [];
    for (const solid of f.solids) for (const [i, a] of solid.points.entries()) {
      if (Math.abs(a[2] - z) < 1e-8) xs.push(a[0]);
      for (const b of solid.points.slice(i + 1)) if ((a[2] - z) * (b[2] - z) < 0) xs.push(a[0] + (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]));
    }
    return { min: Math.min(...xs), max: Math.max(...xs) };
  });
  return (spans[1].min - spans[0].max) / 20;
}

describe('three-piece stock-bound ear vocabulary', () => {
  it('compiles four exact carrier quarter-turn variants on actual 408 stock, with two mirrored ears only', () => {
    const seeds = animalEarSeeds(large.stock, spec);
    expect(seeds.map(s => s.rootRotation)).toEqual([0, 90, 180, 270]);
    expect(new Set(seeds.map(s => s.id)).size).toBe(4);
    for (const seed of seeds) {
      expect(seed.operations).toHaveLength(3);
      expect(seed.parts).toHaveLength(3);
      expect(seed.operations.map(op => op.role)).toEqual(['head', 'ear-left', 'ear-right']);
      expect(seed.operations.map(op => op.parent)).toEqual([-1, 0, 0]);
      expect(seed.parts.map(p => p.rot)).toEqual([seed.rootRotation, 90, 270]);
      expect(seed.cost).toEqual({ 'plate-2x4-reddish-brown': 1, 'slope-2x2-black': 2 });
      const compiled = compileConnections(program(seed), seed.cost), actual = compiled.steps.flatMap(s => s.parts), expected = poses(seed);
      expect(validateConnections(compiled, seed.cost, 24)).toEqual([]);
      expect(count(actual)).toEqual(seed.cost);
      const ff = actual.map(frame);
      actual.forEach((p, i) => {
        expect(p.partId).toBe(seed.parts[i].partId);
        expect(ff[i].rotation).toEqual(frame(expected[i]).rotation);
        ff[i].translation.forEach((n, a) => expect(n).toBeCloseTo(frame(expected[i]).translation[a], 10));
      });
      for (const a of [0, 1, 2]) {
        expect(Math.min(...ff.map(f => f.bounds.min[a]))).toBe(0);
        expect((Math.max(...ff.map(f => f.bounds.max[a])) - Math.min(...ff.map(f => f.bounds.min[a]))) / 20).toBeCloseTo(seed.sizeStuds[a], 10);
      }
      expect(seed.sizeStuds[2]).toBe(1.6);
      expect(upperGap(actual)).toBeGreaterThanOrEqual(.25);
      for (const [i, op] of seed.operations.entries()) if (i) expect(connectionPairs(ff[0], ff[i])).toContainEqual([op.parentPort, op.childPort]);
    }
  });

  it('uses one genuine carrier row where available, without inventing supports or strength claims', () => {
    const oneRow = animalEarSeeds(large.stock, { ...spec, carrierId: 'plate-1x4-reddish-brown' });
    expect(oneRow.map(s => s.rootRotation)).toEqual([0, 180]);
    for (const seed of oneRow) {
      const pp = poses(seed), ff = pp.map(frame);
      expect(seed.sizeStuds).toEqual([4, 2, 1.6]);
      expect((ff[0].bounds.max[1] - ff[0].bounds.min[1]) / 20).toBe(1);
      expect(connectionPairs(ff[0], ff[1])).toHaveLength(2);
      expect(connectionPairs(ff[0], ff[2])).toHaveLength(2);
      expect(validateConnections(compileConnections(program(seed), seed.cost), seed.cost)).toEqual([]);
      expect(upperGap(pp)).toBeGreaterThan(.25);
    }
    const none = { ...spec, carrierId: 'plate-1x1-white' };
    expect(animalEarSeeds({ 'plate-1x1-white': 1, 'slope-2x2-black': 2 }, none)).toEqual([]);
  });

  it('keeps exact colors/IDs on white/orange, mixed-color and cheese specs with honest costs and height units', () => {
    const white: AnimalEarSeedSpec = { leftId: 'slope-2x2-white', rightId: 'slope-2x2-white', carrierId: 'brick-2x4-orange' };
    const whiteSeeds = animalEarSeeds(large.stock, white);
    expect(whiteSeeds).toHaveLength(4);
    expect(whiteSeeds[0].cost).toEqual({ 'brick-2x4-orange': 1, 'slope-2x2-white': 2 });
    expect(whiteSeeds[0].sizeStuds).toEqual([4, 2, 2.4]);
    expect(whiteSeeds[0].parts[1].z).toBe(1.2);
    const mixed = animalEarSeeds({ 'plate-2x4-reddish-brown': 1, 'slope-2x2-black': 1, 'slope-2x2-white': 1 }, { ...spec, rightId: 'slope-2x2-white' });
    expect(mixed).toHaveLength(4);
    expect(mixed[0].cost).toEqual({ 'plate-2x4-reddish-brown': 1, 'slope-2x2-black': 1, 'slope-2x2-white': 1 });
    const cheeseSpec = { leftId: 'cheese-1x1-tan', rightId: 'cheese-1x1-tan', carrierId: 'plate-1x4-tan' };
    const cheese = animalEarSeeds({ 'cheese-1x1-tan': 2, 'plate-1x4-tan': 1 }, cheeseSpec);
    expect(cheese).toHaveLength(2);
    for (const seed of [...whiteSeeds, ...mixed, ...cheese]) {
      expect(validateConnections(compileConnections(program(seed), seed.cost), seed.cost)).toEqual([]);
      expect(upperGap(poses(seed))).toBeGreaterThan(.25);
    }
  });

  it('composes three independently compiled anatomical modules through the frozen shared kernel', () => {
    for (const seed of animalEarSeeds(large.stock, spec)) {
      const nodes: AssemblyPlan['nodes'] = seed.operations.map((op, i) => ({ id: op.role,
        option: { id: `ear-seed-test-${i}`, role: op.role, program: { name: op.role, description: 'Single seed part', rootRotation: seed.parts[i].rot,
          operations: [{ partId: op.partId, parent: -1, parentPort: '', childPort: '', twist: 0 }] } },
        ...(i ? { attachment: { parent: 'head', parentPart: 0, parentPort: op.parentPort, childPort: op.childPort, twist: op.twist } } : {}) }));
      const c = composeModules({ id: seed.id, name: 'Fox', description: 'Tiny component regression only, not a complete animal.', nodes }, large.stock, { minParts: 3, maxParts: 3 });
      expect(c.receipts).toHaveLength(3);
      expect(c.build.steps.flatMap(s => s.parts)).toHaveLength(3);
      expect(validateConnections(c.build, large.stock, 24)).toEqual([]);
      expect(requiredContactIssues(c.build.steps.flatMap(s => s.parts), c.build.requiredContacts)).toEqual([]);
      for (const [i, p] of poses(seed).entries()) {
        const index = c.receipts.find(r => r.role === seed.parts[i].role)!.indices[0];
        expect(frame(c.build.steps.flatMap(s => s.parts)[index]).rotation).toEqual(frame(p).rotation);
        frame(p).translation.forEach((n, a) => expect(frame(c.build.steps.flatMap(s => s.parts)[index]).translation[a]).toBeCloseTo(n, 10));
      }
    }
  });

  it('substitutes only the three-part motif into a TEST-ONLY legal whole fixture; the whole gate still proves anatomy', () => {
    for (const seed of animalEarSeeds(large.stock, { ...spec, carrierId: 'plate-1x4-reddish-brown' })) {
      const layout = authoredWholeAnimalTestLayouts()[0];
      const carrier = layout.parts.find(p => p.role === 'head' && p.partId === seed.parts[0].partId)!;
      const shift = [carrier.x - seed.parts[0].x, carrier.y - seed.parts[0].y, carrier.z - seed.parts[0].z];
      layout.parts = layout.parts.filter(p => p !== carrier && !p.role.startsWith('ear-'));
      layout.parts.push(...seed.parts.map(p => ({ ...p, x: p.x + shift[0], y: p.y + shift[1], z: p.z + shift[2] })));
      const c = composeWholeAnimal(large.stock, layout);
      expect(c.build.steps.flatMap(s => s.parts)).toHaveLength(40);
      expect(wholeAnimalIssues(c)).toEqual([]);
      expect(validateConnections(c.build, large.stock, 24)).toEqual([]);
    }
  });

  it('fails closed for scarce pairs, mismatched geometry, studless carriers and malformed/bounded inputs', () => {
    expect(animalEarSeeds({ ...large.stock, 'slope-2x2-black': 1 }, spec)).toEqual([]);
    expect(animalEarSeeds({ ...large.stock, 'plate-2x4-reddish-brown': 0 }, spec)).toEqual([]);
    expect(animalEarSeeds(large.stock, { ...spec, rightId: 'slope-1x2-black' })).toEqual([]);
    for (const id of ['curve-1x2-black', 'brick-2x2-black', 'invslope-1x2-reddish-brown']) expect(animalEarSeeds({ ...large.stock, [id]: 2 }, { ...spec, leftId: id, rightId: id })).toEqual([]);
    for (const id of ['tile-2x4-white', 'curve-2x2-white']) expect(animalEarSeeds({ ...large.stock, [id]: 1 }, { ...spec, carrierId: id })).toEqual([]);
    expect(animalEarSeeds({ 'brick-9x9-tan': 1, 'slope-2x2-black': 2 }, { ...spec, carrierId: 'brick-9x9-tan' })).toEqual([]);
    expect(animalEarSeeds(large.stock, { ...spec, leftId: 'unknown-ear-part' })).toEqual([]);
    for (const input of [null, [], { ...large.stock, 'slope-2x2-black': NaN }, { ...large.stock, 'slope-2x2-black': -1 }, { ...large.stock, 'slope-2x2-black': 1.5 },
      Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`unknown-${i}`, 1]))]) expect(animalEarSeeds(input as Record<string, number>, spec)).toEqual([]);
    for (const input of [null, {}, { ...spec, carrierId: 'x'.repeat(81) }, { ...spec, leftId: 2 }]) expect(animalEarSeeds(large.stock, input as AnimalEarSeedSpec)).toEqual([]);
  });

  it('preserves stock/spec, returns stable bounded IDs and holds no mutable cached seed references', () => {
    const stock = { ...large.stock }, input = { ...spec }, snapshot = JSON.stringify({ stock, input });
    const first = animalEarSeeds(stock, input), second = animalEarSeeds(Object.fromEntries(Object.entries(stock).reverse()), input);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].operations).not.toBe(second[0].operations);
    expect(first.every(s => s.id.length <= 64)).toBe(true);
    expect(Object.isFrozen(first[0].operations)).toBe(true);
    expect(() => { first[0].parts[1].rot = 0; }).toThrow();
    expect(JSON.stringify({ stock, input })).toBe(snapshot);
    stock['slope-2x2-black'] = 1;
    expect(animalEarSeeds(stock, input)).toEqual([]);
    expect(first).toHaveLength(4);
  });
});
