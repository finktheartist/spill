import { parsePartId, type Build, type ColorName, type Placed } from './bricks';
import { isMade } from './catalog';
import { attachmentTwist, compileConnections, connectionPairs, definition, frame, type ConnectionOperation, type ConnectionProgram } from './connections';
import { constructionIssues } from './construction';
import { packRegion, type PackingRegion } from './robot-module-layout';

/** A deliberately small architectural grammar, developed against the photo pile.
 * Its open space and stepped roof are geometry, not hints in a model prompt.
 * No saved inventory or finished build is imported into this compiler. */
export interface PavilionSpec { roof: 'hipped' | 'gable'; height: 9 | 12; eaves: 'plain' | 'raised' }
export type PavilionModule = 'terrace' | 'frame' | 'roof' | 'seating';
interface Region extends PackingRegion { id: string; module: PavilionModule; label: string; x: number; y: number; z: number; palette: ColorName[]; pair?: string }
interface Void { label: string; x: number; y: number; z: number; w: number; d: number; h: number }
export interface PavilionTarget { spec: PavilionSpec; regions: Region[]; voids: Void[] }
export interface PavilionCandidate { id: string; target: PavilionTarget; build: Build; program: ConnectionProgram; assignment: string[]; parts: Record<string, number>; remaining: Record<string, number> }
export interface PavilionAllocation { candidates: PavilionCandidate[]; diagnostics: string[] }
const wood: ColorName[] = ['reddish-brown'];
const stone: ColorName[] = ['light-gray'];
const count = (parts: Placed[]) => { const result: Record<string, number> = {}; for (const p of parts) result[p.partId] = (result[p.partId] ?? 0) + 1; return result; };
export const pavilionRequest = (name: string) => /\b(pavilion|gazebo|picnic shelter|lookout shelter)\b/i.test(name);

export function pavilionSpec(input: unknown): PavilionSpec {
  const s = input as PavilionSpec;
  if (!s || !['hipped', 'gable'].includes(s.roof) || ![9, 12].includes(s.height) || !['plain', 'raised'].includes(s.eaves)) throw Error('Choose a checked pavilion roof, height and eave profile.');
  return { roof: s.roof, height: s.height, eaves: s.eaves };
}

/** Modules expose actual geometry and attachment heights. Other architectural
 * grammars can reuse them; this release composes them into one pavilion family. */
export function terraceModule(): Region[] {
  return [
    r('ground', 'terrace', 'One foundation plate under the terrace and approach', 2, 0, 0, 6, 10, 1, ['plate'], ['black']),
    r('front-left', 'terrace', 'Stone pier at the front', 2, 3, 1, 2, 2, 3, ['brick'], stone),
    r('front-right', 'terrace', 'Stone pier at the front', 6, 3, 1, 2, 2, 3, ['brick'], stone),
    r('rear-left', 'terrace', 'Continuous stone side foundation', 2, 5, 1, 2, 4, 3, ['brick'], stone, 'rear-piers'),
    r('rear-right', 'terrace', 'Continuous stone side foundation', 6, 5, 1, 2, 4, 3, ['brick'], stone, 'rear-piers'),
    r('front-center', 'terrace', 'Stone support behind the entrance steps', 4, 3, 1, 2, 4, 3, ['brick'], stone),
    r('rear-center', 'terrace', 'Stone support at the rear', 4, 7, 1, 2, 2, 3, ['plate'], stone),
    r('floor', 'terrace', 'Broad terrace with a one-stud side overhang', 1, 3, 4, 8, 6, 1, ['plate'], ['tan']),
    r('step-low', 'terrace', 'Wide bottom entrance step', 3, 1, 1, 4, 2, 1, ['plate'], ['tan']),
    r('step-middle', 'terrace', 'Narrower second step', 3, 2, 2, 4, 1, 1, ['plate'], ['tan']),
    r('step-high', 'terrace', 'Top step meets the terrace', 4, 2, 3, 2, 1, 1, ['plate'], ['tan']),
    r('threshold', 'terrace', 'Smooth six-stud-wide entrance', 2, 3, 5, 6, 1, 1, ['tile'], ['tan']),
  ];
}
function r(id: string, module: PavilionModule, label: string, x: number, y: number, z: number, w: number, d: number, h: number, types: Region['types'], palette: ColorName[], pair?: string): Region {
  return { id, module, label, x, y, z, w, d, h, types, palette, ...(pair ? { pair } : {}) };
}
export function postAndBeamModule(height: 9 | 12): Region[] {
  const regions: Region[] = [];
  for (const x of [1, 8]) for (const y of [3, 7]) {
    regions.push(r(`foot-${x}-${y}`, 'frame', 'Low timber side sill', x, y === 3 ? 3 : 6, 5, 1, 3, 3, ['brick'], wood, 'sills'));
    regions.push(r(`post-${x}-${y}`, 'frame', 'Slender post beside the open interior', x, y, 8, 1, 2, height - 3, ['brick', 'plate'], wood, 'posts'));
  }
  for (const y of [3, 8]) regions.push(r(`beam-${y}`, 'frame', 'Beam ties the left and right posts together', 1, y, 5 + height, 8, 1, 1, ['plate'], wood, 'beams'));
  for (const x of [1, 8]) regions.push(r(`rail-${x}`, 'frame', 'Cap the low side rail and leave the window open', x, 5, 8, 1, 2, 1, ['plate', 'tile'], wood, 'rail-caps'));
  return regions;
}
export function layeredRoofModule(spec: PavilionSpec): Region[] {
  const base = 6 + spec.height, regions: Region[] = [];
  if (spec.roof === 'gable') for (const x of [1, 8]) regions.push(r(`gable-header-${x}`, 'roof', 'Header joins both posts beneath the gable', x, 4, base - 1, 1, 4, 1, ['plate'], wood, 'gable-headers'));
  for (const x of spec.roof === 'gable' ? [1, 7] : [2, 6]) regions.push(r(`rafter-${x}`, 'roof', 'Rafter bridges both post-and-beam frames', x, 2, base, 2, 8, 1, ['plate'], wood, 'rafters'));
  // Nested plates tie every roof strip to the frame. Empty space under the
  // overhang remains empty; there is no rectangular roof volume to fill.
  regions.push(r('roof-tie-low', 'roof', 'First nested roof tie', 3, 3, base + 1, 4, 6, 1, ['plate'], wood));
  regions.push(spec.roof === 'gable'
    ? r('roof-tie-mid', 'roof', 'Hidden cross tie between the two closed gables', 3, 4, base + 2, 4, 4, 1, ['plate'], ['white'])
    : r('roof-tie-mid', 'roof', 'Cross the first tie to stagger the seams', 2, 4, base + 2, 6, 4, 1, ['plate'], wood));
  regions.push(r('roof-tie-high', 'roof', 'Support the narrow ridge', 3, 5, base + 3, 4, 2, 1, ['plate'], wood));
  for (const i of [0, 1, 6, 7]) regions.push(r(`roof-row-${i}`, 'roof', 'Broad lower roof course', 0, 2 + i, base + 1 + Math.min(i, 7 - i), 10, 1, 1, ['plate'], wood, 'lower-courses'));
  for (const i of [2, 5]) regions.push(r(`roof-row-${i}`, 'roof', 'Roof outline narrows toward the ridge', spec.roof === 'hipped' ? 1 : 0, 2 + i, base + 3, spec.roof === 'hipped' ? 8 : 10, 1, 1, ['plate'], wood, 'upper-courses'));
  regions.push(r('ridge', 'roof', 'Connected two-row ridge', spec.roof === 'hipped' ? 2 : 0, 5, base + 4, spec.roof === 'hipped' ? 6 : 10, 2, 1, ['plate'], wood));
  if (spec.roof === 'gable') for (const x of [1, 7]) {
    regions.push(r(`gable-low-${x}`, 'roof', 'Close the lower gable while preserving the roof pitch', x, 3, base + 1, 2, 6, 1, ['plate'], ['tan'], 'gable-lower'));
    regions.push(r(`gable-mid-${x}`, 'roof', 'Taper the gable infill with the next roof course', x, 4, base + 2, 2, 4, 1, ['plate'], stone, 'gable-middle'));
    regions.push(r(`gable-top-${x}`, 'roof', 'Cap the gable beneath the ridge', x, 5, base + 3, 2, 2, 1, ['plate'], wood, 'gable-upper'));
  }
  if (spec.eaves === 'raised') for (const x of [0, 8]) for (const y of [2, 9]) regions.push(r(`tip-${x}-${y}`, 'roof', 'Lift the four eave tips', x, y, base + 2, 2, 1, 1, ['plate'], wood, 'eave-tips'));
  return regions;
}
export function seatingModule(): Region[] {
  return [r('bench', 'seating', 'Built-in bench along the rear edge', 2, 8, 5, 6, 1, 3, ['brick'], wood), r('seat', 'seating', 'Smooth bench seat', 2, 8, 8, 6, 1, 1, ['tile'], wood)];
}
export function createPavilionTarget(input: PavilionSpec): PavilionTarget {
  const spec = pavilionSpec(input);
  return { spec, regions: [...terraceModule(), ...postAndBeamModule(spec.height), ...layeredRoofModule(spec), ...seatingModule()], voids: [
    { label: 'Open entrance and interior', x: 2, y: 3, z: 6, w: 6, d: 4, h: spec.height - 1 },
    ...[1, 8].map(x => ({ label: 'Open side window', x, y: 5, z: 9, w: 1, d: 2, h: spec.height - 4 })),
  ] };
}

/** Check the output independently of allocation: exact envelopes, material,
 * reserved empty space, real contacts and the unmodified original inventory. */
export function pavilionIssues(candidate: PavilionCandidate, stock: Record<string, number>): string[] {
  const { target, build, assignment } = candidate, parts = build.steps.flatMap(s => s.parts), issues: string[] = [];
  if (JSON.stringify(createPavilionTarget(target.spec)) !== JSON.stringify(target)) return ['The frozen pavilion target changed.'];
  if (parts.length !== assignment.length || parts.length < 20 || parts.length > 80) return ['Invalid pavilion piece assignment or size.'];
  const frames = parts.map(frame);
  for (const region of target.regions) {
    const indexes = assignment.flatMap((id, i) => id === region.id ? [i] : []);
    let volume = 0;
    for (const i of indexes) {
      const p = parts[i], k = parsePartId(p.partId)!, f = frames[i], min = [region.x * 20, region.y * 20, region.z * 8], max = [(region.x + region.w) * 20, (region.y + region.d) * 20, (region.z + region.h) * 8];
      if (!region.types.includes(k.type) || !region.palette.includes(k.color) || Math.abs(f.rotation[8] - 1) > .001 || [2, 5, 6, 7].some(a => Math.abs(f.rotation[a]) > .001)) issues.push(`${region.label}: wrong material or part profile.`);
      if ([0, 1, 2].some(a => f.bounds.min[a] < min[a] - .001 || f.bounds.max[a] > max[a] + .001)) issues.push(`${region.label}: piece leaves its planned boundary.`);
      volume += [0, 1, 2].reduce((v, a) => v * (f.bounds.max[a] - f.bounds.min[a]), 1);
    }
    if (Math.abs(volume - region.w * region.d * region.h * 3200) > .001) issues.push(`${region.label}: missing or excess material.`);
  }
  if (assignment.some(id => !target.regions.some(r => r.id === id))) issues.push('An unplanned region was added.');
  for (const v of target.voids) if (frames.some(f => [0, 1, 2].every(a => Math.min(f.bounds.max[a], [v.x + v.w, v.y + v.d, v.z + v.h][a] * [20, 20, 8][a]) - Math.max(f.bounds.min[a], [v.x, v.y, v.z][a] * [20, 20, 8][a]) > .001))) issues.push(`${v.label} was filled in.`);
  issues.push(...constructionIssues(build, stock, 24).map(i => i.message));
  return [...new Set(issues)];
}

function assemble(target: PavilionTarget, tagged: (Placed & { region: string })[], stock: Record<string, number>): PavilionCandidate {
  const parts = [...tagged].sort((a, b) => a.z - b.z), frames = parts.map(frame), order = [0], seen = new Set(order);
  const operations: ConnectionOperation[] = [{ partId: parts[0].partId, parent: -1, parentPort: '', childPort: '', twist: 0 }];
  while (order.length < parts.length) {
    let found = false;
    for (let i = 0; i < parts.length && !found; i++) if (!seen.has(i)) for (let parent = 0; parent < order.length && !found; parent++) {
      for (const [parentPort, childPort] of connectionPairs(frames[order[parent]], frames[i])) {
        const twist = attachmentTwist(parts[order[parent]], parentPort, parts[i], childPort); if (twist === null) continue;
        operations.push({ partId: parts[i].partId, parent, parentPort, childPort, twist }); order.push(i); seen.add(i); found = true; break;
      }
    }
    if (!found) throw Error('A seam leaves part of the pavilion disconnected.');
  }
  const program: ConnectionProgram = { name: 'Timber lookout pavilion', description: 'Open timber pavilion with a contoured roof, stone terrace, entrance steps and built-in seating.', rootRotation: parts[0].rot, operations };
  const build = compileConnections(program, stock), assignment = order.map(i => parts[i].region);
  // The connection compiler normalizes minimum x/y. This grammar's roof has
  // x=0 and its ground plate y=0, so the authored target frame is unchanged.
  build.steps.forEach((s, i) => { s.caption = target.regions.find(r => r.id === assignment[i])!.label + '. ' + s.caption; });
  const used = count(build.steps.flatMap(s => s.parts)), remaining = { ...stock };
  for (const [id, n] of Object.entries(used)) remaining[id] -= n;
  const candidate: PavilionCandidate = { id: `pavilion-${target.spec.roof}-${target.spec.height}-${target.spec.eaves}`, target, build, program, assignment, parts: used, remaining };
  const issues = pavilionIssues(candidate, stock); if (issues.length) throw Error(issues.join('; '));
  return candidate;
}

export function solvePavilion(stock: Record<string, number>, input: PavilionSpec, diagnostics: string[] = []): PavilionCandidate | null {
  const target = createPavilionTarget(input);
  stock = Object.fromEntries(Object.entries(stock).filter(([id, n]) => { try { const k = parsePartId(id); if (!k || !isMade(id) || !Number.isSafeInteger(n) || n < 1) return false; definition(k); return true; } catch { return false; } }));
  const groups: Region[][] = [];
  for (const region of target.regions) { const group = region.pair && groups.find(g => g[0].pair === region.pair); if (group) group.push(region); else groups.push([region]); }
  const pack = (g: Region[], left: Record<string, number>) => packRegion(g[0], left, g.length, g[0].palette, 5);
  const initial = new Map(groups.map(g => [g, pack(g, stock)]));
  for (const [g, p] of initial) if (!p.length) { diagnostics.push(`No stock allocation for ${g[0].label}.`); return null; }
  groups.sort((a, b) => initial.get(a)!.length - initial.get(b)!.length || b.length - a.length);
  type State = { left: Record<string, number>; parts: (Placed & { region: string })[]; cost: number };
  let states: State[] = [{ left: { ...stock }, parts: [], cost: 0 }];
  const deadline = performance.now() + 4000;
  for (const group of groups) {
    const next: State[] = [];
    for (const state of states) {
      if (performance.now() > deadline) { diagnostics.push('Pavilion allocation reached its four-second budget.'); return null; }
      for (const packing of pack(group, state.left)) {
        const left = { ...state.left }; for (const [id, n] of Object.entries(packing.used)) left[id] -= n;
        const parts = [...state.parts, ...group.flatMap(r => packing.parts.map(p => ({ ...p, x: p.x + r.x, y: p.y + r.y, z: p.z + r.z, region: r.id })))];
        if (parts.length <= 80) next.push({ left, parts, cost: state.cost + packing.cost });
      }
    }
    if (!next.length) { diagnostics.push(`Shared stock runs out at ${group[0].label}.`); return null; }
    const seen = new Set<string>();
    states = next.sort((a, b) => a.cost - b.cost).filter(s => { const key = JSON.stringify(s.parts); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 16);
  }
  for (const state of states) { try { return assemble(target, state.parts, stock); } catch (e) { const message = (e as Error).message; if (!diagnostics.includes(message)) diagnostics.push(message); } }
  return null;
}

/** Three materially different outlines; each is an alternative use of the pile. */
export const PAVILION_TRIALS: PavilionSpec[] = [
  { roof: 'hipped', height: 12, eaves: 'raised' },
  { roof: 'gable', height: 12, eaves: 'plain' },
  { roof: 'hipped', height: 9, eaves: 'plain' },
];
export function pavilionCandidates(stock: Record<string, number>): PavilionAllocation {
  const diagnostics: string[] = [], candidates = PAVILION_TRIALS.flatMap(spec => { const notes: string[] = [], c = solvePavilion(stock, spec, notes); if (!c) diagnostics.push(`${JSON.stringify(spec)}: ${notes.join(' ')}`); return c ? [c] : []; });
  return { candidates, diagnostics };
}
export function pavilionReceipts(candidate: PavilionCandidate) {
  return (['terrace', 'frame', 'roof', 'seating'] as const).map(module => {
    const parts = candidate.build.steps.flatMap((step, i) => candidate.target.regions.find(r => r.id === candidate.assignment[i])?.module === module ? step.parts : []);
    return { module, parts: count(parts), build: { name: module, description: 'Isolated subassembly; displayed at its installed height.', steps: [{ caption: module, parts }] } as Build };
  });
}
export function pavilionStockHint(stock: Record<string, number>): string {
  const timber = Object.entries(stock).filter(([id]) => id.endsWith('-reddish-brown')).reduce((s, [, n]) => s + n, 0);
  return timber >= 25 && (stock['plate-1x10-reddish-brown'] ?? 0) >= 4 ? 'These brown beams and plates suggest an open timber pavilion or gazebo: stepped roof courses, slender posts, protected open space, a stone terrace and built-in seating. A local architectural compiler can test whole outlines and alternate brick/plate packings against actual stock. This is a candidate subject, not a guarantee of fit or appearance; do not promise slopes or brackets that are absent.' : '';
}
