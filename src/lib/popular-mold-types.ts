/** Data-only contract for exact, source-qualified nominal molds. Coordinates
 * are LDU, x right / y back / z up. These describe geometry and stud sockets;
 * they do not infer inventory identity, color manufacture, strength or motion. */
export type MoldPoint = readonly [number, number, number];
export type MoldXY = readonly [number, number];
export interface MoldPrism {
  readonly axis: 'x' | 'y' | 'z';
  readonly min: number;
  readonly max: number;
  /** axis x -> y,z; axis y -> x,z; axis z -> x,y. */
  readonly polygon: readonly MoldXY[];
  readonly holes?: readonly (readonly MoldXY[])[];
}
export interface MoldPort {
  readonly id: string;
  readonly kind: 'stud' | 'grip';
  readonly point: MoldPoint;
  readonly normal: MoldPoint;
  readonly open?: boolean;
}
/** A convex collision polyhedron, or triangulated exterior mesh for rendering.
 * Face indices refer to points; winding is counterclockwise from outside. */
export interface MoldHull {
  readonly points: readonly MoldPoint[];
  readonly faces: readonly (readonly number[])[];
}
export interface PopularMold {
  readonly num: string;
  readonly type: `mold${number}`;
  readonly w: number;
  readonly d: number;
  readonly name: string;
  readonly widthLdu: number;
  readonly depthLdu: number;
  readonly heightPlates: number;
  /** Convex prisms for collision; no holes and no fabricated empty sockets. */
  readonly solids: readonly MoldPrism[];
  readonly hulls?: readonly MoldHull[];
  /** Exterior drawing; may use concave polygons / true through holes. */
  readonly render: readonly MoldPrism[];
  readonly renderHulls?: readonly MoldHull[];
  readonly ports: readonly MoldPort[];
  readonly sources: readonly string[];
  readonly limitations: readonly string[];
}
