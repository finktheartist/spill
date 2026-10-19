import { footprint, heightOf, parsePartId, type Build, type PartKind, type Placed } from '../bricks';
import { frame, solidContains, type Rotation, type Solid, type V3 } from '../connections';
import { curvedContains } from '../curved-parts';

const CELL: V3 = [10, 10, 4]; // 0.5 × 0.5 × 0.2 studs (Placed.z is in plates).
const MAX_PARTS = 160, MAX_SPAN = 24 * 20, MAX_WORK = 2_000_000, EPS = 1e-6;
const MASKED = new Set(['curve', 'roundbrick', 'roundplate', 'roundtile', 'cone', 'roundendplate']);
type Body = { kind: PartKind; rotation: Rotation; translation: V3; solids: Solid[] };
type Sample = { body: Body; solid: Solid; box: boolean; lo: V3; hi: V3 };

function yaw([x, y, z]: V3, turn: number): V3 {
  return turn === 0 ? [x, y, z] : turn === 1 ? [-y, x, z] : turn === 2 ? [-x, -y, z] : [y, -x, z];
}

function partsOf(build: Build): Placed[] {
  if (!build || !Array.isArray(build.steps) || !build.steps.length || build.steps.length > MAX_PARTS) throw Error('Silhouette needs 1–160 parts in bounded steps.');
  let count = 0;
  for (const step of build.steps) {
    if (!step || !Array.isArray(step.parts) || (count += step.parts.length) > MAX_PARTS) throw Error('Silhouette is limited to 160 parts.');
  }
  if (!count) throw Error('An empty build has no animal silhouette.');
  return build.steps.flatMap(s => s.parts);
}

function bodyOf(p: Placed): Body {
  if (!p || typeof p.partId !== 'string') throw Error('Invalid silhouette part.');
  const kind = parsePartId(p.partId);
  if (!kind) throw Error('Unknown silhouette part.');
  const f = frame(p); // Uses the original exact rigid matrix; no angle rounding.
  if (!f.solids.length || f.solids.some(s => ![...s.bounds.min, ...s.bounds.max,
    ...s.points.flat(), ...s.axes.flat()].every(Number.isFinite))) throw Error('Silhouette geometry must be finite.');
  return { kind, rotation: f.rotation, translation: f.translation, solids: f.solids };
}

function rotateBody(body: Body, origin: V3, turn: number): Body {
  const relative = (p: V3): V3 => yaw(p.map((n, i) => n - origin[i]) as V3, turn);
  const columns = [0, 1, 2].map(i => yaw([body.rotation[i], body.rotation[3 + i], body.rotation[6 + i]], turn));
  const rotation = [0, 1, 2].flatMap(row => columns.map(c => c[row])) as Rotation;
  const solids = body.solids.map(s => {
    const points = s.points.map(relative);
    return { points, axes: s.axes.map(a => yaw(a, turn)), edges: s.edges.map(e => yaw(e, turn)),
      bounds: { min: [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))) as V3,
        max: [0, 1, 2].map(i => Math.max(...points.map(p => p[i]))) as V3 } };
  });
  return { ...body, rotation, translation: relative(body.translation), solids };
}

/** Lightweight nominal versions of render.ts primitives (no THREE dependency).
 * Ignore its GAP=.035 and .004-height cosmetic seam insets, which would turn
 * brick/plate segmentation into gaps. Curves share their source-facet outline
 * with the engine; circular masks remain nominal presentation approximations. */
function visualContains(body: Body, point: V3): boolean {
  const r = body.rotation, q = point.map((n, i) => n - body.translation[i]);
  const x = r[0] * q[0] + r[3] * q[1] + r[6] * q[2];
  const y = r[1] * q[0] + r[4] * q[1] + r[7] * q[2];
  const z = r[2] * q[0] + r[5] * q[1] + r[8] * q[2];
  const k = body.kind, { fw, fd } = footprint(k, 0), w = fw * 20, d = fd * 20, h = heightOf(k) * 8;
  if (k.type === 'curve') {
    return curvedContains(k,[x,y,z]);
  }
  const dx = x - w / 2, dy = y - d / 2;
  if (k.type === 'roundendplate') {
    const nearestX = Math.max(-10, Math.min(10, dx));
    return (dx - nearestX) ** 2 + dy ** 2 <= (Math.min(w, d) / 2) ** 2 + EPS;
  }
  const base = Math.min(w, d) / 2;
  const radius = k.type === 'cone' ? base + (6 - base) * Math.max(0, Math.min(1, z / h)) : base;
  return dx * dx + dy * dy <= radius * radius + EPS;
}

const isBox = (solid: Solid) => solid.axes.every(axis => axis.filter(n => Math.abs(n) > EPS).length === 1);

/** Visual dedup approximation, never a construction/stock/collision validator.
 * Cells are 10/10/4 LDU, anchored at each yaw's complete nominal-body bounds.
 * Four horizontal quarter-cell probes (2.5/7.5 LDU offsets), at the z midpoint,
 * retain round 1×1 corners and curved profiles; the four-bit masks are unioned
 * across all parts/solids. Sub-probe details, cosmetic seams, studs and sockets
 * are ignored; unmasked families retain the connection engine's nominal solids.
 * All four yaw views are resampled (fractional extents need distinct grid phases).
 * Bounds are <=24 studs on each axis, <=160 parts, <=2M probe checks across all
 * turns. No cache holds mutable builds, and no physical orientation is changed. */
export function animalSilhouetteKey(build: Build): string {
  const bodies = partsOf(build).map(bodyOf), solids = bodies.flatMap(b => b.solids);
  const origin = [0, 1, 2].map(i => Math.min(...solids.map(s => s.bounds.min[i]))) as V3;
  const span = [0, 1, 2].map(i => Math.max(...solids.map(s => s.bounds.max[i])) - origin[i]);
  if (span.some(n => !Number.isFinite(n) || n <= 0 || n > MAX_SPAN + EPS)) throw Error('Silhouette bounds must be finite and no larger than 24 studs per axis.');

  // Plan and bound every probe BEFORE sampling, even for highly overlapping or
  // oblique malicious inputs whose final occupied set would be deceptively small.
  let work = 0;
  const turns = [0, 1, 2, 3].map(turn => {
    const rotated = bodies.map(b => rotateBody(b, origin, turn)), all = rotated.flatMap(b => b.solids);
    const min = [0, 1, 2].map(i => Math.min(...all.map(s => s.bounds.min[i]))) as V3;
    const extent = [0, 1, 2].map(i => Math.max(...all.map(s => s.bounds.max[i])) - min[i]) as V3;
    const dimensions = extent.map((n, i) => Math.max(1, Math.ceil((n - EPS) / CELL[i]))) as V3;
    const samples: Sample[] = rotated.flatMap(body => body.solids.map(solid => {
      // Bounds include any horizontal subprobe, not just the cell midpoint.
      const lo = [0, 1, 2].map(i => Math.max(0, Math.ceil((solid.bounds.min[i] - min[i]) / CELL[i] - (i === 2 ? .5 : .75) - EPS))) as V3;
      const hi = [0, 1, 2].map(i => Math.min(dimensions[i] - 1, Math.floor((solid.bounds.max[i] - min[i]) / CELL[i] - (i === 2 ? .5 : .25) + EPS))) as V3;
      work += [0, 1, 2].reduce((n, i) => n * Math.max(0, hi[i] - lo[i] + 1), 4);
      if (work > MAX_WORK) throw Error('Silhouette sample work budget exceeded.');
      return { body, solid, box: isBox(solid), lo, hi };
    }));
    return { min, extent, dimensions, samples };
  });

  const keys = turns.map(({ min, extent, dimensions: [nx, ny, nz], samples }) => {
    const occupied = new Map<number, number>();
    for (const { body, solid, box, lo, hi } of samples) {
      const masked = MASKED.has(body.kind.type), lower = solid.bounds.min, upper = solid.bounds.max;
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
        const index = (z * ny + y) * nx + x, previous = occupied.get(index) ?? 0;
        if (previous === 15) continue;
        let mask = previous;
        const cellX = min[0] + x * 10, cellY = min[1] + y * 10, pointZ = min[2] + z * 4 + 2;
        // Axis-aligned boxes contain every probe when the entire cell is inside.
        if (box && !masked && cellX + 2.5 >= lower[0] - EPS && cellX + 7.5 <= upper[0] + EPS &&
            cellY + 2.5 >= lower[1] - EPS && cellY + 7.5 <= upper[1] + EPS &&
            pointZ >= lower[2] - EPS && pointZ <= upper[2] + EPS) mask = 15;
        else for (let bit = 0; bit < 4; bit++) {
          if (mask & (1 << bit)) continue;
          const point: V3 = [cellX + (bit & 1 ? 7.5 : 2.5), cellY + (bit & 2 ? 7.5 : 2.5), pointZ];
          if (point.some((n, i) => n < lower[i] - EPS || n > upper[i] + EPS)) continue;
          if ((box || solidContains(solid, point)) && (!masked || visualContains(body, point))) mask |= 1 << bit;
        }
        if (mask) occupied.set(index, mask);
      }
    }
    if (!occupied.size) throw Error('Silhouette has no occupied samples at the supported resolution.');
    const cells = [...occupied].sort(([a], [b]) => a - b).map(([i, mask]) => (i * 16 + mask).toString(36));
    const sizes = extent.map(n => Number(n.toFixed(6))).join(',');
    return `${nx},${ny},${nz}:${sizes}:${cells.join('.')}`;
  });
  return `animal-silhouette-v1:10,10,4:4xy:${keys.sort()[0]}`;
}
