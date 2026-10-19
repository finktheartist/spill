import { generateDecision, decisionProgress, GEMINI_INITIAL_TOKENS, type GeminiHopReceipt, type GeminiProgressCallback } from '../gemini-decode';
import { fetchWithRateLimitRetry, type RateLimitAttempt } from '../gemini-rate-limit';
// Shape-first builds: Gemini picks subjects and natural palettes from the pile's real color supply and describes
// each model as smooth volumes; code lays the bricks. Two modes:
//   'pile'     — only the person's own bricks; subjects are chosen so their natural colors fit the pile.
//   'shopping' — the person's bricks first, plus a list of parts to get, so the real colors can be used at a good size.
import { CATALOG, COLORS, COLOR_NAMES, parsePartId, type Build } from '../bricks';
import {isMade} from '../catalog';
import {moldUseText,MOLD_USE_BOUNDARY} from '../mold-use-guidance';
import { colorDist, layBricksExposed, layable, summary } from './bricklayer';
import { GOOD_TEXT, LIMITS, SHAPE_TEXT, programSchema, supplyTable, toSubject, type ShapeProgram } from './program';
import { studyGuidance } from '../moc-features';
import { IDEA_FAMILIES, discoveryPrompt, identityOf, loadIdeaHistory, rememberIdeas, selectDistinctIdeas, type IdeaIdentity, type IdeaStorage, type SeenIdea } from './discovery';
import { constructionKnowledgeText, type DesignKnowledge } from '../build-atlas/guidance';
import type {SubjectOpportunity} from '../build-atlas/opportunity';
import type {FeaturePiece,IdeaPartOpportunity} from './idea-opportunity';
import type {StockEvidence} from './stock-evidence';

export type ShapeMode = 'pile' | 'shopping';
/** '' in the browser (same-origin dev proxy); a full origin when run from Node. */
export const api = { base: '' };

interface Content { role: 'user' | 'model'; parts: Record<string, unknown>[] }
export interface Gen<T> {
  json: T; content: Content; seconds: number;
  hops?: GeminiHopReceipt[]; initialPromptTokenCount?: number | null;
  /** Physical HTTP responses, including 429 redeliveries, grouped by native hop. */
  deliveryAttempts?: (RateLimitAttempt & {hop:number})[];
}

/** Existing four-argument callers stay compatible. Progress is supported as
 * the fifth argument, or sixth with an undefined fifth for runner compatibility.
 * Both forms expose only sanitized hop metadata, never tokens or native parts.
 */
export async function generate<T>(contents: Content[], schema: unknown, signal?: AbortSignal, thinkingLevel = 'medium', onProgress?: GeminiProgressCallback, onHopProgress?: GeminiProgressCallback): Promise<Gen<T>> {
  const t0 = performance.now();
  // Kept as a compatibility hint; Gemini decisions always use high thinking.
  void thinkingLevel;
  const progress = onHopProgress ?? onProgress;
  const body: unknown = JSON.parse(JSON.stringify({ contents, generationConfig: {
    responseMimeType: 'application/json', responseSchema: schema,
    thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: GEMINI_INITIAL_TOKENS,
  } }));
  const deliveryAttempts: (RateLimitAttempt & {hop:number})[] = [];
  const result = await generateDecision({ body, signal,
    fetchHop: async (request, context) => {
      const delivery = await fetchWithRateLimitRetry({ body: JSON.stringify(request), signal: context.signal,
        fetchAttempt: (serialized, attempt) => fetch(`${api.base}/api/gemini`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: serialized, signal: attempt.signal,
        }),
        onRetry: progress ? retry => progress({ phase:'start',hop:context.hop,
          maxOutputTokens:request.generationConfig.maxOutputTokens,status:429,retry }) : undefined,
      });
      deliveryAttempts.push(...delivery.attempts.map(attempt => ({...attempt,hop:context.hop})));
      return delivery.response;
    },
    onHop: progress ? event => progress(decisionProgress(event)) : undefined,
  });
  const content = result.response.candidates[0].content;
  const text = content.parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (!text) throw new Error('Empty reply (STOP)');
  return { json: JSON.parse(text) as T, content: { role: 'model', parts: content.parts },
    seconds: (performance.now() - t0) / 1000, hops: result.hops, initialPromptTokenCount: result.initialPromptTokenCount, deliveryAttempts };
}

// ------------------------------------------------------------------ ideas

/** `real`: with a shopping list, the real thing's color for that area as the model gave it ('#rrggbb'). */
export interface PalettePick { role: string; color: string; cells: number; real?: string }
/** Small models: a defining feature and the special part type (in a pile color) it is built from. */
export interface IdeaFeature { feature: string; part: string; color: string; pieces?:FeaturePiece[];carriers?:FeaturePiece[] }
/** `features`: a small model built around the pile's special parts (see smallPile). */
export interface ShapeIdea { name: string; pitch: string; why: string; length: number; width: number; height: number; palette: PalettePick[]; features?: IdeaFeature[]; discovery?: IdeaIdentity; atlas?: {briefId:string;approachId:string}; construction?:DesignKnowledge;opportunity?:SubjectOpportunity;pieceOpportunity?:IdeaPartOpportunity }
export interface RankedIdea extends ShapeIdea { worst: number; cells: number; shortfall: number }

// Only your pile: the model picks from the pile's colors. With a shopping list it gives each area's real color as hex
// and trueColor picks the LEGO color: asked to pick names itself, it called the pile's yellow-orange "orange".
interface EditableIdeaContract { families:string[]; partIds:string[] }
const ideasSchema = (mode: ShapeMode, colors: string[], small = false, atlasIds:string[] = [], editable?:EditableIdeaContract) => ({
  type: 'OBJECT', required: ['ideas'], properties: { ideas: { type: 'ARRAY', items: {
    type: 'OBJECT', required: ['name', 'pitch', 'why', 'discovery', 'length', 'width', 'height', 'palette', ...(small||mode==='pile' ? ['features'] : []),...(atlasIds.length?['atlasId']:[])],
    propertyOrdering: ['name', 'pitch', 'why', 'discovery', 'length', 'width', 'height', 'palette', ...(small ? ['features'] : [])],
    properties: {
      name: { type: 'STRING' }, pitch: { type: 'STRING' }, why: { type: 'STRING' },
      ...(atlasIds.length?{atlasId:{type:'STRING',enum:[...atlasIds,'new-idea']}}:{}),
      discovery: { type:'OBJECT', required:['family','concept','form'], properties:{ family:{type:'STRING',enum:Object.keys(IDEA_FAMILIES)}, concept:{type:'STRING'}, form:{type:'STRING'} } },
      length: { type: 'NUMBER' }, width: { type: 'NUMBER' }, height: { type: 'NUMBER' },
      palette: { type: 'ARRAY', items: mode === 'pile'
        ? { type: 'OBJECT', required: ['role', 'color', 'cells'], properties: { role: { type: 'STRING' }, color: { type: 'STRING', enum: colors }, cells: { type: 'NUMBER' } } }
        : { type: 'OBJECT', required: ['role', 'real', 'cells'], properties: { role: { type: 'STRING' }, real: { type: 'STRING', description: 'The real thing’s color in this area, #rrggbb' }, cells: { type: 'NUMBER' } } } },
      ...(small||mode==='pile' ? { features: { type: 'ARRAY', items: { type: 'OBJECT', required: ['feature', 'part', 'color','pieces','carriers'], properties: { feature: { type: 'STRING' }, part: { type: 'STRING',...(editable?{enum:editable.families}:{}) }, color: { type: 'STRING', enum: colors },
        ...Object.fromEntries(['pieces','carriers'].map(key=>[key,{type:'ARRAY',items:{type:'OBJECT',required:['partId','count'],properties:{partId:{type:'STRING',...(editable?{enum:editable.partIds}:{})},count:{type:'INTEGER'}}}}])) } } } } : {}),
    },
  } } },
});

/** What builders use each special part for (several uses each, so no one subject is suggested). */
const PART_USES: Record<string, string> = {
  cheese: '1x1, 2 plates tall, slopes down to one side: small tapered tips, chamfers, roof edges, pointed anatomy',
  curve: '1x2 and 2x2 are 2 plates tall; 1x3 is 3 plates. Studless rounded face, stepped underside with the back socket row raised 1 plate: smooth housings, shells and rounded anatomy',
  slope: 'a brick tall, 45 degrees down to one side: inclined surfaces, roofs, wedges, fins, tapered anatomy',
  invslope: 'a brick tall, slants underneath: projecting rims, supported overhangs, tapered undersides',
  roundbrick: 'round, a brick tall: narrow stems, columns, cylinders, containers, trunks, legs',
  roundplate: 'round, a plate tall: dials, caps, lights, circular details, feet',
  tile: 'flat, no studs: smooth tops, layered covers, control surfaces, decks, water',
  cornerplate: 'L-shaped plate: open corners, frames, angled footprints, branching surfaces',
};

/** The pile's special parts by type, with what builders use them for, then sizes and colors (most first). */
export function signatureParts(stock: Record<string, number>) {
  const by = new Map<string, string[]>(),exact:string[]=[];
  for (const [id, n] of Object.entries(stock).sort((a, b) => b[1] - a[1])) {
    const k = parsePartId(id);
    if (!k || !Number.isSafeInteger(n) || n < 1) continue;
    const meaning=moldUseText(k);
    if(meaning){if(isMade(id))exact.push(`- ${id} × ${n}: ${meaning}`);continue;}
    if (!PART_USES[k.type]) continue;
    by.set(k.type, [...(by.get(k.type) ?? []), `${k.w}x${k.d} ${k.color}${n > 1 ? ' ×' + n : ''}`]);
  }
  return [...[...by.entries()].map(([t, l]) => `- ${t} (${PART_USES[t]}): ${l.join(', ')}`),...exact,...(exact.length?[MOLD_USE_BOUNDARY]:[])].join('\n');
}

/** Each feature becomes its own palette role (a few cells), so the design can name the parts it is built from. */
const withFeatureRoles = (idea: ShapeIdea): ShapeIdea => ({
  ...idea, palette: [...(idea.palette ?? []), ...(idea.features ?? []).map(f => ({ role: f.feature, color: f.color, cells: 4 }))],
});

/** Colors the builder can lay (bricks and plates), biggest first, with what each covers on a rounded body. */
export function pileColors(stock: Record<string, number>) {
  return supplyTable(stock).filter(t => t.roundedCells > 0);
}

const SOLID_COLORS = COLOR_NAMES.filter(c => !c.startsWith('trans-'));

/** With a shopping list: the LEGO color for a real color ('#rrggbb'), the nearest solid color by measured distance,
 * or one the pile has when it's within 4 ΔE of that (indistinguishable, and nothing to buy). A color name passes through. */
export function trueColor(real: string, pile: Set<string>): string | null {
  const v = real.trim().toLowerCase();
  if ((SOLID_COLORS as string[]).includes(v)) return v;
  const hex = /^#?[0-9a-f]{6}$/.test(v) ? `#${v.replace('#', '')}` : null;
  if (!hex) return null;
  const near = SOLID_COLORS.map(c => ({ c, d: colorDist(hex, c) })).sort((a, b) => a.d - b.d);
  return (near.find(n => pile.has(n.c) && n.d <= near[0].d + 4) ?? near[0]).c;
}

export function ideasPrompt(mode: ShapeMode, stock: Record<string, number>, n: number, avoid: string[], small = false) {
  const table = pileColors(stock);
  if (small) {
    // Small piles: start from the special parts, the way builders do (qa/parts-first-20261013). The 70% rule is
    // there because four of that run's five patched-color drafts had a color asked for at 85–95% of what it covers.
    const special = signatureParts(stock);
    return `Here is everything in one person's pile of loose LEGO bricks, by color, biggest first. "covers" is about how many visible surface cells that color's parts can cover on a rounded model (bricks and plates anywhere; tiles, curves and slopes only on tops and edges):
${table.map(t => t.text).join('\n')}

${special ? `Its signature parts, the special pieces that give small LEGO models their identity (what builders use them for, then sizes and colors in this pile):
${special}` : 'It has no special parts (slopes, curves, tiles or round parts), only bricks and plates.'}

This pile is too small for a big sculpture. Propose ${n} different SMALL models (about 20–45 parts, 5–10 studs long) it can build convincingly ONLY from its own parts, in their natural colors. Work the way builders do with a small pile: start from the signature parts. Choose subjects whose defining features those parts can form, so the model reads at a glance even though it is small, and whose real colors this pile has enough of.
Rules for every idea:
- At most 3 main colors in natural roles for that subject, plus at most 2 small accent colors. Never invent costumes, stripes or patterns to use up colors.
- Keep every color's cells under about 70% of what it covers. A small pile runs out fast, and a color that runs out gets patched with others, which makes a small model unreadable.
- Give its size in studs (length × width × height) and, for each palette color, about how many visible surface cells it would cover (a small model about 7 × 4 × 5 studs shows roughly 130 cells).
- ${special ? '2–4 signature features, each made from one signature part type in one color that this pile has (feature, part, color).' : 'features: none (leave the list empty).'}
- Make the ${n} ideas genuinely different kinds of things.
For each: name (1–3 words), pitch (12 words or fewer), why (15 words or fewer: which parts make it work), size, palette entries {role, color, cells}, features {feature, part, color}.
${avoid.length ? `Already suggested for this pile, so choose others: ${avoid.join(', ')}.\n` : ''}`;
  }
  const common = `Rules for every idea:
- Its look comes from at most 3 main colors in natural roles for that subject (the colors the real thing has), plus at most 2 small accent colors (eyes, nose, a door, a beak) covering under 20 visible cells. Never invent clothing, costumes, saddles, stripes or patterns to use up colors; use a pattern only when the real subject has it.
- Give its size in studs (length × width × height, at most ${LIMITS.length} × ${LIMITS.width} × ${LIMITS.height}) and, for each palette color, about how many visible surface cells (1 stud wide × 1 plate tall) it would cover at that size. A compact model about 10 × 6 × 8 studs shows roughly 300 cells.
- Make the ${n} ideas genuinely different kinds of things.
For each: name (1–3 words), pitch (12 words or fewer), why (15 words or fewer: which of this pile's colors make it work${mode === 'pile' ? '' : ', counting only colors the real thing has'}), size, palette entries ${mode === 'pile' ? '{role, color, cells}' : '{role, real, cells}'}.
${avoid.length ? `Already suggested for this pile, so choose others: ${avoid.join(', ')}.\n` : ''}`;
  const colors = table.map(t => `${t.text}`).join('\n');
  return mode === 'pile'
    ? `Here is everything in one person's pile of loose LEGO bricks, by color, biggest first. "covers" is about how many visible surface cells that color's parts can cover on a rounded model (bricks and plates anywhere; tiles, curves and slopes only on tops and edges):
${colors}

Propose ${n} different things this pile can build convincingly ONLY from its own bricks, in their natural colors. Choose subjects whose real colors are this pile's biggest colors, and make each as large as those colors comfortably allow (ideally 250–500 visible cells). Keep every color's cells under about 80% of what it covers: the builder needs slack, and a color that runs out gets patched with others.
${common}`
    : `Here is everything in one person's pile of loose LEGO bricks, by color, biggest first. "covers" is about how many visible surface cells that color's parts can cover on a rounded model (bricks and plates anywhere; tiles, curves and slopes only on tops and edges):
${colors}

Propose ${n} different, impressive models (about 120–250 parts, 500–900 visible cells) to build from this pile plus a short shopping list. Use each subject's real colors at a satisfying size. Keep the list short by choosing subjects whose real colors are this pile's biggest colors; anything the pile lacks will be bought.
For each palette entry, "real" is the color that area of the real thing has, as #rrggbb. Describe the real thing, not the pile: the program picks the closest LEGO color itself and uses this pile's bricks wherever they are that color. What the pile's colors look like: ${table.map(t => `${t.color} ${(COLORS as Record<string, string>)[t.color]}`).join(', ')}.
${common}`;
}

/** Worst color fit (cells ÷ covers), total cells and the cells that would have to be bought, per idea. */
export function rankIdeas(ideas: ShapeIdea[], stock: Record<string, number>, mode: ShapeMode): RankedIdea[] {
  const covers = Object.fromEntries(pileColors(stock).map(t => [t.color, t.roundedCells]));
  const ranked = ideas.filter(i => i.name && i.palette?.length).map(i => {
    const byColor: Record<string, number> = {};
    for (const p of i.palette) byColor[p.color] = (byColor[p.color] ?? 0) + Math.max(0, p.cells || 0);
    const worst = Math.max(...Object.entries(byColor).map(([c, n]) => n / Math.max(1, covers[c] ?? 0)));
    const cells = Object.values(byColor).reduce((a, b) => a + b, 0);
    const shortfall = Object.entries(byColor).reduce((s, [c, n]) => s + Math.max(0, n - (covers[c] ?? 0)), 0);
    return { ...i, worst, cells, shortfall };
  });
  return mode === 'pile'
    ? ranked.sort((a, b) => (+(a.worst > 0.9) - +(b.worst > 0.9)) || b.cells - a.cells)
    : ranked.sort((a, b) => a.shortfall / Math.max(1, a.cells) - b.shortfall / Math.max(1, b.cells) || b.cells - a.cells);
}

/** `small`: small models built around the pile's special parts (see smallPile); each idea keeps its features. */
export async function proposeIdeas(mode: ShapeMode, stock: Record<string, number>, n = 6, avoid: string[] = [], signal?: AbortSignal, small = false, storage?: IdeaStorage,evidence?:StockEvidence,editable=false,onProgress?:GeminiProgressCallback) {
  const active=()=>{if(signal?.aborted)throw new DOMException('Stopped','AbortError');}; active();
  const history:SeenIdea[]=[...loadIdeaHistory(mode,stock,storage),...avoid.map(name=>({name}))];
  const {atlasShortlist,shortlistText,attachCatalogKnowledge}=await import('../build-atlas/selection');active();
  const {createOpportunityContext}=await import('../build-atlas/opportunity'),{assessIdeaParts}=await import('./idea-opportunity');active();
  const context=createOpportunityContext(stock,{confidence:evidence?.confidenceById});
  const editableContract=editable?{families:[...new Set(context.parts.map(p=>p.kind.type))].sort(),partIds:context.parts.map(p=>p.id).sort()}:undefined;
  const schemaColors=editable?[...new Set(context.parts.map(p=>p.kind.color))].sort():pileColors(stock).map(t=>t.color);
  const shortlist=atlasShortlist(mode,stock,history,36,{confidence:evidence?.confidenceById});
  const partFloor=editable?20:small?MIN_SMALL_PARTS:MIN_PILE_PARTS;
  const piecePrompt=mode==='pile'?`\n\nEXACT USABLE STOCK (id, count, dimensions in studs, height in plates, raw scan confidence or null=unknown):\n${JSON.stringify(context.parts.map(p=>({id:p.id,count:p.count,w:p.widthStuds,d:p.depthStuds,heightPlates:p.heightPlates,confidence:p.confidence})))}\nBefore choosing each subject, plan 2–4 defining features: {feature,part,color,pieces:[{partId,count}],carriers:[{partId,count}]}. Reserve exact copies for each feature AND its actual supporting/mounting parts. A carrier list may be empty only when no extra carrier is needed. Do not spend the same two curves on both ears and tail; feature allocations share one ledger. Leave at least ${Math.max(4,Math.ceil(partFloor*.25))} studded body pieces. Prefer subjects with alternative shapes left over, coherent body colors and no unsupported axles or side mounts. Static representations are allowed when described honestly. Low scan confidence is caution, not a calibrated probability; null is unknown. These are candidate piece plans, not proof of shape or a legal complete build. Do not claim that geometry was checked. Keep subjects broad across families when feature fit is comparable.`:'';
  const count=editable?6:Math.min(24,Math.max(18,n*3)), candidates:ShapeIdea[]=[];
  const prompt=editable?`Propose ${count} genuinely different subject candidates for excellent compact LEGO miniatures using ONLY this pile. Each finished model will use 20–80 purposeful pieces and fit within24studs on each axis. Choose subjects from different families based on actual specialist shapes, coherent colors and their real mounting parts. Work backwards from two to four feasible defining features, then select scale and body supply. Upright quarter-yaw parts only; do not choose a subject whose indispensable geometry needs sideways mounts or missing hardware. Unused stock is allowed; avoid generic decorated boxes, unsupported moving mechanisms and subjects requiring most pieces in an absent color. No predetermined subject or family is required.
For each return name, pitch, why (which actual shapes make it promising), length/width/height in studs, palette entries {role,color,cells} with estimated visible coverage, and features with exact piece/carrier reservations. Use at most3 main colors and2 small accents in sensible subject roles. Keep color coverage comfortably below supply. Estimated color coverage is not proof of a build.
Feature contract: feature.part is ONE exact native family type from ${JSON.stringify(editableContract?.families)} (for example "tile" or "curve"), never a descriptive phrase such as "tile 1x8" or "white curve-1x3-white". feature.color is ONE exact usable stock color from ${JSON.stringify(schemaColors)}. For a mixed-shape feature, choose one primary family/color actually present among its reserved pieces, and put all exact shapes/counts in the pieces and carriers arrays. Every pieces/carriers partId must be one of the EXACT USABLE STOCK IDs below, even when a catalog suggestion mentions another mold. Dimensions remain studs; piece heights in the stock table are plates.
Color supply: ${pileColors(stock).map(t=>t.text).join('\n')}
Signature shape opportunities: ${signatureParts(stock)}`:ideasPrompt(mode,stock,count,[],small);
  const contents:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[{text:
    prompt+piecePrompt+'\n\n'+discoveryPrompt(history,count)+(shortlist.length?'\n\n'+shortlistText(shortlist):'')}]}];
  let seconds=0, selection:ReturnType<typeof selectDistinctIdeas<RankedIdea>>={selected:[],rejected:[]};
  // One bounded refill if the model ignored exclusions or supplied fewer than three new concepts.
  for(let round=0;round<2;round++) {
    const r=await generate<{ideas:(ShapeIdea&{atlasId?:string})[]}>(contents,ideasSchema(mode,schemaColors,small,shortlist.map(a=>a.brief.id),editableContract),signal,'low',onProgress); active();
    seconds+=r.seconds;contents.push(r.content);
    candidates.push(...(Array.isArray(r.json.ideas)?r.json.ideas:[]).filter(i=>i&&typeof i.name==='string'&&Array.isArray(i.palette)).map(i=>attachCatalogKnowledge({...i,discovery:identityOf(i.discovery)},shortlist,stock)));
    const assessed=mode==='pile'?candidates.map(i=>({...i,pieceOpportunity:assessIdeaParts(i,context,partFloor)})):candidates;
    const eligible=assessed.filter(i=>mode!=='pile'||((!i.pieceOpportunity||!['blocked','unverified'].includes(i.pieceOpportunity.tier))&&i.opportunity?.tier!=='blocked'));
    const ideas=small?eligible.map(i=>withFeatureRoles({...i,features:i.features??[]})):eligible;
    selection=selectDistinctIdeas(rankIdeas(withTrueColors(ideas,context.stock,mode),context.stock,mode),n,history,mode);
    selection.rejected.push(...assessed.filter(i=>!eligible.includes(i)).map(i=>({name:i.name,reason:[...(i.pieceOpportunity?.blockers??[]),...(i.opportunity?.blockers.map(b=>b.detail)??[])].join(' ')})));
    if(selection.selected.length>=Math.min(3,n))break;
    contents.push({role:'user',parts:[{text:`Only ${selection.selected.length} distinct new concepts survived. Suggest ${count} different candidates from unexplored families. Excluded or duplicate: ${JSON.stringify(selection.rejected)}. Already retained: ${JSON.stringify(selection.selected.map(i=>({name:i.name,discovery:i.discovery})))}. Do not repeat any of those, or any previous-history concept. Preserve the original inventory and quality constraints.`}]});
  }
  active();
  // Retain all selected candidates, including backups and later failures, before construction starts.
  rememberIdeas(mode,stock,selection.selected,storage);
  const {rememberAtlasIds}=await import('../build-atlas/history');active();
  rememberAtlasIds(mode,stock,selection.selected.flatMap(i=>i.atlas?[i.atlas.briefId]:[]));
  return {ranked:selection.selected,seconds,exploration:{candidates:candidates.length,catalogShortlist:shortlist.length,history:history.length,rejected:selection.rejected,selected:selection.selected.map(i=>({name:i.name,discovery:i.discovery,atlas:i.atlas,pieceOpportunity:i.pieceOpportunity,opportunity:i.opportunity}))}};
}

/** With a shopping list: each palette entry's LEGO color from the real color the model described (see trueColor). */
export function withTrueColors(ideas: ShapeIdea[], stock: Record<string, number>, mode: ShapeMode): ShapeIdea[] {
  if (mode === 'pile') return ideas;
  const pile = new Set(pileColors(stock).map(t => t.color));
  return ideas.map(i => ({ ...i, palette: (i.palette ?? []).flatMap(p => { const color = trueColor(p.real ?? p.color ?? '', pile); return color ? [{ ...p, color }] : []; }) }));
}

// ------------------------------------------------------------------ design

/** Stand-in shades that still read as the same natural color (a lighter or darker version), hand-picked:
 * measured color distance alone let pink and sand green pass for white. */
export const SHADE_FAMILY: Record<string, string[]> = {
  white: ['light-gray'], 'light-gray': ['white', 'dark-gray'], 'dark-gray': ['light-gray', 'black'], black: ['dark-gray'],
  'reddish-brown': ['dark-brown', 'medium-nougat'], 'dark-brown': ['reddish-brown'], 'medium-nougat': ['nougat', 'reddish-brown'], nougat: ['medium-nougat'],
  tan: ['dark-tan'], 'dark-tan': ['tan'], red: ['dark-red'], 'dark-red': ['red'], orange: ['dark-orange', 'bright-light-orange'], 'dark-orange': ['orange'],
  yellow: ['bright-light-orange'], 'bright-light-orange': ['yellow'], blue: ['dark-blue', 'medium-blue'], 'dark-blue': ['blue'], 'medium-blue': ['blue', 'dark-azure'],
  azure: ['dark-azure', 'medium-blue'], 'dark-azure': ['azure', 'medium-blue'], green: ['dark-green', 'bright-green'], 'dark-green': ['green'], 'bright-green': ['green', 'lime'], lime: ['bright-green'],
  pink: ['bright-pink'], 'bright-pink': ['pink'], 'sand-green': ['dark-green'], 'dark-turquoise': ['dark-azure'],
};

/** Each role's color plus its stand-in shades that the pile actually has, so 'natural' survives substitution. */
export function rolePalette(idea: ShapeIdea, stock: Record<string, number>, mode: ShapeMode) {
  const inPile = new Set(Object.keys(stock).map(id => parsePartId(id)?.color).filter(Boolean) as string[]);
  const roles: Record<string, string[]> = {};
  for (const p of idea.palette) {
    const shades = mode === 'pile' ? (SHADE_FAMILY[p.color] ?? []).filter(c => inPile.has(c)) : [];
    roles[p.role] = [...new Set([...(roles[p.role] ?? []), p.color, ...shades])];
  }
  return roles;
}

/** A small model's signature features, each from its named part (the prompt the parts-first prototype was tested with). */
function featuresText(idea: ShapeIdea, stock: Record<string, number>) {
  const have = (f: IdeaFeature) => Object.entries(stock).filter(([id, n]) => { const k = parsePartId(id); return n > 0 && k?.type === f.part && k.color === f.color; })
    .map(([id, n]) => `${n} × ${id.replace(/-[a-z-]+$/, '')}`).join(', ') || 'none in that color';
  return `SIGNATURE FEATURES
This is a small model: like builders' small models, its identity comes from a few special parts. Build these features from the named parts:
${idea.features!.map(f => `- ${f.feature}: ${f.part} in ${f.color} (the pile has ${have(f)})`).join('\n')}
For each feature, keep its palette role and set that role's "parts" to the part type. Give it its own small volume where that part can go: cheese slopes, curved slopes and tiles only where nothing sits on top of them; 45-degree slopes along an outer top edge, low side facing outward; inverted slopes under an overhang; round bricks as upright posts. Size each feature's volume to the parts it should hold: at least 1 stud across and 1.2 studs tall, 2 studs wide if it sits on the center line. Keep the whole model small (about ${idea.length} × ${idea.width} × ${idea.height} studs): every part counts.`;
}

export function designPromptFor(idea: ShapeIdea, mode: ShapeMode, stock: Record<string, number>) {
  const roles = rolePalette(idea, stock, mode);
  const covers = Object.fromEntries(pileColors(stock).map(t => [t.color, t.roundedCells]));
  const small = mode === 'pile' && smallPile(pileReach(stock));
  const supply = `The pile's colors set the limit; roughly how many visible cells each can cover: ${Object.values(roles).flat().filter((c, i, a) => a.indexOf(c) === i).map(c => `${c} ~${covers[c] ?? 0}`).join(', ')}. The program shrinks the model if the pile can't cover it, so get the proportions right rather than oversizing.`;
  return `Design a LEGO model of: ${idea.name}. ${idea.pitch}
${mode === 'pile'
    ? "It will be built ONLY from one person's own pile of loose bricks."
    : "It will be built from one person's own pile first; parts the pile lacks go on a short shopping list, so it can use the real thing's colors at a satisfying size."} You do not place bricks. You describe the subject's 3D SHAPE as a few smooth volumes, and a program turns that shape into a real, buildable brick model.

${SHAPE_TEXT}
- Colors: use exactly these roles, in these natural colors, and nothing else: ${Object.entries(roles).map(([r, cs]) => `${r} = ${cs.join(' (or ')}${cs.length > 1 ? ')' : ''}`).join('; ')}. "palette" maps each role to its colors as listed, first choice first. "paint" rules recolor the parts of the named volumes ("*" = all, or a name prefix ending in "*") inside zMin–zMax, xMin–xMax and |y| ≤ yMax, for markings the real subject has; later rules win. Use −99 and 99 for no limit. Never add a color, costume or pattern the real subject doesn't have.

SIZE
${mode === 'pile'
    ? small
      ? `Keep it small: about ${idea.length} × ${idea.width} × ${idea.height} studs (length × width × height), about 20–45 parts. ${supply}`
      : `Aim for about ${idea.length} × ${idea.width} × ${idea.height} studs (length × width × height). ${supply} Below about ${MIN_PILE_CELLS} visible cells (${MIN_PILE_PARTS} parts) a model no longer reads as its subject, so never design it smaller than that.`
    : `Make it impressive: about ${idea.length} × ${idea.width} × ${idea.height} studs, at most ${LIMITS.length} × ${LIMITS.width} × ${LIMITS.height}. Parts the pile lacks will be bought, so size is limited by good proportions, not by the pile.`}

${GOOD_TEXT}

${constructionKnowledgeText(idea)}

${mode === 'pile' ? studyGuidance(`${idea.name} ${idea.pitch}`, stock, Object.values(roles).flat()) : ''}

Fill "thinking" first with a short plan: the defining features and proportions, where each role's color goes, and how each feature attaches. Then give the overall length, width and height in studs, the palette, the volumes and the paint rules.${small && idea.features?.length ? `\n\n${featuresText(idea, stock)}` : ''}`;
}

export async function designIdea(idea: ShapeIdea, mode: ShapeMode, stock: Record<string, number>, signal?: AbortSignal) {
  const allowed = [...new Set(Object.values(rolePalette(idea, stock, mode)).flat())];
  const contents: Content[] = [{ role: 'user', parts: [{ text: designPromptFor(idea, mode, stock) }] }];
  const r = await generate<ShapeProgram>(contents, programSchema(allowed), signal);
  return { program: r.json, contents: [...contents, r.content], seconds: r.seconds, schemaColors: allowed };
}

export async function reviseDesign(contents: Content[], report: string, schemaColors: string[], signal?: AbortSignal) {
  const next: Content[] = [...contents, { role: 'user', parts: [{ text: report }] }];
  const r = await generate<ShapeProgram>(next, programSchema(schemaColors), signal);
  return { program: r.json, seconds: r.seconds };
}

// ------------------------------------------------------------------ deterministic fitting (runs in a worker on the page)

export const FITS = [1, 0.9, 0.8, 0.7, 0.6];
export interface Fitted { fit: number; build: Build; s: ReturnType<typeof summary>; clean: boolean }

/** Good enough to show: big enough to read (MIN_PILE_PARTS; a small pile's small models MIN_SMALL_PARTS), ≥85% of the
 * visible surface in its own (natural) colors, ≤2% missing, no construction issues. */
export const ON_PALETTE_MIN = 0.85;
/** Smaller pile builds of sculpture designs have never read as their subject in any test (4–25 parts: "unidentifiable
 * block assembly"; recognizable ones start around 70), so they aren't shown. */
export const MIN_PILE_PARTS = 40;
/** About what a 40-part model shows: earlier designs measured 3–5 visible cells per part. */
export const MIN_PILE_CELLS = 160;
/** A pile that reaches less can't cover a compact sculpture (about 10 × 6 × 8 studs shows ~300 cells). The 152-part photo
 * pile reaches ~205, and every sculpture designed for it came out under MIN_PILE_PARTS in its own colors, so such a pile
 * gets small models built around its special parts instead (qa/parts-first-20261013): from MIN_SMALL_PARTS, and shown
 * only when the blind reviewer can tell what they are. */
export const SMALL_PILE_CELLS = 300;
/** The smallest small model tried. The first one the reviewer named on the photo pile (a kingfisher) had 36 parts
 * showing 78 cells; 20 parts show about 45. */
export const MIN_SMALL_PARTS = 20;
/** Below this reach not even a small model fits in the pile's best colors, so nothing is tried (no model calls). */
export const MIN_SMALL_CELLS = 100;
export const isClean = (s: ReturnType<typeof summary>, minParts = MIN_PILE_PARTS) => !s.issues.length && s.onPalette >= ON_PALETTE_MIN && s.visibleHoles <= 0.02 && s.looseRemoved <= 4 && s.parts >= minParts;

export interface PileReach { cells: number; colors: string[]; parts: number; colorCount: number }
/** The most visible cells a pile-only design can show: its best three main colors with the stand-in shades the pile
 * has, at the 80% the ideas are asked to stay under (fuller designs come out patched), plus 20 cells of accents. Below
 * MIN_PILE_CELLS no subject reaches MIN_PILE_PARTS, so no model calls are made. `parts` and `colorCount` describe the
 * pieces the builder can lay, for the message. */
export function pileReach(stock: Record<string, number>): PileReach {
  const covers = Object.fromEntries(pileColors(stock).map(t => [t.color, t.roundedCells]));
  const names = Object.keys(covers);
  const family = (c: string) => [c, ...(SHADE_FAMILY[c] ?? []).filter(s => s in covers)];
  let best = { cells: 0, colors: [] as string[] };
  const pick = (cs: string[]) => {
    const cells = [...new Set(cs.flatMap(family))].reduce((n, c) => n + covers[c], 0);
    if (cells > best.cells) best = { cells, colors: cs };
  };
  for (let i = 0; i < names.length; i++) {
    pick([names[i]]);
    for (let j = i + 1; j < names.length; j++) {
      pick([names[i], names[j]]);
      for (let k = j + 1; k < names.length; k++) pick([names[i], names[j], names[k]]);
    }
  }
  let parts = 0;
  const colors = new Set<string>();
  for (const [id, n] of Object.entries(stock)) {
    const k = parsePartId(id);
    if (k && layable(k.type) && n > 0) { parts += n; colors.add(k.color); }
  }
  return { cells: Math.round(best.cells * 0.8) + 20, colors: best.colors, parts, colorCount: colors.size };
}
/** Only your pile: too small for a sculpture, so small models (see SMALL_PILE_CELLS). */
export const smallPile = (reach: PileReach) => reach.cells < SMALL_PILE_CELLS;
const fitScore = (f: Fitted) => (f.clean ? 10 : 0) + f.s.onPalette - 2 * f.s.visibleHoles + 0.002 * f.s.parts - (f.s.issues.length ? 10 : 0);

/** Only the pile: the largest size that's clean (see ON_PALETTE_MIN). Bigger drafts in patched colors were tried on a
 * small pile (65–75 parts at 50–79% of their own colors): the blind review saw "unidentifiable block assembly" every time. */
export function fitPile(program: ShapeProgram, stock: Record<string, number>, minParts = MIN_PILE_PARTS) {
  const colors = new Set(Object.keys(stock).map(id => parsePartId(id)?.color).filter(Boolean) as string[]);
  const tries: Fitted[] = [];
  for (const fit of FITS) {
    const r = layBricksExposed(toSubject(program, colors, 3, fit).subject, stock);
    const s = summary(r);
    const f = { fit, build: { ...r.build, name: program.name, description: program.pitch }, s, clean: isClean(s, minParts) };
    tries.push(f);
    if (f.clean) break;
  }
  const best = tries.find(t => t.clean) ?? [...tries].sort((a, b) => fitScore(b) - fitScore(a))[0];
  return { best, tries: tries.map(t => ({ fit: t.fit, parts: t.s.parts, onPalette: t.s.onPalette, holes: t.s.visibleHoles, clean: t.clean })), full: tries[0] };
}

/** Pile first, buying only what's missing: every brick and plate in the palette colors can be bought. */
export function fitShopping(program: ShapeProgram, stock: Record<string, number>) {
  const colors = new Set(Object.keys(stock).map(id => parsePartId(id)?.color).filter(Boolean) as string[]);
  const buyable: Record<string, number> = { ...stock };
  for (const c of new Set(program.palette.flatMap(e => e.colors))) for (const t of ['brick', 'plate', 'roundbrick', 'roundplate', 'slope'] as const) for (const sz of CATALOG[t]) {
    const id = `${t}-${sz}-${c}`; buyable[id] = (stock[id] ?? 0) + 999;
  }
  const r = layBricksExposed(toSubject(program, new Set([...colors, ...program.palette.flatMap(e => e.colors)]), 3, 1).subject, buyable, 3, { pile: stock, buyPenalty: 30 });
  const s = summary(r);
  // Count from the finished build (after slope swaps and stray-piece removal), the same way the parts list does.
  const used: Record<string, number> = {};
  for (const p of r.build.steps.flatMap(st => st.parts)) used[p.partId] = (used[p.partId] ?? 0) + 1;
  const bought: Record<string, number> = {};
  for (const [id, n] of Object.entries(used)) if (n > (stock[id] ?? 0)) bought[id] = n - (stock[id] ?? 0);
  const toGet = Object.values(bought).reduce((a, b) => a + b, 0);
  return { build: { ...r.build, name: program.name, description: program.pitch }, s, bought, toGet, fromPile: s.parts - toGet, inventory: buyable };
}

/** What a revision needs to know: per color zone, how much of the visible surface came out in its own colors. */
export function trialReport(program: ShapeProgram, full: Fitted, chosenFit: number | null, small = false) {
  const roles = Object.entries(full.s.byRole).sort((a, b) => b[1].visible - a[1].visible).map(([role, e]) => {
    const instead = Object.entries(e.usedInstead).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ${n}`).join(', ');
    return `- ${role}: ${e.visible} visible cells, ${Math.round(100 * e.on / Math.max(1, e.visible))}% in its own colors${e.holes ? `, ${e.holes} missing` : ''}${instead ? `; the rest came out as ${instead}` : ''}`;
  });
  return `A trial build from the pile at your designed size (${program.length}×${program.width}×${program.height} studs) used ${full.s.parts} parts: ${Math.round(full.s.onPalette * 100)}% of the visible surface came out in its own colors (target: ${Math.round(ON_PALETTE_MIN * 100)}%), ${(full.s.visibleHoles * 100).toFixed(1)}% was missing.
${roles.join('\n')}
${chosenFit ? `It only met the target when shrunk to ${Math.round(chosenFit * 100)}% of your design.` : 'It never met the target, even at 60% of your design.'}
${small
    ? `Keep the subject, its natural colors and its signature features. Change the proportions, the size, or which areas use which of your roles so the pile covers it; a small model is fine, from about ${MIN_SMALL_PARTS} parts. Return the complete program.`
    : `Keep the subject and its natural colors. Change the proportions, the size, or which areas use which of your roles so the pile covers it at a good size, and keep it at least ${MIN_PILE_PARTS} parts (about ${MIN_PILE_CELLS} visible cells): smaller doesn't read as the subject. Return the complete program.`}`;
}

export { LIMITS };
