// Local search over every record in the cached Rebrickable snapshot in app/.cache/rebrickable, for the piece
// editor: GET /api/parts?q=jumper%201x2&color=tan → the matching parts, most common first, each with an image.
// GET /api/part-image/<num>?c=<rebrickable color id> → Rebrickable's rendered image of that part, fetched once and
// kept in app/.cache/part-images (Rebrickable provides these LDraw renders for anyone to use).
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {normalizeCatalogQuery,searchPartsCatalog,type CatalogPart,type PartsCatalog} from './parts-search';
export {searchPartsCatalog} from './parts-search';
export type {CatalogPart,CatalogMetadata,PartsCatalog} from './parts-search';

const CACHE = resolve(process.cwd(), '.cache/rebrickable');
export interface CatalogPaths {cacheDir?:string;snapshotPath?:string}
const IMAGES = resolve(CACHE, '../part-images');

async function* rows(cacheDir:string,name: string) {
  const input=createReadStream(resolve(cacheDir, `${name}.csv.gz`)),gunzip=createGunzip();
  // Forward file errors to the consumed stream instead of an unhandled emitter.
  input.on('error',error=>gunzip.destroy(error));
  const lines = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  let head: string[] | null = null;
  let cells:string[]=[],cur='',q=false;
  try {
  for await (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    if(q){cur+='\n';continue;}
    cells.push(cur);
    if (!head) head=cells.map(h=>h.replace(/^\uFEFF/,''));
    else if(cells.length!==head.length)throw Error(`Malformed ${name} CSV row`);
    else yield Object.fromEntries(head.map((h, i) => [h, cells[i]])) as Record<string, string>;
    cells=[];cur='';
  }
  if(q)throw Error(`Unclosed quoted field in ${name} CSV`);
  } finally {lines.close();input.destroy();gunzip.destroy();}
}

/** Offline only: every raw part row stays searchable, including decorated and
 * non-System categories. A native shape is assigned only to its exact pinned
 * Rebrickable part number; a similar name/category/variant never grants one. */
export async function loadPartsCatalog({cacheDir=CACHE,snapshotPath=resolve(process.cwd(),'src/data/rebrickable.json')}:CatalogPaths={}): Promise<PartsCatalog> {
  const cats = new Map<string, string>();
  for await (const c of rows(cacheDir,'part_categories')) cats.set(c.id, c.name);
  // how often each part appears in official sets, and in which colors (most used first)
  const pop = new Map<string, number>();
  const colorUse = new Map<string, Map<number, number>>();
  const use = (num: string, color: string, n: number) => {
    if (!colorUse.has(num)) colorUse.set(num, new Map());
    const m = colorUse.get(num)!; m.set(Number(color), (m.get(Number(color)) ?? 0) + n);
  };
  for await (const r of rows(cacheDir,'inventory_parts')) {
    const n = Number(r.quantity) || 1;
    pop.set(r.part_num, (pop.get(r.part_num) ?? 0) + n);
    use(r.part_num, r.color_id, n);
  }
  const elementsOf = new Map<string, string[]>(); // LEGO element ids per part, for product photos
  for await (const e of rows(cacheDir,'elements')) {
    use(e.part_num, e.color_id, 0);
    if (!elementsOf.has(e.part_num)) elementsOf.set(e.part_num, []);
    elementsOf.get(e.part_num)!.push(e.element_id);
  }
  // our buildable shapes, by Rebrickable number
  const ours = new Map<string, string>();
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { downloaded?:string;colorIds:Record<string,number>;shapes: Record<string, { rebrickable: string }> };
  for (const [shape, v] of Object.entries(snap.shapes)) {
    if(ours.has(v.rebrickable)&&ours.get(v.rebrickable)!==shape)throw Error('Ambiguous native part-number mapping');
    ours.set(v.rebrickable, shape);
  }
  const out: CatalogPart[] = [];
  for await (const p of rows(cacheDir,'parts')) {
    const category = cats.get(p.part_cat_id) ?? '';
    if(!p.part_num||!p.name)throw Error('Catalog part row is missing its identifier or name');
    const colors = [...(colorUse.get(p.part_num) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1]).map(([c]) => c).filter(c => c >= 0);
    const shape = ours.get(p.part_num);
    const identifiers=[p.part_num,...(elementsOf.get(p.part_num)??[])];
    out.push({ num: p.part_num, name: p.name, category, pop: pop.get(p.part_num) ?? 0, shape, look: shape ?? null, words: normalizeCatalogQuery(`${p.name} ${identifiers.join(' ')} ${category}`), colors, elements: (elementsOf.get(p.part_num) ?? []).slice(-4).reverse(),identifiers });
  }
  out.sort((a, b) => b.pop - a.pop || a.num.localeCompare(b.num));
  const snapshotDate=typeof snap.downloaded==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(snap.downloaded)?snap.downloaded:null;
  return {parts:out,colorIds:snap.colorIds,catalog:{totalParts:out.length,searchableParts:out.length,nativeParts:out.filter(p=>p.shape!==undefined).length,
    snapshotDate,snapshotDateSource:snapshotDate?'local-downloaded-label':'unknown',freshness:'local-snapshot-not-live-verified',excludes:[],nativeMapping:'exact-rebrickable-part-number'}};
}

/**
 * An image of a part: Rebrickable's render in the asked-for color, else a render in one of the part's usual colors,
 * else LEGO's product photo of one of its elements (new parts often have no render yet), else the same for a close
 * variant of the part (3081c01 "with glass" → 3081, 3861b → 3861a). Fetched once and kept, including "there is none",
 * so nothing is fetched twice. This legacy image fallback is not evidence of an
 * exact mold match; only the catalog's explicit shape mapping grants a native ID.
 */
async function partImage(num: string, color: number, res: ServerResponse,source:()=>Promise<PartsCatalog>) {
  const dir = resolve(IMAGES, String(color));
  const base = resolve(dir, num.replace(/[^A-Za-z0-9._-]/g, '_'));
  const send = (path: string, type: string) => {
    res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'public, max-age=604800'); res.end(readFileSync(path));
  };
  if (existsSync(`${base}.png`)) return send(`${base}.png`, 'image/png');
  if (existsSync(`${base}.jpg`)) return send(`${base}.jpg`, 'image/jpeg');
  if (existsSync(`${base}.none`)) { res.statusCode = 404; res.end(); return; }
  const all = (await source()).parts;
  const part = all.find(p => p.num === num);
  const ways = (p: CatalogPart | undefined, n: string, colors: number) => [
    ...[color, ...(p?.colors ?? []).filter(c => c !== color).slice(0, colors)].map(c => ({ url: `https://cdn.rebrickable.com/media/parts/ldraw/${c}/${encodeURIComponent(n)}.png`, ext: 'png' })),
    ...(p?.elements ?? []).map(id => ({ url: `https://cdn.rebrickable.com/media/parts/elements/${id}.jpg`, ext: 'jpg' })),
  ];
  // variants share the leading number: 3081, 3081a, 3081bc01 (not 30814, a different part)
  const stem = /^[a-z]*\d+/i.exec(num)?.[0];
  const variants = stem ? all.filter(p => p.num !== num && new RegExp(`^${stem}([a-z]|$)`, 'i').test(p.num))
    .sort((a, b) => Number(b.num === stem) - Number(a.num === stem) || b.pop - a.pop).slice(0, 3) : [];
  const tries = [...ways(part, num, 4), ...variants.flatMap(v => ways(v, v.num, 1))];
  mkdirSync(dir, { recursive: true });
  for (const t of tries) {
    const r = await fetch(t.url).catch(() => null);
    if (r?.ok && (r.headers.get('content-type') ?? '').startsWith('image/')) {
      writeFileSync(`${base}.${t.ext}`, Buffer.from(await r.arrayBuffer()));
      return send(`${base}.${t.ext}`, t.ext === 'png' ? 'image/png' : 'image/jpeg');
    }
  }
  writeFileSync(`${base}.none`, '');
  res.statusCode = 404; res.end();
}

export function partsApi(paths:CatalogPaths={}) {
  let catalog:Promise<PartsCatalog>|null=null;
  const source=()=>catalog??=loadPartsCatalog(paths).catch(error=>{catalog=null;throw error;});
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const img = /^\/api\/part-image\/([A-Za-z0-9._-]+)\?c=(\d+)$/.exec(req.url ?? '');
    if (img) { try { await partImage(img[1], Number(img[2]), res,source); } catch { res.statusCode = 502; res.end(); } return; }
    const url=new URL(req.url??'/', 'http://x');
    if (url.pathname!=='/api/parts') return next();
    const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if(req.method!=='GET'&&req.method!==undefined){res.setHeader('Allow','GET');return send(405,{error:'Use GET /api/parts'});}
    if (!existsSync(resolve(paths.cacheDir??CACHE, 'parts.csv.gz'))) return send(503, { error: 'No local catalog copy is available' });
    try {
      send(200,searchPartsCatalog(await source(),url.searchParams));
    } catch (e) {
      send(e instanceof RangeError?400:500, { error: (e as Error).message });
    }
  };
}
