import { afterEach, describe, expect, it, vi } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import { authoredWholeAnimalTestLayouts, testBlueprint } from '../../../test/whole-animal-fixtures';
import { composeWholeAnimal, wholeAnimalIssues, type WholeAnimalRole } from '../assembly-composer/animal-whole';
import { attachmentTwist, connectionPairs, frame } from '../connections';
import type { WholeAnimalConnection, WholeAnimalConnectionIntent } from './whole-animal-connections';
import { discoverWholeAnimalAttachments, searchWholeAnimalAttachmentsSync, type WholeAnimalStageSearchInput, type WholeAnimalStageSearchOutput } from './whole-animal-attachment-discovery';

const emptyResult = (): WholeAnimalStageSearchOutput => ({ search: { attempts: 0, exhausted: false, reason: 'Test-only bounded failure.' } });
class FakeWorker {
  static instances: FakeWorker[] = [];
  static constructed?: () => void;
  static postError?: Error;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((_data: unknown) => { if (FakeWorker.postError) throw FakeWorker.postError; });
  constructor(readonly url: URL, readonly options: WorkerOptions) { FakeWorker.instances.push(this); FakeWorker.constructed?.(); }
}
function cleaned(worker: FakeWorker, signal?: AbortSignal, removed?: ReturnType<typeof vi.spyOn>) {
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull();
  if (signal && removed) expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
}
/** Test-only real graph extracted independently from two authored physical
 * fixtures. No runtime synthesis/provider import and no mocked geometry. */
function fixture(index = 0) {
  const source = authoredWholeAnimalTestLayouts()[index], composition = composeWholeAnimal(large.stock, source), blueprint = testBlueprint(composition);
  const parts = composition.build.steps.flatMap(s => s.parts), ff = parts.map(frame);
  const roles = new Map(composition.receipts.flatMap(r => r.indices.map(i => [i, r.role as WholeAnimalRole] as const)));
  const root = composition.receipts.find(r => r.role === 'head')!.indices[0];
  const order = [root], seen = new Set(order), parents = new Map<number, number>(), ends: number[] = [];
  const features = new Set(['head', 'neck', 'muzzle', 'nose', 'eye-left', 'eye-right', 'ear-left', 'ear-right']);
  for (const stage of ['features', 'body', 'legs', 'tail']) {
    for (let cursor = 0; cursor < order.length; cursor++) for (let i = 0; i < parts.length; i++) {
      const role = roles.get(i)!;
      const allowed = stage === 'features' ? features.has(role) : stage === 'body' ? role !== 'tail' && !role.startsWith('leg-') : stage === 'legs' ? role !== 'tail' : true;
      if (!seen.has(i) && allowed && connectionPairs(ff[order[cursor]], ff[i]).length) { parents.set(i, order[cursor]); seen.add(i); order.push(i); }
    }
    ends.push(order.length);
  }
  if (order.length !== parts.length) throw Error('Test fixture has a disconnected stage.');
  const operations: WholeAnimalConnection[] = order.map((i, index) => {
    if (!index) return { partId: parts[i].partId, role: roles.get(i)!, parent: -1, parentPort: '', childPort: '', twist: 0 };
    const parent = parents.get(i)!, [parentPort, childPort] = connectionPairs(ff[parent], ff[i])[0];
    return { partId: parts[i].partId, role: roles.get(i)!, parent: order.indexOf(parent), parentPort, childPort, twist: attachmentTwist(parts[parent], parentPort, parts[i], childPort)! };
  });
  const rootRotation = ((Math.round(Math.atan2(ff[root].rotation[3], ff[root].rotation[0]) * 180 / Math.PI) + 360) % 360) as WholeAnimalConnectionIntent['rootRotation'];
  const prefix = { rootRotation, operations: operations.slice(0, ends[2]) };
  const input: WholeAnimalStageSearchInput = { stock: { ...large.stock }, prefix, operations: operations.slice(ends[2]), blueprint, stage: 'tail', state: { stage: 'tail', prefix: structuredClone(prefix) }, minParts: 20,
    meta: { id: 'attachment-worker-test', description: 'Test-only exact whole graph; no provider or visual qualification.', stance: blueprint.stance } };
  return { input, operations, ends, composition };
}
let cached: ReturnType<typeof fixture> | undefined;
const input = () => structuredClone((cached ??= fixture()).input);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; FakeWorker.constructed = undefined; FakeWorker.postError = undefined; });

describe('whole-animal attachment worker lifecycle', () => {
  it('snapshots all invocation input, uses a module worker, clones output and cleans success', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const request = input(), before = structuredClone(request), ctl = new AbortController(), removed = vi.spyOn(ctl.signal, 'removeEventListener');
    const promise = discoverWholeAnimalAttachments(request, ctl.signal), worker = FakeWorker.instances[0];
    request.stock['plate-1x2-tan'] = 0; request.operations[0].role = 'nose'; request.prefix.operations[0].twist = 90;
    request.blueprint.description = 'Changed'; request.state!.prefix.operations[0].partId = 'invented'; request.meta.id = 'changed';
    expect(worker.url.href).toContain('whole-animal-attachment.worker.ts'); expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledWith(before);
    const response = emptyResult(); worker.onmessage!({ data: { ok: true, result: response } });
    const out = await promise; expect(out).toEqual(response); expect(out).not.toBe(response); response.search.reason = 'Changed response'; expect(out.search.reason).not.toBe(response.search.reason);
    cleaned(worker, ctl.signal, removed);
  });

  it('rejects pre-abort, setup abort and queued responses after cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pre = new AbortController(); pre.abort(); await expect(discoverWholeAnimalAttachments(input(), pre.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(FakeWorker.instances).toHaveLength(0);
    const setup = new AbortController(); FakeWorker.constructed = () => setup.abort();
    await expect(discoverWholeAnimalAttachments(input(), setup.signal)).rejects.toMatchObject({ name: 'AbortError' }); cleaned(FakeWorker.instances[0]); expect(FakeWorker.instances[0].postMessage).not.toHaveBeenCalled();
    FakeWorker.constructed = undefined;
    const ctl = new AbortController(), removed = vi.spyOn(ctl.signal, 'removeEventListener'), promise = discoverWholeAnimalAttachments(input(), ctl.signal), worker = FakeWorker.instances[1], late = worker.onmessage!;
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' }); ctl.abort(); late({ data: { ok: true, result: emptyResult() } }); await assertion; cleaned(worker, ctl.signal, removed);
  });

  it.each(['worker', 'message', 'remote', 'invalid', 'clone', 'post'] as const)('cleans up %s failures without returning a candidate', async kind => {
    vi.stubGlobal('Worker', FakeWorker); if (kind === 'post') FakeWorker.postError = new Error('post failure');
    const promise = discoverWholeAnimalAttachments(input()), worker = FakeWorker.instances[0];
    if (kind === 'worker') worker.onerror!({ message: 'worker failure' });
    if (kind === 'message') worker.onmessageerror!();
    if (kind === 'remote') worker.onmessage!({ data: { ok: false, error: 'remote failure' } });
    if (kind === 'invalid') worker.onmessage!({ data: { ok: true } });
    if (kind === 'clone') worker.onmessage!({ data: { ok: true, result: { ...emptyResult(), uncloneable: () => 1 } } });
    await expect(promise).rejects.toBeInstanceOf(Error); cleaned(worker);
  });

  it('cleans up a 30s watchdog and gives concurrent calls independent lifecycles', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
    const ctl = new AbortController(), first = discoverWholeAnimalAttachments(input(), ctl.signal), second = discoverWholeAnimalAttachments(input());
    const a = expect(first).rejects.toMatchObject({ name: 'AbortError' }); ctl.abort(); await a;
    expect(FakeWorker.instances[1].terminate).not.toHaveBeenCalled();
    const b = expect(second).rejects.toThrow('timed out'); await vi.advanceTimersByTimeAsync(30000); await b;
    FakeWorker.instances.forEach(w => cleaned(w)); expect(vi.getTimerCount()).toBe(0);
  });

  it('fails input cloning before worker creation and honors cancellation during response cloning', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    await expect(discoverWholeAnimalAttachments({ ...input(), unsupported: () => 0 } as WholeAnimalStageSearchInput)).rejects.toBeInstanceOf(Error);
    expect(FakeWorker.instances).toHaveLength(0);
    const ctl = new AbortController(), promise = discoverWholeAnimalAttachments(input(), ctl.signal), worker = FakeWorker.instances[0];
    const result = { get search() { ctl.abort(); return emptyResult().search; } };
    worker.onmessage!({ data: { ok: true, result } }); await expect(promise).rejects.toMatchObject({ name: 'AbortError' }); cleaned(worker);
  });

  it('Worker-less fallback yields to immediate abort and snapshots before the yield', async () => {
    vi.stubGlobal('Worker', undefined);
    const ctl = new AbortController(), cancelled = discoverWholeAnimalAttachments(input(), ctl.signal); ctl.abort(); await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const request = input(), before = structuredClone(request), pending = discoverWholeAnimalAttachments(request);
    request.stock = {}; request.operations[0].partId = 'invented'; request.meta.id = 'changed';
    const out = await pending; expect(out.search.intent).toBeDefined(); expect(out.search.intent!.operations).toEqual([...before.prefix.operations, ...before.operations]); expect(out.canonical).toBeUndefined();
  });
});

describe('real pure whole-animal stage search', () => {
  it.each([0, 1])('preserves actual stance %i graph, prefix poses, exact stock and independently compiled modules', index => {
    const f = fixture(index), before = JSON.stringify(f.input), out = searchWholeAnimalAttachmentsSync(f.input);
    expect(out.search.intent, out.search.reason).toBeDefined(); expect(out.search.changes).toEqual([]); expect(out.canonical).toBeUndefined();
    expect(out.search.intent!.operations.slice(0, f.input.prefix.operations.length)).toEqual(f.input.prefix.operations);
    const c = composeWholeAnimal(f.input.stock, { ...out.search.layout!, ...f.input.meta }); expect(wholeAnimalIssues(c)).toEqual([]); expect(c.remaining).toEqual(f.composition.remaining);
    expect(c.build.steps.flatMap(s => s.parts)).toHaveLength(f.operations.length); expect(JSON.stringify(f.input)).toBe(before);
  });

  it('repairs a real bad final port through the same fixed-ID and role request policy', () => {
    const request = input(); request.operations.at(-1)!.parentPort = 'stud:999:999';
    const out = searchWholeAnimalAttachmentsSync(request);
    expect(out.search.intent, out.search.reason).toBeDefined(); expect(out.search.changes?.length).toBeGreaterThan(0);
    expect(out.search.intent!.operations.map(op => [op.partId, op.role])).toEqual([...request.prefix.operations, ...request.operations].map(op => [op.partId, op.role]));
    expect(out.search.intent!.operations.slice(0, request.prefix.operations.length)).toEqual(request.prefix.operations);
  }, 15000);

  it('retains complete canonical sketch-mismatch evidence separately, with no accepted search candidate', () => {
    const request = input(); request.operations = []; request.prefix.operations.push(...input().operations); request.state = undefined;
    request.blueprint.regions.find(r => r.role === 'leg-front-left')!.intent = 'taper';
    const out = searchWholeAnimalAttachmentsSync(request);
    expect(out.search.intent).toBeUndefined(); expect(out.search.layout).toBeUndefined(); expect(out.search.rejectedComplete?.accepted).toBe(false);
    expect(out.canonical).toBeDefined(); expect(out.canonical!.issues.join(';')).toContain('no selected contour profile'); expect(Number.isFinite(out.canonical!.rank)).toBe(true);
    expect(wholeAnimalIssues(out.canonical!.composition)).toEqual([]); expect(out.canonical!.composition.remaining).toEqual((cached ??= fixture()).composition.remaining);
  });

  it('preserves stage/face/partial-fit rejection and exact-stock failure without canonical capture', () => {
    const f = fixture(), request = f.input; request.state = undefined; request.stage = 'features'; request.prefix.operations = []; request.operations = f.operations.slice(0, f.ends[0]);
    const valid = searchWholeAnimalAttachmentsSync(request); expect(valid.search.intent, valid.search.reason).toBeDefined();
    const bad = structuredClone(request); bad.operations = []; bad.prefix = valid.search.intent!;
    bad.blueprint.size.max = [1, 1, 1];
    const rejected = searchWholeAnimalAttachmentsSync(bad); expect(rejected.search.intent).toBeUndefined(); expect(rejected.search.rejectedComplete?.issues.join(';')).toContain('already exceed final maximum'); expect(rejected.canonical).toBeUndefined();
    const scarce = input(); scarce.stock[scarce.operations[0].partId] = 0;
    const failed = searchWholeAnimalAttachmentsSync(scarce); expect(failed.search.intent).toBeUndefined(); expect(failed.search.rejectedComplete).toBeUndefined(); expect(failed.canonical).toBeUndefined(); expect(failed.search.reason).toContain('stock');
  });
});
