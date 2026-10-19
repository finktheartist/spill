import { describe, expect, it } from 'vitest';
import { parsePartId, type Build, type Placed } from '../bricks';
import { apply, attachPart, axisAngle, corners, definition, frame, multiply, validateConnections } from '../connections';
import { geometryFingerprint } from '../library-discoveries';
import { animalSilhouetteKey } from './animal-silhouette';

const piece = (partId: string, x = 0, y = 0, z = 0, rot = 0): Placed => ({ partId, x, y, z, rot });
const build = (parts: Placed[]): Build => ({ engine: 'connections-v2', name: 'Animal', description: '', steps: parts.map(p => ({ caption: 'Connect', parts: [p] })) });
const key = (parts: Placed[]) => animalSilhouetteKey(build(parts));
const count = (b: Build) => {
  const have: Record<string, number> = {};
  for (const p of b.steps.flatMap(s => s.parts)) have[p.partId] = (have[p.partId] ?? 0) + 1;
  return have;
};
function rotate(b: Build, turn: number): Build {
  const yaw = axisAngle([0, 0, 1], turn * 90);
  return { ...b, steps: b.steps.map(s => ({ ...s, parts: s.parts.map(p => {
    const f = frame(p), orientation = multiply(yaw, f.rotation), translation = apply(yaw, f.translation);
    const points = definition(parsePartId(p.partId)!).boxes.flatMap(corners).map(v => apply(orientation, v));
    const min = [0, 1, 2].map(i => Math.min(...points.map(v => v[i])) + translation[i]);
    return { ...p, x: min[0] / 20, y: min[1] / 20, z: min[2] / 8, rot: 0, orientation };
  }) })) };
}

describe('normalized body union', () => {
  it('deduplicates a valid brick and three valid stacked plates despite the global fingerprint difference', () => {
    const brick = build([piece('brick-1x1-red')]);
    const plates = build([0, 1, 2].map(z => piece('plate-1x1-red', 0, 0, z)));
    expect(validateConnections(brick, count(brick), 24)).toEqual([]);
    expect(validateConnections(plates, count(plates), 24)).toEqual([]);
    expect(geometryFingerprint(brick)).not.toBe(geometryFingerprint(plates));
    expect(animalSilhouetteKey(brick)).toBe(animalSilhouetteKey(plates));
  });

  it('ignores color, part segmentation, solid boundaries, metadata and step order', () => {
    const slab = build([piece('plate-2x2-white')]);
    const split = build([piece('plate-1x1-red'), piece('tile-1x1-blue', 1),
      piece('plate-1x1-green', 0, 1), piece('plate-1x1-black', 1, 1)]);
    split.name = 'Fox'; split.description = 'A renamed construction.'; split.steps.reverse();
    expect(animalSilhouetteKey(slab)).toBe(animalSilhouetteKey(split));
    const double = build([...slab.steps[0].parts, ...slab.steps[0].parts]);
    expect(animalSilhouetteKey(double)).toBe(animalSilhouetteKey(slab)); // a key is not a collision validator
    expect(validateConnections(double, count(double), 24).some(i => i.kind === 'overlap')).toBe(true);
  });

  it('ignores arbitrary translation and all four yaw turns on an asymmetric construction', () => {
    const a = build([piece('plate-2x4-red'), piece('brick-1x1-blue', .5, 1.5, 1), piece('slope-1x2-white', 2, 0, 1)]);
    const translated = { ...a, steps: a.steps.map(s => ({ ...s, parts: s.parts.map(p => ({ ...p, x: p.x + 103.125, y: p.y - 71.33, z: p.z + 8.125 })) })) };
    expect(animalSilhouetteKey(translated)).toBe(animalSilhouetteKey(a));
    for (const turn of [0, 1, 2, 3]) expect(animalSilhouetteKey(rotate(translated, turn))).toBe(animalSilhouetteKey(a));
  });

  it('resamples each yaw grid so fractional bracket and oblique SNOT bounds remain invariant', () => {
    const parent = piece('sidebrick-1x1-red', 2, 3, 5);
    const panel = attachPart(parent, 'side:0', 'plate-1x4-white', 'grip:1:0', 23);
    const a = build([parent, panel, piece('bracket-1x2-black', 5, 6, 4)]);
    const before = structuredClone(a);
    for (const turn of [1, 2, 3]) expect(animalSilhouetteKey(rotate(a, turn))).toBe(animalSilhouetteKey(a));
    expect(a).toEqual(before);
    expect(panel.orientation).toEqual(before.steps[1].parts[0].orientation);
  });

  it('distinguishes actual openings, face and tail changes, height and half-stud offsets', () => {
    const open = [piece('brick-1x1-red'), piece('brick-1x1-red', 2), piece('plate-1x3-red', 0, 0, 3)];
    expect(key(open)).not.toBe(key([...open, piece('brick-1x1-black', 1)]));
    const body = [piece('plate-2x6-red'), piece('brick-2x2-red', 1, 0, 1)];
    expect(key([...body, piece('plate-1x2-white', 1, -.5, 1)])).not.toBe(key([...body, piece('plate-1x3-white', 1, -.5, 1)]));
    expect(key([...body, piece('plate-1x2-black', 1, 2, 1)])).not.toBe(key([...body, piece('plate-1x4-black', 1, 2, 1)]));
    expect(key(body)).not.toBe(key([...body, piece('plate-2x2-red', 1, 0, 4)]));
    const centered = [piece('plate-2x6-red'), piece('brick-1x1-black', 2, .5, 1)];
    expect(key(centered)).not.toBe(key([centered[0], { ...centered[1], x: 2.5 }]));
  });

  it('preserves actual convex taper profiles instead of only their bounding boxes', () => {
    const slope = piece('slope-1x2-red'), rectangle = piece('brick-1x2-red', 0, 0, 0, 90);
    expect(frame(slope).bounds).toEqual(frame(rectangle).bounds);
    expect(key([slope])).not.toBe(key([rectangle]));
    expect(key([piece('invslope-1x2-red')])).not.toBe(key([slope]));
  });

  it('does not cache mutable builds or mutate placements while computing keys', () => {
    const a = build([piece('plate-2x4-red'), piece('brick-1x1-black', 1, 0, 1)]), snapshot = structuredClone(a);
    const first = animalSilhouetteKey(a);
    expect(a).toEqual(snapshot);
    a.steps[1].parts[0].x += .5;
    expect(animalSilhouetteKey(a)).not.toBe(first);
    a.steps[1].parts[0].x -= .5;
    expect(animalSilhouetteKey(a)).toBe(first);
  });
});

describe('visual primitive masks remain separate from physics', () => {
  it('retains curved ear/head profiles against rectangular bodies with identical nominal boxes', () => {
    const curved = piece('curve-2x2-red'), box = [piece('plate-2x2-red'), piece('plate-2x2-red', 0, 0, 1)];
    expect(frame(curved).bounds).toEqual({ min: [0, 0, 0], max: [40, 40, 16] });
    expect(key([curved])).not.toBe(key(box));
    expect(key([curved])).toBe(key([piece('curve-2x2-blue')]));
  });

  it('retains round 1x1/2x2, round plate/tile, capsule and cone morphology against squares', () => {
    for (const [round, square] of [
      ['roundbrick-1x1-red', 'brick-1x1-red'], ['roundbrick-2x2-red', 'brick-2x2-red'],
      ['roundplate-1x1-red', 'plate-1x1-red'], ['roundtile-1x1-red', 'tile-1x1-red'],
      ['roundendplate-1x2-red', 'plate-1x2-red'], ['cone-1x1-red', 'brick-1x1-red'],
    ]) expect(key([piece(round)])).not.toBe(key([piece(square)]));
    expect(key([piece('cone-1x1-red')])).not.toBe(key([piece('roundbrick-1x1-red')]));
  });

  it('deduplicates round volume segmentation and union-masks concealed internal profiles', () => {
    const brick = [piece('roundbrick-1x1-red')], plates = [0, 1, 2].map(z => piece('roundplate-1x1-blue', 0, 0, z));
    expect(key(brick)).toBe(key(plates));
    const outer = piece('brick-2x2-white');
    expect(key([outer, piece('roundbrick-1x1-red', .5, .5)])).toBe(key([outer]));
  });

  it('applies visual masks in the actual local rigid frame including sideways and oblique poses', () => {
    const parent = piece('sidebrick-1x1-black', 3, 3, 4);
    for (const [partId, childPort] of [['curve-1x2-red', 'grip:0:0'], ['roundplate-1x1-red', 'grip:0:0']] as const) {
      const child = attachPart(parent, 'side:0', partId, childPort, 23);
      const a = build([parent, child]);
      for (const turn of [1, 2, 3]) expect(animalSilhouetteKey(rotate(a, turn))).toBe(animalSilhouetteKey(a));
      const tilted = { ...child, orientation: axisAngle([1, 0, 0], 31) };
      expect(key([parent, tilted])).not.toBe(key([parent, child]));
    }
  });
});

describe('bounded sample work', () => {
  it('rejects malformed/nonfinite geometry, invalid matrices, unknown parts and empty builds', () => {
    for (const b of [undefined, null, {}, { steps: [] }, { steps: [{ parts: [] }] }, { steps: [{ parts: null }] }]) {
      expect(() => animalSilhouetteKey(b as unknown as Build)).toThrow();
    }
    for (const p of [piece('unknown'), piece('plate-999x999-red'), piece('brick-1x1-red', NaN),
      piece('brick-1x1-red', 0, Infinity), piece('brick-1x1-red', 0, 0, -Infinity),
      { ...piece('brick-1x1-red'), orientation: [2, 0, 0, 0, 1, 0, 0, 0, 1] },
      { ...piece('brick-1x1-red'), orientation: [NaN, 0, 0, 0, 1, 0, 0, 0, 1] }]) {
      expect(() => key([p as Placed])).toThrow();
    }
  });

  it('guards 160 parts, bounded steps and 24-stud spans on every axis', () => {
    expect(() => key(Array.from({ length: 161 }, () => piece('plate-1x1-red')))).toThrow(/160/);
    expect(() => animalSilhouetteKey({ ...build([]), steps: Array.from({ length: 161 }, () => ({ caption: '', parts: [] })) })).toThrow(/160/);
    expect(() => key([piece('brick-1x1-red'), piece('brick-1x1-red', 24)])).toThrow(/24 studs/);
    expect(() => key([piece('brick-1x1-red'), piece('brick-1x1-red', 0, 24)])).toThrow(/24 studs/);
    expect(() => key([piece('brick-1x1-red'), piece('brick-1x1-red', 0, 0, 60)])).toThrow(/24 studs/);
    expect(() => key([piece('brick-1x1-red'), piece('brick-1x1-red', 23)])).not.toThrow();
  });

  it('bounds probe work before rasterizing overlapping oblique oversized envelopes', () => {
    const p = { ...piece('brick-1x16-red'), orientation: axisAngle([0, 0, 1], 45) };
    expect(() => key(Array.from({ length: 160 }, () => p))).toThrow(/sample work budget/);
  });

  it('processes a 64-candidate, 50-part batch without unsafe reference caching', () => {
    const pieces = Array.from({ length: 50 }, (_, i) => piece(i % 5 ? 'brick-1x1-red' : 'roundbrick-1x1-tan', i % 10, Math.floor(i / 10)));
    const start = performance.now(), keys = Array.from({ length: 64 }, (_, i) => key(pieces.map(p => ({ ...p, x: p.x + i * .125 }))));
    const elapsed = performance.now() - start;
    expect(new Set(keys).size).toBe(1);
    expect(elapsed).toBeLessThan(3000); // broad guard; observed timing is reported separately
  });
});
