import {popularMold} from './popular-molds';
// Real-world part numbers for the catalog, so an "accurate" build can come with a shopping list.
import { CATALOG, COLOR_NAMES, COLORS, parsePartId, partId, type Build, type ColorName, type PartKind, type PartType } from './bricks';
import partNumbers from '../data/part-numbers.json';
import rebrickable from '../data/rebrickable.json';

// BrickLink part numbers (checked against their catalog titles: classic parts 2026-10-06, shaping parts 2026-10-07).
// Slope, curve and inverted-slope sizes here are width x run; the catalog names them run x width.
const NUMBERS: Record<string, string> = partNumbers;
const NAMES: Partial<Record<PartType, string>> = {
  halftile:'Half-round tile',quarterroundtile:'Rounded corner tile',offsetplate:'Double-jumper plate',roundjumper:'Round center-stud plate',triangletile:'Triangular tile',headlight:'Headlight brick',invertedbracket:'Inverted bracket',
  endstudplate: 'Plate with two end studs', edgeplate: 'Plate with studs on one edge', quartertile: 'Curved macaroni tile',
  sidebrick: 'Brick with studs on one side', sidebricktall: 'Tall brick with four side studs', sidebrickadjacent: 'Brick with studs on two adjacent sides', sidebrickall: 'Brick with studs on four sides', roundendplate: 'Round-ended plate with open studs', jumper: 'Center-stud jumper plate', bracket: 'Down bracket 1 × 2 –',
  wedgeleft: 'Left wedge plate', wedgeright: 'Right wedge plate', quarterplate: 'Rounded corner plate',
  brick: 'Brick', plate: 'Plate', tile: 'Tile', slope: 'Slope 45°', curve: 'Curved slope', invslope: 'Inverted slope',
  cheese: 'Cheese slope', roundbrick: 'Round brick', roundplate: 'Round plate', roundtile: 'Round tile', cone: 'Cone', arch: 'Arch',
  cornerplate: 'Corner plate', cornertile: 'Corner tile', cornerbrick: 'Corner brick',
};
// curves and inverted slopes are named run × width like the plain slopes
const RUN_FIRST: PartType[] = ['slope', 'curve', 'invslope'];

/** A shape's display name, with or without a stored part number: "Plate 2 × 3", "Curved slope 3 × 1". */
export function shapeName(k: PartKind) {
  const exact=popularMold(k);if(exact)return exact.name;
  const size = RUN_FIRST.includes(k.type) ? `${k.d} × ${k.w}` : `${k.w} × ${k.d}`;
  return `${NAMES[k.type] ?? k.type} ${size}`;
}

export interface PartInfo { number: string; name: string; url: string; extra?: string }

export function partInfo(id: string): PartInfo | null {
  const k = parsePartId(id);
  if (!k) return null;
  if (k.type === 'wheels') {
    return {
      number: '4600', name: 'Wheel holder plate 2 × 2', url: 'https://www.bricklink.com/v2/catalog/catalogitem.page?P=4600',
      extra: 'plus 2 × wheel 4624 and 2 × tire 3641 for each pair',
    };
  }
  const exact=popularMold(k);if(exact){
    // Display the exact native/Rebrickable identity; a marketplace may use a
    // different catalog number for that mold. This is a link, not a scan alias.
    const crosswalk=(rebrickable.shapes as Record<string,{bricklink?:string}>)[`${k.type}-${k.w}x${k.d}`];
    return {number:exact.num,name:exact.name,url:`https://www.bricklink.com/v2/catalog/catalogitem.page?P=${crosswalk?.bricklink??exact.num}`};
  }
  const number = NUMBERS[`${k.type}-${k.w}x${k.d}`];
  if (!number) return null;
  const size = RUN_FIRST.includes(k.type) ? `${k.d} × ${k.w}` : `${k.w} × ${k.d}`;
  return { number, name: `${NAMES[k.type] ?? k.type} ${size}`, url: `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${number}` };
}

// ---------------------------------------------------------------- what was really made (Rebrickable)

/** Synced by scripts/catalog-sync.mjs from the Rebrickable catalog: the colors each of our shapes was made in. */
const MADE = rebrickable.shapes as Record<string, { rebrickable: string; colors: string[] }>;
/** Exact mold numbers only. Printed parts, related molds and element IDs never
 * inherit another mold's geometry. Ambiguous crosswalk entries fail closed. */
export function nativeKindForCatalog(num:string,color:string):PartKind|null {
  if(typeof num!=='string'||typeof color!=='string'||!Object.hasOwn(COLORS,color))return null;
  const entries=Object.entries(MADE).filter(([,v])=>v.rebrickable===num);
  if(entries.length!==1)return null;
  const [shape,value]=entries[0];if(!value.colors.includes(color))return null;
  const k=parsePartId(`${shape}-${color}`);
  return k&&k.type!=='wheels'&&CATALOG[k.type]?.includes(`${k.w}x${k.d}`)?k:null;
}
export const CATALOG_SOURCE = { name: 'Rebrickable', url: 'https://rebrickable.com/downloads/', updated: rebrickable.downloaded };

/** The colors a shape (e.g. "arch-1x6") was really made in, or null when the catalog doesn't cover it. */
export function madeIn(shape: string): ColorName[] | null {
  return (MADE[shape]?.colors as ColorName[] | undefined) ?? null;
}

const REAL_SIZES = rebrickable.realSizes as Record<string, string[]>;
/** Is this a size LEGO really makes? Only known for plain bricks, plates and tiles (anything else: true). */
export function isRealSize(type: PartType, w: number, d: number) {
  const r = REAL_SIZES[type];
  return !r || r.includes(`${w}x${d}`);
}

const rgb = (c: ColorName) => [1, 3, 5].map(i => parseInt(COLORS[c].slice(i, i + 2), 16));
/** The reading's color if that shape was made in it; otherwise the closest color it was made in (nougat → medium nougat). */
export function madeColor(type: PartType, w: number, d: number, color: ColorName): ColorName {
  const made = madeIn(`${type}-${w}x${d}`);
  if (!made?.length || made.includes(color)) return color;
  const [r, g, b] = rgb(color);
  const pool = made.filter(c => c.startsWith('trans-') === color.startsWith('trans-'));
  return (pool.length ? pool : made).reduce((best, c) => {
    const dist = (x: ColorName) => { const [r2, g2, b2] = rgb(x); return (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; };
    return dist(c) < dist(best) ? c : best;
  });
}

/** False only for a part the catalog says was never made in that color (a blue 8x8 plate). */
export function isMade(id: string): boolean {
  const k = parsePartId(id);
  if (!k || k.type === 'wheels' || k.type === 'wheel') return true;
  const colors = madeIn(`${k.type}-${k.w}x${k.d}`);
  return !colors || colors.includes(k.color);
}

/** For prompts: the catalog shapes that don't come in every color, and the colors they were never made in. */
export function neverMadeText(): string {
  // Per shape, whichever is shorter: the colors it was never made in, or the only colors it comes in.
  const lines = Object.entries(MADE)
    .map(([shape, v]) => [shape, COLOR_NAMES.filter(c => !v.colors.includes(c)), v.colors] as const)
    .filter(([, missing]) => missing.length)
    .map(([shape, missing, made]) => (made.length < missing.length ? `- ${shape}: ONLY ${made.join(', ')}` : `- ${shape}: not ${missing.join(', ')}`));
  return lines.length ? `Real parts only. Every shape comes in every listed color except as noted:\n${lines.join('\n')}` : '';
}

/** Every catalog part in every color it was really made in, effectively unlimited, merged over what the bucket has. */
export function unlimitedInventory(bucket: Record<string, number>): Record<string, number> {
  const all: Record<string, number> = {};
  for (const [type, sizes] of Object.entries(CATALOG) as [PartType, string[]][]) {
    if (['wheel','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','jumper','bracket'].includes(type)) continue;
    // New outline parts require a color catalog sync before use in unlimited designs.
    if (['wedgeleft','wedgeright','quarterplate'].includes(type) && !madeIn(`${type}-${sizes[0]}`)) continue;
    for (const size of sizes) {
      const [w, d] = size.split('x').map(Number);
      for (const c of COLOR_NAMES) { const id = partId(type, w, d, c); if (isMade(id)) all[id] = 999; }
    }
  }
  all[partId('wheels', 4, 2, 'black')] = 999;
  return { ...all, ...Object.fromEntries(Object.keys(bucket).filter(id=>!['sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','jumper','bracket'].includes(parsePartId(id)?.type??'')).map(id => [id, 999])) };
}

export interface ListLine { partId: string; count: number }

/** What a build uses, split into parts the bucket already covers and parts to get. */
export function shoppingList(build: Build, bucket: Record<string, number>) {
  const used: Record<string, number> = {};
  for (const p of build.steps.flatMap(s => s.parts)) used[p.partId] = (used[p.partId] ?? 0) + 1;
  const have: ListLine[] = [], get: ListLine[] = [];
  for (const [id, n] of Object.entries(used).sort(([a], [b]) => a.localeCompare(b))) {
    const own = Math.min(n, bucket[id] ?? 0);
    if (own) have.push({ partId: id, count: own });
    if (n - own) get.push({ partId: id, count: n - own });
  }
  const sum = (l: ListLine[]) => l.reduce((s, x) => s + x.count, 0);
  return { have, get, haveCount: sum(have), getCount: sum(get) };
}

/** Plain-text list for pasting into an order: "3001 Brick 2 × 4 · red × 6". */
export function listText(lines: ListLine[]) {
  return lines.map(l => {
    const i = partInfo(l.partId);
    const color = parsePartId(l.partId)?.color.replace('-', ' ');
    return `${i?.number ?? '?'}  ${i?.name ?? l.partId} · ${color} × ${l.count}${i?.extra ? ` (${i.extra})` : ''}`;
  }).join('\n');
}

/** Rebrickable's picture of a part in its color, served and cached by the dev server; null for a shape it doesn't list. */
export function photoUrl(id: string): string | null {
  const k = parsePartId(id);
  if (!k) return null;
  const shape = (rebrickable.shapes as Record<string, { rebrickable: string }>)[`${k.type}-${k.w}x${k.d}`];
  const color = (rebrickable.colorIds as Record<string, number>)[k.color];
  return shape && color !== undefined ? `/api/part-image/${encodeURIComponent(shape.rebrickable)}?c=${color}` : null;
}
