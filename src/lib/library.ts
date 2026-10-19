import type { ComponentSummary } from './component-kit';
import { CATALOG, COLORS, gripCells, heightOf, studCells, footprint, parsePartId, type Build, type ColorName, type Placed } from './bricks';
import { constructionIssues } from './construction';
import { RECIPES, type Recipe, type RecipePart, type Role } from './library-recipes';
import { isMade, shoppingList, type ListLine } from './catalog';
import { strategyForRecipe, type ConstructionFamily } from './construction-families';
import { MIN_FINISHED_PARTS } from './finished-build';

export interface FeatureAllocation { name: string; kind: 'structure' | 'identity' | 'finish'; parts: Record<string, number>; missing: ListLine[] }
export interface NearFit { match: LibraryMatch; missing: ListLine[]; missingCount: number; ownedCount: number; features: FeatureAllocation[] }

/** Prefer a complete structure over a smaller shopping list that lacks a support. */
export function compareNearFits(a: NearFit, b: NearFit): number {
  const impact = (fit: NearFit) => fit.features.reduce((n, f) => n + f.missing.reduce((sum, p) => sum + p.count, 0) * ({ structure: 20, identity: 10, finish: 1 }[f.kind]), 0);
  return impact(a) - impact(b) || a.missingCount - b.missingCount || a.match.substitutions - b.match.substitutions;
}

export interface LibraryMatch {
  silhouettePlan?: { profile: string; outline: string; landmarks: string[] };
  componentPlan?: ComponentSummary;
  recipeId: string; label?: string; animalBase?: Recipe['animalBase']; build: Build; palette: Partial<Record<Role, ColorName>>;
  substitutions: number; parts: Record<string, number>;
  features?: FeatureAllocation[];
  colorMode?: 'coherent' | 'mixed'; layeredSubstitutions?: number;
}
export interface LibraryEntry {
  id: string; name: string; pitch: string; features: string[]; example: Build; match: LibraryMatch | null;
  category?: Recipe['category']; animalBase?: Recipe['animalBase']; variants?: number; matches?: LibraryMatch[]; saved?: boolean;
  strategy?: ConstructionFamily; near?: NearFit; terms?: string[];
}

/** Reserve identity features first, then supports, then finish. Every actual part is charged once. */
export function featureAllocation(recipe: Recipe, build: Build, stock: Record<string, number>): FeatureAllocation[] {
  const groups = new Map<string, FeatureAllocation>();
  build.steps.forEach((step, i) => {
    const feature = recipe.steps[i].feature ?? { name: recipe.steps[i].caption, kind: 'structure' as const };
    const key = `${feature.kind}:${feature.name}`;
    if (!groups.has(key)) groups.set(key, { ...feature, parts: {}, missing: [] });
    const group = groups.get(key)!;
    for (const p of step.parts) group.parts[p.partId] = (group.parts[p.partId] ?? 0) + 1;
  });
  const priority = { identity: 0, structure: 1, finish: 2 };
  const result = [...groups.values()].sort((a, b) => priority[a.kind] - priority[b.kind]);
  const left = { ...stock };
  for (const group of result) for (const [id, n] of Object.entries(group.parts)) {
    const available = Number.isSafeInteger(left[id]) ? Math.max(0, left[id]) : 0;
    if (n > available) group.missing.push({ partId: id, count: n - available });
    left[id] = Math.max(0, available - n);
  }
  return result;
}
export function buildCounts(build: Build): Record<string, number> {
  const used: Record<string, number> = {};
  for (const p of build.steps.flatMap(s => s.parts)) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
}

/** A reference version for browsing; never presented as a match to the user's pieces. */
export function recipeExample(recipe: Recipe): Build {
  return {
    name: recipe.name, description: recipe.pitch, source: { kind: 'library', recipeId: recipe.id },
    steps: recipe.steps.map(s => ({ caption: s.caption, parts: s.parts.map(p => ({
      partId: `${p.shape}-${recipe.palette[p.role]!}`, x: p.x, y: p.y, z: p.z, rot: p.rot,
    })) })),
  };
}

function usableStock(stock: Record<string, number>) {
  return Object.fromEntries(Object.entries(stock).filter(([id, n]) => {
    const k = parsePartId(id);
    return Number.isSafeInteger(n) && n > 0 && k && k.type !== 'wheel' &&
      (k.type === 'wheels' ? k.w === 4 && k.d === 2 : CATALOG[k.type]?.includes(`${k.w}x${k.d}`));
  }));
}

// Prefer one coherent color per role. Adaptive matches retain identity colors and actual contrast.
const dark = new Set<ColorName>(['black', 'dark-gray', 'dark-blue', 'dark-brown']);
const light = new Set<ColorName>(['white', 'light-gray', 'tan', 'yellow', 'bright-light-orange']);
function roleAllows(role: Role, color: ColorName) {
  if (role === 'foliage') return ['green', 'bright-green', 'dark-green', 'sand-green', 'lime', 'yellow', 'bright-light-orange', 'orange', 'red', 'dark-red'].includes(color);
  if (role === 'glass') return color.startsWith('trans-');
  if (color.startsWith('trans-')) return false;
  return role === 'dark' ? dark.has(color) : role === 'light' ? light.has(color) : true;
}
const luminance = (c: ColorName) => {
  const rgb = [1, 3, 5].map(i => parseInt(COLORS[c].slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
function distinct(a: ColorName, b: ColorName) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) >= 1.8;
}

/**
 * Exact-volume replacements: split rectangles, tile to plate, and (in adaptive mode)
 * one ordinary brick to three supported plate layers. Never clip oversized pieces,
 * use smooth tiles as internal supports, or approximate the geometry of a shaped part.
 */
function choices(slot: RecipePart, color: ColorName, have: Record<string, number>, adapt = false, mixedColors = false): Placed[][] {
  const id = `${slot.shape}-${color}`, k = parsePartId(id)!;
  const exact: Placed[] = [{ partId: id, x: slot.x, y: slot.y, z: slot.z, rot: slot.rot }];
  if (!['brick', 'plate', 'tile'].includes(k.type)) return have[id] ? [exact] : [];
  const { fw, fd } = footprint(k, slot.rot);
  const pool = Object.keys(have).flatMap(partId => {
    const part = parsePartId(partId)!;
    if (!(mixedColors ? roleAllows(slot.role, part.color) : part.color === color) || !(part.type === k.type || (k.type === 'tile' && part.type === 'plate') || (adapt && k.type === 'brick' && part.type === 'plate'))) return [];
    return [0, 90].flatMap(rot => {
      if (rot === 90 && part.w === part.d) return [];
      const { fw: w, fd: d } = footprint(part, rot);
      return w <= fw && d <= fd ? [{ partId, rot, w, d, area: w * d, h: heightOf(part) }] : [];
    });
  }).sort((a, b) => b.area * b.h - a.area * a.h || (adapt ? Number(parsePartId(b.partId)!.color === color) - Number(parsePartId(a.partId)!.color === color) || (have[b.partId] ?? 0) - (have[a.partId] ?? 0) : 0) || a.partId.localeCompare(b.partId));
  const out: Placed[][] = [];
  const occupied = new Set<string>(), left = { ...have }, parts: Placed[] = [];
  let nodes = 0;
  const pack = () => {
    if (++nodes > (adapt ? 1000 : 400) || out.length >= (adapt ? 32 : 18)) return;
    let cell: [number, number, number] | undefined;
    for (let z = 0; z < heightOf(k) && !cell; z++) for (let y = 0; y < fd && !cell; y++) for (let x = 0; x < fw; x++) if (!occupied.has(`${x},${y},${z}`)) { cell = [x, y, z]; break; }
    if (!cell) { out.push([...parts]); return; }
    if (parts.length >= (adapt ? 12 : 6)) return;
    const [x, y, z] = cell;
    for (const q of pool) {
      if (!left[q.partId] || x + q.w > fw || y + q.d > fd || z + q.h > heightOf(k)) continue;
      const cells: string[] = [];
      for (let dz = 0; dz < q.h; dz++) for (let dy = 0; dy < q.d; dy++) for (let dx = 0; dx < q.w; dx++) cells.push(`${x + dx},${y + dy},${z + dz}`);
      if (cells.some(c => occupied.has(c))) continue;
      cells.forEach(c => occupied.add(c)); left[q.partId]--;
      parts.push({ partId: q.partId, x: slot.x + x, y: slot.y + y, z: slot.z + z, rot: q.rot });
      pack(); parts.pop(); left[q.partId]++; cells.forEach(c => occupied.delete(c));
    }
  };
  pack();
  return out.sort((a, b) => a.length - b.length || Number(b[0].partId === id) - Number(a[0].partId === id));
}

/** Bounded search: failure means no validated version found, never permission to change the design. */
export interface MatchContext { have: Record<string, number>; choices: Map<string, Placed[][]> }
export function matchContext(stock: Record<string, number>): MatchContext { return { have: usableStock(stock), choices: new Map() }; }
export function matchRecipe(recipe: Recipe, stock: Record<string, number>, context = matchContext(stock), mode: 'auto' | 'coherent' | 'adaptive' = 'auto'): LibraryMatch | null {
  const coherent = mode !== 'adaptive' ? solveRecipe(recipe, stock, context, 0) : null;
  return coherent ?? (mode !== 'coherent' ? adaptiveRecipe(recipe, stock, context) : null);
}
const adaptiveRecipe = (recipe: Recipe, stock: Record<string, number>, context: MatchContext) =>
  solveRecipe(recipe, stock, context, 0, true) ?? solveRecipe(recipe, stock, context, 0, true, false);

/** Bounded near-fit search. Extra parts remain explicit and can never become a ready match. */
export function closestRecipe(recipe: Recipe, stock: Record<string, number>, limit = 6, context = matchContext(stock)): NearFit | null {
  const count = recipe.steps.reduce((n, s) => n + s.parts.length, 0);
  const maximum = Math.min(limit, Math.floor(count * 0.2));
  if (maximum < 1 || !Object.keys(context.have).length) return null;
  const match = solveRecipe(recipe, stock, context, maximum);
  if (!match) return null;
  const list = shoppingList(match.build, context.have);
  if (!list.getCount || list.getCount > maximum || list.haveCount / (list.haveCount + list.getCount) < 0.8) return null;
  return { match, missing: list.get, missingCount: list.getCount, ownedCount: list.haveCount, features: featureAllocation(recipe, match.build, context.have) };
}

function solveRecipe(recipe: Recipe, stock: Record<string, number>, context: MatchContext, extraLimit: number, mixed = false, preferColor = true): LibraryMatch | null {
  const have = context.have;
  const allows = (role: Role, color: ColorName) => roleAllows(role, color) && (!recipe.allowedColors?.[role] || recipe.allowedColors[role]!.includes(color));
  const slots = recipe.steps.flatMap(s => s.parts);
  const roles = [...new Set(slots.map(p => p.role))];
  // Rectangular replacements preserve every stud of their authored slot. Reject a split as
  // soon as any replacement lacks a supporting stud; do not discover this after full search.
  const template = slots.map(p => ({ ...p, partId: `${p.shape}-white`, kind: parsePartId(`${p.shape}-white`)! }));
  const supports = slots.map((_, i) => new Set(template.slice(0, i).flatMap(q => studCells(q.kind, q).map(([x,y]) => `${x},${y},${q.z+heightOf(q.kind)}`))));
  const supply = new Map<string, number>();
  for (const [id, n] of Object.entries(have)) {
    const k = parsePartId(id)!;
    const group = ['plate', 'tile'].includes(k.type) ? 'flat' : k.type;
    supply.set(`${k.color}:${group}`, (supply.get(`${k.color}:${group}`) ?? 0) + k.w * k.d * n);
  }
  const canSupply = (palette: Partial<Record<Role, ColorName>>) => {
    if (extraLimit || mixed) return true; // exact shortage is bounded on one shared ledger during assignment
    const need = new Map<string, number>();
    for (const p of template) {
      const color = palette[p.role]; if (!color) continue;
      const group = ['plate', 'tile'].includes(p.kind.type) ? 'flat' : p.kind.type;
      const key = `${color}:${group}`, n = (need.get(key) ?? 0) + p.kind.w * p.kind.d;
      if (n > (supply.get(key) ?? 0)) return false;
      need.set(key, n);
    }
    return true;
  };
  const colors = [...new Set([...Object.keys(have).map(id => parsePartId(id)!.color), ...(extraLimit ? Object.values(recipe.palette) as ColorName[] : [])])];
  const isSupported = (i: number, option: Placed[]) => {
    const studs = new Set(supports[i]);
    for(const q of option){
      const k=parsePartId(q.partId)!,top=q.z+heightOf(k);
      studCells(k,q).forEach(([x,y])=>studs.add(`${x},${y},${top}`));
    }
    return option.every(q=>q.z===0||gripCells(parsePartId(q.partId)!,q).some(c=>studs.has(c.join(','))));
  };
  const supportedOptions = new Map<string, Placed[][]>();
  const options = (i: number, c: ColorName) => {
    const localKey = `${i}:${c}`;
    if (supportedOptions.has(localKey)) return supportedOptions.get(localKey)!;
    const p = slots[i], key = `${mixed ? 'adaptive' : extraLimit ? 'near' : 'ready'}:${p.shape}:${p.x}:${p.y}:${p.z}:${p.rot}:${c}`;
    if (!context.choices.has(key)) {
      const candidates = choices(p, c, have, mixed), id = `${p.shape}-${c}`;
      if (extraLimit && isMade(id) && !candidates.some(o => o.length === 1 && o[0].partId === id)) candidates.unshift([{ partId: id, x: p.x, y: p.y, z: p.z, rot: p.rot }]);
      context.choices.set(key, candidates);
    }
    const valid = context.choices.get(key)!.filter(option => isSupported(i, option) && option.every(p => allows(slots[i].role, parsePartId(p.partId)!.color)));
    supportedOptions.set(localKey, valid); return valid;
  };
  // Small details may use several dark/light shades. Requiring a black nose and
  // dark-gray eyes to be the same color excluded the finer face constructions.
  // roleAllows and actual contrast still apply to every placed piece.
  const flexible = (role: Role) => mixed && role !== 'glass';
  const flexibleOptions = new Map<number, Placed[][]>();
  const slotOptions = (i: number, c: ColorName) => {
    if (!flexible(slots[i].role)) return options(i, c);
    if (!flexibleOptions.has(i)) {
      const p = slots[i];
      const solid = colors.filter(color => allows(p.role, color)).flatMap(color => options(i, color));
      const mixedOptions = choices(p, c, have, true, true).filter(option => isSupported(i, option) && option.every(q => allows(p.role, parsePartId(q.partId)!.color)));
      const cost = (option: Placed[]) => option.length + (preferColor ? 3 : 0) * new Set(option.map(p => parsePartId(p.partId)!.color).filter(color => color !== c)).size;
      flexibleOptions.set(i, [...solid, ...mixedOptions].sort((a, b) => cost(a) - cost(b) || Number(parsePartId(b[0].partId)!.color === c) - Number(parsePartId(a[0].partId)!.color === c)));
    }
    return flexibleOptions.get(i)!;
  };
  const candidates = roles.map(role => colors.filter(c => allows(role, c)).sort((a,b) => Number(b === recipe.palette[role]) - Number(a === recipe.palette[role])).slice(0, flexible(role) ? 1 : colors.length).map(color => {
    if (!canSupply({ [role]: color })) return { color, cost: Infinity };
    const indices = slots.flatMap((p, i) => p.role === role ? [i] : []);
    const opts = indices.map(i => slotOptions(i, color));
    const demand: Record<string, number> = {};
    indices.forEach(i => { const id = `${slots[i].shape}-${color}`; demand[id] = (demand[id] ?? 0) + 1; });
    const scarcity = extraLimit ? Object.entries(demand).reduce((n, [id, qty]) => n + Math.max(0, qty - (have[id] ?? 0)), 0) * 20 : 0;
    return { color, cost: opts.some(o => !o.length) ? Infinity : scarcity + opts.reduce((n, o) => n + Math.min(...o.map(q => q.length)), 0) + (color === recipe.palette[role] ? -0.5 : 0) };
  }).filter(c => Number.isFinite(c.cost)).sort((a, b) => a.cost - b.cost || a.color.localeCompare(b.color)).slice(0, flexible(role) ? 1 : extraLimit ? 3 : 5));
  if (candidates.some(c => !c.length)) return null;
  const palettes: { palette: Partial<Record<Role, ColorName>>; cost: number }[] = [];
  const enumerate = (i: number, palette: Partial<Record<Role, ColorName>>, cost: number) => {
    if (!canSupply(palette)) return;
    if (recipe.contrast.some(([a, b]) => !flexible(a) && !flexible(b) && palette[a] && palette[b] && !distinct(palette[a]!, palette[b]!))) return;
    if (i === roles.length) { palettes.push({ palette: { ...palette }, cost }); return; }
    for (const c of candidates[i]) enumerate(i + 1, { ...palette, [roles[i]]: c.color }, cost + c.cost);
  };
  enumerate(0, {}, 0);
  palettes.sort((a, b) => a.cost - b.cost);
  const geometryResults = new Map<string, boolean>();
  // Search revisits these options often; parse and count each one only once.
  const optionInfo = new Map<Placed[], { colors: ColorName[]; need: Record<string, number> }>();
  const info = (option: Placed[]) => {
    if (!optionInfo.has(option)) {
      const need: Record<string, number> = {};
      option.forEach(p => { need[p.partId] = (need[p.partId] ?? 0) + 1; });
      optionInfo.set(option, { need, colors: [...new Set(Object.keys(need).map(id => parsePartId(id)!.color))] });
    }
    return optionInfo.get(option)!;
  };
  let budget = 16000;
  let nearest: LibraryMatch | null = null, bestMissing = extraLimit + 1;
  for (const { palette } of palettes.slice(0, extraLimit ? 24 : 96)) {
    const opts = slots.map((p, i) => slotOptions(i, palette[p.role]!).filter(option => !mixed || !recipe.contrast.some(([a, b]) => {
      const other = a === p.role ? b : b === p.role ? a : undefined;
      return other && palette[other] && !flexible(other) && info(option).colors.some(c => !distinct(c, palette[other]!));
    })));
    if (opts.some(o => !o.length)) continue;
    const order = slots.map((_, i) => i).sort((a, b) => opts[a].length - opts[b].length);
    const left = { ...have }, selected: Placed[][] = [];
    const roleColors = new Map<Role, Map<ColorName, number>>();
    let attempts = 0, found: Build | null = null;
    const assign = (at: number, missing = 0): boolean => {
      if (--budget <= 0 || ++attempts > 2000) return false;
      if (missing > extraLimit || (extraLimit && missing >= bestMissing)) return false;
      if (at === order.length) {
        let cursor = 0;
        const build: Build = { name: recipe.name, description: recipe.pitch, source: { kind: 'library', recipeId: recipe.id }, steps: recipe.steps.map(s => ({
          caption: s.caption, parts: s.parts.flatMap(() => selected[cursor++]),
        })) };
        // Palette changes cannot repair a disconnected split. Validate each geometry once.
        const geometry = JSON.stringify(build.steps.flatMap(s => s.parts).map(p => [p.partId.split('-').slice(0, 2).join('-'), p.x, p.y, p.z, p.rot]));
        if (extraLimit && !Object.keys(buildCounts(build)).every(isMade)) return false;
        if (!geometryResults.has(geometry)) geometryResults.set(geometry, constructionIssues(build, extraLimit ? buildCounts(build) : have, 24).length === 0);
        if (!geometryResults.get(geometry)) return false;
        found = build; return true;
      }
      const i = order[at];
      const shortage = (option: Placed[]) => {
        const { need } = info(option);
        return Object.entries(need).reduce((n, [id, qty]) => n + Math.max(0, qty - Math.max(0, left[id] ?? 0)), 0);
      };
      for (const option of extraLimit ? [...opts[i]].sort((a, b) => shortage(a) - shortage(b) || a.length - b.length) : opts[i]) {
        const { colors: usedColors, need } = info(option);
        const role = slots[i].role;
        if (mixed && recipe.contrast.some(([a, b]) => {
          const other = a === role ? b : b === role ? a : undefined;
          return other && [...(roleColors.get(other)?.keys() ?? [])].some(c => usedColors.some(d => !distinct(c, d)));
        })) continue;
        const added = shortage(option);
        if (missing + added > extraLimit) continue;
        for (const [id, n] of Object.entries(need)) left[id] = (left[id] ?? 0) - n;
        selected[i] = option;
        if (!roleColors.has(role)) roleColors.set(role, new Map());
        usedColors.forEach(c => roleColors.get(role)!.set(c, (roleColors.get(role)!.get(c) ?? 0) + 1));
        if (assign(at + 1, missing + added)) return true;
        for (const [id, n] of Object.entries(need)) left[id] += n;
        usedColors.forEach(c => { const n = roleColors.get(role)!.get(c)! - 1; if (n) roleColors.get(role)!.set(c, n); else roleColors.get(role)!.delete(c); });
      }
      return false;
    };
    if (assign(0) && found) {
      const actualPalette = { ...palette };
      for (const role of roles) {
        const used = new Map<ColorName, number>();
        selected.forEach((option, i) => { if (slots[i].role === role) option.forEach(p => {
          const c = parsePartId(p.partId)!.color; used.set(c, (used.get(c) ?? 0) + 1);
        }); });
        actualPalette[role] = [...used].sort((a, b) => b[1] - a[1])[0][0];
      }
      const match: LibraryMatch = {
        colorMode: [...roleColors.values()].some(cs => cs.size > 1) ? 'mixed' : 'coherent',
        layeredSubstitutions: selected.filter((parts, i) => slots[i].shape.startsWith('brick-') && parts.some(p => p.partId.startsWith('plate-'))).length,
        recipeId: recipe.id, label: recipe.variant, animalBase: recipe.animalBase, build: found, palette: actualPalette, parts: buildCounts(found), features: featureAllocation(recipe, found, have),
        substitutions: selected.filter((parts, i) => parts.length !== 1 || parts[0].partId !== `${slots[i].shape}-${palette[slots[i].role]}`).length,
      };
      if (!extraLimit) return match;
      const missing = shoppingList(found, have).getCount;
      if (missing < bestMissing) { bestMissing = missing; nearest = match; }
      if (!missing) return match;
    }
    if (budget <= 0) break;
  }
  return nearest;
}

const designMerit = (r: Recipe) => (r.designLevel ?? 0) * 1000 + r.steps.reduce((n, s) => n + s.parts.length, 0);

/** Each design is an alternative use of the same bucket, not a kit to build all at once. */
export function matchFamily(variants: Recipe[], stock: Record<string, number>, context = matchContext(stock)): LibraryEntry {
  const recipe = variants[0], matches: LibraryMatch[] = [];
  for (const variant of variants) {
    const match = matchRecipe(variant, stock, context, 'coherent');
    if (match) matches.push(match);
  }
  // Find coherent versions, then try every remaining structural variant.
  // An easy small match must not hide a larger version the same stock can finish.
  for (const variant of variants.filter(r => !matches.some(m => m.recipeId === r.id))) {
    const match = adaptiveRecipe(variant, stock, context);
    if (match) matches.push(match);
  }
  // Authored complexity precedes color convenience. Splitting one slot into many
  // pieces does not make the underlying design more developed.
  const merit = (id: string) => {
    const r = variants.find(v => v.id === id)!;
    return designMerit(r);
  };
  matches.sort((a, b) => merit(b.recipeId) - merit(a.recipeId) || Number(a.colorMode === 'mixed') - Number(b.colorMode === 'mixed') || a.substitutions - b.substitutions);
  const near = !matches.length ? variants.map(r => closestRecipe(r, stock, 6, context)).filter((m): m is NearFit => !!m)
    .sort(compareNearFits)[0] : undefined;
  const reference = [...variants].sort((a, b) => merit(b.id) - merit(a.id))[0];
  return { id: recipe.family, name: reference.name, pitch: reference.pitch, features: reference.features, category: reference.category, animalBase: reference.animalBase,
    variants: variants.length, example: recipeExample(reference), match: matches[0] ?? null, matches, near, strategy: strategyForRecipe(reference).id,
    terms: [...new Set(variants.flatMap(r => [r.family, ...(r.tags ?? [])]))] };
}
export function recipeFamilies(recipes: Recipe[] = RECIPES): Recipe[][] {
  const families = new Map<string, Recipe[]>();
  for (const r of recipes) families.set(r.family, [...(families.get(r.family) ?? []), r]);
  return [...families.values()];
}
/** Count authored parts as well as fitted pieces; a seven-slot sketch cannot qualify through fragmentation. */
export function finishedRecipeFamilies(recipes: Recipe[] = RECIPES): Recipe[][] {
  return recipeFamilies(recipes.filter(r => r.steps.reduce((n, s) => n + s.parts.length, 0) >= MIN_FINISHED_PARTS &&
    (r.category !== 'Animals' || r.designLevel !== undefined))).map(variants => variants.sort((a, b) => designMerit(b) - designMerit(a)));
}
export function libraryFor(stock: Record<string, number>, recipes: Recipe[] = RECIPES): LibraryEntry[] {
  const context = matchContext(stock);
  return finishedRecipeFamilies(recipes).map(variants => matchFamily(variants, stock, context));
}
