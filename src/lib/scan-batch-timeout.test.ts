import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepScan, crossCheck, type ScanProgress } from './scan';
import { SCAN_BATCH_TIMEOUT_MS } from './scan-deadline';
import { applyDetections, correctDetections, type Detection } from './gemini';
import { counts, editPiece, emptyInventory, type Box } from './inventory';
import { parsePartId } from './bricks';

vi.mock('./render', () => ({ scanKey: async () => undefined, colorKey: () => undefined }));
const box: Box = [100, 100, 200, 300];
const raw = (extra: Record<string, unknown> = {}) => ({ type: 'plate', size: '1x2', color: 'white', heightPlates: 1, confidence: .9, description: 'white plate', buildsAs: '', outline: 'rectangle', topShape: 'flat', studsOnTop: 2, studLayout: 'grid', ...extra });
const response = (value: unknown) => new Response(JSON.stringify({ modelVersion: 'gemini-test-model', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));
const survey = (p = raw()) => ({ parts: [{ ...p, box_2d: box }], estimatedTotal: 1 });
const check = (p = raw()) => ({ parts: [{ ...p, n: 1 }] });
function canvas() {
  const context = new Proxy({}, { get: (_target, key) => key === 'getImageData' ? () => ({ data: new Uint8ClampedArray([200, 200, 200, 255]) }) : vi.fn(), set: () => true });
  return { width: 1000, height: 1000, dataset: {}, getContext: () => context, toDataURL: () => 'data:image/jpeg;base64,test' } as unknown as HTMLCanvasElement;
}
function setup(readings: unknown[]) {
  vi.useFakeTimers(); vi.stubGlobal('document', { createElement: () => canvas() });
  let call = 0;
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const next = readings[call++];
    if (typeof next === 'function') return next(init);
    if (!next) throw Error('Unexpected request');
    return response(next);
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
function inventoryCallbacks() {
  let inv = emptyInventory();
  const progress: ScanProgress[] = [];
  return { read: () => inv, edit: () => { inv = editPiece(inv, box, 1, { kind: parsePartId('brick-1x2-white')! }); }, progress,
    callbacks: { onDetections: (ds: Detection[]) => { inv = applyDetections(inv, ds, 1); }, onCorrections: (cs: { from: Detection; to: Detection | null }[]) => { inv = correctDetections(inv, cs, 1); }, onProgress: (p: ScanProgress) => { progress.push(p); } } };
}
const hanging = () => new Promise<Response>(() => {});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('scan batch deadlines', () => {
  it('keeps a successful batch, quarantines a slow one, and ignores its late response', async () => {
    const boxes: Box[] = Array.from({ length: 7 }, (_, i) => [i * 40, 100, i * 40 + 20, 140]);
    let late!: (value: Response) => void;
    const fetch = setup([
      { parts: boxes.map(b => ({ ...raw(), box_2d: b })), estimatedTotal: 7 },
      { parts: boxes.slice(0, 6).map((_, i) => ({ ...raw(), n: i + 1 })) },
      () => new Promise<Response>(r => { late = r; }),
    ]);
    const state = inventoryCallbacks();
    const task = deepScan(canvas(), state.callbacks, undefined, { detailRetry: false, recoverFailed: false });
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS + 1); await task;
    expect(counts(state.read())).toEqual({ 'plate-1x2-white': 6 });
    expect(state.read().others).toHaveLength(1);
    expect(state.read().others[0].description).toContain('timed out');
    expect(state.progress.at(-1)).toMatchObject({ phase: 'done', timedOutChecks: 1 });
    const before = JSON.stringify(state.read()), events = state.progress.length;
    late(response(check())); await vi.advanceTimersByTimeAsync(1);
    expect(JSON.stringify(state.read())).toBe(before); expect(state.progress).toHaveLength(events);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('continues to a distinct individual crop after a close-up timeout', async () => {
    const fetch = setup([survey(), hanging, check()]); const state = inventoryCallbacks();
    const task = deepScan(canvas(), state.callbacks, undefined, {recoverFailed: false});
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS + 1); await task;
    expect(state.progress.some(p => p.phase === 'detail')).toBe(true);
    expect(counts(state.read())).toEqual({ 'plate-1x2-white': 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(state.progress.at(-1)).toMatchObject({ phase: 'done', timedOutChecks: 1 });
  });

  it('preserves a manual correction made while the batch is waiting', async () => {
    setup([survey(), hanging]); const state = inventoryCallbacks();
    const task = deepScan(canvas(), state.callbacks, undefined, { detailRetry: false });
    await vi.advanceTimersByTimeAsync(1); state.edit();
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS); await task;
    expect(counts(state.read())).toEqual({ 'brick-1x2-white': 1 });
    expect(state.read().parts['brick-1x2-white'].confirmedCount).toBe(1);
  });

  it('does not turn user cancellation into a timeout or commit fallback corrections', async () => {
    setup([survey(), hanging]); const state = inventoryCallbacks(), ctl = new AbortController();
    const task = deepScan(canvas(), state.callbacks, ctl.signal).catch(e => e);
    await vi.advanceTimersByTimeAsync(1); const before = JSON.stringify(state.read());
    const reason = new Error('Stop this scan'); ctl.abort(reason);
    expect(await task).toBe(reason);
    expect(JSON.stringify(state.read())).toBe(before);
    expect(state.progress.at(-1)?.phase).toBe('check');
  });

  it('moves past timed-out section scans without adding invented detections', async () => {
    setup([{ parts: [], estimatedTotal: 30 }, ...Array.from({ length: 4 }, () => hanging)]);
    const state = inventoryCallbacks(), task = deepScan(canvas(), state.callbacks);
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS + 1); await task;
    expect(state.progress.at(-1)).toMatchObject({ phase: 'done', timedOutChecks: 4 });
    expect(state.progress.at(-1)?.tiles.every(t => t.state === 'failed')).toBe(true);
    expect(counts(state.read())).toEqual({});
  });

  it('finishes when a large-piece recount stalls and leaves its dimensions for review', async () => {
    const p = raw({ size: '4x6', studsOnTop: 24 });
    setup([survey(p), check(p), hanging]); const state = inventoryCallbacks();
    const task = deepScan(canvas(), state.callbacks);
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS + 1); await task;
    expect(counts(state.read())).toEqual({});
    expect(state.read().others[0].description).toContain('Recount timed out');
    expect(state.progress.at(-1)).toMatchObject({ phase: 'done', timedOutChecks: 1 });
  });

  it('finishes angle checks with no invented vote when locating a piece stalls', async () => {
    setup([hanging]); const progress: number[][] = [];
    const d: Detection = { kind: parsePartId('plate-1x2-white'), box, color: 'white', confidence: .9, description: 'plate' };
    const task = crossCheck(canvas(), [d], canvas(), { onProgress: (...p) => progress.push(p) });
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS + 1);
    expect(await task).toEqual([]); expect(progress.at(-1)).toEqual([1, 1, 1]);
  });

  it('finishes angle checks with no invented vote when the height judgment stalls', async () => {
    setup([{ parts: [{ n: 1, found: true, box_2d: box, confidence: .9 }] }, hanging]); const progress: number[][] = [];
    const d: Detection = { kind: parsePartId('plate-1x2-white'), box, color: 'white', confidence: .9, description: 'plate' };
    const task = crossCheck(canvas(), [d], canvas(), { onProgress: (...p) => progress.push(p) });
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS + 1);
    expect(await task).toEqual([]); expect(progress.at(-1)).toEqual([2, 2, 1]);
  });
});
