import { frame, spatial } from './connections';
import { CATALOG, parsePartId, voxels, type Build } from './bricks';
import { constructionIssues } from './construction';
import { buildCounts, recipeExample, type LibraryEntry } from './library';
import { RECIPES } from './library-recipes';
import { validVerdict } from './build-quality';
import type { Verdict } from './gemini';
import { MIN_FINISHED_PARTS } from './finished-build';
import { reviewGeometryCurrent, reviewGeometryRevision } from './review-geometry';

const KEY = 'spill.discoveries.v1';
const LIMIT = 40;
export interface Discovery { id: string; build: Build; verdict: Verdict; savedAt: number; geometryRevision?: string }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Ignore translation, quarter turns, color swaps and brick segmentation when detecting repeated silhouettes. */
export function geometryFingerprint(build: Build): string {
  if(spatial(build)){
    const solids=build.steps.flatMap(s=>s.parts.flatMap(p=>frame(p).solids.map(s=>s.points)));
    return 'connections-v2:'+ [0,1,2,3].map(turn=>{
      const rotated=solids.map(points=>points.map(([x,y,z])=>turn===0?[x,y,z]:turn===1?[-y,x,z]:turn===2?[-x,-y,z]:[y,-x,z]));
      const mins=[0,1,2].map(i=>Math.min(...rotated.flat().map(p=>p[i])));
      return rotated.map(points=>points.map(p=>p.map((v,i)=>Number((v-mins[i]).toFixed(5))).join(',')).sort().join('/')).sort().join(';');
    }).sort()[0];
  }
  const cells = [...new Set(build.steps.flatMap(s => s.parts.flatMap(p => voxels(parsePartId(p.partId)!, p).map(v => v.join(',')))))].map(s => s.split(',').map(Number));
  if (!cells.length) return '';
  return [0, 1, 2, 3].map(turn => {
    const rotated = cells.map(([x, y, z]) => turn === 0 ? [x, y, z] : turn === 1 ? [-y, x, z] : turn === 2 ? [-x, -y, z] : [y, -x, z]);
    const mins = [0, 1, 2].map(i => Math.min(...rotated.map(c => c[i])));
    return rotated.map(c => c.map((v, i) => v - mins[i]).join(',')).sort().join(';');
  }).sort()[0];
}
function qualifies(v: Verdict) { return validVerdict(v) && v.review === 'blind-v1' && v.subjectMatched === true && v.recognizable >= 4 && v.complete >= 4 && v.impressive >= 4 && v.colors >= 3; }
function safeBuild(raw: unknown): raw is Build {
  if (!raw || typeof raw !== 'object') return false;
  const b = raw as Build;
  if (typeof b.name !== 'string' || b.name.length > 80 || !b.name.trim() || typeof b.description !== 'string' || b.description.length > 1000 || !Array.isArray(b.steps) || !b.steps.length || b.steps.length > (spatial(b)?80:40)) return false;
  if(b.engine!==undefined&&!spatial(b))return false;
  let count = 0;
  for (const step of b.steps) {
    if (!step || typeof step.caption !== 'string' || step.caption.length > 500 || !Array.isArray(step.parts) || !step.parts.length) return false;
    for (const p of step.parts) {
      if (++count > 160 || !p || typeof p.partId !== 'string') return false;
      const k = parsePartId(p.partId);
      if (!k || k.type === 'wheel' || (k.type === 'wheels' ? k.w !== 4 || k.d !== 2 : !CATALOG[k.type]?.includes(`${k.w}x${k.d}`))) return false;
      if (![p.x, p.y, p.z, p.rot].every(spatial(b)?Number.isFinite:Number.isSafeInteger) || p.x < 0 || p.y < 0 || p.x > 23 || p.y > 23 || p.z < 0 || p.z > 96) return false;
    }
  }
  return count >= MIN_FINISHED_PARTS && constructionIssues(b, buildCounts(b), 24).length === 0;
}
export { safeBuild as safeSavedBuild, qualifies as libraryVerdictQualifies };
function storageDefault(): StorageLike | undefined { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
export function loadDiscoveries(storage = storageDefault()): Discovery[] {
  try {
    const text = storage?.getItem(KEY);
    if (!text || text.length > 1_500_000) return [];
    const envelope = JSON.parse(text);
    if (envelope.version !== 1 || !Array.isArray(envelope.items)) return [];
    return envelope.items.slice(0, LIMIT).filter((d: Discovery) => d && typeof d.id === 'string' && d.id.length < 80 && Number.isFinite(d.savedAt) && d.verdict && qualifies(d.verdict) && safeBuild(d.build) && reviewGeometryCurrent(d.build,d.geometryRevision));
  } catch { return []; }
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };
let knownShapes: Set<string> | undefined;
export function saveDiscovery(build: Build, verdict: Verdict | undefined, stock: Record<string, number>, storage = storageDefault()): { status: 'saved' | 'duplicate' | 'rejected' | 'unavailable'; items: Discovery[] } {
  const items = loadDiscoveries(storage);
  if (!verdict || !qualifies(verdict) || !safeBuild(build) || constructionIssues(build, stock, 24).length) return { status: 'rejected', items };
  const fingerprint = geometryFingerprint(build);
  knownShapes ??= new Set(RECIPES.map(r => geometryFingerprint(recipeExample(r))));
  if (knownShapes.has(fingerprint) || items.some(d => geometryFingerprint(d.build) === fingerprint)) return { status: 'duplicate', items };
  if (!storage) return { status: 'unavailable', items };
  const id = `discovery-${hash(fingerprint)}`;
  const clean: Build = { name: build.name, description: build.description, ...(spatial(build)?{engine:build.engine,...(build.requiredContacts?{requiredContacts:structuredClone(build.requiredContacts)}:{})}:{}), steps: build.steps.map(s => ({ caption: s.caption, parts: s.parts.map(({ partId, x, y, z, rot, orientation }) => ({ partId, x, y, z, rot, ...(orientation?{orientation:[...orientation] as typeof orientation}:{}) })) })), source: { kind: 'discovery', recipeId: id } };
  const next = [{ id, build: clean, verdict, savedAt: Date.now(), geometryRevision: reviewGeometryRevision(clean) }, ...items].slice(0, LIMIT);
  try { storage.setItem(KEY, JSON.stringify({ version: 1, items: next })); return { status: 'saved', items: next }; }
  catch { return { status: 'unavailable', items }; }
}
export function discoveryEntries(discoveries: Discovery[], stock: Record<string, number>): LibraryEntry[] {
  return discoveries.filter(d => safeBuild(d.build) && qualifies(d.verdict) && reviewGeometryCurrent(d.build,d.geometryRevision)).map(d => {
    const fits = constructionIssues(d.build, stock, 24).length === 0;
    const match = fits ? { recipeId: d.id, label: 'Saved version', build: d.build, palette: {}, substitutions: 0, parts: buildCounts(d.build) } : null;
    return { id: d.id, name: d.build.name, pitch: d.build.description, features: [], example: d.build, saved: true, variants: 1, match, matches: match ? [match] : [] };
  });
}
