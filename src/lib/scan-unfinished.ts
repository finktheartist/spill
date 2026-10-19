import type {Detection} from './gemini';
import {validScanBox} from './gemini';
import {isObservationLocked, observationKey, type Inventory} from './inventory';

export const unfinishedCloseUp = (description: string) => /Close-up check (?:timed out|failed|missing)|Close-up response was incomplete or malformed/.test(description);

/** Legacy exports store the failure reason in their description. Only unique,
 * unconfirmed outlines with a retained overhead photo are eligible for recovery. */
export function unfinishedScanObservations(inv: Inventory): Map<number, Detection[]> {
  const photos = new Set(inv.photos.filter(p => p.ref === undefined).map(p => p.id));
  const occurrences = new Map<string, number>();
  for (const entry of [...Object.values(inv.parts), ...inv.others]) for (const b of entry.boxes) {
    const key = observationKey(b.photo, b.box); occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const out = new Map<number, Detection[]>();
  for (const other of inv.others) {
    if (other.confirmed || other.catalog || !unfinishedCloseUp(other.description) || other.boxes.length !== 1) continue;
    const {photo, box} = other.boxes[0];
    if (!photos.has(photo) || !validScanBox(box) || occurrences.get(observationKey(photo, box)) !== 1 || isObservationLocked(inv, photo, box)) continue;
    const d: Detection = {kind: null, box, description: other.description, color: other.color, unknown: other.unknown,
      confidence: other.confidence ?? other.modelConfidence ?? 0, reviewEvidence: other.reviewEvidence};
    out.set(photo, [...(out.get(photo) ?? []), d]);
  }
  return out;
}
