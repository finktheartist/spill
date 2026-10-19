import {afterEach, describe, expect, it, vi} from 'vitest';
import {checkScanObservations, CLOSEUP_CONCURRENCY, decideFromAngles, needsHeightCheck} from './scan';
import {SCAN_BATCH_TIMEOUT_MS} from './scan-deadline';
import {unfinishedScanObservations} from './scan-unfinished';
import {applyDetections, correctDetections, type Detection} from './gemini';
import {counts, editPiece, emptyInventory, type Box} from './inventory';
import {parsePartId} from './bricks';

vi.mock('./render', () => ({scanKey: async () => undefined, colorKey: () => undefined}));
const raw = (n: number, extra = {}) => ({n, type: 'plate', size: '1x2', color: 'white', heightPlates: 1, confidence: .9,
  description: 'white plate', buildsAs: '', outline: 'rectangle', topShape: 'flat', studsOnTop: 2, studLayout: 'grid', ...extra});
const response = (count: number, extra = {}) => new Response(JSON.stringify({modelVersion: 'gemini-test-model',
  candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify({parts: Array.from({length: count}, (_, i) => raw(i + 1, extra))})}]}}]}));
const detections = (count: number): Detection[] => Array.from({length: count}, (_, i) => ({kind: null, color: 'white', confidence: .9,
  description: 'white piece — Close-up check timed out — confirm this observation', unknown: true, box: [i*30, 100, i*30+20, 200] as Box}));
function canvas() {
  const context = new Proxy({}, {get: () => vi.fn(), set: () => true});
  return {width: 1000, height: 1000, getContext: () => context, toDataURL: () => 'data:image/jpeg;base64,test'} as unknown as HTMLCanvasElement;
}
function setup() { vi.stubGlobal('document', {createElement: () => canvas()}); }
function state(ds: Detection[]) {
  let inv = applyDetections({...emptyInventory(), photos: [{id: 1, url: 'data:image/jpeg;base64,test'}]}, ds, 1);
  return {read: () => inv, edit: () => {inv = editPiece(inv, ds[0].box, 1, {kind: parsePartId('brick-1x2-white')!});},
    cb: {onCorrections: (cs: {from: Detection; to: Detection | null}[]) => {inv = correctDetections(inv, cs, 1);}, onProgress: vi.fn()}};
}
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();});

describe('unfinished-piece recovery', () => {
  it('requires a clear side-view vote before releasing a recovered brick or plate', () => {
    const plate = parsePartId('plate-2x3-lime')!;
    expect(needsHeightCheck({...detections(1)[0], kind: plate})).toBe(true);
    for (const votes of [[], [{heightPlates: 1, confidence: .6, stacked: false}], [{heightPlates: 1, confidence: .9, stacked: false}, {heightPlates: 3, confidence: .9, stacked: false}]]) {
      expect(decideFromAngles(plate, votes, true)).toHaveProperty('other');
    }
    expect(decideFromAngles(plate, [], false)).toEqual({kind: plate});
  });

  it('corrects plate/brick height from strong side evidence without inventing stock', () => {
    const plate = parsePartId('plate-2x3-lime')!, brick = parsePartId('brick-2x3-lime')!;
    expect(decideFromAngles(plate, [{heightPlates: 3, confidence: .9, stacked: false}], true)).toEqual({kind: brick});
    expect(decideFromAngles(brick, [{heightPlates: 1, confidence: .9, stacked: false}], true)).toEqual({kind: plate});
    expect(decideFromAngles(plate, [{heightPlates: 1, confidence: .9, stacked: false}], true)).toEqual({kind: plate});
  });

  it('withholds stacks and unsupported side-view heights rather than accepting the overhead guess', () => {
    const plate = parsePartId('plate-2x3-lime')!;
    for (const vote of [{heightPlates: 2, confidence: .9, stacked: false}, {heightPlates: 3, confidence: .9, stacked: true}, {heightPlates: 6, confidence: .9, stacked: false}]) {
      expect(decideFromAngles(plate, [vote], true)).toHaveProperty('other');
    }
  });

  it('bounds concurrency, uses the original image and checks all batches once', async () => {
    setup(); const ds = detections(13), ledger = state(ds), bitmap = {...canvas(), close: vi.fn()} as unknown as ImageBitmap;
    let active = 0, peak = 0, calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {const call = calls++; active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 1)); active--; return response(call < 2 ? 6 : 1);
    }));
    await checkScanObservations(canvas(), ds, ledger.cb, undefined, {detailSource: async () => bitmap});
    expect(peak).toBe(CLOSEUP_CONCURRENCY); expect(calls).toBe(3); expect(bitmap.close).toHaveBeenCalledOnce();
    expect(counts(ledger.read())).toEqual({'plate-1x2-white': 13});
    expect(ledger.cb.onProgress).toHaveBeenLastCalledWith({done: 3, total: 3, timedOutChecks: 0});
  });

  it('keeps a successful job, splits the timed-out group and ignores its late reply', async () => {
    setup(); vi.useFakeTimers(); const ds = detections(7), ledger = state(ds);
    let call = 0, late!: (r: Response) => void;
    const fetch = vi.fn(async () => {switch (call++) {case 0: return new Promise<Response>(r => {late = r;}); case 1: return response(1); default: return response(3);}});
    vi.stubGlobal('fetch', fetch);
    const task = checkScanObservations(canvas(), ds, ledger.cb);
    await vi.advanceTimersByTimeAsync(1); expect(counts(ledger.read())).toEqual({'plate-1x2-white': 1});
    await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS); await task;
    expect(counts(ledger.read())).toEqual({'plate-1x2-white': 7}); expect(fetch).toHaveBeenCalledTimes(4);
    expect(ledger.cb.onProgress).toHaveBeenLastCalledWith({done: 4, total: 4, timedOutChecks: 1});
    const saved = JSON.stringify(ledger.read()); late(response(6, {type: 'brick', heightPlates: 3}));
    await vi.advanceTimersByTimeAsync(1); expect(JSON.stringify(ledger.read())).toBe(saved);
  });

  it('stops after one recovery attempt per failed group and leaves them available to retry later', async () => {
    setup(); const ds = detections(6), ledger = state(ds), fetch = vi.fn(async () => {throw Error('offline');}); vi.stubGlobal('fetch', fetch);
    await checkScanObservations(canvas(), ds, ledger.cb);
    expect(fetch).toHaveBeenCalledTimes(3); expect(counts(ledger.read())).toEqual({});
    expect(unfinishedScanObservations(ledger.read()).get(1)).toHaveLength(6);
  });

  it('protects a manual correction made while the recovery is waiting', async () => {
    setup(); const ds = detections(1), ledger = state(ds);
    vi.stubGlobal('fetch', vi.fn(async () => {ledger.edit(); return response(1);}));
    await checkScanObservations(canvas(), ds, ledger.cb);
    expect(counts(ledger.read())).toEqual({'brick-1x2-white': 1}); expect(ledger.read().parts['brick-1x2-white'].confirmedCount).toBe(1);
  });

  it('cancels queued jobs, releases the bitmap and cannot apply late results', async () => {
    setup(); vi.useFakeTimers(); const ds = detections(13), ledger = state(ds), ctl = new AbortController();
    const bitmap = {...canvas(), close: vi.fn()} as unknown as ImageBitmap;
    const releases: ((r: Response) => void)[] = [], fetch = vi.fn(() => new Promise<Response>(r => releases.push(r))); vi.stubGlobal('fetch', fetch);
    const task = checkScanObservations(canvas(), ds, ledger.cb, ctl.signal, {detailSource: async () => bitmap}).catch(e => e);
    await vi.advanceTimersByTimeAsync(1); const saved = JSON.stringify(ledger.read()); ctl.abort();
    expect((await task).name).toBe('AbortError'); expect(fetch).toHaveBeenCalledTimes(2); expect(bitmap.close).toHaveBeenCalledOnce();
    releases.forEach(r => r(response(6))); await vi.advanceTimersByTimeAsync(1);
    expect(JSON.stringify(ledger.read())).toBe(saved);
  });

  it('does not remove an existing piece or auto-confirm an exact mold during a manual retry', async () => {
    for (const extra of [{type: 'non-part'}, {type: 'sidebrick', size: '1x2', heightPlates: 3, studLayout: 'side'}]) {
      setup(); const ds = detections(1), ledger = state(ds); vi.stubGlobal('fetch', vi.fn(async () => response(1, extra)));
      await checkScanObservations(canvas(), ds, ledger.cb, undefined, {retainObserved: true});
      expect(counts(ledger.read())).toEqual({}); expect(ledger.read().others).toHaveLength(1); expect(ledger.read().others[0].confirmed).not.toBe(true);
    }
  });

  it('selects only unique unfinished overhead observations with saved photos and no manual lock', () => {
    const ds = detections(5), ledger = state(ds); ledger.edit(); const inv = ledger.read();
    inv.others[0].confirmed = true; inv.others[1].description = 'Exact special mold needs confirmation';
    inv.others[2].boxes[0].photo = 2; inv.photos.push({id: 2, ref: 1, url: 'angle'});
    expect(unfinishedScanObservations(inv).get(1)).toHaveLength(1);
    inv.others.push(structuredClone(inv.others.at(-1)!)); expect(unfinishedScanObservations(inv).size).toBe(0);
  });
});
