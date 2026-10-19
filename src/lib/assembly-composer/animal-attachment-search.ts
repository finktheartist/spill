import { parsePartId, type Build, type Placed } from '../bricks';
import { isMade, isRealSize } from '../catalog';
import { attachPart, axisAngle, connectionPairs, definition, frame, validateConnections, type Box, type ConnectionOperation, type Frame } from '../connections';
import type { WholeAnimalConnection, WholeAnimalConnectionIntent } from '../shape-first/whole-animal-connections';
import type { WholeAnimalLayout, WholeAnimalRole } from './animal-whole';

export interface AnimalAttachmentRequest extends ConnectionOperation { role: WholeAnimalRole; parents?: number[] }
export interface AnimalAttachmentSearchOptions {
  maxMillis?: number; maxAttempts?: number; beamWidth?: number; maxChanges?: number; signal?: AbortSignal;
  /** LOWER is better. Parts remain in source order; added counts new requests.
   * Ranking sees hypothetical partial poses, not accepted physical candidates. */
  score?: (layout: WholeAnimalLayout, added: number) => number;
  /** Called only for a complete, physically valid batch, in ranked order. */
  validate?: (layout: WholeAnimalLayout, intent: WholeAnimalConnectionIntent) => string[];
}
export interface AnimalAttachmentSearchResult {
  intent?: WholeAnimalConnectionIntent; layout?: WholeAnimalLayout;
  attempts: number; exhausted: boolean; reason?: string;
  /** index is zero-based in the COMPLETE returned intent, including prefix. */
  changes?: { index: number; requested: ConnectionOperation; resolved: ConnectionOperation }[];
  /** Failure-only diagnostic: lowest finite score among complete, physically
   * valid batches rejected by validate. Never an accepted candidate; omitted
   * on success or cancellation. Layout and intent preserve source order. */
  rejectedComplete?: { accepted: false; layout: WholeAnimalLayout; intent: WholeAnimalConnectionIntent; issues: string[]; score: number };
}

type Changes = NonNullable<AnimalAttachmentSearchResult['changes']>;
type RejectedComplete = NonNullable<AnimalAttachmentSearchResult['rejectedComplete']>;
type State = { operations: WholeAnimalConnection[]; parts: Placed[]; frames: Frame[]; remaining: Record<string, number>; occupied: Set<string>; changes: Changes };
type Candidate = { state: State; operation: WholeAnimalConnection; part: Placed; frame: Frame; change?: Changes[number]; score: number; risk: number; key: string; order: number };
const ROLES: WholeAnimalRole[] = ['frame', 'chest', 'hips', 'torso', 'tail', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right', 'neck', 'head', 'muzzle', 'nose', 'eye-left', 'eye-right', 'ear-left', 'ear-right'];
const ROTS = [0, 90, 180, 270] as const, TWISTS = [0, 90, -90, -180];
const EPS = 1e-5, MAX_WORK = 8_000_000;
const twist = (n: number) => ((n + 180) % 360 + 360) % 360 - 180;
const opCopy = (op: ConnectionOperation): ConnectionOperation => ({ partId: op.partId, parent: op.parent, parentPort: op.parentPort, childPort: op.childPort, twist: op.twist });
const connectionCopy = (op: WholeAnimalConnection): WholeAnimalConnection => ({ ...opCopy(op), role: op.role });
const changed = (a: ConnectionOperation, b: ConnectionOperation) => a.parent !== b.parent || a.parentPort !== b.parentPort || a.childPort !== b.childPort || twist(a.twist) !== twist(b.twist);
class Stopped extends Error { constructor(readonly exhausted: boolean, message: string) { super(message); } }
function integer(n: number | undefined, fallback: number, cap: number, name: string) {
  const value = n ?? fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`${name} must be a nonnegative safe integer.`);
  return Math.min(value, cap);
}
function supported(id: string) {
  const k = parsePartId(id);
  if (!k || !isMade(id) || !isRealSize(k.type, k.w, k.d)) throw Error(`Unsupported manufactured attachment part: ${id}.`);
  const d = definition(k);
  if (!d.ports.length || d.ports.length > 512) throw Error('Unsupported or unbounded attachment connector definition.');
  return d;
}
function operation(op: WholeAnimalConnection, index: number) {
  if (!op || typeof op.partId !== 'string' || op.partId.length > 80 || !ROLES.includes(op.role) || !Number.isSafeInteger(op.parent) ||
      typeof op.parentPort !== 'string' || typeof op.childPort !== 'string' || Math.max(op.parentPort.length, op.childPort.length) > 80 ||
      ![0, 90, -90, 180, -180, 270, -270].includes(op.twist)) throw Error(`Invalid attachment operation ${index}.`);
  supported(op.partId);
  return connectionCopy(op);
}
function upright(f: Frame) {
  const rot = ROTS.find(rot => { const r = axisAngle([0, 0, 1], rot); return f.rotation.every((n, a) => Math.abs(n - r[a]) < 1e-6); });
  if (rot === undefined) throw Error('Attachment search supports actual upright quarter-turn poses only.');
  return rot;
}
function extents(ff: Frame[]) {
  const min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a]))), max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])));
  if (max.some((n, a) => !Number.isFinite(n) || n - min[a] > 24 * 20 + EPS)) throw Error('Attachment batch exceeds 24 studs on an axis.');
  return { min, max };
}
function layout(operations: WholeAnimalConnection[], pp: Placed[], ff: Frame[]): WholeAnimalLayout {
  const { min } = extents(ff);
  return { id: 'attachment-search', description: 'Explicit attachment-search proposal; complete request batch, not an accepted whole animal.',
    parts: pp.map((p, i) => {
      const z = (ff[i].bounds.min[2] - min[2]) / 20;
      if (Math.abs(z / .4 - Math.round(z / .4)) > 1e-6) throw Error('Attachment result does not fit .4-stud height layers.');
      return { partId: p.partId, role: operations[i].role, x: (ff[i].bounds.min[0] - min[0]) / 20, y: (ff[i].bounds.min[1] - min[1]) / 20, z, rot: upright(ff[i]) };
    }) };
}
const frameKey = (operations: WholeAnimalConnection[], ff: Frame[]) => JSON.stringify(ff.map((f, i) => [operations[i].partId, operations[i].role, ...f.rotation, ...f.translation]));
function broad(f: Frame): Box {
  const boxes = [f.bounds, ...f.studs.map(s => s.solid.bounds)];
  return { min: [0, 1, 2].map(a => Math.min(...boxes.map(b => b.min[a]), ...f.ports.map(p => p.point[a]))) as Box['min'],
    max: [0, 1, 2].map(a => Math.max(...boxes.map(b => b.max[a]), ...f.ports.map(p => p.point[a]))) as Box['max'] };
}
const near = (a: Box, b: Box) => [0, 1, 2].every(i => a.max[i] >= b.min[i] - EPS && b.max[i] >= a.min[i] - EPS);
function physics(pp: Placed[], operations: WholeAnimalConnection[], stock: Record<string, number>, check: () => void, rejected?: (reason: string) => void): string[] {
  const ff = pp.map(frame), { min } = extents(ff), shifted = pp.map(p => ({ ...p, x: p.x - min[0] / 20, y: p.y - min[1] / 20, z: p.z - min[2] / 8 }));
  const first = ff.findIndex(f => Math.abs(f.bounds.min[2] - min[2]) < EPS), order = [first], seen = new Set(order);
  for (let cursor = 0; cursor < order.length; cursor++) {
    check();
    for (let i = 0; i < pp.length; i++) if (!seen.has(i) && connectionPairs(ff[order[cursor]], ff[i]).length) { seen.add(i); order.push(i); }
  }
  if (order.length !== pp.length) return ['Attachment batch has no single real connector graph.'];
  const remap = new Map(order.map((original, final) => [original, final]));
  const build: Build = { name: 'Attachment batch', description: 'Exact complete batch physics check', engine: 'connections-v2',
    steps: order.map(i => ({ caption: 'Ground-first actual connector traversal', parts: [shifted[i]] })),
    requiredContacts: operations.flatMap((op, i) => i ? [{ a: remap.get(op.parent)!, b: remap.get(i)!, aPort: op.parentPort, bPort: op.childPort }] : []) };
  check();
  const issues = validateConnections(build, stock, 24).map(i => i.message);
  if (issues.length) rejected?.(issues[0]);
  check();
  return issues;
}
function occupancy(ff: Frame[], check: () => void) {
  const used = new Set<string>();
  for (let a = 0; a < ff.length; a++) for (let b = 0; b < a; b++) {
    check();
    for (const [aPort, bPort] of connectionPairs(ff[a], ff[b])) { used.add(`${a}/${aPort}`); used.add(`${b}/${bPort}`); }
  }
  return used;
}
/** Each ancestor state has already passed physics. Broad bounds only skip
 * provably disjoint pairs; overlapping slope bounds go to the unchanged exact
 * validator. Actual incidental contacts, not just tree ports, reserve sockets. */
function extend(candidate: Candidate, stock: Record<string, number>, check: () => void): State | undefined {
  const s = candidate.state, index = s.parts.length, occupied = new Set(s.occupied), childMates = new Map<string, number>(), cb = broad(candidate.frame);
  for (const [j, f] of s.frames.entries()) {
    check();
    if (!near(cb, broad(f))) continue;
    for (const [childPort, parentPort] of connectionPairs(candidate.frame, f)) {
      if (s.occupied.has(`${j}/${parentPort}`) || childMates.has(childPort) && childMates.get(childPort) !== j) return undefined;
      childMates.set(childPort, j); occupied.add(`${j}/${parentPort}`); occupied.add(`${index}/${childPort}`);
    }
    const pair = [s.parts[j], candidate.part], ff = [f, candidate.frame], min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a])));
    const shifted = pair.map(p => ({ ...p, x: p.x - min[0] / 20, y: p.y - min[1] / 20, z: p.z - min[2] / 8 }));
    const issues = validateConnections({ name: 'Attachment pair', description: 'Exact collision broadphase follow-up', engine: 'connections-v2', steps: shifted.map(p => ({ caption: 'Pair check', parts: [p] })) }, stock, 24);
    check();
    if (issues.some(i => i.kind !== 'floating' && i.kind !== 'loose')) return undefined;
  }
  const remaining = { ...s.remaining }; remaining[candidate.part.partId]--;
  return { operations: [...s.operations, candidate.operation], parts: [...s.parts, candidate.part], frames: [...s.frames, candidate.frame], remaining, occupied,
    changes: candidate.change ? [...s.changes, candidate.change] : [...s.changes] };
}

/** Explicit SEARCH semantics: request joins are preferences; part IDs, roles,
 * allowed parents and the fixed prefix are immutable constraints. Returns only
 * a fully placed, exact-stock, physically valid REQUEST BATCH, never an animal
 * acceptance or partial result. Complete callbacks receive isolated snapshots.
 * Failure may include one separately labelled, externally rejected complete
 * batch for diagnostics, never in the top-level intent/layout fields.
 * Synchronous callbacks/validator calls cannot be preempted; a late result is
 * rejected immediately after they return. No generation or mutable cache.
 */
export function searchAnimalAttachments(stock: Record<string, number>, prefix: WholeAnimalConnectionIntent, requests: AnimalAttachmentRequest[], opts: AnimalAttachmentSearchOptions = {}): AnimalAttachmentSearchResult {
  let attempts = 0, limited = false, lastCompleteRejection = '';
  let bestRejectedComplete: RejectedComplete | undefined;
  const fail = (reason: string, exhausted = false, includeRejected = true): AnimalAttachmentSearchResult => ({ attempts, exhausted,
    reason: exhausted && lastCompleteRejection && !reason.includes(lastCompleteRejection)
      ? `${reason.slice(0, 600)} Last complete validation: ${lastCompleteRejection.slice(0, 850)}` : reason.slice(0, 1500),
    ...(includeRejected && bestRejectedComplete ? { rejectedComplete: structuredClone(bestRejectedComplete) } : {}) });
  try {
    if (!opts || typeof opts !== 'object') throw Error('Provide bounded attachment search options.');
    const maxAttempts = integer(opts.maxAttempts, 2000, 12000, 'maxAttempts'), beamWidth = integer(opts.beamWidth, 4, 8, 'beamWidth'), maxChanges = integer(opts.maxChanges, 3, 6, 'maxChanges');
    const millis = opts.maxMillis ?? 1500;
    if (!Number.isFinite(millis) || millis < 0 || opts.score !== undefined && typeof opts.score !== 'function' || opts.validate !== undefined && typeof opts.validate !== 'function') throw Error('Invalid attachment deadline or callback.');
    const deadline = performance.now() + Math.min(millis, 5000);
    const check = () => {
      if (opts.signal?.aborted) throw new Stopped(false, 'Attachment search cancelled.');
      if (performance.now() >= deadline) throw new Stopped(true, 'Attachment search time budget exhausted.');
    };
    check();
    if (!maxAttempts || !beamWidth) return fail('Attachment search has a zero attempt/beam budget.', true);
    if (!stock || typeof stock !== 'object' || Array.isArray(stock)) throw Error('Provide an exact attachment stock ledger.');
    const entries = Object.entries(stock);
    if (entries.length > 1024 || entries.some(([id, n]) => id.length > 80 || !Number.isSafeInteger(n) || n < 0)) throw Error('Invalid or unbounded attachment stock counts.');
    const ledger = Object.fromEntries(entries);
    if (!prefix || !ROTS.includes(prefix.rootRotation) || !Array.isArray(prefix.operations) || !Array.isArray(requests) || prefix.operations.length + requests.length > 80 || !prefix.operations.length && !requests.length) throw Error('Provide a bounded 1–80-operation prefix plus request batch.');
    const fixed = prefix.operations.map(operation), batch = requests.map((request, j) => {
      const op = operation(request, fixed.length + j), index = fixed.length + j;
      const parents = request.parents === undefined ? [op.parent] : request.parents;
      if (!Array.isArray(parents) || parents.length > 80 || parents.some(p => !Number.isSafeInteger(p) || (index ? p < 0 || p >= index : p !== -1))) throw Error(`Invalid allowed parent indices for request ${j}.`);
      return { operation: op, parents: [...new Set(parents)] };
    });
    const fullCost: Record<string, number> = {};
    let portWork = 0, ports = 0;
    for (const op of [...fixed, ...batch.map(b => b.operation)]) {
      check();
      const n = fullCost[op.partId] = (fullCost[op.partId] ?? 0) + 1;
      if (!Object.hasOwn(ledger, op.partId) || ledger[op.partId] < n) throw Error(`Attachment batch exhausts exact stock for ${op.partId}.`);
      const p = supported(op.partId).ports.length; portWork += p * ports; ports += p;
    }
    if (portWork > MAX_WORK) throw Error('Attachment input exceeds the bounded connector-work budget.');
    const pp: Placed[] = [], remaining = { ...ledger };
    for (const [i, op] of fixed.entries()) {
      check();
      if (!i && (op.parent !== -1 || op.parentPort !== '' || op.childPort !== '' || op.twist !== 0) || i && (op.parent < 0 || op.parent >= i)) throw Error('Fixed prefix has an invalid root or earlier-parent binding.');
      const p = i ? attachPart(pp[op.parent], op.parentPort, op.partId, op.childPort, twist(op.twist)) : { partId: op.partId, x: 0, y: 0, z: 0, rot: prefix.rootRotation };
      upright(frame(p)); pp.push(p); remaining[op.partId]--;
    }
    if (pp.length) {
      const issues = physics(pp, fixed, ledger, check);
      if (issues.length) return fail(`Fixed prefix failed unchanged physics: ${issues.join('; ').slice(0, 1200)}`);
      layout(fixed, pp, pp.map(frame));
    }
    const frames = pp.map(frame), initial: State = { operations: fixed, parts: pp, frames, remaining, occupied: occupancy(frames, check), changes: [] };
    let rejection = '';
    const completed = new Set<string>();
    const rank = (a: Candidate, b: Candidate) => a.score - b.score || (a.state.changes.length + Number(!!a.change)) - (b.state.changes.length + Number(!!b.change)) || a.risk - b.risk || a.order - b.order;
    const accept = (s: State, score: number): AnimalAttachmentSearchResult | undefined => {
      check();
      const physical = frameKey(s.operations, s.frames);
      if (completed.has(physical)) return undefined;
      completed.add(physical);
      const issues = physics(s.parts, s.operations, ledger, check, reason => { lastCompleteRejection = `Physics: ${reason}`; });
      if (issues.length) { rejection = issues[0]; return undefined; }
      const target = layout(s.operations, s.parts, s.frames), intent = { rootRotation: prefix.rootRotation, operations: s.operations.map(connectionCopy) };
      if (opts.validate) {
        let reasons: string[];
        try { reasons = opts.validate(structuredClone(target), structuredClone(intent)); }
        catch (e) { lastCompleteRejection = `Validator threw: ${e instanceof Error ? e.message.slice(0, 800) : 'invalid callback'}`; check(); throw e; }
        if (!Array.isArray(reasons) || reasons.length > 32 || Array.from(reasons).some(r => typeof r !== 'string' || r.length > 1000)) throw Error('Attachment validator must return bounded string reasons.');
        // Retain bounded diagnostic evidence even when the synchronous callback
        // runs past its deadline; it can never make that late candidate valid.
        if (reasons.length) {
          lastCompleteRejection = `Validator: ${reasons[0]}`;
          if (!bestRejectedComplete || score < bestRejectedComplete.score) {
            // Use our authoritative poses/program, not the mutable copies
            // provided to the callback. Retain at most one bounded snapshot.
            bestRejectedComplete = structuredClone({ accepted: false as const, layout: target, intent, issues: reasons, score });
          }
        }
        check();
        if (reasons.length) { rejection = reasons[0]; return undefined; }
      }
      check();
      return { intent, layout: target, attempts, exhausted: false, changes: structuredClone(s.changes) };
    };
    if (!batch.length) {
      let score = 0;
      if (opts.score) {
        score = opts.score(structuredClone(layout(initial.operations, initial.parts, initial.frames)), 0); check();
        if (!Number.isFinite(score)) throw Error('Attachment score must be finite (lower is better).');
      }
      return accept(initial, score) ?? fail(`Complete prefix rejected: ${rejection}`);
    }
    const makeCandidate = (s: State, resolved: WholeAnimalConnection, part: Placed, addedIndex: number, order: number): Candidate | undefined => {
      check();
      const preferred = batch[addedIndex].operation, index = fixed.length + addedIndex;
      const diff = changed(preferred, resolved), change: Changes[number] | undefined = diff ? { index, requested: opCopy(preferred), resolved: opCopy(resolved) } : undefined;
      if (s.changes.length + Number(diff) > maxChanges) return undefined;
      const f = frame(part), ff = [...s.frames, f], ops = [...s.operations, resolved];
      let target: WholeAnimalLayout;
      try { upright(f); target = layout(ops, [...s.parts, part], ff); } catch { return undefined; }
      let score = s.changes.length + Number(diff);
      if (opts.score) { score = opts.score(structuredClone(target), addedIndex + 1); check(); if (!Number.isFinite(score)) throw Error('Attachment score must be finite (lower is better).'); }
      const risk = s.frames.reduce((n, other) => n + [0, 1, 2].reduce((v, a) => v * Math.max(0, Math.min(f.bounds.max[a], other.bounds.max[a]) - Math.max(f.bounds.min[a], other.bounds.min[a])), 1), 0);
      return { state: s, operation: resolved, part, frame: f, change, score, risk, key: frameKey(ops, ff), order };
    };
    // Follow exact preferences first. If only a late join is bad, search its
    // suffix from the already valid preferred state before reopening earlier
    // choices. A failed suffix can still fall back to the full bounded beam.
    let preferredState = initial, preferredScore = 0, matched = 0;
    for (const [j, request] of batch.entries()) {
      check();
      const op = request.operation, index = fixed.length + j;
      if (!request.parents.includes(op.parent) || index && preferredState.occupied.has(`${op.parent}/${op.parentPort}`)) break;
      if (!index && (op.parent !== -1 || op.parentPort !== '' || op.childPort !== '' || op.twist !== 0)) break;
      if (attempts >= maxAttempts) return fail('Attachment search attempt budget exhausted.', true);
      attempts++;
      let part: Placed;
      try { part = index ? attachPart(preferredState.parts[op.parent], op.parentPort, op.partId, op.childPort, twist(op.twist)) : { partId: op.partId, x: 0, y: 0, z: 0, rot: prefix.rootRotation }; } catch { break; }
      const candidate = makeCandidate(preferredState, { ...op, twist: twist(op.twist) }, part, j, 0);
      if (!candidate) break;
      const next = extend(candidate, ledger, check); if (!next) break;
      preferredState = next; preferredScore = candidate.score; matched++;
    }
    if (matched === batch.length) { const result = accept(preferredState, preferredScore); if (result) return result; }
    const searchFrom = (start: State, firstAdded: number): AnimalAttachmentSearchResult => {
    let beam = [start];
    for (const [addedIndex, request] of batch.entries()) {
      if (addedIndex < firstAdded) continue;
      check();
      const preferred = request.operation, index = fixed.length + addedIndex, shortlist: Candidate[] = [], dedup = new Map<string, Candidate>();
      const shortlistLimit = Math.min(64, Math.max(16, beamWidth * 8));
      // Reserve attempt capacity for later requests. Truncating an early join
      // search cannot spend the entire batch budget before any complete path.
      const stepLimit = Math.max(1, Math.floor((maxAttempts - attempts) / (batch.length - addedIndex))), stepStart = attempts;
      let serial = 0;
      const consider = (s: State, resolved: WholeAnimalConnection, part: Placed) => {
        check();
        const candidate = makeCandidate(s, resolved, part, addedIndex, serial++); if (!candidate) return;
        const old = dedup.get(candidate.key);
        if (old && rank(old, candidate) <= 0) return;
        if (old) shortlist.splice(shortlist.indexOf(old), 1);
        shortlist.push(candidate); dedup.set(candidate.key, candidate); shortlist.sort(rank);
        if (shortlist.length > shortlistLimit) { const last = shortlist.pop()!; dedup.delete(last.key); }
      };
      for (const [stateIndex, s] of beam.entries()) {
        const stateStart = attempts, stateLimit = Math.max(1, Math.floor((stepLimit - (attempts - stepStart)) / (beam.length - stateIndex)));
        const take = () => {
          check();
          if (attempts >= maxAttempts || attempts - stepStart >= stepLimit || attempts - stateStart >= stateLimit) { limited = true; return false; }
          attempts++; return true;
        };
        if (!index) {
          if (!request.parents.includes(-1)) continue;
          if (take()) consider(s, { partId: preferred.partId, role: preferred.role, parent: -1, parentPort: '', childPort: '', twist: 0 }, { partId: preferred.partId, x: 0, y: 0, z: 0, rot: prefix.rootRotation });
          continue;
        }
        const child = supported(preferred.partId), parents = [...request.parents].sort((a, b) => Number(b === preferred.parent) - Number(a === preferred.parent) || a - b);
        enumeration: for (const parent of parents) {
          const pf = s.frames[parent], parentPorts = pf.ports.filter(p => !s.occupied.has(`${parent}/${p.id}`)).sort((a, b) => Number(b.id === preferred.parentPort) - Number(a.id === preferred.parentPort));
          // Scan the preferred child grip/twist across real parent sockets
          // before trying other grips/yaws at just the first parent socket.
          const children = [...child.ports].sort((a, b) => Number(b.id === preferred.childPort) - Number(a.id === preferred.childPort));
          for (const cp of children) for (const angle of [...new Set([twist(preferred.twist), ...TWISTS])]) for (const port of parentPorts) {
              if (cp.kind === port.kind) continue;
              const resolved = { partId: preferred.partId, role: preferred.role, parent, parentPort: port.id, childPort: cp.id, twist: angle };
              if (s.changes.length + Number(changed(preferred, resolved)) > maxChanges) continue;
              if (!take()) break enumeration;
              let part: Placed;
              try { part = attachPart(s.parts[parent], port.id, preferred.partId, cp.id, angle); } catch { continue; }
              consider(s, resolved, part);
          }
        }
      }
      const next: State[] = [];
      for (const candidate of shortlist) {
        check();
        const s = extend(candidate, ledger, check); if (!s) continue;
        if (addedIndex === batch.length - 1) { const result = accept(s, candidate.score); if (result) return result; }
        else { next.push(s); if (next.length >= beamWidth) break; }
      }
      if (!next.length) return fail(`No complete attachment batch passed the bounded search${rejection ? `: ${rejection.slice(0, 1000)}` : ' (ports, stock or exact physics rejected all shortlisted branches).'}`, limited || attempts >= maxAttempts);
      beam = next;
    }
    return fail('No complete attachment batch survived.', limited);
    };
    if (matched > 0 && matched < batch.length) {
      const suffix = searchFrom(preferredState, matched); if (suffix.intent) return suffix;
      check();
    }
    return searchFrom(initial, 0);
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 1500) : 'Attachment search failed closed.', error instanceof Stopped && error.exhausted,
      !(error instanceof Stopped && !error.exhausted));
  }
}
