import { describe, expect, it } from 'vitest';
import { validate, normalizeSize, studCells, parsePartId, trimToValid, partCount, applyEdits, listing, settle, footprint, colorPatches, buildSize, matchColors, placedKey, cells, type Build, type Placed } from './bricks';
import { counts, sampleInventory, setCount } from './inventory';
import { colorsOf, feasible, keepHelpfulEdits, passes } from './gemini';
import { assignSlots, newCard, type Card } from '../screens/Builds';

const inv = { 'plate-2x4-green': 2, 'brick-2x2-red': 3, 'brick-2x4-blue': 2, 'tile-1x2-black': 1, 'slope-2x2-red': 1 };
const ok: Build = {
  name: 'ok', description: '',
  steps: [
    { caption: 'base', parts: [{ partId: 'plate-2x4-green', x: 0, y: 0, z: 0, rot: 0 }] },
    { caption: 'walls', parts: [
      { partId: 'brick-2x2-red', x: 0, y: 0, z: 1, rot: 0 },
      { partId: 'brick-2x2-red', x: 2, y: 0, z: 1, rot: 0 },
      { partId: 'brick-2x4-blue', x: 0, y: 0, z: 4, rot: 0 }, // long side along x: covers x 0–3, y 0–1
    ] },
  ],
};
const kinds = (b: Build) => validate(b, inv).map(i => i.kind);
const clone = (b: Build): Build => JSON.parse(JSON.stringify(b));

describe('validate', () => {
  it('passes a sound build', () => expect(kinds(ok)).toEqual([]));

  it('catches a floating part', () => {
    const b = clone(ok); b.steps[1].parts.push({ partId: 'brick-2x2-red', x: 10, y: 10, z: 7, rot: 0 });
    expect(kinds(b)).toContain('floating');
  });

  it('catches an overlap (duplicated part)', () => {
    const b = clone(ok); b.steps[1].parts.push({ ...b.steps[1].parts[0] });
    expect(kinds(b)).toContain('overlap');
  });

  it('catches using more than the bucket has', () => {
    const b = clone(ok); b.steps[1].parts.push({ partId: 'brick-2x4-blue', x: 0, y: 0, z: 7, rot: 0 }, { partId: 'brick-2x4-blue', x: 0, y: 0, z: 10, rot: 0 });
    expect(kinds(b)).toContain('inventory');
  });

  it('catches two ground plates nothing connects', () => {
    const b = clone(ok); b.steps[0].parts.push({ partId: 'plate-2x4-green', x: 0, y: 2, z: 0, rot: 0 });
    expect(kinds(b)).toEqual(['loose']);
  });

  it('a bridging brick joins two ground plates', () => {
    const b = clone(ok);
    b.steps[0].parts.push({ partId: 'plate-2x4-green', x: 0, y: 2, z: 0, rot: 0 });
    b.steps[1].parts[0] = { partId: 'brick-2x2-red', x: 0, y: 1, z: 1, rot: 0 }; // straddles y=1..2
    expect(kinds(b)).toEqual([]);
  });

  it('nothing sticks to a tile', () => {
    const b: Build = { name: '', description: '', steps: [{ caption: '', parts: [
      { partId: 'tile-1x2-black', x: 0, y: 0, z: 0, rot: 0 },
      { partId: 'brick-2x2-red', x: 0, y: 0, z: 1, rot: 0 },
    ] }] };
    expect(kinds(b)).toContain('floating');
  });

  it('slope studs are only on the high row', () => {
    const k = parsePartId('slope-2x2-red')!;
    expect(studCells(k, { partId: k.partId, x: 0, y: 0, z: 0, rot: 0 })).toEqual([[0, 1], [1, 1]]);
    expect(studCells(k, { partId: k.partId, x: 0, y: 0, z: 0, rot: 180 })).toEqual([[0, 0], [1, 0]]);
    expect(studCells(k, { partId: k.partId, x: 0, y: 0, z: 0, rot: 90 })).toEqual([[0, 0], [0, 1]]);
    const b: Build = { name: '', description: '', steps: [{ caption: '', parts: [
      { partId: 'slope-2x2-red', x: 0, y: 0, z: 0, rot: 0 },
      { partId: 'tile-1x2-black', x: 0, y: 0, z: 3, rot: 0 }, // over the sloped (front) row
    ] }] };
    expect(kinds(b)).toContain('floating');
  });

  it('rejects bad rotations and unknown parts', () => {
    const b: Build = { name: '', description: '', steps: [{ caption: '', parts: [
      { partId: 'brick-2x2-red', x: 0, y: 0, z: 0, rot: 45 },
      { partId: 'banana-1x1-red', x: 0, y: 0, z: 0, rot: 0 },
    ] }] };
    expect(kinds(b)).toEqual(['invalid', 'invalid']);
  });
});

describe('normalizeSize', () => {
  it('orders brick dims', () => expect(normalizeSize('brick', '4x2')).toEqual({ w: 2, d: 4 }));
  it('maps LEGO-style slope names to width x run', () => {
    expect(normalizeSize('slope', '2x1')).toEqual({ w: 1, d: 2 });
    expect(normalizeSize('slope', '2 x 3')).toEqual({ w: 3, d: 2 });
    expect(normalizeSize('slope', '3x3')).toBeNull();
  });
});

describe('trimToValid', () => {
  it('drops a single overlapping part and keeps the rest', () => {
    const b = clone(ok); b.steps[1].parts.push({ ...b.steps[1].parts[0] });
    const t = trimToValid(b, inv)!;
    expect(t.removed).toBe(1);
    expect(validate(t.build, inv)).toEqual([]);
    expect(partCount(t.build)).toBe(partCount(ok));
  });

  it('follows a cascade: removing a support leaves the part above floating', () => {
    const b = clone(ok);
    b.steps[1].parts[0] = { partId: 'brick-2x2-red', x: 0, y: 0, z: 7, rot: 0 }; // floating
    b.steps.push({ caption: 'cap', parts: [{ partId: 'brick-2x2-red', x: 0, y: 0, z: 10, rot: 0 }] }); // rests on it
    const t = trimToValid(b, inv);
    expect(t && validate(t.build, inv)).toEqual([]);
  });

  it('refuses to gut a design', () => {
    const b = clone(ok);
    for (let i = 0; i < 5; i++) b.steps[1].parts.push({ partId: 'brick-2x2-red', x: 20 + i * 3, y: 0, z: 9, rot: 0 });
    expect(trimToValid(b, { ...inv, 'brick-2x2-red': 9 })).toBeNull();
  });

  it('returns null for an already valid build', () => expect(trimToValid(ok, inv)).toBeNull());
});

describe('wheel pairs', () => {
  const winv = { 'wheels-4x2-black': 2, 'plate-4x6-light-gray': 1, 'brick-2x2-red': 1 };
  const car: Build = { name: 'car', description: '', steps: [
    { caption: 'wheels', parts: [
      { partId: 'wheels-4x2-black', x: 0, y: 0, z: 0, rot: 0 },
      { partId: 'wheels-4x2-black', x: 0, y: 4, z: 0, rot: 0 },
    ] },
    { caption: 'chassis', parts: [{ partId: 'plate-4x6-light-gray', x: 0, y: 0, z: 3, rot: 90 }] }, // 4 across, 6 deep
  ] };
  const kinds = (b: Build) => validate(b, winv).map(i => i.kind);

  it('a classic chassis on two wheel pairs is valid and one piece', () => expect(kinds(car)).toEqual([]));

  it('only the axle plate has studs', () => {
    const k = parsePartId('wheels-4x2-black')!;
    expect(studCells(k, { partId: k.partId, x: 0, y: 0, z: 0, rot: 0 })).toEqual([[1, 0], [1, 1], [2, 0], [2, 1]]);
    expect(studCells(k, { partId: k.partId, x: 0, y: 0, z: 0, rot: 90 })).toEqual([[0, 1], [0, 2], [1, 1], [1, 2]]);
    const b: Build = { name: '', description: '', steps: [{ caption: '', parts: [
      { partId: 'wheels-4x2-black', x: 0, y: 0, z: 0, rot: 0 },
      { partId: 'brick-2x2-red', x: 2, y: 0, z: 3, rot: 0 }, // half over a wheel: still holds by the plate studs
    ] }] };
    expect(kinds(b)).toEqual([]);
    b.steps[0].parts[1].x = 3; // entirely over the wheel: nothing to grip
    expect(kinds(b)).toContain('floating');
  });

  it('wheel pairs must stand on the ground', () => {
    const b = clone(car); b.steps[0].parts[0].z = 3;
    expect(kinds(b)).toContain('invalid');
  });

  it('only confirmed complete assemblies are offered for builds', () => {
    const inv = sampleInventory();
    expect(counts(inv)['wheels-4x2-black']).toBe(4);
    expect(counts(setCount(inv, 'wheels-4x2-black', 2))['wheels-4x2-black']).toBe(2);
  });
});

describe('feasible', () => {
  const inv = sampleInventory();
  const idea = { name: 'Car', pitch: '', estimatedParts: 80, difficulty: 2, keyParts: [{ partId: 'wheels-4x2-black', count: 2 }, { partId: 'brick-2x2-red', count: 6 }, { partId: 'brick-2x2-white', count: 6 }, { partId: 'brick-2x4-red', count: 6 }] };
  it('accepts an idea whose parts list fits', () => expect(feasible(idea, inv).ok).toBe(true));
  it('rejects one that needs more than the bucket has', () => {
    expect(feasible({ ...idea, keyParts: [{ partId: 'wheels-4x2-black', count: 9 }] }, inv).ok).toBe(false);
    expect(feasible({ ...idea, estimatedParts: 999 }, inv).ok).toBe(false);
  });
});

describe('ideas from the parts list', () => {
  const inv = sampleInventory();
  const idea = (keyParts: { partId: string; count: number }[]) => ({ name: 'Thing', pitch: '', why: 'because', difficulty: 1, keyParts, estimatedParts: keyParts.reduce((a, k) => a + k.count, 0) });
  it('builds only an idea whose whole parts list fits', () => {
    expect(feasible(idea([{ partId: 'brick-2x4-red', count: 8 }, { partId: 'brick-2x2-white', count: 6 }, { partId: 'brick-2x2-red', count: 6 }]), inv).ok).toBe(true);
    expect(feasible(idea([{ partId: 'brick-2x4-red', count: 99 }]), inv).reason).toMatch(/needs 99 × brick-2x4-red/);
    expect(feasible(idea([]), inv).reason).toBe('no parts list');
  });
  it('reads its colors from the parts list, most-used first', () => {
    expect(colorsOf(idea([{ partId: 'brick-2x4-red', count: 2 }, { partId: 'plate-2x4-white', count: 5 }, { partId: 'brick-2x2-red', count: 1 }]))).toEqual(['white', 'red']);
  });
});

describe('quality check', () => {
  const v = (recognizable: number, complete: number, colors: number, impressive: number) => ({ looksLike: '', fixes: [], recognizable, complete, colors, impressive });
  it('passes a shaped, recognizable build with coherent colors', () => expect(passes(v(4, 4, 3, 4))).toBe(true));
  it('keeps a recognizable but crude model below the bar', () => expect(passes(v(5, 5, 5, 3))).toBe(false));
  it('rejects malformed scores', () => expect(passes(v(5, NaN, 5, 5))).toBe(false));
  it('fails a patchwork, even when the rest is good', () => expect(passes(v(5, 5, 2, 5))).toBe(false));
  it('fails a mediocre build', () => expect(passes(v(3, 3, 4, 3))).toBe(false));
});

describe('assignSlots', () => {
  const idea = (name: string) => ({ name, pitch: '', estimatedParts: 50, difficulty: 1, keyParts: [] });
  const cs = (...phases: Card['phase'][]) => phases.map((p, i) => ({ ...newCard(idea(`c${i}`)), phase: p }));
  it('shows the first three while they are alive', () => expect(assignSlots(cs('designing', 'ready', 'checking', 'designing', 'designing')).map(s => s.index)).toEqual([0, 1, 2]));
  it('a backup takes a failed slot without shuffling the others', () => {
    const s = assignSlots(cs('ready', 'failed', 'designing', 'designing', 'designing'));
    expect(s.map(x => x.index)).toEqual([0, 3, 2]);
    expect(s[1].replaced).toBe('c1');
  });
  const scored = (phase: Card['phase'], n: number, i: number) => ({ ...newCard(idea(`c${i}`)), phase, verdict: { looksLike: '', fixes: [], recognizable: n, complete: n, colors: n, impressive: n } });
  it('a backup that passes, or is still working, takes the place of a weak build', () => {
    const c = [scored('ready', 2, 0), scored('ready', 4, 1), scored('ready', 4, 2), scored('ready', 4, 3), scored('designing', 2, 4)];
    const s = assignSlots(c);
    expect(s.map(x => x.index)).toEqual([3, 1, 2]);
    expect(s[0].replaced).toBe('c0');
  });
  it('shows the best attempt when no backup does better, and prefers it to a failure', () => {
    expect(assignSlots([scored('ready', 2, 0), scored('ready', 4, 1), scored('ready', 4, 2), scored('failed', 4, 3), scored('ready', 2, 4)]).map(x => x.index)).toEqual([0, 1, 2]);
    expect(assignSlots([scored('failed', 2, 0), scored('ready', 4, 1), scored('ready', 4, 2), scored('ready', 2, 3)]).map(x => x.index)).toEqual([3, 1, 2]);
  });
  it('skips failed backups and shows the failure when none are left', () => {
    expect(assignSlots(cs('failed', 'failed', 'ready', 'failed', 'designing')).map(x => x.index)).toEqual([4, 1, 2]);
  });
});

describe('editing in place', () => {
  it('applyEdits moves, removes and adds by part number, leaving the rest alone', () => {
    const b = applyEdits(ok, [
      { op: 'move', index: 1, x: 1 },
      { op: 'remove', index: 2 },
      { op: 'add', step: 2, partId: 'tile-1x2-black', x: 0, y: 0, z: 7, rot: 0 },
    ]);
    const flat = b.steps.flatMap(s => s.parts);
    expect(flat.map(p => p.partId)).toEqual(['plate-2x4-green', 'brick-2x2-red', 'brick-2x4-blue', 'tile-1x2-black']);
    expect(flat[1].x).toBe(1);
    expect(flat[0]).toEqual(ok.steps[0].parts[0]);
    expect(listing(ok).split('\n')[3]).toBe('#3 step 2 brick-2x4-blue x=0 y=0 z=4 rot=0');
  });

  it('settle snaps a slightly floating or overlapping part onto studs', () => {
    const b = clone(ok);
    b.steps[1].parts[2].z = 5; // blue 2x4 hovering one plate above its support
    b.steps[1].parts.push({ partId: 'brick-2x2-red', x: 1, y: 0, z: 1, rot: 0 }); // overlaps both red bricks
    expect(validate(b, { ...inv, 'brick-2x2-red': 3 }).length).toBeGreaterThan(0);
    const s = settle(b, { ...inv, 'brick-2x2-red': 3 });
    expect(validate(s.build, { ...inv, 'brick-2x2-red': 3 })).toEqual([]);
  });

  it('settle leaves far-off parts for the model', () => {
    const b = clone(ok); b.steps[1].parts.push({ partId: 'brick-2x2-red', x: 20, y: 20, z: 12, rot: 0 });
    expect(validate(settle(b, inv).build, inv).map(i => i.kind)).toContain('floating');
  });
});

describe('settle only moves blamed parts', () => {
  it('never moves a part the checker did not blame, even if a blamed part below it moves', () => {
    const b = clone(ok);
    b.steps[0].parts[0].x = 0; // plate fine
    b.steps[1].parts[2] = { partId: 'brick-2x4-blue', x: 0, y: 0, z: 5, rot: 0 }; // blamed: hovering
    const before = b.steps[1].parts.slice(0, 2).map(p => ({ ...p }));
    const s = settle(b, inv);
    expect(s.build.steps[1].parts.slice(0, 2)).toEqual(before);
    expect(s.moved).toBe(1);
  });
});

describe('orientation', () => {
  it('bricks lie long side along x at rot 0, slopes keep width along x', () => {
    const fp = (id: string, rot: number) => footprint(parsePartId(id)!, rot);
    expect(fp('brick-2x4-red', 0)).toEqual({ fw: 4, fd: 2 });
    expect(fp('brick-2x4-red', 90)).toEqual({ fw: 2, fd: 4 });
    expect(fp('plate-1x6-red', 0)).toEqual({ fw: 6, fd: 1 });
    expect(fp('slope-4x2-red', 0)).toEqual({ fw: 4, fd: 2 });
    expect(fp('wheels-4x2-black', 0)).toEqual({ fw: 4, fd: 2 });
  });
});

describe('colorPatches', () => {
  const cinv = { 'brick-2x4-red': 6, 'brick-2x4-white': 2, 'plate-6x8-black': 1 };
  // A row of three 2x4s (x 0–11) locked together by two bridging bricks on top; the middle one is the odd one.
  const row = (mid: string): Build => ({ name: '', description: '', steps: [
    { caption: '', parts: [
      { partId: 'brick-2x4-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: mid, x: 4, y: 0, z: 0, rot: 0 }, { partId: 'brick-2x4-red', x: 8, y: 0, z: 0, rot: 0 },
    ] },
    { caption: '', parts: [{ partId: 'brick-2x4-red', x: 2, y: 0, z: 3, rot: 0 }, { partId: 'brick-2x4-red', x: 6, y: 0, z: 3, rot: 0 }] },
  ] });
  it('flags a part that interrupts its row and names an exact swap', () => {
    const p = colorPatches(row('brick-2x4-white'), cinv);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ index: 1, color: 'white', zoneColor: 'red', swap: 'brick-2x4-red' });
  });
  it('a consistent row has no patches', () => expect(colorPatches(row('brick-2x4-red'), cinv)).toEqual([]));
  it('a band of another color (a base or stripe) is not a patch', () => {
    const b = row('brick-2x4-red');
    b.steps.unshift({ caption: '', parts: [{ partId: 'plate-6x8-black', x: 0, y: 0, z: 0, rot: 0 }] });
    b.steps.slice(1).forEach(st => st.parts.forEach(p => { p.z += 1; }));
    expect(colorPatches(b, cinv)).toEqual([]);
  });
  it('buildSize measures x, y and height', () => expect(buildSize(row('brick-2x4-red'))).toEqual({ sizeX: 12, sizeY: 2, heightPlates: 6 }));
});

describe('recolor edits and spot suggestions', () => {
  it('recolor changes only the color, and refuses a different shape', () => {
    const b = applyEdits(ok, [{ op: 'recolor', index: 1, partId: 'brick-2x2-blue' }, { op: 'recolor', index: 2, partId: 'brick-2x4-red' }]);
    const flat = b.steps.flatMap(s => s.parts);
    expect(flat[1].partId).toBe('brick-2x2-blue');
    expect(flat[2].partId).toBe('brick-2x2-red'); // 2x2 → 2x4 refused
    expect(flat[1].x).toBe(ok.steps[1].parts[0].x);
  });
  it('a floating part comes with the nearest spot that would hold it', () => {
    const b = clone(ok); b.steps[1].parts[2].z = 5;
    const msg = validate(b, inv).find(i => i.kind === 'floating')!.message;
    expect(msg).toContain('nearest free spot where it would sit on studs is x=0, y=0, z=4');
  });
});

describe('keepHelpfulEdits', () => {
  it('keeps the edit that fixes a problem and rejects the one that would make a new one', () => {
    const b = clone(ok); b.steps[1].parts[2].z = 5; // #3 blue hovers: 1 problem
    const r = keepHelpfulEdits(b, [
      { op: 'move', index: 1, x: 5, y: 0, z: 1, rot: 0 },   // shoves a red brick off the plate: worse
      { op: 'move', index: 3, x: 0, y: 0, z: 4, rot: 0 },   // drops the blue onto the reds: fixed
    ], inv, 1);
    expect(r.rejected.map(e => e.index)).toEqual([1]);
    expect(validate(r.build, inv)).toEqual([]);
  });
});

describe('matchColors', () => {
  const row = (mid: string): Build => ({ name: '', description: '', steps: [
    { caption: '', parts: [
      { partId: 'brick-2x4-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: mid, x: 4, y: 0, z: 0, rot: 0 }, { partId: 'brick-2x4-red', x: 8, y: 0, z: 0, rot: 0 },
    ] },
    // top bricks at x 1–4 and 5–8, so the row stays locked together even if the middle brick is split at x=6
    { caption: '', parts: [{ partId: 'brick-2x4-red', x: 1, y: 0, z: 3, rot: 0 }, { partId: 'brick-2x4-red', x: 5, y: 0, z: 3, rot: 0 }] },
  ] });
  it('refuses a split that would break the only link (validated), and takes a safe one', () => {
    const inv = { 'brick-2x4-red': 4, 'brick-2x4-white': 1, 'brick-2x2-red': 2 };
    const unsafe = row('brick-2x4-white');
    unsafe.steps[1].parts = [{ partId: 'brick-2x4-red', x: 2, y: 0, z: 3, rot: 0 }, { partId: 'brick-2x4-red', x: 6, y: 0, z: 3, rot: 0 }];
    expect(matchColors(unsafe, inv, new Set()).matched).toBe(0);
  });
  it('uses two red 2x2s when there is no spare red 2x4', () => {
    const inv = { 'brick-2x4-red': 4, 'brick-2x4-white': 1, 'brick-2x2-red': 2 };
    const r = matchColors(row('brick-2x4-white'), inv, new Set());
    expect(r.matched).toBe(1);
    expect(r.build.steps[0].parts.map(p => p.partId)).toEqual(['brick-2x4-red', 'brick-2x2-red', 'brick-2x2-red', 'brick-2x4-red']);
    expect(validate(r.build, inv)).toEqual([]);
  });
  it('uses three stacked red plates for a brick', () => {
    const inv = { 'brick-2x4-red': 4, 'brick-2x4-white': 1, 'plate-2x4-red': 3 };
    const r = matchColors(row('brick-2x4-white'), inv, new Set());
    expect(r.build.steps[0].parts.filter(p => p.partId === 'plate-2x4-red').map(p => p.z)).toEqual([0, 1, 2]);
  });
  it('never touches a deliberate detail', () => {
    const inv = { 'brick-2x4-red': 5, 'brick-2x4-white': 1 };
    const b = row('brick-2x4-white');
    expect(matchColors(b, inv, new Set([placedKey(b.steps[0].parts[1])])).matched).toBe(0);
  });
});

describe('specialty parts', () => {
  const sinv = { 'brick-1x1-red': 4, 'arch-1x4-red': 1, 'plate-1x1-blue': 1, 'brick-1x2-blue': 1, 'invslope-2x2-red': 1, 'brick-2x2-red': 2, 'curve-2x2-red': 1, 'cheese-1x1-red': 1, 'roundbrick-1x1-yellow': 1 };
  const kinds = (b: Build) => validate(b, sinv).map(i => i.kind);
  const one = (...parts: Build['steps'][0]['parts']): Build => ({ name: '', description: '', steps: [{ caption: '', parts }] });

  it('an arch stands on its two ends and spans the gap', () => {
    expect(kinds(one(
      { partId: 'brick-1x1-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-1x1-red', x: 3, y: 0, z: 0, rot: 0 },
      { partId: 'arch-1x4-red', x: 0, y: 0, z: 3, rot: 0 },
    ))).toEqual([]);
  });
  it('the space under an arch is free, except its top plate', () => {
    const base = [{ partId: 'brick-1x1-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-1x1-red', x: 3, y: 0, z: 0, rot: 0 }, { partId: 'arch-1x4-red', x: 0, y: 0, z: 3, rot: 0 }];
    expect(kinds(one(...base, { partId: 'plate-1x1-blue', x: 1, y: 0, z: 3, rot: 0 }))).not.toContain('overlap'); // a plate tucks under the span
    expect(kinds(one(...base, { partId: 'brick-1x2-blue', x: 1, y: 0, z: 3, rot: 0 }))).toContain('overlap'); // a brick hits the top plate
  });
  it('an arch does not grip in the middle of its span', () => {
    expect(kinds(one({ partId: 'brick-1x2-blue', x: 1, y: 0, z: 0, rot: 0 }, { partId: 'arch-1x4-red', x: 0, y: 0, z: 3, rot: 0 }))).toContain('floating');
  });
  it('an inverted slope grips only on its narrow back row', () => {
    const k = parsePartId('invslope-2x2-red')!;
    expect(validate(one({ partId: 'brick-2x2-red', x: 0, y: 1, z: 0, rot: 0 }, { partId: 'invslope-2x2-red', x: 0, y: 0, z: 3, rot: 0 }), sinv)).toEqual([]);
    expect(kinds(one({ partId: 'brick-1x1-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'invslope-2x2-red', x: 0, y: 0, z: 3, rot: 0 }))).toContain('floating');
    expect(studCells(k, { partId: k.partId, x: 0, y: 0, z: 0, rot: 0 })).toHaveLength(4); // full studded top
  });
  it('curved and cheese slopes have no studs; round bricks do', () => {
    expect(kinds(one({ partId: 'curve-2x2-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-1x1-red', x: 0, y: 0, z: 2, rot: 0 }))).toContain('floating');
    expect(kinds(one({ partId: 'cheese-1x1-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-1x1-red', x: 0, y: 0, z: 2, rot: 0 }))).toContain('floating');
    expect(kinds(one({ partId: 'roundbrick-1x1-yellow', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-1x1-red', x: 0, y: 0, z: 3, rot: 0 }))).toEqual([]);
  });
  it('sizes normalize per family', () => {
    expect(normalizeSize('curve', '2x1')).toEqual({ w: 1, d: 2 });
    expect(normalizeSize('roundbrick', '2x2')).toEqual({ w: 2, d: 2 });
    expect(normalizeSize('cone', '1x2')).toBeNull();
    expect(parsePartId('roundplate-2x2-tan')).toMatchObject({ type: 'roundplate', w: 2, d: 2 });
  });
});

describe('corner (L) parts', () => {
  const INV2 = { 'cornerplate-2x2-red': 1, 'plate-1x1-red': 1, 'brick-1x1-red': 1 };
  const at = (rot: number) => ({ partId: 'cornerplate-2x2-red', x: 4, y: 4, z: 0, rot });
  const k = parsePartId('cornerplate-2x2-red')!;
  it('leave out one cell, turning with rot like everything else', () => {
    const missing = (rot: number) => [[4, 4], [5, 4], [4, 5], [5, 5]].find(([x, y]) => !cells(k, at(rot)).some(c => c[0] === x && c[1] === y));
    expect(missing(0)).toEqual([5, 5]); // back-right
    expect(missing(90)).toEqual([4, 5]); // back-left
    expect(missing(180)).toEqual([4, 4]); // front-left
    expect(missing(270)).toEqual([5, 4]); // front-right
    expect(cells(k, at(0))).toHaveLength(3);
    expect(studCells(k, at(0))).toHaveLength(3);
    expect(studCells(parsePartId('cornertile-2x2-red')!, at(0))).toHaveLength(0);
  });
  it('the empty cell holds nothing up, and something can fill it', () => {
    const b = (top: Placed): Build => ({ name: 'x', description: '', steps: [{ caption: '', parts: [at(0), top] }] });
    const floating = validate(b({ partId: 'plate-1x1-red', x: 5, y: 5, z: 1, rot: 0 }), INV2).map(i => i.kind);
    expect(floating).toContain('floating');
    const filler = validate(b({ partId: 'brick-1x1-red', x: 5, y: 5, z: 0, rot: 0 }), INV2).map(i => i.kind);
    expect(filler).not.toContain('overlap');
  });
});
