import { afterEach, describe, expect, it, vi } from 'vitest';
import { detailRetryCandidates, DETAIL_RETRY_LIMIT, DETAIL_RETRY_TIMEOUT_MS } from './scan-retry';
import { deepScan, type DetailRetryEvent } from './scan';
import { applyDetections, correctDetections, type Detection } from './gemini';
import { parsePartId } from './bricks';
import { counts, editPiece, emptyInventory, type Box } from './inventory';

vi.mock('./render', () => ({ scanKey: async () => undefined, colorKey: () => undefined }));
const box: Box = [100, 100, 200, 300];
const det = (id: string | null, confidence = .8, b = box): Detection => ({ kind: id ? parsePartId(id) : null, box: b, confidence, color: 'white', description: id ?? 'unclear piece', unknown: !id });
const raw = (extra: Record<string, unknown> = {}) => ({ type: 'plate', size: '1x2', color: 'white', heightPlates: 1, confidence: .8, description: 'white plate', buildsAs: '', outline: 'rectangle', topShape: 'flat', studsOnTop: 2, studLayout: 'grid', ...extra });
const image = 'data:image/jpeg;base64,test';
function canvas() {
  const context = new Proxy({}, { get: () => vi.fn(), set: () => true });
  return { width: 1000, height: 1000, getContext: () => context, toDataURL: () => image } as unknown as HTMLCanvasElement;
}
function setup(readings: unknown[]) {
  vi.stubGlobal('document', { createElement: () => canvas() });
  let call = 0;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const reading = readings[call++];
    if (typeof reading === 'function') return reading(init);
    if (reading instanceof Error) throw reading;
    if (!reading) throw new Error('Unexpected test request');
    return new Response(JSON.stringify({ modelVersion: "gemini-test-model", candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(reading) }] } }] }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const survey = (p = raw()) => ({ parts: [{ ...p, box_2d: box }], estimatedTotal: 1 });
const check = (p = raw()) => ({ parts: [{ ...p, n: 1 }] });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('individual identification retry', () => {
  it('prioritizes conflicts, bounds cost, and leaves confident and human-only readings alone', () => {
    const known = det('plate-1x2-white'), conflict = det('brick-1x2-white');
    const unknowns = Array.from({ length: 20 }, (_, i) => det(null, .4, [i * 10, 10, i * 10 + 5, 20]));
    const manual = { ...det(null), review: 'Exact special mold and color need human confirmation' };
    const candidates = detailRetryCandidates([[known, known], [manual, manual], ...unknowns.map(d => [d, d] as [Detection, Detection]), [known, conflict]]);
    expect(candidates).toHaveLength(DETAIL_RETRY_LIMIT);
    expect(candidates[0].reason).toBe('conflicting-readings');
    expect(candidates.some(c => c.current === manual || c.current === known)).toBe(false);
  });

  it('recovers an unknown with original pixels, normal gates and exactly one stock observation', async () => {
    const fetch = setup([survey(), check(raw({ type: 'unknown', confidence: .3 })), check()]);
    let inv = emptyInventory();
    const events: DetailRetryEvent[] = [], phases: string[] = [];
    const bitmap = { width: 4000, height: 4000, close: vi.fn() } as unknown as ImageBitmap;
    await deepScan(canvas(), { onDetections: d => { inv = applyDetections(inv, d, 1); }, onCorrections: c => { inv = correctDetections(inv, c, 1); }, onProgress: p => phases.push(p.phase) }, undefined, { detailSource: async () => bitmap, onDetailRetry: e => events.push(e) });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(counts(inv)).toEqual({ 'plate-1x2-white': 1 });
    expect(inv.parts['plate-1x2-white'].confirmedCount).toBe(0);
    expect(inv.parts['plate-1x2-white'].boxes[0].box).toEqual(box);
    expect(bitmap.close).toHaveBeenCalledTimes(2); // original crops for the regular and individual passes
    expect(events[0]).toMatchObject({ source: 'original', status: 'changed' });
    expect(phases).toContain('detail');
  });

  it('supports a zero-extra-call baseline and leaves a failed retry uncertain', async () => {
    for (const enabled of [false, true]) {
      const fetch = setup([survey(), check(raw({ confidence: .2 })), new Error('offline')]);
      let inv = emptyInventory();
      await deepScan(canvas(), { onDetections: d => { inv = applyDetections(inv, d, 1); }, onCorrections: c => { inv = correctDetections(inv, c, 1); }, onProgress: () => {} }, undefined, { detailRetry: enabled });
      expect(fetch).toHaveBeenCalledTimes(enabled ? 3 : 2);
      expect(counts(inv)).toEqual({});
    }
  });

  it('quarantines a conflicting or negative individual reading and never silently removes a piece', async () => {
    for (const third of [raw({ type: 'brick', heightPlates: 3 }), raw({ type: 'non-part' })]) {
      setup([survey(raw({ type: 'brick', heightPlates: 3 })), check(), check(third)]);
      let inv = emptyInventory();
      await deepScan(canvas(), { onDetections: d => { inv = applyDetections(inv, d, 1); }, onCorrections: c => { inv = correctDetections(inv, c, 1); }, onProgress: () => {} });
      expect(counts(inv)).toEqual({});
      expect(inv.others).toHaveLength(1);
      expect(inv.others[0].description).toContain('disagrees');
    }
  });

  it('preserves a manual correction made while the retry is in flight', async () => {
    setup([survey(), check(raw({ confidence: .2 })), check()]);
    let inv = emptyInventory();
    await deepScan(canvas(), { onDetections: d => { inv = applyDetections(inv, d, 1); }, onCorrections: c => { inv = correctDetections(inv, c, 1); }, onProgress: p => {
      if (p.phase === 'detail' && p.sheets?.done === 0) inv = editPiece(inv, box, 1, { kind: parsePartId('brick-1x2-white')! });
    } });
    expect(counts(inv)).toEqual({ 'brick-1x2-white': 1 });
    expect(inv.parts['brick-1x2-white'].confirmedCount).toBe(1);
  });

  it('cancels without committing late results and closes the original bitmap', async () => {
    const ctl = new AbortController();
    setup([survey(), check(raw({ confidence: .2 })), async () => { ctl.abort(); return new Response(JSON.stringify({ modelVersion: "gemini-test-model", candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(check()) }] } }] })); }]);
    const bitmap = { width: 2000, height: 2000, close: vi.fn() } as unknown as ImageBitmap;
    const events: DetailRetryEvent[] = [];
    await expect(deepScan(canvas(), { onDetections: () => {}, onProgress: () => {} }, ctl.signal, { detailSource: async () => bitmap, onDetailRetry: e => events.push(e) })).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalledTimes(2);
    expect(events).toEqual([]);
  });

  it('ends the optional pass at its deadline without hanging the scan or inventing progress', async () => {
    vi.useFakeTimers();
    setup([survey(), check(raw({ confidence: .2 })), (init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))]);
    const events: DetailRetryEvent[] = [], progress: string[] = [];
    const task = deepScan(canvas(), { onDetections: () => {}, onProgress: p => progress.push(p.phase) }, undefined, { onDetailRetry: e => events.push(e) });
    await vi.advanceTimersByTimeAsync(DETAIL_RETRY_TIMEOUT_MS + 1);
    await task;
    expect(events[0].status).toBe('timed-out');
    expect(progress.at(-1)).toBe('done');
  });

  it('limits simultaneous calls to two and total retries to eight', async () => {
    const boxes: Box[] = Array.from({ length: 12 }, (_, i) => [i * 50, 100, i * 50 + 20, 140]);
    let active = 0, peak = 0;
    const fetch = setup([
      { parts: boxes.map(b => ({ ...raw(), box_2d: b })), estimatedTotal: 12 },
      ...Array.from({length: 2}, () => ({ parts: boxes.slice(0, 6).map((_, i) => ({ ...raw({ confidence: .2 }), n: i + 1 })) })),
      ...Array.from({ length: 8 }, () => async () => {
        active++; peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, 1)); active--;
        return new Response(JSON.stringify({ modelVersion: 'gemini-test-model', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(check()) }] } }] }));
      }),
    ]);
    const events: DetailRetryEvent[] = [];
    await deepScan(canvas(), { onDetections: () => {}, onProgress: () => {} }, undefined, { onDetailRetry: e => events.push(e) });
    expect(fetch).toHaveBeenCalledTimes(11); expect(events).toHaveLength(8); expect(peak).toBe(2);
  });

  it('falls back to working pixels if the original cannot be decoded', async () => {
    setup([survey(), check(raw({ confidence: .2 })), check()]);
    const events: DetailRetryEvent[] = [];
    await deepScan(canvas(), { onDetections: () => {}, onProgress: () => {} }, undefined, { detailSource: async () => { throw Error('decode failed'); }, onDetailRetry: e => events.push(e) });
    expect(events[0]).toMatchObject({ source: 'working', status: 'changed' });
  });

  it('cannot promote an unsupported exact mold through the individual pass', async () => {
    setup([survey(), check(raw({ confidence: .2 })), check(raw({ type: 'sidebrick', size: '1x2', heightPlates: 3, studLayout: 'side' }))]);
    let inv = emptyInventory();
    await deepScan(canvas(), { onDetections: d => { inv = applyDetections(inv, d, 1); }, onCorrections: c => { inv = correctDetections(inv, c, 1); }, onProgress: () => {} });
    expect(counts(inv)).toEqual({}); expect(inv.others).toHaveLength(1);
    expect(inv.others[0].unknown).toBe(true);
  });
});
