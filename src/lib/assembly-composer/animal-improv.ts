import { parsePartId, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { attachmentTwist, compileConnections, connectionPairs, definition, frame, solidContains, type ConnectionOperation, type Frame, type RequiredContact, type V3 } from '../connections';
import { composeModules } from './compose';
import type { AssemblyComposition, AssemblyNode, AssemblyPlan } from './types';

export type FoxImprovRole = 'neck' | 'head' | 'muzzle' | 'nose' | 'eye-left' | 'eye-right' | 'ear-left' | 'ear-right';
export interface FoxImprovOperation extends ConnectionOperation { role: FoxImprovRole }
export interface FoxImprovProposal {
  id: string;
  description?: string;
  rootRotation?: number;
  attachment: { parentPart: number; parentPort: string; childPort: string; twist: number };
  operations: FoxImprovOperation[];
  requiredContacts?: RequiredContact[];
}
export interface FoxImprovShoulderPort {
  parent: 'chest'; parentPart: number; parentPort: string;
  pointLDU: V3; normal: V3; part: Placed; frame: Frame;
}
export interface FoxImprovObstacle { role: string; index: number; part: Placed; frame: Frame }
export interface FoxImprovGoals {
  units: 'studs'; forward: V3; centerX: number;
  maxProposalParts: 24; maxTotalParts: 80; maxSpanStuds: 24;
  headWidth: [number, number]; headDepth: [number, number]; headHeight: [number, number];
  neckHeight: [number, number]; muzzleProjection: [number, number];
  muzzleWidthToHeadMax: number; muzzleHeightToHeadMax: number;
  eyesMinGap: number; symmetryTolerance: number; earPeakRise: [number, number];
  eyesMaxSize: [number, number, number]; eyesBelowNoseTolerance: number;
  earWidthToHeadMax: number; earSpanToHeadMax: number; earDepthToHeadMax: number; earHeightToHeadMax: number;
}
export interface FoxImprovContext {
  version: 1; subject: 'Fox';
  stock: Record<string, number>;
  /** Complete original ledger after the chassis, including unusable raw IDs. */
  remaining: Record<string, number>;
  /** Manufactured, supported positive remaining counts eligible for proposals. */
  available: Record<string, number>;
  chassis: AssemblyComposition;
  shoulderPorts: FoxImprovShoulderPort[];
  /** Fixed parts within four studs of the shoulder region; frames use LDU. */
  obstacles: FoxImprovObstacle[];
  goals: FoxImprovGoals;
}

type Stock = Record<string, number>;
type Raw = Placed & { role: string };
const FIXED_ROLES = ['frame', 'chest', 'hips', 'torso', 'tail', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'];
const GENERATED_ROLES: FoxImprovRole[] = ['neck', 'head', 'muzzle', 'nose', 'eye-left', 'eye-right', 'ear-left', 'ear-right'];
const DARK = new Set(['black', 'dark-gray', 'dark-blue', 'dark-green', 'dark-brown']);
const close = (a: number, b: number, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;
const allParts = (c: AssemblyComposition) => c.build.steps.flatMap(s => s.parts);
const count = (parts: Placed[]) => {
  const used: Stock = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
};
function stockCopy(stock: Stock): Stock | null {
  try {
    if (!stock || typeof stock !== 'object' || Array.isArray(stock)) return null;
    const entries = Object.entries(stock);
    if (entries.length > 1024 || entries.some(([id, n]) => id.length > 80 || !Number.isSafeInteger(n) || n < 0)) return null;
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
  } catch { return null; }
}
function eligible(id: string): boolean {
  try { const k = parsePartId(id); return !!k && isMade(id) && definition(k).ports.length > 0; }
  catch { return false; }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function bounds(parts: Placed[]) {
  if (!parts.length) throw Error('Missing improvisation anatomy.');
  const ff = parts.map(frame), min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a])) / 20);
  const max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])) / 20);
  return { min, max, size: max.map((n, a) => n - min[a]), center: max.map((n, a) => (n + min[a]) / 2) };
}
const joined = (a: Placed[], b: Placed[]) => a.some(p => b.some(q => connectionPairs(frame(p), frame(q)).length));

/** Fixed chassis ONLY. No authored neck, head, eye, nose or ear recipe exists
 * in this provider. The white tip leaves both black ear slopes unreserved. */
function chassisRecipe(): Raw[] {
  const raw: Raw[] = [], brown = 'reddish-brown';
  const put = (role: string, partId: string, x: number, y: number, z: number, rot = 0) => raw.push({ role, partId, x, y, z, rot });
  for (const [y, station] of [[1, 'front'], [6, 'rear']] as const) for (const [x, side] of [[0, 'left'], [3, 'right']] as const) put(`leg-${station}-${side}`, 'roundbrick-1x1-tan', x, y, 0);
  for (const y of [1, 6]) put('frame', `plate-1x4-${brown}`, 0, y, 3);
  put('frame', `plate-2x8-${brown}`, 1, 0, 4, 90);
  for (const x of [0, 3]) {
    put('chest', `brick-1x2-${brown}`, x, 0, 5, 90);
    put('hips', `brick-1x2-${brown}`, x, 6, 5, 90);
  }
  put('chest', `brick-1x2-${brown}`, 1, 0, 5);
  put('hips', `brick-1x2-${brown}`, 1, 7, 5);
  put('chest', 'plate-2x4-dark-tan', 0, 0, 8);
  put('hips', 'plate-2x4-tan', 0, 6, 8);
  put('torso', `brick-2x6-${brown}`, 1, 1, 5, 90);
  put('torso', `plate-2x4-${brown}`, 1, 2, 8, 90);
  put('tail', `plate-2x4-${brown}`, 1, 7, 9, 90);
  put('tail', `brick-2x2-${brown}`, 1, 8, 10);
  put('tail', 'slope-2x2-white', 1, 10, 10, 180);
  put('tail', `tile-2x2-${brown}`, 1, 8, 13);
  return raw;
}

function chassisPlan(raw: Raw[]): AssemblyPlan {
  const ff = raw.map(frame), nodes: AssemblyNode[] = [], placed = new Map<string, number[]>(), pending = new Set(FIXED_ROLES);
  while (pending.size) {
    let progress = false;
    for (const role of pending) {
      const members = raw.flatMap((p, i) => p.role === role ? [i] : []), lowest = Math.min(...members.map(i => ff[i].bounds.min[2]));
      let root = -1, attachment: AssemblyNode['attachment'];
      choose: for (const i of members.filter(i => close(ff[i].bounds.min[2], lowest))) {
        if (!nodes.length && role === 'frame') { root = i; break; }
        for (const [parent, order] of placed) for (const [parentPart, j] of order.entries()) for (const [parentPort, childPort] of connectionPairs(ff[j], ff[i])) {
          const twist = attachmentTwist(raw[j], parentPort, raw[i], childPort);
          if (twist !== null) { root = i; attachment = { parent, parentPart, parentPort, childPort, twist }; break choose; }
        }
      }
      if (root < 0) continue;
      const order = [root], seen = new Set(order), operations: ConnectionOperation[] = [{ partId: raw[root].partId, parent: -1, parentPort: '', childPort: '', twist: 0 }];
      while (order.length < members.length) {
        let added = false;
        choose: for (const i of members) if (!seen.has(i)) for (const [parent, j] of order.entries()) for (const [parentPort, childPort] of connectionPairs(ff[j], ff[i])) {
          const twist = attachmentTwist(raw[j], parentPort, raw[i], childPort);
          if (twist !== null) { operations.push({ partId: raw[i].partId, parent, parentPort, childPort, twist }); order.push(i); seen.add(i); added = true; break choose; }
        }
        if (!added) throw Error('Disconnected fixed chassis module.');
      }
      const requiredContacts: RequiredContact[] = [];
      for (let a = 0; a < order.length; a++) for (let b = 0; b < a; b++) for (const [aPort, bPort] of connectionPairs(ff[order[a]], ff[order[b]])) requiredContacts.push({ a, b, aPort, bPort });
      const program = { name: role, description: `Fixed Fox chassis ${role}.`, rootRotation: raw[root].rot, operations, requiredContacts };
      compileConnections(program, count(order.map(i => raw[i])));
      nodes.push({ id: role, option: { id: `animal-improv:fox:chassis:${role}`, role, program }, ...(attachment ? { attachment } : {}) });
      placed.set(role, order); pending.delete(role); progress = true;
    }
    if (!progress) throw Error('Fixed chassis has no actual module attachment.');
  }
  return { id: 'animal-improv:fox:chassis', name: 'Fox', description: 'Fixed headless Fox chassis and white-tipped tail; anatomy still requires an independently proposed head and neck.', nodes };
}

/** Returns an immutable serializable snapshot if the chassis alone is legal.
 * Scarcity of any prospective head part never blocks creation of this context. */
export function createFoxImprovContext(stock: Stock): FoxImprovContext | null {
  const ledger = stockCopy(stock);
  if (!ledger) return null;
  try {
    const raw = chassisRecipe(), used = count(raw);
    if (Object.entries(used).some(([id, n]) => !eligible(id) || (ledger[id] ?? 0) < n)) return null;
    const chassis = composeModules(chassisPlan(raw), ledger, { minParts: 20, maxParts: 80 });
    const all = allParts(chassis), ff = all.map(frame), shoulder = chassis.receipts.find(r => r.id === 'chest')!;
    const shoulderPorts: FoxImprovShoulderPort[] = [];
    for (const [parentPart, index] of shoulder.indices.entries()) for (const port of ff[index].ports) {
      if (port.kind !== 'stud' || port.normal[2] < 1 - 1e-5 || ff.some((f, j) => j !== index && connectionPairs(ff[index], f).some(([id]) => id === port.id))) continue;
      shoulderPorts.push({ parent: 'chest', parentPart, parentPort: port.id, pointLDU: port.point, normal: port.normal, part: all[index], frame: ff[index] });
    }
    if (!shoulderPorts.length) return null;
    const obstacles = chassis.receipts.flatMap(r => r.indices.filter(i => ff[i].bounds.min[1] <= 4 * 20).map(index => ({ role: r.role, index, part: all[index], frame: ff[index] })));
    const available = Object.fromEntries(Object.entries(chassis.remaining).filter(([id, n]) => n > 0 && eligible(id)));
    const goals: FoxImprovGoals = {
      units: 'studs', forward: [0, -1, 0], centerX: 2, maxProposalParts: 24, maxTotalParts: 80, maxSpanStuds: 24,
      headWidth: [2, 5], headDepth: [1, 5], headHeight: [.8, 3.2], neckHeight: [.4, 1.6],
      muzzleProjection: [.8, 4], muzzleWidthToHeadMax: .75, muzzleHeightToHeadMax: .8,
      eyesMinGap: .5, symmetryTolerance: .25, earPeakRise: [.3, 2],
      eyesMaxSize: [1.5, 1.5, .8], eyesBelowNoseTolerance: .4,
      earWidthToHeadMax: .75, earSpanToHeadMax: 1.4, earDepthToHeadMax: 1.25, earHeightToHeadMax: 1.5,
    };
    return freeze({ version: 1, subject: 'Fox', stock: ledger, remaining: chassis.remaining, available, chassis, shoulderPorts, obstacles, goals });
  } catch { return null; }
}

function proposalCopy(proposal: FoxImprovProposal): FoxImprovProposal {
  if (!proposal || typeof proposal !== 'object' || typeof proposal.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(proposal.id) ||
      (proposal.description !== undefined && (typeof proposal.description !== 'string' || proposal.description.length > 1000)) ||
      !Array.isArray(proposal.operations) || !proposal.operations.length || proposal.operations.length > 24 ||
      ![0, 90, 180, 270].includes(proposal.rootRotation ?? 0)) throw Error('Invalid or unbounded Fox improvisation proposal.');
  const operations = proposal.operations.map((op, i) => {
    if (!op || !GENERATED_ROLES.includes(op.role) || typeof op.partId !== 'string' || op.partId.length > 80 || !eligible(op.partId) ||
        typeof op.parentPort !== 'string' || op.parentPort.length > 80 || typeof op.childPort !== 'string' || op.childPort.length > 80 ||
        !Number.isSafeInteger(op.parent) || !Number.isFinite(op.twist) || Math.abs(op.twist) > 180 ||
        (i ? op.parent < 0 || op.parent >= i : op.parent !== -1 || op.twist !== 0 || op.role !== 'neck')) throw Error('Invalid Fox improvisation operation or semantic role.');
    return { partId: op.partId, parent: op.parent, parentPort: op.parentPort, childPort: op.childPort, twist: op.twist, role: op.role };
  });
  if (GENERATED_ROLES.some(role => !operations.some(op => op.role === role))) throw Error('Fox improvisation needs all eight semantic anatomy roles.');
  const a = proposal.attachment;
  if (!a || !Number.isSafeInteger(a.parentPart) || a.parentPart < 0 || typeof a.parentPort !== 'string' || a.parentPort.length > 80 || typeof a.childPort !== 'string' || a.childPort.length > 80 || !Number.isFinite(a.twist) || Math.abs(a.twist) > 180) throw Error('Invalid shoulder attachment boundary.');
  if (proposal.requiredContacts !== undefined && (!Array.isArray(proposal.requiredContacts) || proposal.requiredContacts.length > 120 || proposal.requiredContacts.some(c => !c || !Number.isSafeInteger(c.a) || !Number.isSafeInteger(c.b) || c.a < 0 || c.b < 0 || c.a === c.b || c.a >= operations.length || c.b >= operations.length || typeof c.aPort !== 'string' || c.aPort.length > 80 || typeof c.bPort !== 'string' || c.bPort.length > 80))) throw Error('Invalid proposed required contacts.');
  return { id: proposal.id, description: proposal.description, rootRotation: proposal.rootRotation ?? 0, attachment: { parentPart: a.parentPart, parentPort: a.parentPort, childPort: a.childPort, twist: a.twist }, operations,
    requiredContacts: proposal.requiredContacts?.map(c => ({ a: c.a, b: c.b, aPort: c.aPort, bPort: c.bPort })) };
}

/** Compiles a fresh compound head-neck recipe, then uses the unchanged composer
 * to bill it and nine fixed modules to the same stock. Throws on every failure;
 * no fitting mutation, trimming, generation call or partial result exists. */
export function composeFoxImprovisation(context: FoxImprovContext, proposal: FoxImprovProposal): AssemblyComposition {
  if (!context || context.version !== 1 || context.subject !== 'Fox') throw Error('Invalid Fox improvisation context.');
  const current = createFoxImprovContext(context.stock);
  if (!current || JSON.stringify(current.chassis) !== JSON.stringify(context.chassis)) throw Error('Fox improvisation chassis context was changed or is no longer stock-valid.');
  const p = proposalCopy(proposal), a = p.attachment;
  if (!current.shoulderPorts.some(port => port.parentPart === a.parentPart && port.parentPort === a.parentPort)) throw Error('Attach only to an exposed actual shoulder stud.');
  const root = definition(parsePartId(p.operations[0].partId)!).ports.find(port => port.id === a.childPort);
  if (!root || root.kind !== 'grip') throw Error('The proposed root needs an actual compatible child grip.');
  const program = { name: 'Fox improvised head and neck', description: p.description ?? 'Fresh compound Fox anatomy using exact connector operations.', rootRotation: p.rootRotation, operations: p.operations, requiredContacts: p.requiredContacts ?? [] };
  compileConnections(program, current.available);
  // Keep the complete 64-character proposal ID while fitting the unchanged
  // kernel's 80-character option-ID bound. Route detection uses the plan ID.
  const node: AssemblyNode = { id: 'head-neck', option: { id: `head-neck:${p.id}`, role: 'head-neck', program }, attachment: { parent: 'chest', ...a } };
  const plan: AssemblyPlan = { id: `animal-improv:fox:${p.id}`, name: 'Fox', description: 'Static Fox with a fixed stock-valid chassis and freshly proposed compound head and neck; visual recognition is checked separately.', nodes: [...structuredClone(current.chassis.plan.nodes), node] };
  const result = composeModules(plan, current.stock, { minParts: 20, maxParts: 80 });
  const issues = foxImprovIssues(result);
  if (issues.length) throw Error(issues.join('\n'));
  return result;
}

/** Phenotype sampling only. Exact frame solids still control clutch/collision.
 * Curve/round render masks are nominal visual approximations, not physics. */
function visualBodies(parts: Placed[]) {
  return parts.map(p => {
    const k = parsePartId(p.partId)!, d = definition(k);
    return { k, f: frame(p), span: [0, 1, 2].map(i => Math.max(...d.boxes.map(b => b.max[i]))) };
  });
}
function occupied(bodies: ReturnType<typeof visualBodies>, point: V3): boolean {
  return bodies.some(({ k, f, span }) => {
    if (!f.solids.some(s => solidContains(s, point))) return false;
    const q = point.map((n, i) => n - f.translation[i]);
    const local = [0, 1, 2].map(i => f.rotation[i] * q[0] + f.rotation[3 + i] * q[1] + f.rotation[6 + i] * q[2]);
    if (k.type === 'curve') {
      const run = Math.max(0, Math.min(span[1], local[1])), t = run / (1 + Math.sqrt(1 + (span[1] - 2) * run));
      return local[2] <= span[2] - (span[2] - 1.6) * (1 - t) ** 2 + 1e-5;
    }
    if (['roundbrick', 'roundplate', 'roundtile', 'cone'].includes(k.type)) {
      const base = Math.min(span[0], span[1]) / 2, radius = k.type === 'cone' ? base + (6 - base) * Math.max(0, Math.min(1, local[2] / span[2])) : base;
      return (local[0] - span[0] / 2) ** 2 + (local[1] - span[1] / 2) ** 2 <= radius ** 2 + 1e-5;
    }
    return true;
  });
}
function earProfile(parts: Placed[]) {
  const b = bounds(parts), bodies = visualBodies(parts), layer = (height: number) => {
    const points: V3[] = [], mask: boolean[] = [];
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) {
      const point: V3 = [(b.min[0] + b.size[0] * (x + .5) / 12) * 20, (b.min[1] + b.size[1] * (y + .5) / 12) * 20, (b.min[2] + b.size[2] * height) * 20];
      const present = occupied(bodies, point);
      mask.push(present);
      if (present) points.push(point);
    }
    return { area: points.length, x: points.reduce((n, p) => n + p[0] / 20, 0) / points.length, mask };
  };
  return { lower: layer(.15), upper: layer(.85) };
}

/** Actual relationships, not an authored head lookup or universal part IDs. */
export function foxImprovIssues(c: AssemblyComposition): string[] {
  if (!c?.plan || !c.build || c.plan.name !== 'Fox' || c.build.name !== 'Fox' || typeof c.plan.id !== 'string' || !/^animal-improv:fox:[a-z0-9][a-z0-9_-]{0,63}$/.test(c.plan.id) || c.plan.id === 'animal-improv:fox:chassis') return ['Unsupported or noncanonical Fox improvisation.'];
  const issues: string[] = [];
  try {
    if (!Array.isArray(c.build.steps) || !c.build.steps.length || c.build.steps.length > 80 || !Array.isArray(c.receipts) || !Array.isArray(c.plan.nodes) || c.plan.nodes.length !== 10 || c.receipts.length !== 10) return ['Fox improvisation needs nine fixed modules and one compound head-neck.'];
    let total = 0;
    for (const step of c.build.steps) if (!Array.isArray(step?.parts) || (total += step.parts.length) > 80) return ['Unbounded Fox improvisation parts.'];
    const all = allParts(c), expectedRoles = [...FIXED_ROLES, 'head-neck'];
    if (total < 20 || expectedRoles.some(role => c.plan.nodes.filter(n => n.id === role && n.option.role === role).length !== 1 || c.receipts.filter(r => r.id === role && r.role === role).length !== 1)) return ['Missing fixed or compound anatomical ownership.'];
    if (c.receipts.some(r => !Array.isArray(r.indices) || r.indices.length > 80)) return ['Invalid improvisation receipt.'];
    const indices = c.receipts.flatMap(r => r.indices);
    if (indices.length !== total || new Set(indices).size !== total || indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= total)) return ['Every improvisation part must be owned exactly once.'];
    const have = count(all), ledger = stockCopy(c.remaining);
    if (!ledger) return ['Invalid remaining improvisation stock.'];
    for (const [id, n] of Object.entries(have)) ledger[id] = (ledger[id] ?? 0) + n;
    const original = createFoxImprovContext(ledger);
    if (!original) return ['Improvisation no longer has a stock-valid fixed chassis.'];
    for (const r of c.receipts) {
      const node = c.plan.nodes.find(n => n.id === r.id)!, used = count(r.indices.map(i => all[i]));
      if (r.optionId !== node.option.id || Object.keys(used).length !== Object.keys(r.cost).length || Object.entries(used).some(([id, n]) => r.cost[id] !== n) || node.option.program.operations.length !== r.indices.length || node.option.program.operations.some((op, i) => op.partId !== all[r.indices[i]].partId)) issues.push('Improvisation needs exact receipt costs and option identity.');
      if (r.id !== 'head-neck' && JSON.stringify(node) !== JSON.stringify(original.chassis.plan.nodes.find(n => n.id === r.id))) issues.push('The fixed Fox chassis recipe must be preserved.');
    }
    const compound = c.plan.nodes.find(n => n.id === 'head-neck')!, receipt = c.receipts.find(r => r.id === 'head-neck')!;
    const ops = compound.option.program.operations as FoxImprovOperation[];
    if (ops.length > 24 || ops.some(op => !GENERATED_ROLES.includes(op.role)) || GENERATED_ROLES.some(role => !ops.some(op => op.role === role)) || ops[0].role !== 'neck') return [...issues, 'Compound anatomy needs bounded neck/head/muzzle/nose/eye/ear operation roles.'];
    const a = compound.attachment;
    if (!a || a.parent !== 'chest' || !original.shoulderPorts.some(p => p.parentPart === a.parentPart && p.parentPort === a.parentPort)) issues.push('Compound anatomy must use the actual shoulder boundary.');
    // Recomposition proves physics, original contacts, fixed poses and ledger.
    const replay = composeModules(c.plan, ledger, { minParts: 20, maxParts: 80 });
    if (JSON.stringify(replay.build) !== JSON.stringify(c.build) || JSON.stringify(replay.receipts) !== JSON.stringify(c.receipts) || JSON.stringify(replay.remaining) !== JSON.stringify(c.remaining)) issues.push('Improvisation must preserve its compiled rigid poses, ordering, contacts and exact ledger.');
    if (all.some(p => !eligible(p.partId))) issues.push('Only manufactured supported parts can enter an improvisation.');
    const pp = (role: string) => FIXED_ROLES.includes(role) ? c.receipts.find(r => r.role === role)!.indices.map(i => all[i]) : ops.flatMap((op, i) => op.role === role ? [all[receipt.indices[i]]] : []);
    const b = (role: string) => bounds(pp(role)), whole = bounds(all), body = bounds([...pp('chest'), ...pp('torso'), ...pp('hips')]);
    if (!Array.isArray(c.size) || c.size.length !== 3 || c.size.some((v, i) => !Number.isFinite(v) || !close(v, whole.size[i])) || whole.size.some(v => v > 24)) issues.push('Improvisation bounds must be finite extents in studs within 24.');
    const head = b('head'), neck = b('neck'), muzzle = b('muzzle'), nose = b('nose'), g = original.goals;
    for (const [value, range] of [[head.size[0], g.headWidth], [head.size[1], g.headDepth], [head.size[2], g.headHeight], [neck.size[2], g.neckHeight]] as [number, [number, number]][]) if (value < range[0] - 1e-5 || value > range[1] + 1e-5) issues.push('Fox head and neck must remain short and proportionate.');
    if (Math.abs(head.center[0] - body.center[0]) > g.symmetryTolerance || neck.size[0] > body.size[0] || !joined(pp('neck'), pp('chest')) || !joined(pp('head'), pp('neck'))) issues.push('Fox head needs a centered, supported short neck at the shoulders.');
    const eyeParts = [pp('eye-left'), pp('eye-right')], eyes = eyeParts.map(bounds);
    if (eyeParts.some(parts => parts.some(p => !DARK.has(parsePartId(p.partId)!.color)) || !joined(parts, pp('head'))) || eyes.some(e => e.size.some((v, i) => v > g.eyesMaxSize[i])) || eyes[1].min[0] - eyes[0].max[0] < g.eyesMinGap || Math.abs((eyes[0].center[0] + eyes[1].center[0]) / 2 - head.center[0]) > g.symmetryTolerance || !close(eyes[0].center[1], eyes[1].center[1], g.symmetryTolerance) || !close(eyes[0].center[2], eyes[1].center[2], g.symmetryTolerance)) issues.push('Fox needs separated symmetric dark eyes on actual head supports.');
    const projection = Math.min(...eyes.map(e => e.min[1])) - Math.min(muzzle.min[1], nose.min[1]);
    if (pp('nose').some(p => !DARK.has(parsePartId(p.partId)!.color)) || !close(nose.min[1], Math.min(muzzle.min[1], nose.min[1])) || !joined(pp('nose'), pp('muzzle')) || !joined(pp('muzzle'), pp('head')) || projection < g.muzzleProjection[0] || projection > g.muzzleProjection[1] || Math.abs(muzzle.center[0] - head.center[0]) > g.symmetryTolerance || muzzle.size[0] > head.size[0] * g.muzzleWidthToHeadMax || bounds([...pp('muzzle'), ...pp('nose')]).size[2] > head.size[2] * g.muzzleHeightToHeadMax || eyes.some(e => e.min[2] < nose.max[2] - g.eyesBelowNoseTolerance)) issues.push('Fox needs a supported thin projecting muzzle with a dark front nose.');
    const earParts = [pp('ear-left'), pp('ear-right')], ears = earParts.map(bounds), profiles = earParts.map(earProfile);
    const asymmetric = (['lower', 'upper'] as const).some(layer => profiles[0][layer].mask.filter((bit, i) => bit !== profiles[1][layer].mask[(11 - Math.floor(i / 12)) * 12 + i % 12]).length > 8);
    if (earParts.some(parts => !joined(parts, pp('head'))) || ears.some(e => e.max[2] - head.max[2] < g.earPeakRise[0] || e.max[2] - head.max[2] > g.earPeakRise[1] || e.size[0] > head.size[0] * g.earWidthToHeadMax || e.size[1] > head.size[1] * g.earDepthToHeadMax || e.size[2] > head.size[2] * g.earHeightToHeadMax) || bounds(earParts.flat()).size[0] > head.size[0] * g.earSpanToHeadMax || !ears[0].size.every((v, i) => close(v, ears[1].size[i], g.symmetryTolerance)) || !close(ears[0].center[1], ears[1].center[1], g.symmetryTolerance) || !close(ears[0].center[2], ears[1].center[2], g.symmetryTolerance) || Math.abs((ears[0].center[0] + ears[1].center[0]) / 2 - head.center[0]) > g.symmetryTolerance || profiles.some(p => !p.upper.area || p.upper.area > p.lower.area * .85) || profiles[1].upper.x - profiles[0].upper.x < .5 || Math.abs((profiles[0].upper.x + profiles[1].upper.x) / 2 - head.center[0]) > g.symmetryTolerance || asymmetric) issues.push('Fox needs paired symmetric alert ear peaks with actual tapered contours above its skull.');
    const feet = ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].map(b), carrier = b('frame');
    for (const [i, role] of ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].entries()) if (!close(feet[i].min[2], 0) || !joined(pp(role), pp('frame'))) issues.push('Four fixed visible legs must remain grounded and connected.');
    const voidMin = [feet[0].max[0], feet[0].max[1], 0], voidMax = [feet[1].min[0], feet[2].min[1], carrier.min[2]];
    if (all.some(p => frame(p).solids.some(s => [0, 1, 2].every(i => Math.min(s.bounds.max[i] / 20, voidMax[i]) - Math.max(s.bounds.min[i] / 20, voidMin[i]) > 1e-5)))) issues.push('Fox improvisation must preserve the visible open belly.');
    const tail = b('tail');
    if (!joined(pp('tail'), pp('hips')) || tail.max[1] - body.max[1] < body.size[1] * .25 || tail.size[0] < body.size[0] * .35) issues.push('The substantial fixed rear tail must remain attached.');
  } catch { issues.push('Invalid or physically rejected Fox improvisation.'); }
  return [...new Set(issues)];
}
