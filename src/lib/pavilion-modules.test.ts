import { beforeAll, expect, it } from 'vitest';
import { compileConnections } from './connections';
import { constructionIssues } from './construction';
import { createPavilionTarget, pavilionCandidates, pavilionIssues, pavilionReceipts, pavilionRequest, solvePavilion, type PavilionCandidate } from './pavilion-modules';
import data from '../../test/fixtures/photo-stock.json';

let candidates: PavilionCandidate[];
beforeAll(() => { candidates = pavilionCandidates(data.stock).candidates; });
it('fits three distinct complete silhouettes to the unchanged photo inventory', () => {
  expect(candidates).toHaveLength(3);
  expect(new Set(candidates.map(c => JSON.stringify(c.target.regions))).size).toBe(3);
  for (const c of candidates) {
    expect(c.build.steps.length).toBeGreaterThanOrEqual(20); expect(c.build.steps.length).toBeLessThanOrEqual(80);
    expect(pavilionIssues(c, data.stock)).toEqual([]);
    expect(constructionIssues(compileConnections(c.program, data.stock), data.stock, 24)).toEqual([]);
    for (const [id, n] of Object.entries(c.parts)) expect(n).toBeLessThanOrEqual(data.stock[id as keyof typeof data.stock]);
    expect(Object.keys(c.parts).some(id => /bracket|sidebrick|jumper|tile-2x3/.test(id))).toBe(false);
  }
});
it('charges every piece to exactly one reusable construction group', () => {
  const c = candidates[0], totals: Record<string, number> = {};
  for (const r of pavilionReceipts(c)) for (const [id, n] of Object.entries(r.parts)) totals[id] = (totals[id] ?? 0) + n;
  expect(totals).toEqual(c.parts);
  expect(Object.values(c.remaining).every(n => n >= 0)).toBe(true);
});
it('substitutes smaller stock while preserving the complete roof contour', () => {
  const stock = { ...data.stock, 'plate-4x6-reddish-brown': 0, 'plate-2x3-reddish-brown': 9 };
  const c = solvePavilion(stock, candidates[0].target.spec);
  expect(c).not.toBeNull(); expect(c!.target).toEqual(candidates[0].target);
  expect(c!.parts['plate-4x6-reddish-brown']).toBeUndefined(); expect(c!.parts['plate-2x3-reddish-brown']).toBeGreaterThan(1);
  expect(pavilionIssues(c!, stock)).toEqual([]);
});
it('does not invent a missing structural base or mutate input inventory', () => {
  const stock = { ...data.stock, 'plate-6x10-black': 0 }, before = JSON.stringify(stock), notes: string[] = [];
  expect(solvePavilion(stock, candidates[0].target.spec, notes)).toBeNull();
  expect(notes.join(' ')).toContain('foundation'); expect(JSON.stringify(stock)).toBe(before);
});
it('protects empty space and rejects geometry, target and stock tampering', () => {
  const c = structuredClone(candidates[0]);
  const i = c.assignment.indexOf('post-1-3'); c.build.steps[i].parts[0].x = 4;
  expect(pavilionIssues(c, data.stock).join(' ')).toContain('Open entrance');
  const changed = structuredClone(candidates[0]); changed.target.voids = [];
  expect(pavilionIssues(changed, data.stock)).toEqual(['The frozen pavilion target changed.']);
  expect(pavilionIssues(candidates[0], {}).length).toBeGreaterThan(0);
});
it('does not claim unrelated buildings or accept unknown shape settings', () => {
  expect(pavilionRequest('Timber gazebo')).toBe(true); expect(pavilionRequest('Stone castle')).toBe(false);
  expect(() => createPavilionTarget({ roof: 'invented', height: 12, eaves: 'raised' } as never)).toThrow();
});
