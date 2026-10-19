// Absorb the Rebrickable LEGO catalog: which of our shapes were really made in which of our colors.
// Writes src/data/rebrickable.json, a one-time snapshot the app reads (no network at runtime).
//
//   node scripts/catalog-sync.mjs            rebuild from the local copy (downloads it once if missing)
//   node scripts/catalog-sync.mjs --refresh  download a fresh copy first
//
// Run it again after adding shapes to part-numbers.json; the downloaded copy is reused.
// Data: Rebrickable (https://rebrickable.com/downloads/), free for any use with credit to Rebrickable.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(APP, '.cache', 'rebrickable');
const OUT = join(APP, 'src', 'data', 'rebrickable.json');
const FILES = ['colors', 'parts', 'part_categories', 'elements', 'inventory_parts'];

// Our colors → Rebrickable color ids, pinned by hand (matching by RGB alone picks Pearl White and Chrome Black).
const COLOR_IDS = {
  white: 15, black: 0, red: 4, blue: 1, yellow: 14, green: 2, 'bright-green': 10, lime: 27, orange: 25, tan: 19,
  'reddish-brown': 70, 'light-gray': 71, 'dark-gray': 72, 'dark-blue': 272, azure: 322, pink: 5, purple: 22, 'dark-purple': 85, 'trans-clear': 47,
  'dark-tan': 28, 'dark-red': 320, 'dark-brown': 308, nougat: 92, 'medium-nougat': 84, 'bright-light-orange': 191,
  'dark-orange': 484, 'dark-green': 288, 'sand-green': 378, 'dark-turquoise': 3, 'dark-azure': 321, 'medium-blue': 73,
  'bright-pink': 29, 'trans-red': 36,
};
// BrickLink numbers Rebrickable files under another number that isn't just a mold-letter variant.
const RENAMED = { 4073: '6141' };

async function download(refresh) {
  mkdirSync(CACHE, { recursive: true });
  for (const f of FILES) {
    const path = join(CACHE, `${f}.csv.gz`);
    if (existsSync(path) && !refresh) continue;
    const res = await fetch(`https://cdn.rebrickable.com/media/downloads/${f}.csv.gz`);
    if (!res.ok) throw new Error(`${f}.csv.gz: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${f}.csv.gz`);
  }
}

/** Rows of a gzipped CSV as objects (fields may be quoted, with "" for a quote). */
async function* rows(name) {
  const lines = createInterface({ input: createReadStream(join(CACHE, `${name}.csv.gz`)).pipe(createGunzip()), crlfDelay: Infinity });
  let head = null;
  for await (const line of lines) {
    const cells = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    if (!head) { head = cells; continue; }
    yield Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  }
}

await download(process.argv.includes('--refresh'));

const colorName = new Map(Object.entries(COLOR_IDS).map(([ours, id]) => [String(id), ours]));
const rbColors = new Map();
for await (const c of rows('colors')) rbColors.set(c.id, c.name);
const parts = new Map();
for await (const p of rows('parts')) parts.set(p.part_num, p.name);
const made = new Map(); // part_num → set of our color names it was made in
const allColors = new Map(); // part_num → count of all colors made
// A part was made in a color if LEGO lists an element for it, or it appears in any official set's inventory
// (the element list alone misses older combinations, like a 6x10 plate in bright green).
function madeIn(partNum, colorId) {
  if (!allColors.has(partNum)) allColors.set(partNum, new Set());
  allColors.get(partNum).add(colorId);
  const ours = colorName.get(colorId);
  if (!ours) return;
  if (!made.has(partNum)) made.set(partNum, new Set());
  made.get(partNum).add(ours);
}
for await (const e of rows('elements')) madeIn(e.part_num, e.color_id);
for await (const p of rows('inventory_parts')) madeIn(p.part_num, p.color_id);

/** Our BrickLink number → Rebrickable's: same number, a known rename, or the mold variant (3070 → 3070b) made in the most colors. */
function resolve(bl) {
  if (RENAMED[bl]) return RENAMED[bl];
  if (allColors.has(bl)) return bl;
  const variants = [...parts.keys()].filter(k => k.startsWith(bl) && /^[a-z]$/.test(k.slice(bl.length)));
  variants.sort((a, b) => (allColors.get(b)?.size ?? 0) - (allColors.get(a)?.size ?? 0));
  return variants[0] && allColors.has(variants[0]) ? variants[0] : null;
}

const numbers = JSON.parse(readFileSync(join(APP, 'src', 'data', 'part-numbers.json'), 'utf8'));
const shapes = {}, unresolved = [];
const ourColors = Object.keys(COLOR_IDS);
let combos = 0, real = 0;
for (const [shape, bl] of Object.entries(numbers)) {
  const rb = resolve(bl);
  if (!rb) { unresolved.push(`${shape} (${bl})`); continue; }
  const colors = ourColors.filter(c => made.get(rb)?.has(c));
  shapes[shape] = { bricklink: bl, rebrickable: rb, name: parts.get(rb), colors };
  combos += ourColors.length; real += colors.length;
}
// Every size LEGO really makes of the plain box parts ("Plate 6 x 10", "Tile 1 x 2 with Groove"), so the
// scanner can snap an impossible reading (a "5x10 plate") to the nearest real size.
const sizes = { brick: new Set(), plate: new Set(), tile: new Set() };
for (const [num, name] of parts) {
  const m = /^(Brick|Plate|Tile) (\d+) x (\d+)(?: with Groove)?$/.exec(name);
  if (!m || !allColors.has(num)) continue;
  const [a, b] = [+m[2], +m[3]].sort((x, y) => x - y);
  sizes[m[1].toLowerCase()].add(`${a}x${b}`);
}
const realSizes = Object.fromEntries(Object.entries(sizes).map(([t, s]) => [t, [...s].sort((p, q) => {
  const [a, b] = p.split('x').map(Number), [c, d] = q.split('x').map(Number); return a - c || b - d;
})]));
const stamp = new Date(statSync(join(CACHE, 'elements.csv.gz')).mtimeMs).toISOString().slice(0, 10);
writeFileSync(OUT, JSON.stringify({
  source: 'Rebrickable LEGO catalog database, https://rebrickable.com/downloads/',
  downloaded: stamp,
  colors: Object.fromEntries(Object.entries(COLOR_IDS).map(([k, id]) => [k, rbColors.get(String(id))])),
  colorIds: COLOR_IDS,
  shapes,
  realSizes,
}, null, 1) + '\n');
console.log(`rebrickable.json (${stamp}): ${Object.keys(shapes).length} shapes; ${real} of ${combos} shape-color combos were made, ${combos - real} never`);
console.log(`real sizes: ${Object.entries(realSizes).map(([t, s]) => `${t} ${s.length}`).join(', ')}`);
for (const [s, v] of Object.entries(shapes)) if (v.bricklink !== v.rebrickable) console.log(`  ${s}: BrickLink ${v.bricklink} = Rebrickable ${v.rebrickable}`);
if (unresolved.length) { console.error(`unresolved: ${unresolved.join(', ')}`); process.exitCode = 1; }
