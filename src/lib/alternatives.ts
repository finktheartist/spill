// The most likely alternatives to a scanned reading, for the piece editor: what a scanner tends to confuse a
// part with. Same footprint at another height (plate / brick / tile), a stud or two longer or shorter, the
// closest colors, and the near-miss shapes (slope ↔ curve, corner plate ↔ corner brick). Only parts LEGO made.
import { CATALOG, COLORS, parsePartId, partId, type ColorName, type PartKind, type PartType } from './bricks';
import { isMade, isRealSize, madeIn } from './catalog';

const SIBLINGS: Partial<Record<PartType, PartType[]>> = {
  plate: ['brick', 'tile'], brick: ['plate', 'tile'], tile: ['plate', 'brick'],
  cornerplate: ['cornerbrick', 'cornertile'], cornerbrick: ['cornerplate', 'cornertile'], cornertile: ['cornerplate', 'cornerbrick'],
  slope: ['curve', 'cheese'], curve: ['slope', 'cheese'], cheese: ['slope', 'curve'], invslope: ['slope', 'brick'],
  roundplate: ['roundbrick', 'roundtile'], roundbrick: ['roundplate', 'cone'], roundtile: ['roundplate'], cone: ['roundbrick'],
  arch: ['brick'],
};
const BOX: PartType[] = ['brick', 'plate', 'tile'];

const rgb = (c: ColorName) => [1, 3, 5].map(i => parseInt(COLORS[c].slice(i, i + 2), 16));
const colorDist = (a: ColorName, b: ColorName) => { const [x, y] = [rgb(a), rgb(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

function known(type: PartType, w: number, d: number, color: ColorName): PartKind | null {
  const sizes = CATALOG[type as keyof typeof CATALOG];
  const ok = BOX.includes(type) ? isRealSize(type, w, d) : sizes?.includes(`${w}x${d}`);
  if (!ok) return null;
  const k = parsePartId(partId(type, w, d, color));
  return k && isMade(k.partId) ? k : null;
}

/** Up to `limit` alternatives, most likely first, never the reading itself. */
export function alternatives(k: PartKind, limit = 9): PartKind[] {
  const out: PartKind[] = [];
  const add = (x: PartKind | null) => { if (x && x.partId !== k.partId && !out.some(o => o.partId === x.partId)) out.push(x); };
  // 1. same footprint and color, another height or a near-miss shape
  for (const t of SIBLINGS[k.type] ?? []) add(known(t, k.w, k.d, k.color));
  // 2. a stud or two longer or shorter, and the other width, for the plain box parts
  if (BOX.includes(k.type)) {
    for (const dd of [1, -1, 2, -2]) add(known(k.type, k.w, k.d + dd, k.color));
    add(known(k.type, k.w === 1 ? 2 : 1, k.d, k.color));
  }
  // 3. the closest colors this shape was made in
  const made = madeIn(`${k.type}-${k.w}x${k.d}`) ?? (Object.keys(COLORS) as ColorName[]);
  made.filter(c => c !== k.color && c.startsWith('trans-') === k.color.startsWith('trans-'))
    .sort((a, b) => colorDist(k.color, a) - colorDist(k.color, b)).slice(0, 3)
    .forEach(c => add(known(k.type, k.w, k.d, c)));
  return out.slice(0, limit);
}
