import { gripCells, cells, heightOf, parsePartId, placedKey, remaining, studCells, voxels, type Build, type Placed } from './bricks';
import { constructionKey } from './construction';
import { refinementCandidate } from './build-quality';

/** Coordinates stay in the complete build's frame. Everything outside indices is immutable. */
export interface ModuleRefinementScope {
  id: string; label: string; objective: string;
  originalKey: string; indices: number[];
  /** Inclusive minimum, exclusive maximum, measured in studs/studs/plates. */
  min: [number, number, number]; max: [number, number, number];
  ports: { face: 'bottom' | 'top'; cells: [number, number, number][] }[];
  stock: Record<string, number>; maxParts: number;
}
export const moduleParts = (build: Build, scope: ModuleRefinementScope) => build.steps.flatMap(s => s.parts).filter((_, i) => scope.indices.includes(i));
export function moduleStock(build: Build, indices: number[], have: Record<string, number>, colors: string[], maxParts: number) {
  const fixed: Build = { ...build, steps: [{ caption: '', parts: build.steps.flatMap(s => s.parts).filter((_, i) => !indices.includes(i)) }] };
  return Object.fromEntries(Object.entries(remaining(fixed, have)).filter(([id]) => {
    const k = parsePartId(id);
    return k && colors.includes(k.color) && Math.max(k.w, k.d) <= 4 && Math.min(k.w, k.d) <= 2 && k.type !== 'wheel' && k.type !== 'wheels';
  }).map(([id, n]) => [id, Math.min(n, maxParts)]));
}

/** Whole-module replacement: never trim a broken proposal into a partial accepted edit. */
export function moduleReplacement(original: Build, scope: ModuleRefinementScope, raw: unknown, have: Record<string, number>, hi: number): { build?: Build; issues: string[] } {
  if(original.engine==='connections-v2')return {issues:['Use attachment operations to refine a connection build.']};
  if (scope.originalKey !== constructionKey(original)) return { issues: ['Module receipt is stale; the source build changed.'] };
  if (!Array.isArray(raw)) return { issues: ['Return a parts array.'] };
  if (!raw.length) return { build: original, issues: [] };
  if (raw.length > scope.maxParts) return { issues: [`Use at most ${scope.maxParts} parts in this module.`] };
  const parts: Placed[] = [], used: Record<string, number> = {}, issues: string[] = [];
  for (const p of raw) {
    if (!p || typeof p.partId !== 'string' || ![p.x, p.y, p.z, p.rot].every(Number.isSafeInteger) || !scope.stock[p.partId]) {
      issues.push('Each module part needs an allowed partId and integer x, y, z, rot.'); continue;
    }
    const k = parsePartId(p.partId)!;
    used[p.partId] = (used[p.partId] ?? 0) + 1;
    const q = { partId: p.partId, x: p.x, y: p.y, z: p.z, rot: p.rot };
    if (cells(k, q).some(([x, y]) => x < scope.min[0] || x >= scope.max[0] || y < scope.min[1] || y >= scope.max[1]) || q.z < scope.min[2] || q.z + heightOf(k) > scope.max[2]) issues.push('Keep every part footprint and height inside the module bounds.');
    parts.push(q);
  }
  for (const [id, n] of Object.entries(used)) if (n > scope.stock[id]) issues.push(`Module stock exceeded: ${id} uses ${n}, available ${scope.stock[id]}.`);
  for (const port of scope.ports) {
    const contacts = new Set(parts.flatMap(p => {
      const k = parsePartId(p.partId)!;
      return port.face === 'bottom' ? gripCells(k,p).map(c=>c.join(',')) : studCells(k,p).map(([x,y])=>`${x},${y},${p.z+heightOf(k)}`);
    }));
    if (port.cells.some(c => !contacts.has(c.join(',')))) issues.push(`Preserve the ${port.face} connection cells: ${JSON.stringify(port.cells)}.`);
  }
  if (issues.length) return { issues: [...new Set(issues)] };
  const same = (ps: Placed[]) => ps.map(placedKey).sort().join('|');
  if (same(parts) === same(moduleParts(original, scope))) return { build: original, issues: [] };
  return refinementCandidate(original, [
    ...scope.indices.map(index => ({ op: 'remove' as const, index })),
    ...parts.map(p => ({ op: 'add' as const, step: 1, ...p })),
  ], have, hi);
}

export function modulePrompt(original: Build, scope: ModuleRefinementScope): string {
  const all = original.steps.flatMap(s => s.parts);
  // Only nearby fixed parts can intersect this work volume; the complete build is still checked after assembly.
  const neighbors = all.filter((p, i) => !scope.indices.includes(i) && voxels(parsePartId(p.partId)!, p).some(v => v.every((n, axis) => n >= scope.min[axis] - 1 && n <= scope.max[axis])));
  return `Refine only the ${scope.label} module. ${scope.objective}
The renders show the complete model for context. The rest is LOCKED; do not include any fixed parts in your answer. Ignore suggestions about other modules.
Replace the entire current module with 1–${scope.maxParts} parts, or return an empty parts array to keep it unchanged. Removed module pieces are already included in the local stock below. This is the full replacement, not additions to the current module.
Current module: ${JSON.stringify(moduleParts(original, scope))}
Nearby fixed parts (obstacles/supports; never repeat or edit them): ${JSON.stringify(neighbors)}
Bounds: min ${scope.min.join(',')} inclusive, max ${scope.max.join(',')} exclusive. Every footprint and height must fit.
Required connections to locked parts: ${JSON.stringify(scope.ports)}. Bottom means tube/grip cells; top means real studs, not a tile surface. Preserve ALL listed cells at their exact coordinates.
Local stock ceiling, after all locked parts have been deducted: ${JSON.stringify(scope.stock)}
x is right, y is back, z is height in plates. x/y are footprint minima. Bricks are 3 plates tall, plates/tiles 1. For ordinary type-AxB parts at rot 0, B runs along x and A along y; rot 90 swaps them. Only rot 0/90 for ordinary rectangular parts. Tiles have no studs. invslope-2x2 is 3 plates tall with a full studded top; at rot 0 only its back bottom row grips, at rot 90 its left row, at rot 180 its front row, at rot 270 its right row. Its overhang needs empty space. Curves/cheese are 2 plates tall and have NO top studs.
Keep every piece connected with no overlaps. Do not add decoration to compensate for poor proportions. Return a short changes list and parts with only partId, x, y, z, rot.`;
}

export function moduleSchema(scope: ModuleRefinementScope) {
  return { type: 'OBJECT', required: ['changes', 'parts'], properties: {
    changes: { type: 'ARRAY', maxItems: 2, items: { type: 'STRING' } },
    parts: { type: 'ARRAY', maxItems: scope.maxParts, items: { type: 'OBJECT',
      required: ['partId', 'x', 'y', 'z', 'rot'], properties: {
        partId: { type: 'STRING', enum: Object.keys(scope.stock) },
        x: { type: 'INTEGER' }, y: { type: 'INTEGER' }, z: { type: 'INTEGER' }, rot: { type: 'INTEGER' },
      },
    } },
  } };
}
