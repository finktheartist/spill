/** Qualified nominal exteriors and standard upright stud-grid sockets, in LDU.
 * x right, y back, z up; the body minimum is [0,0,0]. One plate is 8 LDU.
 * Sources: official LDraw 92593/33909/67095 (Magnus Forsberg), 27925
 * (Philippe Hurbain), 27925s01 (Gerald Lasser), and their pinned primitives;
 * CC BY 4.0. See the source-pinned tests for exact local files and hashes.
 *
 * Sections are convex XY polygons extruded through the nominal body height.
 * Socket walls, cosmetic grooves and clutch strength are not modeled. In
 * particular the quarter tile keeps its real through-cutout, and the round
 * tile has no sockets invented at underside tube centers. This table qualifies
 * standard stud-grid mounting, not every possible tube-bore/offset technique.
 * Photographic identity, manufacture in a color and inventory confirmation
 * remain caller-owned; this helper accepts no color or inventory evidence.
 */
import {expandedPlainMold} from './expanded-plain-molds';
import {expandedFlatMold} from './expanded-flat-molds';
export type SpecialMoldPoint = readonly [number, number, number];
export type SpecialMoldXY = readonly [number, number];
export interface SpecialMoldPort { readonly id: string; readonly point: SpecialMoldPoint }
export interface SpecialMold {
  readonly num: string;
  readonly widthLdu: number;
  readonly depthLdu: number;
  readonly heightPlates: number;
  /** Stud planes are z=8, outward +z; grip planes z=0, outward -z. */
  readonly studs: readonly SpecialMoldPort[];
  readonly grips: readonly SpecialMoldPort[];
  /** Counterclockwise outer-envelope boundary, including any concave cutout. */
  readonly outline: readonly SpecialMoldXY[];
  /** Genuine through-openings, excluded from both rendered body and sections. */
  readonly holes?: readonly (readonly SpecialMoldXY[])[];
  /** Render an existing hollow top stud; no extra bar/axle port is implied. */
  readonly openStuds?: boolean;
  /** Union of convex sections; never substitute the outline's bounding box. */
  readonly sections: readonly (readonly SpecialMoldXY[])[];
  /** Nominal circle for rendering; outline/sections retain the source facets. */
  readonly circle?: { readonly center: SpecialMoldXY; readonly radiusLdu: number };
}
type Shape = { type: string; w: number; d: number };

const points = (ps: readonly SpecialMoldXY[]): readonly SpecialMoldXY[] =>
  Object.freeze(ps.map(p => Object.freeze([p[0], p[1]] as [number, number])));
const ports = (kind: 'stud' | 'grip', ps: readonly SpecialMoldPoint[]): readonly SpecialMoldPort[] =>
  Object.freeze(ps.map(p => Object.freeze({
    id: `${kind}:${(p[0] - 10) / 20}:${(p[1] - 10) / 20}`,
    point: Object.freeze([...p] as [number, number, number]),
  })));
const grid = (xs: readonly number[], ys: readonly number[], z: number): SpecialMoldPoint[] =>
  xs.flatMap(x => ys.map(y => [x, y, z] as const));
function make(num: string, widthLdu: number, depthLdu: number,
  studs: readonly SpecialMoldPoint[], grips: readonly SpecialMoldPoint[],
  outline: readonly SpecialMoldXY[], sections: readonly (readonly SpecialMoldXY[])[] = [outline],
  circle?: { center: SpecialMoldXY; radiusLdu: number }): SpecialMold {
  return Object.freeze({ num, widthLdu, depthLdu, heightPlates: 1,
    studs: ports('stud', studs), grips: ports('grip', grips),
    outline: points(outline), sections: Object.freeze(sections.map(points)),
    ...(circle ? { circle: Object.freeze({ center: Object.freeze([...circle.center] as [number, number]), radiusLdu: circle.radiusLdu }) } : {}),
  });
}

// 92593: LDraw [X,Y,Z] -> [X+40,Z+10,8-Y]. This is NOT 41740:
// 92593 has three underside solid tubes; 41740 has different grooved cavities.
const endStudPlate = make('92593', 80, 20,
  [[10, 10, 8], [70, 10, 8]], grid([10, 30, 50, 70], [10], 0),
  [[0, 0], [80, 0], [80, 20], [0, 20]]);
// 33909: [X+20,Z+20,8-Y]. The two studs are on the high/+y edge.
const edgePlate = make('33909', 40, 40,
  [[10, 30, 8], [30, 30, 8]], grid([10, 30], [10, 30], 0),
  [[0, 0], [40, 0], [40, 40], [0, 40]]);

// Exact 48/1-4edge.dat coordinates, not a fitted circle or extra tessellation.
const quarterArc: readonly SpecialMoldXY[] = [
  [1, 0], [.9914, .1305], [.9659, .2588], [.9239, .3827], [.866, .5],
  [.7934, .6088], [.7071, .7071], [.6088, .7934], [.5, .866],
  [.3827, .9239], [.2588, .9659], [.1305, .9914], [0, 1],
];
const circleOutline = [0, 1, 2, 3].flatMap(q => quarterArc.slice(0, -1).map(([x, y]): SpecialMoldXY => {
  const [a, b] = q === 0 ? [x, y] : q === 1 ? [-y, x] : q === 2 ? [-x, -y] : [y, -x];
  return [30 + 30 * a, 30 + 30 * b];
}));
// 67095: [X+30,Z+30,8-Y]. Four stug4 tube centers are +/-10.
// The center is surrounded by four tubes; each cardinal socket has two tubes
// opposed by a rim section. Diagonal grid positions have only one neighboring
// tube and an OPEN diagonal rim: clearance there does not establish a socket.
// Qualify the cross-five, not nine sockets or four tube-center attachments.
const roundTile = make('67095', 60, 60, [],
  [[10, 30, 0], [30, 10, 0], [30, 30, 0], [30, 50, 0], [50, 30, 0]],
  circleOutline, [circleOutline], { center: [30, 30], radiusLdu: 30 });

// 27925: [X+10,Z+30,8-Y]. Arc center [0,40], radius 20..40;
// the empty inner quarter is the BACK-LEFT corner. Top source has a normal
// four-segment inner arc and a twelve-segment outer arc (adapter ring).
const outer = quarterArc.map(([x, y]): SpecialMoldXY => [40 * y, 40 - 40 * x]);
const inner = quarterArc.filter((_, i) => i % 3 === 0)
  .map(([x, y]): SpecialMoldXY => [20 * y, 40 - 20 * x]);
const quarterSections = Array.from({ length: 4 }, (_, i): readonly SpecialMoldXY[][] => {
  const a = i * 3;
  // The first quad is 1-4ring1.dat; the second is 48/1-4aring.dat.
  return [[outer[a], outer[a + 3], inner[i + 1], inner[i]],
    [outer[a + 3], outer[a], outer[a + 1], outer[a + 2]]];
}).flat();
const quarterTile = make('27925', 40, 40, [], [[10, 10, 0], [30, 30, 0]],
  [...outer, ...inner.slice().reverse()], quarterSections);

/** Exact shape keys only; no rotation aliases, mold substitution or size scaling. */
export function specialMold(k: Shape): SpecialMold | undefined {
  const expanded=expandedPlainMold(k)??expandedFlatMold(k);if(expanded)return expanded;
  if (k.type === 'endstudplate' && k.w === 1 && k.d === 4) return endStudPlate;
  if (k.type === 'edgeplate' && k.w === 2 && k.d === 2) return edgePlate;
  if (k.type === 'roundtile' && k.w === 3 && k.d === 3) return roundTile;
  if (k.type === 'quartertile' && k.w === 2 && k.d === 2) return quarterTile;
  return undefined;
}
