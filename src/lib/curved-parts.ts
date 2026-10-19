/** Nominal outer envelopes of the three qualified curved molds, in LDU.
 * x is across the width, y runs toward the high back, and z is up.
 * Pinned LDraw sources: 50950 (Orion Pobursky), 11477/15068 (Owen Burgoyne),
 * CC BY 4.0, study/sources/parts. Surface facets are retained except for the
 * small curves' high-face excess: raw 16.00006098 is nominalized to 16 LDU.
 * Only excess strictly below .0001 LDU at that high face is clamped.
 * These are outer envelopes, not a mesh of internal socket walls or cavities.
 */
export interface CurvedPartDefinition {
  ldrawId: string;
  heightPlates: number;
  profile: readonly (readonly [number, number])[];
  sections: readonly (readonly (readonly [number, number])[])[];
  grips: readonly { id: string; point: readonly [number, number, number] }[];
}

type Point = readonly [number, number];
type Shape = { type: string; w: number; d: number };

// RAW 48/1-8cyli.dat vertices under the transform in 11477.dat / 15068.dat.
// Keep the pinned values here; make() bounds the high-face rounding explicitly.
const smallTop: readonly Point[] = [
  [0, 3.9999], [5.564, 7.53157461], [11.716, 10.50988593],
  [18.352, 12.88268454], [25.36, 14.6036154],
  [32.616, 15.65239818], [40, 16.00006098],
];
// 50950.dat's five explicit top quads, converted from Y-down / top origin.
const longTop: readonly Point[] = [
  [0, 4], [10, 10.6], [21.73, 16.39],
  [34.12, 20.59], [46.95, 23.14], [60, 24],
];

const freezePoints = (points: readonly Point[]): readonly Point[] =>
  Object.freeze(points.map(p => Object.freeze([p[0], p[1]] as [number, number])));

function at(top: readonly Point[], y: number): Point {
  const existing = top.find(p => p[0] === y);
  if (existing) return existing;
  for (let i = 1; i < top.length; i++) {
    const a = top[i - 1], b = top[i];
    if (a[0] < y && y < b[0]) {
      return [y, a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0])];
    }
  }
  throw Error('Curve partition lies outside its source profile');
}

function make(ldrawId: string, width: number, top: readonly Point[], step: number,
  heights: readonly number[]): CurvedPartDefinition {
  const depth = top[top.length - 1][0];
  const heightPlates = ldrawId === '50950' ? 3 : 2, nominalHeight = heightPlates * 8;
  const outlineTop = top.map(([y, z]): Point => [y,
    y === depth && z > nominalHeight && z - nominalHeight < .0001 ? nominalHeight : z]);
  const section = (start: number, end: number, bottom: number) => freezePoints([
    [start, bottom], [end, bottom], at(outlineTop, end),
    ...outlineTop.filter(p => p[0] > start && p[0] < end).slice().reverse(), at(outlineTop, start),
  ]);
  const grips = heights.flatMap((z, row) => Array.from({ length: width / 20 }, (_, col) =>
    Object.freeze({ id: `grip:${col}:${row}`,
      point: Object.freeze([10 + col * 20, 10 + row * 20, z] as [number, number, number]) })));
  return Object.freeze({
    ldrawId, heightPlates,
    profile: freezePoints([[0, 0], [step, 0], [step, 8], [depth, 8], ...outlineTop.slice().reverse()]),
    sections: Object.freeze([section(0, step, 0), section(step, depth, 8)]),
    grips: Object.freeze(grips),
  });
}

const oneByTwo = make('11477', 20, smallTop, 20, [0, 8]);
const twoByTwo = make('15068', 40, smallTop, 20, [0, 8]);
const oneByThree = make('50950', 20, longTop, 40, [0, 0, 8]);

export function curvedPart(k: Shape): CurvedPartDefinition | undefined {
  if (k.type !== 'curve') return undefined;
  if (k.w === 1 && k.d === 2) return oneByTwo;
  if (k.w === 2 && k.d === 2) return twoByTwo;
  if (k.w === 1 && k.d === 3) return oneByThree;
  return undefined;
}

/** Union of the convex outer-envelope sections; socket cavities are not implied. */
export function curvedContains(k: Shape, p: readonly [number, number, number]): boolean {
  const d = curvedPart(k), epsilon = 1e-8;
  if (!d || p.length !== 3 || !p.every(Number.isFinite) ||
    p[0] < -epsilon || p[0] > k.w * 20 + epsilon) return false;
  return d.sections.some(section => section.every((a, i) => {
    const b = section[(i + 1) % section.length], y = b[0] - a[0], z = b[1] - a[1];
    return y * (p[2] - a[1]) - z * (p[1] - a[0]) >= -epsilon * Math.hypot(y, z);
  }));
}
