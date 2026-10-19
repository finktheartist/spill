import {ALL_MOLDS as POPULAR_MOLDS,popularMold} from '../popular-molds';
import { CATALOG, COLORS, footprint, heightOf, parsePartId, type ColorName, type PartKind, type PartType, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { definition, frame, solidContains, type Frame, type V3 } from '../connections';
import { curvedContains } from '../curved-parts';
import type { AssemblyComposition } from './types';

export const SPECIAL_PART_TYPES = [...POPULAR_MOLDS.map(m=>m.type),'halftile','quarterroundtile','offsetplate','roundjumper','triangletile','headlight','invertedbracket','endstudplate', 'edgeplate', 'quartertile', 'slope', 'curve', 'invslope', 'cheese', 'cornerplate', 'cornertile', 'cornerbrick',
  'roundbrick', 'roundplate', 'roundtile', 'roundendplate', 'cone', 'arch', 'jumper', 'sidebrick', 'sidebricktall',
  'sidebrickadjacent', 'sidebrickall', 'bracket', 'wedgeleft', 'wedgeright', 'quarterplate'] as const;
export type SpecialShapeRole = 'face' | 'cheeks' | 'chest' | 'belly' | 'tail' | 'ears' | 'feet' | 'carrier' | 'centering';
export interface SpecialPartPort {
  id: string;
  kind: 'stud' | 'grip';
  pointStuds: V3;
  normal: V3;
}
export interface SpecialPartCapability {
  id: string;
  rawCount: unknown;
  count: number | null;
  /** Identical inventory pairs only; not proof of a legal mirrored placement. */
  pairedCount: number;
  type: PartType | null;
  color: ColorName | null;
  status: 'usable' | 'unsupported' | 'malformed';
  issues: string[];
  sizeStuds: V3 | null;
  /** Potential anatomical uses, separate from an independently compiled recipe. */
  shapeRoles: SpecialShapeRole[];
  ports: SpecialPartPort[];
  connectorConstraints: string[];
  allocationGuidance: string[];
  conservativeCollisionBounds: boolean;
}
export type SpecialContourView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export interface SpecialRoleUsage {
  role: string;
  partCount: number;
  specialPartCount: number;
  partIds: Record<string, number>;
  /** Sampled nominal envelope cells removed by the actual contour. */
  removedContourCells: number;
  /** Distinct projected cells that filling this role's contours would expose. */
  estimatedExposedContourCells: Record<SpecialContourView, number>;
}
export interface SpecialPartUsageReport {
  partCount: number;
  specialPartCount: number;
  used: { id: string; type: PartType; count: number; remaining: number | null; roles: string[] }[];
  roles: SpecialRoleUsage[];
  sampleResolutionStuds: V3;
  caveats: string[];
}

const SPECIAL = new Set<PartType>(SPECIAL_PART_TYPES);
const SNOT = new Set<PartType>(['headlight','invertedbracket','sidebrick', 'sidebricktall', 'sidebrickadjacent', 'sidebrickall', 'bracket']);
const ROUND = new Set<PartType>(['roundbrick', 'roundplate', 'roundtile', 'cone']);
const MASKED = new Set<PartType>([...ROUND, 'curve', 'roundendplate']);
const CONSERVATIVE = new Set<PartType>([...MASKED, 'arch']);
const EPS = 1e-6, CELL: V3 = [5, 5, 4], MAX_PARTS = 160, MAX_SPAN = 24 * 20, MAX_WORK = 2_000_000;

function potentialRoles(type: PartType): SpecialShapeRole[] {
  if(type==='offsetplate'||type==='roundjumper')return ['centering','face','carrier'];
  if(['halftile','quarterroundtile','triangletile'].includes(type))return ['cheeks','face','chest','tail','ears'];
  if(type==='endstudplate'||type==='edgeplate')return ['carrier','face','chest'];
  if(type==='quartertile')return ['cheeks','chest','tail','face'];
  if (type === 'slope' || type === 'curve' || type === 'cheese') return ['face', 'cheeks', 'chest', 'tail', 'ears'];
  if (type === 'invslope') return ['cheeks', 'belly', 'chest', 'tail'];
  if (type.startsWith('corner') || type === 'quarterplate') return ['cheeks', 'chest', 'belly', 'carrier'];
  if (ROUND.has(type)) return ['ears', 'feet', 'face', 'tail'];
  if (type === 'roundendplate') return ['cheeks', 'belly', 'ears', 'feet', 'carrier'];
  if (type === 'jumper') return ['centering', 'face', 'carrier'];
  if (SNOT.has(type)) return ['face', 'cheeks', 'chest', 'carrier'];
  if (type === 'arch') return ['belly', 'carrier'];
  return ['cheeks', 'chest', 'tail'];
}

function constraints(k: PartKind): string[] {
  const exact=popularMold(k);
  if(exact)return [`Exact mold #${exact.num}; use connections-v2 and only the listed real stud/socket planes.`,...exact.limitations];
  const out = ['Use only the listed existing stud/grip ports; each port can mate to one other part.'];
  if(k.type==='headlight')out.push('4070 has a recessed front stud at local y4,z14 LDU, a top stud at z24 and one bottom socket. It is not an 87087 sidebrick. Use connections-v2; no rear-hole or bore connection is qualified.');
  if(k.type==='invertedbracket')out.push('99780 has a 40 x 24 x 20 LDU nominal body, top studs at z8 and front studs at z10. It is not the 99781 down bracket. Use connections-v2 and the actual per-port planes.');
  if(k.type==='offsetplate')out.push('34103 top studs are half-stud-offset at x20 and 40 LDU; bottom grips are at x10,30,50. Use connections-v2 without rounding or inventing a third top stud.');
  if(k.type==='roundjumper')out.push('18674 has one open centered top stud and four qualified underside sockets. Use connections-v2. The open bore supplies no extra bar/pin port.');
  if(k.type==='halftile'||k.type==='quarterroundtile')out.push('The exact curved outline carries no top studs and only the listed underside socket; absent corners supply no attachment.');
  if(k.type==='triangletile')out.push('35787 retains its clipped triangular body inside a nominal 2 x 2 rotation envelope. Only one underside socket is qualified; the diagonal and truncated tube supply no additional grip.');
  if(k.type==='endstudplate')out.push('92593 has top studs only at the two ends. The smooth middle has no attachment; this is not a centered jumper or a 41740 mold alias.');
  if(k.type==='edgeplate')out.push('33909 has two top studs only on the rear +y edge at rot 0. The smooth front row has no attachment.');
  if(k.type==='quartertile')out.push('27925 is a smooth quarter-ring, with a real cutout and two diagonal underside sockets. Neither the cutout nor the top carries a port.');
  if (k.type === 'slope') out.push('Top studs exist only on the high rear row (+y in the unrotated local frame); the sloping face has no ports.');
  if (k.type === 'invslope') out.push('Underside grips exist only on the high rear row; the low overhanging lip cannot anchor a module.');
  if (k.type === 'curve' || k.type === 'cheese') out.push('There are underside grips but no top studs; use a real carrier for anything above this contour.');
  if (k.type === 'curve') out.push('The back grip row is one plate above the lowest sockets. Use the listed per-port height, not a flat underside assumption.');
  if (k.type.startsWith('corner') || k.type === 'quarterplate' || k.type.startsWith('wedge')) out.push('Ports and occupied cells follow the actual outline; absent corner/edge cells provide no attachment.');
  if (k.type === 'jumper') out.push('One centered top stud replaces the ordinary grid; the underside remains the listed grid of grips.');
  if (SNOT.has(k.type)) out.push('Side-stud ports permit a static rotated attachment only when the exact child grip, twist and full clearance compile legally.');
  if (k.type === 'arch') out.push('Underside grips exist only at the ends; the connection engine retains a conservative full collision envelope, so a free belly opening is not certified.');
  if (CONSERVATIVE.has(k.type)) out.push('Conservative nominal collision bounds do not measure actual visual benefit, clutch strength or articulated motion.');
  return out;
}

/** Inventory inspection is not assembly feasibility. Invalid/raw specialist IDs
 * remain in the report, with no potential-use or connector claims. */
export function inspectSpecialParts(stock: Record<string, number>): SpecialPartCapability[] {
  if (!stock || typeof stock !== 'object' || Array.isArray(stock)) return [];
  return Object.entries(stock).sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, rawCount]) => {
    const k = parsePartId(id), count = Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : null;
    const hint = id.split('-')[0] as PartType;
    const shapeKnown = !!k && k.type !== 'wheels' && !!CATALOG[k.type]?.includes(`${k.w}x${k.d}`);
    const made = shapeKnown && isMade(id);
    if (count !== null && k && shapeKnown && made && !SPECIAL.has(k.type)) return [];
    if (count === 0 && made) return [];
    const issues = count === null ? ['Count must be a nonnegative safe integer; the raw value is retained.'] : [];
    const unknownCurve=/^curve-\d+x\d+-([a-z-]+)$/.exec(id);
    const unsupportedCurve=!!unknownCurve&&Object.hasOwn(COLORS,unknownCurve[1]);
    if (!k) issues.push(unsupportedCurve?'Curve mold size is outside the qualified catalog; no usable geometry is asserted.':'Malformed or unknown part ID; no usable geometry is asserted.');
    else if (!shapeKnown) issues.push('Part size/type is outside the connection catalog.');
    else if (!made) issues.push('This exact part/color ID is not in the manufactured-part catalog.');
    const status = (!k&&!unsupportedCurve) || count === null ? 'malformed' : !made ? 'unsupported' : 'usable';
    const usable = status === 'usable', d = usable ? definition(k!) : null;
    const min = d && [0, 1, 2].map(a => Math.min(...d.boxes.map(b => b.min[a])));
    const max = d && [0, 1, 2].map(a => Math.max(...d.boxes.map(b => b.max[a])));
    const guidance = usable ? ['Reserve exact IDs across all anatomical modules in the shared stock ledger.'] : [];
    if (usable && count! < 2) guidance.push('Singleton: prefer a centered contour or one purposeful transition; do not promise an identical symmetric pair.');
    if (usable && count! >= 2) guidance.push('Reserve two actual copies before selecting paired cheeks, shoulders or ears; port/clearance checks still decide legality.');
    if (usable && k!.type === 'curve') guidance.push('Face, shoulder and tail contours compete for these same copies; spending both on a tail leaves none for a paired head contour.');
    if (usable && k!.type === 'invslope') guidance.push('Place the high-row grip on a real carrier, with its low lip exposed for a cheek, belly or tail transition.');
    if (usable && k!.type === 'jumper') guidance.push('The actual center port can center an odd-width face on an even grid; reserve paired carriers only if the full face recipe compiles.');
    return [{ id, rawCount, count, pairedCount: count === null ? 0 : Math.floor(count / 2),
      type: k?.type ?? (SPECIAL.has(hint) ? hint : null), color: k?.color ?? null, status, issues,
      sizeStuds: min && max ? max.map((n, a) => (n - min[a]) / 20) as V3 : null,
      shapeRoles: usable ? potentialRoles(k!.type) : [],
      ports: d ? d.ports.map(p => ({ id: p.id, kind: p.kind, pointStuds: p.point.map(n => n / 20) as V3, normal: [...p.normal] as V3 })) : [],
      connectorConstraints: usable ? constraints(k!) : [], allocationGuidance: guidance,
      conservativeCollisionBounds: usable && (k!.type.startsWith('mold')||CONSERVATIVE.has(k!.type)||k!.type==='headlight'||k!.type==='invertedbracket') } satisfies SpecialPartCapability];
  });
}

type Body = { kind: PartKind; f: Frame; localMin: V3; localMax: V3; role: string; special: boolean };
const within = (p: V3, min: V3, max: V3) => p.every((n, a) => n >= min[a] - EPS && n <= max[a] + EPS);
function localPoint(body: Body, point: V3): V3 {
  const r = body.f.rotation, p = point.map((n, a) => n - body.f.translation[a]);
  return [r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[2] * p[0] + r[5] * p[1] + r[8] * p[2]];
}

/** Shared curved outlines and nominal circular presentation masks, excluding
 * cosmetic gaps, studs and socket cavities. This is an estimated metric. */
function visualMask(body: Body, [x, y, z]: V3): boolean {
  const k = body.kind, { fw, fd } = footprint(k, 0), w = fw * 20, d = fd * 20, h = heightOf(k) * 8;
  if (k.type === 'curve') {
    return curvedContains(k,[x,y,z]);
  }
  const dx = x - w / 2, dy = y - d / 2;
  if (k.type === 'roundendplate') {
    const closestX = Math.max(-10, Math.min(10, dx));
    return (dx - closestX) ** 2 + dy ** 2 <= (Math.min(w, d) / 2) ** 2 + EPS;
  }
  const base = Math.min(w, d) / 2;
  const radius = k.type === 'cone' ? base + (6 - base) * Math.max(0, Math.min(1, z / h)) : base;
  return dx * dx + dy * dy <= radius * radius + EPS;
}

/** Count actual per-role inventory and estimate cardinal contour exposure. A
 * "change" is a projected sample that filling this role's nominal contours to
 * rectangular envelopes would add to the visible silhouette. Occluded contours
 * contribute zero. This is neither a build validator nor a visual craft score. */
export function specialPartUsage(composition: AssemblyComposition): SpecialPartUsageReport {
  if (!composition?.build || !Array.isArray(composition.build.steps) || !Array.isArray(composition.receipts)) throw Error('Usage requires a complete composition.');
  if (composition.build.steps.length > MAX_PARTS || composition.receipts.length > 32) throw Error('Special-part usage exceeds the composition bound.');
  const parts: Placed[] = [];
  for (const step of composition.build.steps) {
    if (!step || !Array.isArray(step.parts) || parts.length + step.parts.length > MAX_PARTS) throw Error('Special-part usage is limited to 160 parts.');
    parts.push(...step.parts);
  }
  if (!parts.length) throw Error('Usage requires actual parts.');
  const owner = new Map<number, string>(), roles = new Map<string, SpecialRoleUsage>();
  const views = (): Record<SpecialContourView, number> => ({ front: 0, back: 0, left: 0, right: 0, top: 0, bottom: 0 });
  for (const receipt of composition.receipts) {
    if (!receipt || typeof receipt.role !== 'string' || !receipt.role || roles.has(receipt.role) || !Array.isArray(receipt.indices) || !receipt.indices.length) throw Error('Usage needs unique nonempty anatomical receipts.');
    const ids: Record<string, number> = {};
    for (const i of receipt.indices) {
      if (!Number.isSafeInteger(i) || i < 0 || i >= parts.length || owner.has(i)) throw Error('Receipts must own each actual part exactly once.');
      owner.set(i, receipt.role);ids[parts[i].partId] = (ids[parts[i].partId] ?? 0) + 1;
    }
    roles.set(receipt.role, { role: receipt.role, partCount: receipt.indices.length, specialPartCount: 0, partIds: ids, removedContourCells: 0, estimatedExposedContourCells: views() });
  }
  if (owner.size !== parts.length) throw Error('Receipts must own each actual part exactly once.');
  const bodies: Body[] = parts.map((p, i) => {
    const k = parsePartId(p.partId);
    if (!k || !isMade(p.partId) || k.type === 'wheel' || k.type === 'wheels') throw Error('Usage encountered an unsupported actual part.');
    const f = frame(p), d = definition(k), localMin = [0, 1, 2].map(a => Math.min(...d.boxes.map(b => b.min[a]))) as V3;
    const localMax = [0, 1, 2].map(a => Math.max(...d.boxes.map(b => b.max[a]))) as V3;
    return { kind: k, f, localMin, localMax, role: owner.get(i)!, special: SPECIAL.has(k.type) };
  });
  const min = [0, 1, 2].map(a => Math.min(...bodies.map(b => b.f.bounds.min[a]))) as V3;
  const span = [0, 1, 2].map(a => Math.max(...bodies.map(b => b.f.bounds.max[a])) - min[a]);
  if (span.some(n => !Number.isFinite(n) || n <= 0 || n > MAX_SPAN + EPS)) throw Error('Usage bounds must be finite and at most 24 studs per axis.');
  const [nx, ny, nz] = span.map((n, a) => Math.ceil((n - EPS) / CELL[a]));
  let work = 0;
  const ranges = bodies.map(b => {
    const lo = [0, 1, 2].map(a => Math.max(0, Math.ceil((b.f.bounds.min[a] - min[a]) / CELL[a] - .5 - EPS)));
    const hi = [0, 1, 2].map(a => Math.min([nx, ny, nz][a] - 1, Math.floor((b.f.bounds.max[a] - min[a]) / CELL[a] - .5 + EPS)));
    work += lo.reduce((n, v, a) => n * Math.max(0, hi[a] - v + 1), 1);
    if (work > MAX_WORK) throw Error('Special-part contour sampling budget exceeded.');
    return { lo, hi };
  });
  const occupied = new Set<number>(), missing = new Map<string, Set<number>>();
  const usage = new Map<string, SpecialPartUsageReport['used'][number]>();
  bodies.forEach((b, i) => {
    if (b.special) {
      roles.get(b.role)!.specialPartCount++;
      let item = usage.get(b.kind.partId);
      if (!item) { const remaining = composition.remaining?.[b.kind.partId];item = { id: b.kind.partId, type: b.kind.type, count: 0, remaining: Number.isSafeInteger(remaining) && remaining >= 0 ? remaining : null, roles: [] };usage.set(b.kind.partId, item); }
      item.count++;if (!item.roles.includes(b.role)) item.roles.push(b.role);
    }
    const { lo, hi } = ranges[i];
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const point = [x, y, z].map((v, a) => min[a] + (v + .5) * CELL[a]) as V3, local = localPoint(b, point);
      const fullEnvelope = within(local, b.localMin, b.localMax);
      const inside = b.f.solids.some(s => within(point, s.bounds.min, s.bounds.max) && solidContains(s, point)) && (!MASKED.has(b.kind.type) || visualMask(b, local));
      const key = (z * ny + y) * nx + x;
      if (inside) occupied.add(key);
      else if (b.special && fullEnvelope) { let cells = missing.get(b.role);if (!cells) { cells = new Set();missing.set(b.role, cells); }cells.add(key); }
    }
  });
  const columns = { x: new Map<number, [number, number]>(), y: new Map<number, [number, number]>(), z: new Map<number, [number, number]>() };
  const decode = (key: number) => [key % nx, Math.floor(key / nx) % ny, Math.floor(key / (nx * ny))];
  const extend = (map: Map<number, [number, number]>, key: number, value: number) => { const prior = map.get(key);map.set(key, prior ? [Math.min(prior[0], value), Math.max(prior[1], value)] : [value, value]); };
  for (const key of occupied) { const [x, y, z] = decode(key);extend(columns.x, z * ny + y, x);extend(columns.y, z * nx + x, y);extend(columns.z, y * nx + x, z); }
  for (const [role, rawMissing] of missing) {
    const projected = Object.fromEntries(Object.keys(views()).map(v => [v, new Set<number>()])) as Record<SpecialContourView, Set<number>>;
    for (const key of rawMissing) {
      if (occupied.has(key)) continue;
      roles.get(role)!.removedContourCells++;
      const [x, y, z] = decode(key), xKey = z * ny + y, yKey = z * nx + x, zKey = y * nx + x;
      const xx = columns.x.get(xKey), yy = columns.y.get(yKey), zz = columns.z.get(zKey);
      if (!xx || x < xx[0]) projected.left.add(xKey);
      if (!xx || x > xx[1]) projected.right.add(xKey);
      if (!yy || y < yy[0]) projected.front.add(yKey);
      if (!yy || y > yy[1]) projected.back.add(yKey);
      if (!zz || z > zz[1]) projected.top.add(zKey);
      if (!zz || z < zz[0]) projected.bottom.add(zKey);
    }
    roles.get(role)!.estimatedExposedContourCells = Object.fromEntries(Object.entries(projected).map(([view, cells]) => [view, cells.size])) as Record<SpecialContourView, number>;
  }
  return { partCount: parts.length, specialPartCount: [...usage.values()].reduce((n, p) => n + p.count, 0),
    used: [...usage.values()].sort((a, b) => a.id.localeCompare(b.id)), roles: [...roles.values()],
    sampleResolutionStuds: CELL.map(n => n / 20) as V3,
    caveats: ['Shape roles and inventory pairs describe potential uses, not verified module placement.',
      'Contour exposure is a bounded nominal sampling estimate in six cardinal views, not rendered recognition, visual benefit or an automatic craft score.',
      'Curves share measured source-facet outlines and stepped sockets; circular masks remain visual approximations. Neither outer profiles nor conservative internal cavities measure clutch strength.',
      'Studs, sockets and cosmetic seams are excluded; arches retain the conservative engine envelope. Full composition legality must be checked separately.'] };
}
