import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Build } from '../bricks';
import {
  apply, compileConnections, connectionPairs, frame, multiply, requiredContactIssues, sub, validateConnections,
  type ConnectionOperation, type ConnectionProgram, type Rotation,
} from '../connections';
import { composeModules, searchModuleCompositions } from './compose';
import type { AssemblyOption, AssemblyPlan, AssemblyComposition } from './types';

const root = (partId: string): ConnectionOperation => ({ partId, parent: -1, parentPort: '', childPort: '', twist: 0 });
const op = (partId: string, parent: number, parentPort = 'stud:0:0', childPort = 'grip:0:0', twist = 0): ConnectionOperation =>
  ({ partId, parent, parentPort, childPort, twist });
const option = (id: string, operations: ConnectionOperation[], extra: Partial<ConnectionProgram> = {}): AssemblyOption =>
  ({ id, role: id, program: { name: id, description: 'An exact module recipe.', operations, ...extra } });
const plan = (nodes: AssemblyPlan['nodes'], id = 'test'): AssemblyPlan =>
  ({ id, name: 'Composed model', description: 'Exact independently legal modules.', nodes });
const stockFor = (p: AssemblyPlan): Record<string, number> => {
  const stock: Record<string, number> = {};
  for (const n of p.nodes) for (const o of n.option.program.operations) stock[o.partId] = (stock[o.partId] ?? 0) + 1;
  return stock;
};
const parts = (b: Build) => b.steps.flatMap(s => s.parts);
const stacked = (): AssemblyPlan => plan([
  { id: 'base', option: option('base', [root('brick-1x1-red')]) },
  { id: 'cap', option: option('cap', [root('plate-1x1-black')]), attachment: {
    parent: 'base', parentPart: 0, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: 0,
  } },
]);

function floats(): AssemblyPlan {
  const float = option('float', [root('plate-1x4-black'), op('brick-1x1-black', 0, 'stud:3:0')], { rootRotation: 90 });
  return plan([
    { id: 'left', option: { ...float, role: 'float-left' } },
    { id: 'bridge', option: option('crossbeam', [root('plate-1x4-red')]), attachment: {
      parent: 'left', parentPart: 0, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: -90,
    } },
    { id: 'right', option: { ...float, role: 'float-right' }, attachment: {
      parent: 'bridge', parentPart: 0, parentPort: 'grip:3:0', childPort: 'stud:0:0', twist: -90,
    } },
  ]);
}

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe('immutable module composition', () => {
  it('bills every module to one exact ledger and returns fully legal receipts', () => {
    const p = frozen(stacked()), stock = frozen({ ...stockFor(p), 'tile-1x1-white': 3 });
    const result = composeModules(p, stock);
    expect(validateConnections(result.build, stock, 24)).toEqual([]);
    expect(result.receipts).toEqual([
      { id: 'base', role: 'base', optionId: 'base', cost: { 'brick-1x1-red': 1 }, indices: [0] },
      { id: 'cap', role: 'cap', optionId: 'cap', cost: { 'plate-1x1-black': 1 }, indices: [1] },
    ]);
    expect(result.remaining).toEqual({ 'brick-1x1-red': 0, 'plate-1x1-black': 0, 'tile-1x1-white': 3 });
    expect(result.size).toEqual([1, 1, 1.6]); // 4 plates = 32 LDU = 1.6 studs high.
    expect(result.build.steps[1].caption).toMatch(/cap.*grip:0:0.*stud:0:0.*step 1/);
    expect(result.plan).toEqual(p);
    expect(result.plan).not.toBe(p);
    result.plan.nodes[0].option.program.operations[0].partId = 'brick-1x1-white';
    expect(p.nodes[0].option.program.operations[0].partId).toBe('brick-1x1-red');
  });

  it('rejects individually affordable modules that exhaust their shared color/shape stock', () => {
    const p = stacked();
    p.nodes[1].option = option('another brick', [root('brick-1x1-red')]);
    const stock = { 'brick-1x1-red': 1, 'brick-1x1-blue': 100 };
    for (const n of p.nodes) expect(() => compileConnections(n.option.program, stock)).not.toThrow();
    expect(() => composeModules(p, stock)).toThrow(/Shared stock exhausted.*brick-1x1-red/);
    expect(stock).toEqual({ 'brick-1x1-red': 1, 'brick-1x1-blue': 100 });
  });

  it('rejects collisions and double occupation even when every module compiles alone', () => {
    const p = stacked();
    p.nodes.push({ ...structuredClone(p.nodes[1]), id: 'second cap' });
    const stock = stockFor(p), callback = vi.fn(() => []);
    for (const n of p.nodes) expect(() => compileConnections(n.option.program, stock)).not.toThrow();
    expect(() => composeModules(p, stock, { validate: callback })).toThrow(/overlap|occupied by two/);
    expect(callback).not.toHaveBeenCalled();
    expect(searchModuleCompositions([p], stock, { validate: callback })).toEqual({
      candidates: [], attempts: 1, rejected: 1, exhausted: false,
    });
  });

  it('preserves rotated floats, attaches the second below a real beam and orders from ground', () => {
    const p = frozen(floats()), stock = frozen(stockFor(p)), result = composeModules(p, stock);
    const placed = parts(result.build);
    expect(placed).toHaveLength(5);
    expect(validateConnections(result.build, stock, 24)).toEqual([]);
    for (const receipt of result.receipts) {
      expect(receipt.indices.map(i => placed[i].partId)).toEqual(p.nodes.find(n => n.id === receipt.id)!.option.program.operations.map(o => o.partId));
    }
    const [left, beam, right] = result.receipts;
    const l = frame(placed[left.indices[0]]), r = frame(placed[right.indices[0]]), b = frame(placed[beam.indices[0]]);
    expect(l.bounds.min[2]).toBe(0);
    expect(r.bounds.min[2]).toBe(0);
    expect(r.rotation).toEqual(l.rotation);
    expect(r.bounds.min[0] - l.bounds.max[0]).toBe(40); // a real two-stud gap
    expect(connectionPairs(b, r)).toContainEqual(['grip:3:0', 'stud:0:0']);
    expect(result.size).toEqual([4, 4, 1.6]);
    expect(result.build.requiredContacts).toContainEqual({ a: beam.indices[0], b: right.indices[0], aPort: 'grip:3:0', bPort: 'stud:0:0' });
    expect(result.build.steps.every(s => /float|crossbeam/.test(s.caption))).toBe(true);
  });

  it('normalizes the whole assembly and reverses an underside recipe order without changing poses', () => {
    const p = plan([
      { id: 'upper', option: option('upper plate', [root('plate-1x1-red')]) },
      { id: 'lower', option: option('lower brick', [root('brick-1x1-black')]), attachment: {
        parent: 'upper', parentPart: 0, parentPort: 'grip:0:0', childPort: 'stud:0:0', twist: 0,
      } },
    ]);
    const result = composeModules(frozen(p), stockFor(p)), placed = parts(result.build);
    expect(placed.map(p => p.partId)).toEqual(['brick-1x1-black', 'plate-1x1-red']);
    expect(placed.map(p => p.z)).toEqual([0, 3]);
    expect(result.receipts.map(r => r.indices)).toEqual([[1], [0]]);
    expect(result.build.requiredContacts).toEqual([{ a: 1, b: 0, aPort: 'grip:0:0', bPort: 'stud:0:0' }]);
    expect(validateConnections(result.build, stockFor(p), 24)).toEqual([]);
    expect(result.build.steps[0].caption).toContain('lower brick');
    expect(result.build.steps[1].caption).toMatch(/upper plate.*step 1/);
  });

  it('rigidly carries a multi-part SNOT recipe with its exact non-quarter twist', () => {
    const module = option('angled assembly', [
      root('brick-1x1-black'), op('sidebrick-1x1-red', 0), op('plate-1x2-white', 1, 'side:0', 'grip:0:0', 23),
    ], { rootRotation: 90 });
    const p = plan([
      { id: 'host', option: option('side host', [root('sidebrick-1x1-yellow')]) },
      { id: 'angled', option: module, attachment: {
        parent: 'host', parentPart: 0, parentPort: 'side:0', childPort: 'grip:0:0', twist: -17,
      } },
    ]);
    const stock = stockFor(p), result = composeModules(frozen(p), stock), local = parts(compileConnections(module.program, stock));
    const receipt = result.receipts[1], world = parts(result.build), a = frame(local[0]), b = frame(world[receipt.indices[0]]);
    const inverse = [0, 3, 6, 1, 4, 7, 2, 5, 8].map(i => a.rotation[i]) as Rotation;
    const delta = multiply(b.rotation, inverse);
    for (let i = 0; i < local.length; i++) {
      const lf = frame(local[i]), wf = frame(world[receipt.indices[i]]);
      multiply(delta, lf.rotation).forEach((v, j) => expect(wf.rotation[j]).toBeCloseTo(v, 8));
      const translation = apply(delta, sub(lf.translation, a.translation));
      sub(wf.translation, b.translation).forEach((v, j) => expect(v).toBeCloseTo(translation[j], 8));
    }
    expect(validateConnections(result.build, stock, 24)).toEqual([]);
  });

  it('remaps local closure contacts and protects anchors after graph reordering', () => {
    const bridge = option('two-support bridge', [
      root('plate-1x2-red'), op('brick-1x1-black', 0), op('brick-1x1-black', 0, 'stud:1:0'), op('plate-1x2-yellow', 1),
    ], { requiredContacts: [{ a: 2, b: 3, aPort: 'stud:0:0', bPort: 'grip:1:0' }] });
    const p = plan([
      { id: 'bridge', option: bridge },
      { id: 'ground', option: option('ground plate', [root('plate-1x2-white')]), attachment: {
        parent: 'bridge', parentPart: 0, parentPort: 'grip:0:0', childPort: 'stud:0:0', twist: 0,
      } },
    ]);
    const result = composeModules(p, stockFor(p)), placed = parts(result.build), [a, b] = result.receipts;
    expect(a.indices).not.toEqual([0, 1, 2, 3]);
    expect(result.build.requiredContacts).toContainEqual({ a: a.indices[2], b: a.indices[3], aPort: 'stud:0:0', bPort: 'grip:1:0' });
    expect(result.build.requiredContacts).toContainEqual({ a: a.indices[0], b: b.indices[0], aPort: 'grip:0:0', bPort: 'stud:0:0' });
    expect(requiredContactIssues(placed, result.build.requiredContacts)).toEqual([]);
    const moved = structuredClone(placed);
    moved[b.indices[0]].x += .1;
    expect(requiredContactIssues(moved, result.build.requiredContacts).join('\n')).toMatch(/Required connection/);
    const broken = structuredClone(p);
    broken.nodes[0].option.program.requiredContacts![0].bPort = 'grip:99:0';
    expect(() => composeModules(broken, stockFor(p))).toThrow(/Required connection/);
    expect(searchModuleCompositions([broken], stockFor(p)).candidates).toEqual([]);
  });

  it('rejects nonmanufactured IDs, unsupported sizes and malformed stock instead of substituting', () => {
    const p = plan([{ id: 'base', option: option('impossible', [root('plate-8x8-blue')]) }]);
    expect(() => composeModules(p, stockFor(p))).toThrow(/manufactured/);
    p.nodes[0].option.program.operations[0].partId = 'brick-999x999-red';
    expect(() => composeModules(p, stockFor(p))).toThrow(/manufactured/);
    p.nodes[0].option.program.operations[0].partId = 'wheel-1x1-black';
    expect(() => composeModules(p, stockFor(p))).toThrow(/catalog|Unsupported/);
    for (const n of [NaN, Infinity, -1, .5]) expect(() => composeModules(stacked(), { ...stockFor(stacked()), 'brick-1x1-red': n })).toThrow(/Stock counts/);
  });

  it('requires unique nodes, one root and actual earlier module part/port references', () => {
    for (const mutate of [
      (p: AssemblyPlan) => { p.nodes[0].attachment = structuredClone(p.nodes[1].attachment); },
      (p: AssemblyPlan) => { p.nodes[1].attachment = undefined; },
      (p: AssemblyPlan) => { p.nodes[1].id = 'base'; },
      (p: AssemblyPlan) => { p.nodes[1].attachment!.parent = 'cap'; },
      (p: AssemblyPlan) => { p.nodes[1].attachment!.parentPart = 1; },
      (p: AssemblyPlan) => { p.nodes[1].attachment!.parentPart = .5; },
      (p: AssemblyPlan) => { p.nodes[1].attachment!.parentPort = 'imaginary:0'; },
      (p: AssemblyPlan) => { p.nodes[1].attachment!.childPort = 'stud:0:0'; },
      (p: AssemblyPlan) => { p.nodes[1].attachment!.twist = NaN; },
    ]) {
      const p = stacked(); mutate(p);
      expect(() => composeModules(p, stockFor(p))).toThrow();
    }
  });

  it('enforces complete part/node bounds and validates each original local program', () => {
    const p = stacked();
    expect(() => composeModules(p, stockFor(p), { minParts: 3 })).toThrow(/below/);
    expect(() => composeModules(p, stockFor(p), { maxParts: 1 })).toThrow(/exceeds/);
    expect(() => composeModules(p, stockFor(p), { maxParts: Infinity })).toThrow(/safe integer/);
    expect(() => composeModules(p, stockFor(p), { minParts: 161 })).toThrow(/cannot be satisfied/);
    const many = plan(Array.from({ length: 33 }, (_, i) => ({ id: String(i), option: p.nodes[0].option })));
    expect(() => composeModules(many, stockFor(many))).toThrow(/1–32/);
    const malformed = stacked();
    malformed.nodes[1].option.program.operations[0].parent = 0;
    expect(() => composeModules(malformed, stockFor(malformed))).toThrow(/upright root/);
    expect(() => composeModules(p, stockFor(p), { maxMillis: 0 })).toThrow(/time budget/);
  });

  it('composes up to 160 total parts across legal 80-part modules without silently clipping', () => {
    const tower = option('plate tower', [root('plate-1x1-red'),
      ...Array.from({ length: 79 }, (_, i) => op('plate-1x1-red', i))]);
    const p = plan([
      { id: 'bottom', option: tower },
      { id: 'top', option: tower, attachment: {
        parent: 'bottom', parentPart: 79, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: 0,
      } },
    ]);
    const result = composeModules(p, stockFor(p));
    expect(parts(result.build)).toHaveLength(160);
    expect(result.receipts.map(r => r.indices.length)).toEqual([80, 80]);
    expect(result.remaining['plate-1x1-red']).toBe(0);
    expect(result.size).toEqual([1, 1, 64]);
    expect(validateConnections(result.build, stockFor(p), 24)).toEqual([]);
    p.nodes.push({ id: 'overflow', option: option('one more', [root('plate-1x1-red')]), attachment: {
      parent: 'top', parentPart: 79, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: 0,
    } });
    expect(() => composeModules(p, stockFor(p), { maxParts: 999 })).toThrow(/160 part bound/);
  });

  it('passes only complete isolated candidates to validation and propagates its rejection', () => {
    const p = frozen(stacked()), stock = frozen(stockFor(p));
    const reject = vi.fn((candidate: AssemblyComposition) => {
      expect(parts(candidate.build)).toHaveLength(2);
      expect(candidate.receipts.every(r => r.indices.length === 1)).toBe(true);
      expect(validateConnections(candidate.build, stock, 24)).toEqual([]);
      candidate.build.steps[0].parts[0].partId = 'brick-1x1-blue';
      return ['The complete silhouette is wrong.'];
    });
    expect(() => composeModules(p, stock, { validate: reject })).toThrow(/silhouette/);
    const result = composeModules(p, stock, { validate: candidate => {
      candidate.plan.nodes[0].option.program.operations[0].partId = 'brick-1x1-blue';
      candidate.receipts[0].indices.length = 0;
      return [];
    } });
    expect(result.plan).toEqual(p);
    expect(result.receipts[0].indices).toEqual([0]);
    expect(parts(result.build)[0].partId).toBe('brick-1x1-red');
  });
});

describe('bounded alternatives', () => {
  it('filters complete candidates, rejects callback failures and continues to real alternatives', () => {
    const a = stacked(), b = structuredClone(a), c = structuredClone(a);
    a.id = 'rejected'; b.id = 'throws'; c.id = 'accepted';
    const callback = vi.fn((candidate: AssemblyComposition) => {
      if (candidate.plan.id === 'throws') throw Error('Validation failed.');
      return candidate.plan.id === 'rejected' ? ['No.'] : [];
    });
    const result = searchModuleCompositions([a, b, c], stockFor(a), { validate: callback });
    expect(result.candidates.map(c => c.plan.id)).toEqual(['accepted']);
    expect(result).toMatchObject({ attempts: 3, rejected: 2, exhausted: false });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('deduplicates the same physical construction across names, module boundaries and step order', () => {
    const a = stacked();
    const b = plan([{ id: 'combined', option: option('one recipe', [root('brick-1x1-red'), op('plate-1x1-black', 0)]) }], 'combined');
    const c = plan([
      { id: 'cap', option: option('cap', [root('plate-1x1-black')]) },
      { id: 'base', option: option('base', [root('brick-1x1-red')]), attachment: {
        parent: 'cap', parentPart: 0, parentPort: 'grip:0:0', childPort: 'stud:0:0', twist: 0,
      } },
    ], 'reversed');
    const distinct = structuredClone(a);
    distinct.id = 'blue cap'; distinct.nodes[1].option.program.operations[0].partId = 'plate-1x1-blue';
    const stock = { ...stockFor(a), 'plate-1x1-blue': 1 };
    const result = searchModuleCompositions([a, b, c, distinct], stock);
    expect(result.candidates.map(c => c.plan.id)).toEqual(['test', 'blue cap']);
    expect(result).toMatchObject({ attempts: 4, rejected: 2, exhausted: false });
  });

  it('retains distinct physical angles without filling its result with renamed copies', () => {
    const a = stacked(); a.nodes[0].option = option('support', [root('plate-1x1-red')]);
    const b = structuredClone(a); b.id = 'turned'; b.nodes[1].attachment!.twist = 17;
    const stock = stockFor(a), result = searchModuleCompositions([a, structuredClone(a), b], stock);
    expect(result.candidates).toHaveLength(2);
    expect(result.rejected).toBe(1);
    expect(parts(result.candidates[1].build)[1].orientation).not.toEqual(parts(result.candidates[0].build)[1].orientation);
    const nearby = structuredClone(b); nearby.nodes[1].attachment!.twist = 17.00000001;
    expect(searchModuleCompositions([b, nearby], stock).candidates).toHaveLength(2);
  });

  it('caps attempts for infinite rejected streams and closes their iterator', () => {
    const p = stacked(), validate = vi.fn(() => ['Rejected.']);
    let closed = false, yielded = 0;
    function* infinite() { try { while (true) { yielded++; yield p; } } finally { closed = true; } }
    const result = searchModuleCompositions(infinite(), stockFor(p), { maxAttempts: 3, validate });
    expect(result).toEqual({ candidates: [], attempts: 3, rejected: 3, exhausted: true });
    expect(yielded).toBe(3); expect(closed).toBe(true); expect(validate).toHaveBeenCalledTimes(3);
  });

  it('stops at the alternative limit without consuming additional plans', () => {
    const p = stacked(); let yielded = 0, closed = false;
    function* plans() { try { while (true) { yielded++; yield p; } } finally { closed = true; } }
    const result = searchModuleCompositions(plans(), stockFor(p), { limit: 1 });
    expect(result).toMatchObject({ attempts: 1, rejected: 0, exhausted: false });
    expect(result.candidates).toHaveLength(1); expect(yielded).toBe(1); expect(closed).toBe(true);
  });

  it('does no iteration or validation when either search budget is zero', () => {
    const p = stacked(), next = vi.fn(() => ({ value: p, done: false }));
    const iterable = { [Symbol.iterator]: () => ({ next }) }, validate = vi.fn(() => []);
    for (const opts of [{ maxAttempts: 0 }, { maxMillis: 0 }]) {
      expect(searchModuleCompositions(iterable, stockFor(p), { ...opts, validate })).toEqual({
        candidates: [], attempts: 0, rejected: 0, exhausted: true,
      });
    }
    expect(searchModuleCompositions(iterable, stockFor(p), { limit: 0 })).toEqual({
      candidates: [], attempts: 0, rejected: 0, exhausted: false,
    });
    expect(next).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
  });

  it('never exposes a candidate whose iterator or validator crossed the shared deadline', () => {
    const p = stacked(); let now = 0, nextCalls = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const result = searchModuleCompositions([p, p], stockFor(p), { maxMillis: 10, validate: () => { now = 11; return []; } });
    expect(result).toEqual({ candidates: [], attempts: 1, rejected: 1, exhausted: true });
    now = 0;
    const slowIterator = { [Symbol.iterator]: () => ({ next: () => { nextCalls++; now = 11; return { done: false, value: p }; } }) };
    expect(searchModuleCompositions(slowIterator, stockFor(p), { maxMillis: 10 })).toEqual({
      candidates: [], attempts: 1, rejected: 1, exhausted: true,
    });
    expect(nextCalls).toBe(1);
  });
});
