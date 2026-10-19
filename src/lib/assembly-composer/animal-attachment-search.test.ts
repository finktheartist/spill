import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPart, connectionPairs, frame, validateConnections } from '../connections';
import { connectedAnimalLayout, type WholeAnimalConnection, type WholeAnimalConnectionIntent } from '../shape-first/whole-animal-connections';
import { searchAnimalAttachments, type AnimalAttachmentRequest } from './animal-attachment-search';

const root = (partId = 'plate-2x2-tan'): WholeAnimalConnection => ({ partId, role: 'head', parent: -1, parentPort: '', childPort: '', twist: 0 });
const prefix = (): WholeAnimalConnectionIntent => ({ rootRotation: 0, operations: [root()] });
const request = (patch: Partial<AnimalAttachmentRequest> = {}): AnimalAttachmentRequest => ({ partId: 'plate-1x1-white', role: 'muzzle', parent: 0, parentPort: 'stud:99:99', childPort: 'grip:0:0', twist: 0, ...patch });
const stock = { 'plate-2x2-tan': 1, 'plate-1x1-white': 2 };
const verify = (ledger: Record<string, number>, intent: WholeAnimalConnectionIntent) => {
  const target = connectedAnimalLayout(ledger, { id: 'search-test', description: 'Physical batch test, not an accepted whole animal.' }, intent);
  const raw = intent.operations.map((_, i, all) => {
    const placed = [] as ReturnType<typeof attachPart>[];
    for (const [j, item] of all.slice(0, i + 1).entries()) placed.push(j ? attachPart(placed[item.parent], item.parentPort, item.partId, item.childPort, ((item.twist + 180) % 360 + 360) % 360 - 180)
      : { partId: item.partId, x: 0, y: 0, z: 0, rot: intent.rootRotation });
    return placed[i];
  });
  // Ground-first traversal is needed when a later operation becomes the foot.
  const pp = target.parts.map(p => ({ ...p, z: p.z / .4 })), ff = pp.map(frame), order = [ff.findIndex(f => Math.abs(f.bounds.min[2]) < 1e-5)], seen = new Set(order);
  for (let cursor = 0; cursor < order.length; cursor++) for (let i = 0; i < pp.length; i++) if (!seen.has(i) && connectionPairs(ff[order[cursor]], ff[i]).length) { seen.add(i); order.push(i); }
  expect(order).toHaveLength(pp.length);
  expect(validateConnections({ name: 'Completed batch', description: 'Test-only ground traversal', engine: 'connections-v2', steps: order.map(i => ({ caption: 'Actual connector', parts: [pp[i]] })) }, ledger, 24)).toEqual([]);
  const delta = frame(pp[0]).translation.map((n, a) => n - frame(raw[0]).translation[a]);
  pp.forEach((p, i) => {
    expect(frame(p).rotation).toEqual(frame(raw[i]).rotation);
    frame(raw[i]).translation.forEach((n, a) => expect(frame(p).translation[a] - n).toBeCloseTo(delta[a], 8));
  });
  return target;
};
afterEach(() => vi.restoreAllMocks());

describe('explicit bounded attachment search', () => {
  it('repairs a wrong port with fixed pieces/roles, lower-is-better ranking and an explicit source-order trace', () => {
    const input = prefix(), requests = [request()], before = JSON.stringify({ input, requests, stock });
    const out = searchAnimalAttachments(stock, input, requests, {
      score: (l, added) => { expect(added).toBe(1); expect(l.parts.map(p => p.role)).toEqual(['head', 'muzzle']); return (l.parts[1].z <= l.parts[0].z ? 100 : 0) + Math.abs(l.parts[1].x - 1) + l.parts[1].y; },
      validate: l => l.parts[1].z > l.parts[0].z ? [] : ['Need an upper carrier.'],
    });
    expect(out.intent).toBeDefined(); expect(out.layout).toBeDefined();
    expect(out.intent!.operations.slice(0, 1)).toEqual(input.operations);
    expect(out.intent!.operations[1]).toMatchObject({ partId: requests[0].partId, role: requests[0].role, parent: 0, parentPort: 'stud:1:0' });
    expect(out.changes).toEqual([{ index: 1, requested: { partId: requests[0].partId, parent: 0, parentPort: 'stud:99:99', childPort: 'grip:0:0', twist: 0 },
      resolved: { partId: requests[0].partId, parent: 0, parentPort: 'stud:1:0', childPort: 'grip:0:0', twist: 0 } }]);
    expect(verify(stock, out.intent!).parts).toEqual(out.layout!.parts);
    expect(JSON.stringify({ input, requests, stock })).toBe(before);
  });

  it('takes the exact preferred path without exhausting alternate searches and supports an empty prefix root', () => {
    const exact = request({ parentPort: 'stud:0:0' });
    const out = searchAnimalAttachments(stock, prefix(), [exact], { maxAttempts: 1, maxChanges: 0 });
    expect(out.intent?.operations[1]).toEqual({ ...exact });
    expect(out.attempts).toBe(1); expect(out.exhausted).toBe(false); expect(out.changes).toEqual([]);
    const empty = searchAnimalAttachments({ 'plate-2x2-tan': 1 }, { rootRotation: 90, operations: [] }, [{ ...root() }]);
    expect(empty.layout?.parts).toEqual([{ partId: 'plate-2x2-tan', role: 'head', x: 0, y: 0, z: 0, rot: 90 }]);
    expect(empty.intent?.rootRotation).toBe(90); expect(empty.attempts).toBe(1);
  });

  it('repairs only a bad final join from the already valid preferred request prefix', () => {
    const ledger = { 'plate-1x4-tan': 1, 'plate-1x1-white': 3 }, input: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root('plate-1x4-tan')] };
    const batch = [request({ role: 'eye-left', parentPort: 'stud:0:0' }), request({ role: 'eye-right', parentPort: 'stud:1:0' }), request({ role: 'nose' })];
    const out = searchAnimalAttachments(ledger, input, batch, { maxAttempts: 1000, beamWidth: 8,
      score: l => l.parts.slice(1).reduce((n, p, i) => n + Math.abs(p.x - i) + (p.z <= l.parts[0].z ? 100 : 0), 0) });
    expect(out.intent?.operations.slice(1, 3)).toEqual(batch.slice(0, 2));
    expect(out.intent?.operations[3].parentPort).toBe('stud:2:0');
    expect(out.changes?.map(c => c.index)).toEqual([3]);
    expect(out.attempts).toBeLessThanOrEqual(40);
    verify(ledger, out.intent!);
  });

  it('keeps a fixed prefix rigid while a new underside descendant becomes the ground root', () => {
    const ledger = { 'plate-1x2-tan': 1, 'brick-1x1-medium-nougat': 1 }, input = { rootRotation: 0 as const, operations: [root('plate-1x2-tan')] };
    const op = request({ partId: 'brick-1x1-medium-nougat', role: 'leg-front-left', parentPort: 'grip:0:0', childPort: 'stud:0:0' });
    const out = searchAnimalAttachments(ledger, input, [op], { maxChanges: 0 });
    expect(out.intent!.operations[0]).toEqual(input.operations[0]);
    expect(out.layout?.parts.map(p => p.z)).toEqual([1.2, 0]);
    expect(out.layout?.parts.map(p => p.role)).toEqual(['head', 'leg-front-left']);
    expect(out.changes).toEqual([]);
    const expected = verify(ledger, out.intent!).parts;
    expected.forEach((p, i) => {
      expect(out.layout!.parts[i]).toMatchObject({ partId: p.partId, role: p.role, rot: p.rot });
      for (const a of ['x', 'y', 'z'] as const) expect(out.layout!.parts[i][a]).toBeCloseTo(p[a], 10);
    });
  });

  it('reserves incidental prefix contacts, not only the explicitly named parent socket', () => {
    const ledger = { 'plate-2x2-tan': 1, 'plate-1x2-white': 1, 'plate-1x1-white': 1 };
    const input: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root(), { partId: 'plate-1x2-white', role: 'head', parent: 0, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: 0 }] };
    const op = request({ parentPort: 'stud:1:0' }); // Occupied by the broad plate's SECOND grip.
    const out = searchAnimalAttachments(ledger, input, [op], { score: l => l.parts[2].z > l.parts[0].z ? Math.abs(l.parts[2].x - 1) : 100,
      validate: l => l.parts[2].z > l.parts[0].z ? [] : ['Upper only.'] });
    expect(out.intent?.operations[2].parentPort).toBe('stud:1:1');
    expect(out.changes?.[0].index).toBe(2);
    verify(ledger, out.intent!);
    const invalidPrefix = { ...input, operations: [...input.operations, { ...op, role: op.role }] };
    const failed = searchAnimalAttachments(ledger, invalidPrefix, []);
    expect(failed.intent).toBeUndefined(); expect(failed.layout).toBeUndefined(); expect(failed.reason).toContain('Fixed prefix failed');
    expect(failed.rejectedComplete).toBeUndefined();
  });

  it('accepts legal overlapping inverse-slope bounds through exact solids, including a real half-stud jumper offset', () => {
    const ledger = { 'jumper-1x2-white': 1, 'plate-1x6-tan': 1, 'plate-1x2-reddish-brown': 1, 'invslope-1x2-reddish-brown': 1, 'plate-1x2-white': 1 };
    const input: WholeAnimalConnectionIntent = { rootRotation: 90, operations: [root('jumper-1x2-white'),
      { partId: 'plate-1x6-tan', role: 'frame', parent: 0, parentPort: 'grip:0:0', childPort: 'stud:0:0', twist: 0 },
      { partId: 'plate-1x2-reddish-brown', role: 'neck', parent: 1, parentPort: 'stud:3:0', childPort: 'grip:0:0', twist: 0 },
      { partId: 'invslope-1x2-reddish-brown', role: 'head', parent: 2, parentPort: 'stud:0:0', childPort: 'grip:0:1', twist: -90 }] };
    const out = searchAnimalAttachments(ledger, input, [request({ partId: 'plate-1x2-white', parentPort: 'stud:center' })], { maxChanges: 0 });
    expect(out.intent, out.reason).toBeDefined();
    const target = verify(ledger, out.intent!), ff = target.parts.map(p => frame({ ...p, z: p.z / .4 }));
    expect(target.parts[4].y).toBe(.5);
    expect([0, 1, 2].every(a => Math.min(ff[3].bounds.max[a], ff[4].bounds.max[a]) > Math.max(ff[3].bounds.min[a], ff[4].bounds.min[a]))).toBe(true);
    expect(out.changes).toEqual([]);
  });

  it('offers alternate complete physical branches to the strict callback and never returns rejected partials', () => {
    const input: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root('plate-1x2-tan')] }, ledger = { 'plate-1x2-tan': 1, 'plate-1x1-white': 1 }, seen: number[] = [];
    const out = searchAnimalAttachments(ledger, input, [request()], { score: l => (l.parts[1].z <= l.parts[0].z ? 100 : 0) + l.parts[1].x,
      validate: (l, intent) => { expect(l.parts).toHaveLength(2); expect(intent.operations).toHaveLength(2); seen.push(l.parts[1].x); return l.parts[1].x === 1 && l.parts[1].z > l.parts[0].z ? [] : ['Required landmark/closure was not met.']; } });
    expect(seen[0]).toBe(0); expect(seen).toContain(1); expect(out.layout?.parts[1].x).toBe(1);
    expect(out.rejectedComplete).toBeUndefined();
    const rejected = searchAnimalAttachments(ledger, input, [request()], { validate: () => ['Conflicting closure intent.'] });
    expect(rejected.intent).toBeUndefined(); expect(rejected.layout).toBeUndefined(); expect(rejected.changes).toBeUndefined(); expect(rejected.reason).toContain('Conflicting closure');
    expect(rejected.rejectedComplete).toMatchObject({ accepted: false, issues: ['Conflicting closure intent.'], score: 1 });
    expect(rejected.rejectedComplete!.intent.operations[0]).toEqual(input.operations[0]);
    expect(verify(ledger, rejected.rejectedComplete!.intent).parts).toEqual(rejected.rejectedComplete!.layout.parts);
  });

  it('retains only the lowest finite scored complete rejection without changing its exact resolved geometry', () => {
    const input: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root('plate-1x2-tan')] }, ledger = { 'plate-1x2-tan': 1, 'plate-1x1-white': 1 }, seen: number[] = [];
    const batch = [request({ parentPort: 'stud:1:0' })], before = JSON.stringify({ ledger, input, batch });
    const out = searchAnimalAttachments(ledger, input, batch, {
      score: l => (l.parts[1].z <= l.parts[0].z ? 100 : 0) + l.parts[1].x,
      validate: l => { seen.push(l.parts[1].x); return [`Landmark rejects x=${l.parts[1].x}.`]; },
    });
    expect(seen[0]).toBe(1); expect(seen).toContain(0);
    expect(out.intent).toBeUndefined(); expect(out.layout).toBeUndefined(); expect(out.changes).toBeUndefined();
    const diagnostic = out.rejectedComplete!;
    expect(diagnostic).toMatchObject({ accepted: false, score: 0, issues: ['Landmark rejects x=0.'] });
    expect(diagnostic.layout.parts.map(p => [p.partId, p.role])).toEqual([['plate-1x2-tan', 'head'], ['plate-1x1-white', 'muzzle']]);
    expect(diagnostic.intent.operations[0]).toEqual(input.operations[0]);
    expect(diagnostic.intent.operations[1]).toEqual({ ...batch[0], parentPort: 'stud:0:0' });
    expect(verify(ledger, diagnostic.intent).parts).toEqual(diagnostic.layout.parts);
    expect(JSON.stringify({ ledger, input, batch })).toBe(before);
    const prefixOnly = searchAnimalAttachments(ledger, input, [], { score: () => -7, validate: () => ['Missing planned extension.'] });
    expect(prefixOnly.intent).toBeUndefined(); expect(prefixOnly.layout).toBeUndefined();
    expect(prefixOnly.rejectedComplete).toMatchObject({ accepted: false, score: -7, intent: input, issues: ['Missing planned extension.'] });
    const bounded = searchAnimalAttachments(ledger, input, batch, { maxAttempts: 1, score: () => 9, validate: () => ['Bounded complete rejection.'] });
    expect(bounded.intent).toBeUndefined(); expect(bounded.layout).toBeUndefined(); expect(bounded.attempts).toBe(1); expect(bounded.exhausted).toBe(true);
    expect(bounded.rejectedComplete).toMatchObject({ accepted: false, score: 9, issues: ['Bounded complete rejection.'] });
    expect(verify(ledger, bounded.rejectedComplete!.intent).parts).toEqual(bounded.rejectedComplete!.layout.parts);
  });

  it('clones rejected diagnostics independently of callback references, returned reasons and later searches', () => {
    const input = prefix(), batch = [request({ parentPort: 'stud:0:0' })], before = JSON.stringify({ input, batch, stock });
    const reasons = ['Actual landmark mismatch.'];
    const leaked: { layout?: NonNullable<ReturnType<typeof searchAnimalAttachments>['layout']>; intent?: WholeAnimalConnectionIntent } = {};
    const run = () => searchAnimalAttachments(stock, input, batch, { maxChanges: 0, score: () => 2,
      validate: (l, intent) => { leaked.layout = l; leaked.intent = intent; l.parts[1].x = 999; intent.operations[0].partId = 'invented'; return reasons; } });
    const out = run();
    expect(out.intent).toBeUndefined(); expect(out.layout).toBeUndefined();
    const diagnostic = out.rejectedComplete!;
    expect(diagnostic.accepted).toBe(false); expect(diagnostic.score).toBe(2);
    expect(verify(stock, diagnostic.intent).parts).toEqual(diagnostic.layout.parts);
    reasons[0] = 'Changed after callback.'; leaked.layout!.parts[0].x = -999; leaked.intent!.operations[1].role = 'tail';
    expect(diagnostic.issues).toEqual(['Actual landmark mismatch.']); expect(diagnostic.layout.parts[0].x).toBe(0);
    expect(diagnostic.intent.operations[1].role).toBe('muzzle');
    diagnostic.layout.parts[0].x = 42; diagnostic.intent.operations[0].twist = 90; diagnostic.issues.push('Changed returned diagnostic.');
    const fresh = run().rejectedComplete!;
    expect(fresh.issues).toEqual(['Changed after callback.']); expect(fresh.intent.operations[0]).toEqual(input.operations[0]);
    expect(verify(stock, fresh.intent).parts).toEqual(fresh.layout.parts);
    expect(JSON.stringify({ input, batch, stock })).toBe(before);
  });

  it('never exposes a colliding complete target or unvalidated partial as a rejected diagnostic', () => {
    const ledger = { 'plate-2x2-tan': 1, 'brick-1x1-white': 1, 'brick-1x2-white': 1 };
    const input: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root(),
      { partId: 'brick-1x1-white', role: 'head', parent: 0, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: 0 }] };
    const validate = vi.fn(() => ['External rejection must never run on collision.']);
    const colliding = request({ partId: 'brick-1x2-white', parentPort: 'stud:1:0', twist: 180 });
    const raw: ReturnType<typeof attachPart>[] = [{ partId: 'plate-2x2-tan', x: 0, y: 0, z: 0, rot: 0 }];
    raw.push(attachPart(raw[0], 'stud:0:0', 'brick-1x1-white', 'grip:0:0', 0));
    raw.push(attachPart(raw[0], colliding.parentPort, colliding.partId, colliding.childPort, colliding.twist));
    expect(validateConnections({ name: 'Colliding fixture', description: 'An actual invalid complete batch', engine: 'connections-v2',
      steps: raw.map(p => ({ caption: 'Fixture part', parts: [p] })) }, ledger, 24).some(i => i.kind === 'overlap')).toBe(true);
    const out = searchAnimalAttachments(ledger, input, [colliding], { maxChanges: 0, validate });
    expect(out.intent).toBeUndefined(); expect(out.layout).toBeUndefined(); expect(out.rejectedComplete).toBeUndefined();
    expect(validate).not.toHaveBeenCalled();
    const incomplete = searchAnimalAttachments(stock, prefix(), [request(), request({ parents: [] })], { validate });
    expect(incomplete.intent).toBeUndefined(); expect(incomplete.layout).toBeUndefined(); expect(incomplete.rejectedComplete).toBeUndefined();
    expect(validate).not.toHaveBeenCalled();
  });

  it('enforces stock, allowed parents and changed-binding caps without shared sibling ledgers', () => {
    expect(searchAnimalAttachments({ ...stock, 'plate-1x1-white': 0 }, prefix(), [request()]).reason).toContain('stock');
    const noParent = searchAnimalAttachments(stock, prefix(), [request({ parents: [] })]); expect(noParent.layout).toBeUndefined();
    const narrow: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root('plate-1x3-tan')] }, ledger = { 'plate-1x3-tan': 1, 'plate-1x1-white': 2 };
    const batch = [request(), request({ role: 'nose' })], scoring = (l: NonNullable<ReturnType<typeof searchAnimalAttachments>['layout']>) => l.parts.slice(1).reduce((n, p, i) => n + Math.abs(p.x - i) + (p.z <= l.parts[0].z ? 100 : 0), 0);
    const stopped = searchAnimalAttachments(ledger, narrow, batch, { maxChanges: 1, score: scoring }); expect(stopped.layout).toBeUndefined();
    const out = searchAnimalAttachments(ledger, narrow, batch, { maxChanges: 2, beamWidth: 8, score: scoring });
    expect(out.changes).toHaveLength(2); expect(out.layout?.parts).toHaveLength(3); verify(ledger, out.intent!);
    const onlyOther = searchAnimalAttachments(stock, prefix(), [request({ parent: 3, parents: [0] })]);
    expect(onlyOther.intent?.operations[1].parent).toBe(0); expect(onlyOther.changes?.[0].requested.parent).toBe(3);
  });

  it('fails closed after late/malformed callbacks, zero budgets, bounded attempts and cancellation', () => {
    for (const opts of [{ maxMillis: 0 }, { maxAttempts: 0 }, { beamWidth: 0 }]) {
      const out = searchAnimalAttachments(stock, prefix(), [request()], opts); expect(out.layout).toBeUndefined(); expect(out.exhausted).toBe(true); expect(out.attempts).toBe(0);
      expect(out.rejectedComplete).toBeUndefined();
    }
    const capped = searchAnimalAttachments(stock, prefix(), [request()], { maxAttempts: 1 });
    expect(capped.attempts).toBeLessThanOrEqual(1); expect(capped.layout).toBeUndefined(); expect(capped.exhausted).toBe(true);
    expect(searchAnimalAttachments(stock, prefix(), [request()], { score: () => Infinity }).reason).toContain('finite');
    expect(searchAnimalAttachments(stock, prefix(), [], { score: () => NaN }).layout).toBeUndefined();
    for (const reasons of [null, new Array<string>(1), Array.from({ length: 33 }, () => 'Too many.'), ['x'.repeat(1001)]]) {
      const malformed = searchAnimalAttachments(stock, prefix(), [request({ parentPort: 'stud:0:0' })], { validate: () => reasons as unknown as string[] });
      expect(malformed.layout).toBeUndefined(); expect(malformed.rejectedComplete).toBeUndefined();
    }
    const controller = new AbortController(); controller.abort();
    const cancelled = searchAnimalAttachments(stock, prefix(), [request()], { signal: controller.signal }); expect(cancelled.layout).toBeUndefined(); expect(cancelled.attempts).toBe(0); expect(cancelled.reason).toContain('cancelled');
    const during = new AbortController();
    expect(searchAnimalAttachments(stock, prefix(), [request()], { signal: during.signal, score: () => { during.abort(); return 0; } }).layout).toBeUndefined();
    const atRejection = new AbortController();
    const cancelledRejection = searchAnimalAttachments(stock, prefix(), [request({ parentPort: 'stud:0:0' })], { signal: atRejection.signal,
      validate: () => { atRejection.abort(); return ['Rejected before cancellation.']; } });
    expect(cancelledRejection.reason).toContain('cancelled'); expect(cancelledRejection.intent).toBeUndefined(); expect(cancelledRejection.layout).toBeUndefined();
    expect(cancelledRejection.rejectedComplete).toBeUndefined();
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const slowScore = searchAnimalAttachments(stock, prefix(), [request({ parentPort: 'stud:0:0' })], { maxMillis: 10, score: () => { clock = 11; return 0; } });
    expect(slowScore.layout).toBeUndefined(); expect(slowScore.exhausted).toBe(true);
    clock = 0;
    const slowValidate = searchAnimalAttachments(stock, prefix(), [request({ parentPort: 'stud:0:0' })], { maxMillis: 10, validate: () => { clock = 11; return []; } });
    expect(slowValidate.layout).toBeUndefined(); expect(slowValidate.exhausted).toBe(true);
    expect(slowValidate.rejectedComplete).toBeUndefined();
    clock = 0;
    const lateRejected = searchAnimalAttachments(stock, prefix(), [request({ parentPort: 'stud:0:0' })], { maxMillis: 10,
      validate: () => { clock = 11; return ['Tail does not reach its planned rear landmark.']; } });
    expect(lateRejected.intent).toBeUndefined(); expect(lateRejected.layout).toBeUndefined(); expect(lateRejected.exhausted).toBe(true);
    expect(lateRejected.reason).toContain('time budget exhausted'); expect(lateRejected.reason).toContain('Last complete validation: Validator: Tail does not reach');
    expect(lateRejected.rejectedComplete).toMatchObject({ accepted: false, score: 0, issues: ['Tail does not reach its planned rear landmark.'] });
    expect(verify(stock, lateRejected.rejectedComplete!.intent).parts).toEqual(lateRejected.rejectedComplete!.layout.parts);
  });

  it('isolates callback snapshots, preserves literal prefix operations and rejects unbounded/malformed inputs', () => {
    const input = prefix(), batch = [request({ parentPort: 'stud:0:0' })], before = JSON.stringify({ input, batch, stock });
    const out = searchAnimalAttachments(stock, input, batch, { score: l => { l.parts[0].x = 999; return 0; }, validate: (l, intent) => { l.parts[1].partId = 'invented'; intent.operations[0].twist = 90; return []; } });
    expect(out.intent?.operations[0]).toEqual(input.operations[0]); expect(out.layout?.parts[0].x).toBe(0); expect(out.layout?.parts[1].partId).toBe('plate-1x1-white');
    expect(JSON.stringify({ input, batch, stock })).toBe(before);
    expect(searchAnimalAttachments({ ...stock, 'plate-2x2-tan': NaN }, input, batch).layout).toBeUndefined();
    expect(searchAnimalAttachments(stock, input, [request({ parents: [1] })]).reason).toContain('parent');
    expect(searchAnimalAttachments(stock, input, [request({ twist: 45 })]).layout).toBeUndefined();
    expect(searchAnimalAttachments(stock, input, Array.from({ length: 80 }, () => batch[0])).reason).toContain('1–80');
    const tilted: WholeAnimalConnectionIntent = { rootRotation: 0, operations: [root('sidebrick-1x1-white'), { partId: 'plate-1x1-white', role: 'head', parent: 0, parentPort: 'side:0', childPort: 'grip:0:0', twist: 0 }] };
    expect(searchAnimalAttachments({ 'sidebrick-1x1-white': 1, 'plate-1x1-white': 1 }, tilted, []).reason).toContain('upright');
  });
});
