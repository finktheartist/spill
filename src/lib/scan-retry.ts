import type { Detection } from './gemini';

export const DETAIL_RETRY_LIMIT = 8;
export const DETAIL_RETRY_CONCURRENCY = 2;
export const DETAIL_RETRY_TIMEOUT_MS = 90_000;
export type RetryReason = 'conflicting-readings' | 'unidentified' | 'low-confidence';
export interface RetryCandidate { first: Detection; current: Detection; reason: RetryReason }

/** These observations require physical separation or exact human confirmation.
 * A different model guess must not turn them into an ordinary usable brick. */
export function manualOnlyReading(d: Detection): boolean {
  return !!d.clump?.length || !!d.aka || /exact (special mold|connector part)|confirm the exact special mold|suggested stand-in|joined pieces|separate (them|it)|hidden parts/i.test(d.review ?? '');
}

/** Stable priority and a hard request budget, independent of response arrival order. */
export function detailRetryCandidates(readings: Iterable<[Detection, Detection]>): RetryCandidate[] {
  const candidates: RetryCandidate[] = [];
  for (const [first, current] of readings) {
    if (current.nonPart || manualOnlyReading(first) || manualOnlyReading(current)) continue;
    const conflict = !!first.kind && !!current.kind && first.kind.partId !== current.kind.partId;
    const reason: RetryReason | null = conflict ? 'conflicting-readings' : !current.kind ? 'unidentified' : current.confidence < .6 ? 'low-confidence' : null;
    if (reason) candidates.push({ first, current, reason });
  }
  const order: Record<RetryReason, number> = { 'conflicting-readings': 0, unidentified: 1, 'low-confidence': 2 };
  return candidates.sort((a, b) => order[a.reason] - order[b.reason] || a.current.box[0] - b.current.box[0] || a.current.box[1] - b.current.box[1]).slice(0, DETAIL_RETRY_LIMIT);
}
