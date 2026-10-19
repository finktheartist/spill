// The workbench: building by hand on a 24×24 plate, with the builder suggesting moves. This file is the rules of
// placing a part (where it comes to rest, whether it's allowed) and turning the result into a booklet. The 3D
// view is bench-view.ts; the screen is screens/Workbench.tsx.
import { cells, footprint, heightOf, parsePartId, partCount, validRots, validate, type Build, type IssueKind, type PartKind, type PartType, type Placed } from './bricks';

/** How parts are grouped in the workbench tray and the parts catalog. */
export const FAMILIES: [string, PartType[]][] = [
  ['Bricks', ['brick']], ['Plates', ['plate', 'wedgeleft', 'wedgeright', 'quarterplate']], ['Tiles', ['tile']],
  ['Slopes & curves', ['slope', 'curve', 'invslope', 'cheese']], ['Round', ['roundbrick', 'roundplate', 'roundtile', 'cone']],
  ['More', ['arch', 'cornerplate', 'cornertile', 'cornerbrick', 'wheels', 'wheel']],
];

/** Studs each way, the same area the builder designs in (x and y 0–23). */
export const BENCH = 24;

export const emptyBench = (): Build => ({ name: 'My build', description: '', steps: [{ caption: 'Building', parts: [] }] });
export const allParts = (b: Build) => b.steps.flatMap(s => s.parts);

/** The rotations a part really has: plain bricks, plates and tiles look the same at 180°, so they take 0 and 90. */
export const rotsFor = (k: PartKind) => (validRots(k.type).length ? validRots(k.type) : [0]);
/** A rotation the part accepts: 180 → 0 and 270 → 90 for parts that only take 0 and 90. */
export const rotFor = (k: PartKind, rot: number) => (rotsFor(k).includes(rot) ? rot : rotsFor(k).includes(rot % 180) ? rot % 180 : rotsFor(k)[0]);

/** Which wall of a part the pointer is against: the new part goes on that side, flush with it. */
export interface Side { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }

/**
 * Where the part goes when the pointer is over cell (cx, cy), kept on the plate. Over a top (or the plate) it's
 * centred on the cell. Against a wall, its edge starts at that cell and it extends away from the wall.
 */
export function anchor(k: PartKind, rot: number, cx: number, cy: number, side?: Side) {
  const { fw, fd } = footprint(k, rot);
  const clamp = (v: number, size: number) => Math.max(0, Math.min(BENCH - size, v));
  const along = (c: number, size: number, d: number) => (d > 0 ? c : d < 0 ? c - size + 1 : c - Math.floor((size - 1) / 2));
  return { x: clamp(along(cx, fw, side?.dx ?? 0), fw), y: clamp(along(cy, fd, side?.dy ?? 0), fd) };
}

/** Where a part dropped at (x, y) comes to rest: on top of the tallest part under its footprint, or the plate. */
export function restZ(build: Build, k: PartKind, x: number, y: number, rot: number): number {
  const mine = new Set(cells(k, { partId: k.partId, x, y, z: 0, rot }).map(([a, b]) => `${a},${b}`));
  let z = 0;
  for (const p of allParts(build)) {
    const q = parsePartId(p.partId);
    if (q && cells(q, p).some(([a, b]) => mine.has(`${a},${b}`))) z = Math.max(z, p.z + heightOf(q));
  }
  return z;
}

/** Add a part at the end of the build (so whatever it rests on was placed before it). */
export const withPart = (b: Build, p: Placed): Build =>
  ({ ...b, steps: b.steps.map((s, i) => (i === b.steps.length - 1 ? { ...s, parts: [...s.parts, p] } : s)) });

export const withoutPart = (b: Build, index: number): Build => {
  let i = 0;
  return { ...b, steps: b.steps.map(s => ({ ...s, parts: s.parts.filter(() => i++ !== index) })) };
};

const BLOCKING: IssueKind[] = ['invalid', 'inventory', 'overlap', 'floating'];
const WHY: Partial<Record<IssueKind, string>> = {
  inventory: "you've used all of these", overlap: 'something is already there', floating: 'nothing under it to grip', invalid: "that doesn't fit",
};

/**
 * Try a part where the pointer is: it comes to rest on whatever is below. Blocked if it would overlap, float
 * (it sits on a tile, say), or use more than the pile has. Not touching the rest of the build is allowed: a
 * second base can be joined later.
 */
export function tryPlace(build: Build, have: Record<string, number>, k: PartKind, cx: number, cy: number, rotation: number, side?: Side) {
  if(build.engine==='connections-v2')throw Error('Use the connection trial to edit this assembly.');
  const rot = rotFor(k, rotation);
  const { x, y } = anchor(k, rot, cx, cy, side);
  const placed: Placed = { partId: k.partId, x, y, z: restZ(build, k, x, y, rot), rot };
  const next = withPart(build, placed);
  const all = validate(next, have).filter(i => i.parts.includes(placed));
  const mine = all.filter(i => BLOCKING.includes(i.kind));
  // issues: the checker's own words, for the sandbox's debug readout
  return { placed, next, ok: !mine.length, reason: mine.length ? WHY[mine[0].kind] : undefined, issues: all.map(i => `${i.kind}: ${i.message}`) };
}

/** Parts the checker is unhappy with right now, by number: floating, or not attached to the main build. */
export function warnings(build: Build, have: Record<string, number>): Map<number, IssueKind> {
  const index = new Map(allParts(build).map((p, i) => [p, i]));
  const out = new Map<number, IssueKind>();
  for (const issue of validate(build, have)) for (const p of issue.parts) { const i = index.get(p); if (i !== undefined && !out.has(i)) out.set(i, issue.kind); }
  return out;
}

/** The finished build as a booklet: bottom up, a layer of brick height per page, at most 8 parts a step. */
export function toBooklet(build: Build, name: string): Build {
  if(build.engine==='connections-v2')return {...build,name:name||build.name};
  const parts = [...allParts(build)].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const steps: Build['steps'] = [];
  let layer = -1;
  for (const p of parts) {
    const l = Math.floor(p.z / 3);
    const cur = steps[steps.length - 1];
    if (l !== layer || !cur || cur.parts.length >= 8) { steps.push({ caption: `Layer ${l + 1}`, parts: [] }); layer = l; }
    steps[steps.length - 1].parts.push(p);
  }
  return { name: name || 'My build', description: `${partCount(build)} parts, built by hand`, steps };
}
