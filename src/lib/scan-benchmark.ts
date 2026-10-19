import type { Box } from './inventory';

export interface BenchmarkLabel {
  id: string; box: Box; shape: string | null; color: string | null;
  evidence: 'visual-review' | 'physical-check' | 'pending'; notes?: string;
}
export interface BenchmarkCase {
  id: string; session: string; split: 'development' | 'holdout'; image: string; sha256: string;
  coverage: 'partial' | 'complete'; labels: BenchmarkLabel[];
}
export interface BenchmarkManifest { version: 1; cases: BenchmarkCase[] }
export interface BenchmarkPrediction { box: Box; shape: string | null; color: string | null; usable: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const boxOK = (b: unknown): b is Box => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000) && b[0] < b[2] && b[1] < b[3];

/** Unlabeled examples and model outputs are never silently promoted to truth. */
export function readBenchmark(value: unknown): BenchmarkManifest {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.cases) || !value.cases.length) throw new Error('Expected a version 1 benchmark with cases');
  const ids = new Set<string>(), sessions = new Map<string, string>(), images = new Map<string, string>();
  for (const c of value.cases) {
    if (!object(c) || typeof c.id !== 'string' || !c.id || ids.has(c.id) || typeof c.session !== 'string' || !c.session || !['development', 'holdout'].includes(String(c.split)) || typeof c.image !== 'string' || !c.image || typeof c.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.sha256) || !['partial', 'complete'].includes(String(c.coverage)) || !Array.isArray(c.labels)) throw new Error('Invalid or duplicate benchmark case');
    ids.add(c.id);
    if ((sessions.has(c.session) && sessions.get(c.session) !== c.split) || (images.has(c.sha256) && images.get(c.sha256) !== c.split)) throw new Error('A photo or capture session crosses development and holdout splits');
    sessions.set(c.session, String(c.split)); images.set(c.sha256, String(c.split));
    const labels = new Set<string>();
    for (const l of c.labels) {
      if (!object(l) || typeof l.id !== 'string' || !l.id || labels.has(l.id) || !boxOK(l.box) || !(l.shape === null || typeof l.shape === 'string' && /^[a-z]+-\d+x\d+$/.test(l.shape)) || !(l.color === null || typeof l.color === 'string' && /^[a-z][a-z-]*$/.test(l.color)) || !['visual-review', 'physical-check', 'pending'].includes(String(l.evidence))) throw new Error(`Invalid label in ${c.id}`);
      labels.add(l.id);
    }
    if (c.coverage === 'complete' && (!c.labels.length || c.labels.some(l => l.evidence === 'pending'))) throw new Error('Complete coverage requires reviewed labels');
  }
  return value as unknown as BenchmarkManifest;
}

function iou(a: Box, b: Box) {
  const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
  const overlap = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return overlap / (area(a) + area(b) - overlap);
}
const ratio = (correct: number, total: number) => ({ correct, total, rate: total ? correct / total : null });

/** One-to-one maximum-cardinality spatial matching, independent of predicted identity.
 * Partial annotations score only their labeled regions; they cannot claim whole-photo precision. */
export function scoreScan(c: BenchmarkCase, predictions: BenchmarkPrediction[], threshold = .5) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('Invalid matching threshold');
  if (predictions.some(p => !boxOK(p.box) || typeof p.usable !== 'boolean')) throw new Error('Invalid prediction');
  const labels = c.labels.filter(l => l.evidence !== 'pending');
  const edges = labels.map(l => predictions.map((p, j) => ({ j, overlap: iou(l.box, p.box) })).filter(p => p.overlap >= threshold).sort((a, b) => b.overlap - a.overlap || a.j - b.j));
  const owners = new Map<number, number>();
  const assign = (i: number, seen: Set<number>): boolean => {
    for (const { j } of edges[i]) {
      if (seen.has(j)) continue;
      seen.add(j);
      const owner = owners.get(j);
      if (owner === undefined || assign(owner, seen)) { owners.set(j, i); return true; }
    }
    return false;
  };
  labels.forEach((_, i) => assign(i, new Set()));
  const matches = new Map([...owners].map(([j, i]) => [i, j]));
  let shapeCorrect = 0, colorCorrect = 0, exactCorrect = 0, wrongUsable = 0, correctUsable = 0;
  const errors: { id: string; reason: string; prediction?: number }[] = [];
  labels.forEach((l, i) => {
    const j = matches.get(i), p = j === undefined ? undefined : predictions[j];
    if (!p) { errors.push({ id: l.id, reason: 'missed' }); return; }
    if (l.shape && p.shape === l.shape) shapeCorrect++;
    if (l.color && p.color === l.color) colorCorrect++;
    const exact = l.shape !== null && l.color !== null && l.shape === p.shape && l.color === p.color;
    if (exact) exactCorrect++;
    const wrong = !!(l.shape && l.shape !== p.shape || l.color && l.color !== p.color);
    if (p.usable && wrong) wrongUsable++;
    if (p.usable && exact) correctUsable++;
    if (wrong) errors.push({ id: l.id, prediction: j, reason: p.shape ? 'wrong-identity' : 'unresolved' });
  });
  const unmatched = predictions.map((_, j) => j).filter(j => !owners.has(j));
  const duplicateIndices = unmatched.filter(j => edges.some(es => es.some(e => e.j === j)));
  const extraIndices = c.coverage === 'complete' ? unmatched : duplicateIndices;
  wrongUsable += extraIndices.filter(j => predictions[j].usable).length;
  const exactLabels = labels.filter(l => l.shape && l.color).length;
  return {
    caseId: c.id, coverage: c.coverage, reviewedLabels: labels.length, pendingLabels: c.labels.length - labels.length,
    observed: predictions.length, matched: matches.size, missed: labels.length - matches.size,
    detectionRecall: ratio(matches.size, labels.length),
    detectionPrecision: c.coverage === 'complete' ? ratio(matches.size, predictions.length) : null,
    duplicateDetections: duplicateIndices.length, unscoredDetections: c.coverage === 'partial' ? unmatched.length - duplicateIndices.length : 0,
    shapeRecall: ratio(shapeCorrect, labels.filter(l => l.shape !== null).length),
    colorRecall: ratio(colorCorrect, labels.filter(l => l.color !== null).length),
    shapeAndColorRecall: ratio(exactCorrect, exactLabels),
    correctUsable, wrongUsable, exactLabels, errors,
  };
}
