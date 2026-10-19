import { footprint, heightOf, parsePartId, type Placed } from '../bricks';
import { curvedContains } from '../curved-parts';
import { isMade } from '../catalog';
import { attachmentTwist, compileConnections, connectionPairs, corners, definition, frame, requiredContactIssues, solidContains, validateConnections, type ConnectionOperation, type Frame, type RequiredContact, type V3 } from '../connections';
import { animalSubjectKind } from './animal-subjects';
import { composeModules } from './compose';
import type { AssemblyComposition, AssemblyNode, AssemblyPlan } from './types';

export type WholeAnimalRole = 'frame' | 'chest' | 'hips' | 'torso' | 'tail' |
  'leg-front-left' | 'leg-front-right' | 'leg-rear-left' | 'leg-rear-right' |
  'neck' | 'head' | 'muzzle' | 'nose' | 'eye-left' | 'eye-right' | 'ear-left' | 'ear-right';
export type WholeAnimalStance = 'standing' | 'crouching';
export interface WholeAnimalPart {
  partId: string; role: WholeAnimalRole;
  /** ALL world coordinates in studs; z uses .4-stud layers. */
  x: number; y: number; z: number; rot: 0 | 90 | 180 | 270;
}
export interface WholeAnimalLayout {
  id: string; description: string;
  /** This pilot requires four grounded legs. Seated poses are unsupported. */
  stance?: WholeAnimalStance;
  parts: WholeAnimalPart[];
}

type Stock = Record<string, number>;
type Raw = Placed & { role: WholeAnimalRole };
interface WholeOperation extends ConnectionOperation { sourceIndex: number }
interface WholePlan extends AssemblyPlan { wholeAnimal: { version: 1; stance: WholeAnimalStance } }
type Edge = { a: number; b: number; pairs: [string, string][] };
const ROLES: WholeAnimalRole[] = ['frame', 'chest', 'hips', 'torso', 'tail', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right', 'neck', 'head', 'muzzle', 'nose', 'eye-left', 'eye-right', 'ear-left', 'ear-right'];
const REQUIRED = ROLES.filter(r => r !== 'frame');
const LEGS = ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'] as const;
const BODY = ['frame', 'chest', 'torso', 'hips'];
const DARK = new Set(['black', 'dark-gray', 'dark-brown', 'dark-blue', 'dark-green']);
const EPS = 1e-5, MAX_WORK = 8_000_000;
const close = (a: number, b: number, tolerance = EPS) => Math.abs(a - b) <= tolerance;
const allParts = (c: AssemblyComposition) => c.build.steps.flatMap(s => s.parts);
const count = (parts: Placed[]) => {
  const cost: Stock = {};
  for (const p of parts) cost[p.partId] = (cost[p.partId] ?? 0) + 1;
  return cost;
};
function stockCopy(stock: Stock): Stock {
  if (!stock || typeof stock !== 'object' || Array.isArray(stock)) throw Error('Provide an exact whole-animal stock ledger.');
  const entries = Object.entries(stock);
  if (entries.length > 1024 || entries.some(([id, n]) => id.length > 80 || !Number.isSafeInteger(n) || n < 0)) throw Error('Whole-animal stock needs bounded nonnegative safe-integer counts.');
  return Object.fromEntries(entries);
}
function target(layout: WholeAnimalLayout,minimum=20): { layout: WholeAnimalLayout; raw: Raw[]; frames: Frame[] } {
  if (!layout || typeof layout.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(layout.id) || typeof layout.description !== 'string' || layout.description.length > 1000 ||
      !Array.isArray(layout.parts) || layout.parts.length < minimum || layout.parts.length > 80 || !['standing', 'crouching'].includes(layout.stance ?? 'standing')) throw Error(`Provide a bounded ${minimum}–80-part standing/crouching whole Fox layout with a short id/description.`);
  const parts = layout.parts.map((p, i) => {
    if (!p || typeof p.partId !== 'string' || p.partId.length > 80 || !isMade(p.partId) || !ROLES.includes(p.role) ||
        ![p.x, p.y, p.z].every(Number.isFinite) || Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) > 24 || ![0, 90, 180, 270].includes(p.rot) ||
        Math.abs(p.z / .4 - Math.round(p.z / .4)) > 1e-6) throw Error(`Whole layout part ${i}: use a manufactured ID, anatomy role, finite bounded STUD coordinates, .4-stud z layers and an exact quarter turn.`);
    const k = parsePartId(p.partId)!;
    try { if (!definition(k).ports.length) throw Error('no real connectors'); }
    catch { throw Error(`Whole layout part ${i} has no supported actual connector shape.`); }
    return { partId: p.partId, role: p.role, x: p.x, y: p.y, z: p.z, rot: p.rot };
  });
  const raw = parts.map(p => ({ ...p, z: p.z / .4 })), frames = raw.map(frame), b = worldBounds(frames);
  if (b.size.some(n => n > 24 + EPS || !Number.isFinite(n))) throw Error('Whole Fox span exceeds 24 studs on an axis.');
  return { layout: { id: layout.id, description: layout.description, stance: layout.stance ?? 'standing', parts }, raw, frames };
}
function worldBounds(frames: Frame[]) {
  const min = [0, 1, 2].map(a => Math.min(...frames.map(f => f.bounds.min[a])) / 20) as V3;
  const max = [0, 1, 2].map(a => Math.max(...frames.map(f => f.bounds.max[a])) / 20) as V3;
  return { min, max, size: max.map((n, a) => n - min[a]) as V3 };
}
function graph(frames: Frame[]) {
  let work = 0;
  for (let a = 0; a < frames.length; a++) for (let b = 0; b < a; b++) work += frames[a].ports.length * frames[b].ports.length;
  if (work > MAX_WORK) throw Error('Whole layout exceeds the bounded connector-work budget.');
  const edges: Edge[] = [], neighbors: number[][] = frames.map(() => []);
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
    const pairs = connectionPairs(frames[a], frames[b]);
    if (!pairs.length) continue;
    edges.push({ a, b, pairs }); neighbors[a].push(b); neighbors[b].push(a);
  }
  // One protected, exact port pair per touching PART pair. All additional
  // simultaneously mating ports are preserved by the complete rigid-pose proof.
  // This protects every closure edge within the unchanged 160-contact contract.
  if (edges.length > 160) throw Error('Whole layout has more than 160 independent contact edges.');
  return { edges, neighbors, work };
}
function components(raw: Raw[], neighbors: number[][], pending: Set<number>): number[][] {
  const left = new Set(pending), result: number[][] = [];
  for (const root of pending) if (left.has(root)) {
    const order = [root]; left.delete(root);
    for (let cursor = 0; cursor < order.length; cursor++) for (const i of neighbors[order[cursor]]) if (left.has(i) && raw[i].role === raw[root].role) { left.delete(i); order.push(i); }
    result.push(order.sort((a, b) => a - b));
  }
  return result;
}
function rigid(actual: Placed[], desired: Placed[]): boolean {
  const aa = actual.map(frame), dd = desired.map(frame), shift = aa[0].translation.map((n, a) => n - dd[0].translation[a]);
  return aa.every((f, i) => actual[i].partId === desired[i].partId && f.rotation.every((n, a) => close(n, dd[i].rotation[a])) && f.translation.every((n, a) => close(n - dd[i].translation[a], shift[a])));
}
function inferPlan(layout: WholeAnimalLayout, raw: Raw[], frames: Frame[], g: ReturnType<typeof graph>): WholePlan {
  const pending = new Set(raw.map((_, i) => i)), nodes: AssemblyNode[] = [], owned = new Map<number, { id: string; local: number }>();
  const serial: Partial<Record<WholeAnimalRole, number>> = {};
  while (pending.size) {
    const groups = components(raw, g.neighbors, pending);
    let selected: { root: number; members: number[]; attachment?: AssemblyNode['attachment'] } | undefined;
    const anchor = (i: number): AssemblyNode['attachment'] | undefined => {
      for (const j of g.neighbors[i]) {
        const owner = owned.get(j); if (!owner) continue;
        for (const [parentPort, childPort] of connectionPairs(frames[j], frames[i])) {
          const twist = attachmentTwist(raw[j], parentPort, raw[i], childPort);
          if (twist !== null) return { parent: owner.id, parentPart: owner.local, parentPort, childPort, twist };
        }
      }
    };
    if (!nodes.length) {
      const lowest = Math.min(...frames.map(f => f.bounds.min[2]));
      const group = groups.filter(m => m.some(i => close(frames[i].bounds.min[2], lowest))).sort((a, b) => b.length - a.length || a[0] - b[0])[0];
      selected = { root: group.find(i => close(frames[i].bounds.min[2], lowest))!, members: group };
    } else {
      // Prefer each entire connected same-role component at a lowest root.
      for (const members of groups) {
        const lowest = Math.min(...members.map(i => frames[i].bounds.min[2]));
        for (const root of members.filter(i => close(frames[i].bounds.min[2], lowest))) {
          const attachment = anchor(root);
          if (attachment && (!selected || members.length > selected.members.length)) selected = { root, members, attachment };
        }
      }
      if (!selected) {
        // A shaft may join the body above its own foot. Cut only at the actual
        // lower same-role boundary; each resulting connected module still has
        // a lowest root and all target parts/poses remain unchanged.
        for (const root of pending) {
          const attachment = anchor(root); if (!attachment) continue;
          const members = [root], seen = new Set(members), low = frames[root].bounds.min[2];
          for (let cursor = 0; cursor < members.length; cursor++) for (const i of g.neighbors[members[cursor]]) if (pending.has(i) && !seen.has(i) && raw[i].role === raw[root].role && frames[i].bounds.min[2] >= low - EPS) { members.push(i); seen.add(i); }
          if (!selected || members.length > selected.members.length) selected = { root, members, attachment };
        }
      }
    }
    if (!selected) throw Error(`No real module attachment reaches target parts ${[...pending].join(', ')}.`);
    if (nodes.length >= 32) throw Error('Whole anatomy needs more than 32 independently grounded module nodes.');
    const { root, members, attachment } = selected, role = raw[root].role, order = [root], seen = new Set(order);
    const operations: WholeOperation[] = [{ partId: raw[root].partId, parent: -1, parentPort: '', childPort: '', twist: 0, sourceIndex: root }];
    for (let cursor = 0; cursor < order.length; cursor++) for (const i of g.neighbors[order[cursor]]) {
      if (!members.includes(i) || seen.has(i)) continue;
      for (const [parentPort, childPort] of connectionPairs(frames[order[cursor]], frames[i])) {
        const twist = attachmentTwist(raw[order[cursor]], parentPort, raw[i], childPort);
        if (twist === null) continue;
        operations.push({ partId: raw[i].partId, parent: cursor, parentPort, childPort, twist, sourceIndex: i }); order.push(i); seen.add(i); break;
      }
    }
    if (order.length !== members.length) throw Error('Same-role target component has no exact connector traversal.');
    const local = new Map(order.map((i, j) => [i, j])), requiredContacts: RequiredContact[] = [];
    for (const edge of g.edges) if (local.has(edge.a) && local.has(edge.b)) requiredContacts.push({ a: local.get(edge.a)!, b: local.get(edge.b)!, aPort: edge.pairs[0][0], bPort: edge.pairs[0][1] });
    const ordinal = serial[role] = (serial[role] ?? 0) + 1, id = `${role}-${ordinal}`;
    const program = { name: `Fox ${role} ${ordinal}`, description: 'Connected anatomical component inferred only from fresh target poses and actual connector pairs.', rootRotation: raw[root].rot, operations, requiredContacts };
    const compiled = compileConnections(program, count(order.map(i => raw[i])));
    if (!rigid(compiled.steps.flatMap(s => s.parts), order.map(i => raw[i]))) throw Error('Independent module compilation did not preserve the target rigid poses.');
    nodes.push({ id, option: { id: `animal-whole:${id}`, role, program }, ...(attachment ? { attachment } : {}) });
    order.forEach((i, local) => { pending.delete(i); owned.set(i, { id, local }); });
  }
  return { id: `animal-whole:fox:${layout.id}`, name: 'Fox', description: layout.description, nodes, wholeAnimal: { version: 1, stance: layout.stance ?? 'standing' } };
}
function protectClosures(c: AssemblyComposition) {
  const frames = allParts(c).map(frame), g = graph(frames);
  c.build.requiredContacts = g.edges.map(e => ({ a: e.a, b: e.b, aPort: e.pairs[0][0], bPort: e.pairs[0][1] }));
  // Ensure the explicitly chosen local recipe/anchor ports are protected too.
  const mapped: RequiredContact[] = [];
  for (const node of c.plan.nodes) {
    const r = c.receipts.find(r => r.id === node.id)!;
    for (const contact of node.option.program.requiredContacts ?? []) mapped.push({ ...contact, a: r.indices[contact.a], b: r.indices[contact.b] });
    const a = node.attachment;
    if (a) mapped.push({ a: c.receipts.find(r => r.id === a.parent)!.indices[a.parentPart], b: r.indices[0], aPort: a.parentPort, bPort: a.childPort });
  }
  const key = (r: RequiredContact) => JSON.stringify(r.a < r.b ? [r.a, r.b, r.aPort, r.bPort] : [r.b, r.a, r.bPort, r.aPort]);
  c.build.requiredContacts = [...new Map([...c.build.requiredContacts, ...mapped].map(r => [key(r), r])).values()];
  if (c.build.requiredContacts.length > 160) throw Error('Whole closure contract exceeds the unchanged 160-contact limit.');
  const issues = requiredContactIssues(allParts(c), c.build.requiredContacts);
  if (issues.length) throw Error(issues.join('\n'));
}
function compiledTarget(stock: Stock, layout: WholeAnimalLayout, raw: Raw[], frames: Frame[], g: ReturnType<typeof graph>) {
  const missing = REQUIRED.filter(role => !raw.some(p => p.role === role));
  if (missing.length) throw Error(`Missing whole Fox anatomy roles: ${missing.join(', ')}.`);
  const used = count(raw);
  for (const [id, n] of Object.entries(used)) if ((stock[id] ?? 0) < n) throw Error(`Whole shared stock exhausted for ${id}: needs ${n}, available ${stock[id] ?? 0}.`);
  const plan = inferPlan(layout, raw, frames, g), c = composeModules(plan, stock, { minParts: 20, maxParts: 80, maxMillis: 3000 });
  const mapping = new Map<number, Placed>();
  for (const r of c.receipts) (c.plan.nodes.find(n => n.id === r.id)!.option.program.operations as WholeOperation[]).forEach((op, i) => mapping.set(op.sourceIndex, allParts(c)[r.indices[i]]));
  if (mapping.size !== raw.length || !rigid(raw.map((_, i) => mapping.get(i)!), raw)) throw Error('Whole composition changed a target part or pose; only ONE whole translation is permitted.');
  protectClosures(c);
  return c;
}

/** Pure exact-stock compilation. No authored body/head layout or provider call.
 * Same-role components are independent modules. Where a component's body join
 * lies above its foot, it is split at a real same-role connection so every
 * independently compiled module keeps a lowest root; no physical order relaxes.
 */
export function composeWholeAnimal(stock: Stock, layout: WholeAnimalLayout): AssemblyComposition {
  const ledger = stockCopy(stock), t = target(layout), g = graph(t.frames);
  const c = compiledTarget(ledger, t.layout, t.raw, t.frames, g), issues = wholeAnimalIssues(c);
  if (issues.length) throw Error(issues.join('\n'));
  return c;
}

/** Early morphology ONLY, after the four-leg stage. Reuses the final anatomy
 * authority and its existing thresholds; only the not-yet-built tail is skipped.
 * Stock, full physics, independent modules, the tail and visual review remain
 * mandatory before a whole animal can be offered. Never accepts a candidate. */
export function partialWholeAnimalAnatomyIssues(layout:WholeAnimalLayout):string[]{
 try{
  const t=target(layout,1);graph(t.frames);
  const missing=REQUIRED.filter(role=>role!=='tail'&&!t.raw.some(p=>p.role===role));
  if(missing.length)return [`Partial anatomy needs the actual features, core and four legs: missing ${missing.join(', ')}.`];
  const min=worldBounds(t.frames).min,all=t.raw.map(p=>({...p,x:p.x-min[0],y:p.y-min[1],z:p.z-min[2]/.4})),roles=new Map(ROLES.map(role=>[role,all.filter(p=>p.role===role)]));
  return anatomy(all,roles,t.layout.stance??'standing',roles.get('tail')!.length>0);
 }catch(e){return [e instanceof Error?e.message:'Malformed partial anatomy.'];}
}

/** Anatomy/ownership/physics gate, never a visual quality qualification. */
export function wholeAnimalIssues(c: AssemblyComposition, requestedName = 'Fox'): string[] {
  if (animalSubjectKind(requestedName) !== 'fox' || !c?.plan || !c.build || c.plan.name !== 'Fox' || c.build.name !== 'Fox' || !/^animal-whole:fox:[a-z0-9][a-z0-9_-]{0,63}$/.test(c.plan.id)) return ['Unsupported requested species or noncanonical whole Fox.'];
  try {
    const meta = (c.plan as WholePlan).wholeAnimal;
    if (meta?.version !== 1 || !['standing', 'crouching'].includes(meta.stance) || !Array.isArray(c.plan.nodes) || !c.plan.nodes.length || c.plan.nodes.length > 32 ||
        !Array.isArray(c.receipts) || c.receipts.length !== c.plan.nodes.length || !Array.isArray(c.build.steps) || c.build.steps.length > 80) return ['Whole Fox needs bounded independently compiled anatomical modules and supported stance.'];
    let total = 0;
    for (const s of c.build.steps) if (!Array.isArray(s?.parts) || (total += s.parts.length) > 80) return ['Whole Fox needs 20–80 purposeful owned parts.'];
    if (total < 20) return ['Whole Fox needs 20–80 purposeful owned parts.'];
    const all = allParts(c), owned = new Set<number>(), sources = new Set<number>(), roles = new Map<WholeAnimalRole, Placed[]>();
    if (new Set(c.plan.nodes.map(n => n.id)).size !== c.plan.nodes.length || new Set(c.receipts.map(r => r.id)).size !== c.receipts.length) return ['Duplicate whole anatomical ownership.'];
    for (const r of c.receipts) {
      const node = c.plan.nodes.find(n => n.id === r.id), ops = node?.option.program.operations as WholeOperation[] | undefined;
      if (!node || !ROLES.includes(r.role as WholeAnimalRole) || node.option.role !== r.role || r.optionId !== node.option.id || !Array.isArray(r.indices) || !Array.isArray(ops) || ops.length !== r.indices.length || !ops.length) return ['Whole anatomy needs exact module roles, options and receipts.'];
      const own: Placed[] = [];
      for (const [i, index] of r.indices.entries()) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= total || owned.has(index) || !Number.isSafeInteger(ops[i].sourceIndex) || ops[i].sourceIndex < 0 || ops[i].sourceIndex >= total || sources.has(ops[i].sourceIndex) || ops[i].partId !== all[index]?.partId) return ['Every whole target part must be owned once with its exact source index.'];
        owned.add(index); sources.add(ops[i].sourceIndex); own.push(all[index]);
      }
      if (JSON.stringify(count(own)) !== JSON.stringify(r.cost)) return ['Whole module cost does not match its actual owned parts.'];
      roles.set(r.role as WholeAnimalRole, [...roles.get(r.role as WholeAnimalRole) ?? [], ...own]);
    }
    if (owned.size !== total || REQUIRED.some(role => !roles.has(role))) return ['Missing whole anatomical ownership; frame is the only optional role.'];
    const ledger = stockCopy(c.remaining);
    for (const [id, n] of Object.entries(count(all))) ledger[id] = (ledger[id] ?? 0) + n;
    if (all.some(p => !isMade(p.partId))) return ['Whole anatomy needs actual manufactured part IDs.'];
    const replay = composeModules(c.plan, ledger, { minParts: 20, maxParts: 80, maxMillis: 3000 }); protectClosures(replay);
    if (JSON.stringify(replay.build) !== JSON.stringify(c.build) || JSON.stringify(replay.receipts) !== JSON.stringify(c.receipts) || JSON.stringify(replay.remaining) !== JSON.stringify(c.remaining)) return ['Whole anatomy changed its exact compiled poses, closures, ordering or shared ledger.'];
    const whole = worldBounds(all.map(frame));
    if (!Array.isArray(c.size) || c.size.length !== 3 || c.size.some((n, a) => !Number.isFinite(n) || !close(n, whole.size[a])) || whole.size.some(n => n > 24 + EPS)) return ['Whole-animal extents must be finite x/y/z STUD spans within 24.'];
    return anatomy(all, roles, meta.stance);
  } catch (e) { return [`Invalid or physically rejected whole Fox: ${e instanceof Error ? e.message : 'invalid contract'}`]; }
}

/** Bounded target diagnostics only; an inspected layout is never accepted.
 * Part indices refer to the caller's zero-based target order. */
export function wholeAnimalDiagnostics(stock: Stock, layout: WholeAnimalLayout): unknown {
  try {
    const ledger = stockCopy(stock), t = target(layout), g = graph(t.frames), cost = count(t.raw), issues: string[] = [];
    const shortages = Object.entries(cost).filter(([id, n]) => (ledger[id] ?? 0) < n).map(([partId, needed]) => ({ partId, needed, available: ledger[partId] ?? 0 }));
    const comps = components(t.raw, g.neighbors, new Set(t.raw.map((_, i) => i)));
    let c: AssemblyComposition | undefined;
    try { c = compiledTarget(ledger, t.layout, t.raw, t.frames, g); issues.push(...wholeAnimalIssues(c)); } catch (e) { issues.push(e instanceof Error ? e.message : 'Target compilation failed.'); }
    const b = worldBounds(t.frames), normalized: Placed[] = t.raw.map(p => ({ ...p, x: p.x - b.min[0], y: p.y - b.min[1], z: p.z - b.min[2] / .4 }));
    const physics = validateConnections({ name: 'Whole target diagnostic', description: 'Unaccepted target', engine: 'connections-v2', steps: normalized.map(p => ({ caption: 'Diagnostic', parts: [p] })) }, ledger, 24)
      .filter(i => i.kind !== 'floating').slice(0, 20).map(i => ({ problem: i.message, partIndices: i.parts.map(p => normalized.indexOf(p)) }));
    return { accepted: false, count: t.raw.length, issues, partIssues: physics, shortages, cost, boundsStuds: b,
      roleBounds: Object.fromEntries(ROLES.filter(role => t.raw.some(p => p.role === role)).map(role => [role, worldBounds(t.frames.filter((_, i) => t.raw[i].role === role))])),
      sameRoleComponents: comps.map(indices => ({ role: t.raw[indices[0]].role, indices })), moduleCount: c?.plan.nodes.length,
      contactEdges: g.edges.map(e => ({ a: e.a, b: e.b, aPort: e.pairs[0][0], bPort: e.pairs[0][1] })), portPairCount: g.edges.reduce((n, e) => n + e.pairs.length, 0),
      note: 'Diagnostic only, no accepted candidate. Exact poses are not snapped/repaired. Anatomy sampling is not visual quality, clutch or collision authority.' };
  } catch (e) { return { accepted: false, issues: [e instanceof Error ? e.message : 'Invalid diagnostic input.'] }; }
}

type Basis = { right: V3; forward: V3 };
const project = (p: V3, basis: Basis): V3 => [p[0] * basis.right[0] + p[1] * basis.right[1], p[0] * basis.forward[0] + p[1] * basis.forward[1], p[2]];
const unproject = (p: V3, basis: Basis): V3 => [p[0] * basis.right[0] + p[1] * basis.forward[0], p[0] * basis.right[1] + p[1] * basis.forward[1], p[2]];
function roleBounds(parts: Placed[], basis: Basis) {
  const points = parts.flatMap(p => corners(frame(p).bounds).map(v => project(v, basis).map(n => n / 20)));
  const min = [0, 1, 2].map(a => Math.min(...points.map(p => p[a]))) as V3, max = [0, 1, 2].map(a => Math.max(...points.map(p => p[a]))) as V3;
  return { min, max, size: max.map((n, a) => n - min[a]) as V3, center: max.map((n, a) => (n + min[a]) / 2) as V3 };
}
const joined = (a: Placed[], b: Placed[]) => a.some(p => b.some(q => connectionPairs(frame(p), frame(q)).length));
function connected(parts: Placed[]) {
  if (!parts.length) return false;
  const ff = parts.map(frame), seen = new Set([0]), order = [0];
  for (let cursor = 0; cursor < order.length; cursor++) for (let i = 0; i < parts.length; i++) if (!seen.has(i) && connectionPairs(ff[order[cursor]], ff[i]).length) { seen.add(i); order.push(i); }
  return seen.size === parts.length;
}
function bodies(parts: Placed[]) {
  return parts.map(p => ({ k: parsePartId(p.partId)!, f: frame(p) }));
}
/** Nominal render-profile masks, only for bounded anatomical contour sampling.
 * Ignore cosmetic seams/studs; connection solids remain the physics authority.
 * Curves share their source-facet engine outline. Circle/cone/capsule masks
 * remain nominal presentation approximations, not clutch-strength proof. */
function occupied(bb: ReturnType<typeof bodies>, point: V3): boolean {
  return bb.some(({ k, f }) => {
    if (!f.solids.some(s => solidContains(s, point))) return false;
    const q = point.map((n, a) => n - f.translation[a]), r = f.rotation;
    const [x, y, z] = [0, 1, 2].map(a => r[a] * q[0] + r[3 + a] * q[1] + r[6 + a] * q[2]);
    const { fw, fd } = footprint(k, 0), w = fw * 20, d = fd * 20, h = heightOf(k) * 8;
    if (k.type === 'curve') {
      return curvedContains(k,[x,y,z]);
    }
    if (['roundbrick', 'roundplate', 'roundtile', 'cone', 'roundendplate'].includes(k.type)) {
      const dx = x - w / 2, dy = y - d / 2, base = Math.min(w, d) / 2;
      if (k.type === 'roundendplate') return (dx - Math.max(-10, Math.min(10, dx))) ** 2 + dy ** 2 <= base ** 2 + EPS;
      const radius = k.type === 'cone' ? base + (6 - base) * Math.max(0, Math.min(1, z / h)) : base;
      return dx ** 2 + dy ** 2 <= radius ** 2 + EPS;
    }
    return true;
  });
}
function earProfile(parts: Placed[], basis: Basis) {
  const b = roleBounds(parts, basis), bb = bodies(parts), layer = (height: number) => {
    const mask: boolean[] = [], points: V3[] = [];
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) {
      const p: V3 = [b.min[0] + b.size[0] * (x + .5) / 12, b.min[1] + b.size[1] * (y + .5) / 12, b.min[2] + b.size[2] * height];
      const bit = occupied(bb, unproject(p.map(n => n * 20) as V3, basis)); mask.push(bit); if (bit) points.push(p);
    }
    return { mask, area: points.length, x: points.length ? points.reduce((n, p) => n + p[0], 0) / points.length : NaN };
  };
  return { lower: layer(.2), upper: layer(.85) };
}
/** Check the common high cross-section above the skull, rather than only
 * each ear's separately normalized taper. Twelve cells per ear axis bound the
 * occupied tip footprints conservatively; a >=.25-stud lateral gap must remain
 * exposed to the complete nominal visual body union. This is anatomy sampling,
 * not altered collision/clutch geometry or a visual grade. */
function exposedEarGap(ears: Placed[][], all: Placed[], basis: Basis, skullTop: number): boolean {
  const bounds = ears.map(p => roleBounds(p, basis)), peak = Math.min(...bounds.map(b => b.max[2]));
  const z = Math.max(skullTop + .1, peak - .15 * Math.min(...bounds.map(b => b.size[2])));
  if (z >= peak) return false;
  const spans = ears.map((parts, i) => {
    const b = bounds[i], bb = bodies(parts), occupiedX: number[] = [];
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) {
      const p: V3 = [b.min[0] + b.size[0] * (x + .5) / 12, b.min[1] + b.size[1] * (y + .5) / 12, z];
      if (occupied(bb, unproject(p.map(n => n * 20) as V3, basis))) occupiedX.push(x);
    }
    return occupiedX.length ? { min: b.min[0] + b.size[0] * Math.min(...occupiedX) / 12,
      max: b.min[0] + b.size[0] * (Math.max(...occupiedX) + 1) / 12 } : undefined;
  });
  if (!spans[0] || !spans[1] || spans[1].min - spans[0].max < .25 - EPS) return false;
  const bb = bodies(all), left = spans[0].max, width = spans[1].min - left;
  const front = Math.min(...bounds.map(b => b.min[1])), depth = Math.max(...bounds.map(b => b.max[1])) - front;
  for (let x = 0; x < 3; x++) for (let y = 0; y < 12; y++) {
    const p: V3 = [left + width * (x + .5) / 3, front + depth * (y + .5) / 12, z];
    if (occupied(bb, unproject(p.map(n => n * 20) as V3, basis))) return false;
  }
  return true;
}
function tailProfile(parts: Placed[], basis: Basis) {
  const b = roleBounds(parts, basis), bb = bodies(parts), section = (fraction: number) => {
    let area = 0;
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) {
      const p: V3 = [b.min[0] + b.size[0] * (x + .5) / 12, b.min[1] + b.size[1] * fraction, b.min[2] + b.size[2] * (z + .5) / 12];
      if (occupied(bb, unproject(p.map(n => n * 20) as V3, basis))) area++;
    }
    return area;
  };
  return { tip: Math.max(section(.1), section(.2)), base: Math.max(section(.65), section(.8)) };
}
function anatomy(all: Placed[], roles: Map<WholeAnimalRole, Placed[]>, stance: WholeAnimalStance,includeTail=true): string[] {
  const issues: string[] = [], pp = (r: WholeAnimalRole) => roles.get(r) ?? [];
  const feetWorld = LEGS.map(r => worldBounds(pp(r).map(frame))), center = (b: ReturnType<typeof worldBounds>, a: number) => (b.min[a] + b.max[a]) / 2;
  const delta = [0, 1].map(a => (center(feetWorld[0], a) + center(feetWorld[1], a) - center(feetWorld[2], a) - center(feetWorld[3], a)) / 2);
  const axis = Math.abs(delta[0]) > Math.abs(delta[1]) ? 0 : 1;
  if (Math.abs(delta[axis]) < .75 || Math.abs(delta[1 - axis]) > Math.abs(delta[axis]) * .35) return ['Four grounded legs must establish a clear front/rear quadruped stance.'];
  const forward: V3 = axis === 0 ? [Math.sign(delta[0]), 0, 0] : [0, Math.sign(delta[1]), 0], basis: Basis = { forward, right: [-forward[1], forward[0], 0] };
  const b = (r: WholeAnimalRole) => roleBounds(pp(r), basis), bodyParts = BODY.flatMap(r => pp(r as WholeAnimalRole)), body = roleBounds(bodyParts, basis);
  const chest = b('chest'), hips = b('hips'), torso = b('torso'), feet = LEGS.map(b), head = b('head'), neck = b('neck'), muzzle = b('muzzle'), nose = b('nose');
  const sym = Math.max(.25, head.size[0] * .08);
  if (body.size[0] < 1.8 || body.size[0] > 8 || body.size[1] < 3 || body.size[1] > 14 || body.size[2] > 5 || chest.center[1] - hips.center[1] < .75 ||
      torso.center[1] < hips.min[1] - .5 || torso.center[1] > chest.max[1] + .5 || chest.size[0] > body.size[0] + EPS || hips.size[0] > body.size[0] + EPS ||
      Math.abs(chest.center[0] - hips.center[0]) > Math.max(.5, body.size[0] * .2)) issues.push('Fox needs meaningful aligned chest, torso and hips with plausible body proportions.');
  if (feet.some((f, i) => !close(f.min[2], 0) || f.size[2] < .4 - EPS || f.size[2] > 5 || f.size[0] > Math.max(1.5, body.size[0] * .65) || !connected(pp(LEGS[i])) || !joined(pp(LEGS[i]), bodyParts)) ||
      feet[1].min[0] - feet[0].max[0] < .25 || feet[3].min[0] - feet[2].max[0] < .25 ||
      Math.min(feet[0].min[1], feet[1].min[1]) - Math.max(feet[2].max[1], feet[3].max[1]) < .5 ||
      Math.abs((feet[0].center[0] + feet[1].center[0]) / 2 - body.center[0]) > body.size[0] * .25 ||
      Math.abs((feet[2].center[0] + feet[3].center[0]) / 2 - body.center[0]) > body.size[0] * .25) issues.push('Fox requires four separate visible connected legs, each genuinely grounded at the planned stance.');
  const voidMin: V3 = [Math.max(feet[0].max[0], feet[2].max[0]), Math.max(feet[2].max[1], feet[3].max[1]), 0];
  const voidMax: V3 = [Math.min(feet[1].min[0], feet[3].min[0]), Math.min(feet[0].min[1], feet[1].min[1]), body.min[2]];
  const bellyHeight = stance === 'standing' ? .6 : .2;
  let blocked = voidMax[0] - voidMin[0] < .25 || voidMax[1] - voidMin[1] < .5 || voidMax[2] < bellyHeight - EPS;
  const bb = bodies(all);
  if (!blocked) for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    const p = [x, y, z].map((n, a) => (voidMin[a] + (voidMax[a] - voidMin[a]) * (n + .5) / 3) * 20) as V3;
    if (occupied(bb, unproject(p, basis))) blocked = true;
  }
  if (blocked) issues.push('Standing/crouching Fox must retain a visibly open belly between its four grounded legs.');
  if (head.size[0] < Math.max(1.5, body.size[0] * .35) || head.size[0] > Math.min(7, body.size[0] * 1.6) || head.size[1] < .75 || head.size[1] > 6 || head.size[2] < .6 || head.size[2] > 4.8 ||
      neck.size[2] > Math.max(2, body.size[2] * .9) || neck.size[0] > body.size[0] * 1.15 || neck.size[0] < .5 ||
      Math.abs(head.center[0] - body.center[0]) > Math.max(.4, body.size[0] * .18) || Math.abs(neck.center[0] - chest.center[0]) > body.size[0] * .25 ||
      head.center[1] < body.center[1] || neck.center[1] < chest.min[1] - 1.5 || neck.center[1] > chest.max[1] + 1.5 ||
      !joined(pp('neck'), [...pp('chest'), ...pp('torso')]) || !joined(pp('head'), pp('neck'))) issues.push('Fox needs a proportionate centered skull on a short actually supported shoulder/neck transition.');
  const eyeParts = [pp('eye-left'), pp('eye-right')], eyes = eyeParts.map(p => roleBounds(p, basis));
  if (eyeParts.some(p => p.length > 3 || !connected(p) || !joined(p, pp('head')) || p.some(q => !DARK.has(parsePartId(q.partId)!.color))) ||
      eyes.some(e => e.size[0] > 1.5 || e.size[1] > 1.5 || e.size[2] > .8 + EPS || e.center[1] < head.center[1] - .5 || e.min[2] < nose.max[2] - .4 - EPS) ||
      eyes[1].min[0] - eyes[0].max[0] < .4 || Math.abs((eyes[0].center[0] + eyes[1].center[0]) / 2 - head.center[0]) > sym ||
      !close(eyes[0].center[1], eyes[1].center[1], sym) || !close(eyes[0].center[2], eyes[1].center[2], sym)) issues.push('Fox requires two small separated symmetric dark eyes on real head supports, visible above the snout.');
  const projection = Math.max(muzzle.max[1], nose.max[1]) - Math.max(...eyes.map(e => e.max[1]));
  const snout = roleBounds([...pp('muzzle'), ...pp('nose')], basis);
  if (projection < .75 - EPS || projection > Math.max(4, head.size[1] * 1.5) || muzzle.size[0] > head.size[0] * .8 || muzzle.size[0] < .5 ||
      snout.size[2] > Math.max(1.2, head.size[2] * .85) || Math.abs(muzzle.center[0] - head.center[0]) > sym || pp('nose').length > 3 ||
      nose.size[0] > Math.min(muzzle.size[0] + EPS, head.size[0] * .65) || nose.size[1] > 1.5 || nose.size[2] > 1.2 ||
      nose.max[1] < muzzle.max[1] - EPS || pp('nose').some(p => !DARK.has(parsePartId(p.partId)!.color)) || !connected(pp('nose')) ||
      !joined(pp('nose'), pp('muzzle')) || !joined(pp('muzzle'), pp('head'))) issues.push('Fox needs a narrow thin projecting muzzle with a small dark nose at its actual front.');
  const earParts = [pp('ear-left'), pp('ear-right')], ears = earParts.map(p => roleBounds(p, basis)), profiles = earParts.map(p => earProfile(p, basis));
  const asymmetric = (['lower', 'upper'] as const).some(layer => profiles[0][layer].mask.filter((bit, i) => bit !== profiles[1][layer].mask[(11 - Math.floor(i / 12)) * 12 + i % 12]).length > 12);
  if (earParts.some(p => !connected(p) || !joined(p, pp('head'))) || ears.some(e => e.max[2] - head.max[2] < .25 - EPS || e.max[2] - head.max[2] > 2.8 ||
      e.size[0] > head.size[0] * .8 || e.size[1] > head.size[1] * 1.5 || e.size[2] > Math.max(1.6, head.size[2] * 1.5)) ||
      ears[1].center[0] - ears[0].center[0] < .5 || Math.abs((ears[0].center[0] + ears[1].center[0]) / 2 - head.center[0]) > sym ||
      !close(ears[0].center[1], ears[1].center[1], sym) || !close(ears[0].center[2], ears[1].center[2], sym) || !ears[0].size.every((n, a) => close(n, ears[1].size[a], sym)) ||
      profiles.some(p => !p.upper.area || !p.lower.area || p.upper.area > p.lower.area * .8) || profiles[1].upper.x - profiles[0].upper.x < .5 || asymmetric)
    issues.push('Fox requires paired symmetric alert ear peaks above its skull with actual whole-ear taper; relabelled flat brick posts fail.');
  if (!exposedEarGap(earParts, all, basis, head.max[2])) issues.push('Fox requires an actual exposed gap between its upper ear peaks; a continuous pitched-roof stripe fails.');
  if(!includeTail)return [...new Set(issues)];
  const tail = b('tail'), tailShape = tailProfile(pp('tail'), basis), rear = body.min[1] - tail.min[1];
  if (!connected(pp('tail')) || !joined(pp('tail'), [...pp('hips'), ...pp('torso')]) || rear < Math.max(1, body.size[1] * .2) || tail.size[1] > body.size[1] * 1.4 + 2 ||
      tail.size[0] < body.size[0] * .25 || tail.size[0] > body.size[0] * 1.2 || tail.max[2] > body.max[2] + 2.4 ||
      Math.abs(tail.center[0] - body.center[0]) > body.size[0] * .4 || !tailShape.base || !tailShape.tip || tailShape.tip > tailShape.base * .85)
    issues.push('Fox requires a substantial attached rear tail with actual taper toward its tip; a generic cuboid tail fails.');
  return [...new Set(issues)];
}
