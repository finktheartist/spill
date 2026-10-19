// Shape-first bricklayer: a subject described as smooth volumes (in studs) is voxelized at 1 stud × 1 brick course,
// trimmed to what can be built from the ground up, then covered with real parts from a pile and checked with the
// app's own validator. Deterministic and fast (≈0.1–2 s); runs in a worker on the page.
import { COLORS, gripCells, cells as partCells, footprint, heightOf, parsePartId, studCells, validate, voxels, type Build, type PartKind, type PartType, type Placed } from '../bricks';
/** A color name, or a '#rrggbb' hex value. */
const rgb = (c: string) => { const h = c.startsWith('#') ? c : (COLORS as Record<string, string>)[c] ?? '#808080'; return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); };
// Perceptual distance: CIELAB ΔE76 (sRGB → linear → XYZ D65 → Lab). ~10 = similar shade, 25+ = different color.
const lab = (c: string) => {
  const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
export const colorDist = (a: string, b: string) => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
export const NEAR_SHADE = 22;

export type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
export type SDF = (p: V) => number;
export const ellipsoid = (c: V, r: V): SDF => p => { const q: V = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]]; return (len(q) - 1) * Math.min(...r); };
export const capsule = (a: V, b: V, r: number): SDF => p => { const pa = sub(p, a), ba = sub(b, a); const bb = dot(ba, ba) || 1e-9; const h = Math.max(0, Math.min(1, dot(pa, ba) / bb)); return len(sub(pa, mul(ba, h))) - r; };
export const box = (c: V, half: V, round = 0): SDF => p => { const rr = Math.min(round, ...half); const q = [Math.abs(p[0] - c[0]) - half[0] + rr, Math.abs(p[1] - c[1]) - half[1] + rr, Math.abs(p[2] - c[2]) - half[2] + rr]; const o = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)); return o + Math.min(Math.max(q[0], q[1], q[2]), 0) - rr; };
/** Pitched roof: a triangular prism standing on z = c[2], ridge along x (or y when alongY); half = [half-length, half-width at the eaves, height]. */
export const gable = (c: V, half: V, alongY = false): SDF => p => {
  const [L, W, H] = half;
  const along = alongY ? Math.abs(p[1] - c[1]) - L : Math.abs(p[0] - c[0]) - L;
  const across = alongY ? Math.abs(p[0] - c[0]) : Math.abs(p[1] - c[1]);
  const h = p[2] - c[2];
  const slope = W / Math.max(1e-6, H), norm = Math.hypot(1, slope);
  const side = (across - W + h * slope) / norm; // distance to the sloped face
  return Math.max(along, -h, h - H, side);
};
const smin = (a: number, b: number, k: number) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** small: sampled at plate resolution even when the rest snaps to brick courses (eyes, noses, beaks). */
export interface Piece { name: string; sdf: SDF; role: string; blend?: number; cut?: boolean; small?: boolean }
/** `prefer`: per role, the special part types its cells should be built from where they fit. */
export interface Subject { name: string; size: [number, number, number]; course?: number; pieces: Piece[]; recolor?: (p: V, role: string, piece: string) => string; palette: Record<string, string[]>; prefer?: Record<string, string[]> }

const PH = 0.4; // plate height in studs
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const N5 = N6.slice(0, 5); // every face but the underside: the judge's cameras never look up

export function voxelize(s: Subject) {
  const [X, Y, Z] = s.size;
  const role = new Map<string, string>();
  const c = s.course ?? 1;
  const body = s.pieces.filter(p => !p.small), decals = s.pieces.filter(p => p.small && !p.cut);
  for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) {
    const coarse: V = [i + 0.5, j + 0.5, (Math.floor(k / c) * c + c / 2) * PH];
    const fine: V = [i + 0.5, j + 0.5, (k + 0.5) * PH];
    let d = Infinity, near = '', nearD = Infinity, nearPiece = '';
    for (const pc of body) {
      const v = pc.sdf(coarse);
      if (pc.cut) { d = Math.max(d, -v); continue; }
      d = smin(d, v, pc.blend ?? 0.5);
      if (v < nearD) { nearD = v; near = pc.role; nearPiece = pc.name; }
    }
    if (d < 0) role.set(`${i},${j},${k}`, s.recolor ? s.recolor(fine, near, nearPiece) : near);
  }
  // Stand it on the ground: a design that hovers would otherwise be trimmed away entirely by the ground-up pass.
  let lift = Infinity;
  for (const key of role.keys()) lift = Math.min(lift, Number(key.slice(key.lastIndexOf(',') + 1)));
  if (!Number.isFinite(lift)) lift = 0;
  const grounded = new Map<string, string>();
  for (const [key, r] of role) { const [i, j, k] = key.split(',').map(Number); grounded.set(`${i},${j},${k - lift}`, r); }
  groundLift.plates = lift;
  const kept = buildableOnly(grounded, Z);
  // Small details (eyes, buttons, finials) are painted onto the visible surface rather than added as bumps.
  detailRoles.clear();
  if (decals.length) for (const [key] of kept) {
    const [i, j, k] = key.split(',').map(Number);
    if (!N5.some(([a, b, cc]) => !kept.has(`${i + a},${j + b},${k + cc}`))) continue;
    const fine: V = [i + 0.5, j + 0.5, (k + lift + 0.5) * PH];
    let best = 0.6, r = '';
    for (const pc of decals) { const v = pc.sdf(fine); if (v < best) { best = v; r = pc.role; } }
    if (r) { kept.set(key, r); detailRoles.add(r); }
  }
  return kept;
}
export const detailRoles = new Set<string>();
/** How many plates the last voxelized shape was lowered to stand on the ground. */
export const groundLift = { plates: 0 };

/** Bricks stack from the ground up: a cell more than `reach` studs (sideways) from anything in the layer
 * below can't be bridged by a plate, so the overhang is trimmed back instead of leaving a hole. */
export const dropped = { count: 0 };
function buildableOnly(role: Map<string, string>, Z: number, reach = 2) {
  dropped.count = 0;
  const byLevel: [number, number][][] = Array.from({ length: Z }, () => []);
  for (const key of role.keys()) { const [x, y, z] = key.split(',').map(Number); byLevel[z].push([x, y]); }
  let below = new Set(byLevel[0].map(([x, y]) => `${x},${y}`));
  for (let k = 1; k < Z; k++) {
    const keep = new Set<string>();
    for (const [x, y] of byLevel[k]) {
      let ok = false;
      for (let a = -reach; a <= reach && !ok; a++) for (let b = -reach; b <= reach && !ok; b++) if (below.has(`${x + a},${y + b}`)) ok = true;
      if (ok) keep.add(`${x},${y}`); else { role.delete(`${x},${y},${k}`); dropped.count++; }
    }
    below = keep;
  }
  return role;
}

/**
 * The parts the layer can use, beyond plain bricks and plates. Geometry (footprint, studs, grip) comes from the app's
 * part contract, so the layer and the validator agree. `top`: no studs on top (tiles, curves, cheese slopes), so it only
 * finishes the shape where nothing is above it. `dir`: slopes down toward open air on its low edge (slopes, curves,
 * cheese slopes); `under`: an inverted slope, whose slanted underside spans a gap below its low side. Jumper plates
 * need the connections-v2 validator, so they stay out.
 */
const LAYABLE: Partial<Record<PartType, { top?: true; dir?: true; under?: true }>> = {
  brick: {}, roundbrick: {}, plate: {}, roundplate: {}, cornerplate: {}, roundendplate: {},
  tile: { top: true }, cornertile: { top: true }, curve: { top: true, dir: true }, cheese: { top: true, dir: true },
  slope: { dir: true }, invslope: { dir: true, under: true },
};
const LSHAPE = new Set<PartType>(['cornerplate', 'cornertile']);
const BASIC = new Set<string>(['brick', 'roundbrick', 'plate', 'roundplate']);
/** Parts the layer uses only on top surfaces and outer edges. */
export const FINISH_TYPES = new Set<string>(['tile', 'cornertile', 'curve', 'cheese', 'slope', 'invslope']);
export const layable = (type: string) => type in LAYABLE;
/** One rotation of a kind, as offsets from its min corner. `low`: cells off the high row (a sloped part's thin side);
 * `face`: the cells just past its low edge, which must be open air. */
interface Spot { fw: number; fd: number; cells: [number, number][]; studs: [number, number][]; grip: [number, number, number][]; low: [number, number][]; face: [number, number][] }
interface Kind { type: PartType; w: number; d: number; h: number; top: boolean; dir: boolean; under: boolean; bridge: boolean; rots: number[]; at: Record<number, Spot> }

/** Mirroring across the model's center line (y ↔ −y) turns front-facing parts to face back and swaps L corners. */
const mirrorRot = (kind: Kind, rot: number) =>
  kind.dir ? (rot === 0 ? 180 : rot === 180 ? 0 : rot)
    : LSHAPE.has(kind.type) ? ({ 0: 270, 90: 180, 180: 90, 270: 0 } as Record<number, number>)[rot]
      : rot;

function spotOf(k: PartKind, rot: number): Spot {
  const p: Placed = { partId: k.partId, x: 0, y: 0, z: 0, rot };
  const { fw, fd } = footprint(k, rot);
  const cells = partCells(k, p);
  // The high row is the back for rot 0 and turns with it (bricks.ts: rot = the way the low edge faces).
  const high = ([x, y]: [number, number]) => (rot === 0 ? y === fd - 1 : rot === 90 ? x === 0 : rot === 180 ? y === 0 : x === fw - 1);
  const face: [number, number][] = [];
  if (LAYABLE[k.type]?.dir) for (let t = 0; t < (rot % 180 === 0 ? fw : fd); t++) face.push(rot === 0 ? [t, -1] : rot === 90 ? [fw, t] : rot === 180 ? [t, fd] : [-1, t]);
  return { fw, fd, cells, studs: studCells(k, p), grip: gripCells(k, p), low: LAYABLE[k.type]?.dir ? cells.filter(c => !high(c)) : [], face };
}

const KINDS = (stock: Map<string, number>) => {
  const seen = new Map<string, Kind>();
  for (const id of stock.keys()) {
    const k = parsePartId(id); if (!k) continue;
    const f = LAYABLE[k.type], key = `${k.type}-${k.w}x${k.d}`;
    if (!f || seen.has(key)) continue;
    const rots = f.dir || LSHAPE.has(k.type) ? [0, 90, 180, 270] : k.w === k.d ? [0] : [0, 90];
    const at: Record<number, Spot> = {};
    for (const rot of rots) at[rot] = spotOf(k, rot);
    const h = heightOf(k);
    seen.set(key, { type: k.type, w: k.w, d: k.d, h, top: !!f.top, dir: !!f.dir, under: !!f.under, bridge: h === 1 && !f.top, rots, at });
  }
  return [...seen.values()];
};

/** Rough visible cells one part can cover when laid along a surface. Top-only parts and slopes count half: they only
 * go on top surfaces and edges. */
export const visibleCapacity = (id: string, n: number) => {
  const k = parsePartId(id); if (!k) return 0;
  const long = Math.max(k.w, k.d), area = LSHAPE.has(k.type) ? k.w * k.d - 1 : k.w * k.d;
  if (k.type === 'brick' || k.type === 'roundbrick') return n * long * 3;
  if (k.type === 'plate' || k.type === 'roundplate' || k.type === 'cornerplate' || k.type === 'roundendplate') return n * (long + area * 0.5);
  if (k.type === 'tile' || k.type === 'cornertile') return n * area * 0.5;
  if (k.type === 'curve' || k.type === 'cheese') return n * area;
  if (k.type === 'slope' || k.type === 'invslope') return n * long * 1.5;
  return 0;
};

/** `plain`: columns ("x,y") where only bricks and plates go. */
export function layBricks(s: Subject, stockIn: Record<string, number>, opts: { maxOutside?: number; exposed?: Set<string>; symmetric?: boolean; slopes?: boolean; pile?: Record<string, number>; buyPenalty?: number; plain?: Set<string> } = {}) {
  const [X, Y, Z] = s.size;
  const shape = voxelize(s);
  const stock = new Map(Object.entries(stockIn));
  const inside = (x: number, y: number, k: number) => shape.has(`${x},${y},${k}`);
  const visible = (x: number, y: number, k: number) => !!opts.exposed?.has(`${x},${y},${k}`) || N5.some(([a, b, c]) => !inside(x + a, y + b, k + c));
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const roleColors = new Set(Object.values(s.palette).flat());
  // How scarce each first-choice color is: visible demand vs. what the pile can cover.
  const demand = new Map<string, number>();
  for (const [key, role] of shape) { const [x, y, z] = key.split(',').map(Number); if (visible(x, y, z)) { const c = s.palette[role]?.[0]; if (c) demand.set(c, (demand.get(c) ?? 0) + 1); } }
  const capacity = new Map<string, number>();
  for (const [id, n] of stock) { const c = parsePartId(id)?.color; if (c) capacity.set(c, (capacity.get(c) ?? 0) + visibleCapacity(id, n)); }
  const scarcity = (c: string) => Math.min(3, 2 * (demand.get(c) ?? 0) / Math.max(1, capacity.get(c) ?? 1));
  // Bricks must not straddle a level where the shape widens or narrows nearby, or nothing has studs there to bridge from.
  const changeNear: Set<string>[] = [];
  for (let k = 0; k <= Z + 2; k++) {
    const near = new Set<string>();
    if (k > 0) for (const key of shape.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      const changes = (z === k && !inside(x, y, k - 1)) || (z === k - 1 && !inside(x, y, k));
      if (changes) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) near.add(`${x + a},${y + b}`);
    }
    changeNear.push(near);
  }
  const occupied = new Set<string>();
  const studTop = new Map<string, number>();
  const placed: Placed[] = [];
  const desired = new Map<string, string>(); // voxel -> color its mirror twin already got
  const pileLeft = opts.pile ? new Map(Object.entries(opts.pile)) : null; const bought: Record<string, number> = {};
  const parent: number[] = [];
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const holes: string[] = []; const offColor: Placed[] = []; const shade: Placed[] = []; let outsideCells = 0, asymmetric = 0;
  const kinds = KINDS(stock);
  const maxOutside = opts.maxOutside ?? 2;
  const symmetric = opts.symmetric ?? true;
  // Colors still in stock per part shape; refreshed only for the shape just used.
  const haveCache = new Map<string, string[]>();
  const haveOf = (prefix: string) => {
    let v = haveCache.get(prefix);
    if (!v) { v = [...stock.entries()].filter(([id, n]) => n > 0 && id.startsWith(prefix)).map(([id]) => id.slice(prefix.length)); haveCache.set(prefix, v); }
    return [...v];
  };
  const evaluate = (kind: Kind, rot: number, x: number, y: number, k: number, force?: string) => {
    const h = kind.h, spot = kind.at[rot], { fw, fd } = spot; // rot 0: a brick's long side along x
    if (x < 0 || y < 0 || x + fw > X || y + fd > Y) return null;
    if (opts.plain && !BASIC.has(kind.type) && spot.cells.some(([i, j]) => opts.plain!.has(`${x + i},${y + j}`))) return null;
    if (kind.dir) {
      // A sloped part faces open air past its low edge; nothing rests on its slope, or (inverted) its slant spans a gap.
      for (const [i, j] of spot.face) for (let dz = 0; dz < h; dz++) if (inside(x + i, y + j, k + dz)) return null;
      for (const [i, j] of spot.low) if (kind.under ? k === 0 || inside(x + i, y + j, k - 1) : inside(x + i, y + j, k + h)) return null;
    }
    if (kind.top && spot.cells.some(([i, j]) => inside(x + i, y + j, k + h))) return null; // no studs: only where the shape ends right above it
    let vol = 0, out = 0, bridges = 0, above = 0, hidden = 0; const roleCount = new Map<string, number>(); const supporters = new Set<number>(); const wants = new Map<string, number>();
    for (const [i, j] of spot.cells) {
      const cx = x + i, cy = y + j;
      for (let dz = 1; dz < h; dz++) if (changeNear[k + dz].has(`${cx},${cy}`)) return null;
      for (let dz = 0; dz < h; dz++) {
        const key = `${cx},${cy},${k + dz}`;
        if (occupied.has(key)) return null;
        if (!inside(cx, cy, k + dz)) {
          // A plate may reach a little past the shape to bridge an overhang; it shows its neighbor's color.
          const nb = kind.bridge ? N4.map(([a, b]) => shape.get(`${cx + a},${cy + b},${k}`)).find(Boolean) : undefined;
          if (!nb) return null;
          roleCount.set(nb, (roleCount.get(nb) ?? 0) + 1); out++; continue;
        }
        if (visible(cx, cy, k + dz)) { const rr = shape.get(key)!; roleCount.set(rr, (roleCount.get(rr) ?? 0) + 1); const dc = desired.get(key); if (dc) wants.set(dc, (wants.get(dc) ?? 0) + 1); } else hidden++;
        if (dz === h - 1 && inside(cx, cy, k + h)) above++;
        if (k > 0 && !inside(cx, cy, k - 1)) bridges++;
        vol++;
      }
    }
    for (const [i, j, dz] of spot.grip) { const sup = studTop.get(`${x + i},${y + j},${k + dz}`); if (sup !== undefined) supporters.add(sup); }
    if ((k > 0 && !supporters.size) || !vol) return null;
    if (k === 0 && !above) return null; // a ground piece must reach under something or nothing will hold it
    if (out && (out > maxOutside || !bridges)) return null;
    const ranked = [...roleCount.entries()].sort((a, b) => b[1] - a[1]);
    const minority = ranked.slice(1).reduce((n, [, c]) => n + c, 0);
    const role = ranked[0]?.[0];
    const prefix = `${kind.type}-${kind.w}x${kind.d}-`;
    const have = haveOf(prefix);
    if (!have.length) return null;
    const minorityDetail = ranked.slice(1).filter(([r]) => detailRoles.has(r)).reduce((n, [, c]) => n + c, 0);
    let color: string | undefined, penalty = minority * 6 + minorityDetail * 40, tier = 0;
    if (role) {
      const pal = s.palette[role] ?? [];
      const pi = pal.findIndex(c => have.includes(c));
      if (pi >= 0) { color = pal[pi]; penalty += pi * 12 + hidden * scarcity(color); }
      else {
        const base = pal[0] ?? role;
        const near = have.filter(c => colorDist(c, base) < NEAR_SHADE).sort((p, q) => colorDist(p, base) - colorDist(q, base))[0];
        if (near) { color = near; tier = 1; penalty += 60 + colorDist(near, base) * 2; }
        else if (above) { color = have.sort((p, q) => colorDist(p, base) - colorDist(q, base))[0]; tier = 2; penalty += 200 + colorDist(color, base); }
      }
    } else {
      color = have.sort((p, q) => (+roleColors.has(p) - +roleColors.has(q)) || (stock.get(prefix + q)! - stock.get(prefix + p)!))[0];
      penalty += roleColors.has(color) ? 6 + 10 * scarcity(color) : 0;
    }
    if (force) { if (!have.includes(force)) return null; color = force; }
    else if (wants.size) {
      // Mirror twin already colored: copy it when this shape exists in that color.
      const [wc] = [...wants.entries()].sort((a, b) => b[1] - a[1])[0];
      if (have.includes(wc) && wc !== color) { color = wc; tier = (s.palette[role ?? ''] ?? []).includes(wc) ? 0 : colorDist(wc, (s.palette[role ?? ''] ?? [wc])[0]) < NEAR_SHADE ? 1 : 2; }
    }
    if (!color) return null;
    for (const [wc, n] of wants) if (wc !== color) penalty += 25 * n;
    if (pileLeft && (pileLeft.get(prefix + color) ?? 0) <= 0) penalty += opts.buyPenalty ?? 30;
    const clusters = new Set([...supporters].map(find)).size;
    const finish = kind.top || kind.dir ? spot.cells.length * 2 : 0; // a clean top or a sloped edge, when the color fits
    const feature = role && s.prefer?.[role]?.includes(kind.type) ? spot.cells.length * 6 : 0; // the part this feature was designed around
    const score = vol * 3 + supporters.size * 5 + (clusters - 1) * 25 + bridges * 14 + (h === 3 ? 2 : 0) + finish + feature - penalty - out * 15;
    return { p: { partId: prefix + color, x, y, z: k, rot } as Placed, score, tier, out, fw, fd, h, supporters, spot };
  };
  for (let k = 0; k < Z; k++) {
    const level: [number, number][] = [];
    for (const key of shape.keys()) { const [x, y, z] = key.split(',').map(Number); if (z === k) level.push([x, y]); }
    const skip = new Set<string>();
    const open = (x: number, y: number) => inside(x, y, k) && !occupied.has(`${x},${y},${k}`) && !skip.has(`${x},${y}`);
    for (;;) {
      type Option = { parts: NonNullable<ReturnType<typeof evaluate>>[]; score: number };
      const covering = (tx: number, ty: number) => {
        let best: Option | null = null, n = 0;
        for (const kind of kinds) for (const rot of kind.rots) {
          if (kind.top && inside(tx, ty, k + kind.h)) break; // a part without studs can't cover a cell with shape above it
          if (kind.under && k === 0) break;
          const { fw, fd, cells } = kind.at[rot];
          for (let x = tx - fw + 1; x <= tx; x++) for (let y = ty - fd + 1; y <= ty; y++) {
            if (cells.length < fw * fd && !cells.some(([i, j]) => x + i === tx && y + j === ty)) continue; // an L part must cover the target
            const c = evaluate(kind, rot, x, y, k);
            if (!c) continue;
            n++;
            let opt: Option;
            const my = Y - y - fd, mrot = mirrorRot(kind, rot); // mirror across the center line
            if (!symmetric || (my === y && mrot === rot)) opt = { parts: [c], score: c.score };
            else if (my < y + fd && y < my + fd) opt = { parts: [c], score: c.score - 10 }; // overlaps its own mirror
            else {
              const m = (stock.get(c.p.partId) ?? 0) >= 2 ? evaluate(kind, mrot, x, my, k, parsePartId(c.p.partId)!.color) : null;
              opt = m ? { parts: [c, m], score: c.score + m.score } : { parts: [c], score: c.score - 10 };
            }
            if (!best || opt.score > best.score) best = opt;
          }
        }
        return { best, n };
      };
      // Most constrained first: the overhang cell with the fewest ways to bridge it, then cells with the fewest open neighbors.
      let target: [number, number] | null = null, tp = Infinity, chosen: ReturnType<typeof covering> | null = null;
      const overhangs = level.filter(([x, y]) => open(x, y) && k > 0 && !studTop.has(`${x},${y},${k}`));
      for (const [x, y] of overhangs) {
        const c = covering(x, y);
        if (!c.n) { skip.add(`${x},${y}`); continue; }
        if (c.n < tp) { tp = c.n; target = [x, y]; chosen = c; }
      }
      if (!target) for (const [x, y] of level) {
        if (!open(x, y)) continue;
        const pri = N4.filter(([a, b]) => open(x + a, y + b)).length;
        if (pri < tp) { tp = pri; target = [x, y]; }
      }
      if (!target) break;
      const [tx, ty] = target;
      const best = (chosen ?? covering(tx, ty)).best;
      if (!best) { skip.add(`${tx},${ty}`); continue; }
      if (best.parts.length === 1 && symmetric) asymmetric++;
      for (const part of best.parts) {
        const p = part.p;
        const idx = placed.push(p) - 1; if (part.tier === 2) offColor.push(p); else if (part.tier === 1) shade.push(p); outsideCells += part.out;
        parent[idx] = idx; for (const su of part.supporters) parent[find(su)] = find(idx);
        stock.set(p.partId, stock.get(p.partId)! - 1);
        if (pileLeft) { const left = pileLeft.get(p.partId) ?? 0; if (left > 0) pileLeft.set(p.partId, left - 1); else bought[p.partId] = (bought[p.partId] ?? 0) + 1; }
        { const pk = parsePartId(p.partId)!; haveCache.delete(`${pk.type}-${pk.w}x${pk.d}-`); }
        for (const [i, j] of part.spot.cells) {
          for (let dz = 0; dz < part.h; dz++) { occupied.add(`${p.x + i},${p.y + j},${p.z + dz}`); const mk = `${p.x + i},${Y - 1 - (p.y + j)},${p.z + dz}`; if (!occupied.has(mk) && !desired.has(mk)) desired.set(mk, parsePartId(p.partId)!.color); }
        }
        for (const [i, j] of part.spot.studs) studTop.set(`${p.x + i},${p.y + j},${p.z + part.h}`, idx);
      }
    }
    for (const [x, y] of level) if (!occupied.has(`${x},${y},${k}`)) holes.push(`${x},${y},${k}`);
  }
  // Stud joins also run upward (a piece holds the ones it rests under), so the true groups come from the validator.
  let looseRemoved = 0;
  const loose: Placed[] = [];
  {
    const draft: Build = { name: s.name, description: '', steps: [{ caption: '', parts: placed }] };
    const off = new Set(validate(draft, stockIn).filter(i => i.kind === 'loose').flatMap(i => i.parts));
    if (off.size) { looseRemoved = off.size; loose.push(...off); for (let i = placed.length - 1; i >= 0; i--) if (off.has(placed[i])) placed.splice(i, 1); }
  }
  // Slopes on exposed top edges: a brick with nothing on it, open air on one side and body on the other
  // becomes a same-color slope from the pile (mirrored pairs keep the model symmetric).
  let slopesPlaced = 0;
  if (opts.slopes ?? true) {
    const occ = new Set<string>();
    const dims = (p: Placed) => { const k = parsePartId(p.partId)!; return { k, ...footprint(k, p.rot) }; };
    for (const p of placed) for (const [x, y, z] of voxels(parsePartId(p.partId)!, p)) occ.add(`${x},${y},${z}`);
    const DIRS = [{ d: '+x', rot: 90, mirror: '+x' }, { d: '-x', rot: 270, mirror: '-x' }, { d: '-y', rot: 0, mirror: '+y' }, { d: '+y', rot: 180, mirror: '-y' }] as const;
    const fits = (p: Placed, d: string) => {
      const { k, fw, fd } = dims(p);
      if (k.type !== 'brick') return null;
      const runY = d === '-y' || d === '+y', w = runY ? fw : fd;
      if ((runY ? fd : fw) !== 2 || w < 1 || w > 4) return null;
      for (let i = 0; i < fw; i++) for (let j = 0; j < fd; j++) if (occ.has(`${p.x + i},${p.y + j},${p.z + 3}`)) return null; // something rests on it
      const side: [number, number][] = [], back: [number, number][] = [];
      for (let t = 0; t < (runY ? fw : fd); t++) {
        if (d === '-y') { side.push([p.x + t, p.y - 1]); back.push([p.x + t, p.y + 2]); }
        if (d === '+y') { side.push([p.x + t, p.y + 2]); back.push([p.x + t, p.y - 1]); }
        if (d === '-x') { side.push([p.x - 1, p.y + t]); back.push([p.x + 2, p.y + t]); }
        if (d === '+x') { side.push([p.x + 2, p.y + t]); back.push([p.x - 1, p.y + t]); }
      }
      if (side.some(([a, b]) => [0, 1, 2].some(dz => occ.has(`${a},${b},${p.z + dz}`)))) return null; // must face open air
      if (back.filter(([a, b]) => occ.has(`${a},${b},${p.z}`)).length * 2 < back.length) return null; // and lean on the body
      return `slope-${w}x2-${k.color}`;
    };
    const order = placed.map((p, i) => i).filter(i => parsePartId(placed[i].partId)!.type === 'brick').sort((a, b) => placed[b].z - placed[a].z);
    const swapped = new Set<number>();
    for (const i of order) {
      if (swapped.has(i)) continue;
      const p = placed[i];
      const { fd } = dims(p);
      const my = Y - p.y - fd, self = my === p.y;
      const j = self ? i : placed.findIndex((q, qi) => !swapped.has(qi) && q.partId === p.partId && q.x === p.x && q.y === my && q.z === p.z && q.rot === p.rot);
      if (j < 0) continue;
      for (const dir of DIRS) {
        if (self && (dir.d === '-y' || dir.d === '+y')) continue;
        const sid = fits(p, dir.d); if (!sid) continue;
        const mdir = DIRS.find(x => x.d === dir.mirror)!;
        if (!self && fits(placed[j], mdir.d) !== sid) continue;
        const need = self ? 1 : 2;
        if ((stock.get(sid) ?? 0) < need) continue;
        placed[i] = { partId: sid, x: p.x, y: p.y, z: p.z, rot: dir.rot }; swapped.add(i);
        if (!self) { const q = placed[j]; placed[j] = { partId: sid, x: q.x, y: q.y, z: q.z, rot: mdir.rot }; swapped.add(j); }
        stock.set(sid, stock.get(sid)! - need); stock.set(p.partId, (stock.get(p.partId) ?? 0) + need);
        slopesPlaced += need;
        break;
      }
    }
  }
  // How much of each color zone's visible surface came out in its own colors.
  const colorAt = new Map<string, string>();
  for (const p of placed) { const k = parsePartId(p.partId)!; for (const [x, y, z] of voxels(k, p)) colorAt.set(`${x},${y},${z}`, k.color); }
  const byRole: Record<string, { visible: number; on: number; near: number; off: number; holes: number; usedInstead: Record<string, number> }> = {};
  for (const [key, role] of shape) {
    const [x, y, z] = key.split(',').map(Number);
    if (!N5.some(([a, b, cc]) => !inside(x + a, y + b, z + cc))) continue;
    const e = byRole[role] ??= { visible: 0, on: 0, near: 0, off: 0, holes: 0, usedInstead: {} };
    e.visible++;
    const c = colorAt.get(key), pal = s.palette[role] ?? [];
    if (!c) e.holes++;
    else if (pal.includes(c)) e.on++;
    else { if (colorDist(c, pal[0] ?? c) < NEAR_SHADE) e.near++; else e.off++; e.usedInstead[c] = (e.usedInstead[c] ?? 0) + 1; }
  }
  let symSame = 0, symAll = 0;
  for (const [key] of shape) {
    const [x, y, z] = key.split(',').map(Number);
    if (y >= Y / 2 || !N5.some(([a, b, cc]) => !inside(x + a, y + b, z + cc))) continue;
    const c1 = colorAt.get(key), c2 = colorAt.get(`${x},${Y - 1 - y},${z}`);
    if (!c1 || !c2) continue;
    symAll++; if (c1 === c2) symSame++;
  }
  const colorSymmetry = symAll ? symSame / symAll : 1;
  const steps: Build['steps'] = [];
  for (const p of [...placed].sort((a, b) => a.z - b.z)) {
    const last = steps[steps.length - 1];
    if (!last || last.parts.length >= 8 || last.parts[0].z !== p.z) steps.push({ caption: p.z === 0 ? 'Lay out the base' : 'Add the next layer', parts: [] });
    steps[steps.length - 1].parts.push(p);
  }
  const build: Build = { name: s.name, description: 'shape-first prototype', steps };
  return { build, voxels: shape.size, holes, offColor, shade, outsideCells, looseRemoved, loose, asymmetric, slopesPlaced, byRole, colorSymmetry, bought, remaining: Object.fromEntries([...stock].filter(([, n]) => n > 0)), demand: Object.fromEntries(demand), capacity: Object.fromEntries(capacity), issues: validate(build, stockIn) };
}

export function layBricksExposed(s: Subject, stockIn: Record<string, number>, passes = 3, o: { symmetric?: boolean; slopes?: boolean; pile?: Record<string, number>; buyPenalty?: number } = {}) {
  const run = (stock: Record<string, number>, plain?: Set<string>) => {
    let exposed = new Set<string>(); let r = layBricks(s, stock, { exposed, plain, ...o });
    for (let i = 1; i < passes; i++) {
      const next = new Set(exposed);
      for (const hk of r.holes) { const [x, y, z] = hk.split(',').map(Number); for (const [a, b, c] of N6) next.add(`${x + a},${y + b},${z + c}`); }
      if (next.size === exposed.size) break;
      exposed = next; r = layBricks(s, stock, { exposed, plain, ...o });
    }
    return r;
  };
  const quality = (r: ReturnType<typeof layBricks>) => { const q = summary(r); return q.onPalette - 2 * q.visibleHoles + 0.001 * q.parts; };
  // Far from clean (over 15% unfilled while laying): the size search shrinks past it, so the retries below aren't worth their time.
  const hopeless = (r: ReturnType<typeof layBricks>) => r.holes.length > 0.15 * r.voxels;
  let r = run(stockIn);
  if (hopeless(r)) return r;
  // Special parts can take the cells where plates would have joined a tower to the body, and the unjoined tower is
  // dropped as loose: lay that tower and its seam with bricks and plates only.
  if (r.loose.length) {
    const plain = new Set<string>();
    for (const p of r.loose) for (const [x, y] of partCells(parsePartId(p.partId)!, p)) for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) plain.add(`${x + a},${y + b}`);
    const r2 = run(stockIn, plain);
    if (quality(r2) > quality(r)) r = r2;
  }
  // When it still drops parts or leaves gaps, bricks and plates alone may do better.
  if (r.loose.length || summary(r).visibleHoles > 0.02) {
    const basic = Object.fromEntries(Object.entries(stockIn).filter(([id]) => BASIC.has(parsePartId(id)?.type ?? '')));
    if (Object.keys(basic).length < Object.keys(stockIn).length) { const b = run(basic); if (quality(b) > quality(r)) r = b; }
  }
  return r;
}

export function summary(r: ReturnType<typeof layBricks>) {
  const parts = r.build.steps.flatMap(s => s.parts);
  const byColor: Record<string, number> = {};
  for (const p of parts) { const c = parsePartId(p.partId)!.color; byColor[c] = (byColor[c] ?? 0) + 1; }
  const tot = Object.values(r.byRole).reduce((a, e) => ({ visible: a.visible + e.visible, on: a.on + e.on, near: a.near + e.near, off: a.off + e.off, holes: a.holes + e.holes }), { visible: 0, on: 0, near: 0, off: 0, holes: 0 });
  return {
    dropped: dropped.count, looseRemoved: r.looseRemoved, parts: parts.length, kinds: new Set(parts.map(p => p.partId)).size, voxels: r.voxels,
    holes: r.holes.length, nearShade: r.shade.length, offColor: r.offColor.length, bridgeCells: r.outsideCells, asymmetric: r.asymmetric, slopes: r.slopesPlaced,
    colorSymmetry: +r.colorSymmetry.toFixed(3), visibleCells: tot.visible, onPalette: +(tot.on / Math.max(1, tot.visible)).toFixed(3), visibleHoles: +(tot.holes / Math.max(1, tot.visible)).toFixed(3),
    byRole: r.byRole, issues: r.issues.map(i => `${i.kind}: ${i.message.slice(0, 140)}`), colors: byColor,
  };
}
export function report(name: string, r: ReturnType<typeof layBricks>) {
  const s = summary(r);
  console.log(`${name}: ${s.parts} parts, on-palette ${(s.onPalette * 100).toFixed(0)}% of ${s.visibleCells} visible cells, holes ${(s.visibleHoles * 100).toFixed(1)}%, ${s.slopes} slopes, ${s.asymmetric} unpaired, ${s.looseRemoved} loose removed, ${s.issues.length} issues`);
  console.log('  colors:', JSON.stringify(s.colors));
  for (const i of s.issues.slice(0, 6)) console.log('  issue:', i);
}
