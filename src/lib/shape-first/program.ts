// The shape language Gemini writes: a few smooth volumes with sizes in studs and a color role each.
// Code turns it into a Subject for the bricklayer. Checks are deterministic; nothing here calls a model.
import { parsePartId } from '../bricks';
import { FINISH_TYPES, box, capsule, ellipsoid, gable, visibleCapacity, type Piece, type Subject, type V } from './bricklayer';

export interface ProgramPiece { name: string; shape: 'ellipsoid' | 'capsule' | 'box' | 'gable' | 'gable-y'; a: number[]; b: number[]; r: number; round: number; role: string; mirror: boolean; cut: boolean }
export interface PaintRule { role: string; pieces: string[]; zMin: number; zMax: number; xMin: number; xMax: number; yMax: number }
/** `parts`: special parts a feature role is built from where they fit (a beak of cheese slopes, ears of slopes). */
export interface PaletteEntry { role: string; colors: string[]; parts?: string[] }
export interface ShapeProgram { name: string; pitch: string; thinking: string; length: number; width: number; height: number; palette: PaletteEntry[]; pieces: ProgramPiece[]; paint: PaintRule[] }

/** Special parts a design can ask for by role. */
export const FEATURE_PARTS = ['slope', 'curve', 'cheese', 'tile', 'invslope', 'roundbrick', 'roundplate', 'cornerplate'];

export const LIMITS = { length: 22, width: 14, height: 24 };

export function programSchema(colors: string[]) {
  const num = { type: 'NUMBER' };
  const vec = { type: 'ARRAY', items: num };
  return {
    type: 'OBJECT', required: ['name', 'pitch', 'thinking', 'length', 'width', 'height', 'palette', 'pieces', 'paint'],
    propertyOrdering: ['name', 'pitch', 'thinking', 'length', 'width', 'height', 'palette', 'pieces', 'paint'],
    properties: {
      name: { type: 'STRING' }, pitch: { type: 'STRING' }, thinking: { type: 'STRING' },
      length: num, width: num, height: num,
      palette: { type: 'ARRAY', items: { type: 'OBJECT', required: ['role', 'colors'], properties: { role: { type: 'STRING' }, colors: { type: 'ARRAY', items: { type: 'STRING', enum: colors } }, parts: { type: 'ARRAY', items: { type: 'STRING', enum: FEATURE_PARTS } } } } },
      pieces: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name', 'shape', 'a', 'b', 'r', 'round', 'role', 'mirror', 'cut'], propertyOrdering: ['name', 'shape', 'a', 'b', 'r', 'round', 'role', 'mirror', 'cut'], properties: {
        name: { type: 'STRING' }, shape: { type: 'STRING', enum: ['ellipsoid', 'capsule', 'box', 'gable', 'gable-y'] }, a: vec, b: vec, r: num, round: num, role: { type: 'STRING' }, mirror: { type: 'BOOLEAN' }, cut: { type: 'BOOLEAN' },
      } } },
      paint: { type: 'ARRAY', items: { type: 'OBJECT', required: ['role', 'pieces', 'zMin', 'zMax', 'xMin', 'xMax', 'yMax'], properties: {
        role: { type: 'STRING' }, pieces: { type: 'ARRAY', items: { type: 'STRING' } }, zMin: num, zMax: num, xMin: num, xMax: num, yMax: num,
      } } },
    },
  };
}

/** Honest supply: every part in each color by type and size, plus what small parts can cover on a rounded body. */
export function supplyTable(stock: Record<string, number>) {
  const by = new Map<string, { total: number; small: number; lines: Map<string, string[]> }>();
  for (const [id, n] of Object.entries(stock).sort((a, b) => b[1] - a[1])) {
    const k = parsePartId(id); if (!k) continue;
    const e = by.get(k.color) ?? { total: 0, small: 0, lines: new Map() };
    e.total += n;
    const long = Math.max(k.w, k.d);
    // calibrated on the earlier trial builds: bricks of any length help on a rounded body, plates up to 6 long
    if (k.type === 'brick' || k.type === 'roundbrick') e.small += n * long * 3;
    if ((k.type === 'plate' || k.type === 'roundplate') && long <= 6) e.small += n * long;
    if (k.type === 'cornerplate' || k.type === 'roundendplate') e.small += n * 2;
    if (FINISH_TYPES.has(k.type)) e.small += visibleCapacity(id, n);
    const group = k.type === 'brick' || k.type === 'roundbrick' ? 'bricks'
      : ['plate', 'roundplate', 'cornerplate', 'roundendplate'].includes(k.type) ? 'plates'
        : FINISH_TYPES.has(k.type) ? 'tops and edges (tiles, curves and slopes finish top surfaces and outer edges)'
          : 'other (not used by the builder)';
    const name = k.type === 'roundbrick' || k.type === 'roundplate' ? 'round ' : k.type === 'roundendplate' ? 'round-end plate ' : ['brick', 'plate'].includes(k.type) ? '' : `${k.type} `;
    const label = `${name}${k.w}x${k.d}${n > 1 ? '×' + n : ''}`;
    e.lines.set(group, [...(e.lines.get(group) ?? []), label]);
    by.set(k.color, e);
  }
  return [...by.entries()].sort((a, b) => b[1].total - a[1].total).map(([color, e]) => ({
    color, total: e.total, roundedCells: Math.round(e.small * 0.8),
    text: `${color} (${e.total} parts; covers ~${Math.round(e.small * 0.8)} visible cells on a rounded body): ${[...e.lines.entries()].map(([g, l]) => `${g} ${l.join(', ')}`).join(' · ')}`,
  }));
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const nameMatch = (pattern: string, name: string) => pattern === '*' || pattern === name || (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1)));

/** Program → Subject. Problems are reported, never silently patched beyond clamping to the build area. */
export function toSubject(p: ShapeProgram, stockColors: Set<string>, course = 3, fit = 1): { subject: Subject; problems: string[] } {
  const problems: string[] = [];
  const palette: Record<string, string[]> = {};
  const prefer: Record<string, string[]> = {};
  for (const e of p.palette ?? []) {
    const cs = (e.colors ?? []).filter(c => stockColors.has(c));
    if (!cs.length) problems.push(`role ${e.role}: none of ${JSON.stringify(e.colors)} is in the pile`);
    else palette[e.role] = cs;
    const parts = (e.parts ?? []).filter(t => FEATURE_PARTS.includes(t));
    if (parts.length) prefer[e.role] = parts;
  }
  // Fit the requested size into the build area by uniform scaling, if needed (reported).
  const L = Math.max(4, p.length), W = Math.max(2, p.width), H = Math.max(2, p.height);
  const scale = fit * Math.min(1, LIMITS.length / L, LIMITS.width / W, LIMITS.height / H);
  if (scale < fit) problems.push(`scaled to ${scale.toFixed(2)} to fit ${LIMITS.length}×${LIMITS.width}×${LIMITS.height} studs`);
  const X = Math.ceil(L * scale) + 3, Yh = Math.ceil(W * scale / 2) + 1, Y = 2 * Yh, Z = Math.ceil(H * scale / 0.4) + 4;
  const g = (v: number[]): V => [v[0] * scale + 1, v[1] * scale + Yh, v[2] * scale];
  const pieces: Piece[] = [];
  for (const q of p.pieces ?? []) {
    if (!palette[q.role]) { problems.push(`piece ${q.name}: role ${q.role} has no usable color`); continue; }
    if (![...(q.a ?? []), ...(q.b ?? [])].every(finite) || (q.a ?? []).length !== 3 || (q.b ?? []).length !== 3) { problems.push(`piece ${q.name}: needs a and b as [x,y,z]`); continue; }
    const make = (a: number[], b: number[]): Piece['sdf'] | null => {
      if (q.shape === 'ellipsoid') { if (b.some(v => v <= 0)) return null; return ellipsoid(g(a), [b[0] * scale, b[1] * scale, b[2] * scale]); }
      if (q.shape === 'capsule') { if (!(q.r > 0)) return null; return capsule(g(a), g(b), q.r * scale); }
      if (q.shape === 'box') { if (b.some(v => v <= 0)) return null; return box(g(a), [b[0] * scale, b[1] * scale, b[2] * scale], Math.max(0, q.round || 0) * scale); }
      if (q.shape === 'gable' || q.shape === 'gable-y') { if (b.some(v => v <= 0)) return null; return gable(g(a), [b[0] * scale, b[1] * scale, b[2] * scale], q.shape === 'gable-y'); }
      return null;
    };
    const sides: [string, number[], number[]][] = [[q.name, q.a, q.b]];
    if (q.mirror) sides.push([`${q.name}~m`, [q.a[0], -q.a[1], q.a[2]], q.shape === 'capsule' ? [q.b[0], -q.b[1], q.b[2]] : q.b]);
    for (const [name, a, b] of sides) {
      const sdf = make(a, b);
      if (!sdf) { problems.push(`piece ${q.name}: invalid ${q.shape} dimensions`); break; }
      const extent = q.shape === 'capsule' ? q.r * 2 : Math.min(...b) * 2;
      pieces.push({ name, sdf, role: q.role, cut: !!q.cut, small: extent * scale < 1.6 && !prefer[q.role] }); // a feature built from named parts is never just paint
    }
  }
  const rules = (p.paint ?? []).filter(r => palette[r.role]);
  for (const r of p.paint ?? []) if (!palette[r.role]) problems.push(`paint: role ${r.role} has no usable color`);
  const recolor = rules.length ? (pt: V, role: string, piece: string) => {
    const base = piece.replace(/~m$/, '');
    // back to program coordinates for the paint boxes
    const x = (pt[0] - 1) / scale, y = (pt[1] - Yh) / scale, z = pt[2] / scale;
    let out = role;
    for (const r of rules) if ((r.pieces ?? ['*']).some(pat => nameMatch(pat, base)) && z >= r.zMin && z <= r.zMax && x >= r.xMin && x <= r.xMax && Math.abs(y) <= r.yMax) out = r.role;
    return out;
  } : undefined;
  return { subject: { name: p.name, size: [X, Y, Z], course, pieces, recolor, palette, prefer: Object.keys(prefer).length ? prefer : undefined }, problems };
}

/** How a shape program becomes bricks: shared by every design prompt. */
export const SHAPE_TEXT = `HOW YOUR SHAPE BECOMES BRICKS
- Units are studs (1 stud = 8 mm). x runs from the back (0) toward the front; the subject faces +x. y is sideways from the center line (negative = its left, positive = its right). z is height; the ground is z = 0 and the model stands on it.
- The program samples your shape on a grid: 1 stud horizontally and 1.2 studs (one brick) vertically. A feature thinner than about 1 stud sideways or 1.2 studs tall disappears or becomes a single cell, so make features that must read at least 2 studs across. Volumes smaller than 1.6 studs (eyes, buttons, small markings) are not added as bumps: they paint the body surface they touch, so place them on or just inside the surface. Anything that should stick out (a beak, a muzzle, a finial) must be at least 1.6 studs thick, unless its palette role names the special parts it is built from (see below). The model's width is an even number of studs, so a feature on the center line is 2 studs wide; paired features can be 1 stud each.
- The builder lays bricks, plates, round 1x1/2x2 parts, corner plates and round-end plates anywhere; tiles, curved slopes and 1x1 cheese slopes only on top surfaces, where nothing sits on them; 45-degree slopes along outer top edges, their low side facing outward; and inverted slopes under an overhang. It mirrors colors left to right. It does not use arches, jumper plates or sideways (studs-not-on-top) building. A palette role may list "parts" (slope, curve, cheese, tile, invslope, roundbrick, roundplate, cornerplate): that role's cells are built from those parts wherever they fit, which is how a beak becomes a cheese slope or ears become slopes.
- Bricks stack from the ground up. Every volume must overlap the rest of the shape by at least 1 stud. A part that sticks out sideways must attach along its lower edge to something about as low; anything that juts more than 2 studs beyond the layer under it gets trimmed off. Prefer forms that widen gradually going up, and avoid parts that hang down below their attachment.
- Volumes: "ellipsoid" (a = center [x,y,z], b = radii [rx,ry,rz]); "capsule" (a = start point, b = end point, r = radius) for limbs, necks and tails; "box" (a = center, b = half-sizes [hx,hy,hz], round = corner rounding in studs); "gable" (a = center of its base [x,y,z], b = [half-length, half-width at the eaves, height]) for a pitched roof whose ridge runs along x, "gable-y" for one whose ridge runs along y. Unused fields: r = 0, round = 0. "mirror": true also adds the same volume reflected across the center line (y → −y), so describe one side of each pair. "cut": true carves the volume out instead of adding it. Overlapping volumes blend smoothly.`;
/** Free palette: the model picks pile colors per role. */
export const FREE_COLORS_TEXT = `- Colors: give each volume a role (your own names). "palette" maps every role to 1–3 pile colors, first choice first; later choices are used only when the first runs out. "paint" rules recolor the parts of the named volumes ("*" = all, or a name prefix ending in "*") that lie inside zMin–zMax, xMin–xMax and |y| ≤ yMax, for markings such as a pale belly, socks, a mask, stripes or a tip; later rules win. Use −99 and 99 for no limit.`;
/** What the judge rewards. */
export const GOOD_TEXT = `WHAT GOOD LOOKS LIKE
Recognizable at a glance from the front, the side and a three-quarter view, without a label: convincing proportions, an articulate silhouette with clear transitions between its main masses, defining features slightly exaggerated so they read at stud resolution, eyes or other face details sitting ON the surface where they show, deliberate color zones, and left/right symmetry where the subject has it.`;

export function designPrompt(subject: string, brief: string, stock: Record<string, number>, table: ReturnType<typeof supplyTable>) {
  const total = Object.values(stock).reduce((a, b) => a + b, 0);
  return `Design a LEGO sculpture of: ${subject}. ${brief}

It will be built ONLY from one person's own pile of loose bricks. You do not place bricks. You describe the subject's 3D SHAPE as a few smooth volumes, and a program turns that shape into a real, buildable brick model using only parts from the pile.

${SHAPE_TEXT}
${FREE_COLORS_TEXT}

COLOR SUPPLY: THE REAL LIMIT
The pile has ${total} usable parts in ${table.length} colors, and most colors have only a handful of small parts. Only the visible surface needs its role color; hidden insides and undersides are filled automatically with leftover colors. A rounded body is covered mostly by bricks and short plates; large plates (4x4 and up) only help on flat areas such as a base, a flat back or a deck. Every part, by color and size:
${table.map(t => t.text).join('\n')}
Plan the palette so each color's share of the visible surface fits what its small parts can cover. When no single color can cover the whole subject, use a deliberate pattern (two-tone body, saddle, belly, stripes, mask, bands) instead of one flat color, or choose a smaller size. A trial build will report exactly how much of each color zone came out in its own colors.

SIZE
As large as the color supply allows, at most ${LIMITS.length} studs long, ${LIMITS.width} wide and ${LIMITS.height} tall. Bigger reads better: a head 4 or more studs wide can show eyes and a muzzle; a head 2 studs wide cannot.

${GOOD_TEXT}

Fill "thinking" first with a short plan: the subject's defining features and proportions, the palette against the supply, and how each feature attaches. Then give the overall length, width and height in studs, the palette, the volumes and the paint rules.`;
}
