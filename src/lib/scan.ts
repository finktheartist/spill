// Photo → parts, at whatever zoom the pile needs. A whole-photo pass finds the big, legible parts and
// estimates how many there are in total. If the pile is dense, the photo is cut into overlapping
// sections that are scanned in parallel (each brick is then several times bigger to the model), and
// parts seen twice where sections overlap are dropped. Last, every part found is cropped from the
// full-resolution photo onto numbered contact sheets and identified again up close (height, small details).
import { checkParts, countStuds, findInAngle, judgeHeights, recheck, scanImage, quarantineDetection, scanKindIssue, validScanBox, type Detection } from './gemini';
import { isRealSize } from './catalog';
import { heightOf, normalizeSize, parsePartId, partId, type PartKind, type PartType } from './bricks';
import type { Box } from './inventory';
import { colorKey, scanKey } from './render';
import { detailRetryCandidates, DETAIL_RETRY_CONCURRENCY, DETAIL_RETRY_TIMEOUT_MS, type RetryReason } from './scan-retry';
import { ScanTimeoutError, withScanDeadline } from './scan-deadline';

export type TileState = 'waiting' | 'looking' | 'done' | 'failed';
/** 0–1000 of the photo. x/y/w/h is the overlapping area sent to the model; core is the grid cell drawn on screen. */
export interface Tile { x: number; y: number; w: number; h: number; core: [number, number, number, number]; state: TileState }
export interface ScanProgress { phase: 'survey' | 'zoom' | 'check' | 'detail' | 'count' | 'cross' | 'done'; tiles: Tile[]; estimate: number; sheets?: { done: number; total: number }; timedOutChecks?: number }
export interface DetailRetryEvent {
  box: Box; reason: RetryReason; status: 'changed' | 'unchanged' | 'review' | 'failed' | 'timed-out';
  before: Detection; after: Detection; elapsedMs: number; source: 'original' | 'working';
}
export interface ScanOptions {
  /** Disabled only for controlled baseline evaluation. */
  detailRetry?: boolean;
  /** One bounded smaller-batch recovery pass; false only for controlled QA. */
  recoverFailed?: boolean;
  /** Lazily decode the uploaded file; the scan closes this bitmap after use. */
  detailSource?: () => Promise<ImageBitmap>;
  onDetailRetry?: (event: DetailRetryEvent) => void;
}

const SURVEY_MAX = 150;
const TILE_MAX = 120;
const SHEET_COLS = 4, SHEET_CELL = 256; // 16 close-ups per contact sheet
export const CLOSEUP_BATCH_SIZE = 6;
export const CLOSEUP_CONCURRENCY = 2;

/** Retry existing observations without surveying, adding stock or changing their boxes.
 * Successful jobs survive failures; failed groups get one smaller-group retry. */
export async function checkScanObservations(full: HTMLCanvasElement, detections: Detection[], cb: {
  onCorrections: (changes: {from: Detection; to: Detection | null}[]) => void;
  onProgress: (progress: {done: number; total: number; timedOutChecks: number}) => void;
}, signal?: AbortSignal, options: Pick<ScanOptions, 'detailSource' | 'recoverFailed'> & {key?: string; retainObserved?: boolean} = {}) {
  const final = new Map(detections.map(d => [d, d]));
  if (!detections.length) return final;
  let bitmap: ImageBitmap | undefined;
  try {
    signal?.throwIfAborted();
    if (options.detailSource) {
      try { bitmap = await options.detailSource(); }
      catch (error) { if (signal?.aborted) throw error; }
    }
    signal?.throwIfAborted();
    const source = bitmap ?? full, key = options.key ?? await scanKey();
    const pitch = studPitch(detections, source.width, source.height);
    const jobs = Array.from({length: Math.ceil(detections.length / CLOSEUP_BATCH_SIZE)}, (_, i) => ({
      originals: detections.slice(i * CLOSEUP_BATCH_SIZE, (i + 1) * CLOSEUP_BATCH_SIZE), recovery: false,
    }));
    let cursor = 0, done = 0, timedOutChecks = 0;
    const progress = () => cb.onProgress({done, total: jobs.length, timedOutChecks});
    const commit = (original: Detection, next: Detection | null) => {
      signal?.throwIfAborted();
      const current = final.get(original);
      if (!current || current === next) return;
      if (next) final.set(original, next); else final.delete(original);
      cb.onCorrections([{from: current, to: next}]);
    };
    progress();
    const worker = async () => {
      while (cursor < jobs.length) {
        signal?.throwIfAborted();
        const job = jobs[cursor++], originals = job.originals.filter(d => final.has(d));
        const current = originals.map(d => final.get(d)!);
        const failed: Detection[] = [];
        try {
          const sheet = contactSheet(source, current, pitch, Math.min(3, current.length), 512, 1.3);
          (globalThis as {__spillSheets?: string[]}).__spillSheets?.push(sheet);
          const found = await withScanDeadline(s => checkParts(sheet, current.length, key, s, !!pitch, colorKey()), signal);
          signal?.throwIfAborted();
          originals.forEach((original, i) => {
            const raw = found.get(i + 1), before = current[i];
            if (!raw) {
              failed.push(original);
              commit(original, quarantineDetection(before, 'Close-up check missing — confirm this observation'));
              return;
            }
            const next = recheck(before, raw) ?? before;
            if (next.nonPart && options.retainObserved) {
              commit(original, {...quarantineDetection(before, 'Close-up disagrees — confirm this piece'), description: 'Close-up disagrees — confirm this piece'});
            } else commit(original, next.nonPart ? null : next);
          });
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof ScanTimeoutError) timedOutChecks++;
          for (const original of originals) {
            failed.push(original);
            commit(original, quarantineDetection(final.get(original)!, error instanceof ScanTimeoutError ? 'Close-up check timed out — confirm this observation' : 'Close-up check failed — confirm this observation'));
          }
        }
        // Never loop forever on a provider failure. A user can retry the remainder later.
        if (failed.length && !job.recovery && options.recoverFailed !== false) {
          for (let i = 0; i < failed.length; i += 3) jobs.push({originals: failed.slice(i, i + 3), recovery: true});
        }
        done++; progress();
      }
    };
    await Promise.all(Array.from({length: Math.min(CLOSEUP_CONCURRENCY, jobs.length)}, worker));
    return final;
  } finally { bitmap?.close(); }
}

function area([y0, x0, y1, x1]: Box) { return Math.max(0, y1 - y0) * Math.max(0, x1 - x0); }
function overlap(a: Box, b: Box) {
  const i = area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  return { iou: i / (area(a) + area(b) - i || 1), contain: i / (Math.min(area(a), area(b)) || 1) };
}
const sameThing = (a: Detection, b: Detection) => a.color === b.color && (a.kind?.type ?? 'other') === (b.kind?.type ?? 'other');

/** Detections in `incoming` that aren't already in `accepted` (or earlier in `incoming`). */
export function dedupe(accepted: Detection[], incoming: Detection[]) {
  const out: Detection[] = [];
  for (const d of incoming) {
    if (d.nonPart || !validScanBox(d.box)) continue;
    const dup = [...accepted, ...out].some(a => {
      if (!validScanBox(a.box)) return false;
      const o = overlap(a.box, d.box);
      // Near-identical boxes can disagree on type/color. Containment alone is
      // insufficient: a small real piece can lie inside a larger piece's box.
      return o.iou > (sameThing(a,d) ? 0.8 : 0.92);
    });
    if (!dup) out.push(d);
  }
  return out;
}

export function toJpeg(src: HTMLCanvasElement, sx = 0, sy = 0, sw = src.width, sh = src.height, max = 2048) {
  const s = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  c.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}

/**
 * A contact sheet: each detection cropped square around its box (with room to see its sides), scaled
 * into a numbered cell, the part itself outlined in magenta so neighbors in the crop aren't confused for it.
 */
/**
 * Pixels per stud in the full-resolution photo, measured from studded rectangular parts lying square to
 * the camera (their box has the same proportions as their size). The median of those, or null if too few.
 */
export function studPitch(dets: Detection[], W: number, H: number): number | null {
  const est: number[] = [];
  for (const d of dets) {
    const k = d.kind;
    if (!k || (k.type !== 'brick' && k.type !== 'plate') || k.w === k.d || d.confidence < 0.6) continue;
    const bw = ((d.box[3] - d.box[1]) / 1000) * W, bh = ((d.box[2] - d.box[0]) / 1000) * H;
    const long = Math.max(bw, bh), short = Math.min(bw, bh), want = k.d / k.w;
    if (Math.abs(long / short - want) / want > 0.15) continue; // turned at an angle, or misread: skip
    est.push(long / k.d, short / k.w);
  }
  if (est.length < 6) return null;
  est.sort((a, b) => a - b);
  return est[Math.floor(est.length / 2)];
}

export function contactSheet(full: HTMLCanvasElement | ImageBitmap, dets: Detection[], pitch: number | null = null, cols = SHEET_COLS, cell = SHEET_CELL, room = 1.6) {
  const rows = Math.ceil(dets.length / cols), W = full.width, H = full.height;
  const c = document.createElement('canvas');
  c.width = cols * cell; c.height = rows * cell;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height);
  dets.forEach((d, i) => {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    const [y0, x0, y1, x1] = d.box.map((v, j) => (v / 1000) * (j % 2 ? W : H));
    const bw = x1 - x0, bh = y1 - y0;
    const side = Math.max(120, Math.max(bw, bh) * room);
    const sx = (x0 + x1) / 2 - side / 2, sy = (y0 + y1) / 2 - side / 2, k = cell / side;
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy), cx1 = Math.min(W, sx + side), cy1 = Math.min(H, sy + side);
    g.save();
    g.beginPath(); g.rect(ox, oy, cell, cell); g.clip();
    if (cx1 > cx0 && cy1 > cy0) g.drawImage(full, cx0, cy0, cx1 - cx0, cy1 - cy0, ox + (cx0 - sx) * k, oy + (cy0 - sy) * k, (cx1 - cx0) * k, (cy1 - cy0) * k);
    g.strokeStyle = '#ff2bd6'; g.lineWidth = 3;
    g.strokeRect(ox + (x0 - sx) * k - 5, oy + (y0 - sy) * k - 5, bw * k + 10, bh * k + 10);
    if (pitch) ruler(g, ox + 8, oy + cell - 12, pitch * k, cell);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(ox + 1, oy + 1, cell - 2, cell - 2);
    g.fillStyle = '#000000'; g.fillRect(ox + 2, oy + 2, 40, 28);
    g.fillStyle = '#ffffff'; g.font = 'bold 20px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(String(i + 1), ox + 22, oy + 17);
    g.restore();
  });
  return c.toDataURL('image/jpeg', 0.9);
}

/**
 * A part's true length in studs from its outline: a w-stud-wide rectangle turned by some angle fills a box of
 * L·cos + W·sin by L·sin + W·cos. Try every angle, keep the one where both sides agree. Tiles have no studs
 * to count, and the model reads tilted ones too long; this doesn't. Returns null if no angle fits well.
 */
export function measureLength(box: [number, number, number, number], w: number, W: number, H: number, pitch: number) {
  const bw = ((box[3] - box[1]) / 1000) * W, bh = ((box[2] - box[0]) / 1000) * H;
  const long = Math.max(bw, bh), short = Math.min(bw, bh), wpx = w * pitch;
  let best: { err: number; studs: number } | null = null;
  for (let deg = 0; deg <= 45; deg++) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const L = (long - wpx * s) / c;
    const err = s > 1e-6 ? Math.abs(L - (short - wpx * c) / s) : Math.abs(short - wpx);
    if (L > 0 && (!best || err < best.err)) best = { err, studs: L / pitch };
  }
  return best && best.err < pitch * 0.5 ? best.studs : null;
}

/** A stud ruler at this cell's zoom: 1–4 stud widths with a tick per stud, white on a dark backing. */
function ruler(g: CanvasRenderingContext2D, x: number, y: number, unit: number, cell = SHEET_CELL) {
  const n = Math.max(1, Math.min(4, Math.floor((cell * 0.45) / unit)));
  const len = n * unit;
  g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(x - 4, y - 22, Math.max(len, 52) + 8, 30);
  g.strokeStyle = '#ffffff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y);
  for (let i = 0; i <= n; i++) { g.moveTo(x + i * unit, y - 6); g.lineTo(x + i * unit, y + 2); }
  g.stroke();
  g.fillStyle = '#ffffff'; g.font = 'bold 12px Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(`${n} stud${n > 1 ? 's' : ''}`, x, y - 10);
}

function grid(n: number, overlapFrac = 0.12): Tile[] {
  const tiles: Tile[] = [];
  const step = 1000 / n, pad = step * overlapFrac;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = Math.max(0, c * step - pad), y = Math.max(0, r * step - pad);
    tiles.push({
      x, y, w: Math.min(1000, (c + 1) * step + pad) - x, h: Math.min(1000, (r + 1) * step + pad) - y,
      core: [c * step, r * step, step, step], state: 'waiting',
    });
  }
  return tiles;
}

/** Recount from image scale as well as the prediction. A mistaken 2x10 reading
 * must not hide a visibly large 4x12 plate from the high-resolution pass. */
export function needsRecount(d: Detection, W: number, H: number, pitch: number | null, first?: Detection): boolean {
  const k = d.kind;
  if (!k || !['brick', 'plate', 'tile'].includes(k.type)) return false;
  if (k.w * k.d >= 24 || k.d >= 8 || !isRealSize(k.type, k.w, k.d)) return true;
  if (first?.kind && first.kind.w * first.kind.d >= 24) return true;
  if (!pitch || !Number.isFinite(pitch) || pitch <= 0) return false;
  const [y0, x0, y1, x1] = d.box;
  const areaInStuds = ((x1 - x0) * W / 1000) * ((y1 - y0) * H / 1000) / (pitch * pitch);
  return areaInStuds >= 24 || (areaInStuds >= 12 && areaInStuds > k.w * k.d * 1.7);
}

export async function deepScan(
  full: HTMLCanvasElement,
  cb: { onDetections: (d: Detection[]) => void; onProgress: (p: ScanProgress) => void; onCorrections?: (c: { from: Detection; to: Detection | null }[]) => void },
  signal?: AbortSignal,
  options: ScanOptions = {},
) {
  let timedOutChecks = 0;
  cb.onProgress({ phase: 'survey', tiles: [], estimate: 0 });
  const key = await scanKey(); // the catalog's shapes, rendered and labeled, sent alongside every image
  const survey = await scanImage(toJpeg(full), { max: SURVEY_MAX, key }, signal);
  const accepted = dedupe([],survey.detections);
  cb.onDetections(accepted);
  let estimate = survey.estimatedTotal;

  // Only a small, sparse pile is fully read from the whole photo. Anything more gets a closer look:
  // small and unusual parts are the ones the whole-photo pass misses.
  const zoom = !(estimate < 25 || accepted.length >= estimate * 0.9);
  const tiles = zoom ? grid(estimate < 250 ? 2 : 3) : [];
  const report = () => cb.onProgress({ phase: 'zoom', tiles: tiles.map(t => ({ ...t })), estimate, timedOutChecks });
  if (tiles.length) report();
  await Promise.all(tiles.map(async t => {
    t.state = 'looking'; report();
    try {
      const W = full.width, H = full.height;
      const img = toJpeg(full, (t.x / 1000) * W, (t.y / 1000) * H, (t.w / 1000) * W, (t.h / 1000) * H);
      const r = await withScanDeadline(s => scanImage(img, { max: TILE_MAX, crop: t, key }, s), signal);
      signal?.throwIfAborted();
      const fresh = dedupe(accepted, r.detections);
      accepted.push(...fresh);
      cb.onDetections(fresh);
      t.state = 'done';
    } catch (e) {
      signal?.throwIfAborted();
      if ((e as Error).name === 'AbortError') throw e;
      if (e instanceof ScanTimeoutError) timedOutChecks++;
      t.state = 'failed'; // one bad section shouldn't sink the scan
    }
    report();
  }));
  // Section estimates double-count overlaps, so trust the whole-photo estimate unless we found more.
  estimate = Math.max(estimate, accepted.length);

  // Missing/failed close-ups retain a visible review observation, not unchecked stock.
  const pitch = studPitch(accepted, full.width, full.height);
  const earlierTimeouts = timedOutChecks;
  const final = await checkScanObservations(full, accepted, {
    onCorrections: changes => cb.onCorrections?.(changes),
    onProgress: p => {
      timedOutChecks = earlierTimeouts + p.timedOutChecks;
      cb.onProgress({phase: 'check', tiles: tiles.map(t => ({...t})), estimate, sheets: {done: p.done, total: p.total}, timedOutChecks});
    },
  }, signal, {key, detailSource: options.detailSource, recoverFailed: options.recoverFailed});

  // Retry only ambiguous observations. One outlined piece gets the whole image,
  // using original pixels when the file is still available. Every replacement
  // retains the existing observation box and goes through the normal feature gates.
  const retries = options.detailRetry === false ? [] : detailRetryCandidates(final);
  if (retries.length) {
    signal?.throwIfAborted();
    const detail = { done: 0, total: retries.length };
    const progress = () => cb.onProgress({ phase: 'detail', tiles: tiles.map(t => ({ ...t })), estimate, sheets: { ...detail }, timedOutChecks });
    progress();
    let bitmap: ImageBitmap | undefined;
    try {
      if (options.detailSource) {
        try { bitmap = await options.detailSource(); }
        catch (error) { if (signal?.aborted) throw error; /* working pixels remain available */ }
      }
      signal?.throwIfAborted();
      const source = bitmap ?? full;
      const sourceName = bitmap ? 'original' : 'working';
      const detailPitch = pitch ? pitch * source.width / full.width : null;
      const deadline = new AbortController();
      const abortDetail = () => deadline.abort();
      signal?.addEventListener('abort', abortDetail, { once: true });
      const timer = setTimeout(abortDetail, DETAIL_RETRY_TIMEOUT_MS);
      let cursor = 0;
      const work = async () => {
        while (cursor < retries.length) {
          signal?.throwIfAborted();
          const { first, current, reason } = retries[cursor++];
          const started = performance.now();
          let after = current;
          let status: DetailRetryEvent['status'] = 'unchanged';
          try {
            deadline.signal.throwIfAborted();
            const sheet = contactSheet(source, [current], detailPitch, 1, 768, 1.3);
            (globalThis as { __spillSheets?: string[] }).__spillSheets?.push(sheet);
            const found = await withScanDeadline(s => checkParts(sheet, 1, key, s, !!detailPitch, colorKey()), deadline.signal, DETAIL_RETRY_TIMEOUT_MS);
            signal?.throwIfAborted();
            deadline.signal.throwIfAborted();
            const raw = found.get(1);
            if (!raw) throw new Error('Missing individual close-up reading');
            const next = recheck(current, raw) ?? current;
            // Confident contradictory readings remain reviewable. A retry never
            // erases a previously observed physical piece on a lone negative vote.
            if (next.nonPart || (current.kind && current.confidence >= .6 && next.kind && next.kind.partId !== current.kind.partId)) {
              after = quarantineDetection(current, 'Individual close-up disagrees — confirm this piece');
              status = 'review';
            } else {
              after = next;
              status = after === current ? 'unchanged' : !after.kind ? 'review' : 'changed';
            }
          } catch (error) {
            if (signal?.aborted) throw error;
            status = deadline.signal.aborted || error instanceof ScanTimeoutError ? 'timed-out' : 'failed';
            if (status === 'timed-out') timedOutChecks++;
            if (reason === 'conflicting-readings') after = quarantineDetection(current, 'Conflicting readings could not be resolved — confirm this piece');
          }
          signal?.throwIfAborted();
          final.set(first, after);
          if (after !== current) cb.onCorrections?.([{ from: current, to: after }]);
          options.onDetailRetry?.({ box: current.box, reason, status, before: current, after, elapsedMs: performance.now() - started, source: sourceName });
          detail.done++;
          progress();
        }
      };
      try { await Promise.all(Array.from({ length: Math.min(DETAIL_RETRY_CONCURRENCY, retries.length) }, work)); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abortDetail); }
    } finally { bitmap?.close(); }
  }
  // Two sections can see the same part and read it differently, which slips past dedupe. Once the
  // close-ups agree on what it is, overlapping copies of the same thing are dropped.
  const kept: Detection[] = [], dropped: { from: Detection; to: null }[] = [];
  for (const now of final.values()) {
    if (dedupe(kept, [now]).length) kept.push(now);
    else dropped.push({ from: now, to: null });
  }
  if (dropped.length) cb.onCorrections?.(dropped);

  // Tiles: measure the length from the outline and trust that over the model's estimate, when it's clear.
  if (pitch) {
    const measured = kept.flatMap(d => {
      const k = d.kind;
      if (!k || k.type !== 'tile') return [];
      const L = measureLength(d.box, k.w, full.width, full.height, pitch);
      if (!L) return [];
      // the nearest real tile length for this width; take it only if the measurement is close to it
      // and clearly closer than the model's reading
      const lengths = [1, 2, 3, 4, 6, 8].filter(n => n >= k.w && isRealSize('tile', k.w, n));
      const n = lengths.reduce((a, b) => (Math.abs(b - L) < Math.abs(a - L) ? b : a), lengths[0]);
      if (!n || n === k.d || Math.abs(L - n) > 0.6 || Math.abs(L - k.d) - Math.abs(L - n) < 0.75) return [];
      const size = normalizeSize('tile', `${k.w}x${n}`);
      if (!size) return [];
      const kind = parsePartId(partId('tile', size.w, size.d, k.color));
      (globalThis as { __spillGate?: unknown[] }).__spillGate?.push({ description: d.description, named: k.partId, why: `measured ${L.toFixed(1)} studs long: ${kind?.partId}` });
      const issue=kind?scanKindIssue(kind):'Unrecognized measured shape';
      return [{from:d,to:issue?quarantineDetection(d,issue):{...d,kind}}];
    });
    if (measured.length) {
      cb.onCorrections?.(measured);
      for (const m of measured) kept[kept.indexOf(m.from)] = m.to;
    }
  }

  // The recount: big plates, bricks and tiles, and any that read as a size LEGO never made, get their own
  // high-resolution cell, 4 to a sheet, and their studs are counted edge by edge.
  const recount = kept.filter(d => needsRecount(d, full.width, full.height, pitch, accepted.find(a => a.box === d.box)));
  const groups = Array.from({ length: Math.ceil(recount.length / 4) }, (_, i) => recount.slice(i * 4, (i + 1) * 4));
  const counted = { done: 0, total: groups.length };
  if (groups.length) cb.onProgress({ phase: 'count', tiles: tiles.map(t => ({ ...t })), estimate, sheets: { ...counted }, timedOutChecks });
  await Promise.all(groups.map(async group => {
    try {
      const sheet = contactSheet(full, group, pitch, 2, 512, 1.3);
      (globalThis as { __spillSheets?: string[] }).__spillSheets?.push(sheet);
      const found = await withScanDeadline(s => countStuds(sheet, group.length, s), signal);
      signal?.throwIfAborted();
      const changes = group.flatMap((d, i) => {
        const c = found.get(i + 1), k = d.kind!;
        const size = c && normalizeSize(k.type, `${c.short}x${c.long}`);
        if (!c || !size) return [{from:d,to:quarantineDetection(d,'Recount missing or malformed — confirm the dimensions')}];
        if (size.w === k.w && size.d === k.d) return [];
        const kind = parsePartId(partId(k.type as PartType, size.w, size.d, k.color));
        (globalThis as { __spillGate?: unknown[] }).__spillGate?.push({ description: d.description, named: k.partId, why: `recounted: ${kind?.partId}` });
        const issue=kind?scanKindIssue(kind):'Unrecognized recounted shape';
        return [{from:d,to:issue?quarantineDetection(d,issue):{...d,kind}}];
      });
      if (changes.length) cb.onCorrections?.(changes);
      for(const c of changes)kept[kept.indexOf(c.from)]=c.to;
    } catch (e) {
      signal?.throwIfAborted();
      if ((e as Error).name === 'AbortError') throw e;
      const timedOut = e instanceof ScanTimeoutError;
      if (timedOut) timedOutChecks++;
      cb.onCorrections?.(group.map(d=>({from:d,to:quarantineDetection(d,timedOut?'Recount timed out — confirm the dimensions':'Recount failed — confirm the dimensions')})));
    }
    counted.done++;
    cb.onProgress({ phase: 'count', tiles: tiles.map(t => ({ ...t })), estimate, sheets: { ...counted }, timedOutChecks });
  }));
  cb.onProgress({ phase: 'done', tiles: tiles.map(t => ({ ...t })), estimate: Math.max(survey.estimatedTotal, kept.length), timedOutChecks });
}

// ---------------------------------------------------------------- cross-checking with angled photos

const BOX_FAMILY: PartType[] = ['brick', 'plate', 'tile', 'cornerbrick', 'cornerplate', 'cornertile'];
export const needsHeightCheck = (d: Detection) => !!d.kind && BOX_FAMILY.includes(d.kind.type);
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

/** Median color of the middle of a box (0–1000 coords) in a canvas. */
function middleColor(c: HTMLCanvasElement, box: Box): [number, number, number] {
  const [y0, x0, y1, x1] = [box[0] * c.height, box[1] * c.width, box[2] * c.height, box[3] * c.width].map(v => v / 1000);
  const w = Math.max(2, (x1 - x0) * 0.3), h = Math.max(2, (y1 - y0) * 0.3);
  const d = c.getContext('2d')!.getImageData((x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h).data;
  const ch = [0, 1, 2].map(i => { const v: number[] = []; for (let j = i; j < d.length; j += 4) v.push(d[j]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
  return ch as [number, number, number];
}

/**
 * Do two views of a piece disagree on its color? Lighting changes between photos, so compare hue (each channel's
 * share of the total) and allow a wide range of brightness; a dark piece and a light one still differ in brightness.
 */
export function colorMismatch(a: [number, number, number], b: [number, number, number]): string | null {
  const sa = a[0] + a[1] + a[2] + 1, sb = b[0] + b[1] + b[2] + 1;
  const hue = Math.hypot(...[0, 1, 2].map(i => a[i] / sa - b[i] / sb));
  if (hue > 0.09) return `colors differ (hue ${hue.toFixed(2)})`;
  const ratio = sa / sb;
  if (ratio < 0.45 || ratio > 2.2) return `brightness differs (×${ratio.toFixed(1)})`;
  return null;
}

/** Pairs of crops for judgeHeights: each piece from above (left) and from the angle (right), numbered, outlined. */
function pairSheet(top: HTMLCanvasElement, pairs: { box: Box; angle: HTMLCanvasElement; angleBox: Box }[]) {
  const cell = 256, cols = 2;
  const c = document.createElement('canvas');
  c.width = cols * cell * 2 + (cols - 1) * 16; c.height = Math.ceil(pairs.length / cols) * cell;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  const draw = (src: HTMLCanvasElement, box: Box, ox: number, oy: number, room: number) => {
    const [y0, x0, y1, x1] = [box[0] * src.height, box[1] * src.width, box[2] * src.height, box[3] * src.width].map(v => v / 1000);
    const side = Math.max(80, Math.max(x1 - x0, y1 - y0) * room), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, k = cell / side;
    g.save(); g.beginPath(); g.rect(ox, oy, cell, cell); g.clip();
    g.fillStyle = '#808080'; g.fillRect(ox, oy, cell, cell);
    g.drawImage(src, cx - side / 2, cy - side / 2, side, side, ox, oy, cell, cell);
    g.strokeStyle = '#ff2bd6'; g.lineWidth = 3; g.strokeRect(ox + (x0 - cx + side / 2) * k - 4, oy + (y0 - cy + side / 2) * k - 4, (x1 - x0) * k + 8, (y1 - y0) * k + 8);
    g.restore();
  };
  pairs.forEach((p, i) => {
    const ox = (i % cols) * (cell * 2 + 16), oy = Math.floor(i / cols) * cell;
    draw(top, p.box, ox, oy, 1.6);
    draw(p.angle, p.angleBox, ox + cell, oy, 1.8);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(ox + 1, oy + 1, cell * 2 - 2, cell - 2);
    g.fillStyle = '#000000'; g.fillRect(ox + 2, oy + 2, 40, 28);
    g.fillStyle = '#ffffff'; g.font = 'bold 20px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i + 1), ox + 22, oy + 17);
  });
  return c.toDataURL('image/jpeg', 0.9);
}

/**
 * Cross-check a straight-down scan with an angled photo of the same pile, for the things a top view can't show:
 * height (plate or brick) and stacked pieces. Each plate, brick and tile is found in the angled photo using its
 * neighbors, matches whose color disagrees are dropped, and the rest are judged from both views together.
 * Returns each matched piece's vote; the caller pools votes across all angled photos (decideFromAngles). The
 * angled photo never adds to the count.
 */
export async function crossCheck(
  top: HTMLCanvasElement, dets: Detection[], angle: HTMLCanvasElement,
  cb: { onProgress: (done: number, total: number, timedOutChecks: number) => void },
  signal?: AbortSignal,
): Promise<{ det: Detection; vote: AngleVote }[]> {
  const cands = dets.filter(d => d.kind && BOX_FAMILY.includes(d.kind.type));
  const finds = chunk(cands, 12);
  let done = 0, total = finds.length + Math.ceil(cands.length / 8), timedOutChecks = 0;
  cb.onProgress(done, total, timedOutChecks);
  const angleUrl = toJpeg(angle);
  const matched: { d: Detection; angleBox: Box }[] = [];
  const log = (d: Detection, why: string) => (globalThis as { __spillGate?: unknown[] }).__spillGate?.push({ description: d.description, named: d.kind?.partId, why });
  await Promise.all(finds.map(async group => {
    try {
      const sheet = contactSheet(top, group, null, 4, 256, 3.2); // wide crops: the neighbors identify the piece
      (globalThis as { __spillSheets?: string[] }).__spillSheets?.push(sheet);
      const found = await withScanDeadline(s => findInAngle(sheet, group.length, angleUrl, s), signal);
      signal?.throwIfAborted();
      group.forEach((d, i) => {
        const f = found.get(i + 1);
        if (!f || f.confidence < 0.5) return;
        const why = colorMismatch(middleColor(top, d.box), middleColor(angle, f.box));
        if (why) { log(d, `angled match rejected: ${why}`); return; }
        matched.push({ d, angleBox: f.box });
      });
    } catch (e) { signal?.throwIfAborted(); if ((e as Error).name === 'AbortError') throw e; if (e instanceof ScanTimeoutError) timedOutChecks++; }
    cb.onProgress(++done, total, timedOutChecks);
  }));
  // Twins: two pieces from the top view matched to the same spot in this angled photo means at least one is the
  // wrong look-alike, so neither match is trusted. Matches too small to show a side (far away) are dropped too.
  const minSide = 0.012; // of the photo's width/height: about 37 px across in a 3072 px photo
  const clash = new Set<number>();
  matched.forEach((a, i) => matched.forEach((b, j) => {
    if (i < j && overlap(a.angleBox, b.angleBox).iou > 0.3) { clash.add(i); clash.add(j); }
  }));
  for (let i = matched.length - 1; i >= 0; i--) {
    const [y0, x0, y1, x1] = matched[i].angleBox;
    const tiny = Math.min(x1 - x0, y1 - y0) / 1000 < minSide;
    if (clash.has(i) || tiny) { log(matched[i].d, clash.has(i) ? 'angled match dropped: a look-alike matched the same spot' : 'angled match dropped: too far away'); matched.splice(i, 1); }
  }
  total = done + Math.ceil(matched.length / 8);
  cb.onProgress(done, total, timedOutChecks);
  const votes: { det: Detection; vote: AngleVote }[] = [];
  await Promise.all(chunk(matched, 8).map(async group => {
    try {
      const sheet = pairSheet(top, group.map(m => ({ box: m.d.box, angle, angleBox: m.angleBox })));
      const sheetNo = (globalThis as { __spillSheets?: string[] }).__spillSheets?.push(sheet); // its 1-based number, taken before awaiting
      const verdicts = await withScanDeadline(s => judgeHeights(sheet, group.length, s), signal);
      signal?.throwIfAborted();
      group.forEach(({ d, angleBox }, i) => {
        const v = verdicts.get(i + 1);
        // ?debug=1: which piece each angle matched, and what it said, to look at afterwards
        (globalThis as { __spillAngle?: unknown[] }).__spillAngle?.push({ part: d.kind?.partId, box: d.box, angle: angle.dataset.photo, angleBox, sheet: sheetNo, cell: i + 1, verdict: v });
        // only a sharp, close view of the side gets a vote (the model is confident even about blurry ones)
        if (v && v.sameShape && v.sideClear && v.confidence >= 0.5) votes.push({ det: d, vote: { stacked: v.stacked, heightPlates: v.heightPlates, confidence: v.confidence } });
      });
    } catch (e) { signal?.throwIfAborted(); if ((e as Error).name === 'AbortError') throw e; if (e instanceof ScanTimeoutError) timedOutChecks++; }
    cb.onProgress(++done, total, timedOutChecks);
  }));
  return votes;
}

/** One angled photo's view of one piece. */
export interface AngleVote { stacked: boolean; heightPlates: number; confidence: number }

/**
 * What all the angled photos together say a piece is, starting from its straight-down reading. A change needs
 * agreement: a majority of at least two angles, or one very confident angle when only one could see it.
 * Height alone cannot identify hidden pieces. A stack is kept for manual confirmation, never multiplied.
 */
export function decideFromAngles(orig: PartKind, votes: AngleVote[], requireClear = false): { kind: PartKind } | { other: string } {
  const sure = votes.filter(v => Number.isFinite(v.confidence) && v.confidence >= 0.6 && v.confidence <= 1 && Number.isSafeInteger(v.heightPlates) && v.heightPlates >= 0 && v.heightPlates <= 80 && typeof v.stacked === 'boolean');
  const enough = (n: number) => (sure.length >= 2 ? n >= 2 && n > sure.length / 2 : n === 1 && sure[0].confidence >= 0.8);
  const size = `${orig.w}x${orig.d}`;
  const stacked = sure.filter(v => v.stacked);
  if (enough(stacked.length)) return { other: `Stack with ${size} ${orig.type} on top — separate it to identify the hidden pieces` };
  const heights = sure.filter(v => !v.stacked).map(v => v.heightPlates);
  const counts = new Map<number, number>();
  for (const h of heights) counts.set(h, (counts.get(h) ?? 0) + 1);
  const [h, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (!h || !enough(n)) return requireClear ? {other: 'Height still unclear — compare a side view or confirm this piece'} : { kind: orig };
  if (h >= 4) return { other: `${size} piece ${h} plates tall (seen from an angle)` };
  const swap: Partial<Record<PartType, Partial<Record<number, PartType>>>> = {
    plate: { 3: 'brick' }, brick: { 1: 'plate' }, cornerplate: { 3: 'cornerbrick' }, cornerbrick: { 1: 'cornerplate' },
  };
  const next = swap[orig.type]?.[h];
  if (!next || !isRealSize(next, orig.w, orig.d)) return requireClear && heightOf(orig) !== h ? {other: 'Side-view height does not fit the proposed piece — confirm its exact shape'} : { kind: orig };
  const kind = parsePartId(partId(next, orig.w, orig.d, orig.color));
  const issue=kind?scanKindIssue(kind):'Unrecognized angled shape';
  return issue?{other:`${size} ${next} in ${orig.color} — ${issue}`}:{kind:kind!};
}
