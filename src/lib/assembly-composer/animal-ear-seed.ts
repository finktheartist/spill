import { parsePartId, type Placed } from '../bricks';
import { isMade, isRealSize } from '../catalog';
import { attachmentTwist, axisAngle, compileConnections, connectionPairs, definition, frame, solidContains, straightProfile, type ConnectionOperation } from '../connections';
import type { WholeAnimalPart, WholeAnimalRole } from './animal-whole';

export interface AnimalEarSeedSpec { leftId: string; rightId: string; carrierId: string }
export interface AnimalEarSeed {
  id: string; rootRotation: 0 | 90 | 180 | 270;
  operations: (ConnectionOperation & { role: WholeAnimalRole })[];
  /** Three exact local poses; x/y minima and z bottom are zero. ALL in studs. */
  parts: WholeAnimalPart[];
  cost: Record<string, number>; sizeStuds: number[];
}

const ROTS = [0, 90, 180, 270] as const, EPS = 1e-5;
const costs = (ids: string[]) => {
  const cost: Record<string, number> = {};
  for (const id of ids) cost[id] = (cost[id] ?? 0) + 1;
  return cost;
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function key(spec: AnimalEarSeedSpec, rot: number) {
  // Two bounded deterministic hash lanes keep the ID short for downstream
  // menus. Geometry/stock always use the full IDs, never this metadata key.
  const text = JSON.stringify([spec.carrierId, spec.leftId, spec.rightId, rot]);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 2246822519); }
  return `animal-ear-seed:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:r${rot}`;
}
function samePoses(actual: Placed[], desired: Placed[]) {
  const aa = actual.map(frame), dd = desired.map(frame), delta = aa[0].translation.map((n, a) => n - dd[0].translation[a]);
  return aa.every((f, i) => actual[i].partId === desired[i].partId && f.rotation.every((n, a) => Math.abs(n - dd[i].rotation[a]) < EPS) &&
    f.translation.every((n, a) => Math.abs(n - dd[i].translation[a] - delta[a]) < EPS));
}
/** Straight convex profiles only. The 12×12 common high cross-section uses
 * conservative occupied-cell edges to measure a >=.25-stud exposed tip gap.
 * This motif has no curve mask, cosmetic seam, strength or visual-grade claim. */
function separatedPeaks(parts: Placed[]) {
  const ff = parts.map(frame), left = ff[1], right = ff[2];
  const z = Math.min(left.bounds.max[2], right.bounds.max[2]) - .15 * (left.bounds.max[2] - left.bounds.min[2]);
  const spans = [left, right].map(f => {
    const xs: number[] = [], step = (f.bounds.max[0] - f.bounds.min[0]) / 12;
    let lower = 0, upper = 0;
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) {
      const px = f.bounds.min[0] + step * (x + .5), py = f.bounds.min[1] + (f.bounds.max[1] - f.bounds.min[1]) * (y + .5) / 12;
      if (f.solids.some(s => solidContains(s, [px, py, f.bounds.min[2] + .2 * (f.bounds.max[2] - f.bounds.min[2])]))) lower++;
      if (f.solids.some(s => solidContains(s, [px, py, z]))) { upper++; xs.push(x); }
    }
    return upper && lower && upper <= lower * .8 ? { min: f.bounds.min[0] + Math.min(...xs) * step, max: f.bounds.min[0] + (Math.max(...xs) + 1) * step } : undefined;
  });
  if (!spans[0] || !spans[1] || spans[1].min - spans[0].max < .25 * 20 - EPS) return false;
  const width = spans[1].min - spans[0].max, minY = Math.min(left.bounds.min[1], right.bounds.min[1]), maxY = Math.max(left.bounds.max[1], right.bounds.max[1]);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 12; y++) {
    const point: [number, number, number] = [spans[0].max + width * (x + .5) / 3, minY + (maxY - minY) * (y + .5) / 12, z];
    if (ff.some(f => f.solids.some(s => solidContains(s, point)))) return false;
  }
  return true;
}

/** Exactly one studded head carrier plus two matched slope/cheese ears.
 * Four carrier quarter turns, at most four depth alignments each. Every target
 * pose must infer real ports/twists and independently compile against ONE cost.
 * Cantilevering on one real row is permitted by the unchanged nominal engine;
 * it is not a strength claim. No whole head, body, face or runtime template.
 * Malformed, unsupported, scarce and non-fitting inputs return an empty list.
 */
export function animalEarSeeds(stock: Record<string, number>, spec: AnimalEarSeedSpec): AnimalEarSeed[] {
  try {
    if (!stock || typeof stock !== 'object' || Array.isArray(stock) || !spec || typeof spec !== 'object') return [];
    const entries = Object.entries(stock), ids = [spec.carrierId, spec.leftId, spec.rightId];
    if (entries.length > 1024 || entries.some(([id, n]) => id.length > 80 || !Number.isSafeInteger(n) || n < 0) || ids.some(id => typeof id !== 'string' || !id || id.length > 80 || !isMade(id))) return [];
    const ledger = Object.fromEntries(entries), cost = costs(ids), [carrier, left, right] = ids.map(parsePartId);
    if (!carrier || !left || !right || ids.some(id => !Object.hasOwn(ledger, id)) || Object.entries(cost).some(([id, n]) => ledger[id] < n)) return [];
    if (![carrier, left, right].every(k => isRealSize(k.type, k.w, k.d)) || !['slope', 'cheese'].includes(left.type) || right.type !== left.type || left.w !== right.w || left.d !== right.d || !straightProfile(left) || !straightProfile(right)) return [];
    const defs = [carrier, left, right].map(definition);
    // Bound geometry/port work before the finite target enumeration. These
    // generous ceilings include ordinary 16×16 carriers and all small ears.
    if (defs[0].ports.length > 512 || defs.slice(1).some(d => d.ports.length > 128) || defs.slice(1).some(d => !d.convex?.length)) return [];
    const result: AnimalEarSeed[] = [];
    for (const rootRotation of ROTS) {
      const root: Placed = { partId: spec.carrierId, x: 0, y: 0, z: 0, rot: rootRotation }, cf = frame(root);
      const top = cf.ports.filter(p => p.kind === 'stud' && p.normal[2] === 1 && Math.abs(p.point[2] - cf.bounds.max[2]) < EPS);
      if (!top.length) continue;
      const probe = frame({ partId: spec.leftId, x: 0, y: 0, z: 0, rot: 90 });
      const w = (cf.bounds.max[0] - cf.bounds.min[0]) / 20, d = (cf.bounds.max[1] - cf.bounds.min[1]) / 20;
      const ew = (probe.bounds.max[0] - probe.bounds.min[0]) / 20, ed = (probe.bounds.max[1] - probe.bounds.min[1]) / 20;
      const lx = w >= 2 * ew ? 0 : -Math.ceil(ew - w / 2), rx = w - ew - lx;
      const centerY = (d - ed) / 2, yy = [...new Set([Math.floor(centerY), Math.ceil(centerY), 0, Math.max(0, d - ed)])].sort((a, b) => Math.abs(a - centerY) - Math.abs(b - centerY) || b - a);
      for (const y of yy) {
        const raw: Placed[] = [root, { partId: spec.leftId, x: lx, y, z: cf.bounds.max[2] / 8, rot: 90 }, { partId: spec.rightId, x: rx, y, z: cf.bounds.max[2] / 8, rot: 270 }];
        if (Math.max(...raw.map(p => Math.abs(p.x)), Math.abs(y)) > 24 || !separatedPeaks(raw)) continue;
        const operations: AnimalEarSeed['operations'] = [{ partId: spec.carrierId, role: 'head', parent: -1, parentPort: '', childPort: '', twist: 0 }];
        for (const [i, child] of raw.entries()) if (i) {
          for (const [parentPort, childPort] of connectionPairs(cf, frame(child))) {
            if (!top.some(p => p.id === parentPort)) continue;
            const twist = attachmentTwist(root, parentPort, child, childPort);
            if (twist === null) continue;
            operations.push({ partId: child.partId, role: i === 1 ? 'ear-left' : 'ear-right', parent: 0, parentPort, childPort, twist }); break;
          }
        }
        if (operations.length !== 3) continue;
        try {
          const program = { name: 'Paired alert ear motif', description: 'Three-piece stock-bound component vocabulary, not a complete head or animal.', rootRotation, operations };
          const compiled = compileConnections(program, cost), actual = compiled.steps.flatMap(s => s.parts), ff = actual.map(frame);
          if (!samePoses(actual, raw) || !separatedPeaks(actual)) continue;
          const min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a]))), max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])));
          const sizeStuds = max.map((n, a) => (n - min[a]) / 20);
          if (sizeStuds.some(n => !Number.isFinite(n) || n > 24 + EPS)) continue;
          const parts: WholeAnimalPart[] = actual.map((p, i) => {
            const rot = ROTS.find(rot => ff[i].rotation.every((n, a) => n === axisAngle([0, 0, 1], rot)[a]));
            if (rot === undefined) throw Error('Nonupright ear seed.');
            return { partId: p.partId, role: operations[i].role, x: (ff[i].bounds.min[0] - min[0]) / 20, y: (ff[i].bounds.min[1] - min[1]) / 20, z: (ff[i].bounds.min[2] - min[2]) / 20, rot };
          });
          result.push(freeze({ id: key(spec, rootRotation), rootRotation, operations, parts, cost: { ...cost }, sizeStuds }));
          break;
        } catch { /* A real row still has to survive shared stock/collision checks. */ }
      }
    }
    return result;
  } catch { return []; }
}
