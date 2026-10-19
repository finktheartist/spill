import { describe, expect, it } from 'vitest';
import { readBenchmark, scoreScan, type BenchmarkCase, type BenchmarkPrediction } from './scan-benchmark';
const c: BenchmarkCase = { id: 'test', session: 'pile-a', split: 'development', image: 'a.jpg', sha256: 'a'.repeat(64), coverage: 'complete', labels: [
  { id: 'a', box: [0, 0, 100, 100], shape: 'plate-1x2', color: 'white', evidence: 'visual-review' },
  { id: 'b', box: [0, 200, 100, 300], shape: 'brick-2x2', color: 'red', evidence: 'physical-check' },
] };
const a: BenchmarkPrediction = { box: c.labels[0].box, shape: 'plate-1x2', color: 'white', usable: true };
describe('scan benchmark evidence', () => {
  it('scores duplicates, missed pieces and wrong usable identities separately', () => {
    const result = scoreScan(c, [a, a, { box: c.labels[1].box, shape: 'plate-2x2', color: 'red', usable: true }]);
    expect(result).toMatchObject({ matched: 2, duplicateDetections: 1, wrongUsable: 2, correctUsable: 1, missed: 0 });
    expect(result.shapeAndColorRecall).toEqual({ correct: 1, total: 2, rate: .5 });
    expect(scoreScan(c, [a]).missed).toBe(1);
  });
  it('cannot inflate accuracy by abstaining or treating detection as correct identity', () => {
    const result = scoreScan(c, [{ ...a, shape: null, color: null, usable: false }]);
    expect(result.shapeAndColorRecall.correct).toBe(0); expect(result.wrongUsable).toBe(0); expect(result.correctUsable).toBe(0);
    expect(result.detectionRecall.rate).toBe(.5);
  });
  it('does not penalize unlabeled regions or claim full precision on partial labels', () => {
    const partial = { ...c, coverage: 'partial' as const, labels: [c.labels[0]] };
    const result = scoreScan(partial, [a, { ...a, box: [500, 500, 600, 600] }]);
    expect(result.detectionPrecision).toBeNull(); expect(result.unscoredDetections).toBe(1); expect(result.wrongUsable).toBe(0);
  });
  it('does not score pending labels or unknown color as verified truth', () => {
    const result = scoreScan({ ...c, coverage: 'partial', labels: [{ ...c.labels[0], color: null }, { ...c.labels[1], evidence: 'pending' }] }, [a]);
    expect(result.reviewedLabels).toBe(1); expect(result.colorRecall.rate).toBeNull(); expect(result.exactLabels).toBe(0);
  });
  it('rejects session leakage, image leakage, invalid boxes and false complete coverage', () => {
    for (const other of [{ ...c, id: 'two', split: 'holdout' }, { ...c, id: 'two', session: 'b', split: 'holdout' }]) {
      expect(() => readBenchmark({ version: 1, cases: [c, other] })).toThrow('crosses');
    }
    expect(() => readBenchmark({ version: 1, cases: [{ ...c, labels: [{ ...c.labels[0], box: [0, 0, 0, 0] }] }] })).toThrow();
    expect(() => readBenchmark({ version: 1, cases: [{ ...c, labels: [{ ...c.labels[0], evidence: 'pending' }] }] })).toThrow();
    expect(readBenchmark({ version: 1, cases: [c] }).cases).toHaveLength(1);
  });
});
