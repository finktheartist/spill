import { parsePartId, type Build } from './bricks';

/** Only builds using changed molds need a fresh rendered review. Unaffected
 * saved designs remain compatible; no stored design is deleted by this check. */
export const CURVED_GEOMETRY_REVISION = 'curved-molds-11477-15068-50950-v1';
export function reviewGeometryRevision(build: Build): string | undefined {
  return build.steps.some(s => s.parts.some(p => parsePartId(p.partId)?.type === 'curve'))
    ? CURVED_GEOMETRY_REVISION : undefined;
}
export function reviewGeometryCurrent(build: Build, revision?: string): boolean {
  const expected = reviewGeometryRevision(build);
  return expected === undefined || revision === expected;
}
