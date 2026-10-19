import { describe, expect, it } from 'vitest';
import { studPitch } from './scan';
import { needsRecount } from './scan';
import { parsePartId } from './bricks';
import type { Detection } from './gemini';
import type { Box } from './inventory';

// A 1000 x 1000 px photo where one stud is 40 px (4 units of the 0–1000 box scale).
const det = (id: string, box: Box, confidence = 0.9): Detection => ({ kind: parsePartId(id), description: '', color: 'red', box, confidence });

describe('large-part recount selection', () => {
  it('recounts an undersized prediction from its image extent or original survey', () => {
    const gray = det('plate-2x10-dark-gray', [240, 513, 319, 770]);
    expect(needsRecount(gray, 1536, 2048, 32)).toBe(true);
    expect(needsRecount(gray, 1536, 2048, null)).toBe(true);
    const smallReading = det('plate-2x4-dark-gray', gray.box);
    expect(needsRecount(smallReading, 1536, 2048, 32)).toBe(true);
    expect(needsRecount(smallReading, 1536, 2048, null, det('plate-4x12-dark-gray', gray.box))).toBe(true);
  });
  it('does not recount tiny pieces or reinterpret specialty outlines as rectangles', () => {
    expect(needsRecount(det('plate-1x2-red', [0, 0, 40, 80]), 1000, 1000, 40)).toBe(false);
    expect(needsRecount(det('curve-1x2-red', [0, 0, 500, 500]), 1000, 1000, 40)).toBe(false);
  });
});

describe('stud pitch', () => {
  it('measures pixels per stud from parts lying square, ignoring turned and doubtful ones', () => {
    const square = [
      det('plate-2x4-red', [0, 0, 80, 160]), det('brick-2x4-red', [100, 0, 260, 80]), det('plate-1x6-red', [300, 0, 340, 240]),
      det('plate-2x8-red', [400, 0, 480, 320]),
    ];
    const turned = det('plate-2x4-red', [500, 0, 640, 140]); // a 2x4 at 45° has a square box
    const doubtful = det('plate-2x4-red', [700, 0, 900, 400], 0.3);
    expect(studPitch([...square, turned, doubtful], 1000, 1000)).toBeCloseTo(40, 0);
    expect(studPitch(square.slice(0, 2), 1000, 1000)).toBeNull(); // too few to trust
  });
});

import { measureLength } from './scan';
describe('measuring a tile from its outline', () => {
  it('recovers the length of a tilted 1-wide tile', () => {
    // a 1x6 tile turned 15°, pitch 40 px, in a 1000 x 1000 px photo: box = L·cos+W·sin by L·sin+W·cos
    const t = (15 * Math.PI) / 180, L = 6 * 40, W = 40;
    const bh = L * Math.cos(t) + W * Math.sin(t), bw = L * Math.sin(t) + W * Math.cos(t);
    expect(measureLength([0, 0, bh, bw], 1, 1000, 1000, 40)).toBeCloseTo(6, 1);
    expect(measureLength([0, 0, 80, 120], 2, 1000, 1000, 40)).toBeCloseTo(3, 1); // a 2x3 lying square
  });
});

import { decideFromAngles } from './scan';
describe('deciding from several angled photos', () => {
  const plate = parsePartId('plate-2x3-light-gray')!;
  const v = (heightPlates: number, confidence = 0.8, stacked = false) => ({ heightPlates, confidence, stacked });
  it('changes a reading only when the angles agree', () => {
    expect(decideFromAngles(plate, [v(3), v(3)])).toMatchObject({ kind: { partId: 'brick-2x3-light-gray' } });
    expect(decideFromAngles(plate, [v(3), v(1)])).toMatchObject({ kind: { partId: 'plate-2x3-light-gray' } }); // a tie: keep it
    expect(decideFromAngles(plate, [v(3, 0.9)])).toMatchObject({ kind: { partId: 'brick-2x3-light-gray' } }); // one sure angle
    expect(decideFromAngles(plate, [v(3, 0.7)])).toMatchObject({ kind: { partId: 'plate-2x3-light-gray' } }); // one unsure angle
  });
  it('keeps hidden stack contents out of the usable inventory', () => {
    for (const height of [0, 2, 4, 6]) {
      expect(decideFromAngles(plate, [v(height, 0.9, true), v(height, 0.8, true)])).toHaveProperty('other');
    }
    expect(decideFromAngles(parsePartId('brick-1x2-red')!, [v(4, 0.9, true)])).toEqual({ other: 'Stack with 1x2 brick on top — separate it to identify the hidden pieces' });
  });
  it('moves taller single pieces out of the counted parts', () => {
    expect(decideFromAngles(parsePartId('brick-1x2-reddish-brown')!, [v(6), v(6)])).toHaveProperty('other');
  });
});

import { colorMismatch } from './scan';
describe('matching colors across photos', () => {
  it('allows the same color in different light, rejects a different color', () => {
    expect(colorMismatch([90, 92, 95], [140, 143, 147])).toBeNull(); // gray, brighter in the other photo
    expect(colorMismatch([80, 40, 20], [120, 60, 30])).toBeNull(); // reddish brown, lit differently
    expect(colorMismatch([80, 40, 20], [40, 160, 180])).not.toBeNull(); // brown vs teal
    expect(colorMismatch([240, 240, 235], [30, 30, 32])).not.toBeNull(); // white vs black
  });
});

import { applyDetections, parseClump } from './gemini';
import { emptyInventory, counts } from './inventory';
describe('stuck-together clumps', () => {
  it('reads the parts in a clump, defaulting to its color and skipping shapes the builder does not know', () => {
    expect(parseClump('brick-2x4-white ×2, plate-4x1 x1, window-1x2-white ×1', 'red').map(k => k.partId))
      .toEqual(['brick-2x4-white', 'brick-2x4-white', 'plate-1x4-red']);
    expect(parseClump('', 'red')).toEqual([]);
  });
  it('retains the clump as one review observation without charging hidden copies', () => {
    const inv = applyDetections(emptyInventory(), [{ kind: null, description: 'stack of two white 2x4 bricks', color: 'white', box: [0, 0, 10, 10], confidence: 0.8, clump: parseClump('brick-2x4-white ×2', 'white') }], 1);
    expect(counts(inv)).toEqual({});
    expect(inv.others).toHaveLength(1);
    expect(inv.others[0]).toMatchObject({unknown:true});
  });
});

import { correctDetections } from './gemini';
describe('correcting parts that share one outline', () => {
  const box: [number, number, number, number] = [0, 0, 10, 10];
  const clump = { kind: null, description: 'clump', color: 'white', box, confidence: 0.8, clump: parseClump('brick-2x4-white ×2', 'white') };
  it('re-reading a clump replaces it instead of counting it twice', () => {
    const once = applyDetections(emptyInventory(), [clump], 1);
    const next=correctDetections(once, [{ from: clump, to: clump }], 1);
    expect(counts(next)).toEqual({});
    expect(next.others).toHaveLength(1);
  });
  it('cannot remove an invented component from a quarantined clump', () => {
    const two = applyDetections(emptyInventory(), [clump], 1);
    const one = correctDetections(two, [{ from: { ...clump, clump: undefined, kind: clump.clump![0] }, to: null }], 1);
    expect(one).toEqual(two);
    expect(counts(one)).toEqual({});
  });
});
