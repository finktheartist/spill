import type { Build, Placed } from '../bricks';
import { isMade, isRealSize } from '../catalog';
import { parsePartId } from '../bricks';
import {
  attachPart, compileConnections, connectionPairs, frame, validateConnections,
  type RequiredContact,
} from '../connections';
import type {
  AssemblyComposition, AssemblyPlan, AssemblyReceipt, AssemblySearchOptions, AssemblySearchResult,
} from './types';

const MAX_PARTS = 160;
const MAX_NODES = 32;
const EPS = 1e-5;
type Stock = Record<string, number>;
type Bounds = { minParts: number; maxParts: number; limit: number; maxAttempts: number; maxMillis: number };

class BudgetExceeded extends Error {
  constructor() { super('Module composition reached its time budget.'); }
}

function bounded(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 0) throw Error(`${name} must be a nonnegative safe integer.`);
  return Math.min(n, ceiling);
}

function bounds(options: AssemblySearchOptions): Bounds {
  const minParts = bounded(options.minParts, 1, MAX_PARTS, 'minParts');
  const maxParts = bounded(options.maxParts, MAX_PARTS, MAX_PARTS, 'maxParts');
  if ((options.minParts ?? 1) > maxParts || minParts > maxParts) throw Error('The part bounds cannot be satisfied.');
  const maxMillis = options.maxMillis ?? 2000;
  if (!Number.isFinite(maxMillis) || maxMillis < 0) throw Error('maxMillis must be finite and nonnegative.');
  return {
    minParts, maxParts, maxMillis: Math.min(maxMillis, 30000),
    limit: bounded(options.limit, 12, 64, 'limit'),
    maxAttempts: bounded(options.maxAttempts, 128, 3000, 'maxAttempts'),
  };
}

function stockCopy(stock: Stock): Stock {
  if (!stock || typeof stock !== 'object' || Array.isArray(stock)) throw Error('Provide an exact stock ledger.');
  const entries = Object.entries(stock);
  if (entries.some(([, n]) => !Number.isSafeInteger(n) || n < 0)) throw Error('Stock counts must be nonnegative safe integers.');
  return Object.fromEntries(entries);
}

function text(value: unknown, name: string, max = 80): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Provide a short ${name}.`);
}

/** Remove floating point residue only; placements are never fitted to a grid. */
const clean = (n: number) => Math.abs(n) < 1e-9 ? 0 : n;

function compose(
  plan: AssemblyPlan, stock: Stock, options: AssemblySearchOptions, limits: Bounds, check: () => void,
): AssemblyComposition {
  check();
  if (!plan || !Array.isArray(plan.nodes) || !plan.nodes.length || plan.nodes.length > MAX_NODES) {
    throw Error(`Provide 1–${MAX_NODES} assembly nodes.`);
  }
  text(plan.id, 'plan id', 128);
  text(plan.name, 'assembly name');
  if (typeof plan.description !== 'string' || plan.description.length > 1000) throw Error('Provide a short assembly description.');

  // Reserve ALL copies before compiling anything, including repeated options.
  const remaining = { ...stock };
  const receipts: AssemblyReceipt[] = [];
  const earlier = new Map<string, number>();
  let count = 0;
  for (const [index, node] of plan.nodes.entries()) {
    check();
    if (!node || !node.option) throw Error('Every node needs a module option.');
    text(node.id, 'node id');
    text(node.option.id, 'option id');
    text(node.option.role, 'module role');
    if (earlier.has(node.id)) throw Error('Assembly node ids must be unique.');
    if (!index && node.attachment !== undefined) throw Error('Only the first node is the unattached root.');
    if (index) {
      const a = node.attachment;
      const parent = a && earlier.get(a.parent);
      if (!a || parent === undefined) throw Error('An attachment must name an earlier module.');
      if (!Number.isSafeInteger(a.parentPart) || a.parentPart < 0 ||
          a.parentPart >= plan.nodes[parent].option.program.operations.length) throw Error('Attachment parentPart is outside its module.');
      if (typeof a.parentPort !== 'string' || typeof a.childPort !== 'string' ||
          !Number.isFinite(a.twist) || Math.abs(a.twist) > 180) throw Error('Provide exact attachment ports and a twist within -180 to 180 degrees.');
    }
    const program = node.option.program;
    if (!program || !Array.isArray(program.operations) || !program.operations.length || program.operations.length > 80) {
      throw Error('Each module must have 1–80 connection operations.');
    }
    count += program.operations.length;
    if (count > limits.maxParts) throw Error(`Composition exceeds the ${limits.maxParts} part bound.`);
    const cost: Stock = {};
    for (const op of program.operations) {
      const k = op && typeof op.partId === 'string' && parsePartId(op.partId);
      if (!k || !isMade(op.partId) || !isRealSize(k.type, k.w, k.d)) throw Error('Every module part must have an actual manufactured ID.');
      cost[op.partId] = (cost[op.partId] ?? 0) + 1;
      if (!Object.hasOwn(remaining, op.partId) || remaining[op.partId] < 1) throw Error(`Shared stock exhausted for ${op.partId}.`);
      remaining[op.partId]--;
    }
    earlier.set(node.id, index);
    receipts.push({ id: node.id, role: node.option.role, optionId: node.option.id, cost, indices: [] });
  }
  if (count < limits.minParts) throw Error(`Composition is below the ${limits.minParts} part bound.`);

  const parts: Placed[] = [];
  const owners: { node: number; local: number }[] = [];
  const contacts: RequiredContact[] = [];
  for (const [index, node] of plan.nodes.entries()) {
    check();
    const program = node.option.program;
    // Reject an illegal recipe as supplied. No fitting, stock substitution or trimming.
    const localBuild = compileConnections(program, receipts[index].cost);
    check();
    const receipt = receipts[index];
    const a = node.attachment;
    const parentIndex = a ? receipts[earlier.get(a.parent)!].indices[a.parentPart] : undefined;
    for (const [local, op] of program.operations.entries()) {
      check();
      const p = !local
        ? (a ? attachPart(parts[parentIndex!], a.parentPort, op.partId, a.childPort, a.twist)
             : structuredClone(localBuild.steps[0].parts[0]))
        : attachPart(parts[receipt.indices[op.parent]], op.parentPort, op.partId, op.childPort, op.twist);
      // An attached root takes the explicit anchor pose. Replaying the unchanged
      // local recipe rigidly carries every descendant, including fractional/SNOT poses.
      receipt.indices.push(parts.length);
      owners.push({ node: index, local });
      parts.push(p);
    }
    for (const c of program.requiredContacts ?? []) {
      contacts.push({ ...c, a: receipt.indices[c.a], b: receipt.indices[c.b] });
    }
    if (a) contacts.push({ a: parentIndex!, b: receipt.indices[0], aPort: a.parentPort, bPort: a.childPort });
  }

  // Translate once, after every module is in its final pose; underside nodes may
  // legitimately have been below the original root until this point.
  const before = parts.map(frame);
  const minima = [0, 1, 2].map(axis => Math.min(...before.map(f => f.bounds.min[axis])));
  for (const p of parts) {
    p.x = clean(p.x - minima[0] / 20);
    p.y = clean(p.y - minima[1] / 20);
    p.z = clean(p.z - minima[2] / 8);
  }
  const frames = parts.map(frame);
  const links: { other: number; ownPort: string; otherPort: string }[][] = parts.map(() => []);
  for (let i = 0; i < parts.length; i++) {
    check();
    for (let j = 0; j < i; j++) {
      const pairs = connectionPairs(frames[i], frames[j]);
      if (pairs.length) {
        const [ownPort, otherPort] = pairs[0];
        links[i].push({ other: j, ownPort, otherPort });
        links[j].push({ other: i, ownPort: otherPort, otherPort: ownPort });
      }
    }
  }

  // A connected traversal starts at actual ground and gives every subsequent
  // piece an earlier mating connector, even when the original anchor points down.
  const first = frames.findIndex(f => Math.abs(f.bounds.min[2]) < EPS);
  if (first < 0) throw Error('The composition has no ground contact.');
  const order: number[] = [first];
  const seen = new Set(order);
  const parent = new Map<number, { other: number; ownPort: string; otherPort: string }>();
  for (let cursor = 0; cursor < order.length; cursor++) {
    check();
    for (const link of links[order[cursor]]) if (!seen.has(link.other)) {
      seen.add(link.other);
      order.push(link.other);
      parent.set(link.other, { other: order[cursor], ownPort: link.otherPort, otherPort: link.ownPort });
    }
  }
  if (order.length !== parts.length) throw Error('All modules must belong to one connector graph.');
  const remap = new Map(order.map((original, final) => [original, final]));
  const requiredContacts = [...new Map(contacts.map(c => {
    const mapped = { ...c, a: remap.get(c.a)!, b: remap.get(c.b)! };
    const key = JSON.stringify(mapped.a < mapped.b
      ? [mapped.a, mapped.b, mapped.aPort, mapped.bPort]
      : [mapped.b, mapped.a, mapped.bPort, mapped.aPort]);
    return [key, mapped];
  })).values()];
  if (requiredContacts.length > MAX_PARTS) throw Error('Too many required module contacts.');
  const steps: Build['steps'] = order.map((original, step) => {
    const owner = owners[original], node = plan.nodes[owner.node], link = parent.get(original);
    const piece = `${node.option.role} (${node.id}), module piece ${owner.local + 1}`;
    return {
      caption: !step ? `Place ${piece} on the table at the ground contact. Match the exact orientation shown.`
        : `Attach ${piece}: mate ${link!.ownPort} to ${link!.otherPort} on the piece from step ${remap.get(link!.other)! + 1}. Match the exact orientation shown.`,
      parts: [parts[original]],
    };
  });
  const build: Build = { name: plan.name, description: plan.description, engine: 'connections-v2', steps, requiredContacts };
  check();
  const issues = validateConnections(build, stock, 24);
  check();
  if (issues.length) throw Error(issues.map(i => i.message).join('\n'));
  for (const receipt of receipts) receipt.indices = receipt.indices.map(i => remap.get(i)!);
  const size = [0, 1, 2].map(axis => clean((Math.max(...frames.map(f => f.bounds.max[axis])) -
    Math.min(...frames.map(f => f.bounds.min[axis]))) / 20));
  const candidate: AssemblyComposition = { plan: structuredClone(plan), build, receipts, remaining, size };
  if (options.validate) {
    // A validator receives a complete, isolated snapshot and cannot rewrite the
    // construction or the caller's source modules as a side effect.
    const reasons = options.validate(structuredClone(candidate));
    check();
    if (!Array.isArray(reasons) || !reasons.every(reason => typeof reason === 'string')) throw Error('Assembly validator must return an array of reasons.');
    if (reasons.length) throw Error(reasons.join('\n'));
  }
  check();
  return candidate;
}

/** Compose immutable recipes against one exact ledger. Any failure throws;
 * callers never receive a partially placed, fitted or trimmed assembly. */
export function composeModules(plan: AssemblyPlan, stock: Stock, options: AssemblySearchOptions = {}): AssemblyComposition {
  const limits = bounds(options), deadline = performance.now() + limits.maxMillis;
  const check = () => { if (performance.now() >= deadline) throw new BudgetExceeded(); };
  return compose(plan, stockCopy(stock), options, limits, check);
}

/** Physical identity ignores recipe metadata, module boundaries and step order.
 * Canonical frames also equate rot:90 with the same orientation matrix. */
function physicalKey(candidate: AssemblyComposition): string {
  return JSON.stringify(candidate.build.steps.flatMap(s => s.parts).map(p => {
    const f = frame(p);
    return JSON.stringify([p.partId, ...f.rotation, ...f.translation]);
  }).sort());
}

/** Collect real, validated alternatives lazily. `exhausted` means an attempt/time
 * budget stopped traversal; reaching the limit or the iterable's end is normal.
 * Budgets are cooperative: synchronous iterator/validator calls cannot be preempted. */
export function searchModuleCompositions(
  plans: Iterable<AssemblyPlan>, stock: Stock, options: AssemblySearchOptions = {},
): AssemblySearchResult {
  const limits = bounds(options), ledger = stockCopy(stock);
  const candidates: AssemblyComposition[] = [], keys = new Set<string>();
  const deadline = performance.now() + limits.maxMillis;
  const check = () => { if (performance.now() >= deadline) throw new BudgetExceeded(); };
  let attempts = 0, rejected = 0, exhausted = false, done = false;
  if (!limits.limit) return { candidates, attempts, rejected, exhausted };
  const iterator = plans[Symbol.iterator]();
  try {
    while (candidates.length < limits.limit) {
      if (attempts >= limits.maxAttempts || performance.now() >= deadline) { exhausted = true; break; }
      const next = iterator.next();
      if (next.done) { done = true; break; }
      attempts++;
      try {
        const candidate = compose(next.value, ledger, options, limits, check);
        const key = physicalKey(candidate);
        check();
        if (keys.has(key)) { rejected++; continue; }
        keys.add(key);
        candidates.push(candidate);
      } catch (error) {
        rejected++;
        if (error instanceof BudgetExceeded) { exhausted = true; break; }
      }
    }
  } finally {
    if (!done) iterator.return?.();
  }
  return { candidates, attempts, rejected, exhausted };
}
