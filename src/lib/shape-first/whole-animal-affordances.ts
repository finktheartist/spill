import { parsePartId, type PartKind } from '../bricks';
import { frame } from '../connections';
import { animalEarSeeds, type AnimalEarSeed, type AnimalEarSeedSpec } from '../assembly-composer/animal-ear-seed';
import { wholeAnimalDesignStock } from './whole-animal-prompt';

export interface WholeAnimalEarRoleBounds {
  /** Absolute within the seed's normalized local frame. ALL axes in STUDS. */
  min: [number, number, number];
  max: [number, number, number];
  sizeStuds: [number, number, number];
}
export interface WholeAnimalEarAffordance extends AnimalEarSeed {
  spec: AnimalEarSeedSpec;
  roleBounds: Record<'head' | 'ear-left' | 'ear-right', WholeAnimalEarRoleBounds>;
  /** Invocation-time available counts, not quantities prepaid for a whole model. */
  available: Record<string, number>;
  availability: string;
}

const DARK = new Set(['black', 'dark-gray', 'dark-brown']);
const NATURAL = new Set(['reddish-brown', 'dark-brown', 'medium-nougat', 'nougat', 'orange', 'dark-orange', 'bright-light-orange', 'white', 'tan', 'dark-tan']);
const MAX_CHOICES = 12, MAX_SPECS = 64;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Available = { id: string; count: number; kind: PartKind };
const shape = (k: PartKind) => `${k.type}-${k.w}x${k.d}`;

/** One exact color ID per physical shape: prefer the deepest actual stock, then
 * a stable ID. Color substitutions cannot fill the bounded geometry menu. */
function representatives(parts: Available[]) {
  const groups = new Map<string, Available>();
  for (const p of parts) {
    const prior = groups.get(shape(p.kind));
    if (!prior || p.count > prior.count || p.count === prior.count && compare(p.id, prior.id) < 0) groups.set(shape(p.kind), p);
  }
  return [...groups.values()];
}
function physicalKey(seed: AnimalEarSeed) {
  return JSON.stringify(seed.parts.map(p => {
    const k = parsePartId(p.partId)!;
    // Ordinary rectangular carriers have identical solids and stud grids after
    // 180 degrees (squares after 90). Ears retain their directional profiles.
    const rot = p.role === 'head' ? k.w === k.d ? 0 : p.rot % 180 : p.rot;
    return [p.role, shape(k), p.x, p.y, p.z, rot];
  }));
}
function record(seed: AnimalEarSeed, spec: AnimalEarSeedSpec, ledger: Record<string, number>): WholeAnimalEarAffordance {
  const copy = structuredClone(seed), ff = copy.parts.map(p => frame({ ...p, z: p.z / .4 }));
  const roleBounds = Object.fromEntries(copy.parts.map((p, i) => {
    const min = ff[i].bounds.min.map(n => n / 20), max = ff[i].bounds.max.map(n => n / 20);
    return [p.role, { min, max, sizeStuds: max.map((n, a) => n - min[a]) }];
  })) as WholeAnimalEarAffordance['roleBounds'];
  const min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a]))), max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])));
  return { ...copy, spec: { ...spec }, roleBounds, sizeStuds: max.map((n, a) => (n - min[a]) / 20),
    available: Object.fromEntries(Object.keys(copy.cost).map(id => [id, ledger[id]])),
    availability: `${spec.leftId}: 2 of ${ledger[spec.leftId]}; ${spec.carrierId}: 1 of ${ledger[spec.carrierId]}. Independent three-piece option; no whole-model stock is reserved.` };
}

/** Preplanning vocabulary, never a whole head/body recipe or a stock reservation.
 * At most 64 exact specs are compiled and 12 distinct physical poses returned.
 * Only matched dark slope/cheese pairs and small natural rectangular studded
 * carriers are considered. Plates/bricks interleave so real height alternatives
 * survive the cap. Malformed ledgers throw as wholeAnimalStock does; valid scarce
 * or unsupported inventories return []. No input mutation or mutable cache.
 * Bounds describe nominal body solids; they promise no clutch/strength/craft. */
export function wholeAnimalEarAffordances(stock: Record<string, number>): WholeAnimalEarAffordance[] {
  const ledger = wholeAnimalDesignStock(stock);
  const parts = Object.entries(ledger).map(([id, count]) => ({ id, count, kind: parsePartId(id)! }));
  const ears = representatives(parts.filter(p => p.count >= 2 && DARK.has(p.kind.color) && ['slope', 'cheese'].includes(p.kind.type)))
    .sort((a, b) => a.kind.w * a.kind.d - b.kind.w * b.kind.d || b.count - a.count || compare(a.id, b.id));
  if (!ears.length) return [];
  const carriers = representatives(parts.filter(p => ['plate', 'brick'].includes(p.kind.type) && NATURAL.has(p.kind.color) && p.kind.w * p.kind.d <= 32 && Math.max(p.kind.w, p.kind.d) >= 2 && Math.max(p.kind.w, p.kind.d) <= 8));
  const priority = (p: Available) => Math.min(Math.abs(Math.max(p.kind.w, p.kind.d) - 3), Math.abs(Math.max(p.kind.w, p.kind.d) - 4));
  const sorted = (type: string) => carriers.filter(p => p.kind.type === type).sort((a, b) => priority(a) - priority(b) || a.kind.w * a.kind.d - b.kind.w * b.kind.d || b.count - a.count || compare(a.id, b.id));
  const plates = sorted('plate'), bricks = sorted('brick'), interleaved: Available[] = [];
  for (let i = 0; i < Math.max(plates.length, bricks.length); i++) { if (plates[i]) interleaved.push(plates[i]); if (bricks[i]) interleaved.push(bricks[i]); }
  const out: WholeAnimalEarAffordance[] = [], seen = new Set<string>();
  let specs = 0;
  for (const carrier of interleaved) for (const ear of ears) {
    if (specs++ >= MAX_SPECS) return out;
    const spec = { leftId: ear.id, rightId: ear.id, carrierId: carrier.id };
    for (const seed of animalEarSeeds(ledger, spec)) {
      const key = physicalKey(seed);
      if (seen.has(key)) continue;
      seen.add(key); out.push(record(seed, spec, ledger));
      if (out.length >= MAX_CHOICES) return out;
    }
  }
  return out;
}
