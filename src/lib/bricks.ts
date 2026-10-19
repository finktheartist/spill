import { validateConnections, spatial, frame, connectionOnly, type Rotation, type RequiredContact } from './connections';
import { isOutlinePart, outlineCells, outlineStudCells } from './outline-parts';
import { curvedPart } from './curved-parts';
import { specialMold } from './special-mold-geometry';
import {connectorMold} from './connector-mold-geometry';
import {ALL_MOLDS as POPULAR_MOLDS,popularMold,popularType} from './popular-molds';
// The brick contract: one module shared by the prompts, the validator and the renderer.
// Grid: x = left→right, y = front→back (bigger y is farther from the viewer), both in studs.
// z = height in PLATE units. A placed part's (x, y) is its footprint's min corner, z its bottom face.

/**
 * 'wheel' is one loose wheel as scanned (inventory/UI only). 'wheels' is the build part: a PAIR of
 * wheels on a 2x2 axle plate, explicitly confirmed as a complete assembly. The specialty families (curve … arch) are
 * what give official sets their finish: smooth curves, round details, clean tops, overhangs, openings.
 */
export type PartType =
  | `mold${number}`
  | 'brick' | 'plate' | 'tile' | 'slope' | 'wheel' | 'wheels' | 'endstudplate' | 'edgeplate' | 'quartertile'
  | 'halftile' | 'quarterroundtile' | 'offsetplate' | 'roundjumper' | 'triangletile' | 'headlight' | 'invertedbracket'
  | 'curve' | 'invslope' | 'cheese' | 'roundbrick' | 'roundplate' | 'roundtile' | 'cone' | 'arch'
  | 'sidebrick' | 'sidebricktall' | 'sidebrickadjacent' | 'sidebrickall' | 'roundendplate' | 'jumper' | 'bracket' | 'cornerplate' | 'cornertile' | 'cornerbrick' | 'wedgeleft' | 'wedgeright' | 'quarterplate';

export const COLORS = {
  white: '#F2F3F2',
  black: '#1B2A34',
  red: '#C91A09',
  blue: '#0055BF',
  yellow: '#F2CD37',
  green: '#237841',
  'bright-green': '#4B9F4A',
  lime: '#BBE90B',
  orange: '#FE8A18',
  tan: '#E4CD9E',
  'reddish-brown': '#582A12',
  'light-gray': '#A0A5A9',
  'dark-gray': '#6C6E68',
  'dark-blue': '#0A3463',
  azure: '#36AEBF',
  pink: '#C870A0',
  purple: '#81007B',
  'dark-purple': '#3F3691',
  'trans-clear': '#E8F4FA',
  // the most-used modern LEGO colors beyond the first 17 (Rebrickable's RGB values)
  'dark-tan': '#958A73',
  'dark-red': '#720E0F',
  'dark-brown': '#352100',
  nougat: '#D09168',
  'medium-nougat': '#AA7D55',
  'bright-light-orange': '#F8BB3D',
  'dark-orange': '#A95500',
  'dark-green': '#184632',
  'sand-green': '#A0BCAC',
  'dark-turquoise': '#008F9B',
  'dark-azure': '#078BC9',
  'medium-blue': '#5A93DB',
  'bright-pink': '#E4ADC8',
  'trans-red': '#C91A09',
} as const;
export type ColorName = keyof typeof COLORS;
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];
export const isTrans = (c: string) => c.startsWith('trans-');

/** What the scanner and the add-part picker know about (wheel pairs are derived, not scanned). */
export const CATALOG: Record<Exclude<PartType, 'wheels'>, string[]> = {
  ...Object.fromEntries(POPULAR_MOLDS.map(m=>[m.type,[`${m.w}x${m.d}`]])),
  brick: ['1x1', '1x2', '1x3', '1x4', '1x6', '1x8', '1x10', '1x12', '1x16', '2x2', '2x3', '2x4', '2x6', '2x8', '2x10'],
  plate: ['1x1', '1x2', '1x3', '1x4', '1x5', '1x6', '1x8', '1x10', '1x12', '2x2', '2x3', '2x4', '2x6', '2x8', '2x10', '2x12', '2x14', '2x16', '3x3', '4x4', '4x6', '4x8', '4x10', '4x12', '6x6', '6x8', '6x10', '6x12', '6x14', '6x16', '8x8', '8x16'],
  tile: ['1x1', '1x2', '1x3', '1x4', '1x6', '1x8', '2x2', '2x3', '2x4', '2x6'],
  slope: ['1x2', '2x2', '3x2', '4x2'],
  curve: ['1x2', '1x3', '2x2'],
  invslope: ['1x2', '2x2'],
  cheese: ['1x1'],
  roundbrick: ['1x1', '2x2'],
  roundplate: ['1x1', '2x2'],
  roundtile: ['1x1', '2x2', '3x3'],
  halftile: ['1x1'], quarterroundtile: ['1x1'], offsetplate: ['1x3'], roundjumper: ['2x2'], triangletile: ['2x2'], headlight: ['1x1'], invertedbracket: ['1x2'],
  endstudplate: ['1x4'], edgeplate: ['2x2'], quartertile: ['2x2'],
  cone: ['1x1'],
  arch: ['1x4', '1x6'],
  cornerplate: ['2x2'],
  cornertile: ['2x2'],
  cornerbrick: ['2x2'],
  sidebrick: ['1x1', '1x2', '1x4'], sidebricktall: ['1x2'], sidebrickadjacent: ['1x1'], sidebrickall: ['1x1'], roundendplate: ['1x2'], jumper: ['1x2', '2x2'], bracket: ['1x2'],
  wedgeleft: ['2x4'], wedgeright: ['2x4'], quarterplate: ['4x4'],
  wheel: ['1x1'],
};

/** A part kind = type + size + color. Its id is the stable slug used everywhere. */
export interface PartKind {
  partId: string;
  type: PartType;
  w: number; // width (along x at rot 0 for directional parts)
  d: number; // depth; for slopes/curves/inverted slopes this is the run
  color: ColorName;
}
export type PartShape = Pick<PartKind, 'type' | 'w' | 'd'>;

export const partId = (type: PartType, w: number, d: number, color: ColorName) => `${type}-${w}x${d}-${color}`;

const TYPE_RE = 'mold[0-9]+|invertedbracket|quarterroundtile|triangletile|roundjumper|offsetplate|halftile|headlight|endstudplate|edgeplate|quartertile|sidebricktall|sidebrickadjacent|sidebrickall|roundendplate|sidebrick|jumper|bracket|wedgeleft|wedgeright|quarterplate|cornerplate|cornertile|cornerbrick|roundbrick|roundplate|roundtile|invslope|cheese|curve|cone|arch|brick|plate|tile|slope|wheels|wheel';
const PART_ID_RE = new RegExp(`^(${TYPE_RE})-(\\d+)x(\\d+)-([a-z-]+)$`);
export function parsePartId(id: string): PartKind | null {
  const m = PART_ID_RE.exec(id);
  if (!m || !(m[4] in COLORS)) return null;
  if(m[1].startsWith('mold')&&!popularMold({type:m[1],w:+m[2],d:+m[3]}))return null;
  if (m[1] === 'curve' && !CATALOG.curve.includes(`${m[2]}x${m[3]}`)) return null;
  if (['halftile','quarterroundtile','offsetplate','roundjumper','triangletile','headlight','invertedbracket','endstudplate','edgeplate','quartertile','roundtile'].includes(m[1]) && !CATALOG[m[1] as keyof typeof CATALOG].includes(`${m[2]}x${m[3]}`)) return null;
  if (['sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','roundendplate','jumper','bracket'].includes(m[1]) && !CATALOG[m[1] as keyof typeof CATALOG].includes(`${m[2]}x${m[3]}`)) return null;
  if ((m[1] === 'wedgeleft' || m[1] === 'wedgeright') && (m[2] !== '2' || m[3] !== '4')) return null;
  if (m[1] === 'quarterplate' && (m[2] !== '4' || m[3] !== '4')) return null;
  return { partId: id, type: m[1] as PartType, w: +m[2], d: +m[3], color: m[4] as ColorName };
}

const DIRECTIONAL: PartType[] = ['halftile','quarterroundtile','triangletile','headlight','invertedbracket','edgeplate','quartertile','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','bracket','wedgeleft', 'wedgeright', 'quarterplate', 'slope', 'curve', 'invslope', 'cheese'];
const SQUARE: PartType[] = ['cheese', 'roundbrick', 'roundplate', 'roundtile', 'cone', 'cornerplate', 'cornertile', 'cornerbrick'];
/** L-shaped parts: a square with one corner cell missing. */
export const CORNER: PartType[] = ['cornerplate', 'cornertile', 'cornerbrick'];

/**
 * Normalize whatever size string a model returns into catalog orientation, or null if unusable.
 * Bricks/plates/tiles/arches: smaller dimension first ("4x2" → 2x4). Slopes: width x run, run 2.
 * Curves / inverted slopes: width x run with run the longer side. Round parts, cones, cheese: square.
 */
export function normalizeSize(type: PartType, size: string): { w: number; d: number } | null {
  if (type === 'wheel') return { w: 1, d: 1 };
  if (type === 'wheels') return { w: 4, d: 2 };
  const m = /(\d+)\s*[x×X]\s*(\d+)/.exec(size);
  if (!m) return null;
  let a = +m[1], b = +m[2];
  if (a < 1 || b < 1) return null;
  if(type.startsWith('mold')){
    const mold=POPULAR_MOLDS.find(m=>m.type===type);
    return mold&&((a===mold.w&&b===mold.d)||(b===mold.w&&a===mold.d))?{w:mold.w,d:mold.d}:null;
  }
  if (a > 16 || b > 16) return null;
  if (['halftile','quarterroundtile','offsetplate','roundjumper','triangletile','headlight','invertedbracket','endstudplate','edgeplate','quartertile'].includes(type)) {
    const w=Math.min(a,b),d=Math.max(a,b);return CATALOG[type as keyof typeof CATALOG]?.includes(`${w}x${d}`)?{w,d}:null;
  }
  if (['sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','roundendplate','jumper','bracket'].includes(type)) {
    const w=Math.min(a,b),d=Math.max(a,b);return CATALOG[type as keyof typeof CATALOG]?.includes(`${w}x${d}`)?{w,d}:null;
  }
  if (type === 'quarterplate') return a === 4 && b === 4 ? { w: 4, d: 4 } : null;
  if (type === 'wedgeleft' || type === 'wedgeright') return Math.min(a,b) === 2 && Math.max(a,b) === 4 ? {w:2,d:4} : null;
  if (type === 'slope') {
    if (a === 2 && b === 2) return { w: 2, d: 2 };
    if (b === 2 && [1, 3, 4].includes(a)) return { w: a, d: 2 };
    if (a === 2 && [1, 3, 4].includes(b)) return { w: b, d: 2 };
    return null;
  }
  if (SQUARE.includes(type)) return a === b ? { w: a, d: a } : null;
  if (a > b) [a, b] = [b, a];
  return { w: a, d: b };
}

/** Nominal body height in plates. Curved molds require their exact size. */
export function heightOf(kind: PartShape): number;
export function heightOf(type: Exclude<PartType, 'curve'>): number;
export function heightOf(kind: PartShape | Exclude<PartType, 'curve'>): number {
  const type = typeof kind === 'string' ? kind : kind.type;
  const popular=typeof kind==='string'?POPULAR_MOLDS.find(m=>m.type===kind):popularMold(kind);
  if(popular)return popular.heightPlates;
  if(typeof kind==='object'){
    const connector=connectorMold(kind);if(connector)return connector.heightPlates;
    const mold=specialMold(kind);if(mold)return mold.heightPlates;
  }
  if (type === 'curve') {
    const curve = typeof kind === 'object' && curvedPart(kind);
    if (!curve) throw Error('Curved-piece height needs a supported exact mold size.');
    return curve.heightPlates;
  }
  if (type === 'sidebricktall') return 5;
  if (type === 'roundendplate') return 1;
  if (type === 'endstudplate' || type === 'edgeplate' || type === 'quartertile') return 1;
  if (type === 'bracket'||type==='invertedbracket') return 2.5;
  if(['halftile','quarterroundtile','offsetplate','roundjumper','triangletile'].includes(type))return 1;
  if (type === 'jumper' || isOutlinePart(type)) return 1;
  if (type === 'plate' || type === 'tile' || type === 'roundplate' || type === 'roundtile' || type === 'cornerplate' || type === 'cornertile') return 1;
  if (type === 'cheese') return 2;
  return 3;
}
export const studsOnTop = (type: PartType) => popularType(type)?POPULAR_MOLDS.find(m=>m.type===type)!.ports.some(p=>p.kind==='stud'&&p.normal[2]===1):!['halftile','quarterroundtile','triangletile','quartertile', 'tile', 'roundtile', 'cornertile', 'wheel', 'curve', 'cheese'].includes(type);

export function validRots(type: PartType) {
  if(popularType(type))return [0,90,180,270];
  if (DIRECTIONAL.includes(type) || SQUARE.includes(type)) return [0, 90, 180, 270];
  return type === 'wheel' ? [] : [0, 90];
}

export interface Placed { partId: string; x: number; y: number; z: number; rot: number; orientation?: Rotation }
export interface Step { caption: string; parts: Placed[] }
export interface Build { engine?: 'connections-v2'; name: string; description: string; steps: Step[]; requiredContacts?: RequiredContact[]; source?: { kind: 'library' | 'discovery' | 'display'; recipeId: string } }

/**
 * Footprint on the grid after rotation. Bricks, plates, tiles and arches lie long side left-to-right
 * at rot 0 (brick-2x4 covers 4 along x, 2 along y), which is how people and models picture them.
 * Directional parts keep their width along x and run along y at rot 0 (slope-4x2: 4 wide, run 2).
 */
export function footprint(k: PartKind, rot: number) {
  const popular=popularMold(k);
  if(popular){const fw=popular.widthLdu/20,fd=popular.depthLdu/20;return rot===90||rot===270?{fw:fd,fd:fw}:{fw,fd};}
  const mold=connectorMold(k)??specialMold(k);
  if(mold){const fw=mold.widthLdu/20,fd=mold.depthLdu/20;return rot===90||rot===270?{fw:fd,fd:fw}:{fw,fd};}
  if(k.type==='bracket')return rot===90||rot===270?{fw:1.2,fd:2}:{fw:2,fd:1.2};
  const longX = ['endstudplate','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','roundendplate'].includes(k.type) || k.type === 'jumper' || k.type === 'brick' || k.type === 'plate' || k.type === 'tile' || k.type === 'arch';
  const [x0, y0] = longX ? [k.d, k.w] : [k.w, k.d];
  return rot === 90 || rot === 270 ? { fw: y0, fd: x0 } : { fw: x0, fd: y0 };
}

/** Grid cells (x,y) covered by a placed part. */
export function cells(k: PartKind, p: Placed): [number, number][] {
  if (isOutlinePart(k.type)) return outlineCells(k, p);
  const { fw, fd } = footprint(k, p.rot);
  const out: [number, number][] = [];
  const gap = CORNER.includes(k.type) ? missingCorner(k, p) : null;
  for (let i = 0; i < fw; i++) for (let j = 0; j < fd; j++) {
    if (gap && p.x + i === gap[0] && p.y + j === gap[1]) continue;
    out.push([p.x + i, p.y + j]);
  }
  return out;
}

/**
 * The empty cell of an L-shaped corner part. rot turns it like everything else (front → right → back → left):
 * rot 0 back-right (x+1, y+1), 90 back-left (x, y+1), 180 front-left (x, y), 270 front-right (x+1, y).
 */
export function missingCorner(k: PartKind, p: Placed): [number, number] {
  const n = k.w - 1;
  switch (p.rot) {
    case 90: return [p.x, p.y + n];
    case 180: return [p.x, p.y];
    case 270: return [p.x + n, p.y];
    default: return [p.x + n, p.y + n];
  }
}

/**
 * The one-stud row on a directional part's high side (a slope's top studs, an inverted slope's
 * grip underneath). rot = the way the LOW edge faces: 0 front → high row is the back row (max y);
 * 90 right → min x; 180 back → min y; 270 left → max x.
 */
function highRow(k: PartKind, p: Placed): [number, number][] {
  const { fw, fd } = footprint(k, p.rot);
  return cells(k, p).filter(([x, y]) => {
    switch (p.rot) {
      case 0: return y === p.y + fd - 1;
      case 90: return x === p.x;
      case 180: return y === p.y;
      default: return x === p.x + fw - 1;
    }
  });
}

/** Cells that carry studs on top. */
export function studCells(k: PartKind, p: Placed): [number, number][] {
  if(connectorMold(k)||popularMold(k))return []; // Recessed/raised planes require the full port frames.
  const mold=specialMold(k);if(mold)return moldCells(k,p,mold.studs);
  if (isOutlinePart(k.type)) return outlineStudCells(k, p);
  if (!studsOnTop(k.type)) return [];
  const all = cells(k, p);
  // Wheel pair: only the 2x2 axle plate in the middle has studs; the wheels either side are round.
  if (k.type === 'wheels') return all.filter(([x, y]) => (p.rot === 0 ? x === p.x + 1 || x === p.x + 2 : y === p.y + 1 || y === p.y + 2));
  if (k.type === 'slope') return highRow(k, p);
  return all;
}

/** Arch ends: the two cells at either end of its long side, the only places it stands on. */
function archEnds(k: PartKind, p: Placed): [number, number][] {
  const { fw, fd } = footprint(k, p.rot);
  return cells(k, p).filter(([x, y]) => (fw >= fd ? x === p.x || x === p.x + fw - 1 : y === p.y || y === p.y + fd - 1));
}

/** Cells whose underside grips studs below. Inverted slopes grip only on their high row; arches only at the ends. */
export function bottomCells(k: PartKind, p: Placed): [number, number][] {
  if(connectorMold(k)||popularMold(k))return []; // No approximate legacy grid for these connector molds.
  const mold=specialMold(k);if(mold)return moldCells(k,p,mold.grips);
  if (isOutlinePart(k.type)) return outlineStudCells(k, p);
  if (curvedPart(k)) return gripCells(k,p).filter(g=>g[2]===p.z).map(([x,y])=>[x,y]);
  if (k.type === 'invslope') return highRow(k, p);
  if (k.type === 'arch') return archEnds(k, p);
  return cells(k, p);
}

/** Standard upright sockets only; physical arbitrary poses use connection frames. */
function moldCells(k:PartKind,p:Placed,ports:readonly {point:readonly [number,number,number]}[]):[number,number][] {
  const {fw,fd}=footprint(k,0);
  return ports.map(({point})=>{
    const x=(point[0]-10)/20,y=(point[1]-10)/20;
    if(p.rot===90)return [p.x+fd-1-y,p.y+x];
    if(p.rot===180)return [p.x+fw-1-x,p.y+fd-1-y];
    if(p.rot===270)return [p.x+y,p.y+fw-1-x];
    return [p.x+x,p.y+y];
  });
}

/** Grid-aligned socket coordinates, including the real raised row of curves. */
export function gripCells(k:PartKind,p:Placed):[number,number,number][] {
  const curve=curvedPart(k);
  if(!curve)return bottomCells(k,p).map(([x,y])=>[x,y,p.z]);
  return curve.grips.map(g=>{
    const x=Math.floor(g.point[0]/20),y=Math.floor(g.point[1]/20),z=p.z+g.point[2]/8;
    if(p.rot===90)return [p.x+k.d-1-y,p.y+x,z];
    if(p.rot===180)return [p.x+k.w-1-x,p.y+k.d-1-y,z];
    if(p.rot===270)return [p.x+y,p.y+k.w-1-x,z];
    return [p.x+x,p.y+y,z];
  });
}

/** Space a placed part fills, as (x, y, plate-level) voxels. An arch is hollow under its span except the top plate. */
export function voxels(k: PartKind, p: Placed): [number, number, number][] {
  const h = heightOf(k);
  const ends = k.type === 'arch' ? new Set(archEnds(k, p).map(([x, y]) => `${x},${y}`)) : null;
  const out: [number, number, number][] = [];
  const curveBottom=curvedPart(k)?new Map(gripCells(k,p).map(([x,y,z])=>[`${x},${y}`,z-p.z])):undefined;
  for (const [x, y] of cells(k, p)) {
    const from = curveBottom?.get(`${x},${y}`) ?? (ends && !ends.has(`${x},${y}`) ? h - 1 : 0);
    for (let dz = from; dz < h; dz++) out.push([x, y, p.z + dz]);
  }
  return out;
}

// ---------------------------------------------------------------- validator

export type IssueKind = 'invalid' | 'inventory' | 'overlap' | 'floating' | 'loose';
/** `parts` are the placed parts to blame (same object identity as in the build), used by trimToValid. */
export interface Issue { kind: IssueKind; message: string; parts: Placed[] }


/**
 * Deterministic physics + inventory check. Messages are written for the model to read:
 * they name the step, the part and its position.
 */
export function validate(build: Build, inventory: Record<string, number>): Issue[] {
  if(spatial(build))return validateConnections(build,inventory);
  const advanced=build.steps.flatMap(s=>s.parts).filter(p=>{const k=parsePartId(p.partId);return p.orientation!==undefined||!!k&&connectionOnly(k);});
  if(advanced.length)return [{kind:'invalid',message:'These parts and orientations require connections-v2 mode.',parts:advanced}];
  const num = new Map<Placed, number>();
  build.steps.flatMap(s => s.parts).forEach((p, i) => num.set(p, i));
  const at = (p: Placed) => `#${num.get(p)} ${p.partId} at (x=${p.x}, y=${p.y}, z=${p.z}, rot=${p.rot})`;
  const issues: Issue[] = [];
  const used: Record<string, number> = {};
  const occupied = new Map<string, number>(); // "x,y,z" → part index
  interface P { idx: number; step: number; p: Placed; k: PartKind; top: number; studs: Set<string>; cells: Set<string>; grip: Set<string> }
  const placed: P[] = [];
  const key = (x: number, y: number) => `${x},${y}`;

  /** The nearest spot (≤2 studs sideways, ≤2 bricks up/down) where a part would fit and sit on studs, given what's placed so far. */
  const shifts = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
  const nearest = (k: PartKind, p: Placed, self: number) => {
    let best: { x: number; y: number; z: number; cost: number } | null = null;
    for (const [dx, dy] of shifts) {
      const q0 = { ...p, x: p.x + dx, y: p.y + dy };
      const grip0 = gripCells(k, {...q0,z:0});
      const zs = new Set<number>(k.type === 'wheels' ? [0] : [0, ...placed.flatMap(o => grip0.filter(([x,y])=>o.studs.has(key(x,y))).map(([, ,dz])=>o.top-dz)).filter(z=>z>=0)]);
      for (const z of zs) {
        if (Math.abs(z - p.z) > 6) continue;
        const free = voxels(k, { ...q0, z }).every(([x, y, vz]) => { const o = occupied.get(`${x},${y},${vz}`); return o === undefined || o === self; });
        const held = z === 0 || placed.some(o => grip0.some(([x,y,dz])=>o.top===z+dz&&o.studs.has(key(x,y))));
        if (!free || !held) continue;
        const cost = Math.abs(dx) + Math.abs(dy) + Math.abs(z - p.z) / 3;
        if (!best || cost < best.cost) best = { x: q0.x, y: q0.y, z, cost };
      }
    }
    return best && best.cost <= 3 ? ` The nearest free spot where it would sit on studs is x=${best.x}, y=${best.y}, z=${best.z}.` : '';
  };

  build.steps.forEach((step, si) => {
    for (const p of step.parts) {
      const where = `Step ${si + 1}: ${at(p)}`;
      const k = parsePartId(p.partId);
      if (!k) { issues.push({ kind: 'invalid', message: `${where} is not a known part.`, parts: [p] }); continue; }
      if (!validRots(k.type).includes(p.rot)) { issues.push({ kind: 'invalid', message: `${where} has rot ${p.rot}; ${k.type}s take ${validRots(k.type).join('/')}.`, parts: [p] }); continue; }
      if (![p.x, p.y, p.z].every(Number.isInteger) || p.z < 0) { issues.push({ kind: 'invalid', message: `${where} needs whole-number coordinates with z ≥ 0.`, parts: [p] }); continue; }
      if (k.type === 'wheels' && p.z !== 0) { issues.push({ kind: 'invalid', message: `${where} is a wheel pair, which must stand on the ground at z=0.`, parts: [p] }); continue; }
      used[p.partId] = (used[p.partId] ?? 0) + 1;

      const h = heightOf(k);
      const cs = cells(k, p);
      const grip = gripCells(k, p);
      const vox = voxels(k, p);
      let clash: number | null = null;
      for (const [x, y, z] of vox) {
        const v = `${x},${y},${z}`;
        if (occupied.has(v) && clash === null) clash = occupied.get(v)!;
      }
      const idx = placed.length;
      if (clash !== null) {
        const o = placed[clash];
        issues.push({ kind: 'overlap', message: `${where} overlaps ${at(o.p)} from step ${o.step + 1}.${nearest(k, p, idx)}`, parts: [p] });
      } else {
        for (const [x, y, z] of vox) occupied.set(`${x},${y},${z}`, idx);
      }

      if (p.z > 0) {
        const supported = placed.some(o => grip.some(([x,y,z])=>o.top===z&&o.studs.has(key(x,y))));
        if (!supported) {
          // Say what IS under it, so the fix is concrete: drop it onto that, or move it over studs.
          const below = placed.filter(o => o.top <= p.z && cs.some(([x, y]) => o.cells.has(key(x, y)))).sort((a, b) => b.top - a.top)[0];
          const hint = below
            ? ` The highest part under its footprint is ${at(below.p)}, whose top is at z=${below.top}${below.studs.size ? '' : ' (no studs: it is a tile)'}.`
            : ' Nothing at all is under its footprint.';
          const gripNote = grip.length < cs.length ? ` It only grips on ${grip.map(([x, y,z]) => `(${x},${y},z=${z})`).join(' ')}.` : '';
          issues.push({ kind: 'floating', message: `${where} is floating: no studs directly under it at z=${p.z}.${gripNote}${hint}${nearest(k, p, idx)}`, parts: [p] });
        }
      }
      placed.push({
        idx, step: si, p, k, top: p.z + h,
        studs: new Set(studCells(k, p).map(([x, y]) => key(x, y))),
        cells: new Set(cs.map(([x, y]) => key(x, y))),
        grip: new Set(grip.map(g => g.join(','))),
      });
    }
  });

  // An open catalog lists every real part at 999, so a part missing from it was never made in that color.
  const open = Object.values(inventory).some(v => v >= 999);
  for (const [id, n] of Object.entries(used)) {
    const have = inventory[id] ?? 0;
    const extra = placed.filter(q => q.p.partId === id).slice(have).map(q => q.p);
    const message = open && !have
      ? `Uses ${n} × ${id}, but that shape was never made in that color. Use another color or shape.`
      : `Uses ${n} × ${id} but the bucket only has ${have}.`;
    if (n > have) issues.push({ kind: 'inventory', message, parts: extra });
  }

  // One piece: parts joined through studs must form a single group.
  const parent = placed.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const a of placed) for (const b of placed) {
    for (const c of a.studs) if (b.grip.has(`${c},${a.top}`)) { parent[find(a.idx)] = find(b.idx); break; }
  }
  const groups = new Map<number, P[]>();
  for (const p of placed) {
    const r = find(p.idx);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  if (groups.size > 1) {
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
    for (const g of sorted.slice(1)) {
      issues.push({
        kind: 'loose',
        message: `These ${g.length} part(s) are not attached to the main build and would fall off when it is lifted: ${g.map(q => at(q.p)).join('; ')}.`,
        parts: g.map(q => q.p),
      });
    }
  }
  return issues;
}

/**
 * Last resort after the repair rounds run out: drop the few parts the checker blames, re-check, and
 * repeat (dropping a part can leave the one above it floating). Gives up past `maxRemove` parts,
 * so this rescues near-misses without gutting a design.
 */
export function trimToValid(build: Build, inventory: Record<string, number>, maxRemove = 3): { build: Build; removed: number } | null {
  if(spatial(build))return null;
  let b: Build = structuredClone(build);
  let removed = 0;
  for (let pass = 0; pass <= maxRemove; pass++) {
    const issues = validate(b, inventory);
    if (!issues.length) return removed ? { build: b, removed } : null;
    const drop = new Set(issues.flatMap(i => i.parts));
    removed += drop.size;
    if (removed > maxRemove) return null;
    b = { ...b, steps: b.steps.map(st => ({ ...st, parts: st.parts.filter(p => !drop.has(p)) })).filter(st => st.parts.length) };
  }
  return null;
}

// ---------------------------------------------------------------- editing a build in place

/** One line per part, numbered in build order, for the model to refer to: "#12 step 3 brick-2x4-red x=4 y=2 z=6 rot=0". */
export function listing(build: Build) {
  let i = 0;
  return build.steps.flatMap((st, si) => st.parts.map(p => `#${i++} step ${si + 1} ${p.partId} x=${p.x} y=${p.y} z=${p.z} rot=${p.rot}${p.orientation?' orientation='+p.orientation.join(','):''}`)).join('\n');
}

export interface Edit { op: 'move' | 'remove' | 'add' | 'recolor'; index?: number; step?: number; partId?: string; x?: number; y?: number; z?: number; rot?: number }

/** Apply the model's edits by part number. Unknown indices are ignored; adds go at the end of their step. */
export function applyEdits(build: Build, edits: Edit[]): Build {
  if(spatial(build))throw Error('Connection builds must be edited through attachment operations.');
  const b: Build = structuredClone(build);
  const flat = b.steps.flatMap(st => st.parts);
  const drop = new Set<Placed>();
  for (const e of edits) {
    const p = e.index !== undefined ? flat[e.index] : undefined;
    if (e.op === 'remove' && p) drop.add(p);
    if (e.op === 'move' && p) {
      if (Number.isInteger(e.x)) p.x = e.x!;
      if (Number.isInteger(e.y)) p.y = e.y!;
      if (Number.isInteger(e.z)) p.z = e.z!;
      if (Number.isInteger(e.rot)) p.rot = e.rot!;
    }
    if (e.op === 'recolor' && p && e.partId) {
      // Same type and size, new color only: the structure can't change, so this can never break the build.
      const from = parsePartId(p.partId), to = parsePartId(e.partId);
      if (from && to && from.type === to.type && from.w === to.w && from.d === to.d) p.partId = e.partId;
    }
    if (e.op === 'add' && e.partId && [e.x, e.y, e.z].every(Number.isInteger)) {
      const si = Math.max(0, Math.min(b.steps.length, (e.step ?? b.steps.length) - 1));
      if (si === b.steps.length) b.steps.push({ caption: 'Finishing touches', parts: [] });
      b.steps[si].parts.push({ partId: e.partId, x: e.x!, y: e.y!, z: e.z!, rot: e.rot ?? 0 });
    }
  }
  b.steps = b.steps.map(st => ({ ...st, parts: st.parts.filter(p => !drop.has(p)) })).filter(st => st.parts.length);
  return b;
}

/** Parts still in the bucket after this build: inventory minus usage, zero-or-more. */
export function remaining(build: Build, inventory: Record<string, number>) {
  const left = { ...inventory };
  for (const p of build.steps.flatMap(s => s.parts)) left[p.partId] = (left[p.partId] ?? 0) - 1;
  return Object.fromEntries(Object.entries(left).filter(([, n]) => n > 0));
}

/**
 * Last-resort tidy-up: each part the checker BLAMED (floating or overlapping) is snapped to the nearest
 * spot (≤2 studs sideways, ≤2 bricks up or down) where it fits and sits on studs. Only blamed parts
 * move, never the parts around them, so it can't scramble a design. Parts it can't place stay put.
 */
export function settle(build: Build, inventory: Record<string, number>): { build: Build; moved: number } {
  if(spatial(build))return {build,moved:0};
  const blamed = new Set<number>();
  const num = new Map<Placed, number>();
  build.steps.flatMap(s => s.parts).forEach((p, i) => num.set(p, i));
  for (const i of validate(build, inventory)) if (i.kind === 'floating' || i.kind === 'overlap') for (const p of i.parts) blamed.add(num.get(p)!);
  const b: Build = structuredClone(build);
  let index = 0;
  const occupied = new Set<string>();
  const tops = new Map<number, Set<string>>(); // top height → stud cells at that height
  let moved = 0;
  const fits = (k: PartKind, p: Placed) => voxels(k, p).every(([x, y, z]) => !occupied.has(`${x},${y},${z}`));
  const supported = (k: PartKind, p: Placed) => p.z === 0 || gripCells(k, p).some(([x,y,z]) => tops.get(z)?.has(`${x},${y}`));
  const shifts = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];

  for (const st of b.steps) for (const p of st.parts) {
    const isBlamed = blamed.has(index++);
    const k = parsePartId(p.partId);
    if (!k || !validRots(k.type).includes(p.rot) || ![p.x, p.y, p.z].every(Number.isInteger)) continue;
    if (isBlamed && !(fits(k, p) && supported(k, p))) {
      let best: { x: number; y: number; z: number; cost: number } | null = null;
      for (const [dx, dy] of shifts) {
        const q0 = { ...p, x: p.x + dx, y: p.y + dy };
        const zs = new Set<number>(k.type === 'wheels' ? [0] : [p.z, 0]);
        if (k.type !== 'wheels') for (const [t, studs] of tops) for(const [x,y,dz] of gripCells(k,{...q0,z:0})) if(studs.has(`${x},${y}`)&&t>=dz) zs.add(t-dz);
        for (const z of zs) {
          if (Math.abs(z - p.z) > 6) continue;
          const q = { ...q0, z };
          if (!fits(k, q) || !supported(k, q)) continue;
          const cost = Math.abs(dx) + Math.abs(dy) + Math.abs(z - p.z) / 3;
          if (!best || cost < best.cost) best = { x: q.x, y: q.y, z, cost };
        }
      }
      if (best && best.cost <= 3) { p.x = best.x; p.y = best.y; p.z = best.z; moved++; }
    }
    for (const [x, y, z] of voxels(k, p)) occupied.add(`${x},${y},${z}`);
    const top = p.z + heightOf(k);
    if (!tops.has(top)) tops.set(top, new Set());
    for (const [x, y] of studCells(k, p)) tops.get(top)!.add(`${x},${y}`);
  }
  return { build: b, moved };
}

// ---------------------------------------------------------------- color consistency (advisory, not physics)

export interface ColorPatch { index: number; p: Placed; color: string; zoneColor: string; swap?: string }

/**
 * Real builders keep the OUTSIDE of a model in consistent colors and hide odd-colored bricks inside.
 * This finds visible parts that break up their row: a part on the outside whose color none of its
 * side-by-side neighbors share, while most of those neighbors agree on another color. Windows
 * (trans-clear), wheels and 1x1 details are left alone. Each patch says which same-shape part in the
 * area's color is still unused, if any. The model decides what's a deliberate detail.
 */
export function colorPatches(build: Build, inventory: Record<string, number>): ColorPatch[] {
  if(spatial(build))return [];
  const flat = build.steps.flatMap(st => st.parts);
  const vox = new Map<string, number>();
  const partVox: [number, number, number][][] = flat.map((p, i) => {
    const k = parsePartId(p.partId);
    if (!k) return [];
    const out: [number, number, number][] = [];
    for (const v of voxels(k, p)) { out.push(v); vox.set(`${v[0]},${v[1]},${v[2]}`, i); }
    return out;
  });
  const color = (i: number) => parsePartId(flat[i].partId)?.color ?? '';
  const left = remaining(build, inventory);
  const patches: ColorPatch[] = [];
  flat.forEach((p, i) => {
    const k = parsePartId(p.partId);
    if (!k || k.type === 'wheels' || isTrans(k.color) || (k.w === 1 && k.d === 1)) return;
    // Neighbors are side-by-side parts in the same row. Parts above and below don't count: a band of
    // another color (a base, a stripe, a lighthouse's rings) is a deliberate pattern, not a patch.
    let outside = false;
    const near = new Set<number>();
    for (const [x, y, z] of partVox[i]) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]) {
        const j = vox.get(`${x + dx},${y + dy},${z + dz}`);
        if (j === undefined) outside = true;
        else if (j !== i && dz === 0) near.add(j);
      }
    }
    if (!outside || near.size < 2) return;
    const tally: Record<string, number> = {};
    for (const j of near) tally[color(j)] = (tally[color(j)] ?? 0) + 1;
    if (tally[k.color]) return;
    const [zoneColor, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (n / near.size < 0.5 || isTrans(zoneColor)) return;
    const twin = partId(k.type, k.w, k.d, zoneColor as ColorName);
    patches.push({ index: i, p, color: k.color, zoneColor, swap: left[twin] ? twin : undefined });
  });
  return patches;
}

export const placedKey = (p: Placed) => `${p.partId}@${p.x},${p.y},${p.z},${p.rot}${p.orientation?','+p.orientation.join(','):''}`;

/**
 * Same-size substitutes in another color: the exact twin; three stacked plates for a brick; or two
 * half-length parts side by side. Each candidate is a list of parts that fills the same space.
 */
function substitutes(k: PartKind, p: Placed, color: ColorName): Placed[][] {
  const out: Placed[][] = [];
  const id = (t: PartType, w: number, d: number) => partId(t, w, d, color);
  out.push([{ ...p, partId: id(k.type, k.w, k.d) }]);
  if (k.type === 'brick') out.push([0, 1, 2].map(dz => ({ ...p, partId: id('plate', k.w, k.d), z: p.z + dz })));
  if (k.type === 'brick' || k.type === 'plate') {
    // Split the footprint in two along its longer side, and orient the halves to fill it exactly.
    const { fw, fd } = footprint(k, p.rot);
    const alongX = fw >= fd;
    const [sx, sy] = alongX ? [fw / 2, fd] : [fw, fd / 2];
    if (Number.isInteger(sx) && Number.isInteger(sy)) {
      const half = { partId: id(k.type, Math.min(sx, sy), Math.max(sx, sy)), rot: sx >= sy ? 0 : 90 };
      out.push([{ ...p, ...half }, { ...p, ...half, ...(alongX ? { x: p.x + sx } : { y: p.y + sy }) }]);
    }
  }
  return out;
}

/**
 * After the model's own review, match the remaining stray outside parts to their area's color using
 * same-size substitutes from the unused parts. Every swap is re-checked and kept only if the whole
 * build is still valid. Parts the model marked as deliberate details are never touched.
 */
export function matchColors(build: Build, inventory: Record<string, number>, keep: Set<string>): { build: Build; matched: number } {
  let b: Build = structuredClone(build);
  let matched = 0;
  for (let pass = 0; pass < 3; pass++) {
    const patches = colorPatches(b, inventory).filter(c => !keep.has(placedKey(c.p)));
    let changed = false;
    for (const c of patches) {
      const flat = b.steps.flatMap((st, si) => st.parts.map((p, pi) => ({ p, si, pi })));
      const at = flat.find(f => placedKey(f.p) === placedKey(c.p));
      const k = parsePartId(c.p.partId);
      if (!at || !k) continue;
      for (const sub of substitutes(k, at.p, c.zoneColor as ColorName)) {
        const cand: Build = structuredClone(b);
        cand.steps[at.si].parts.splice(at.pi, 1, ...sub);
        if (!validate(cand, inventory).length) { b = cand; matched++; changed = true; break; }
      }
    }
    if (!changed) break;
  }
  return { build: b, matched };
}

/** Bounding size of a build: x (left-right) and y (front-back) in studs, height in plates. */
export function buildSize(build: Build) {
  if(spatial(build)){const f=build.steps.flatMap(s=>s.parts).map(frame);if(!f.length)return {sizeX:0,sizeY:0,heightPlates:0};return {sizeX:(Math.max(...f.map(f=>f.bounds.max[0]))-Math.min(...f.map(f=>f.bounds.min[0])))/20,sizeY:(Math.max(...f.map(f=>f.bounds.max[1]))-Math.min(...f.map(f=>f.bounds.min[1])))/20,heightPlates:Math.max(...f.map(f=>f.bounds.max[2]))/8};}
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, top = 0;
  for (const p of build.steps.flatMap(s => s.parts)) {
    const k = parsePartId(p.partId);
    if (!k) continue;
    for (const [x, y] of cells(k, p)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    top = Math.max(top, p.z + heightOf(k));
  }
  return { sizeX: x1 - x0 + 1, sizeY: y1 - y0 + 1, heightPlates: top };
}

export function summarize(issues: Issue[]) {
  const n = (k: IssueKind) => issues.filter(i => i.kind === k).length;
  const bits: string[] = [];
  if (n('floating')) bits.push(`${n('floating')} floating`);
  if (n('overlap')) bits.push(`${n('overlap')} overlapping`);
  if (n('loose')) bits.push(`${n('loose')} loose ${n('loose') === 1 ? 'group' : 'groups'}`);
  if (n('inventory')) bits.push(`${n('inventory')} not in your bucket`);
  if (n('invalid')) bits.push(`${n('invalid')} invalid`);
  return bits.join(' · ');
}

export const partCount = (b: Build) => b.steps.reduce((s, st) => s + st.parts.length, 0);

// ---------------------------------------------------------------- prompt text

export const CONTRACT_TEXT = `COORDINATES (follow exactly):
- x runs left to right and y runs front to back (bigger y is farther from the viewer), both counted in studs. z is height counted in PLATE units.
- A placed part is {partId, x, y, z, rot}. (x, y) is the minimum corner of its footprint; z is the height of its BOTTOM face.
- A brick or slope is 3 plates tall. A plate or tile is 1 plate tall.
- Bricks, plates, tiles and arches: a partId reads type-AxB-color with A ≤ B. At rot 0 the LONG side runs left to right: the part covers B studs along x and A studs along y (brick-2x4 at rot 0 is 4 studs along x and 2 along y; brick-1x6 at rot 0 is 6 along x and 1 along y). At rot 90 the two swap. They take rot 0 or 90.
- Slopes: slope-WxR is W wide with a run of R=2. At rot 0 it covers W studs along x and 2 along y. Studs sit only on the one-stud-deep flat row at the high side; the sloped face has no studs. rot sets which way the LOW edge faces: 0 = front (low y), 90 = right (high x), 180 = back (high y), 270 = left (low x).
- Tiles are flat on top and have NO studs, so nothing can attach on top of a tile.
- wheels-4x2-COLOR is a PAIR of wheels on a 2x2 axle plate. At rot 0 the axle runs along x: it covers 4 studs along x (wheel, 2x2 axle plate, wheel) by 2 along y, is 3 plates tall, and MUST stand on the ground (z=0). Only its middle 2x2 (the axle plate) has studs; the wheels have none. At rot 90 the axle runs along y instead. A classic vehicle chassis is two wheel pairs at rot 0, a few studs apart front and back, with a plate 4 or more studs wide on top at z=3 resting on both axle plates and covering the wheels.`;

/** The shaping families. Only sent when the design may use them (the accurate mode, or a bucket that has them). */
export const SPECIALTY_TEXT = `SHAPING PARTS (same coordinates; rot works like slopes: 0/90/180/270 = the LOW or open side faces front/right/back/left):
- curve-WxR: exact curved mold, W wide with a run of R. At rot 0 it covers W along x and R along y. The 1x2 (11477) and 2x2 (15068) are 2 plates tall; the 1x3 (50950) is 3 plates tall. All have smooth tops with NO studs and stepped undersides. Lowest sockets occupy the front row on 1x2/2x2 and front two rows on 1x3; the back socket row is raised by one plate. Use connections-v2 and the actual local port table for raised sockets. For rounded noses, hoods, backs, shoulders, tails and smooth edges.
- cheese-1x1: small 30° wedge, 2 plates tall, NO studs. For eyes, claws, ears, teeth and fine tapers.
- invslope-WxR: inverted slope, 3 plates tall, with studs on its WHOLE flat top. Underneath it only rests on its one-stud-deep foot row on the HIGH side (rot 0: the back row, highest y); the rest of the underside slants up toward the low side, so it overhangs. For chins, bellies, cockpit undersides and anything that widens going up. Nothing may sit under the overhang.
- roundbrick-1x1 / roundbrick-2x2 (3 plates tall), roundplate-1x1 / roundplate-2x2 (1 plate), roundtile-1x1 (1 plate, NO studs), cone-1x1 (3 plates, narrowing to one stud on top): round versions of the square parts, same footprint, studs on top except the round tile. Use rot 0. For legs, columns, eyes, noses, lights, hubs, chimneys, tree trunks.
- cornerplate-2x2 / cornerbrick-2x2 / cornertile-2x2: L-shaped, three cells of a 2x2 (plate and tile 1 plate tall, brick 3; the corner tile has NO studs). The empty cell at rot 0 is the back-right one (x+1, y+1); rot 90 back-left (x, y+1); rot 180 front-left (x, y); rot 270 front-right (x+1, y). Nothing rests on or fills the empty cell. For turning corners in walls, outlines and rims, and for stepped or diagonal edges.
- arch-1xL (L = 4 or 6): 1 brick tall, long side along x at rot 0 like a brick. It stands ONLY on its two end studs (first and last); between them it is open underneath, solid only in its top plate (z+2), so parts below z+2 may sit inside the opening. Studs along its whole top. For doorways, windows, wheel arches, a gap between legs, bridges.
- wedgeleft-2x4 / wedgeright-2x4: one-plate-tall handed wedge plates, 2 along x and 4 along y at rot 0. Four studs only in the straight column (left x=0 for wedgeleft, right x=1 for wedgeright); the opposite edge tapers from 1 stud wide at the front to 2 at the back. The smooth margin supplies no extra studs. rot 0/90/180/270.
- quarterplate-4x4: one-plate-tall quarter-disc. At rot 0 the square corner is back-left, with straight left/back edges and a rounded front-right edge. Studs at local x=0..2,y=1..3 plus (0,0) and (3,3), 11 total. rot 0/90/180/270.
- endstudplate-1x4 (92593): one plate high, 4 along x and 1 along y at rot 0. Top studs only at local cells (0,0) and (3,0); four standard underside sockets. Smooth center is not a jumper. Do not substitute mold 41740.
- edgeplate-2x2 (33909): one plate high, two top studs only on the back +y row at rot 0; four underside sockets. Rotate to put the studded edge where needed.
- quartertile-2x2 (27925): one-plate-high smooth macaroni quarter-ring with a real inner cutout, no top studs, and two diagonal underside sockets at local cells (0,0) and (1,1). Use connections-v2 for actual curved clearance.
- roundtile-3x3 (67095): one-plate-high smooth round disk, no top studs. Five qualified standard underside sockets in a cross (center and four orthogonal neighbors); corner and offset clutch positions remain unqualified.
- Long parts: brick 1x10 1x12 1x16 2x10, plate up to 6x16, tiles 1x3 1x6 1x8 2x4.`;

export const SPECIALTY_TYPES: PartType[] = ['endstudplate', 'edgeplate', 'quartertile', 'roundendplate', 'wedgeleft', 'wedgeright', 'quarterplate', 'curve', 'invslope', 'cheese', 'roundbrick', 'roundplate', 'roundtile', 'cone', 'arch', 'cornerplate', 'cornertile', 'cornerbrick'];
