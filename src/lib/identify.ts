import {popularMold} from './popular-molds';
// Does a part really match the catalog shape the model named? The close-up check describes what it sees
// (studs, top surface, outline, height) before it names a type; this decides in code whether those
// features fit that shape exactly. Near misses (a jumper plate, a steeper slope, another curve profile)
// become named "other" parts instead of being counted as the wrong piece.
import { CATALOG, heightOf, type PartType } from './bricks';
import {specialMold} from './special-mold-geometry';
import {connectorMold} from './connector-mold-geometry';

export type StudLayout = 'grid' | 'center' | 'row' | 'side' | 'none' | 'other';
export type TopShape = 'flat' | 'slope45' | 'slope-shallow' | 'slope-steep' | 'curved' | 'curved-inverted' | 'dome' | 'other';
export type Outline = 'rectangle' | 'L' | 'round' | 'quarter-circle' | 'wedge' | 'capsule' | 'other';
export interface Features { studsOnTop?: number; studLayout?: StudLayout; topShape?: TopShape; outline?: Outline; heightPlates?: number; handedness?: 'left' | 'right' | 'unknown'; openStuds?: boolean }

export const STUD_LAYOUTS: StudLayout[] = ['grid', 'center', 'row', 'side', 'none', 'other'];
export const TOP_SHAPES: TopShape[] = ['flat', 'slope45', 'slope-shallow', 'slope-steep', 'curved', 'curved-inverted', 'dome', 'other'];
export const OUTLINES: Outline[] = ['rectangle', 'L', 'round', 'quarter-circle', 'wedge', 'capsule', 'other'];

/** What each catalog shape looks like from these features. studs(w, d) = studs on top; layout when it has any. */
interface Spec { outline: Outline; top: TopShape[]; studs: (w: number, d: number) => number; layout?: StudLayout }
const grid = (w: number, d: number) => w * d;
const none = () => 0;
const SPEC: Partial<Record<PartType, Spec>> = {
  brick: { outline: 'rectangle', top: ['flat'], studs: grid, layout: 'grid' },
  plate: { outline: 'rectangle', top: ['flat'], studs: grid, layout: 'grid' },
  tile: { outline: 'rectangle', top: ['flat'], studs: none },
  slope: { outline: 'rectangle', top: ['slope45'], studs: w => w, layout: 'row' },
  curve: { outline: 'rectangle', top: ['curved'], studs: none },
  invslope: { outline: 'rectangle', top: ['flat'], studs: grid, layout: 'grid' },
  cheese: { outline: 'rectangle', top: ['slope-shallow', 'slope45'], studs: none },
  roundbrick: { outline: 'round', top: ['flat'], studs: grid, layout: 'grid' },
  roundplate: { outline: 'round', top: ['flat'], studs: grid, layout: 'grid' },
  roundtile: { outline: 'round', top: ['flat', 'dome'], studs: none },
  cone: { outline: 'round', top: ['slope-steep', 'dome', 'other', 'flat'], studs: () => 1, layout: 'grid' },
  arch: { outline: 'rectangle', top: ['flat'], studs: grid, layout: 'grid' }, // from above an arch looks like a brick
  cornerplate: { outline: 'L', top: ['flat'], studs: () => 3, layout: 'grid' },
  cornerbrick: { outline: 'L', top: ['flat'], studs: () => 3, layout: 'grid' },
  cornertile: { outline: 'L', top: ['flat'], studs: none },
};

/** Shapes whose geometry the builder only knows in the catalog sizes (bricks, plates and tiles are plain boxes at any size). */
const FIXED_SIZES: PartType[] = ['slope', 'curve', 'invslope', 'cheese', 'roundbrick', 'roundplate', 'roundtile', 'cone', 'arch', 'cornerplate', 'cornerbrick', 'cornertile'];

/** standIn: it builds exactly like this shape but isn't the plain part (a brick with extra studs on its side). */
export type Verdict = { type: PartType; w: number; d: number; fixed?: string; standIn?: boolean } | { other: string };

/**
 * Check a named shape against the described features. Returns the shape (possibly corrected: plate ↔ tile ↔ brick
 * by studs and height, slope ↔ curve by top surface) or { other: reason }. Without features (older readings),
 * the name is trusted as before.
 */
export function checkFeatures(type: PartType, w: number, d: number, f: Features): Verdict {
  if(specialMold({type,w,d})||connectorMold({type,w,d})||popularMold({type,w,d}))return {other:'Confirm the exact special mold and color in the parts picker before counting it.'};
  if(['sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','bracket'].includes(type))return {other:'Confirm the exact connector part number in the parts picker before counting it.'};
  if(type==='jumper'){
    if(!CATALOG.jumper.includes(`${w}x${d}`)||f.heightPlates!==1||f.outline!=='rectangle'||f.topShape!=='flat'||f.studsOnTop!==1||f.studLayout!=='center')return {other:'Confirm a one-plate-high jumper with exactly one centered stud and its exact footprint.'};
    return {type,w,d};
  }
  if(type==='roundendplate'){
    if(w!==1||d!==2||f.heightPlates!==1||f.outline!=='capsule'||f.topShape!=='flat'||f.studsOnTop!==2||f.openStuds!==true)return {other:'Confirm the 1x2 capsule outline, two open studs and one-plate height (35480).'};
    return {type,w,d};
  }
  if (type === 'wedgeleft' || type === 'wedgeright' || type === 'quarterplate') {
    const round = type === 'quarterplate';
    const size = round ? w === 4 && d === 4 : w === 2 && d === 4;
    if (!size || f.heightPlates !== 1 || f.topShape !== 'flat' || f.outline !== (round ? 'quarter-circle' : 'wedge') || f.studsOnTop !== (round ? 11 : 4) || f.studLayout !== (round ? 'grid' : 'row')) return { other: 'Outline plate needs its exact size, flat top, height and stud layout confirmed' };
    if (!round && f.handedness !== (type === 'wedgeleft' ? 'left' : 'right')) return { other: 'Confirm the wedge hand from above with the narrow end forward' };
    return { type, w, d };
  }
  const spec = SPEC[type];
  if (!spec || f.outline === undefined || f.topShape === undefined || f.studsOnTop === undefined) return { type, w, d };
  const box = type === 'brick' || type === 'plate' || type === 'tile';

  // The plain box family sorts itself out by studs and height: a flat rectangle is a tile, plate or brick.
  if (box) {
    if (f.outline !== 'rectangle') return { other: `outline is ${f.outline}, not a rectangle` };
    if (f.topShape !== 'flat') return { other: `top is ${f.topShape}, not flat` };
    if (f.studLayout === 'center' && w * d > 1) return { other: 'studs set in the middle (a jumper), not one per cell' };
    // Studs on a side face: brackets and side-stud bricks. Brackets far outnumber the side-stud bricks that would
    // stack like plain ones, so these stay out of the counted parts (Technic holes are not studs: see the prompt).
    if (f.studLayout === 'side' || f.studLayout === 'other') return { other: `studs are ${f.studLayout === 'side' ? 'on a side face' : 'laid out some other way'}` };
    const h = f.heightPlates;
    const studs = f.studsOnTop;
    const want = w * d;
    // big grids are hard to count exactly; small ones must match
    const gridOk = studs > 0 && (want > 8 ? studs >= want * 0.5 : studs === want);
    if (studs > 0 && !gridOk) return { other: `${studs} studs on top, a ${w}x${d} has ${want}` };
    const next: PartType = studs === 0 ? 'tile' : h !== undefined && h >= 3 ? 'brick' : 'plate';
    if (studs === 0 && h !== undefined && h > 1) return { other: `smooth top but ${h} plates tall` };
    if (h !== undefined && h !== heightOf({type:next,w,d})) return { other: `${h} plates tall, a ${next} is ${heightOf({type:next,w,d})}` };
    return next === type ? { type, w, d } : { type: next, w, d, fixed: `${type} → ${next} (${studs ? 'studs' : 'no studs'}, ${h ?? '?'} plates)` };
  }

  // A sloped part named by its top: a curved top is a curve, a 45° slope with a stud row is a slope.
  let t = type;
  if (type === 'slope' && f.topShape === 'curved' && f.studsOnTop === 0) t = 'curve';
  else if (type === 'curve' && f.topShape === 'slope45' && f.studsOnTop > 0) t = 'slope';
  const s = SPEC[t]!;
  if (FIXED_SIZES.includes(t) && !CATALOG[t as keyof typeof CATALOG]?.includes(`${w}x${d}`)) return { other: `${t} ${w}x${d} isn't a size the builder knows` };
  if (f.outline !== s.outline) return { other: `outline is ${f.outline}, a ${t} is ${s.outline}` };
  if (!s.top.includes(f.topShape)) return { other: `top is ${f.topShape}, a ${t} is ${s.top.join(' or ')}` };
  const want = s.studs(w, d);
  if (f.studsOnTop !== want) return { other: `${f.studsOnTop} studs on top, a ${t} ${w}x${d} has ${want}` };
  if (want > 1 && s.layout && f.studLayout && f.studLayout !== s.layout) return { other: `studs are ${f.studLayout}, a ${t} has them ${s.layout}` };
  if (f.heightPlates !== undefined && f.heightPlates !== heightOf({type:t,w,d})) return { other: `${f.heightPlates} plates tall, a ${t} is ${heightOf({type:t,w,d})}` };
  return t === type ? { type, w, d } : { type: t, w, d, fixed: `${type} → ${t} (top is ${f.topShape})` };
}
