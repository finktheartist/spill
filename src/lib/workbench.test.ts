import { describe, expect, it } from 'vitest';
import { parsePartId, validate } from './bricks';
import { anchor, emptyBench, restZ, toBooklet, tryPlace, warnings, withPart, withoutPart, allParts } from './workbench';

const brick = parsePartId('brick-2x4-red')!, plate = parsePartId('plate-2x2-blue')!, tile = parsePartId('tile-2x2-white')!;
const have = { 'brick-2x4-red': 3, 'plate-2x2-blue': 2, 'tile-2x2-white': 1 };

describe('placing parts by hand', () => {
  it('centres the part on the pointer and keeps it on the plate', () => {
    expect(anchor(brick, 0, 10, 10)).toEqual({ x: 9, y: 10 }); // a 2x4 brick lies 4 long in x at rot 0
    expect(anchor(brick, 0, 0, 23)).toEqual({ x: 0, y: 22 });
  });
  it('rests on whatever is under it', () => {
    const b = tryPlace(emptyBench(), have, brick, 10, 10, 0).next;
    expect(restZ(b, plate, 9, 10, 0)).toBe(3);
    const r = tryPlace(b, have, plate, 10, 10, 0);
    expect(r).toMatchObject({ ok: true, placed: { z: 3 } });
  });
  it("won't let a part float on a tile or use more than the pile has", () => {
    let b = tryPlace(emptyBench(), have, tile, 5, 5, 0).next;
    expect(tryPlace(b, have, plate, 5, 5, 0)).toMatchObject({ ok: false, reason: 'nothing under it to grip' });
    b = tryPlace(b, have, plate, 15, 15, 0).next;
    b = tryPlace(b, have, plate, 18, 18, 0).next;
    expect(tryPlace(b, have, plate, 2, 20, 0)).toMatchObject({ ok: false, reason: "you've used all of these" });
  });
  it('flags parts left floating when what held them is removed', () => {
    let b = tryPlace(emptyBench(), have, brick, 10, 10, 0).next;
    b = tryPlace(b, have, plate, 10, 10, 0).next;
    expect(warnings(withoutPart(b, 0), have).get(0)).toBe('floating');
  });
  it('turns a build into a valid booklet, bottom up', () => {
    let b = emptyBench();
    b = withPart(b, { partId: 'plate-2x2-blue', x: 9, y: 10, z: 3, rot: 0 }); // placed out of order on purpose
    b = withPart(b, { partId: 'brick-2x4-red', x: 9, y: 10, z: 0, rot: 0 });
    const booklet = toBooklet(b, 'Test');
    expect(allParts(booklet).map(p => p.z)).toEqual([0, 3]);
    expect(validate(booklet, have)).toEqual([]);
  });
});

describe('placing where it looks like it should go', () => {
  it('accepts a brick turned 180°: the same shape as 0° (R was cycling to rotations bricks refuse)', () => {
    expect(tryPlace(emptyBench(), have, brick, 10, 10, 180)).toMatchObject({ ok: true, placed: { rot: 0 } });
    expect(tryPlace(emptyBench(), have, brick, 10, 10, 270)).toMatchObject({ ok: true, placed: { rot: 90 } });
  });
  it('puts a part pointed at the side of another flush against it, not centred over it', () => {
    const b = tryPlace(emptyBench(), have, brick, 10, 10, 0).next; // x 9–12, y 10–11
    // pointing at its east wall: the neighbor cell is x=13; a 2x4 brick should start there, not overlap
    expect(tryPlace(b, have, brick, 13, 10, 0, { dx: 1, dy: 0 })).toMatchObject({ ok: true, placed: { x: 13, y: 10, z: 0 } });
    // its west wall: the neighbor cell is x=8; the new brick ends there
    expect(tryPlace(b, have, brick, 8, 10, 0, { dx: -1, dy: 0 })).toMatchObject({ ok: true, placed: { x: 5, y: 10, z: 0 } });
    // its back wall (higher y): the new brick starts at y=12
    expect(tryPlace(b, have, brick, 10, 12, 0, { dx: 0, dy: 1 })).toMatchObject({ ok: true, placed: { y: 12 } });
  });
});
