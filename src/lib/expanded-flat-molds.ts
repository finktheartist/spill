import type { SpecialMold } from './special-mold-geometry';

/** Source-qualified flat molds; x right, y back, z up, all coordinates LDU.
 * The width/depth are NOMINAL rotation envelopes. Outline and sections retain
 * actual source cuts, notably 35787's 37-LDU clipped body inside a 40-LDU frame.
 * Socket walls, grooves and internal stud holders remain conservative solids;
 * no tube-bore, bar or moving connection is qualified. Standard grid sockets
 * only: round molds deliberately omit their center tube-bore possibilities.
 * Sources: official LDraw, CC BY 4.0, pinned in the accompanying tests.
 * Authors: Max Martin Richter (14769), Owen Burgoyne (24246), Magnus Forsberg
 * (25269/34103), Philippe Hurbain (18674), Gerald Lasser (35787), and the
 * credited source-subpart/primitive authors retained in the pinned raw files.
 */
type XY = readonly [number, number];
type XYZ = readonly [number, number, number];
type Spec = { readonly type: string; readonly w: number; readonly d: number; readonly num: string };
export const FLAT_MOLD_SPECS: readonly Spec[] = Object.freeze([
  { type: 'roundtile', w: 2, d: 2, num: '14769' },
  { type: 'halftile', w: 1, d: 1, num: '24246' },
  { type: 'quarterroundtile', w: 1, d: 1, num: '25269' },
  { type: 'offsetplate', w: 1, d: 3, num: '34103' },
  { type: 'roundjumper', w: 2, d: 2, num: '18674' },
  { type: 'triangletile', w: 2, d: 2, num: '35787' },
].map(s => Object.freeze(s)));

const points = (ps: readonly XY[]): readonly XY[] => Object.freeze(ps.map(p => Object.freeze([...p] as [number, number])));
const ports = (kind: 'stud' | 'grip', ps: readonly XYZ[]) => Object.freeze(ps.map(p => Object.freeze({
  id: `${kind}:${(p[0] - 10) / 20}:${(p[1] - 10) / 20}`,
  point: Object.freeze([...p] as [number, number, number]),
})));
function make(num: string, widthLdu: number, depthLdu: number, outline: readonly XY[],
  studs: readonly XYZ[], grips: readonly XYZ[], round = false, openStuds = false): SpecialMold {
  const polygon = points(outline);
  return Object.freeze({ num, widthLdu, depthLdu, heightPlates: 1,
    outline: polygon, sections: Object.freeze([polygon]), studs: ports('stud', studs), grips: ports('grip', grips),
    ...(round ? { circle: Object.freeze({ center: Object.freeze([20, 20] as [number, number]), radiusLdu: 20 }) } : {}),
    ...(openStuds ? { openStuds: true } : {}),
  });
}

// Normal-resolution LDraw arc facets (1-4edge.dat / 2-4cylo.dat), not a fit.
const arc: readonly XY[] = [[1, 0], [.9239, .3827], [.7071, .7071], [.3827, .9239], [0, 1]];
const circle = [0, 1, 2, 3].flatMap(q => arc.slice(0, -1).map(([x, y]): XY => {
  const [a, b] = q === 0 ? [x, y] : q === 1 ? [-y, x] : q === 2 ? [-x, -y] : [y, -x];
  return [20 + 20 * a, 20 + 20 * b];
}));
const fourSockets: readonly XYZ[] = [[10, 10, 0], [10, 30, 0], [30, 10, 0], [30, 30, 0]];

// 14769: source [X,Y,Z] -> [X+20,Z+20,8-Y]. No top studs.
const roundTile = make('14769', 40, 40, circle, [], fourSockets, true);
// 24246: [X+10,Z+10,8-Y]. Rounded/front half and straight/back half;
// this is a D-shaped "half-circle" tile, not half a circular disk's envelope.
const halfArc: readonly XY[] = [...arc, ...arc.slice(0, -1).reverse().map(([x, y]): XY => [-x, y])];
const halfOutline: readonly XY[] = [
  ...halfArc.map(([x, y]): XY => [10 + 10 * x, 10 - 10 * y]).reverse(),
  [20, 20], [0, 20],
];
const halfTile = make('24246', 20, 20, halfOutline, [], [[10, 10, 0]]);
// 25269: [X+10,Z+10,8-Y]. Solid quarter disk, center at BACK-LEFT
// [0,20], radius20. Distinct from the hollow 27925 quarter-ring family.
const quarterOutline: readonly XY[] = [...arc.map(([x, y]): XY => [20 * y, 20 - 20 * x]), [0, 20]];
const quarterTile = make('25269', 20, 20, quarterOutline, [], [[10, 10, 0]]);
// 34103: [X+30,Z+10,8-Y]. Two source open studs at raw X=-10,+10.
// Their x=20,40 top planes are intentionally half-stud-offset from sockets.
// Connection-v2 is required; never round these points into legacy grid cells.
const offsetPlate = make('34103', 60, 20, [[0, 0], [60, 0], [60, 20], [0, 20]],
  [[20, 10, 8], [40, 10, 8]], [[10, 10, 0], [30, 10, 0], [50, 10, 0]], false, true);
// 18674: [X+20,Z+20,8-Y]. One open centered top stud; four standard
// underside sockets. Connection-v2 is required for the centered top position.
const roundJumper = make('18674', 40, 40, circle, [[20, 20, 8]], fourSockets, true, true);
// 35787: [X+20,Z+20,8-Y]. Keep source 3-LDU clipped tips and diagonal.
// Only the full cavity away from the diagonal is qualified as a grid socket;
// clearance at other centers or the truncated central tube is not a grip.
const triangleTile = make('35787', 40, 40, [[0, 0], [37, 0], [37, 3], [3, 37], [0, 37]], [], [[10, 10, 0]]);

const molds = [roundTile, halfTile, quarterTile, offsetPlate, roundJumper, triangleTile];
export function expandedFlatMold(k: { type: string; w: number; d: number }): SpecialMold | undefined {
  const index = FLAT_MOLD_SPECS.findIndex(s => k.type === s.type && k.w === s.w && k.d === s.d);
  return index < 0 ? undefined : molds[index];
}
