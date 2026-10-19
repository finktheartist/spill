import { describe, expect, it } from 'vitest';
import { applyDetections, correctDetections, recheck, type Detection } from './gemini';
import { emptyInventory, inventoryTable, resolveOther, type Box } from './inventory';
import { parsePartId } from './bricks';

const det = (id: string | null, box: Box, description = ''): Detection =>
  ({ kind: id ? parsePartId(id) : null, description, color: 'white', box, confidence: 0.8 });

describe('close-up corrections', () => {
  it('moves a part from its first reading to the corrected one', () => {
    const a: Box = [0, 0, 10, 10], b: Box = [20, 20, 30, 30];
    const first = [det('plate-2x4-white', a), det('plate-2x4-white', b), det(null, [40, 40, 50, 50], 'corner plate 2x2')];
    let inv = applyDetections(emptyInventory(), first, 1);
    expect(inv.parts['plate-2x4-white'].count).toBe(2);
    inv = correctDetections(inv, [{ from: first[0], to: det('brick-2x4-white', a) }], 1);
    expect(inv.parts['plate-2x4-white'].count).toBe(1);
    expect(inv.parts['brick-2x4-white'].count).toBe(1);
    // an "other" part that turns out to be a catalog shape leaves the others list
    inv = correctDetections(inv, [{ from: first[2], to: det('plate-2x2-white', first[2].box) }], 1);
    expect(inv.others).toHaveLength(0);
    // the last one of a kind removes the entry instead of leaving a zero
    inv = correctDetections(inv, [{ from: first[1], to: det('brick-2x4-white', b) }], 1);
    expect(inv.parts['plate-2x4-white']).toBeUndefined();
    expect(inv.parts['brick-2x4-white'].count).toBe(2);
    // a duplicate is just taken out
    inv = correctDetections(inv, [{ from: det('brick-2x4-white', [20, 20, 30, 30]), to: null }], 1);
    expect(inv.parts['brick-2x4-white'].count).toBe(1); // serialized copies identify the same photo observation
    inv = correctDetections(inv, [{ from: det('brick-2x4-white', b), to: null }], 1);
    expect(inv.parts['brick-2x4-white'].count).toBe(1);
  });

  it('keeps guessed stand-ins visible for review without counting ordinary substitutes', () => {
    const log = (box: Box): Detection => ({ ...det('brick-1x2-white', box), aka: 'log brick 1x2' });
    const dets = [log([0, 0, 1, 1]), log([2, 2, 3, 3]), det('brick-1x2-white', [4, 4, 5, 5])];
    let inv = applyDetections(emptyInventory(), dets, 1);
    expect(inv.parts['brick-1x2-white'].count).toBe(1);
    expect(inv.others).toHaveLength(2);
    expect(inv.others.every(o=>o.unknown)).toBe(true);
    expect(inventoryTable(inv)).toBe('brick-1x2-white × 1');
    // a close-up that says one "log brick" was something else takes it off the count
    inv = correctDetections(inv, [{ from: dets[0], to: det('plate-1x2-white', dets[0].box) }], 1);
    expect(inv.parts['plate-1x2-white'].count).toBe(1);
    expect(inv.others).toHaveLength(1);
    inv = correctDetections(inv, [{ from: dets[2], to: null }], 1);
    expect(inv.parts['brick-1x2-white']).toBeUndefined();
    expect(inv.others).toHaveLength(1);
  });

  it('settles an unidentified piece: a known part, a name, or not a part', () => {
    const a: Box = [0, 0, 1, 1], b: Box = [2, 2, 3, 3], c: Box = [4, 4, 5, 5];
    const unk = (box: Box): Detection => ({ kind: null, description: 'gray thing', color: 'light-gray', box, confidence: 0.3, unknown: true });
    let inv = applyDetections(emptyInventory(), [unk(a), unk(b), unk(c)], 1);
    expect(inv.others.filter(o => o.unknown)).toHaveLength(3);
    inv = resolveOther(inv, a, 1, { kind: parsePartId('cornerplate-2x2-light-gray')! });
    expect(inv.parts['cornerplate-2x2-light-gray'].count).toBe(1);
    inv = resolveOther(inv, b, 1, { name: 'turntable 4x4' });
    expect(inv.others.find(o => o.description === 'turntable 4x4')?.unknown).toBeFalsy();
    inv = resolveOther(inv, c, 1, { remove: true });
    expect(inv.others.filter(o => o.unknown)).toHaveLength(0);
    expect(inv.others).toHaveLength(1);
  });

  it('does not count guessed look-alikes even when their stated height matches', () => {
    const first: Detection = { kind: null, description: 'unidentified piece', color: 'white', box: [0, 0, 1, 1], confidence: 0.3, unknown: true };
    const window = recheck(first, { type: 'other', size: '1x2', color: 'white', description: 'window 1x2x2', buildsAs: 'brick-1x2', heightPlates: 6,confidence:.8 });
    expect(window?.kind).toBeNull();
    expect(window?.description).toContain('window 1x2x2');
    const log = recheck(first, { type: 'other', size: '1x2', color: 'white', description: 'log brick 1x2', buildsAs: 'brick-1x2', heightPlates: 3,confidence:.8 });
    expect(log?.kind).toBeNull();
    expect(log?.unknown).toBe(true);
    expect(log?.description).toContain('log brick 1x2');
  });
});

import { editPiece } from './inventory';
import { alternatives } from './alternatives';
describe('changing a piece on the photo', () => {
  it('swaps a counted part for another, or names it, one piece at a time', () => {
    const a: Box = [0, 0, 1, 1], b: Box = [2, 2, 3, 3];
    let inv = applyDetections(emptyInventory(), [det('plate-2x3-white', a), det('plate-2x3-white', b)], 1);
    inv = editPiece(inv, a, 1, { kind: parsePartId('brick-2x3-white')! });
    expect(inv.parts['plate-2x3-white'].count).toBe(1);
    expect(inv.parts['brick-2x3-white'].count).toBe(1);
    inv = editPiece(inv, b, 1, { name: 'Plate Special 1 x 2 with 1 Stud (Jumper) · 15573' });
    expect(inv.parts['plate-2x3-white']).toBeUndefined();
    expect(inv.others.map(o => o.description)).toContain('Plate Special 1 x 2 with 1 Stud (Jumper) · 15573');
  });
  it('offers the likely mix-ups first: other heights, nearby lengths, close colors', () => {
    const alt = alternatives(parsePartId('plate-2x3-light-gray')!).map(k => k.partId);
    expect(alt.slice(0, 2)).toEqual(['brick-2x3-light-gray', 'tile-2x3-light-gray']);
    expect(alt).toContain('plate-2x4-light-gray');
    expect(alt).not.toContain('plate-2x3-light-gray');
    expect(alternatives(parsePartId('cornerplate-2x2-light-gray')!).map(k => k.partId)[0]).toBe('cornerbrick-2x2-light-gray');
  });
});
