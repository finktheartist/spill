import type { CatalogPart, PartsCatalog } from './parts-search';
import {PART_TAG_GROUPS,readPartTags,tagsForCatalogPart,type PartTags,type PartTagGroupId} from '../src/lib/part-tags';

export interface PartRecommendationContext {
  description?: string; num?: string; shape?: string; color?: string; family?: string; size?: string;
  features?: { outline?: string; topShape?: string; studLayout?: string; studsOnTop?: number;
    heightPlates?: number; handedness?: string; openStuds?: boolean };
}
export interface PartRecommendationResult {
  parts: (CatalogPart & { matchReasons: string[]; matchCautions: string[] })[];
  evidence: string[]; needsMoreEvidence: boolean;
}
export const PART_RECOMMENDATION_FAMILIES = ['brick', 'plate', 'tile', 'slope', 'curve', 'round', 'macaroni',
  'side-stud', 'bracket', 'clip', 'hinge', 'window', 'wheel'] as const;
const normalize = (s: string) => s.toLowerCase().replace(/×/g, 'x').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
type Dim = number[];
const number = (s: string) => { const [a, b] = s.trim().split(/\s+/); const fraction = (v: string) => v.includes('/') ? +v.split('/')[0] / +v.split('/')[1] : +v;
  return b ? +a + fraction(b) : fraction(a); };
function dimensions(s: string): Dim[] {
  const n = '(?:\\d{1,3}(?:\\.\\d+|(?:\\s+\\d+)?/\\d+)?)';
  return [...s.matchAll(new RegExp(`\\b(${n})\\s*[x×]\\s*(${n})(?:\\s*[x×]\\s*(${n}))?`, 'gi'))]
    .map(m => m.slice(1).filter(Boolean).map(number)).filter(d => d.every(v => Number.isFinite(v) && v > 0 && v <= 80));
}
// A two-axis observation describes only footprint; a catalog title may also
// state height. A three-axis request still requires that third catalog axis.
const sameDim = (a: Dim, b: Dim) => (a.length === 2 ? b.length >= 2 : a.length === b.length) &&
  ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])) && (a.length < 3 || a[2] === b[2]);
type Row = { part: CatalogPart; name: string; dims: Dim[]; family?: string; facts: Record<string, string | number | boolean | undefined> };
type Clue = { key: string; value: string | number | boolean; label: string; negative?: boolean; source: string; weight: number };
/** A decorative With clause describes ink, not new sockets or anatomy. Keep
 * earlier structural With clauses; conservatively discard a mixed final one. */
function structuralText(text: string): string {
  const print = text.search(/\bprints?\b|\bpatterns?\b|\bdecorat(?:ed|ion)\b/);
  if (print < 0) return text;
  const before = text.slice(0, print), clause = before.lastIndexOf(' with ');
  return clause >= 0 ? before.slice(0, clause) : before.slice(0, before.lastIndexOf(' - ') >= 0 ? before.lastIndexOf(' - ') : 0);
}
function row(part: CatalogPart): Row {
  const fullName = normalize(part.name), name = structuralText(fullName), primary = name.split(/\bwith\b/)[0], dims = dimensions(primary);
  const family = /\bbracket\b/.test(primary) ? 'bracket' : /\bwindow\b/.test(primary) ? 'window' :
    /\bhinge\b/.test(primary) ? 'hinge' : /^tile\b/.test(name) ? 'tile' : /^plate\b/.test(name) ? 'plate' :
    /^brick\b/.test(name) ? 'brick' : /^slope\b/.test(name) ? 'slope' : /\bwheel\b/.test(primary) ? 'wheel' : undefined;
  const count = name.match(/\b(?:only\s+)?(\d+|one|two|three|four)\s+(?:open\s+|hollow\s+)?studs?\b/);
  const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const countValue = count ? (counts[count[1]] ?? +count[1]) : undefined;
  const sideCount = count && /^(?:\s+on)?\s+(?:\d+\s+|one\s+|two\s+)?side\b/.test(name.slice(count.index! + count[0].length));
  const explicitTopCount = count && !sideCount && (/\bonly\b|\btop\b|\bend\b/.test(count[0]) || /\bonly\s*$/.test(name.slice(0, count.index)) || /^(?:\s+(?:on|at))?\s+(?:the\s+|one\s+|1\s+)?(?:edge|ends|top)\b/.test(name.slice(count.index! + count[0].length)));
  const simple = /^(?:brick|plate)\s+\d/.test(name) && !/\bwith\b/.test(primary);
  const topCount = (explicitTopCount ? countValue : undefined) ?? (family === 'tile' && !/\bwith .*stud\b/.test(name) ? 0 :
    simple && !/\bwith\b/.test(name) && dims.length === 1 ? dims[0][0] * dims[0][1] : undefined);
  const printed = /\bprint\b|\bpattern\b|\bdecorat/.test(fullName) || /pr\d/i.test(part.num);
  const round = /\bround\b/.test(primary), macaroni = /\bmacaroni\b|\bcorner round\b/.test(primary);
  const headlight = family === 'brick' && /\bheadlight\b/.test(name);
  const side = headlight || /studs? on (?:\d+ |one |two |the )?side|side studs?/.test(name);
  const top = /\bcurved\b/.test(primary) && (family === 'slope' || family === 'brick') ? (/\binverted\b/.test(primary) ? 'curved-inverted' : 'curved') : family === 'slope' ? 'sloped' :
    ['brick', 'plate', 'tile'].includes(family ?? '') && !/dome/.test(primary) ? 'flat' : /\bdome/.test(primary) ? 'dome' : undefined;
  const outline = macaroni ? 'quarter-circle' : round ? 'round' : /\bwedge\b/.test(primary) ? 'wedge' :
    /\bcorner\b/.test(primary) ? 'L' : /\brounded ends\b/.test(primary) ? 'capsule' :
    ['brick', 'plate', 'tile'].includes(family ?? '') && !/\b(?:special|modified)\b/.test(primary) ? 'rectangle' : undefined;
  const facts: Row['facts'] = { family, headlight, macaroni, round, side,
    clip: /\bclip\b/.test(name), window: /\bwindow\b/.test(name), hinge: /\bhinge\b/.test(name), printed,
    socket: /\b(?:tow\s*)?ball(?:joint)? socket\b|\bsocket[^,]*\bball\b/.test(name), sideCount: sideCount ? countValue : undefined,
    ball: /\b(?:tow\s*)?balls?\b(?!\s+(?:joint\s+)?sockets?\b)/.test(name),
    ballPosition: /\bend towballs?\b|\btowballs? on (?:the )?ends?\b/.test(name) ? 'end' : /\b(?:centre|center|side) towballs?\b/.test(name) ? 'side' : undefined,
    halfCircle: /\bhalf circle\b|\bsemi ?circle\b/.test(name),
    inverted: /\binverted\b/.test(name), top, outline, studs: topCount,
    height: dims[0]?.[2] !== undefined ? dims[0][2] * 3 :
      family === 'tile' || family === 'plate' ? 1 : family === 'brick' && !/\bspecial\b|\bmodified\b/.test(primary) ? 3 : undefined,
    hand: /\bleft\b/.test(primary) ? 'left' : /\bright\b/.test(primary) ? 'right' : undefined,
    open: /\bopen studs?\b|\bhollow studs?\b/.test(name) ? true : /\bsolid studs?\b/.test(name) ? false : undefined };
  facts.layout = topCount === 0 ? 'none' : /\bjumper\b|\bcent(?:er|re)(?:ed)? stud/.test(name) ? 'center' :
    /\b(?:one|1) edge\b/.test(name) ? 'edge' : countValue === 2 && !sideCount && dims[0] && sameDim(dims[0], [1, 4]) && family === 'plate' ? 'ends' :
    side ? 'side' : simple && topCount !== undefined ? 'grid' : undefined;
  return { part, name, dims, family, facts };
}

const featureEnums: Record<string, readonly string[]> = {
  outline: ['rectangle', 'L', 'round', 'quarter-circle', 'wedge', 'capsule', 'other'],
  topShape: ['flat', 'slope45', 'slope-shallow', 'slope-steep', 'curved', 'curved-inverted', 'dome', 'other'],
  studLayout: ['grid', 'center', 'row', 'side', 'none', 'other', 'ends', 'end-studs', 'edge', 'one-edge'],
  handedness: ['left', 'right', 'unknown'],
};
function validate(context: PartRecommendationContext, limit: number) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new RangeError('Provide recommendation context');
  for (const [key, max] of [['description', 500], ['num', 80], ['shape', 80], ['color', 80], ['size', 80]] as const) {
    const v = context[key]; if (v !== undefined && (typeof v !== 'string' || v.length > max)) throw new RangeError(`${key} must be a string of at most ${max} characters`);
  }
  if (context.family !== undefined && context.family !== '' && !PART_RECOMMENDATION_FAMILIES.includes(context.family as typeof PART_RECOMMENDATION_FAMILIES[number])) throw new RangeError('Unsupported family');
  if (context.num && !/^[a-z0-9][a-z0-9._-]*$/i.test(context.num)) throw new RangeError('Invalid exact catalog number');
  if (context.shape && !/^[a-z]+-\d{1,2}x\d{1,2}$/.test(context.shape)) throw new RangeError('Invalid native shape context');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  if (context.features !== undefined) {
    if (!context.features || typeof context.features !== 'object' || Array.isArray(context.features)) throw new RangeError('Invalid features');
    for (const [key, value] of Object.entries(context.features)) {
      if (!(key in featureEnums) && !['studsOnTop', 'heightPlates', 'openStuds'].includes(key)) throw new RangeError(`Unsupported feature ${key}`);
      if (value === undefined) continue;
      if (featureEnums[key]) { if (typeof value !== 'string' || !featureEnums[key].includes(value)) throw new RangeError(`Invalid feature ${key}`); }
      else if (key === 'studsOnTop' || key === 'heightPlates') {
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > (key === 'heightPlates' ? 80 : 1024)) throw new RangeError(`Invalid feature ${key}`);
      } else if (key !== 'openStuds' || typeof value !== 'boolean') throw new RangeError(`Unsupported feature ${key}`);
    }
  }
}

/** Offline name/identifier evidence only. Scores are ordering heuristics, never
 * identity probabilities or geometry/clutch/manufacturing/stock validation.
 * Native mapping is copied, never inferred and never a ranking advantage.
 */
export function recommendPartsCatalog(data: PartsCatalog, context: PartRecommendationContext, limit = 8): PartRecommendationResult {
  validate(context, limit);
  const text = normalize(context.description ?? ''), clues: Clue[] = [], evidence: string[] = [], cautions: string[] = [];
  const add = (key: string, value: Clue['value'], label: string, source = 'description', weight = 12, negative = false) => {
    if (!clues.some(c => c.key === key && c.value === value && c.negative === negative && c.source === source)) clues.push({ key, value, label, source, weight, negative });
  };
  const negated = (index: number) => /\b(?:not|no|without|isn't)\s+(?:(?:a|an|any|the|visible|top|like|one|two|2)\s+){0,4}$/.test(text.slice(Math.max(0, index - 45), index));
  if ([...text.matchAll(/\bclumps?\b|\bstack(?:ed|s)?\b|\bassembl(?:y|ed)\b|\b(?:multiple|several|two|2) pieces\b|\bparts stuck together\b/g)].some(m => !negated(m.index!))) {
    return { parts: [], evidence: ['Description may represent multiple joined pieces. Separate them and review each visible piece before selecting a single mold.'], needsMoreEvidence: true };
  }
  const find = (key: string, re: RegExp, value: Clue['value'], label: string, weight = 14) => {
    for (const m of (key === 'printed' ? text : structuralText(text)).matchAll(re)) add(key, value, label, 'description', weight, negated(m.index!));
  };
  find('family', /\bbricks?\b/g, 'brick', 'Brick family', 10);
  find('family', /\bplates?\b/g, 'plate', 'Plate family', 10);
  find('family', /\btiles?\b/g, 'tile', 'Tile family', 10);
  find('family', /\bslopes?\b/g, 'slope', 'Slope family', 10);
  for (const key of ['bracket', 'window', 'hinge', 'wheel'] as const) find('family', new RegExp(`\\b${key}s?\\b`, 'g'), key, `${key} family`, 16);
  find('headlight', /\bheadlight\b/g, true, 'Headlight body', 28);
  find('macaroni', /\bmacaroni\b|\bquarter ring\b/g, true, 'Macaroni / quarter-ring outline', 24);
  find('round', /\bround\b|\bcircular\b/g, true, 'Round outline', 18);
  find('outline', /\brectangular\b|\brectangle\b/g, 'rectangle', 'Rectangular outline', 14);
  find('clip', /\bclips?\b/g, true, 'Clip feature', 24);
  find('socket', /\b(?:tow\s*)?ball(?:joint)? socket\b|\bsocket for (?:a )?(?:tow\s*)?ball\b/g, true, 'Ball socket feature', 28);
  find('ball', /\b(?:tow\s*)?balls?\b(?!\s+(?:joint\s+)?sockets?\b)/g, true, 'Protruding ball feature', 28);
  find('ballPosition', /\bend tow ?balls?\b|\btow ?balls? on (?:the )?ends?\b/g, 'end', 'Ball at the end', 18);
  find('halfCircle', /\bhalf circle\b|\bsemi ?circle\b/g, true, 'Half-circle outline', 22);
  find('side', /\bside studs?\b|\bstuds? on (?:a |the |one |1 )?side\b/g, true, 'Side stud feature', 22);
  find('printed', /\bprinted\b|\bprint\b|\bpattern\b/g, true, 'Printed / patterned detail', 20);
  find('inverted', /\binverted\b/g, true, 'Inverted orientation', 20);
  find('top', /\bcurved\b/g, 'curved', 'Curved upper surface', 14);
  // A curved tile is a plan-view curve, not necessarily a curved upper surface.
  if (clues.some(c => c.key === 'family' && c.value === 'tile' && !c.negative)) {
    for (let i = clues.length - 1; i >= 0; i--) if (clues[i].key === 'top' && clues[i].value === 'curved') clues.splice(i, 1);
  }
  find('top', /\bflat\b|\bsmooth top\b/g, 'flat', 'Flat upper surface', 12);
  find('layout', /\bend studs?\b|\bstuds? (?:only )?(?:at|on) (?:the |both |two )?ends\b/g, 'ends', 'Studs at the ends', 24);
  find('layout', /\b(?:one|1) edge\b/g, 'edge', 'Studs along one edge', 22);
  if (/\b(?:no|without|zero|0) (?:top )?studs?\b/.test(text)) add('studs', 0, 'No top studs', 'description', 20);
  for (const m of text.matchAll(/\b(\d{1,3}|one|two|three|four)\s+(?:top\s+|end\s+)?studs?\b/g)) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
    const v = (words[m[1]] ?? +m[1]);
    const after = text.slice(m.index! + m[0].length);
    const side = /^(?:\s+on)?\s+(?:\d+\s+|one\s+|two\s+)?side\b/.test(after);
    const top = /\btop\b|\bend\b/.test(m[0]) || /\bonly\s*$/.test(text.slice(0, m.index)) || /^(?:\s+(?:on|at))?\s+(?:the\s+|one\s+|1\s+)?(?:edge|ends|top)\b/.test(after);
    if (!negated(m.index!)) {
      if (side) add('sideCount', v, `${v} side studs`, 'description', 20);
      else if (top) add('studs', v, `${v} top studs`, 'description', 20);
    }
  }
  for (const m of text.matchAll(/\b(left|right)\b/g)) add('hand', m[1], `${m[1]} handedness`, 'description', 16, negated(m.index!));
  const descDims = dimensions(structuralText(text)), requestedDims = context.size ? dimensions(context.size) : descDims;
  if (context.size && !requestedDims.length) throw new RangeError('size must contain explicit positive dimensions');
  const bracket = context.family === 'bracket' || clues.some(c => c.key === 'family' && c.value === 'bracket' && !c.negative);
  let conflict = false;
  if (context.size && descDims.length && !requestedDims.some(d => descDims.some(e => sameDim(d, e)))) {
    cautions.push('Size estimate conflicts with the description; measure the piece again.'); conflict = true;
  }
  if (context.family) {
    const family = context.family;
    const key = family === 'round' ? 'round' : family === 'macaroni' ? 'macaroni' : family === 'side-stud' ? 'side' : family === 'clip' ? 'clip' : family === 'curve' ? 'top' : 'family';
    const value = family === 'curve' ? 'curved' : key === 'family' ? family : true;
    const overridden = new Set(['family', key, ...(family === 'curve' ? ['top'] : [])]);
    if (clues.some(c => overridden.has(c.key) && (c.key !== key || c.value !== value) && !c.negative)) cautions.push('Selected family overrides conflicting shape/family clues inferred from the description.');
    for (let i = clues.length - 1; i >= 0; i--) if (overridden.has(clues[i].key) && clues[i].source === 'description') clues.splice(i, 1);
    add(key, value, `Selected family: ${family}`, 'selector', 20);
  }
  for (const [field, value] of Object.entries(context.features ?? {})) {
    if (value === undefined || value === 'other' || value === 'unknown' || field === 'heightPlates' && value === 0) continue;
    const keys: Record<string, string> = { outline: 'outline', topShape: 'top', studLayout: 'layout', studsOnTop: 'studs', heightPlates: 'height', handedness: 'hand', openStuds: 'open' };
    const mapped = field === 'topShape' && String(value).startsWith('slope') ? 'sloped' : field === 'studLayout' && value === 'end-studs' ? 'ends' : field === 'studLayout' && value === 'one-edge' ? 'edge' : value;
    if (context.family === 'curve' && field === 'topShape' && mapped !== 'curved') {
      cautions.push('Selected curved family overrides the earlier upper-surface estimate.'); continue;
    }
    if (clues.some(c => c.key === keys[field] && !c.negative && c.value !== mapped) || clues.some(c => c.key === keys[field] && c.negative && c.value === mapped)) {
      cautions.push(`${field} estimate conflicts with the description; confirm the visible feature.`); conflict = true;
    }
    const labels: Record<string, string> = { outline: `Outline: ${value}`, topShape: `Upper surface: ${value}`, studLayout: `Stud layout: ${value}`,
      studsOnTop: `${value} top studs`, heightPlates: `Height: ${value} ${value === 1 ? 'plate' : 'plates'}`,
      handedness: `Handedness: ${value}`, openStuds: value ? 'Open studs' : 'Solid studs' };
    add(keys[field], mapped, labels[field], 'features', 18);
  }
  if (context.features?.studsOnTop !== undefined && context.features.studLayout === 'none' && context.features.studsOnTop !== 0) {
    cautions.push('Top stud count conflicts with the no-studs layout.'); conflict = true;
  }
  if (context.features?.outline && context.features.outline !== 'other') {
    const outline = context.features.outline;
    if (clues.some(c => c.key === 'round' && !c.negative && c.value === true) && outline !== 'round' ||
      clues.some(c => c.key === 'round' && c.negative && c.value === true) && outline === 'round' ||
      clues.some(c => c.key === 'macaroni' && !c.negative) && outline !== 'quarter-circle') {
      cautions.push('Outline estimate conflicts with the description; confirm the silhouette.'); conflict = true;
    }
  }
  if (requestedDims.length) evidence.push(`${bracket && requestedDims.length > 1 ? 'Bracket panel dimensions' : requestedDims.length > 1 ? 'Alternative dimension estimates' : 'Dimension estimate'}: ${requestedDims.map(d => d.join(' x ')).join(bracket ? ' / ' : ' or ')}.`);
  evidence.push(...clues.map(c => `${c.negative ? 'Excludes' : 'Clue'}: ${c.label} (${c.source}).`));
  if (context.num) evidence.push(`Current exact catalog number context: ${context.num}; not confirmation.`);
  if (context.shape) evidence.push(`Current native shape context: ${context.shape}; not confirmation.`);
  if (conflict) return { parts: [], evidence: [...evidence, ...cautions], needsMoreEvidence: true };
  const positives = clues.filter(c => !c.negative);
  if (!positives.length && !requestedDims.length && !context.num && !context.shape) return { parts: [], evidence: [...evidence, 'No positive identity clues; add dimensions, shape or visible features.'], needsMoreEvidence: true };
  const ambiguous = requestedDims.length > 1 && !bracket || /\bmaybe\b|\bperhaps\b|\bor\b|\?/.test(text);
  const ranked: { part: CatalogPart; reasons: string[]; cautions: string[]; score: number; exact: number; color: number }[] = [];
  const wantedColor = context.color ? data.colorIds[context.color] : undefined;
  for (const part of data.parts) {
    const r = row(part), reasons: string[] = [], notes = [...cautions]; let score = 0, reject = false;
    if (requestedDims.length) {
      const matches = bracket && requestedDims.length > 1 ? requestedDims.length === r.dims.length && requestedDims.every((d, i) => sameDim(d, r.dims[i])) : requestedDims.some(d => r.dims[0] && sameDim(d, r.dims[0]));
      if (!matches && r.dims.length) continue;
      if (matches) { score += bracket && requestedDims.length > 1 ? 30 : 18; reasons.push(`Catalog dimensions: ${r.dims.map(d => d.join(' x ')).join(' / ')}.`); }
      else notes.push('Catalog name does not establish the requested dimensions.');
    }
    // Multiple positive values for a key are alternatives, not an impossible AND.
    for (const key of new Set(clues.map(c => c.key))) {
      const cs = clues.filter(c => c.key === key), value = r.facts[key];
      if (cs.some(c => c.negative && value === c.value)) { reject = true; break; }
      const wanted = cs.filter(c => !c.negative);
      if (!wanted.length) continue;
      if (value === undefined) { notes.push(`Catalog text does not establish ${key}; inspect the image/underside.`); continue; }
      const match = wanted.find(c => c.value === value || key === 'layout' && c.value === 'row' && value === 'edge');
      if (!match) { reject = true; break; }
      score += match.weight; reasons.push(`${match.label}: compatible with the saved catalog description.`);
      if (key === 'layout' && value === 'ends') notes.push('Catalog text establishes two studs on this footprint; verify end positions and underside variant visually.');
    }
    if (reject) continue;
    const exactNum = context.num && part.num.toLowerCase() === context.num.toLowerCase();
    const exactShape = context.shape && part.shape === context.shape;
    if (exactNum) reasons.push('Exact current catalog number; this context is not independent confirmation.');
    if (exactShape) reasons.push('Exact current native shape context; this context is not independent confirmation.');
    if (!score && !exactNum && !exactShape) continue;
    if (ambiguous) notes.push('Description or dimensions are ambiguous; compare alternatives.');
    if (bracket && !clues.some(c => c.key === 'inverted')) notes.push('Bracket orientation is unspecified; verify upright versus inverted.');
    if (bracket && requestedDims.length < 2) notes.push('Both bracket panel footprints need checking.');
    if (wantedColor !== undefined && !part.colors.includes(wantedColor)) notes.push('Requested color is not in this record’s saved colors; color/identity needs checking.');
    if (r.facts.printed && !positives.some(c => c.key === 'printed')) notes.push('This is a printed variant; verify its exact visible pattern.');
    notes.push('Catalog-text candidate only; identity, geometry and stock are not confirmed.');
    ranked.push({ part, reasons, cautions: [...new Set(notes)], score, exact: exactNum ? 2 : exactShape ? 1 : 0,
      color: wantedColor !== undefined && part.colors.includes(wantedColor) ? 1 : 0 });
  }
  ranked.sort((a, b) => b.score - a.score || b.exact - a.exact || a.cautions.length - b.cautions.length || b.color - a.color ||
    (Number.isFinite(b.part.pop) ? b.part.pop : 0) - (Number.isFinite(a.part.pop) ? a.part.pop : 0) || a.part.num.localeCompare(b.part.num));
  const parts = ranked.slice(0, Math.min(12, limit)).map(r => ({ ...r.part, matchReasons: r.reasons, matchCautions: r.cautions }));
  if (!parts.length) evidence.push('No saved catalog records satisfy the usable clues; add a clearer description or underside view.');
  evidence.push('Ordering uses catalog text and explicit context; native builder support is not a ranking signal.');
  return { parts, evidence, needsMoreEvidence: !parts.length || ambiguous || !requestedDims.length && !context.num && !context.shape || positives.length === 0 };
}

export type PartTagFacets=Partial<Record<PartTagGroupId,{value:string;label:string;count:number}[]>>;
export interface TaggedRecommendationOptions {query?:string;color?:string;offset?:number;limit?:number;guesses?:unknown;shortlist?:boolean}
export interface TaggedPartRecommendationResult extends PartRecommendationResult {
 count:number;total:number;offset:number;limit:number;hasMore:boolean;nextOffset:number|null;facets:PartTagFacets;
}
type CatalogSnapshot=Readonly<Omit<CatalogPart,'colors'|'elements'|'identifiers'>>&{
 readonly colors:readonly number[];readonly elements:readonly string[];readonly identifiers:readonly string[];
};
type TagSnapshot=Readonly<Partial<Record<PartTagGroupId,readonly string[]>>>;
interface TaggedRow {readonly part:CatalogSnapshot;readonly tags:TagSnapshot;readonly query:string;readonly num:string;readonly identifiers:readonly string[]}
interface TagIndex {readonly rows:readonly TaggedRow[];readonly facets:PartTagFacets}
// Parsed evidence is immutable and indexed once per actual catalog object.
// No query/ranked-result cache and no source record is returned by reference.
const tagIndexes=new WeakMap<PartsCatalog,TagIndex>();
const tagQuery=(s:string)=>s.toLowerCase().replace(/(\d)\s*[x×]\s*(?=\d)/g,'$1 x ').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const copyCatalogPart=(p:CatalogSnapshot):CatalogPart=>({...p,colors:[...p.colors],elements:[...p.elements],identifiers:[...p.identifiers]});
const tagLabel=(key:string,value:string)=>`${key}: ${value}`;
function tagIndex(data:PartsCatalog):TagIndex {
 const cached=tagIndexes.get(data);if(cached)return cached;
 const counts=new Map<PartTagGroupId,Map<string,number>>();
 const rows=data.parts.map(p=>{
  const tags=readPartTags(tagsForCatalogPart(p)),snapshot:Partial<Record<PartTagGroupId,readonly string[]>>={};
  for(const key of Object.keys(tags) as PartTagGroupId[]){
   const values=[...new Set(tags[key]??[])];if(!values.length)continue;
   snapshot[key]=Object.freeze(values);
   let group=counts.get(key);if(!group){group=new Map();counts.set(key,group);}
   for(const value of values)group.set(value,(group.get(value)??0)+1);
  }
  const part=Object.freeze({...p,colors:Object.freeze([...p.colors]),elements:Object.freeze([...p.elements]),identifiers:Object.freeze([...p.identifiers])});
  return Object.freeze({part,tags:Object.freeze(snapshot),query:tagQuery(`${p.name} ${p.num} ${p.identifiers.join(' ')} ${p.category}`),
   num:tagQuery(p.num),identifiers:Object.freeze(p.identifiers.map(tagQuery))});
 });
 // Color is catalog availability, never an exclusion or structural identity.
 const colorCounts=new Map<string,number>(),countsByColor=new Map<number,number>();
 for(const row of rows)for(const id of new Set(row.part.colors))countsByColor.set(id,(countsByColor.get(id)??0)+1);
 for(const [name,id] of Object.entries(data.colorIds)){const n=countsByColor.get(id);if(n)colorCounts.set(name,n);}
 if(colorCounts.size)counts.set('color',colorCounts);
 const facets:PartTagFacets={};
 for(const [key,values] of counts){
  const labels=new Map(PART_TAG_GROUPS.find(g=>g.id===key)?.options.map(o=>[o.value,o.label]));
  facets[key]=Object.freeze([...values].sort(([a],[b])=>a.localeCompare(b,'en')).map(([value,count])=>Object.freeze({value,label:labels.get(value)??value,count}))) as unknown as PartTagFacets[typeof key];
 }
 const index=Object.freeze({rows:Object.freeze(rows),facets:Object.freeze(facets)});tagIndexes.set(data,index);return index;
}
const singleTagGroups=new Set<PartTagGroupId>(['family','size','height','shape','studs','category']);
const sizeKey=(value:string)=>value.split('-').map(panel=>panel.split('x').map(Number).sort((a,b)=>a-b).join('x')).join('-');
const sameTag=(group:PartTagGroupId,a:string,b:string)=>group==='size'?sizeKey(a)===sizeKey(b):a===b;
const topStudFeatures=new Set(['studded','open-studs','solid-studs','grid-studs','center-stud','offset-studs','end-studs','edge-studs','row-studs']);
/** Only explicit mutually exclusive evidence is a contradiction. Unmentioned
 * clips, inversions, axles, decorations, etc. remain unknown, never false. */
function tagContradiction(group:PartTagGroupId,wanted:readonly string[],actual:readonly string[]):boolean {
 if(!actual.length)return false;
 if(singleTagGroups.has(group))return !wanted.some(v=>actual.some(a=>sameTag(group,v,a)));
 if(group==='profile')return [['left','right'],['upright','inverted']].some(([a,b])=>wanted.includes(a)&&actual.includes(b)||wanted.includes(b)&&actual.includes(a));
 if(group==='top')return wanted.includes('smooth')&&actual.some(v=>topStudFeatures.has(v))||actual.includes('smooth')&&wanted.some(v=>topStudFeatures.has(v));
 return false;
}

/** User-selected groups replace the corresponding guesses, never merge with
 * them. Cross-field top/count contradictions also yield to the user's edits. */
function effectiveGuesses(tags:PartTags,raw:unknown):[PartTagGroupId,string[]][] {
 const guesses=raw===undefined?{}:readPartTags(raw);
 const userSmooth=tags.studs?.[0]==='0'||tags.top?.includes('smooth');
 const userStudded=Number(tags.studs?.[0])>0||tags.top?.some(v=>topStudFeatures.has(v))||tags.connections?.includes('stud');
 return (Object.entries(guesses) as [PartTagGroupId,string[]][]).flatMap(([key,values])=>{
  if(tags[key]?.length)return [];
  const allowed=values.filter(v=>!(userSmooth&&(key==='studs'&&Number(v)>0||key==='top'&&topStudFeatures.has(v)||key==='connections'&&v==='stud'))&&
   !(userStudded&&(key==='studs'&&v==='0'||key==='top'&&v==='smooth')));
  return allowed.length?[[key,allowed] as [PartTagGroupId,string[]]]:[];
 });
}

function guessedContradiction(group:PartTagGroupId,value:string,actual:TagSnapshot):boolean {
 if(tagContradiction(group,[value],actual[group]??[]))return true;
 const count=actual.studs?.[0];
 if(group==='top')return value==='smooth'&&count!==undefined&&Number(count)>0||topStudFeatures.has(value)&&count==='0';
 if(group==='studs')return value==='0'&&!!actual.top?.some(v=>topStudFeatures.has(v))||Number(value)>0&&!!actual.top?.includes('smooth');
 return false;
}

/** Explicit feature-tag path. Tags are authoritative; old identity/description
 * context is neither accepted nor combined. Rank the entire compatible catalog
 * before slicing, retaining unknown metadata as explained weaker candidates.
 * Optional AI guesses affect ordering only, never compatibility or catalog size.
 * These are text-evidence matches, never identity probabilities or stock proof. */
export function recommendPartsCatalogByTags(data:PartsCatalog,rawTags:unknown,options:TaggedRecommendationOptions={}):TaggedPartRecommendationResult {
 const tags=readPartTags(rawTags),query=options.query??'',color=tags.color?.[0]??options.color??'',offset=options.offset??0,limit=options.limit??24;
 const guesses=effectiveGuesses(tags,options.guesses).filter(([key])=>key!=='color'||!color);
 if(typeof query!=='string'||query.length>256||typeof color!=='string'||color.length>80)throw new RangeError('Tag query/color is too long or malformed');
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>80)throw new RangeError('Invalid tag recommendation pagination');
 if(options.shortlist!==undefined&&typeof options.shortlist!=='boolean')throw new RangeError('shortlist must be boolean');
 const index=tagIndex(data),q=tagQuery(query),sizes=[...q.matchAll(/\b(\d+) x (\d+)\b/g)].map(m=>[`${m[1]} x ${m[2]}`,`${m[2]} x ${m[1]}`]);
 const words=q.replace(/\b\d+ x \d+\b/g,' ').split(' ').filter(Boolean),has=(text:string,phrase:string)=>new RegExp(`(^| )${phrase}( |$)`).test(text);
 const selected=(Object.entries(tags) as [PartTagGroupId,string[]][]).filter(([key,vs])=>key!=='color'&&vs.length);
 const evidence=selected.flatMap(([key,vs])=>vs.map(v=>`Selected ${tagLabel(key,v)}.`));
 evidence.push(...guesses.flatMap(([key,values])=>values.map(v=>`AI guessed ${tagLabel(key,v)}; soft ordering only, not a selected filter.`)));
 if(q)evidence.push(`Catalog name/part/element search: ${query.trim()}; not confirmation.`);
 if(color)evidence.push(`Requested color: ${color}; availability is a tie-break, not identity evidence.`);
 if(!selected.length&&!q)evidence.push('Browse all catalog records. Add feature tags or a name/number to narrow the possibilities; no positive identity is inferred.');
 const contradictory=tags.profile?.includes('left')&&tags.profile.includes('right')||tags.top?.includes('smooth')&&tags.top.some(t=>topStudFeatures.has(t))||
  tags.top?.includes('smooth')&&tags.studs!==undefined&&Number(tags.studs[0])>0||tags.studs?.[0]==='0'&&tags.top?.some(t=>topStudFeatures.has(t));
 const colorId=data.colorIds[color],ranked:{row:TaggedRow;reasons:string[];cautions:string[];matched:number;missing:number;exact:number;color:number;guessMatched:number;guessMissing:number;guessConflicts:number}[]=[];
 if(contradictory)evidence.push('Selected feature tags conflict; correct the top-stud or handedness clues before selecting a mold.');
 for(const row of index.rows){
  if(contradictory)break;
  if((sizes.length||words.length)&&!(sizes.every(pair=>pair.some(v=>has(row.query,v)))&&words.every(w=>row.query.includes(w))))continue;
  let matched=0,missing=0,reject=false;const reasons:string[]=[],cautions:string[]=[];
  for(const [key,values] of selected){
   const actual=row.tags[key]??[];
   if(tagContradiction(key,values,actual)){reject=true;break;}
   for(const value of values){
    if(actual.some(a=>sameTag(key,value,a))){matched++;reasons.push(`Selected ${tagLabel(key,value)} is supported by saved catalog evidence.`);}
    else{missing++;cautions.push(`Catalog metadata does not establish ${tagLabel(key,value)}; inspect the exact piece.`);}
   }
  }
  if(reject)continue;
  // Explicit zero/smooth and a positive top-stud count cannot both be true.
  const requestedCount=tags.studs?.[0],actualCount=row.tags.studs?.[0];
  const requestedSmooth=tags.top?.includes('smooth'),actualSmooth=row.tags.top?.includes('smooth');
  if(requestedSmooth&&actualCount!==undefined&&Number(actualCount)>0||actualSmooth&&requestedCount!==undefined&&Number(requestedCount)>0||requestedCount==='0'&&row.tags.top?.some(t=>topStudFeatures.has(t))||actualCount==='0'&&tags.top?.some(t=>topStudFeatures.has(t)))continue;
  const exact=q&&row.num===q?2:q&&row.identifiers.some(id=>id===q)?1:0;
  if(exact)reasons.push(exact===2?'Exact queried mold number; compare its actual features.':'Exact saved element identifier belonging to this mold.');
  if(color){
   if(colorId===undefined)cautions.push('Requested color is not identified in the saved color table; verify color independently.');
   else if(!row.part.colors.includes(colorId))cautions.push('Requested color is unavailable in this record’s saved colors; the preview uses an actual saved color when available.');
  }
  let guessMatched=0,guessMissing=0,guessConflicts=0;
  for(const [key,values] of guesses)for(const value of values){
   const label=`AI guessed ${tagLabel(key,value)}`;
   const actual=row.tags[key]??[];
   const knownColor=key==='color'&&data.colorIds[value]!==undefined&&row.part.colors.length>0;
   const match=key==='color'?knownColor&&row.part.colors.includes(data.colorIds[value]):actual.some(a=>sameTag(key,value,a));
   const conflict=key==='color'?knownColor&&!match:guessedContradiction(key,value,row.tags);
   if(conflict){guessConflicts++;cautions.push(`${label} conflicts with saved catalog evidence; this candidate remains available.`);}
   else if(match){guessMatched++;reasons.push(`${label} matches saved catalog evidence; not confirmation.`);}
   else{guessMissing++;cautions.push(`Catalog metadata does not establish ${label}; check the piece.`);}
  }
  cautions.push('Catalog candidate only; exact identity, physical fit and available stock are not confirmed.');
  ranked.push({row,reasons,cautions,matched,missing,exact,color:colorId!==undefined&&row.part.colors.includes(colorId)?1:0,guessMatched,guessMissing,guessConflicts});
 }
 // Soft guesses can disagree with each other. Balance positive matches against
 // contradictions before tie-breaking, so sparsely described unrelated parts
 // do not outrank six matching clues just because their metadata says less.
 // Explicit user filters and queried identifiers retain their precedence.
 ranked.sort((a,b)=>(guesses.length?b.exact-a.exact:0)||Number(a.missing>0)-Number(b.missing>0)||b.matched-a.matched||a.missing-b.missing||b.exact-a.exact||
  (guesses.length?(b.guessMatched-b.guessConflicts)-(a.guessMatched-a.guessConflicts)||a.guessConflicts-b.guessConflicts||b.guessMatched-a.guessMatched||a.guessMissing-b.guessMissing:0)||b.color-a.color||
  (options.shortlist?Number(!!b.row.part.shape)-Number(!!a.row.part.shape):0)||
  (Number.isFinite(b.row.part.pop)?b.row.part.pop:0)-(Number.isFinite(a.row.part.pop)?a.row.part.pop:0)||a.row.part.num.localeCompare(b.row.part.num,'en'));
 // The full catalog stays unchanged. The comparison view groups decoration
 // variants out unless the person searches/asks for them or the scan saw one.
 const decorationRequested=!!tags.decoration?.length||guesses.some(([key])=>key==='decoration')||!!q;
 const comparable=options.shortlist?ranked.filter(r=>decorationRequested||!r.row.tags.decoration?.length):ranked;
 const strongest=comparable.reduce((best,r)=>Math.max(best,r.guessMatched),0);
 // Do not pad the five-choice view with unrelated shapes whose sparse metadata
 // merely avoids contradicting a guess. The full catalog still retains them.
 const shortlist=options.shortlist?comparable.filter(r=>r.exact||!guesses.length||r.guessMatched>=Math.max(1,strongest-2)).slice(0,5):ranked;
 const page=shortlist.slice(offset,offset+limit),nextOffset=offset+page.length<shortlist.length?offset+page.length:null;
 const facets=Object.fromEntries(Object.entries(index.facets).map(([key,vs])=>[key,vs?.map(v=>({...v}))])) as PartTagFacets;
 if(options.shortlist)evidence.push('Up to five candidates for visual comparison; full catalog and decoration variants remain available in expanded search.');
 return {parts:page.map(r=>({...copyCatalogPart(r.row.part),matchReasons:r.reasons,matchCautions:r.cautions})),count:shortlist.length,total:data.parts.length,offset,limit,hasMore:nextOffset!==null,nextOffset,
  facets,evidence,needsMoreEvidence:(!selected.length&&(!options.shortlist||!guesses.length))||!shortlist.length||shortlist[0].missing>0};
}
