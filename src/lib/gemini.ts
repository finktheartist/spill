import {popularMold} from './popular-molds';
import { generateDecision, DecisionDecodeError, GEMINI_INITIAL_TOKENS } from './gemini-decode';
import { fetchWithRateLimitRetry, type RateLimitAttempt } from './gemini-rate-limit';
import { animalReplanSpecs, animalCoatColors, animalStockGuidance, animalRequest, animalSpec, animalShapeKey, createAnimalTarget, animalAnatomyIssues, ANIMAL_ANATOMY_BRIEF, ANIMAL_SPEC_SCHEMA, type AnimalCandidate } from './animal-anatomy';
import { allocateAnimalTarget } from './animal-anatomy-fit';
import { CONNECTION_PATCH_SCHEMA, connectionGeometryKey, patchConnectionDraft, connectionRevisionWins, type ConnectionDraft } from './connection-revision';
import { fitTechniqueProgram } from './technique-fit';
import { allocatePavilions } from './pavilion-fit';
import { pavilionIssues, pavilionRequest, pavilionStockHint, type PavilionCandidate } from './pavilion-modules';
import { createObjectTarget, objectFamily, objectSpec, objectPlanSchema, objectLayoutIssues, OBJECT_LAYOUT_BRIEF, type ObjectFamily } from './object-layout';
import { allocateObjectTarget } from './object-layout-fit';
import { fitConnectionProgram } from './connection-fit';
import { subjectConstructionChoices, constructionChoices, constructionChoiceText, captionTechniques, expandTechniques, TECHNIQUE_PROGRAM_SCHEMA, TECHNIQUE_PROGRAM_BRIEF, type ConstructionChoice, type TechniqueReceipt, type TechniqueProgram } from './construction-techniques';
import { connectorText, connectorShapeText, definition, connectionOnly, compileConnections, type ConnectionProgram } from './connections';
// Every Gemini call goes through the local /api/gemini proxy, which selects Gemini
// with high thinking by default and adds the key. Its server policy overrides legacy
// per-call thinking hints. Gemini designs; the validator in bricks.ts checks.
import {
  CATALOG, COLOR_NAMES, COLORS, CONTRACT_TEXT, heightOf, studsOnTop, SPECIALTY_TEXT, SPECIALTY_TYPES, applyEdits, buildSize, colorPatches, listing, matchColors, placedKey, normalizeSize, parsePartId, partId, partCount, remaining, settle, summarize, trimToValid, validate,
  type Build, type ColorName, type Edit, type Issue, type PartKind, type PartType,
} from './bricks';
import { addPart, colorTable, colorTotals, counts, inventoryTable, observationKey, isObservationLocked, removeFound, type Box, type Inventory } from './inventory';
import { isMade, isRealSize, neverMadeText, shapeName, unlimitedInventory } from './catalog';
import { checkFeatures, OUTLINES, STUD_LAYOUTS, TOP_SHAPES, type Features } from './identify';
import {scanPieceReviewEvidence,type PieceReviewEvidence} from './piece-review-evidence';
import {SCAN_FEATURE_TAG_SCHEMA,SCAN_FEATURE_TAG_PROMPT} from './piece-guess-tags';
import {specialMold} from './special-mold-geometry';
import {connectorMold} from './connector-mold-geometry';
import { attachmentMap, constructionIssues, constructionKey, joinConstruction, orderBuild } from './construction';
import { allocateFeatures, emptyQualityPlan, qualityPlanText, draftRefinementWins, refinementCandidate, refinementLimits, refinementWins, reservationLimit, validVerdict, type QualityPlan } from './build-quality';
import { techniqueText } from './techniques';
import { animalPlanText, builderAssemblies, assemblyText, catalogSubjectsText } from './library-context';
import { FAMILY_STRATEGIES, familyPlanText, strategiesFor } from './construction-families';
import { designLanguageText, patternsFor } from './design-language';
import { DESIGN_BRIEF, MIN_FINISHED_PARTS, finishedSizeIssue } from './finished-build';
import { refinedAnimalCandidates, refinedMuzzleScope, refinedBackScope } from './refined-animal-modules';
import { contourCandidates } from './contour-animals';
import { solveRobotTarget, robotBodyIssues, robotRequest, type RobotCandidate } from './robot-body-plan';
import { createRobotTarget, silhouetteFit, exteriorContour, type RobotTarget, type SilhouetteFit } from './robot-silhouette';
import { robotModuleStockGuidance } from './robot-stock-guidance';
import { ROBOT_MODULE_SCHEMA, ROBOT_MODULE_BRIEF, robotModuleSpec } from './robot-module-shapes';
import { renderRobotTarget } from './robot-silhouette-view';
import { modulePrompt, moduleReplacement, moduleSchema, type ModuleRefinementScope } from './module-refinement';

export class GeminiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

interface Content { role: 'user' | 'model'; parts: Record<string, unknown>[] }
interface Reply { json: unknown; content: Content; ms: number; deliveryAttempts?: (RateLimitAttempt & {hop:number})[] }

async function generate(contents: Content[], generationConfig: Record<string, unknown>, signal?: AbortSignal): Promise<Reply> {
  const t0 = performance.now();
  const rawThinking = generationConfig.thinkingConfig;
  if (rawThinking !== undefined && (!rawThinking || typeof rawThinking !== 'object' || Array.isArray(rawThinking))) throw new GeminiError('thinkingConfig must be an object');
  const thinking = { ...(rawThinking as Record<string, unknown> | undefined), thinkingLevel: 'high' };
  delete (thinking as Record<string, unknown>).thinkingBudget;
  // Preserve the old JSON wire semantics (optional undefined fields are omitted),
  // then keep this ORIGINAL body unchanged throughout native continuation.
  const body: unknown = JSON.parse(JSON.stringify({ contents, generationConfig: {
    responseMimeType: 'application/json', ...generationConfig,
    thinkingConfig: thinking, maxOutputTokens: GEMINI_INITIAL_TOKENS,
  } }));
  let response;
  const deliveryAttempts: (RateLimitAttempt & {hop:number})[] = [];
  try {
    ({ response } = await generateDecision({ body, signal,
      fetchHop: async (request, context) => {
        // Serialize once per native hop. A 429 redelivers these exact bytes,
        // including the current continuation token, without restarting reasoning.
        const delivery = await fetchWithRateLimitRetry({ body: JSON.stringify(request), signal: context.signal,
          fetchAttempt: (serialized, attempt) => fetch('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: serialized, signal: attempt.signal,
          }),
        });
        deliveryAttempts.push(...delivery.attempts.map(attempt => ({...attempt,hop:context.hop})));
        return delivery.response;
      },
    }));
  } catch (error) {
    if (error instanceof DecisionDecodeError) throw new GeminiError(error.message, error.status);
    throw error;
  }
  const content = response.candidates[0].content;
  const text = content.parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (!text) throw new GeminiError('Empty reply (STOP)');
  try {
    return { json: JSON.parse(text), content: { role: 'model', parts: content.parts }, ms: performance.now() - t0, deliveryAttempts };
  } catch { throw new GeminiError('The reply was not valid JSON'); }
}

export async function activeModel(): Promise<{ model: string; hasKey: boolean }> {
  try { return await (await fetch('/api/model')).json(); } catch { return { model: 'unknown', hasKey: false }; }
}

// ---------------------------------------------------------------- 1. photo → inventory

const NOTE: Partial<Record<PartType, string>> = {
  endstudplate: ' 92593 (one plate tall, studs at the two ends only, long side along x)', edgeplate: ' 33909 (one plate tall, two studs on rear +y edge only)', quartertile: ' 27925 (one plate tall, smooth quarter-ring with a cutout, no top studs)',
  slope: ' 45° (width x run)', tile: ' (flat, no studs)', curve: ' curved slope (width x run, no studs)', invslope: ' inverted slope (width x run)',
  cheese: ' 30° wedge (no studs)', roundtile: ' (no studs)', arch: ' (1 brick tall, open underneath)',
};
const catalogText = (types: PartType[]) => (Object.entries(CATALOG) as [PartType, string[]][])
  .filter(([t]) => types.includes(t))
  .map(([t, sizes]) => `${t}${NOTE[t] ?? ''}: ${sizes.join(' ')}`);
/** What each shape looks like, for the scanner (the key image shows them too). */
const LOOKS: Partial<Record<PartType, string>> = {
  roundendplate: '35480: 1x2 capsule-shaped plate, semicircular ends and TWO OPEN top studs, one plate high',
  jumper: '3794b 1x2 or 87580 2x2 plate, exactly ONE centered top stud, one plate high',
  brick: 'rectangular, one brick tall, studs on top',
  plate: 'a third of a brick tall, studs on top',
  tile: 'as thin as a plate, smooth top with no studs',
  slope: '45° slope with studs only on its flat top row; size is width x run',
  curve: 'exact curved slope with no top studs: 1x2 (11477) and 2x2 (15068) are two plates tall; 1x3 (50950) is three plates tall. All have stepped undersides; size is width x run',
  invslope: 'inverted slope: flat studded top, the slant is on the UNDERSIDE; size is width x run',
  cheese: 'tiny 1x1 wedge with no studs',
  roundbrick: 'round brick (a short cylinder), studs on top',
  roundplate: 'round plate, thin, studs on top',
  roundtile: 'round tile, smooth top; 3x3 (67095) requires exact human confirmation',
  cone: '1x1 cone narrowing to one stud',
  arch: 'one brick tall with a curved opening underneath',
  cornerplate: 'L-shaped plate, three studs in an L',
  cornertile: 'L-shaped tile, smooth top with no studs',
  cornerbrick: 'L-shaped brick, three studs in an L',
  wedgeleft: 'left 2x4 wedge plate (41770); narrow end forward, four studs in the straight LEFT column',
  wedgeright: 'right 2x4 wedge plate (41769); narrow end forward, four studs in the straight RIGHT column',
  quarterplate: '4x4 quarter-disc plate (30565), one plate tall with 11 studs and two straight edges',
};
/** Recognition candidates, including exact molds that still require confirmation. */
const SCAN_TEXT = (Object.entries(CATALOG) as [PartType, string[]][])
  .filter(([t]) => !['endstudplate','edgeplate','quartertile','wheel','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','bracket'].includes(t))
  .map(([t, sizes]) => {
    const size = normalizeSize(t, sizes[0])!;
    const mold = popularMold({type:t,...size});
    // Generated molds have no LOOKS entry. Use their source-qualified names in
    // both the survey and close-up prompts, without turning a guess into stock.
    const description = mold
      ? `${mold.num}: ${mold.name}; ${mold.heightPlates} plates tall; exact mold candidate requiring human confirmation`
      : LOOKS[t] ?? shapeName({type:t,...size,color:'white',partId:partId(t,size.w,size.d,'white')});
    return `- ${t}: ${description}. Sizes: ${sizes.join(' ')}`;
  })
  .concat('- connector candidates: look for side-stud bricks and brackets. Report them as other with their visible body dimensions, side-stud count and bracket direction. Never count one as an ordinary brick or plate; exact variants need confirmation.')
  .concat('- sparse-stud plates, macaroni corner tiles and 3x3 round tiles: report as other with visible dimensions, stud positions and underside details when visible; exact mold and color need human confirmation.')
  .concat('- wheel: any wheel with a tire. Use size "1x1", one entry per wheel, color = the tire color.')
  .join('\n');
/** Every shape a design may use when parts are no limit. */
const CATALOG_TEXT = catalogText(Object.keys(CATALOG).filter(t => !['wheel','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','jumper','bracket'].includes(t)) as PartType[])
  .concat('wheels: wheels-4x2 only (a pair of wheels on an axle plate)')
  .join('\n');
/** The colors for open-catalog designs, with the shape-color combinations that were never made. */
const OPEN_COLORS = `Colors: ${COLOR_NAMES.join(', ')}.\n${neverMadeText()}`;

/** One part found in a photo, box in WHOLE-photo coordinates (0–1000). kind is null for "other" parts. */
export interface Detection {
  kind: PartKind | null; description: string; color: string; box: Box; confidence: number;
  /** Scan clues for review ranking only; never identity, stock or certainty. */
  reviewEvidence?:PieceReviewEvidence;
  /** Set when an unusual part was counted as the catalog shape it builds like: its own name. */
  aka?: string;
  /** Seen but not identified: kept (outlined with a "?") so the person can say what it is. */
  unknown?: boolean;
  /** Legacy clump proposals are review evidence only, never counted copies. */
  clump?: PartKind[];
  /** An explicit negative close-up observation; never added to inventory. */
  nonPart?: boolean;
  /** Why this observation needs review rather than supplying usable parts. */
  review?: string;
}

export function validScanBox(box: unknown): box is Box {
  return Array.isArray(box) && box.length === 4 && box.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000)
    && box[0] < box[2] && box[1] < box[3];
}
const validConfidence = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const dimensionText = (s: string) => /^\s*\d{1,2}\s*[xX×]\s*\d{1,2}\s*$/.test(s);
export function scanKindIssue(kind: PartKind): string | null {
  const parsed = parsePartId(kind.partId);
  if (!parsed || parsed.type !== kind.type || parsed.w !== kind.w || parsed.d !== kind.d || parsed.color !== kind.color) return 'Unrecognized part identity — confirm the piece';
  if(specialMold(kind)||connectorMold(kind)||popularMold(kind))return 'Exact special mold and color need human confirmation';
  if (kind.type !== 'wheel' && (kind.type === 'wheels' || !CATALOG[kind.type]?.includes(`${kind.w}x${kind.d}`) || !isRealSize(kind.type, kind.w, kind.d))) return 'Unsupported or unmanufactured shape — confirm the exact piece';
  if (!isMade(kind.partId)) return 'Shape/color combination is not in the manufacturing catalog — confirm shape and color';
  return null;
}
export function quarantineDetection(d: Detection, reason: string): Detection {
  const description = d.review ? d.description : `${d.description || 'Unidentified piece'} — ${reason}`;
  return { ...d, kind: null, aka: undefined, clump: undefined, nonPart: undefined, unknown: true, review: reason, description };
}
function scanRows(json: unknown, limit: number): unknown[] {
  if (!record(json) || !Array.isArray(json.parts) || json.parts.length > limit) throw new Error('Malformed or oversized scan response');
  return json.parts;
}
function scanCells(json: unknown, cells: number): Map<number, Record<string, unknown>> {
  const result = new Map<number, Record<string, unknown>>(), duplicates = new Set<number>();
  for (const row of scanRows(json, cells * 2)) {
    if (!record(row) || !Number.isSafeInteger(row.n) || (row.n as number) < 1 || (row.n as number) > cells) continue;
    const n = row.n as number;
    if (result.has(n) || duplicates.has(n)) { result.delete(n); duplicates.add(n); } else result.set(n, row);
  }
  return result;
}
function cellCount(cells: number): void {
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > 64) throw new Error('Contact-sheet cells must be an integer from 1 to 64');
}
function readScanPart(value: unknown, closeUp = false): RawPart | null {
  if (!record(value) || typeof value.type !== 'string' || ![...Object.keys(CATALOG), 'other', 'unknown', 'non-part'].includes(value.type) || !validConfidence(value.confidence)) return null;
  if (value.type === 'non-part') return { type: 'non-part', size: '', color: 'unknown', confidence: value.confidence, description: typeof value.description === 'string' ? value.description.slice(0, 400) : 'Not a building piece' };
  if (typeof value.size !== 'string' || value.size.length > 40 || typeof value.color !== 'string' || value.color.length > 40) return null;
  if (!Number.isSafeInteger(value.heightPlates) || (value.heightPlates as number) < 0 || (value.heightPlates as number) > 80) return null;
  if (closeUp && value.type in CATALOG && ['outline','topShape','studsOnTop','studLayout'].some(key=>value[key]===undefined)) return null;
  for (const [key, choices] of [['outline', OUTLINES], ['topShape', TOP_SHAPES], ['studLayout', STUD_LAYOUTS], ['handedness', ['left', 'right', 'unknown']]] as const) if (value[key] !== undefined && !(choices as readonly unknown[]).includes(value[key])) return null;
  if (value.studsOnTop !== undefined && (!Number.isSafeInteger(value.studsOnTop) || (value.studsOnTop as number) < 0 || (value.studsOnTop as number) > 256)) return null;
  if (value.openStuds !== undefined && typeof value.openStuds !== 'boolean') return null;
  for (const key of ['description', 'buildsAs', 'clump']) if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 1200)) return null;
  return value as unknown as RawPart;
}

/**
 * Ask Gemini what's in one image. With `crop`, the image is a zoomed-in section of a larger photo:
 * parts cut off by its edge are skipped (a neighbouring section sees them whole) and boxes are mapped
 * back into whole-photo coordinates.
 */
export async function scanImage(
  dataUrl: string,
  opts: { max: number; crop?: { x: number; y: number; w: number; h: number }; key?: string },
  signal?: AbortSignal,
): Promise<{ detections: Detection[]; estimatedTotal: number }> {
  if (!Number.isSafeInteger(opts.max) || opts.max < 1 || opts.max > 500) throw new Error('Scan limit must be 1 to 500');
  if (opts.crop && (![opts.crop.x, opts.crop.y, opts.crop.w, opts.crop.h].every(Number.isFinite) || opts.crop.x < 0 || opts.crop.y < 0 || opts.crop.w <= 0 || opts.crop.h <= 0 || opts.crop.x + opts.crop.w > 1000.000001 || opts.crop.y + opts.crop.h > 1000.000001)) throw new Error('Invalid scan crop');
  const [, mimeType, data] = /^data:(.*?);base64,(.*)$/.exec(dataUrl) ?? [];
  const keyData = opts.key ? /^data:.*?;base64,(.*)$/.exec(opts.key)?.[1] : undefined;
  const prompt = `${opts.crop
    ? 'This is a zoomed-in section of a larger photo of loose building bricks. Identify the loose bricks in this section. Skip any part that is cut off by the edge of this image.'
    : 'Identify the loose building bricks in this photo.'}
Use this catalog of shapes${opts.key ? ". The second image is a KEY showing each shape, rendered by the app in gray: use it only to recognize shapes, never list parts from it, and take colors only from the photo" : ''}:
${SCAN_TEXT}
If a brick, plate or tile has a size that isn't listed, give its real size.
Use only these colors: ${COLOR_NAMES.join(', ')}.
Look for EVERY part, including small and unusual ones, not only bricks and plates.
Count studs carefully to get the size: a 2x4 brick has 2 rows of 4 studs. If you only see the underside or a side, infer the size from its proportions.
${HEIGHT_TEXT}
Return one entry per individual physical part, with its bounding box in the photo${opts.key ? ' (the first image)' : ''} as box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000.
List at most ${opts.max} parts, clearest first. ${OTHER_TEXT}
${UNKNOWN_TEXT}
Give a confidence from 0 to 1 per part.
${SCAN_FEATURE_TAG_PROMPT}
Also give estimatedTotal: roughly how many loose parts are visible in this image in total, including ones you could not identify.`;
  const schema = {
    type: 'OBJECT', required: ['parts', 'estimatedTotal'],
    properties: {
      estimatedTotal: { type: 'INTEGER' },
      parts: { type: 'ARRAY', items: {
        type: 'OBJECT', required: ['type', 'size', 'color', 'box_2d', 'confidence', 'buildsAs', 'heightPlates', 'featureTags'],
        properties: {
          buildsAs: { type: 'STRING' }, heightPlates: { type: 'INTEGER' }, clump: { type: 'STRING' },
          type: { type: 'STRING', enum: [...Object.keys(CATALOG), 'other', 'unknown'] },
          size: { type: 'STRING' }, color: { type: 'STRING', enum: COLOR_NAMES }, description: { type: 'STRING' },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } }, confidence: { type: 'NUMBER' },
          featureTags: SCAN_FEATURE_TAG_SCHEMA,
        },
      } },
    },
  };
  const r = await generate(
    [{ role: 'user', parts: [{ inlineData: { mimeType, data } }, ...(keyData ? [{ inlineData: { mimeType: 'image/jpeg', data: keyData } }] : []), { text: prompt }] }],
    { responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    signal,
  );
  const json = r.json;
  const c = opts.crop ?? { x: 0, y: 0, w: 1000, h: 1000 };
  const detections = scanRows(json, opts.max).flatMap(value => {
    const p = readScanPart(value);
    if (!p || p.type === 'non-part' || !record(value) || !validScanBox(value.box_2d)) return [];
    const [y0, x0, y1, x1] = value.box_2d;
    const box: Box = [c.y + (y0 / 1000) * c.h, c.x + (x0 / 1000) * c.w, c.y + (y1 / 1000) * c.h, c.x + (x1 / 1000) * c.w];
    return validScanBox(box) ? [toDetection(p, box)] : [];
  });
  const estimate = record(json) && Number.isSafeInteger(json.estimatedTotal) && (json.estimatedTotal as number) >= 0 && (json.estimatedTotal as number) <= 5000 ? json.estimatedTotal as number : detections.length;
  return { detections, estimatedTotal: Math.max(estimate, detections.length) };
}

/** One part as the scanner reports it. */
interface RawPart extends Features { type: string; size: string; color: string; description?: string; confidence?: number; buildsAs?: string; clump?: string; featureTags?:unknown }

/**
 * The parts in a stuck-together clump, from the scanner's "type-AxB-color ×count, …" (color defaults to the
 * clump's own). Only catalog shapes count, at most 10 parts; a clump that names none stays an "other".
 */
export function parseClump(text: string | undefined, color: string): PartKind[] {
  const out: PartKind[] = [];
  for (const item of (text ?? '').toLowerCase().split(/[,;]/)) {
    const m = /^\s*([a-z]+)-(\d+)x(\d+)(?:-([a-z-]+?))?\s*(?:[x×*]\s*(\d+))?\s*$/.exec(item);
    if (!m || !(m[1] in CATALOG) || ['wheel','wedgeleft','wedgeright','quarterplate','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','roundendplate','jumper','bracket'].includes(m[1])) continue;
    const type = m[1] as PartType;
    const size = normalizeSize(type, `${m[2]}x${m[3]}`);
    if (!size) continue;
    const c = (m[4] ?? color) as ColorName;
    if (!(c in COLORS)) continue;
    const kind = parsePartId(partId(type, size.w, size.d, c)), count = Number(m[5] ?? 1);
    if (!kind || scanKindIssue(kind) || !Number.isSafeInteger(count) || count < 1 || count > 6 || out.length + count > 10) continue;
    for (let i = 0; i < count; i++) out.push(kind);
  }
  return out;
}

function toDetection(p: RawPart, box: Box): Detection {
  if (p.type === 'non-part') return { kind: null, description: p.description || 'Not a building piece', color: p.color, box, confidence: p.confidence ?? 0, nonPart: true };
  if (p.type === 'unknown') return { kind: null, description: p.description || 'unidentified piece', color: p.color, box, confidence: p.confidence ?? 0.3, unknown: true,reviewEvidence:scanPieceReviewEvidence(p) };
  const description = p.description || `${p.color} ${p.type} ${p.size}`;
  const observed: Detection = { kind: null, description, color: p.color, box, confidence: p.confidence ?? 0.5,reviewEvidence:scanPieceReviewEvidence(p) };
  if (p.clump?.trim()) return quarantineDetection(observed, 'Possible joined pieces — separate them to identify the hidden parts');
  if (p.type === 'other') {
    return p.buildsAs?.trim() ? quarantineDetection(observed, 'Suggested stand-in — confirm the exact part before using it') : observed;
  }
  const size = dimensionText(p.size) ? normalizeSize(p.type as PartType, p.size) : null;
  if (!size) return quarantineDetection(observed, 'Unrecognized dimensions — confirm the exact piece');
  if (!CATALOG[p.type as keyof typeof CATALOG]?.includes(`${size.w}x${size.d}`) || !isRealSize(p.type as PartType,size.w,size.d)) return quarantineDetection(observed,'Unsupported or unmanufactured shape — confirm the exact piece');
  if (!(p.color in COLORS)) return quarantineDetection(observed, 'Uncertain color — confirm it from the photo');
  // Survey rows may lack close-up features, but a known conflicting height must
  // never bypass the feature checker merely because its other fields are absent.
  if ((p.outline === undefined || p.topShape === undefined || p.studsOnTop === undefined) && p.heightPlates !== undefined && p.heightPlates !== heightOf({type:p.type as PartType,...size})) return quarantineDetection(observed, 'Height does not match the named shape');
  // The close-up's description has to fit the named shape; a near miss becomes a named "other" part.
  const verdict = checkFeatures(p.type as PartType, size.w, size.d, p);
  if ('other' in verdict) {
    gateLog(description, `${p.type}-${size.w}x${size.d}`, verdict.other);
    return quarantineDetection(observed, verdict.other);
  }
  if (verdict.fixed) gateLog(description, `${p.type}-${size.w}x${size.d}`, verdict.fixed);
  if (verdict.standIn) gateLog(description, `${p.type}-${size.w}x${size.d}`, 'counted as the plain part, labeled with its own name');
  const kind = parsePartId(partId(verdict.type, verdict.w, verdict.d, p.color as ColorName));
  const issue = kind ? scanKindIssue(kind) : 'Unrecognized part identity';
  if (issue || verdict.standIn) return quarantineDetection(observed, issue ?? 'Suggested stand-in — confirm the exact part');
  return { ...observed, kind };
}

/** ?debug=1: every reading the feature check turned down or corrected, for QA. */
function gateLog(description: string, named: string, why: string) {
  (globalThis as { __spillGate?: unknown[] }).__spillGate?.push({ description, named, why });
}

const UNKNOWN_TEXT = `If you can see a part but can't tell what it is (too hidden, blurry or unfamiliar), still list it: type "unknown", with a few words on what you can see as the description. Don't list anything that isn't a part.`;
const HEIGHT_TEXT = `Bricks and plates look alike from straight above, so judge height from the side wall you can see and the shadow it casts: a brick's side is three times as tall as a plate's (a 1x1 brick is almost a cube; a plate is as thin as a cracker).`;
const OTHER_TEXT = `Anything not in the catalog goes under type "other", with a short name a builder would use, including its size, as the description (for example "window 1x2x2").
For an unusual part, leave buildsAs empty. Do not substitute a familiar shape for a different mold; it needs exact-part confirmation.
For every part give heightPlates, its real height in plates: a plate or tile is 1, a brick 3, a 1x2x2 window 6.
If several parts appear joined or stacked, describe the visible assembly as "other" and say it needs separation. Do not infer hidden parts or multiply copies; leave clump empty. Never change the observed color to a manufactured alternative.`;

/**
 * The close-up check: a contact sheet of numbered cells, each a full-resolution crop of one part found
 * by the scan, outlined in magenta. Gemini identifies each one again, where height and small details
 * are visible. Returns one reading per cell number (1-based).
 */
export async function checkParts(sheet: string, cells: number, key: string | undefined, signal?: AbortSignal, ruler = false, colors?: string): Promise<Map<number, RawPart>> {
  cellCount(cells);
  const data = /^data:.*?;base64,(.*)$/.exec(sheet)?.[1];
  const keyData = key ? /^data:.*?;base64,(.*)$/.exec(key)?.[1] : undefined;
  const colorData = colors ? /^data:.*?;base64,(.*)$/.exec(colors)?.[1] : undefined;
  const prompt = `The first image is a contact sheet of ${cells} numbered cells. Each cell is a close-up of ONE part from a photo of loose building bricks: the part inside the magenta outline. Other parts may show around it; ignore them.${keyData ? ' The second image is a KEY of the catalog shapes, rendered by the app in gray: use it only to recognize shapes.' : ''}
For every cell, FIRST describe what you see, THEN name the part:
- outline: its shape seen from above: rectangle, L, round, quarter-circle, wedge (a plate cut at an angle), capsule (rectangle with two semicircular ends), or other.
- topShape: flat, slope45, slope-shallow (gentler than 45°, like a 30° cheese slope), slope-steep (steeper than 45°), curved (a smooth convex curve down to a thin edge), curved-inverted (curving up), dome, or other.
- studsOnTop: how many studs on its top face (0 if smooth). studLayout: grid (one stud on every cell), center (fewer studs set in the middle, like a jumper plate), row (studs along one edge only, like a 45° slope), side (it also has studs on a side face), none, or other. Open (hollow) and solid studs count the same. Technic holes through a side are not studs: a Technic brick has studLayout grid.
- openStuds: true only if the TOP studs are visibly hollow. This is required for a roundendplate.
- heightPlates: its height in plates.
- handedness: for wedge plates, viewed from ABOVE with the NARROW end forward, left means the straight studded column is left and right means it is right. Use unknown unless clearly visible. Other parts use unknown.
A part gets a catalog type ONLY if all of these match that shape exactly. A different stud layout, a different curve or angle, or a different outline means it is a different part: use "other" and name it.
Identify the outlined part in every cell, using this catalog of shapes:
${SCAN_TEXT}
If a brick, plate or tile has a size that isn't listed, give its real size.
Use only these colors: ${COLOR_NAMES.join(', ')}.${colorData ? ` The ${keyData ? 'third' : 'second'} image is a COLOR KEY: one labeled chip per color. Match each part's color against the chips by eye (the photo's lighting may be warmer or dimmer), and tell close ones apart carefully: dark-turquoise is blue-green, dark-azure and azure are bluer; tan, dark-tan, nougat and medium-nougat differ in warmth and depth.` : ''}
Height matters most. ${HEIGHT_TEXT} A tile is as thin as a plate but has a smooth top with no studs. Count the studs for the size.${ruler ? `
Each cell has a white ruler in its lower-left corner, drawn at that cell's zoom: each tick is one stud width. Measure every part against it, above all tiles and anything else without studs to count: a 2x4 tile is 2 by 4 ticks. A brick is 1.2 studs tall and a plate 0.4.` : ''}
${OTHER_TEXT}
If the magenta outline contains background, a shadow, a hand, a label or another non-piece, use type "non-part". If a physical piece is visible but cannot be identified, use type "unknown". These are different outcomes.
${SCAN_FEATURE_TAG_PROMPT}
Return exactly one entry per cell, with its number n, and a confidence from 0 to 1.`;
  const schema = {
    type: 'OBJECT', required: ['parts'],
    properties: { parts: { type: 'ARRAY', items: {
      type: 'OBJECT', required: ['n', 'outline', 'topShape', 'studsOnTop', 'studLayout', 'heightPlates', 'type', 'size', 'color', 'description', 'buildsAs', 'confidence', 'featureTags'],
      propertyOrdering: ['n', 'outline', 'topShape', 'studsOnTop', 'studLayout', 'heightPlates', 'type', 'size', 'color', 'description', 'featureTags', 'buildsAs', 'clump', 'confidence'],
      properties: {
        openStuds: { type: 'BOOLEAN' }, handedness: { type: 'STRING', enum: ['left','right','unknown'] }, n: { type: 'INTEGER' }, heightPlates: { type: 'INTEGER' }, studsOnTop: { type: 'INTEGER' },
        outline: { type: 'STRING', enum: OUTLINES }, topShape: { type: 'STRING', enum: TOP_SHAPES }, studLayout: { type: 'STRING', enum: STUD_LAYOUTS }, type: { type: 'STRING', enum: [...Object.keys(CATALOG), 'other', 'unknown', 'non-part'] }, size: { type: 'STRING' },
        color: { type: 'STRING', enum: COLOR_NAMES }, description: { type: 'STRING' }, buildsAs: { type: 'STRING' }, clump: { type: 'STRING' }, confidence: { type: 'NUMBER' },
        featureTags: SCAN_FEATURE_TAG_SCHEMA,
      },
    } } },
  };
  const r = await generate(
    [{ role: 'user', parts: [
      { inlineData: { mimeType: 'image/jpeg', data } },
      ...(keyData ? [{ inlineData: { mimeType: 'image/jpeg', data: keyData } }] : []),
      ...(colorData ? [{ inlineData: { mimeType: 'image/jpeg', data: colorData } }] : []),
      { text: prompt },
    ] }],
    { responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    signal,
  );
  const out = new Map<number, RawPart>();
  for (const [n, row] of scanCells(r.json, cells)) { const p = readScanPart(row,true); if (p) out.set(n, p); }
  return out;
}

/**
 * The recount: one big or impossible-sized plate, brick or tile per cell, at high resolution. Gemini counts
 * the studs along each edge instead of estimating. Returns { long, short } per cell number.
 */
export async function countStuds(sheet: string, cells: number, signal?: AbortSignal): Promise<Map<number, { long: number; short: number }>> {
  cellCount(cells);
  const data = /^data:.*?;base64,(.*)$/.exec(sheet)?.[1];
  const prompt = `This image has ${cells} numbered cells. Each shows ONE plate, brick or tile inside the magenta outline (others may be around it: ignore them).
For each cell, COUNT its studs: go along one full edge and count every stud in that row, then along the other edge and count every stud in that column. Don't estimate from its size. For a tile (no studs), measure it with the white ruler in the corner instead (one tick per stud).
Give long (studs along the longer edge) and short (along the shorter edge).`;
  const schema = {
    type: 'OBJECT', required: ['parts'],
    properties: { parts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['n', 'long', 'short'], propertyOrdering: ['n', 'long', 'short'],
      properties: { n: { type: 'INTEGER' }, long: { type: 'INTEGER' }, short: { type: 'INTEGER' } } } } },
  };
  const r = await generate([{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text: prompt }] }],
    { responseSchema: schema, thinkingConfig: { thinkingLevel: 'medium' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, signal);
  const out = new Map<number, { long: number; short: number }>();
  for (const [n, p] of scanCells(r.json, cells)) {
    if (Number.isSafeInteger(p.long) && Number.isSafeInteger(p.short) && (p.long as number) >= 1 && (p.long as number) <= 16 && (p.short as number) >= 1 && (p.short as number) <= 16) out.set(n, { long: Math.max(p.long as number, p.short as number), short: Math.min(p.long as number, p.short as number) });
  }
  return out;
}

// ---------------------------------------------------------------- cross-checking with angled photos

/**
 * Find pieces from the top-down photo in an angled photo of the same pile. The first image is a sheet of numbered
 * cells, each one piece (magenta outline) with its neighbors for context; the second is the angled photo.
 * Returns each piece's box in the angled photo (0–1000), when it's visible there.
 */
export async function findInAngle(sheet: string, cells: number, angle: string, signal?: AbortSignal): Promise<Map<number, { box: Box; confidence: number }>> {
  cellCount(cells);
  const strip = (u: string) => /^data:.*?;base64,(.*)$/.exec(u)?.[1];
  const prompt = `The first image is a sheet of ${cells} numbered cells cut from a photo taken straight down at a pile of building bricks. Each cell shows ONE piece inside a magenta outline, with the pieces around it.
The second image is the SAME pile photographed from an angle.
For each numbered piece, find that exact physical piece in the second image. Use its color and shape and, above all, the pieces around it, so you don't pick a look-alike. Give its box_2d [ymin, xmin, ymax, xmax] in the second image, normalized to 0-1000.
If it's hidden, out of frame, or you aren't sure it's the same piece, set found to false. A confidence from 0 to 1.`;
  const schema = {
    type: 'OBJECT', required: ['parts'],
    properties: { parts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['n', 'found', 'box_2d', 'confidence'], propertyOrdering: ['n', 'found', 'box_2d', 'confidence'],
      properties: { n: { type: 'INTEGER' }, found: { type: 'BOOLEAN' }, box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } }, confidence: { type: 'NUMBER' } } } } },
  };
  const r = await generate([{ role: 'user', parts: [
    { inlineData: { mimeType: 'image/jpeg', data: strip(sheet) } }, { inlineData: { mimeType: 'image/jpeg', data: strip(angle) } }, { text: prompt },
  ] }], { responseSchema: schema, thinkingConfig: { thinkingLevel: 'medium' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, signal);
  const out = new Map<number, { box: Box; confidence: number }>();
  for (const [n, p] of scanCells(r.json, cells)) {
    if (p.found === true && validScanBox(p.box_2d) && validConfidence(p.confidence)) out.set(n, { box: p.box_2d, confidence: p.confidence });
  }
  return out;
}

/** Height from two views: each numbered row shows one piece from straight above (left) and from an angle (right). */
export async function judgeHeights(sheet: string, cells: number, signal?: AbortSignal): Promise<Map<number, { sameShape: boolean; sideClear: boolean; stacked: boolean; heightPlates: number; confidence: number }>> {
  cellCount(cells);
  const data = /^data:.*?;base64,(.*)$/.exec(sheet)?.[1];
  const prompt = `This image has ${cells} numbered pairs. Each pair shows ONE piece twice, inside magenta outlines: on the left from straight above, on the right from an angle where its side is visible.
For each pair:
- sameShape: false if the two views don't show the same piece.
- sideClear: true only if the angled view is sharp and close enough to SEE the piece's side wall and judge its height. False if it's blurry, far away, mostly hidden, or seen from straight above.
- stacked: true if what looks like one piece from above is really two or more pieces stacked on each other (from the side you'd see two layers with a seam).
- heightPlates: the height of a single piece, judged from the angled view, in plates: a plate or tile is 1 (thin, like a cracker), a brick is 3 (as tall as it is wide per stud, a little more), a piece two bricks tall is 6.
- confidence from 0 to 1.`;
  const schema = {
    type: 'OBJECT', required: ['parts'],
    properties: { parts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['n', 'sameShape', 'sideClear', 'stacked', 'heightPlates', 'confidence'], propertyOrdering: ['n', 'sameShape', 'sideClear', 'stacked', 'heightPlates', 'confidence'],
      properties: { n: { type: 'INTEGER' }, sameShape: { type: 'BOOLEAN' }, sideClear: { type: 'BOOLEAN' }, stacked: { type: 'BOOLEAN' }, heightPlates: { type: 'INTEGER' }, confidence: { type: 'NUMBER' } } } } },
  };
  const r = await generate([{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text: prompt }] }],
    { responseSchema: schema, thinkingConfig: { thinkingLevel: 'medium' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, signal);
  const out = new Map<number, { sameShape: boolean; sideClear: boolean; stacked: boolean; heightPlates: number; confidence: number }>();
  for (const [n, p] of scanCells(r.json, cells)) {
    if (typeof p.sameShape === 'boolean' && typeof p.sideClear === 'boolean' && typeof p.stacked === 'boolean' && Number.isSafeInteger(p.heightPlates) && (p.heightPlates as number) >= 0 && (p.heightPlates as number) <= 80 && validConfidence(p.confidence)) out.set(n, {sameShape:p.sameShape,sideClear:p.sideClear,stacked:p.stacked,heightPlates:p.heightPlates as number,confidence:p.confidence});
  }
  return out;
}

/** The close-up reading of a part, if it differs from the first one. */
export function recheck(first: Detection, p: RawPart): Detection | null {
  const safe = readScanPart(p,true);
  if (!safe) return quarantineDetection(first, 'Close-up response was incomplete or malformed — confirm this observation');
  const next = toDetection(safe, first.box);
  if (next.nonPart) return next;
  const same = next.kind ? next.kind.partId === first.kind?.partId
    : !first.kind && next.unknown === first.unknown && next.description === first.description && next.review === first.review;
  return same && next.confidence === first.confidence && next.color === first.color && !first.clump?.length && !first.aka && JSON.stringify(next.reviewEvidence)===JSON.stringify(first.reviewEvidence) ? null : next;
}

function inventoryDetection(d: Detection): Detection | null {
  if (!validScanBox(d.box) || !validConfidence(d.confidence)) return null;
  if (d.nonPart) return d;
  if (d.clump?.length) return quarantineDetection(d, 'Possible joined pieces — separate them to identify the hidden parts');
  if (d.aka) return quarantineDetection(d, 'Suggested stand-in — confirm the exact part before using it');
  const issue = d.kind && scanKindIssue(d.kind);
  return issue ? quarantineDetection(d, issue) : d;
}
function atObservation(photo: number, box: Box, target: number, key: string): boolean {
  return photo === target && observationKey(photo, box) === key;
}
function observationPresent(inv: Inventory, photo: number, key: string): boolean {
  return Object.values(inv.parts).some(e => e.boxes.some(b => atObservation(b.photo,b.box,photo,key))) || inv.others.some(e => e.boxes.some(b => atObservation(b.photo,b.box,photo,key)));
}
function originalPresent(inv: Inventory, from: Detection, photo: number, key: string): boolean {
  const counted = Object.values(inv.parts).flatMap(e => e.boxes.filter(b => atObservation(b.photo,b.box,photo,key)).map(b => ({e,b})));
  const others = inv.others.filter(e => e.boxes.some(b => atObservation(b.photo,b.box,photo,key)));
  if (from.kind) return counted.length === 1 && !others.length && counted[0].e.count >= 1 && counted[0].e.kind.partId === from.kind.partId && !counted[0].b.confirmed && (counted[0].b.confidence ?? counted[0].e.confidence) === from.confidence;
  return !counted.length && others.length === 1 && others[0].description === from.description && others[0].color === from.color && !!others[0].unknown === !!from.unknown;
}
function removeObservation(inv: Inventory, from: Detection, photo: number, key: string): Inventory {
  if (from.kind) return removeFound(inv,from.kind.partId,from.box,from.aka,photo);
  const others = inv.others.flatMap(e => {
    const boxes = e.boxes.filter(b => !atObservation(b.photo,b.box,photo,key));
    return boxes.length === e.boxes.length ? [e] : boxes.length ? [{...e,boxes}] : [];
  });
  return {...inv,others};
}

/** Swap in what the close-up check found: take the first reading of each part out, put the new one in (or nothing, for a duplicate). */
export function correctDetections(inv: Inventory, changes: { from: Detection; to: Detection | Detection[] | null }[], photo: number): Inventory {
  let next = inv;
  const changed = new Set<string>();
  for (const { from, to } of changes) {
    const original = inventoryDetection(from);
    if (!original || original.nonPart || !Number.isSafeInteger(photo) || isObservationLocked(next,photo,original.box)) continue;
    const key = observationKey(photo,original.box);
    if (changed.has(key) || !originalPresent(next,original,photo,key)) continue;
    const proposed = Array.isArray(to) ? to.length === 1 ? to[0] : to.length ? quarantineDetection(original,'Several pieces proposed on one outline — separate them before counting') : null : to;
    const replacement = proposed && inventoryDetection(proposed);
    // Validate the entire replacement before removing anything. A correction may
    // not move the observation or charge another photo's matching coordinates.
    if (proposed && (!replacement || observationKey(photo,replacement.box) !== key)) continue;
    next = removeObservation(next,original,photo,key);
    if (replacement && !replacement.nonPart) next = applyDetections(next,[replacement],photo);
    changed.add(key);
  }
  return next;
}

export function applyDetections(inv: Inventory, dets: Detection[], photo: number): Inventory {
  let next = inv;
  if (!Number.isSafeInteger(photo)) return inv;
  for (const raw of dets) {
    const d = inventoryDetection(raw);
    if (!d || d.nonPart || isObservationLocked(next,photo,d.box) || observationPresent(next,photo,observationKey(photo,d.box))) continue;
    if (d.kind) next = addPart(next, d.kind, 1, { photo, box: d.box }, d.confidence,undefined,false,d.reviewEvidence);
    else next = { ...next, others: [...next.others, { description: d.description, color: d.color, boxes: [{ photo, box: d.box }], unknown: d.unknown,confidence:d.confidence,modelConfidence:d.confidence,confidenceSource:'model',reviewEvidence:d.reviewEvidence }] };
  }
  return next;
}

// ---------------------------------------------------------------- 2. inventory → candidate ideas

export interface KeyPart { partId: string; count: number }
export interface Idea {
  name: string; pitch: string; estimatedParts: number; difficulty: number; keyParts: KeyPart[]; mainColor?: string;
  /** Suggested ideas: keyParts is the whole parts list (checked against the bucket), and why says which parts make it work. */
  why?: string;
  /** Set when the user typed the request: what they asked for, and what the bucket forced Gemini to change. */
  request?: string; note?: string;
  mode?: Mode;
}

/**
 * bucket = only the parts you have. accurate = any catalog part (the build comes with a shopping list).
 * super = any part, any size: a large display model, built section by section.
 */
export type Mode = 'bucket' | 'accurate' | 'super';
/** Modes that may use any catalog part, so the build comes with a parts list. */
export const openCatalog = (m?: Mode) => m === 'accurate' || m === 'super';

const usableTotal = (inv: Inventory) => Object.values(counts(inv)).reduce((a, b) => a + b, 0);

export function partRange(inv: Inventory) {
  const total = usableTotal(inv);
  const singles = Object.values(counts(inv)).filter(n => n === 1).length;
  const hi = Math.min(total, Math.round(50 + 70 * (1 - singles / Math.max(1, total))));
  const lo = Math.min(total, Math.max(MIN_FINISHED_PARTS, Math.min(40, Math.floor(total / 2))));
  return { lo, hi };
}

export function bucketContext(inv: Inventory) {
  const have = counts(inv), ns = Object.values(have);
  const range = partRange(inv);
  return `${usableTotal(inv)} usable parts, ${ns.length} shape/color combinations, ${ns.filter(n => n === 1).length} combinations with only one piece.
Target ${range.lo}–${range.hi} parts with purposeful structure and visible detail. The hard minimum for a finished subject is ${MIN_FINISHED_PARTS} pieces. Do not stop at a tiny schematic version when this inventory supports developed forms. Leave spare pieces unused. Use repeatable dimensions and intentional multicolor patterns when matching colors are scarce. Loose wheels are excluded unless a complete wheel-and-holder assembly is explicitly listed.
${pavilionStockHint(have)}
${constructionChoiceText(constructionChoices(have).filter(c=>c.family==='gable-roof'))}`;
}

/** An idea's colors, most-used first, from its parts list. */
export function colorsOf(idea: Idea): string[] {
  const by: Record<string, number> = {};
  for (const k of idea.keyParts ?? []) { const c = parsePartId(k.partId)?.color; if (c) by[c] = (by[c] ?? 0) + k.count; }
  return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Deterministic pre-check, before any design work: the idea's own parts list has to fit the bucket. */
export function feasible(idea: Idea, inv: Inventory): { ok: boolean; reason?: string } {
  const have = counts(inv);
  const need: Record<string, number> = {};
  for (const k of idea.keyParts ?? []) {
    if (!Number.isSafeInteger(k.count) || k.count <= 0 || !parsePartId(k.partId)) return { ok: false, reason: 'invalid parts list' };
    need[k.partId] = (need[k.partId] ?? 0) + k.count;
  }
  for (const [id, n] of Object.entries(need)) {
    if ((have[id] ?? 0) < n) return { ok: false, reason: `needs ${n} × ${id}, bucket has ${have[id] ?? 0}` };
  }
  if (!idea.request && !idea.keyParts?.length) return { ok: false, reason: 'no parts list' };
  const total = usableTotal(inv);
  if (total < MIN_FINISHED_PARTS) return { ok: false, reason: `Finished builds need at least ${MIN_FINISHED_PARTS} usable pieces; this bucket has ${total}` };
  if (!idea.request && Object.values(need).reduce((s, n) => s + n, 0) < MIN_FINISHED_PARTS) return { ok: false, reason: `Plan at least ${MIN_FINISHED_PARTS} purposeful pieces for a finished build` };
  if (idea.estimatedParts > total) return { ok: false, reason: `needs ~${idea.estimatedParts} parts, bucket has ${total}` };
  if (Object.values(need).reduce((s, n) => s + n, 0) > 1 && !Object.keys(need).some(id => studsOnTop(parsePartId(id)!.type))) {
    return { ok: false, reason: 'these parts have no top studs to connect a model' };
  }
  if (idea.request && idea.mainColor) {
    // The outside of a model is roughly a third or more of its parts; that much has to come in the main color.
    const have = colorTotals(inv).find(c => c.color === idea.mainColor)?.total ?? 0;
    if (have < idea.estimatedParts * 0.35) return { ok: false, reason: `only ${have} ${idea.mainColor} parts for a ~${idea.estimatedParts}-part ${idea.mainColor} model` };
  }
  return { ok: true };
}

/**
 * The user typed what they want ("lion"). Turn it into an idea this bucket can actually build: a name,
 * an honest pitch, a main color the bucket has plenty of, and a one-line note on what had to change.
 */
export const ACCURATE_RANGE = { lo: 110, hi: 240 };
/** Super fidelity: as many parts as a realistic display model needs, within what a section-by-section build can manage. */
export const SUPER_RANGE = { lo: 250, hi: 900 };

export async function frameRequest(inv: Inventory, request: string, signal?: AbortSignal, mode: Mode = 'bucket'): Promise<Idea> {
  const accurate = openCatalog(mode);
  if (!accurate && usableTotal(inv) < MIN_FINISHED_PARTS) throw new GeminiError(`Finished builds need at least ${MIN_FINISHED_PARTS} usable pieces. Confirm more pieces in your pile first.`);
  const { lo, hi } = mode === 'super' ? SUPER_RANGE : accurate ? ACCURATE_RANGE : partRange(inv);
  const have = accurate ? unlimitedInventory(counts(inv)) : counts(inv);
  const aim = mode === 'super'
    ? `Parts and size are no limit: plan a super-detailed, realistic display model, the showpiece a set designer would build, as large as it needs to be for true proportions, in the real thing's colors, ${lo}–${hi} parts.`
    : `Parts are no limit: plan the most accurate, recognizable version a skilled builder could make from this catalog, in the real thing's colors, ${lo}–${hi} parts.`;
  const prompt = accurate ? `Someone wants to build: "${request}". ${aim}
Catalog shapes:
${CATALOG_TEXT}
${OPEN_COLORS}
- name: what it is, 1–3 words.
- pitch: how it will look, 12 words or fewer, plain and a little playful.
- mainColor: the real thing's main color (closest in the list).
- note: empty.
- keyParts: the parts that give it its shape and colors, with rough counts.
- difficulty: 1 (easy) to 3 (tricky).` : `Someone wants to build: "${request}". Here are the loose parts they have (partId × count):
${inventoryTable(inv)}

Parts per color:
${colorTable(inv)}

Plan a complete, recognizable small version of "${request}" these parts can make, ${lo}–${hi} parts. Simplify the subject to its defining silhouette.
${bucketContext(inv)}
- name: what it is, 1–3 words.
- pitch: how this version will look, 12 words or fewer, plain and a little playful.
- mainColor: the color most of its outside will be. Use the real thing's color if the bucket has plenty of it; otherwise the closest color the bucket has plenty of (at least a third of the part count).
- note: one honest sentence, 20 words or fewer, on anything the bucket forces you to change (missing colors, size, simplified details). Empty if nothing.
- keyParts: the parts that give it its shape and colors, with counts that fit the inventory.
- difficulty: 1 (easy) to 3 (tricky).`;
  const schema = {
    type: 'OBJECT', required: ['name', 'pitch', 'mainColor', 'note', 'estimatedParts', 'difficulty', 'keyParts'],
    propertyOrdering: ['name', 'pitch', 'mainColor', 'note', 'estimatedParts', 'difficulty', 'keyParts'],
    properties: {
      name: { type: 'STRING' }, pitch: { type: 'STRING' }, mainColor: { type: 'STRING', enum: COLOR_NAMES }, note: { type: 'STRING' },
      estimatedParts: { type: 'INTEGER' }, difficulty: { type: 'INTEGER' },
      keyParts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['partId', 'count'], properties: { partId: { type: 'STRING', ...(accurate ? {} : { enum: Object.keys(have) }) }, count: { type: 'INTEGER' } } } },
    },
  };
  const r = await generate([{ role: 'user', parts: [{ text: prompt }] }], { responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' } }, signal);
  const idea = r.json as Idea;
  return { ...idea, request, mode, note: accurate ? '' : idea.note, estimatedParts: Math.max(lo, Math.min(hi, idea.estimatedParts || lo)), keyParts: idea.keyParts ?? [] };
}

/**
 * Ideas from the parts alone. Gemini gets the parts list and nothing else about what to build: no subjects,
 * categories, examples or measurements (each of those got copied into the answers). Each idea comes with the
 * whole parts list it will use, which code checks against the bucket before anything is built.
 * `avoid`: ideas already tried with these same parts. `misses`: ideas that didn't fit, and why.
 */
export async function proposeIdeas(inv: Inventory, n = 5, signal?: AbortSignal, avoid: string[] = [], misses: string[] = []): Promise<Idea[]> {
  const have = counts(inv);
  const prompt = `Here are the loose building parts someone has (partId × count):
${inventoryTable(inv)}

Come up with ${n} different things these parts can build well. Work only from these parts.
${bucketContext(inv)}
${catalogSubjectsText()}
Choose a single compact object per idea, with 2–3 defining features. Avoid a whole scene with buildings, landscape and accessories competing for the same parts. Reason about the structural base and how the pieces connect before choosing the subject. Plan deliberate patterns from the colors available; uniform color is optional.
For each one, list every part it will use (partId × count). Every count has to fit the list above: these lists are checked before anything is built.
name: 1–3 words. pitch: 10 words or fewer, plain and a little playful. why: 12 words or fewer on which of these parts make it work. difficulty: 1 (easy) to 3 (tricky).
${avoid.length ? `Already tried with these parts, so come up with different things: ${avoid.join(', ')}.\n` : ''}${misses.length ? `Earlier ideas failed these checks; choose different subjects and avoid the same problems: ${misses.join('; ')}.\n` : ''}`;
  const schema = {
    type: 'OBJECT', required: ['ideas'],
    properties: { ideas: { type: 'ARRAY', minItems: n, maxItems: n, items: {
      type: 'OBJECT', required: ['name', 'pitch', 'why', 'difficulty', 'parts'], propertyOrdering: ['name', 'pitch', 'why', 'difficulty', 'parts'],
      properties: {
        name: { type: 'STRING' }, pitch: { type: 'STRING' }, why: { type: 'STRING' }, difficulty: { type: 'INTEGER' },
        parts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['partId', 'count'], properties: { partId: { type: 'STRING', enum: Object.keys(have) }, count: { type: 'INTEGER' } } } },
      },
    } } },
  };
  const r = await generate([{ role: 'user', parts: [{ text: prompt }] }], { responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' } }, signal);
  type Raw = { name: string; pitch: string; why: string; difficulty: number; parts: KeyPart[] };
  return ((r.json as { ideas: Raw[] }).ideas ?? []).slice(0, n).map(({ parts, ...i }) => {
    const list: Record<string, number> = {};
    for (const k of parts ?? []) if (k.count > 0) list[k.partId] = (list[k.partId] ?? 0) + k.count;
    const keyParts = Object.entries(list).map(([partId, count]) => ({ partId, count }));
    const idea: Idea = { ...i, keyParts, estimatedParts: keyParts.reduce((a, k) => a + k.count, 0) };
    return { ...idea, mainColor: colorsOf(idea)[0] };
  });
}

/**
 * Ideas whose parts lists really fit the bucket. Ideas that don't fit are dropped, never built; if fewer than
 * three fit, Gemini gets one more try, told which ones didn't fit and why.
 */
export interface IdeaRound { proposed: Idea[]; verdicts: { name: string; ok: boolean; reason?: string }[] }

export async function ideasThatFit(inv: Inventory, n = 5, signal?: AbortSignal, avoid: string[] = [], feedback: string[] = []): Promise<{ ideas: Idea[]; misses: string[]; rounds: IdeaRound[] }> {
  if (usableTotal(inv) < MIN_FINISHED_PARTS) return { ideas: [], misses: [`Finished builds need at least ${MIN_FINISHED_PARTS} usable pieces`], rounds: [] };
  const ideas: Idea[] = [], misses: string[] = [...feedback], rounds: IdeaRound[] = [];
  for (let attempt = 0; attempt < 2 && ideas.length < Math.min(3, n); attempt++) {
    const round: IdeaRound = { proposed: await proposeIdeas(inv, n, signal, [...avoid, ...ideas.map(i => i.name)], misses), verdicts: [] };
    for (const idea of round.proposed) {
      const f = feasible(idea, inv);
      round.verdicts.push({ name: idea.name, ok: f.ok, reason: f.reason });
      if (f.ok) ideas.push(idea); else misses.push(`${idea.name} (${f.reason})`);
    }
    rounds.push(round);
  }
  return { ideas: ideas.slice(0, n), misses, rounds };
}

/** The judge's scores for a finished build, 1–5 each, and what would raise the lowest. `named`: the blind description
 * names the subject or its everyday category (subjectMatched also needs recognizable ≥ 3). */
export interface Verdict { looksLike: string; recognizable: number; complete: number; colors: number; impressive: number; fixes: string[]; review?: 'blind-v1'; subjectMatched?: boolean; named?: boolean }
const scoreSchema = { type: 'INTEGER', minimum: 1, maximum: 5 };
const verdictSchema = {
  type: 'OBJECT', required: ['looksLike', 'recognizable', 'complete', 'colors', 'impressive', 'fixes'],
  propertyOrdering: ['looksLike', 'recognizable', 'complete', 'colors', 'impressive', 'fixes'],
  properties: { looksLike: { type: 'STRING' }, recognizable: scoreSchema, complete: scoreSchema, colors: scoreSchema, impressive: scoreSchema, fixes: { type: 'ARRAY', items: { type: 'STRING' } } },
};
/** A recognizable but crude block model is still a draft. */
export const passes = (v: Verdict) => validVerdict(v)
  && v.recognizable >= 4 && v.complete >= 4 && v.impressive >= 4 && v.colors >= 3;

/** The first reviewer never receives the subject, inventory, caption, or builder's plan. */
export async function judgeBuild(idea: Idea, images: string[], _partsUsed: number, _totalParts: number, signal?: AbortSignal, _constraints?: string): Promise<Verdict> {
  const text = `Look at these three views of the SAME brick model. Identify the actual object you see, without inventing a story to explain miscellaneous blocks. No title is available on purpose.
looksLike: your best identification in 6 words or fewer. Be specific when the geometry supports it; say "unidentifiable block assembly" if it does not. Do not infer identity from isolated colors alone.
Score only visible design quality, with these anchors:
- recognizable: 1 = no identifiable object; 2 = ambiguous; 3 = generic category or depends on guessing; 4 = immediately recognizable with multiple defining features; 5 = unmistakable from every view.
- complete: 1–2 = missing major forms; 3 = main structure present but unresolved proportions, stray protrusions, awkward gaps or missing characteristic features; 4 = complete and well proportioned; 5 = resolved from every view.
- colors: 1–2 = confusing patchwork; 3 = broadly coherent; 4 = deliberate body, trim and accent placement; 5 = exceptionally controlled. Intentional multicolor patterns can be excellent.
- impressive: 1–2 = crude mass of blocks; 3 = recognizable but boxy/basic, with decoration sitting on a generic block; 4 = thoughtfully shaped miniature, convincing proportions, articulate silhouette, useful recesses/tapers/openings, and integrated details; 5 = exceptional craft. Piece count and size never earn points. Smooth colors alone do not turn a crude shape into a 4.
- fixes: three concrete geometry or finish changes that would most improve what you see, each at most 16 words. If identity is ambiguous, describe visible shape problems instead of adding details for a guessed subject. Do not give praise disguised as a fix.
Apply the requirements of the category you actually see, without assuming this is any particular subject:
${FAMILY_STRATEGIES.map(f => `${f.name}: ${f.quality.join('; ')}.`).join('\n')}
Score honestly. A valid, neat little box is often a 2 or 3, even if you can guess its subject.`;
  const r = await generate([{ role: 'user', parts: [...images.map(inlineImage), { text }] }], { responseSchema: verdictSchema, thinkingConfig: { thinkingLevel: 'medium' } }, signal);
  const v = r.json as Verdict;
  if (!validVerdict(v)) throw new GeminiError('The quality reviewer returned invalid scores');
  // A separate text-only match cannot reinterpret the images after learning the intended answer.
  const match = await generate([{ role: 'user', parts: [{ text: `An observer who was NOT told the intended object described a brick model as: ${JSON.stringify(v.looksLike)}.
The intended object is: ${JSON.stringify(idea.name)} (${JSON.stringify(idea.pitch)}).
Does the observer's description identify that object or its clear everyday category? Ignore style adjectives and minor variants (a house can match a cottage). A different object, a vague shape, an unidentifiable assembly, or competing guesses from unrelated categories does not match ("whale or helicopter" is ambiguous, not a successful identification). Use ONLY the written observation; you have no images to reinterpret. Return matchesSubject.` }] }], {
    responseSchema: { type: 'OBJECT', required: ['matchesSubject'], properties: { matchesSubject: { type: 'BOOLEAN' } } },
    thinkingConfig: { thinkingLevel: 'low' },
  }, signal);
  const matches = (match.json as { matchesSubject?: unknown }).matchesSubject;
  if (typeof matches !== 'boolean') throw new GeminiError('The recognition reviewer returned an invalid match');
  const identified = matches && v.recognizable >= 3;
  return {
    ...v, review: 'blind-v1', subjectMatched: identified, named: matches, recognizable: identified ? v.recognizable : Math.min(2, v.recognizable),
    // A mistaken identification must not tell the builder to turn a boombox into a fireplace.
    fixes: identified ? v.fixes.slice(0, 3) : [
      `Without its label, this reads as ${v.looksLike}; reshape its defining features.`,
      `Rebuild the characteristic silhouette and proportions of ${idea.name} using the available pieces.`,
      'Resolve the main form before adding decoration.',
    ],
  };
}

// ---------------------------------------------------------------- 3. idea → validated, self-reviewed build

export type BuildEvent =
  | { phase: 'planning' }
  | { phase: 'planned'; features: string[]; reserved: number }
  | { phase: 'compared'; selected: 'original' | 'refinement'; reason: string }
  | { phase: 'designing'; round: number }
  | { phase: 'checking'; parts: number; round: number }
  | { phase: 'issues'; round: number; summary: string; issues: Issue[]; sabotaged?: boolean }
  | { phase: 'trimmed'; removed: number }
  | { phase: 'settled'; moved: number }
  | { phase: 'connectionsFitted'; changed: number }
  | { phase: 'bodyPlanned'; candidates: number; description: string }
  | { phase: 'silhouettePlanned'; target: RobotTarget; round: number }
  | { phase: 'silhouetteLocked'; target: RobotTarget; round: number; restored?: boolean }
  | { phase: 'silhouetteFitted'; target: RobotTarget; fit: SilhouetteFit }
  | { phase: 'preview'; build: Build; partsUsed: number }
  | { phase: 'looking' }
  | { phase: 'matched'; count: number }
  | { phase: 'colorcheck'; patches: number; when: 'before' | 'after' }
  | { phase: 'improving'; changes: string[] }
  | { phase: 'kept'; reason: string }
  | { phase: 'judging' }
  | { phase: 'judged'; verdict: Verdict; pass: boolean; build: Build }
  | { phase: 'rebuilding'; round: number; of: number }
  | { phase: 'rebuilt'; build: Build; partsUsed: number }
  | { phase: 'ready'; build: Build; rounds: number; partsUsed: number; seconds: number; improved: boolean; verdict?: Verdict }
  // super fidelity: a blueprint, then one section at a time
  | { phase: 'blueprinting' }
  | { phase: 'blueprint'; sections: number; parts: number; size: string }
  | { phase: 'section'; index: number; total: number; name: string }
  | { phase: 'sectionDone'; index: number; total: number; name: string; build: Build; partsUsed: number; dropped: number }
  | { phase: 'failed'; reason: string; seconds: number };

export const MAX_REPAIRS = 6;
/** Fresh redesigns after a failed quality check, before an idea is dropped. */
const REBUILDS = 1;

function buildSchema(ids: string[] | null, withChanges = false) {
  const placed = {
    type: 'OBJECT', required: ['partId', 'x', 'y', 'z', 'rot'],
    properties: { partId: ids ? { type: 'STRING', enum: ids } : { type: 'STRING' }, x: { type: 'INTEGER' }, y: { type: 'INTEGER' }, z: { type: 'INTEGER' }, rot: { type: 'INTEGER' } },
  };
  const props: Record<string, unknown> = {
    name: { type: 'STRING' }, description: { type: 'STRING' },
    plan: {
      type: 'OBJECT', required: ['sizeX', 'sizeY', 'heightPlates', 'silhouette', 'features', 'colorZones'],
      propertyOrdering: ['sizeX', 'sizeY', 'heightPlates', 'silhouette', 'features', 'colorZones'],
      properties: {
        sizeX: { type: 'INTEGER' }, sizeY: { type: 'INTEGER' }, heightPlates: { type: 'INTEGER' },
        silhouette: { type: 'STRING' }, features: { type: 'ARRAY', items: { type: 'STRING' } },
        colorZones: { type: 'ARRAY', items: { type: 'OBJECT', required: ['zone', 'color'], properties: { zone: { type: 'STRING' }, color: { type: 'STRING', enum: COLOR_NAMES } } } },
      },
    },
    steps: { type: 'ARRAY', items: { type: 'OBJECT', required: ['caption', 'parts'], properties: { caption: { type: 'STRING' }, parts: { type: 'ARRAY', items: placed } } } },
  };
  const order = ['name', 'description', 'plan', 'steps'];
  if (withChanges) { props.changes = { type: 'ARRAY', items: { type: 'STRING' } }; order.unshift('changes'); }
  return { type: 'OBJECT', required: order, properties: props, propertyOrdering: order };
}

/**
 * Edits come as four lists with every field required, so an edit can't arrive half-specified
 * (an "add" with no partId used to be silently dropped while its paired "remove" went through).
 */
function editsSchema(ids: string[] | null, withChanges = false) {
  const order = [...(withChanges ? ['changes', 'details'] : []), 'moves', 'removes', 'adds', 'recolors'];
  const int = { type: 'INTEGER' };
  const obj = (props: Record<string, unknown>) => ({ type: 'OBJECT', required: Object.keys(props), propertyOrdering: Object.keys(props), properties: props });
  return {
    type: 'OBJECT', required: order, propertyOrdering: order,
    properties: {
      ...(withChanges ? { changes: { type: 'ARRAY', items: { type: 'STRING' } }, details: { type: 'ARRAY', items: { type: 'INTEGER' } } } : {}),
      moves: { type: 'ARRAY', items: obj({ index: int, x: int, y: int, z: int, rot: int }) },
      removes: { type: 'ARRAY', items: int },
      adds: { type: 'ARRAY', items: obj({ step: int, partId: ids ? { type: 'STRING', enum: ids } : { type: 'STRING' }, x: int, y: int, z: int, rot: int }) },
      recolors: { type: 'ARRAY', items: obj({ index: int, partId: ids ? { type: 'STRING', enum: ids } : { type: 'STRING' } }) },
    },
  };
}

interface EditLists { changes?: string[]; details?: number[]; moves?: Omit<Edit, 'op'>[]; removes?: number[]; adds?: Omit<Edit, 'op'>[]; recolors?: Omit<Edit, 'op'>[] }
function describeEdit(e: Edit) {
  switch (e.op) {
    case 'move': return `- move #${e.index} to x=${e.x}, y=${e.y}, z=${e.z}, rot=${e.rot}`;
    case 'remove': return `- remove #${e.index}`;
    case 'add': return `- add ${e.partId} at x=${e.x}, y=${e.y}, z=${e.z}, rot=${e.rot}`;
    default: return `- recolor #${e.index} to ${e.partId}`;
  }
}

/**
 * Edits must make progress. If the whole batch lowers the problem count, take it. Otherwise try the
 * edits one at a time (always against the same starting build, so part numbers stay valid) and keep
 * only those that don't add problems. The rest go back to the model as feedback.
 */
export function keepHelpfulEdits(
  build: Build, edits: Edit[], have: Record<string, number>, before: number,
  count: (b: Build) => number = b => validate(b, have).length,
) {
  const whole = applyEdits(build, edits);
  if (count(whole) < before) return { build: whole, rejected: [] as Edit[] };
  const kept: Edit[] = [], rejected: Edit[] = [];
  let best = before;
  for (const e of edits) {
    const n = count(applyEdits(build, [...kept, e]));
    if (n <= best) { kept.push(e); best = n; } else rejected.push(e);
  }
  return { build: applyEdits(build, kept), rejected };
}

const toEdits = (e: EditLists): Edit[] => [
  ...(e.moves ?? []).map(m => ({ op: 'move' as const, ...m })),
  ...(e.removes ?? []).map(index => ({ op: 'remove' as const, index })),
  ...(e.adds ?? []).map(a => ({ op: 'add' as const, ...a })),
  ...(e.recolors ?? []).map(r => ({ op: 'recolor' as const, ...r })),
];

const EDIT_HOW = `Answer with edits, not a whole new build, in four lists (leave a list empty when you don't need it):
- moves: the part's #index and its new x, y, z and rot (all four, even unchanged ones)
- removes: the #index of each part to take out
- adds: step (1-based), partId, x, y, z, rot for each new part from the unused inventory; it goes at the end of that step
- recolors: the part's #index and the partId of the SAME type and size in another color (it can never break the structure)
Parts you don't mention stay exactly where they are.`;

/** A rendered data URL as an inline image part for a request. */
const inlineImage = (url: string) => { const [, mimeType, data] = /^data:(.*?);base64,(.*)$/.exec(url) ?? []; return { inlineData: { mimeType, data } }; };
const table = (c: Record<string, number>) => Object.entries(c).map(([id, n]) => `${id} × ${n}`).join(', ') || 'none';

/** Knock one upper part well away so the repair loop can be shown on cue (?sabotage=1). Disclosed in the log. */
function sabotage(b: Build): Build {
  const c: Build = JSON.parse(JSON.stringify(b));
  const ups = c.steps.flatMap(s => s.parts).filter(p => p.z > 0);
  if (ups.length) ups[Math.floor(ups.length / 2)].x += 12;
  return c;
}

const clean = (b: Build): Build => ({ name: b.name, description: b.description, steps: (b.steps ?? []).filter(s => s.parts?.length) });

/**
 * Settle → check → ask for edits → repeat, up to `repairs` rounds, then the last-resort trim.
 * Edits leave every unmentioned part alone, so a fix can't quietly break the rest of the build.
 */
async function makeValid(
  build: Build, history: Content[], have: Record<string, number>, repairs: number, thinking: Record<string, unknown>,
  onEvent: (e: BuildEvent) => void, signal?: AbortSignal, debug?: (label: string, data: unknown) => void,
  ids: string[] | null = Object.keys(have), unused: (b: Build) => string = b => table(remaining(b, have)),
  more: {
    /** Above this many problems, ask for a whole new build instead of edits. Big builds never rewrite. */
    rewriteOver?: number;
    /** Tried after the trim, before giving up. */
    lastResort?: (b: Build) => Build | null;
  } = {},
): Promise<{ build: Build; rounds: number } | null> {
  let rejectedNote = '';
  const seen = new Set<string>();
  for (let round = 0; ; round++) {
    build = orderBuild(build);
    onEvent({ phase: 'checking', parts: partCount(build), round });
    const issues = constructionIssues(build, have);
    if (!issues.length) return { build, rounds: round };
    onEvent({ phase: 'issues', round, summary: summarize(issues), issues });
    const key = constructionKey(build);
    const repeated = seen.has(key);
    seen.add(key);
    if (round === repairs || repeated) {
      // Out of rounds: snap just the blamed parts, then drop at most 3, before giving up.
      const st = settle(build, have);
      if (st.moved) {
        onEvent({ phase: 'settled', moved: st.moved });
        if (!constructionIssues(st.build, have).length) return { build: st.build, rounds: round };
        build = st.build;
      }
      const t = trimToValid(build, have);
      if (t && !constructionIssues(t.build, have).length) { onEvent({ phase: 'trimmed', removed: t.removed }); return { build: t.build, rounds: round }; }
      const lr = more.lastResort?.(build);
      if (lr && !constructionIssues(lr, have).length) { onEvent({ phase: 'trimmed', removed: partCount(build) - partCount(lr) }); return { build: lr, rounds: round }; }
      return null;
    }
    onEvent({ phase: 'designing', round: round + 1 });
    // Lots of problems: a whole rewrite fixes them together. A few: targeted edits, so nothing else moves.
    const rewrite = issues.length > (more.rewriteOver ?? 12);
    history.push({ role: 'user', parts: [{ text: `The build now, one part per line:
${listing(build)}

An automatic checker found these problems:
${issues.map(i => `- ${i.message}`).join('\n')}

Unused parts you can still add: ${unused(build)}
${rejectedNote}
Fix every problem, keeping the object recognizable and every rule.
${rewrite ? 'Return the full corrected build.' : `Use the fewest changes. ${EDIT_HOW}`}` }] });
    const r = await generate(history, { responseSchema: rewrite ? buildSchema(ids) : editsSchema(ids), thinkingConfig: thinking }, signal);
    history.push(r.content);
    debug?.(rewrite ? 'rewrite' : 'edits', { round, issues: issues.map(i => i.message), edits: rewrite ? undefined : toEdits(r.json as EditLists), before: listing(build) });
    if (rewrite) { build = clean(r.json as Build); rejectedNote = ''; continue; }
    const kept = keepHelpfulEdits(build, toEdits(r.json as EditLists), have, issues.length, b => constructionIssues(orderBuild(b), have).length);
    rejectedNote = kept.rejected.length
      ? `\nLast round these edits were NOT applied, because each one made things worse (usually by landing on a spot that is already taken):\n${kept.rejected.map(describeEdit).join('\n')}\n`
      : '';
    build = kept.build;
  }
}

interface Plan { sizeX?: number; sizeY?: number; heightPlates?: number }

interface PolishCtx {
  idea: Idea; history: Content[]; have: Record<string, number>; ids: string[] | null; unused: (b: Build) => string;
  thinking: Record<string, unknown>; onEvent: (e: BuildEvent) => void; signal?: AbortSignal;
  debug?: (label: string, data: unknown) => void; views: (b: Build) => string[]; plan?: Plan; hi: number;
  /** Passed to makeValid: big builds fix with edits only. */
  rewriteOver?: number;
}

/**
 * The review pass, `rounds` times: Gemini looks at renders of its build next to the app's size and color
 * checks, names what reads wrong and fixes it with edits. Then leftover stray colors are matched in code.
 */
async function polish(ctx: PolishCtx, start: Build, rounds = 1): Promise<{ build: Build; improved: boolean }> {
  const { idea, history, have, ids, unused, thinking, onEvent, plan, hi } = ctx;
  let best = start;
  let improved = false;
  const detailKeys = new Set<string>(); // parts the model marked as deliberate details, by part+position
  for (let pass = 0; pass < rounds; pass++) {
    if (pass === 0) onEvent({ phase: 'preview', build: best, partsUsed: partCount(best) });
    onEvent({ phase: 'looking' });
    const imgs = ctx.views(best);
    const patches = colorPatches(best, have).filter(c => !detailKeys.has(placedKey(c.p)));
    onEvent({ phase: 'colorcheck', patches: patches.length, when: 'before' });
    const size = buildSize(best);
    const sizeNote = plan?.sizeX
      ? `- Size: your plan said ${plan.sizeX} wide (x) × ${plan.sizeY} deep (y) × ${plan.heightPlates} plates tall; the build is ${size.sizeX} × ${size.sizeY} × ${size.heightPlates}.`
      : `- Size: the build is ${size.sizeX} wide (x) × ${size.sizeY} deep (y) × ${size.heightPlates} plates tall.`;
    const colorNote = patches.length
      ? `- Color: these parts on the OUTSIDE break up the color of the area around them:\n${patches.slice(0, 20).map(c => `  #${c.index} ${c.p.partId} sits in a ${c.zoneColor} area${c.swap ? ` (an unused ${c.swap} could replace it exactly)` : ` (no unused ${c.zoneColor} part of that shape: use smaller ${c.zoneColor} parts, or move it inside)`}`).join('\n')}\n  Fix them unless the part is a deliberate detail (a light, a window, a stripe).`
      : '- Color: no stray colors on the outside.';
    history.push({ role: 'user', parts: [
      ...imgs.map(inlineImage),
      { text: `These images are your build as it renders: from the front-right 3/4 view, straight from the front, and straight from the side.${pass ? ' This is after your last round of improvements.' : ''} The build, one part per line:
${listing(best)}

Checks from the app:
${sizeNote}
${colorNote}

Compare it honestly with what a real ${idea.name} looks like.
In "changes", name the 3 biggest problems that make it read less clearly (proportions, missing signature features, inconsistent colors), each in 6 words or fewer. Then fix them, and fix the stray colors. Make color fixes with recolor edits wherever a same-shape part in the right color is unused.
In "details", list the #index of every outside part that is a deliberate detail in its own color (a light, a window, a stripe, trim): the app will leave those alone and match the remaining stray colors to their area for you, using same-size combinations of spare parts.
Unused parts you can add: ${unused(best)}. Stay within ${hi} parts in total, and add parts only where they make it read better.
${EDIT_HOW}` },
    ] });
    const rv = await generate(history, { responseSchema: editsSchema(ids, true), thinkingConfig: thinking }, ctx.signal);
    history.push(rv.content);
    const review = rv.json as EditLists;
    const reviewEdits = toEdits(review);
    const v1 = best.steps.flatMap(st => st.parts);
    for (const i of review.details ?? []) if (v1[i]) detailKeys.add(placedKey(v1[i]));
    onEvent({ phase: 'improving', changes: (review.changes ?? []).slice(0, 3) });
    const second = await makeValid(applyEdits(best, reviewEdits), history, have, 3, thinking, onEvent, ctx.signal, ctx.debug, ids, unused, { rewriteOver: ctx.rewriteOver });
    if (second) {
      best = second.build;
      improved = true;
    } else {
      // The shape changes didn't hold together. Recolors can't break anything, so keep those.
      const recolors = reviewEdits.filter(e => e.op === 'recolor');
      const recolored = recolors.length ? applyEdits(best, recolors) : null;
      if (recolored && !validate(recolored, have).length) {
        best = recolored;
        improved = true;
        onEvent({ phase: 'kept', reason: `Kept the ${pass ? 'previous' : 'first'} shape (the reshaped one didn't hold together) and applied ${recolors.length} color ${recolors.length === 1 ? 'fix' : 'fixes'}` });
      } else {
        onEvent({ phase: 'kept', reason: `Kept the ${pass ? 'previous' : 'first'} version; the improved one didn't hold together` });
      }
    }
  }
  const m = matchColors(best, have, detailKeys);
  if (m.matched) { best = m.build; onEvent({ phase: 'matched', count: m.matched }); }
  onEvent({ phase: 'colorcheck', patches: colorPatches(best, have).filter(c => !detailKeys.has(placedKey(c.p))).length, when: 'after' });
  return { build: best, improved };
}

/** When to use which part. Open catalogs also get a variety target; a bucket only has what it has. */
const SHAPING_TEXT = `- Shape every outer surface with the right part. Rounded forms get curved slopes; tapers and roofs get slopes; overhangs that widen going up get inverted slopes; legs, eyes and noses get round parts; openings get arches; tiny details get cheese slopes, 1x1 rounds and cones. Where stocked, use handed wedge plates for tapering plan outlines and 4x4 quarter plates for rounded outlines; their smooth margins have no studs.
- Cover tops that are smooth on the real thing with tiles or curved slopes, so studs only show where the real thing is textured.
- Build a solid core of long bricks and plates first, then clad it with the shaping parts.`;
const FINISH_TEXT = `OFFICIAL-SET FINISH (this is what separates a real set from a pile of bricks):
${SHAPING_TEXT}
- Use at least 7 different part types. A model of only bricks and plates looks blocky.`;
const BUCKET_FINISH_TEXT = `FINISH: the bucket has shaping parts, so use them where they fit:
${SHAPING_TEXT}`;
const STAND_IN_TEXT = `SPECIAL VERSIONS: some inventory lines say a part is really a special version (a log brick, a masonry brick, a Technic brick). It builds exactly like the plain shape, so place it the same way, but put it where its look fits: a log brick looks like wood, a masonry brick like stone. Use it like any other part otherwise.`;

/** Plan the visible identity before ordinary construction consumes the distinctive stock. */
async function planBucketQuality(inv: Inventory, idea: Idea, hi: number, signal?: AbortSignal, experimentalKit?: 'refined-hound' | 'contour-animals' | 'connections-v2') {
  const have = counts(inv);
  const assemblies = experimentalKit === 'refined-hound' ? refinedAnimalCandidates(have, hi) : experimentalKit === 'contour-animals' ? contourCandidates(have, hi) : builderAssemblies(idea.name, have, hi);
  const schema = {
    type: 'OBJECT', required: ['features', 'colorZones', 'assemblyId', 'composition'], propertyOrdering: ['assemblyId', 'composition', 'features', 'colorZones'],
    properties: {
      assemblyId: { type: 'STRING', enum: ['none', ...assemblies.map(m => m.recipeId)] },
      composition: { type: 'OBJECT', required: ['dominantForm', 'depthLayers', 'focalPoint', 'techniques'], properties: {
        dominantForm: { type: 'STRING' }, focalPoint: { type: 'STRING' },
        depthLayers: { type: 'ARRAY', minItems: 2, maxItems: 4, items: { type: 'STRING' } },
        techniques: { type: 'ARRAY', minItems: 2, maxItems: 3, items: { type: 'STRING', enum: patternsFor(idea.name).map(p => p.id) } },
      } },
      features: { type: 'ARRAY', maxItems: 3, items: {
        type: 'OBJECT', required: ['name', 'purpose', 'parts'], properties: {
          name: { type: 'STRING' }, purpose: { type: 'STRING' },
          parts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['partId', 'count'], properties: {
            partId: { type: 'STRING', enum: Object.keys(have) }, count: { type: 'INTEGER', minimum: 1 },
          } } },
        },
      } },
      colorZones: { type: 'ARRAY', maxItems: 4, items: { type: 'OBJECT', required: ['zone', 'color'], properties: { zone: { type: 'STRING' }, color: { type: 'STRING', enum: [...new Set(Object.keys(have).map(id => parsePartId(id)!.color))] } } } },
    },
  };
  const prompt = `Plan the developed silhouette and visual identity of "${idea.name}": ${idea.pitch}.
Actual pieces:\n${inventoryTable(inv)}
${bucketContext(inv)}
${DESIGN_BRIEF}
${designLanguageText(idea.name)}
Set composition to a concrete spatial plan: dominantForm gives the main dimensions and proportion; depthLayers gives 2–4 supported levels or offsets; focalPoint names the defining feature and its location; techniques chooses 2–3 rules above. For a checked seed, describe its actual geometry and a feasible improvement using only remaining stock.
Choose 2–3 defining features, the shapes that make this subject recognizable and satisfying. Each purpose says where it belongs and what exposed studs/support the core must leave for it. Reserve only the special pieces needed to FINISH those features (not their ordinary supports), at most ${reservationLimit(have, hi)} pieces TOTAL and within every listed quantity. Do not reserve the only useful base plate or wheel chassis; the connected core needs them now. A feature may list zero reserved pieces when ordinary construction supplies it.
Set colorZones for body, trim, and small accents using the stock. Keep mixed-color structural parts hidden when feasible. Do not promise a uniform color unless there is enough of the right shapes. Plan a recognizable silhouette at this scale, not a decorated rectangular block. Finished model at most ${hi} pieces.
${techniqueText(have)}
${familyPlanText(idea.name)}
${animalPlanText(idea.name)}
${assemblyText(assemblies)}
Set assemblyId to a checked assembly above or none. Compiled component plans are executable alternatives with their head, roof or cab already fitted. Prefer one when its proportions and defining features suit this request; choose by its actual geometry, not its label. When choosing an assembly, do not reserve pieces: its fixed core already consumes its own stock, and the next pass gets only the remainder. Return the selection, spatial composition, feature reservations and color plan, not placements.`;
  const deadline = new AbortController();
  let timedOut = false;
  const stop = () => deadline.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(() => { timedOut = true; deadline.abort(); }, 30_000);
  try {
    const r = await generate([{ role: 'user', parts: [{ text: prompt }] }], { responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' } }, deadline.signal);
    const raw = r.json as QualityPlan & { assemblyId?: string };
    const seed = assemblies.find(m => m.recipeId === raw.assemblyId);
    const plan = seed ? { ...raw, features: (Array.isArray(raw.features) ? raw.features : []).map(f => ({ ...f, parts: [] })) } : raw;
    return { ...allocateFeatures(plan, have, hi), seed };
  } catch (e) {
    if (timedOut && !signal?.aborted) throw new GeminiError('Feature planning reached its time limit');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** One bounded visual revision, one optional correction, then a blind A/B comparison. */
export async function refineBucketBuild(
  inv: Inventory, idea: Idea, original: Build, priorVerdict: Verdict, onEvent: (e: BuildEvent) => void,
  opts: NonNullable<Parameters<typeof designBuild>[3]>, plan: QualityPlan = emptyQualityPlan(), hi = partRange(inv).hi,
  scope?: ModuleRefinementScope,
): Promise<{ build: Build; verdict: Verdict; improved: boolean }> {
  const fallback = { build: original, verdict: priorVerdict, improved: false };
  if (!opts.views || original.engine==='connections-v2') return fallback;
  const have = counts(inv), limits = refinementLimits(original);
  const budget = new AbortController();
  let timedOut = false;
  const stop = () => budget.abort();
  opts.signal?.addEventListener('abort', stop, { once: true });
  if (opts.signal?.aborted) stop();
  const timer = setTimeout(() => { timedOut = true; budget.abort(); }, 75_000);
  try {
    const thinking = { thinkingLevel: opts.thinking ?? 'medium' };
    const originalViews = opts.views(original);
    opts.debug?.('refinementScope', scope ?? { id: 'whole-model' });
    const history: Content[] = [{ role: 'user', parts: [...originalViews.map(inlineImage), { text: scope ? modulePrompt(original, scope) : `Refine this already connected "${idea.name}": ${idea.pitch}. Improve its silhouette, proportions, one defining feature, or deliberate visible colors. A successful build still deserves a finishing pass. Keep its identity and scale. Aim for a visible improvement, not merely more pieces. If nothing worthwhile fits, return empty edits.
  ${CONTRACT_TEXT}\n${SPECIALTY_TEXT}
  ${qualityPlanText(plan)}
${designLanguageText(idea.name)}
  ${familyPlanText(idea.name)}
  Current model (indices remain fixed for all edits):\n${listing(original)}
  Exposed studs:\n${attachmentMap(original)}
  Unused pieces:\n${table(remaining(original, have))}
  Full inventory ceiling (removed parts are available again within this same revision):\n${table(have)}
  Reviewer suggestions: ${priorVerdict.fixes.join('; ')}.
  You MAY move, remove, replace or recolor parts of the existing core. Change at most ${limits.changed} existing parts and add at most ${limits.added} pieces, with at most ${hi} pieces in the finished model. Focus on one local feature or coordinated color improvement. Preserve at least 65% of the current piece count and every other section. Keep x/y footprints inside 0–23. No overlaps or detached pieces. Include all needed support changes in the same batch. Replacements use removes plus adds; recolors must keep the same shape and size.
  ${techniqueText(have)}
  In changes, name the visible improvements. details may be empty; intentional accents will not be automatically recolored.
  ${EDIT_HOW}` }] }];
    onEvent({ phase: 'rebuilding', round: 1, of: 1 });
    let candidate: Build | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await generate(history, { responseSchema: scope ? moduleSchema(scope) : editsSchema(Object.keys(have), true), thinkingConfig: thinking }, budget.signal);
      history.push(r.content);
      const review = r.json as EditLists & { parts?: unknown };
      const checked = scope ? moduleReplacement(original, scope, review.parts, have, hi) : refinementCandidate(original, toEdits(review), have, hi);
      opts.debug?.('refinementCandidate', { attempt, original, candidate: checked.build, issues: checked.issues, changes: review.changes });
      if (checked.build === original) { onEvent({ phase: 'kept', reason: 'Kept the original; no worthwhile change was proposed' }); return fallback; }
      if (checked.build) {
        candidate = checked.build;
        onEvent({ phase: 'improving', changes: (review.changes ?? []).slice(0, 3) });
        break;
      }
      if (!attempt) history.push({ role: 'user', parts: [{ text: `The revision was rejected as a whole; the ORIGINAL is unchanged. ${scope ? 'Return a corrected complete module parts array within the same locked boundaries and stock ceiling.' : 'Return a smaller corrected replacement edit batch using the ORIGINAL indices.'} Do not repeat the rejected batch. Problems:\n${checked.issues.join('\n')}` }] });
    }
    if (!candidate) { onEvent({ phase: 'kept', reason: 'Kept the original; the refinement did not pass the construction checks' }); return fallback; }
    onEvent({ phase: 'judging' });
    // Randomize presentation; the judge is not told which model is the revision or given its rationale.
    const candidateIsA = Math.random() < 0.5;
    const a = candidateIsA ? candidate : original, b = candidateIsA ? original : candidate;
    const viewsA = candidateIsA ? opts.views(candidate) : originalViews, viewsB = candidateIsA ? originalViews : opts.views(candidate);
    const comparison = await generate([{ role: 'user', parts: [
      { text: `Compare two valid brick models of "${idea.name}": ${idea.pitch}. Neither is the default winner. Judge only the renders. Both must work with this same inventory: ${table(have)}. A small complete model can be excellent. Do not reward size, piece count, or image order.
Score A and B from 1–5 for recognizable (subject identity), complete (finished-looking), colors (intentional palette) and impressive (clear silhouette and satisfying detail). looksLike describes what each actually resembles. Give up to three concrete fixes each. Prefer the model with a clear visible improvement while retaining identity and completeness. Choose tie when the difference is uncertain. Explain the visible difference in one short sentence. No preference based merely on number of parts.` },
      { text: `MODEL A — ${partCount(a)} pieces, unused: ${table(remaining(a, have))}. Its three views follow.` }, ...viewsA.map(inlineImage),
      { text: `MODEL B — ${partCount(b)} pieces, unused: ${table(remaining(b, have))}. Its three views follow.` }, ...viewsB.map(inlineImage),
    ] }], { responseSchema: { type: 'OBJECT', required: ['a', 'b', 'preferred', 'reason'], properties: { a: verdictSchema, b: verdictSchema, preferred: { type: 'STRING', enum: ['A', 'B', 'tie'] }, reason: { type: 'STRING' } } }, thinkingConfig: thinking }, budget.signal);
    const pair = comparison.json as { a: Verdict; b: Verdict; preferred: string; reason: string };
    const before = candidateIsA ? pair.b : pair.a, after = candidateIsA ? pair.a : pair.b;
    const wins = scope ? draftRefinementWins : refinementWins;
    let selected = wins(before, after, pair.preferred === (candidateIsA ? 'A' : 'B')) && (scope ? typeof pair.reason === 'string' && pair.reason.trim().length > 0 : true);
    let checked: Verdict | undefined;
    if (selected) {
      // The named comparison cannot promote a model the unnamed observer cannot recognize.
      checked = await judgeBuild(idea, opts.views(candidate), partCount(candidate), usableTotal(inv), budget.signal);
      selected = wins(priorVerdict, checked, true);
      onEvent({ phase: 'judged', verdict: checked, pass: passes(checked), build: candidate });
    }
    const reason = checked && !selected ? 'The review without a title did not confirm an improvement; kept the original.' : pair.reason || 'No clear visual improvement';
    opts.debug?.('qualityComparison', { original, candidate, before, after, checked, preferred: pair.preferred, candidateLabel: candidateIsA ? 'A' : 'B', selected, reason });
    onEvent({ phase: 'compared', selected: selected ? 'refinement' : 'original', reason });
    if (!selected || !checked) return fallback;
    onEvent({ phase: 'rebuilt', build: candidate, partsUsed: partCount(candidate) });
    return { build: candidate, verdict: checked, improved: true };
  } catch (e) {
    if (opts.signal?.aborted || (!timedOut && (e as Error).name === 'AbortError')) throw e;
    opts.debug?.('refinementSkipped', { reason: (e as Error).message });
    onEvent({ phase: 'kept', reason: timedOut ? 'Kept the checked original; the refinement reached its time limit' : 'Kept the checked original; the optional refinement could not finish' });
    return fallback;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', stop);
  }
}

export interface ModuleTask { id: string; scope: (draft: Build, have: Record<string,number>) => ModuleRefinementScope | undefined }

/** Bounded progressive drafts. Each receipt and stock budget is regenerated after the previous edit. */
export async function refineModuleSequence(inv: Inventory, idea: Idea, original: Build, verdict: Verdict, tasks: ModuleTask[], onEvent: (e: BuildEvent) => void, opts: NonNullable<Parameters<typeof designBuild>[3]>, hi = partRange(inv).hi) {
 let current = {build: original, verdict, improved: false};
 for(const task of tasks.slice(0,3)) {
  if(opts.signal?.aborted) throw new DOMException('Aborted','AbortError');
  const scope=task.scope(current.build,counts(inv));
  if(!scope) { opts.debug?.('moduleSkipped',{id:task.id,reason:'No current verified receipt'}); continue; }
  opts.debug?.('moduleStarted',{id:task.id,build:current.build});
  const next=await refineBucketBuild(inv,idea,current.build,current.verdict,onEvent,opts,undefined,hi,scope);
  current={...next,improved:current.improved||next.improved};
  opts.debug?.('moduleRetained',{id:task.id,build:current.build,verdict:current.verdict,changed:next.improved,finished:passes(current.verdict)});
 }
 return current;
}

/** Bucket builds grow from a verified core. A failed addition never replaces the last valid assembly. */
async function designBucket(inv: Inventory, idea: Idea, onEvent: (e: BuildEvent) => void, opts: NonNullable<Parameters<typeof designBuild>[3]>): Promise<Build | null> {
  const start = performance.now(), have = counts(inv);
  const estimate = idea.estimatedParts || 30;
  const hi = strategiesFor(idea.name).length ? partRange(inv).hi : Math.min(partRange(inv).hi, Math.max(40, estimate + Math.min(8, Math.ceil(estimate * 0.2))));
  const thinking = { thinkingLevel: opts.thinking ?? 'medium' };
  let best: Build | null = null, rounds = 0, improved = false, unfinishedAnimalParts = 0, completeAssembly = false;
  let refinementScope: ModuleRefinementScope | undefined;
  let moduleTasks: ModuleTask[] = [];
  try {
    if (usableTotal(inv) < MIN_FINISHED_PARTS) throw new GeminiError(`Finished builds need at least ${MIN_FINISHED_PARTS} usable pieces. Confirm more pieces in your pile first.`);
    onEvent({ phase: 'planning' });
    let allocation = allocateFeatures(emptyQualityPlan(), have, hi);
    try {
      const planned = await planBucketQuality(inv, idea, hi, opts.signal, opts.experimentalKit === 'animal-anatomy' ? undefined : opts.experimentalKit); allocation = planned;
      if (planned.seed && !opts.sabotage) {
        best = { ...planned.seed.build, name: idea.name, description: idea.pitch, source: undefined };
        completeAssembly = !!(planned.seed.componentPlan || planned.seed.silhouettePlan);
        if (opts.experimentalKit === 'refined-hound') {
          const seed=planned.seed;
          refinementScope = refinedMuzzleScope(seed, have);
          if(refinementScope) moduleTasks=[{id:'hound-muzzle',scope:()=>refinementScope}, {id:'hound-shoulder-contour',scope:(draft,stock)=>refinedBackScope(seed,draft,stock)}];
        }
        if (planned.seed.recipeId.startsWith('animal-base-')) unfinishedAnimalParts = partCount(best);
        onEvent({ phase: 'kept', reason: `Started from the checked ${planned.seed.build.name} assembly (${planned.seed.label ?? 'original'})` });
        opts.debug?.('librarySeed', { recipeId: planned.seed.recipeId, build: best, componentPlan: planned.seed.componentPlan });
      }
    }
    catch (e) {
      if (opts.signal?.aborted || (e as Error).name === 'AbortError') throw e;
      onEvent({ phase: 'kept', reason: 'Planning was unavailable; continuing with the full checked inventory' });
    }
    const reservedCount = Object.values(allocation.reserved).reduce((a, n) => a + n, 0);
    const coreLimit = Math.min(hi - reservedCount, 40), coreIds = Object.keys(allocation.core);
    const planText = qualityPlanText(allocation.plan);
    opts.debug?.('qualityPlan', allocation);
    onEvent({ phase: 'planned', features: allocation.plan.features.map(f => f.name), reserved: reservedCount });
    const text = `Design a substantial, carefully proportioned "${idea.name}: ${idea.pitch}" from this exact CORE inventory:
${table(allocation.core)}

${bucketContext(inv)}
${CONTRACT_TEXT}
${Object.keys(have).some(id => SPECIALTY_TYPES.includes(parsePartId(id)!.type)) ? SPECIALTY_TEXT : ''}
${STAND_IN_TEXT}
${planText}
${designLanguageText(idea.name)}
${familyPlanText(idea.name)}
The reserved finishing pieces are NOT available for the core; their counts have already been deducted above. Leave exposed studs and room for those features. Give the core its characteristic proportions and silhouette now; do not rely on details to disguise a generic block.
${techniqueText(allocation.core)}

${DESIGN_BRIEF}
First build a COMPLETE STRUCTURAL CORE, using at most ${coreLimit} parts. It must already suggest the subject through its silhouette and two defining features. Later turns can add detail, but the core must be a single connected object now. Start with one sturdy base or overlapping plates; keep the footprint small enough to finish with the parts available. Do not use surrounding scenery to inflate it. Leave exposed studs for details.
Choose a scale that leaves room for anatomy or architecture, recesses, and recognizable detail. Recognition alone is not a finished design. Symmetry of shape matters more than identical colors; repeated color patterns are welcome. Never assume more pieces than listed. Every piece above the ground must rest on studs, with no overlap. All parts must join into ONE piece. Keep every footprint inside x/y 0–23.
Write a short plan and the core's parts as 3–8 small steps. The plan establishes the finished proportions and the connected core that supports them. Total finished model at most ${hi} parts; unused pieces are fine.`;
    const history: Content[] = [{ role: 'user', parts: [{ text }] }];
    onEvent({ phase: 'designing', round: 0 });
    for (let attempt = 0; attempt < 2 && !best; attempt++) {
      if (attempt) history.push({ role: 'user', parts: [{ text: `The first core could not connect. Start over with fewer pieces and a simpler silhouette. Use one base with interlocking layers. At most ${coreLimit} parts. Resolve the connections while preserving the intended proportions; this is a draft, not the finished result.` }] });
      const r = await generate(history, { responseSchema: buildSchema(coreIds), thinkingConfig: thinking }, opts.signal);
      history.push(r.content);
      let draft = clean(r.json as Build);
      if (opts.sabotage && attempt === 0) {
        draft = sabotage(draft);
        onEvent({ phase: 'issues', round: 0, summary: 'one part knocked loose', issues: [], sabotaged: true });
      }
      const first = await makeValid(draft, history, allocation.core, 3, thinking, onEvent, opts.signal, opts.debug, coreIds);
      if (first && partCount(first.build) <= coreLimit && !constructionIssues(first.build, allocation.core, 24).length) {
        best = first.build; rounds += first.rounds;
        opts.debug?.('qualityCore', { build: best, coreInventory: allocation.core, reserved: allocation.reserved });
      }
    }
    if (!best) throw new GeminiError("Couldn't connect a small version with these parts");
    onEvent({ phase: 'preview', build: best, partsUsed: partCount(best) });

    // Short responses over a fixed, checked base. The model gets exact available attachment cells.
    // A complete component plan already contains its identity and finishing modules.
    // Review it before editing; unreviewed additive growth can obscure those features.
    const stages = completeAssembly ? 0 : Math.min(3, Math.ceil((hi - partCount(best)) / 20));
    for (let stage = 0; stage < stages && partCount(best) < hi; stage++) {
      const base: Build = best;
      const left = remaining(base, have);
      const allowance = Math.min(20, hi - partCount(base));
      const name = stage === 0 ? 'Signature details' : 'Develop the shape';
      onEvent({ phase: 'section', index: stage, total: stages, name });
      const parts: Content['parts'] = opts.views ? opts.views(base).map(inlineImage) : [];
      parts.push({ text: `Develop this checked ${idea.name}. ${idea.pitch}
${CONTRACT_TEXT}
${SPECIALTY_TEXT}
${planText}
${designLanguageText(idea.name)}
${familyPlanText(idea.name)}
${animalPlanText(idea.name)}
The finishing reservations are now released into the remaining stock below. Complete those signature features first; do not spend their pieces on unrelated filler. Follow the visible color zones when feasible.
${techniqueText(left)}
The existing parts are FIXED; do not repeat, move or recolor them:
${listing(base)}

Exposed stud cells computed by the app (new parts may grip here):
${attachmentMap(base)}

Remaining pieces only:
${table(left)}

${DESIGN_BRIEF}
This draft has ${partCount(base)} pieces. ${partCount(base) < MIN_FINISHED_PARTS ? `It must gain at least ${MIN_FINISHED_PARTS - partCount(base)} purposeful pieces before it can finish.` : 'Only add pieces that improve the design.'}
Add 0–${allowance} pieces to make the silhouette clearer, finish the main shape, or add its defining details. Prioritize the subject over scenery. Preserve its scale and deliberate color pattern. Return ONLY new parts, in short steps. Every addition must connect to the core through studs directly or through other new parts; no detached objects, no overlaps, all footprints inside x/y 0–23. If the model is complete or these remaining pieces won't improve it, return an empty steps list. No need to use up the pile.` });
      const convo: Content[] = [{ role: 'user', parts }];
      const schema = { type: 'OBJECT', required: ['steps'], properties: { steps: buildSchema(Object.keys(left)).properties.steps } };
      const seen = new Set<string>();
      let accepted = false;
      for (let repair = 0; repair < 3; repair++) {
        const r = await generate(convo, { responseSchema: schema, thinkingConfig: thinking }, opts.signal);
        convo.push(r.content);
        const steps = (r.json as { steps?: Build['steps'] }).steps ?? [];
        const added = steps.reduce((n, s) => n + (s.parts?.length ?? 0), 0);
        if (!added) break;
        const candidate = joinConstruction(base, steps);
        onEvent({ phase: 'checking', parts: partCount(candidate), round: repair });
        const issues = constructionIssues(candidate, have, 24);
        if (added > allowance) issues.push({ kind: 'invalid', message: `This addition has ${added} parts; maximum ${allowance}. Simplify it.`, parts: [] });
        opts.debug?.('growth', { stage, repair, added, issues: issues.map(i => i.message), build: candidate });
        if (!issues.length) { best = candidate; accepted = true; break; }
        onEvent({ phase: 'issues', round: repair, summary: summarize(issues), issues });
        const key = constructionKey(candidate);
        if (seen.has(key)) break;
        seen.add(key);
        onEvent({ phase: 'designing', round: repair + 1 });
        convo.push({ role: 'user', parts: [{ text: `The new pieces have these problems:\n${issues.map(i => i.message).join('\n')}\nReturn a corrected replacement for ONLY the new steps. The original core remains fixed. You may remove a proposed addition; never alter the core. Use the exposed stud map and remaining inventory above.` }] });
      }
      if (!accepted) {
        onEvent({ phase: 'kept', reason: 'Kept the connected version; these additions did not improve it safely' });
        break;
      }
      onEvent({ phase: 'sectionDone', index: stage, total: stages, name, build: best, partsUsed: partCount(best), dropped: 0 });
    }

    if (unfinishedAnimalParts && partCount(best) <= unfinishedAnimalParts) throw new GeminiError('The animal body still needs its head and defining features; no completed animal was produced.');
    const sizeIssue = finishedSizeIssue(best);
    if (sizeIssue) throw new GeminiError(sizeIssue);
    let verdict: Verdict | undefined;
    if (opts.views) {
      const look = async (b: Build) => {
        onEvent({ phase: 'judging' });
        const constraints = `${bucketContext(inv)}\nInventory: ${table(have)}\nStill unused: ${table(remaining(b, have))}`;
        const v = await judgeBuild(idea, opts.views!(b), partCount(b), usableTotal(inv), opts.signal, constraints);
        onEvent({ phase: 'judged', verdict: v, pass: passes(v), build: b }); opts.debug?.('verdict', v);
        return v;
      };
      // Every valid build gets a bounded chance to improve, including ones that already pass.
      verdict = await look(best);
      const refined = moduleTasks.length
        ? await refineModuleSequence(inv, idea, best, verdict, moduleTasks, onEvent, opts, hi)
        : await refineBucketBuild(inv, idea, best, verdict, onEvent, opts, allocation.plan, hi);
      best = refined.build; verdict = refined.verdict; improved = refined.improved;
    }
    if (constructionIssues(best, have, 24).length) throw new GeminiError('The final build did not pass the parts and connection checks');
    const finalSizeIssue = finishedSizeIssue(best);
    if (finalSizeIssue) throw new GeminiError(finalSizeIssue);
    if (verdict && !passes(verdict)) throw new GeminiError(`This draft did not pass the visual quality review: ${verdict.fixes.join('; ')}`);
    best = { ...best, source: undefined };
    onEvent({ phase: 'ready', build: best, rounds, partsUsed: partCount(best), seconds: Math.round((performance.now() - start) / 1000), improved, verdict });
    return best;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    onEvent({ phase: 'failed', reason: (e as Error).message, seconds: Math.round((performance.now() - start) / 1000) });
    return null;
  }
}

/** Shape design and visual approval precede ALL stock allocation. The allocator may
 * change tilings/colors only. An infeasible shape starts an explicit new planning round. */
async function designRobotBodyBuild(inv:Inventory,idea:Idea,have:Record<string,number>,onEvent:(e:BuildEvent)=>void,opts:NonNullable<Parameters<typeof designBuild>[3]>,signal:AbortSignal,start:number):Promise<Build|null>{
  let best:{candidate:RobotCandidate;target:RobotTarget;verdict:Verdict;fit:SilhouetteFit}|undefined;
  let feedback='';const tried=new Set<string>();
  const active=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError');};
  const targetViews=opts.targetViews??renderRobotTarget;
  for(let round=1;round<=2;round++){
    active();onEvent({phase:'planning'});
    const reply=await generate([{role:'user',parts:[{text:`Plan an appealing silhouette for ${idea.name}: ${idea.pitch}.
${ROBOT_MODULE_BRIEF}
Available stock (for scale and feasibility context only; no allocation has happened):
${table(have)}
${robotModuleStockGuidance(have)}
${feedback?`An earlier target needs revision: ${feedback}. Return a DIFFERENT module combination. Previous target IDs: ${[...tried].join('; ')}.`:''}`}]}],{responseSchema:ROBOT_MODULE_SCHEMA,maxOutputTokens:1536,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},signal);
    active();let target:RobotTarget;
    try{target=createRobotTarget(robotModuleSpec(reply.json));if(tried.has(target.id))throw Error('Do not repeat an already rejected silhouette.');}
    catch(e){feedback=(e as Error).message;opts.debug?.('silhouetteRejected',{round,stage:'specification',reason:feedback});onEvent({phase:'issues',round,summary:feedback,issues:[]});continue;}
    tried.add(target.id);opts.debug?.('robotSilhouette',{round,target,allocationStarted:false});onEvent({phase:'silhouettePlanned',target,round});active();
    const images=targetViews(target);
    if(images.length<2||images.some(i=>!/^data:image\/(png|jpeg);base64,/.test(i)))throw new GeminiError('Front and side silhouette drawings are required before fitting pieces.');
    const exterior=exteriorContour(target);opts.debug?.('robotExteriorContour',{round,targetId:target.id,...exterior,allocationStarted:false});
    if(exterior.issues.length){feedback=exterior.issues.join(' ');onEvent({phase:'issues',round,summary:`Silhouette needs revision: ${feedback}`,issues:[]});continue;}
    const reviewed=await generate([{role:'user',parts:[...images.map(inlineImage),{text:`Review ONLY this front and side shape target for ${idea.name}. No LEGO build or piece allocation exists yet. Check visible exterior contours, proportions, head/body hierarchy, leg gap, arm length and torso depth. Exposed slopes, undercuts and curves must materially shape the outline. Reject a collection of rectangular blocks even if it is recognizably a robot. Small decorative wedges do not excuse a box-shaped body. Reject awkward or ambiguous targets. Return accepted and a short reason; do not assess colors or construction.`}]}],{responseSchema:{type:'OBJECT',required:['accepted','reason'],properties:{accepted:{type:'BOOLEAN'},reason:{type:'STRING'}}},maxOutputTokens:1024,thinkingConfig:{thinkingLevel:'medium'}},signal);
    active();const review=reviewed.json as {accepted?:unknown;reason?:unknown};
    if(typeof review?.accepted!=='boolean'||typeof review?.reason!=='string')throw new GeminiError('The silhouette reviewer returned an invalid decision.');
    opts.debug?.('robotSilhouetteReview',{round,targetId:target.id,...review,allocationStarted:false});
    if(!review.accepted){feedback=review.reason;onEvent({phase:'issues',round,summary:`Silhouette needs revision: ${feedback}`,issues:[]});continue;}
    onEvent({phase:'silhouetteLocked',target,round});opts.debug?.('robotTargetLocked',{round,target});active();
    onEvent({phase:'designing',round});
    const diagnostics:string[]=[],solutions=solveRobotTarget(have,target,diagnostics);
    opts.debug?.('robotAllocation',{round,targetId:target.id,solutions:solutions.length,diagnostics:[...new Set(diagnostics)]});
    active();
    if(!solutions.length){feedback=`The frozen target ${JSON.stringify(target.shape)} could not be filled from the stock: ${[...new Set(diagnostics)].slice(0,4).join('; ')}. Replan its dimensions explicitly; no partial build was accepted.`;onEvent({phase:'issues',round,summary:feedback,issues:[]});continue;}
    // All solutions share the SAME frozen geometry. Prefer a simpler palette, not a different outline.
    const paletteCost=(c:RobotCandidate)=>new Set(c.build.steps.flatMap(s=>s.parts).map(p=>parsePartId(p.partId)!.color)).size;
    const candidate=solutions.sort((a,b)=>paletteCost(a)-paletteCost(b))[0];
    const fitted=fitConnectionProgram(candidate.program,have,{validate:(b,complete)=>[...robotBodyIssues(b,candidate.contract,complete),...(complete?silhouetteFit(b,target,candidate.contract.roles).issues:[])]});
    const build=fitted.build,fit=silhouetteFit(build,target,candidate.contract.roles);
    if(fit.issues.length||finishedSizeIssue(build))throw new GeminiError(fit.issues.join('; ')||finishedSizeIssue(build)!);
    if(candidate.modules){build.description=candidate.build.description;build.steps.forEach((step,i)=>{const id=candidate.contract.features!.assignment[i];step.caption=`${target.zones!.find(z=>z.id===id)!.feature}. ${step.caption}`;});}
    candidate.build=build;
    opts.debug?.('robotSolution',{round,target,candidate,fit,changes:fitted.changes});
    onEvent({phase:'bodyPlanned',candidates:solutions.length,description:'Part combinations fitted to the frozen silhouette.'});
    onEvent({phase:'checking',parts:partCount(build),round});onEvent({phase:'preview',build,partsUsed:partCount(build)});onEvent({phase:'silhouetteFitted',target,fit});onEvent({phase:'looking'});
    const verdict=await judgeBuild(idea,opts.views!(build),partCount(build),usableTotal(inv),signal);
    opts.debug?.('connectionVerdict',{round,build,verdict});onEvent({phase:'judged',verdict,pass:passes(verdict)&&verdict.subjectMatched===true,build});
    if(passes(verdict)&&verdict.subjectMatched===true){onEvent({phase:'ready',build,rounds:round,partsUsed:partCount(build),seconds:Math.round((performance.now()-start)/1000),improved:round>1,verdict});return build;}
    const score=(v:Verdict)=>Math.min(v.recognizable,v.complete,v.impressive)*10+v.recognizable+v.complete+v.impressive+v.colors;
    if(!best||score(verdict)>score(best.verdict))best={candidate,target,verdict,fit};
    feedback=`The assembled ${JSON.stringify(target.shape)} matched its target, but appearance scored ${JSON.stringify(verdict)}. Revise the target shape to address the geometry concerns. Colors and missing details alone cannot be fixed by pretending the silhouette changed.`;
  }
  if(best){onEvent({phase:'silhouetteLocked',target:best.target,round:2,restored:true});onEvent({phase:'preview',build:best.candidate.build,partsUsed:partCount(best.candidate.build)});onEvent({phase:'silhouetteFitted',target:best.target,fit:best.fit});onEvent({phase:'judged',build:best.candidate.build,verdict:best.verdict,pass:false});}
  throw new GeminiError(best?'The build matches its planned silhouette but does not pass the finished-build appearance review.':`No approved silhouette could be completed with these pieces. ${feedback}`);
}

/** A separate appearance budget starts only after a complete attachment program is valid.
 * Failed edits are atomic; only independently preferred, non-regressing drafts survive. */
export async function refineConnectionBuild(
  inv:Inventory, idea:Idea, original:ConnectionDraft, onEvent:(e:BuildEvent)=>void,
  opts:NonNullable<Parameters<typeof designBuild>[3]>,
):Promise<ConnectionDraft & {improved:boolean}> {
  let best=original, improved=false;
  if(!opts.views||opts.visualRevisionMode==='off')return {...best,improved};
  const have=Object.fromEntries(Object.entries(counts(inv)).filter(([id,n])=>{try{definition(parsePartId(id)!);return Number.isSafeInteger(n)&&n>0;}catch{return false;}})), controller=new AbortController();let timedOut=false;
  const stop=()=>controller.abort(),active=()=>{if(controller.signal.aborted)throw new DOMException('Stopped','AbortError');};
  opts.signal?.addEventListener('abort',stop,{once:true});if(opts.signal?.aborted)stop();
  const timer=setTimeout(()=>{timedOut=true;stop();},240_000);
  const seen=new Set([connectionGeometryKey(original.build)]);
  let feedback='';
  try {
    active();
    const verified=compileConnections(original.program,have);
    if(original.program.operations.length<20||original.program.operations.length>60||connectionGeometryKey(verified)!==connectionGeometryKey(original.build)||!validVerdict(original.verdict))throw Error('The revision baseline must match its checked program and review.');
    for(let round=1;round<=3;round++){
      active();if(passes(best.verdict)&&best.verdict.subjectMatched===true)break;
      const images=opts.views(best.build), limits=refinementLimits(best.build), n=best.program.operations.length;
      onEvent({phase:'rebuilding',round,of:3});
      const history:Content[]=[{role:'user',parts:[...images.map(inlineImage),{text:`Visually revise this connected ${idea.name}: ${idea.pitch}.
Study all actual renders. Identify the single biggest visible weakness, then fix that region while preserving successful structure. Prioritize proportions, silhouette and shaped transitions before trim. Do not add filler or a display base to inflate detail. If only a finish improvement is feasible, make that honest smaller improvement. Reviewer suggestions are observations, NOT extra inventory or mandatory parts: ${JSON.stringify(best.verdict)}.
Return a focused attachment PATCH, not a replacement model. focus explains the visible change. updates contains complete operations plus their existing index; remove contains old indices; add contains new operations. All parent references use CURRENT indices, even after removals. Addition i has logical index ${n}+i. Parents may be existing or added surviving indices. A new spacer may become the parent of an existing piece: the compiler will reorder the attachment graph into assembly order. Never create a cycle. The root (0) stays fixed. Deleting a parent requires explicitly reparenting or deleting its children. Removed stock is reusable. Empty arrays mean no useful feasible change.
CURRENT effective program (operation array index = physical part index): ${JSON.stringify(best.program)}
CURRENT part positions (stud/plate units, orientations retained): ${listing(best.build)}
Unused stock: ${table(remaining(best.build,have))}
Original stock ceiling: ${table(have)}
LOCKED successful module groups: ${JSON.stringify(best.receipts)}. Do not update or remove any group part operation. You can adjust its ordinary host to move the complete rigid assembly if needed, preserving every internal connection and original color. Other successful regions must stay unchanged.
Change or remove at most ${limits.changed} existing physical parts, including descendants that move when their parent moves. Add at most ${limits.added}; complete result 20–60 parts. Do not repaint or rebuild the whole object. A proposed patch is accepted atomically only if all connections, stock, collisions, contacts and ground checks pass. No automatic fitting will move unrelated geometry.
Local axes: x right, y back, z up. Connectors are LDU, 20/stud and 8/plate; ports retain local IDs through rotation. A 1xN part extends along x. Each child inherits the parent's orientation; twist is around the outward parent connector normal. Quarter turns are safest. No hinge/pin connections. Use only actual ports below. For curved/special shapes, do not assume an unlisted port.
${connectorShapeText(have)}
Available unoccupied connectors on the current assembly:
${attachmentMap(best.build)}
${feedback?`Previous revision outcome: ${feedback}. Address that feedback or choose a different visible weakness.`:''}`}]}];
      let candidate:ConnectionDraft|undefined,focus='';
      for(let attempt=1;attempt<=2;attempt++){
        let reply:Reply;
        try{reply=await generate(history,{responseSchema:CONNECTION_PATCH_SCHEMA,maxOutputTokens:16384,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},controller.signal);}
        catch(e){
          active();if(!/Empty reply|not valid JSON/.test((e as Error).message))throw e;
          feedback=(e as Error).message;opts.debug?.('connectionRevisionRejected',{round,attempt,reason:feedback});
          history.push({role:'user',parts:[{text:'The previous response did not contain a complete patch. Return one smaller feasible local change with concise focus text and complete JSON. The current model and all indices remain unchanged.'}]});continue;
        }
        active();history.push(reply.content);
        const checked=patchConnectionDraft(best,reply.json,have);
        opts.debug?.('connectionRevisionPatch',{round,attempt,patch:reply.json,changed:checked.changed,issues:checked.issues,program:checked.draft?.program,build:checked.draft?.build});
        if(checked.draft){
          const key=connectionGeometryKey(checked.draft.build);
          if(seen.has(key)){feedback='No new geometry: the current or a rejected model was repeated. It was not judged again.';break;}
          seen.add(key);candidate=checked.draft;focus=(reply.json as {focus:string}).focus;break;
        }
        feedback=checked.issues.join('; ');
        history.push({role:'user',parts:[{text:`The patch was rejected atomically; the current model is unchanged. Correct this patch using the SAME current indices. Exact issues: ${feedback}. Do not invent missing stock. Prefer a smaller feasible repair.`}]});
      }
      active();if(!candidate){opts.debug?.('connectionRevisionRejected',{round,reason:feedback});continue;}
      onEvent({phase:'improving',changes:[focus]});onEvent({phase:'judging'});
      const candidateImages=opts.views(candidate.build);
      const verdict=await judgeBuild(idea,candidateImages,candidate.program.operations.length,usableTotal(inv),controller.signal);active();candidate.verdict=verdict;
      let selected=false,reason='The independent review did not preserve the current quality and identity.';
      if(connectionRevisionWins(best.verdict,verdict,true)){
        const candidateIsA=Math.random()<.5;
        const pair=await generate([{role:'user',parts:[{text:'Compare two brick models from their three views. Neither is the default winner. Judge visible silhouette, proportions, coherent surfaces and integrated detail. Do not reward image order, size or number of pieces. Prefer A or B only for a clear visible improvement without losing the readable object or successful features. Otherwise choose tie. Give one concrete sentence explaining the difference. You are not told which is newer.'},
          {text:'MODEL A'},...(candidateIsA?candidateImages:images).map(inlineImage),{text:'MODEL B'},...(candidateIsA?images:candidateImages).map(inlineImage)]}],
          {responseSchema:{type:'OBJECT',required:['preferred','reason'],properties:{preferred:{type:'STRING',enum:['A','B','tie']},reason:{type:'STRING'}}},maxOutputTokens:1024,thinkingConfig:{thinkingLevel:'medium'}},controller.signal);
        active();const decision=pair.json as {preferred?:string;reason?:string};
        if(!['A','B','tie'].includes(decision.preferred??'')||typeof decision.reason!=='string'||!decision.reason.trim())throw Error('Invalid appearance comparison.');
        selected=decision.preferred===(candidateIsA?'A':'B');reason=decision.reason;
        opts.debug?.('connectionRevisionPair',{round,candidateLabel:candidateIsA?'A':'B',...decision});
      }
      active();opts.debug?.('connectionRevisionReview',{round,focus,before:best.verdict,after:verdict,selected,reason,program:candidate.program,receipts:candidate.receipts,build:candidate.build});
      onEvent({phase:'compared',selected:selected?'refinement':'original',reason});
      feedback=`${selected?'Kept':'Rejected'} change: ${focus}. ${reason}. Candidate review: ${JSON.stringify(verdict)}`;
      if(selected){best=candidate;improved=true;onEvent({phase:'rebuilt',build:best.build,partsUsed:best.program.operations.length});}
      onEvent({phase:'preview',build:best.build,partsUsed:best.program.operations.length});
      onEvent({phase:'judged',build:best.build,verdict:best.verdict,pass:passes(best.verdict)&&best.verdict.subjectMatched===true});
    }
  }catch(e){
    if(opts.signal?.aborted)throw e;
    opts.debug?.('connectionRevisionStopped',{reason:(e as Error).message,timedOut});
    onEvent({phase:'kept',reason:timedOut?'Kept the best checked build; the visual revision reached its four-minute limit.':'Kept the best checked build; the visual revision could not finish.'});
  }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  return {...best,improved};
}

/** Study-backed planning: choose a feasible defining construction before composing
 * the whole subject. Only compiled, stock-bound registry entries are offered. */
async function designTechniqueBuild(inv:Inventory,idea:Idea,have:Record<string,number>,choices:ConstructionChoice[],onEvent:(e:BuildEvent)=>void,opts:NonNullable<Parameters<typeof designBuild>[3]>,signal:AbortSignal,start:number,beginVisualRevision:()=>void):Promise<Build|null>{
  const active=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError');};
  const seconds=()=>Math.round((performance.now()-start)/1000);
  const catalog=constructionChoiceText(choices);
  const planSchema={type:'OBJECT',required:['choiceId','feature','outline','scale','reason'],properties:Object.fromEntries(['choiceId','feature','outline','scale','reason'].map(k=>[k,{type:'STRING'}]))};
  let feedback='',lastConstructionError='',best:{build:Build;verdict:Verdict}|undefined;
  opts.debug?.('techniqueCatalog',{choices,source:'stock-bound angle, mounted-surface and appearance-reviewed roof recipes',otherStudiedFamilies:'research only'});
  for(let round=1;round<=2;round++){
    active();onEvent({phase:'planning'});
    const planned=await generate([{role:'user',parts:[{text:`Plan the silhouette and defining construction of ${idea.name}: ${idea.pitch}.
Before choosing the full build, select ONE executable feature below that meaningfully shapes this subject. Decide its role, rough outline, and feasible scale. Reserve its pieces before allocating filler. Examples: paired sideways tapers for a boat bow, thin mounted chest and face panels for a robot bust, an angled upper deck, or a swept wing. Prefer shaped surfaces around a sparse support frame when the stock supports them. Choose repeated surfaces and matching seams before internal filler. Do not use a small unrelated ornament to claim the technique was used. The feature's host must be part of the subject, not a disconnected display plinth. Repeated features compete for the SAME stock. Finish major proportions before surface trim. You may revise an unsuccessful concept explicitly in the next planning attempt.
AVAILABLE EXECUTABLE CONSTRUCTIONS (each is an alternative):
${catalog}
Inventory: ${table(have)}
Return choiceId, feature (what recognizable feature this makes), outline (the complete silhouette and its landmarks), scale (dimensions and proportion logic), reason (why this construction is useful). The completed subject must use 20–60 purposeful pieces. This stage has not placed any parts.
${feedback?`Previous attempt feedback: ${feedback}`:''}`}]}],{responseSchema:planSchema,maxOutputTokens:1536,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},signal);
    active();const plan=planned.json as Record<string,unknown>;
    if(!plan||['choiceId','feature','outline','scale','reason'].some(k=>typeof plan[k]!=='string'||!(plan[k] as string).trim()||(plan[k] as string).length>1200)||!choices.some(c=>c.id===plan.choiceId))throw new GeminiError('The defining-feature plan must select an available construction and explain its outline and scale.');
    const choiceId=plan.choiceId as string;
    const selected=choices.find(c=>c.id===choiceId)!;
    const ordinaryStock=Object.fromEntries(Object.entries(have).map(([id,n])=>[id,n-(selected.cost[id]??0)]).filter(([,n])=>Number(n)>0));
    opts.debug?.('techniquePlan',{round,plan,allocationStarted:false});
    onEvent({phase:'planned',features:[plan.feature as string],reserved:Object.values(selected.cost).reduce((a,b)=>a+b,0)});active();
    const prompt=`Build ${idea.name}: ${idea.pitch} using this selected construction plan: ${JSON.stringify(plan)}.
Return a COMPLETE named attachment program with 20–60 expanded pieces. Prefer a compact 24–32-piece subject with a clear dominant volume, fewer large overlapping plates, and one or two readable secondary forms. Use the chosen ${choiceId} at least once. Every physical part, including hidden supports, is charged to this exact stock. Each choice lists its exact piece cost; reserve the entire listed assembly. Its host must be supplied separately and charged once. Keep any required repeated shapes and palette coherent. The selected feature must materially contribute to the subject's shape.
${TECHNIQUE_PROGRAM_BRIEF}
STOCK LEFT FOR ORDINARY PART COMMANDS after reserving the chosen feature once: ${table(ordinaryStock)}. Use only these exact part IDs and quantities for ordinary commands. If you repeat a technique, subtract its cost again. Count repeated IDs before returning.
Catalog:
${catalog}
Local coordinates: x right, y back, z up; 20 LDU/stud, 8 LDU/plate. Ordinary 1xN plates/bricks/tiles extend N along x. A part's port ids never change when it turns. Each child inherits the parent orientation; twist turns around the parent's outward connector normal, -180..180. Multi-stud attachments need exactly coincident ports. Use the registered construction for its non-quarter-turn angles. All body collisions, unmatched studs, missing second anchors, ground violations and stock overruns are rejected. No hinge/pin connections are supported.
Use support spacing, open areas and a shaped exterior deliberately. Build the overall form before decorative details. Do not add filler simply to reach twenty parts.
${connectorText(have)}
${feedback?`Address this previous failure: ${feedback}`:''}`;
    onEvent({phase:'designing',round});
    const reply=await generate([{role:'user',parts:[{text:prompt}]}],{responseSchema:TECHNIQUE_PROGRAM_SCHEMA,maxOutputTokens:8192,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},signal);
    active();opts.debug?.('techniqueProgram',{round,program:reply.json});
    let build:Build,effectiveProgram:ConnectionProgram,receipts:TechniqueReceipt[];
    try{
      const expanded=expandTechniques(reply.json as TechniqueProgram,have,choices,choiceId);
      const fitted=await fitTechniqueProgram(expanded.program,have,expanded.lockedOperations,signal);
      build=fitted.build;effectiveProgram=fitted.program;receipts=expanded.receipts;
      if(partCount(build)<MIN_FINISHED_PARTS||partCount(build)>60)throw Error('A complete subject needs 20–60 purposeful pieces.');
      captionTechniques(build,expanded.receipts);
      opts.debug?.('techniqueExpansion',{round,plan,receipts:expanded.receipts,remaining:expanded.remaining,program:fitted.program,build,changes:fitted.changes,checks:fitted.checks});
      if(fitted.changes.length)onEvent({phase:'connectionsFitted',changed:fitted.changes.length});
    }catch(e){active();lastConstructionError=(e as Error).message;feedback=`Construction failed: ${(e as Error).message}. Previous commands: ${JSON.stringify(reply.json)}. Replan if the feature cannot fit; no partial construction was accepted.`;opts.debug?.('techniqueRejected',{round,reason:(e as Error).message});onEvent({phase:'issues',round,summary:(e as Error).message,issues:[]});continue;}
    active();onEvent({phase:'checking',parts:partCount(build),round});onEvent({phase:'preview',build,partsUsed:partCount(build)});onEvent({phase:'looking'});active();
    const verdict=await judgeBuild(idea,opts.views!(build),partCount(build),usableTotal(inv),signal);
    active();const pass=passes(verdict)&&verdict.subjectMatched===true;
    opts.debug?.('connectionVerdict',{round,build,verdict});onEvent({phase:'judged',verdict,pass,build});
    if(pass){onEvent({phase:'ready',build,rounds:round,partsUsed:partCount(build),seconds:seconds(),improved:round>1,verdict});return build;}
    if(opts.visualRevisionMode!=='off'){
      beginVisualRevision();
      const revised=await refineConnectionBuild(inv,idea,{build,program:effectiveProgram,receipts,verdict},onEvent,{...opts,signal});
      active();best=revised;
      if(passes(revised.verdict)&&revised.verdict.subjectMatched===true){onEvent({phase:'ready',build:revised.build,verdict:revised.verdict,rounds:round,partsUsed:partCount(revised.build),seconds:seconds(),improved:revised.improved});return revised.build;}
      break;
    }
    const score=(v:Verdict)=>Math.min(v.recognizable,v.complete,v.impressive)*10+v.recognizable+v.complete+v.impressive+v.colors;
    if(!best||score(verdict)>score(best.verdict))best={build,verdict};
    feedback=`Construction passed, appearance failed: ${JSON.stringify(verdict)}. Previous silhouette/feature: ${JSON.stringify(plan)}. Change the structure or scale; do not just rename it or add trim.`;
  }
  if(best){onEvent({phase:'preview',build:best.build,partsUsed:partCount(best.build)});onEvent({phase:'judged',build:best.build,verdict:best.verdict,pass:false});}
  throw new GeminiError(best?'The studied construction works, but the full model has not passed the finished-build appearance review.':`No complete model could be built with the planned construction. ${lastConstructionError.slice(0,600)}`);
}

/** Whole-object geometry precedes stock allocation. The model chooses dimensions
 * and profiles; the local solver owns placement, inventory and assembly order. */
async function designObjectBuild(inv:Inventory,idea:Idea,have:Record<string,number>,family:ObjectFamily,onEvent:(e:BuildEvent)=>void,opts:NonNullable<Parameters<typeof designBuild>[3]>,signal:AbortSignal,start:number):Promise<Build|null>{
 const active=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError');};
 const attempted=new Set<string>();
 let feedback='',best:{build:Build;verdict:Verdict}|undefined;
 for(let round=1;round<=2;round++){
  active();onEvent({phase:'planning'});
  const reply=await generate([{role:'user',parts:[{text:`Plan a developed ${idea.name}: ${idea.pitch}.
${OBJECT_LAYOUT_BRIEF}
Choose the ${family} grammar. Return only the requested dimensions, profile choices and a short reason. This is not a list of prebuilt models: no pieces have been allocated. Select coherent proportions suited to the actual inventory below. Prefer a four-stud-long cabin for a boat and a short neck for a bust when stock supports it.
Inventory: ${table(have)}
${feedback?`Previous attempt: ${feedback}\nChange the relevant dimensions or profile explicitly; do not repeat an infeasible plan.`:''}`}]}],{responseSchema:objectPlanSchema(family),maxOutputTokens:1200,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},signal);
  active();let candidate;
  try{
   const target=createObjectTarget(objectSpec(family,reply.json));
   const key=JSON.stringify(target.regions);if(attempted.has(key))throw Error('This exact geometry was already attempted. Change a dimension or profile instead of repeating it.');attempted.add(key);
   opts.debug?.('objectTarget',{round,target,allocationStarted:false});
   onEvent({phase:'planned',features:[target.description],reserved:0});onEvent({phase:'designing',round});
   active();const result=await allocateObjectTarget(have,target,signal);active();
   opts.debug?.('objectAllocation',{round,target,...result});
   candidate=result.candidates[0];
   if(!candidate)throw Error(result.diagnostics.slice(0,5).join(' ')||'The frozen layout cannot be assembled from these pieces.');
   // Worker output must still match the requested target and the real inventory.
   if(JSON.stringify(candidate.target)!==JSON.stringify(target)||JSON.stringify(candidate.contract.target)!==JSON.stringify(target))throw Error('The allocator changed the frozen target.');
   const issues=[...objectLayoutIssues(candidate.build,candidate.contract),...constructionIssues(candidate.build,have,24).map(i=>i.message)];
   if(issues.length)throw Error(issues.join('; '));
   if(partCount(candidate.build)<MIN_FINISHED_PARTS||partCount(candidate.build)>60)throw Error('The allocation must contain 20–60 purposeful pieces.');
  }catch(e){active();feedback=`Layout/stock failure: ${(e as Error).message}. Plan: ${JSON.stringify(reply.json)}`;opts.debug?.('objectRejected',{round,reason:feedback});onEvent({phase:'issues',round,summary:feedback,issues:[]});continue;}
  const build=candidate.build;
  onEvent({phase:'bodyPlanned',candidates:1,description:candidate.target.description});
  onEvent({phase:'checking',round,parts:partCount(build)});onEvent({phase:'preview',build,partsUsed:partCount(build)});onEvent({phase:'looking'});
  const verdict=await judgeBuild(idea,opts.views!(build),partCount(build),usableTotal(inv),signal);active();
  const pass=passes(verdict)&&verdict.subjectMatched===true;opts.debug?.('objectVerdict',{round,build,verdict});onEvent({phase:'judged',build,verdict,pass});
  if(pass){onEvent({phase:'ready',build,verdict,rounds:round,partsUsed:partCount(build),seconds:Math.round((performance.now()-start)/1000),improved:round>1});return build;}
  const score=(v:Verdict)=>Math.min(v.recognizable,v.complete,v.impressive)*10+v.recognizable+v.complete+v.impressive+v.colors;
  if(!best||score(verdict)>score(best.verdict))best={build,verdict};
  feedback=`Layout and stock passed; appearance failed: ${JSON.stringify(verdict)}. Frozen shape: ${JSON.stringify(candidate.target.spec)}. Change proportions/profile within the grammar to address the observed defects.`;
 }
 if(best){onEvent({phase:'preview',build:best.build,partsUsed:partCount(best.build)});onEvent({phase:'judged',build:best.build,verdict:best.verdict,pass:false});}
 throw new GeminiError(best?'The build follows its planned shape, but it has not passed the finished-build appearance review.':`No whole-object layout fit this inventory. ${feedback}`);
}

/** Experimental attachment-program route. Two proposals maximum; invalid drafts never get snapped or trimmed. */
export async function designConnectionBuild(inv:Inventory,idea:Idea,onEvent:(e:BuildEvent)=>void,opts:NonNullable<Parameters<typeof designBuild>[3]>):Promise<Build|null>{
  const start=performance.now(),seconds=()=>Math.round((performance.now()-start)/1000);
  const budget=new AbortController();let timedOut=false;const stop=()=>budget.abort();
  opts.signal?.addEventListener('abort',stop,{once:true});if(opts.signal?.aborted)stop();
  const timer=setTimeout(()=>{timedOut=true;budget.abort();},180_000);
  try{
    if(!opts.views)throw new GeminiError('Connection designs require a rendered appearance review.');
    const have=Object.fromEntries(Object.entries(counts(inv)).filter(([id,n])=>{
      try{definition(parsePartId(id)!);return Number.isSafeInteger(n)&&n>0;}catch{return false;}
    }).sort(([a,an],[b,bn])=>Number(connectionOnly(parsePartId(b)!))-Number(connectionOnly(parsePartId(a)!))||bn-an));
    if(Object.values(have).reduce((s,n)=>s+n,0)<MIN_FINISHED_PARTS)throw new GeminiError('At least 20 supported pieces are needed for a developed build.');
    const surfaceSubject=/\b(bust|torso|head)\b/i.test(idea.name);
    if(robotRequest(idea.name)&&!surfaceSubject){onEvent({phase:'planning'});return await designRobotBodyBuild(inv,idea,have,onEvent,opts,budget.signal,start);}
    const choices=opts.techniqueMode==='off'?[]:subjectConstructionChoices(have,idea.name);
    const family=objectFamily(idea.name);
    if(family&&opts.objectLayoutMode!=='off'&&choices.some(c=>c.family==='sideways-taper'))return await designObjectBuild(inv,idea,have,family,onEvent,opts,budget.signal,start);
    if(choices.length){
      let hasCandidate=false;
      try{return await designTechniqueBuild(inv,idea,have,choices,e=>{if(e.phase==='preview')hasCandidate=true;onEvent(e);},opts,budget.signal,start,()=>clearTimeout(timer));}
      catch(error){
        // A normal request must not become unavailable solely because the new
        // technique could not fit. Explicit trials stay strict; a valid draft
        // that failed appearance stays a draft and is never bypassed here.
        if(opts.experimentalKit||hasCandidate||budget.signal.aborted)throw error;
        const needsConnections=idea.keyParts.some(({partId,count})=>{const k=parsePartId(partId);return k&&count>0&&(have[partId]??0)>=count&&connectionOnly(k);});
        opts.debug?.('techniqueFallback',{reason:(error as Error).message,to:needsConnections?'connection-builder':'existing-bucket-builder',reservationsReleased:true});
        onEvent({phase:'kept',reason:'The selected construction could not fit. Replanning with the full inventory.'});
        if(needsConnections)return await designConnectionBuild(inv,idea,onEvent,{...opts,techniqueMode:'off',signal:budget.signal});
        return await designBucket(inv,idea,onEvent,{...opts,techniqueMode:'off',signal:budget.signal});
      }
    }
    const history:Content[]=[{role:'user',parts:[{text:`Design a thoughtful LEGO miniature: ${idea.name}. ${idea.pitch}
Use 20–60 pieces from the stock below. A readable silhouette, proportioned major forms, and purposeful surface shaping matter more than decorations or size. Choose an achievable interpretation of the subject; do not invent missing specialty parts.
You control an attachment program, never raw coordinates. Each operation places one part. Indices start at 0. Operation 0 has parent=-1, parentPort="", childPort="", twist=0 and sits upright on the table. Every later operation has an earlier parent index, an existing parentPort and childPort of opposite kinds. Usually attach a child grip to a parent stud. No hinges or pins exist in this catalog.
The compiler aligns the child normal against the parent normal, inheriting the parent's rotation. twist is a right-handed rotation about the parent's outward connector normal in degrees, -180..180. Use quarter turns for multi-stud attachments. Other twists are only safe on a single stud with clearance; connected decorations inherit that rotation at twist=0. Ports have the same ids on a part regardless of its world orientation. One port cannot hold two pieces. Unmatched protruding studs cannot enter another part. Body or stud collisions, floating parts and stock overruns are rejected.
Local axes: x right, y back, z up. Dimensions and connector points below are LDU: 20 per stud, 8 per plate. Ordinary 1xN brick/plate/tile is N along x. Side-stud bricks come in several footprints, heights and side layouts: use the exact listed ports. Jumpers have one centered top stud and either a 1x2 or 2x2 footprint. A bracket is an L: front wall 40×4×20 and horizontal plate x0..40,y4..24,z12..20; its bottom grips sit at height12, so mount it on a raised body. Don't put its overhang through the parent body.
Keep every part above the table and within a 24-stud square. Use the part's actual connectors, not apparent surface area. The compiler translates the completed assembly sideways to fit, preserving all connections. Build in assembly order, with every later piece attached to an earlier one. No display plinth unless it improves the intended object. Do not use a stack of squares as a substitute for shaping.
${connectorShapeText(have)}
Return name, description and operations. Keep the prose brief.`}]}];
    const schema={type:'OBJECT',required:['name','description','operations'],properties:{name:{type:'STRING'},description:{type:'STRING'},operations:{type:'ARRAY',items:{type:'OBJECT',required:['partId','parent','parentPort','childPort','twist'],properties:{partId:{type:'STRING'},parent:{type:'INTEGER'},parentPort:{type:'STRING'},childPort:{type:'STRING'},twist:{type:'NUMBER'}}}}}};
    onEvent({phase:'planning'});
    for(let round=1;round<=2;round++){
      onEvent({phase:'designing',round});
      const reply=await generate(history,{responseSchema:schema,maxOutputTokens:8192,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},budget.signal);
      history.push(reply.content);opts.debug?.('connectionProgram',{round,program:reply.json});
      let build:Build,effectiveProgram:ConnectionProgram;
      try{const fitted=fitConnectionProgram(reply.json as ConnectionProgram,have);build=fitted.build;effectiveProgram=fitted.program;opts.debug?.('connectionFit',{round,changes:fitted.changes,checks:fitted.checks,program:fitted.program});if(fitted.changes.length)onEvent({phase:'connectionsFitted',changed:fitted.changes.length});if(partCount(build)>60)throw Error('Use at most 60 pieces.');if(partCount(build)<MIN_FINISHED_PARTS)throw Error('Use at least 20 pieces, with each serving the subject.');}
      catch(e){const reason=(e as Error).message;opts.debug?.('connectionRejected',{round,reason});onEvent({phase:'issues',round,summary:reason,issues:[]});if(round===2)throw new GeminiError(reason);history.push({role:'user',parts:[{text:`The entire proposal was rejected. Fix these exact construction errors and return a complete replacement program. Nothing has been placed:\n${reason}`} ]});continue;}
      onEvent({phase:'checking',parts:partCount(build),round});onEvent({phase:'preview',build,partsUsed:partCount(build)});
      onEvent({phase:'looking'});const images=opts.views(build),verdict=await judgeBuild(idea,images,partCount(build),usableTotal(inv),budget.signal);
      opts.debug?.('connectionVerdict',{round,build,verdict});onEvent({phase:'judged',verdict,pass:passes(verdict),build});
      if(passes(verdict)&&verdict.subjectMatched===true){onEvent({phase:'ready',build,rounds:round,partsUsed:partCount(build),seconds:seconds(),improved:round>1,verdict});return build;}
      if(opts.visualRevisionMode!=='off'){
        clearTimeout(timer);
        const revised=await refineConnectionBuild(inv,idea,{build,program:effectiveProgram,receipts:[],verdict},onEvent,{...opts,signal:budget.signal});
        if(budget.signal.aborted)throw new DOMException('Stopped','AbortError');
        onEvent({phase:'preview',build:revised.build,partsUsed:partCount(revised.build)});
        onEvent({phase:'judged',build:revised.build,verdict:revised.verdict,pass:passes(revised.verdict)&&revised.verdict.subjectMatched===true});
        if(passes(revised.verdict)&&revised.verdict.subjectMatched===true){onEvent({phase:'ready',build:revised.build,verdict:revised.verdict,rounds:round,partsUsed:partCount(revised.build),seconds:seconds(),improved:revised.improved});return revised.build;}
        throw new GeminiError('The connection model is valid, but the best visual revision remains below the finished-build appearance standard.');
      }
      if(round===2)throw new GeminiError('This connection draft did not pass the finished-build appearance review.');
      history.push({role:'user',parts:[...images.map(inlineImage),{text:`Construction passed, appearance did not. Blind scores: ${JSON.stringify(verdict)}. This is the exact program rendered, including any recorded connector adjustments: ${JSON.stringify(effectiveProgram)}. Revise the complete program to resolve those shape problems, staying within the SAME original stock. Do not merely rename it or add decorative blocks.`}]});
    }
    return null;
  }catch(e){if(timedOut||(e as Error).name!=='AbortError')onEvent({phase:'failed',reason:timedOut?'The connection design reached its three-minute time limit. The last valid draft, if any, remains available.':(e as Error).message,seconds:seconds()});return null;}finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
}

/** Inventory-fitted architectural alternatives are rendered before selection.
 * Authored geometry is never reported as model-invented geometry. Every selected
 * instance still needs the normal anonymous appearance review. */
async function designPavilionBuild(inv: Inventory, idea: Idea, onEvent: (e: BuildEvent) => void, opts: NonNullable<Parameters<typeof designBuild>[3]>): Promise<Build | null> {
  const start = performance.now(), controller = new AbortController(), stop = () => controller.abort();
  let timedOut = false;
  opts.signal?.addEventListener('abort', stop, { once: true }); if (opts.signal?.aborted) stop();
  const timer = setTimeout(() => { timedOut = true; stop(); }, 180000);
  const active = () => { if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError'); };
  let best: { candidate: PavilionCandidate; verdict: Verdict } | undefined;
  try {
    active(); onEvent({ phase: 'planning' });
    const have = counts(inv), allocated = await allocatePavilions(have, controller.signal); active();
    for (const c of allocated.candidates) { const issues = pavilionIssues(c, have); if (issues.length) throw Error(issues.join('; ')); }
    opts.debug?.('pavilionAllocation', allocated);
    if (!allocated.candidates.length) {
      onEvent({ phase: 'kept', reason: 'These pavilion outlines did not fit. Planning with the existing builder and your full inventory.' });
      return await designBucket(inv, idea, onEvent, { ...opts, pavilionMode: 'off', signal: controller.signal });
    }
    const options = allocated.candidates.map(candidate => ({ candidate, images: opts.views!(candidate.build) }));
    onEvent({ phase: 'bodyPlanned', candidates: options.length, description: 'Different roof outlines and support heights, each checked against the same pieces.' });
    const attempted = new Set<string>(); let feedback = '';
    for (let round = 1; round <= 2; round++) {
      active(); const remaining = options.filter(o => !attempted.has(o.candidate.id)); if (!remaining.length) break;
      onEvent({ phase: 'designing', round });
      const parts: Record<string, unknown>[] = [{ text: `Choose the strongest architectural interpretation of ${idea.name}: ${idea.pitch}.
These are locally compiled alternatives using the actual inventory. Each set of three images shows one entire model. Compare the visible silhouette, entrance, window openings, eaves, support proportions and finish. No inventory is shared between alternatives; each uses the same original pile independently. Select only an offered candidateId. Do not assume a technically valid model is attractive. These are authored modular constructions, not unrestricted generated designs.
${feedback ? `Previous independent review: ${feedback}. Choose a different outline that addresses its visible geometry problems.` : ''}` }];
      for (const o of remaining) parts.push({ text: `${o.candidate.id}: ${JSON.stringify(o.candidate.target.spec)}; ${partCount(o.candidate.build)} pieces.` }, ...o.images.map(inlineImage));
      const reply = await generate([{ role: 'user', parts }], { responseSchema: { type: 'OBJECT', required: ['candidateId', 'reason'], properties: { candidateId: { type: 'STRING', enum: remaining.map(o => o.candidate.id) }, reason: { type: 'STRING' } } }, maxOutputTokens:1000, thinkingConfig: { thinkingLevel: opts.thinking ?? 'medium' } }, controller.signal);
      active(); const selected = remaining.find(o => o.candidate.id === (reply.json as { candidateId?: unknown })?.candidateId);
      if (!selected) { feedback = 'Choose one of the remaining candidate IDs exactly; repeated or invented IDs are rejected.'; continue; }
      const { candidate, images } = selected; attempted.add(candidate.id);
      const issues = pavilionIssues(candidate, have); if (issues.length) throw Error(issues.join('; '));
      opts.debug?.('pavilionSelection', { round, selection: reply.json, candidate });
      onEvent({ phase: 'checking', round, parts: partCount(candidate.build) }); onEvent({ phase: 'preview', build: candidate.build, partsUsed: partCount(candidate.build) });
      active(); onEvent({ phase: 'looking' });
      const verdict = await judgeBuild(idea, images, partCount(candidate.build), usableTotal(inv), controller.signal); active();
      const pass = passes(verdict) && verdict.subjectMatched === true;
      opts.debug?.('pavilionVerdict', { round, id: candidate.id, build: candidate.build, verdict }); onEvent({ phase: 'judged', build: candidate.build, verdict, pass });
      if (pass) { onEvent({ phase: 'ready', build: candidate.build, verdict, rounds: round, partsUsed: partCount(candidate.build), seconds: Math.round((performance.now() - start) / 1000), improved: round > 1 }); return candidate.build; }
      const score = (v: Verdict) => Math.min(v.recognizable, v.complete, v.impressive) * 10 + v.recognizable + v.complete + v.impressive + v.colors;
      if (!best || score(verdict) > score(best.verdict)) best = { candidate, verdict };
      feedback = JSON.stringify({ id: candidate.id, verdict });
    }
    if (best) { onEvent({ phase: 'preview', build: best.candidate.build, partsUsed: partCount(best.candidate.build) }); onEvent({ phase: 'judged', build: best.candidate.build, verdict: best.verdict, pass: false }); }
    throw Error('The pavilion fits your pieces, but its appearance still needs work. The strongest reviewed draft remains available.');
  } catch (e) {
    if (timedOut || (e as Error).name !== 'AbortError') onEvent({ phase: 'failed', reason: timedOut ? 'The pavilion design reached its three-minute limit.' : (e as Error).message, seconds: Math.round((performance.now() - start) / 1000) });
    return null;
  } finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', stop); }
}

/** The agent chooses multiple anatomies, then the local solver owns every brick.
 * Whole-body exploration precedes any conservative local revision budget. */
export async function designAnimalBuild(inv:Inventory,idea:Idea,onEvent:(e:BuildEvent)=>void,opts:NonNullable<Parameters<typeof designBuild>[3]>):Promise<Build|null>{
 const start=performance.now(),controller=new AbortController(),stop=()=>controller.abort(),signal=controller.signal;
 let timedOut=false;opts.signal?.addEventListener('abort',stop,{once:true});if(opts.signal?.aborted)stop();
 const timer=setTimeout(()=>{timedOut=true;stop();},240000),active=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError');};
 const have=counts(inv),seen=new Set<string>(),feedback:string[]=[];
 let best:{candidate:AnimalCandidate;verdict:Verdict}|undefined,reviewed=0;
 const rank=(v:Verdict)=>(passes(v)&&v.subjectMatched===true?1000:0)+(v.subjectMatched===true?100:0)+Math.min(v.recognizable,v.complete,v.impressive)*10+v.recognizable+v.complete+v.impressive+v.colors;
 try{
  active();if(!opts.views)throw Error('Animal anatomy exploration requires rendered appearance review.');
  if(!animalCoatColors(have).length)throw Error('This animal grammar needs a feasible foot, body-support and shaping combination.');
  for(let round=1;round<=2&&reviewed<5;round++){
   active();onEvent({phase:'planning'});
   const capacity=5-reviewed;
   const reply=await generate([{role:'user',parts:[{text:`Explore ${idea.name}: ${idea.pitch}. ${idea.request?`Original request: ${idea.request}.`:''}
${ANIMAL_ANATOMY_BRIEF}
${animalStockGuidance(have)}
Return ${round===1?'3–5':`1–${capacity}`} anatomical plans, each with a name, reason and spec. Every plan uses the SAME original inventory independently. Explore different lengths, stance heights, body profiles and muzzle/neck proportions before choosing a winner. Keep the requested species when one is specified; for a broad animal request, choose plausible species supported by the available anatomy. Names cannot compensate for weak shapes.
Inventory: ${table(have)}
${feedback.length?`Previous allocation and appearance feedback: ${feedback.join('\n')}. Change the rejected shape explicitly; repeated geometry is not reviewed again.`:''}`}]}],{responseSchema:{type:'OBJECT',required:['plans'],properties:{plans:{type:'ARRAY',minItems:round===1?3:1,maxItems:capacity,items:{type:'OBJECT',required:['name','reason','spec'],properties:{name:{type:'STRING'},reason:{type:'STRING'},spec:{...ANIMAL_SPEC_SCHEMA,properties:{...ANIMAL_SPEC_SCHEMA.properties,color:{type:'STRING',enum:animalCoatColors(have)}}}}}}}},maxOutputTokens:4000,thinkingConfig:{thinkingLevel:opts.thinking??'medium'}},signal);
   active();const plans=(reply.json as {plans?:unknown})?.plans;
   if(!Array.isArray(plans)||plans.length<(round===1?3:1)||plans.length>capacity)throw Error('The animal planner must return a bounded set of distinct anatomies.');
   opts.debug?.('animalPlans',{round,plans,allocationStarted:false});
   const allocated:AnimalCandidate[]=[],rejected:{spec:ReturnType<typeof animalSpec>;reason:string}[]=[];
   for(const raw of plans){active();try{
    if(!raw||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>80||typeof raw.reason!=='string'||raw.reason.length>1000)throw Error('Each anatomy needs a short name and reason.');
    const target=createAnimalTarget(animalSpec(raw.spec)),key=animalShapeKey(target.spec);
    if(seen.has(key))throw Error('This anatomy was already attempted; changing its name or palette is not a new shape.');seen.add(key);
    opts.debug?.('animalTarget',{round,name:raw.name,target,allocationStarted:false});
    const result=await allocateAnimalTarget(have,target,signal);active();
    const candidate=result.candidates[0];if(!candidate)throw Error(result.diagnostics.join(' ')||'No legal construction for this anatomy.');
    if(JSON.stringify(candidate.target)!==JSON.stringify(target)||JSON.stringify(candidate.contract.target)!==JSON.stringify(target))throw Error('The allocator changed the frozen animal target.');
    const issues=[...animalAnatomyIssues(candidate.build,candidate.contract),...constructionIssues(candidate.build,have,24).map(i=>i.message)];if(issues.length)throw Error(issues.join('; '));
    candidate.build.name=raw.name;candidate.program.name=raw.name;allocated.push(candidate);
    opts.debug?.('animalAllocation',{round,candidate,diagnostics:result.diagnostics});
   }catch(e){active();const reason=(e as Error).message;feedback.push(`Plan ${JSON.stringify(raw)}: ${reason}`);try{rejected.push({spec:animalSpec(raw.spec),reason});}catch{/* Malformed specs have no legal neighborhood. */}opts.debug?.('animalRejected',{round,plan:raw,reason});onEvent({phase:'issues',round,summary:reason,issues:[]});}}
   if(round===1&&!allocated.length){
    let attempts=0,found=0;const tried=new Set<string>();
    for(const failed of rejected){
     for(const spec of animalReplanSpecs(failed.spec,failed.reason)){
      active();const key=animalShapeKey(spec);if(seen.has(key)||tried.has(key))continue;if(attempts>=8||found>=3)break;attempts++;tried.add(key);
      const target=createAnimalTarget(spec);opts.debug?.('animalAlternativeTarget',{target,allocationStarted:false});
      try{const result=await allocateAnimalTarget(have,target,signal);active();const c=result.candidates[0];
       if(c&&JSON.stringify(c.target)===JSON.stringify(target)&&JSON.stringify(c.contract.target)===JSON.stringify(target)&&!animalAnatomyIssues(c.build,c.contract).length&&!constructionIssues(c.build,have,24).length){
        found++;feedback.push(`STOCK-VERIFIED ALTERNATIVE ${found}: ${JSON.stringify(spec)}. Complete ${partCount(c.build)}-piece allocation exists. Copy this spec exactly into at least one next-round plan, then vary others. It has NOT passed appearance review.`);opts.debug?.('animalAlternative',{candidate:c,from:failed.spec,reason:failed.reason});
       }
      }catch(e){active();opts.debug?.('animalAlternativeFailed',{spec,reason:(e as Error).message});}
     }
     if(attempts>=8||found>=3)break;
    }
    if(found)onEvent({phase:'issues',round,summary:`Found ${found} stock-valid anatomical alternative${found===1?'':'s'}; replanning before visual review.`,issues:[]});
   }
   onEvent({phase:'bodyPlanned',candidates:allocated.length,description:'Different anatomies assembled from your pieces; comparing their actual appearance.'});
   for(const candidate of allocated){active();const build=candidate.build;reviewed++;
    onEvent({phase:'preview',build,partsUsed:partCount(build)});onEvent({phase:'looking'});active();
    const verdict=await judgeBuild(idea,opts.views(build),partCount(build),usableTotal(inv),signal);active();
    const pass=passes(verdict)&&verdict.subjectMatched===true;
    opts.debug?.('animalVerdict',{round,candidate,verdict,pass});onEvent({phase:'judged',build,verdict,pass});
    if(!best||rank(verdict)>rank(best.verdict))best={candidate,verdict};
    feedback.push(`Anatomy ${JSON.stringify(candidate.target.spec)}: ${JSON.stringify(verdict)}`);
   }
   if(best&&passes(best.verdict)&&best.verdict.subjectMatched===true)break;
  }
  active();if(best){const {candidate,verdict}=best,build=candidate.build,pass=passes(verdict)&&verdict.subjectMatched===true;
   onEvent({phase:'preview',build,partsUsed:partCount(build)});onEvent({phase:'judged',build,verdict,pass});
   opts.debug?.('animalSelected',{candidate,verdict,reviewed,distinctPlans:seen.size});
   if(pass){onEvent({phase:'ready',build,verdict,rounds:reviewed,partsUsed:partCount(build),seconds:Math.round((performance.now()-start)/1000),improved:false});return build;}
  }
  throw Error(best?'The strongest animal fits your pieces, but remains below the finished-build appearance threshold.':'None of the planned animal anatomies could be assembled from this inventory.');
 }catch(e){
  if(!opts.signal?.aborted&&best){onEvent({phase:'preview',build:best.candidate.build,partsUsed:partCount(best.candidate.build)});onEvent({phase:'judged',build:best.candidate.build,verdict:best.verdict,pass:passes(best.verdict)&&best.verdict.subjectMatched===true});}
  if(timedOut||(e as Error).name!=='AbortError')onEvent({phase:'failed',reason:timedOut?'Animal exploration reached its four-minute limit; the strongest reviewed draft remains available.':(e as Error).message,seconds:Math.round((performance.now()-start)/1000)});
  return null;
 }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
}

export async function designBuild(
  inv: Inventory, idea: Idea, onEvent: (e: BuildEvent) => void,
  opts: {
    signal?: AbortSignal; sabotage?: boolean; thinking?: 'low' | 'medium' | 'high';
    /** Renders a build to images (front 3/4, side) so the model can look at its own work. Omit to skip that pass. */
    views?: (b: Build) => string[];
    /** Shape-only front/side diagrams, before any part allocation. Defaults to the canvas renderer. */
    targetViews?: (target: RobotTarget) => string[];
    /** Catalog suggestions: a fresh judge scores the finished build. Bucket builds always judge and compare a refinement when views are provided. */
    judge?: boolean;
    /** Explicit local experiment: offer stock-checked prototype assemblies, with the usual visual gate. */
    experimentalKit?: 'refined-hound' | 'contour-animals' | 'connections-v2' | 'animal-anatomy';
    /** Opt into the anatomy experiment. Default animal routing stays unchanged until quality is proven. */
    animalAnatomyMode?: 'auto' | 'off';
    /** Explicit baseline switch for same-stock comparisons. Production defaults to auto. */
    techniqueMode?: 'auto' | 'off';
    /** Controlled baseline: disable the separate attachment-model appearance loop. */
    visualRevisionMode?: 'auto' | 'off';
    /** Isolate the previous free-composition surface route for controlled comparisons. */
    objectLayoutMode?: 'auto' | 'off';
    /** Same-inventory baseline comparison for the architectural module grammar. */
    pavilionMode?: 'auto' | 'off';
    debug?: (label: string, data: unknown) => void;
  } = {},
): Promise<Build | null> {
  if (!openCatalog(idea.mode) && opts.views && (opts.experimentalKit === 'animal-anatomy' || (!opts.experimentalKit && opts.animalAnatomyMode === 'auto' && animalRequest(idea.name) && animalCoatColors(counts(inv)).length > 0))) return designAnimalBuild(inv, idea, onEvent, opts);
  if (!opts.experimentalKit && opts.pavilionMode !== 'off' && !openCatalog(idea.mode) && opts.views && pavilionRequest(idea.name)) return designPavilionBuild(inv, idea, onEvent, opts);
  // Ideas that explicitly reserve a confirmed connector need connector geometry,
  // including the newly scanned jumpers. The upright engine cannot model offsets.
  const selectedConnector=idea.keyParts.some(({partId,count})=>{const k=parsePartId(partId);return k&&count>0&&(inv.parts[partId]?.count??0)>=count&&connectionOnly(k);});
  if(!opts.experimentalKit&&!openCatalog(idea.mode)&&opts.views&&selectedConnector)return designConnectionBuild(inv,idea,onEvent,opts);
  if (opts.experimentalKit==='connections-v2'||(!opts.experimentalKit&&!openCatalog(idea.mode)&&robotRequest(idea.name)))return designConnectionBuild(inv,idea,onEvent,opts);
  if(!opts.experimentalKit&&opts.techniqueMode!=='off'&&!openCatalog(idea.mode)&&opts.views&&/\b(airplane|aircraft|spaceship|spacecraft|shuttle|glider|jet|pavilion|house|gatehouse|gateway|cottage|kiosk|cabin|building|tower|machine|station|crane|boat|ship)\b/i.test(idea.name)&&subjectConstructionChoices(counts(inv),idea.name).length)return designConnectionBuild(inv,idea,onEvent,opts);
  if (!openCatalog(idea.mode)) return designBucket(inv, idea, onEvent, opts);
  const t0 = performance.now();
  const secs = () => Math.round((performance.now() - t0) / 1000);
  const accurate = idea.mode === 'accurate';
  const bucket = counts(inv);
  const have = accurate ? unlimitedInventory(bucket) : bucket;
  const ids = accurate ? null : Object.keys(have);
  // A suggestion offers its spare parts in its own colors first; the rest only for hidden parts inside.
  // Offering every spare part as "you can add" made builds pull in strays until they turned to patchwork.
  const listed = !accurate && !idea.request && idea.keyParts.length > 0;
  const palette = new Set(listed ? colorsOf(idea) : []);
  const unused = accurate
    ? () => 'any catalog part, in any color'
    : (b: Build) => {
      const left = remaining(b, have);
      if (!palette.size) return table(left);
      const pick = (inPalette: boolean) => Object.fromEntries(Object.entries(left).filter(([id]) => palette.has(parsePartId(id)?.color ?? '') === inPalette));
      return `in the model's colors: ${table(pick(true))}. Other colors, only for parts hidden inside: ${table(pick(false))}`;
    };
  const range = accurate ? ACCURATE_RANGE : partRange(inv);
  // From the bucket, a build stays near its planned size instead of swelling to the whole pile.
  // The catalog modes keep their wide range.
  const total = usableTotal(inv);
  const lo2 = accurate ? Math.max(range.lo, Math.min(range.hi, Math.round(idea.estimatedParts * 0.8)))
    : Math.min(range.hi, Math.max(Math.min(6, total), Math.round(idea.estimatedParts * 0.85)));
  const hi = accurate ? range.hi : Math.min(range.hi, Math.max(lo2 + 4, Math.round(idea.estimatedParts * 1.15)));
  const shaping = accurate || Object.keys(bucket).some(id => SPECIALTY_TYPES.includes(parsePartId(id)?.type as PartType));
  const standIns = Object.values(inv.parts).some(e => e.count > 0 && e.aka && Object.keys(e.aka).length);
  const inventoryText = accurate
    ? `PARTS: no limit. Use any of these shapes in any of these colors (partId = type-AxB-color):
${CATALOG_TEXT}
${OPEN_COLORS}
The person already owns these (partId × count). When one of them works just as well, use it so they have less to buy, but never give up accuracy for it:
${inventoryTable(inv)}`
    : `Inventory of loose parts (partId × count):
${inventoryTable(inv)}

Parts per color:
${colorTable(inv)}`;
  // the design brief for a given part range: the first design, and any rebuild after a failed quality check
  const brief = (lo2: number, hi: number) => `You are a master brick builder. ${inventoryText}

Design "${idea.name}: ${idea.pitch}" using ${lo2}–${hi} parts${accurate ? '. Make it as accurate and recognizable as a skilled builder could, in the real colors' : ' and only this inventory'}. It should be a detailed, satisfying model${listed ? '' : idea.mainColor ? `, mostly ${idea.mainColor} on the outside` : ''}.${listed ? `
Its parts list, already checked against the bucket: ${table(Object.fromEntries(idea.keyParts.map(k => [k.partId, k.count])))}. Build it from these. Swap or add other parts from the bucket only where that makes it read better; keep the outside in this list's colors, and put a part of any other color only where it can't be seen. Don't use a part just because it's spare.` : ''}

${CONTRACT_TEXT}${shaping ? `\n\n${SPECIALTY_TEXT}` : ''}

FIRST write the plan: sizeX (studs left to right), sizeY (studs front to back) and heightPlates; the silhouette in one sentence; 4–8 signature features of a real ${idea.name} and where each one sits; and colorZones: each area of the model, named for what it covers, with exactly ONE color. ${accurate ? "Use the real thing's colors for each zone." : 'Check the color totals above: give the big zones colors the bucket has plenty of.'} THEN build exactly to that plan.

COLOR:
- Every visible part in a zone is that zone's color. Consistent color is what makes a model look real.
- When you run out of a part in a zone's color, combine smaller or different-shaped parts of the SAME color (two 2x2 for a 2x4, plates stacked three high for a brick) instead of switching color.
- Parts of other colors are fine only where they are hidden inside the model, where nothing shows from outside.
- Small deliberate details (lights, windows, stripes, trim) may use an accent color, but list them as their own zone.

CRAFT:
- Get the proportions of a real ${idea.name} right before adding detail.
- Use plates to fine-tune heights (3 plates = 1 brick), slopes for tapers, roofs and noses, tiles for smooth finished tops, and 1x1 and 1x2 parts for small details like lights and windows.
- Overlap bricks across the seams of the layer below, like a brick wall, so the layers lock together.
${accurate ? `\n${FINISH_TEXT}\n` : shaping ? `\n${BUCKET_FINISH_TEXT}\n` : ''}${standIns ? `\n${STAND_IN_TEXT}\n` : ''}
RULES:
- Every part above z=0 rests on studs of a part placed EARLIER (earlier step, or earlier in the same step).
- No two parts overlap in space.
- The finished build is ONE connected piece that can be lifted by the top without anything falling off. Parts only connect through studs, so parts that sit side by side are NOT connected unless something on top or underneath bridges them.
${accurate ? '- Use only catalog shapes and listed colors.' : '- Never use more of a part than its count.'}
- Keep the build inside x 0–23 and y 0–23. Make the front of the model face the viewer (low y).
- ${hi < 40 ? '4–8 steps of 1–6 parts' : hi > 160 ? '14–28 steps of 3–12 parts' : '10–20 steps of 2–10 parts'} each, built bottom-up. Each caption is 8 words or fewer.`;
  const prompt = brief(lo2, hi);

  const history: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
  const thinking = { thinkingLevel: opts.thinking ?? 'medium' };
  try {
    onEvent({ phase: 'designing', round: 0 });
    const r = await generate(history, { responseSchema: buildSchema(ids), thinkingConfig: thinking }, opts.signal);
    history.push(r.content);
    let draft = clean(r.json as Build);
    if (opts.sabotage) {
      draft = sabotage(draft);
      onEvent({ phase: 'issues', round: 0, summary: 'one part knocked loose', issues: [], sabotaged: true });
    }
    const first = await makeValid(draft, history, have, MAX_REPAIRS, thinking, onEvent, opts.signal, opts.debug, ids, unused);
    if (!first) {
      onEvent({ phase: 'failed', reason: "Couldn't make this one stand up", seconds: secs() });
      return null;
    }
    let best = first.build;
    let improved = false;
    let verdict: Verdict | undefined;
    const plan = (r.json as { plan?: Plan }).plan;
    if (opts.views) {
      const ctx: PolishCtx = { idea, history, have, ids, unused, thinking, onEvent, signal: opts.signal, debug: opts.debug, views: opts.views, plan, hi };
      ({ build: best, improved } = await polish(ctx, best));
      if (opts.judge) {
        const look = async (b: Build) => {
          onEvent({ phase: 'judging' });
          const v = await judgeBuild(idea, opts.views!(b), partCount(b), total, opts.signal);
          onEvent({ phase: 'judged', verdict: v, pass: passes(v), build: b });
          opts.debug?.('verdict', v);
          return v;
        };
        const score = (v: Verdict) => v.recognizable + v.complete + v.colors + v.impressive;
        verdict = await look(best);
        // A failed check gets a fresh design, not small edits: the builder sees the failed attempt's renders and
        // the judge's critique and may change anything. The new version is kept only if it scores higher.
        for (let round = 1; round <= REBUILDS && !passes(verdict); round++) {
          const v: Verdict = verdict;
          onEvent({ phase: 'rebuilding', round, of: REBUILDS });
          // judged unimpressive: it may grow, up to the whole pile
          const grow = v.impressive < 3;
          const a = Math.min(range.hi, Math.max(lo2, Math.round(partCount(best) * (grow ? 1.25 : 0.9))));
          const b = Math.max(a + 4, grow ? range.hi : hi);
          const h: Content[] = [{ role: 'user', parts: [...opts.views(best).map(inlineImage), { text: `${brief(a, b)}

A REVIEWER looked at the renders above of an earlier attempt (front-right 3/4, front, side) and said it looks like "${v.looksLike}". Scores out of 5: recognizable ${v.recognizable}, complete ${v.complete}, colors ${v.colors}, impressive ${v.impressive}. Their fixes:
${v.fixes.map(f => `- ${f}`).join('\n')}
The earlier attempt, one part per line:
${listing(best)}

Design a NEW ${idea.name} from scratch that fixes all of this. Change anything (size, layout, shape) so a person would recognize it at a glance and it looks finished from every side. Write the plan first, then the full build.` }] }];
          const rr = await generate(h, { responseSchema: buildSchema(ids), thinkingConfig: thinking }, opts.signal);
          h.push(rr.content);
          const fixed = await makeValid(clean(rr.json as Build), h, have, MAX_REPAIRS, thinking, onEvent, opts.signal, opts.debug, ids, unused);
          if (!fixed) { onEvent({ phase: 'kept', reason: "The rebuild couldn't stand up; kept the earlier version" }); continue; }
          let next = fixed.build;
          const m = matchColors(next, have, new Set());
          if (m.matched) { next = m.build; onEvent({ phase: 'matched', count: m.matched }); }
          onEvent({ phase: 'rebuilt', build: next, partsUsed: partCount(next) });
          const nv = await look(next);
          if (passes(nv) || score(nv) > score(v)) { best = next; verdict = nv; improved = true; }
          else onEvent({ phase: 'kept', reason: `Kept the earlier version: it scored higher (${score(v)} vs ${score(nv)} of 20)` });
        }
        // A failed visual review remains a draft; it cannot offer finished instructions.
        if (!passes(verdict)) {
          const low = (['recognizable', 'complete', 'colors', 'impressive'] as const).filter(k => verdict![k] < 4).map(k => `${k} ${verdict![k]}/5`).join(', ');
          throw new GeminiError(`This draft did not pass the visual quality review${low ? ` (${low})` : ''}. ${verdict.fixes.join('; ')}`);
        }
      }
    }
    const sizeIssue = finishedSizeIssue(best);
    if (sizeIssue) throw new GeminiError(sizeIssue);
    onEvent({ phase: 'ready', build: best, rounds: first.rounds, partsUsed: partCount(best), seconds: secs(), improved, verdict });
    return best;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    onEvent({ phase: 'failed', reason: (e as Error).message, seconds: secs() });
  }
  return null;
}

// ---------------------------------------------------------------- 4. super fidelity: blueprint → sections → whole

interface Section { name: string; description: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; parts: number }
interface Blueprint { name: string; description: string; plan: Plan & { silhouette?: string }; sections: Section[] }

const placedSchema = {
  type: 'OBJECT', required: ['partId', 'x', 'y', 'z', 'rot'], propertyOrdering: ['partId', 'x', 'y', 'z', 'rot'],
  properties: { partId: { type: 'STRING' }, x: { type: 'INTEGER' }, y: { type: 'INTEGER' }, z: { type: 'INTEGER' }, rot: { type: 'INTEGER' } },
};
const sectionSchema = {
  type: 'OBJECT', required: ['steps'],
  properties: { steps: { type: 'ARRAY', items: { type: 'OBJECT', required: ['caption', 'parts'], properties: { caption: { type: 'STRING' }, parts: { type: 'ARRAY', items: placedSchema } } } } },
};
function blueprintSchema() {
  const int = { type: 'INTEGER' };
  const plan = (buildSchema(null).properties as Record<string, unknown>).plan;
  const secProps = { name: { type: 'STRING' }, description: { type: 'STRING' }, x0: int, x1: int, y0: int, y1: int, z0: int, z1: int, parts: int };
  return {
    type: 'OBJECT', required: ['name', 'description', 'plan', 'sections'], propertyOrdering: ['name', 'description', 'plan', 'sections'],
    properties: {
      name: { type: 'STRING' }, description: { type: 'STRING' }, plan,
      sections: { type: 'ARRAY', items: { type: 'OBJECT', required: Object.keys(secProps), propertyOrdering: Object.keys(secProps), properties: secProps } },
    },
  };
}

const SECTION_REPAIRS = 4;
const tidy = (steps: Build['steps'] | undefined) => (steps ?? []).filter(s => s.parts?.length);
const without = (b: Build, drop: Set<unknown>): Build =>
  ({ ...b, steps: b.steps.map(st => ({ ...st, parts: st.parts.filter(p => !drop.has(p)) })).filter(st => st.parts.length) });

/**
 * Add one section on top of the build so far. Parts already placed are fixed: the checker only reports
 * problems with the new parts, and edits that touch older parts are ignored. Parts that still don't
 * fit after the repair rounds are dropped (with anything that only rested on them).
 */
async function addSection(
  base: Build, context: Content[], all: Section[], k: number, have: Record<string, number>, thinking: Record<string, unknown>,
  onEvent: (e: BuildEvent) => void, signal?: AbortSignal, debug?: (label: string, data: unknown) => void,
): Promise<{ build: Build; dropped: number }> {
  const sec = all[k];
  const offset = partCount(base), stepOffset = base.steps.length;
  const join = (steps: Build['steps'] | undefined): Build => ({ ...base, steps: [...base.steps, ...tidy(steps)] });
  const problems = (b: Build) => {
    const fresh = new Set(b.steps.slice(stepOffset).flatMap(st => st.parts));
    return validate(b, have).filter(i => i.kind !== 'loose' && i.parts.some(p => fresh.has(p)));
  };
  const convo: Content[] = [...context, { role: 'user', parts: [{ text: `Build section ${k + 1} of ${all.length}: "${sec.name}". ${sec.description}
Its region: x ${sec.x0}–${sec.x1}, y ${sec.y0}–${sec.y1}, z ${sec.z0}–${sec.z1} (z in plates). About ${sec.parts} parts.
${k ? `Already built: ${all.slice(0, k).map(s => s.name).join(', ')}.` : 'This is the first section, so it starts on the ground (z=0).'} ${k < all.length - 1 ? `Still to come: ${all.slice(k + 1).map(s => s.name).join(', ')}. Leave studs where they will attach.` : 'This is the last section.'}

The build so far (${offset} parts; they are fixed, so never repeat or move them), one part per line:
${offset ? listing(base) : '(nothing yet)'}

Return ONLY this section's new parts, as steps of 3–12 parts, built bottom-up. Every new part rests on studs of a part already in the build or placed earlier in your answer, and never overlaps anything. Use the shaping parts wherever the real thing curves, tapers or is smooth. Each caption is 8 words or fewer.` }] }];
  let r = await generate(convo, { responseSchema: sectionSchema, thinkingConfig: thinking }, signal);
  convo.push(r.content);
  let cur = join((r.json as { steps?: Build['steps'] }).steps);
  let rejectedNote = '';
  for (let round = 0; ; round++) {
    onEvent({ phase: 'checking', parts: partCount(cur) - offset, round });
    const issues = problems(cur);
    if (!issues.length) return { build: cur, dropped: 0 };
    onEvent({ phase: 'issues', round, summary: summarize(issues), issues });
    if (round === SECTION_REPAIRS) break;
    onEvent({ phase: 'designing', round: round + 1 });
    const rewrite = issues.length > 12;
    convo.push({ role: 'user', parts: [{ text: `This section's parts now (#${offset} onward; everything before #${offset} is fixed):
${listing(cur).split('\n').slice(offset).join('\n')}

An automatic checker found these problems with them:
${issues.map(i => `- ${i.message}`).join('\n')}
${rejectedNote}
Fix every problem, keeping the section's shape.
${rewrite ? "Return all of this section's new parts again, corrected." : `Use the fewest changes. Only edit parts #${offset} and above, and put adds in step ${stepOffset + 1} or later. ${EDIT_HOW}`}` }] });
    r = await generate(convo, { responseSchema: rewrite ? sectionSchema : editsSchema(null), thinkingConfig: thinking }, signal);
    convo.push(r.content);
    debug?.(rewrite ? 'section-rewrite' : 'section-edits', { section: sec.name, round, issues: issues.map(i => i.message) });
    if (rewrite) { cur = join((r.json as { steps?: Build['steps'] }).steps); rejectedNote = ''; continue; }
    const edits = toEdits(r.json as EditLists)
      .filter(e => e.op === 'add' || (e.index ?? -1) >= offset)
      .map(e => (e.op === 'add' ? { ...e, step: Math.max(stepOffset + 1, e.step ?? 0) } : e));
    const kept = keepHelpfulEdits(cur, edits, have, issues.length, b => problems(b).length);
    rejectedNote = kept.rejected.length
      ? `\nLast round these edits were NOT applied, because each one made things worse (usually by landing on a spot that is already taken):\n${kept.rejected.map(describeEdit).join('\n')}\n`
      : '';
    cur = kept.build;
  }
  let dropped = 0;
  for (let pass = 0; pass < 10; pass++) {
    const drop = new Set(problems(cur).flatMap(i => i.parts));
    if (!drop.size) break;
    dropped += drop.size;
    cur = without(cur, drop);
  }
  return { build: cur, dropped };
}

/**
 * Super fidelity: no part or size limit. Gemini draws up a blueprint (scale, plan, 5–10 sections in
 * build order), builds and repairs one section at a time on top of the last, then the whole model gets
 * a final check and two rounds of looking at renders and improving.
 */
export async function designSuper(
  inv: Inventory, idea: Idea, onEvent: (e: BuildEvent) => void,
  opts: { signal?: AbortSignal; thinking?: 'low' | 'medium' | 'high'; views?: (b: Build) => string[]; debug?: (label: string, data: unknown) => void } = {},
): Promise<Build | null> {
  const t0 = performance.now();
  const secs = () => Math.round((performance.now() - t0) / 1000);
  const have = unlimitedInventory(counts(inv));
  const unused = () => 'any catalog part, in any color';
  const { lo, hi } = SUPER_RANGE;
  const thinking = { thinkingLevel: opts.thinking ?? 'medium' };
  const prompt = `You are a master model designer at a brick toy company, designing a large display model: "${idea.name}: ${idea.pitch}". There is no part limit and no size limit. Make it as big and detailed as it needs to be to look realistic, like the showpiece model in a store window, ${lo}–${hi} parts${idea.mainColor ? `, mostly ${idea.mainColor} on the outside` : ''}.

PARTS: any of these shapes in any of these colors (partId = type-AxB-color):
${CATALOG_TEXT}
${OPEN_COLORS}

${CONTRACT_TEXT}

${SPECIALTY_TEXT}

SCALE: realistic proportions need resolution. Pick the scale first: a large animal is typically 30–44 studs long, a vehicle 24–40, a building 24–40 wide. Stay inside x 0–47 and y 0–47. The front of the model faces the viewer (low y).

COLOR: one color per area of the model, the real thing's colors. Parts of other colors only where hidden inside. Small deliberate details (eyes, lights, windows, stripes) get their own zone.

${FINISH_TEXT}
- Get the proportions of a real ${idea.name} right before adding detail. Overlap bricks across the seams of the layer below so the layers lock together.

RULES (the app checks every one):
- Every part above z=0 rests on studs of a part placed EARLIER.
- No two parts overlap in space.
- The finished model is ONE connected piece: parts only connect through studs, so parts side by side are NOT connected unless something on top or underneath bridges them.

You will build it one section at a time in the next turns. Now write only the BLUEPRINT:
- plan: sizeX, sizeY, heightPlates; the silhouette in one sentence; 6–12 signature features of a real ${idea.name} and where each sits; colorZones.
- sections: 5–10 sub-assemblies in BUILD ORDER, bottom-up, so each one rests on the sections before it (the first starts on the ground). For each: name (1–3 words), description (what it contains and which shaping parts give it its form, 30 words or fewer), its region (x0–x1, y0–y1 in studs, z0–z1 in plates), and parts (30–110; split anything bigger). The parts add up to the whole model.`;
  const history: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
  try {
    onEvent({ phase: 'blueprinting' });
    const r = await generate(history, { responseSchema: blueprintSchema(), thinkingConfig: { thinkingLevel: 'high' } }, opts.signal);
    history.push(r.content);
    const bp = r.json as Blueprint;
    const sections = (bp.sections ?? []).filter(s => s.parts > 0).slice(0, 12);
    if (!sections.length) throw new GeminiError('The blueprint came back without sections');
    const p = bp.plan ?? {};
    onEvent({ phase: 'blueprint', sections: sections.length, parts: sections.reduce((a, s) => a + s.parts, 0), size: `${p.sizeX} × ${p.sizeY} studs, ${p.heightPlates} plates tall` });

    let build: Build = { name: bp.name, description: bp.description, steps: [] };
    for (let k = 0; k < sections.length; k++) {
      onEvent({ phase: 'section', index: k, total: sections.length, name: sections[k].name });
      const res = await addSection(build, history, sections, k, have, thinking, onEvent, opts.signal, opts.debug);
      build = res.build;
      onEvent({ phase: 'sectionDone', index: k, total: sections.length, name: sections[k].name, build, partsUsed: partCount(build), dropped: res.dropped });
    }

    // The whole model: mostly checks that the sections joined into one piece.
    const dropLoose = (b: Build) => {
      const issues = validate(b, have);
      if (issues.some(i => i.kind !== 'loose')) return null;
      const drop = new Set(issues.flatMap(i => i.parts));
      if (drop.size > partCount(b) * 0.1) return null;
      const kept = without(b, drop);
      return validate(kept, have).length ? null : kept;
    };
    const whole = await makeValid(build, history, have, 4, thinking, onEvent, opts.signal, opts.debug, null, unused, { rewriteOver: Infinity, lastResort: dropLoose });
    if (!whole) {
      onEvent({ phase: 'failed', reason: "Couldn't join the sections into one piece", seconds: secs() });
      return null;
    }
    let best = whole.build;
    let improved = false;
    if (opts.views) ({ build: best, improved } = await polish(
      { idea, history, have, ids: null, unused, thinking, onEvent, signal: opts.signal, debug: opts.debug, views: opts.views, plan: p, hi, rewriteOver: Infinity }, best, 2));
    const sizeIssue = finishedSizeIssue(best);
    if (sizeIssue) throw new GeminiError(sizeIssue);
    onEvent({ phase: 'ready', build: best, rounds: whole.rounds, partsUsed: partCount(best), seconds: secs(), improved });
    return best;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    onEvent({ phase: 'failed', reason: (e as Error).message, seconds: secs() });
  }
  return null;
}

// ---------------------------------------------------------------- 5. building together: moves for the workbench

/** One suggested next move on the workbench: a few edits, and the build they lead to (already checked). */
export interface Move { title: string; why: string; edits: Edit[]; build: Build }
/** Something else the shape so far could become: what in it fits, and how naturally (1–5). */
export interface Direction { name: string; why: string; fit: number }
export interface Suggestions { looksLike: string; goalFit: string; directions: Direction[]; moves: Move[] }

/**
 * The person is building by hand. Gemini looks at the build (renders, once there are a few parts, and the part
 * list) and the parts still unused. It says what it looks like it's becoming and how it's going as their goal,
 * names up to two other things the shape and the unused parts lead to just as naturally (so the build can change
 * course as its shape suggests), and offers three next moves as edits. Code applies each move and keeps only the
 * edits that don't add problems (overlaps, floating parts, using more than the pile has), so a move you accept
 * always fits. `hints` are the judge's fixes, when the person asked how it's looking.
 */
export async function suggestMoves(
  inv: Inventory, build: Build, goal: string,
  opts: { hints?: string[]; images?: string[]; signal?: AbortSignal } = {},
): Promise<Suggestions> {
  const { hints = [], images = [], signal } = opts;
  const have = counts(inv);
  const n = partCount(build);
  const shaping = Object.keys(have).some(id => SPECIALTY_TYPES.includes(parsePartId(id)?.type as PartType));
  const aim = goal ? `the ${goal}` : 'what it looks like it is becoming';
  const prompt = `You are building a brick model together with a person, from their own loose parts. They place parts by hand; you watch the shape take form and suggest where it could go next.${images.length ? '\nThe images are renders of the build so far: from the front-right, from the front and from the side. Judge its shape from them.' : ''}

${CONTRACT_TEXT}${shaping ? `\n\n${SPECIALTY_TEXT}` : ''}

The build so far (${n} parts), one part per line:
${n ? listing(build) : '(nothing placed yet: the plate is empty)'}

Parts still unused (partId × count): ${table(remaining(build, have))}
${goal ? `They said they are building: "${goal}".` : "They haven't said what it is."}
${hints.length ? `A reviewer who looked at it said: ${hints.join('; ')}. Address that first.\n` : ''}
Look at the shape the parts are forming (its outline and proportions, where it is tall, long or wide, the colors so far) and at the parts still unused.
1. looksLike: what the build looks like it's becoming, 8 words or fewer ("nothing yet" for an empty plate).
2. goalFit: ${goal ? `one sentence, 20 words or fewer, on how the shape is going as ${aim}: what already reads as one and what doesn't yet.` : 'leave it empty.'}
3. directions: up to 2 other things this shape and the unused parts could become, as naturally as ${aim} or more so, keeping most of what is already built. For each: name (1–3 words); why (16 words or fewer: what in the shape so far fits it, and which unused parts help); fit (1 to 5: how naturally the shape and the parts lead there).${goal ? ` Never ${aim} itself.` : ''} Give none if nothing fits as well, and none for an empty plate.
4. moves: 3 different next moves toward ${aim}, best first, each one a clear step: grow it, give it its signature shape, fix what reads wrong, or clean up a color. Each move:
- title: 6 words or fewer, an instruction that starts with a verb.
- why: 14 words or fewer.
- edits: 1 to 12 edits, using the #numbers above. New parts come only from the unused parts, rest on studs of a part below (or the plate at z=0), never overlap anything, and stay inside x 0–23 and y 0–23.
${EDIT_HOW}`;
  const schema = {
    type: 'OBJECT', required: ['looksLike', 'goalFit', 'directions', 'moves'], propertyOrdering: ['looksLike', 'goalFit', 'directions', 'moves'],
    properties: {
      looksLike: { type: 'STRING' }, goalFit: { type: 'STRING' },
      directions: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name', 'why', 'fit'], propertyOrdering: ['name', 'why', 'fit'], properties: { name: { type: 'STRING' }, why: { type: 'STRING' }, fit: { type: 'INTEGER' } } } },
      moves: { type: 'ARRAY', items: { type: 'OBJECT', required: ['title', 'why', 'edits'], propertyOrdering: ['title', 'why', 'edits'], properties: { title: { type: 'STRING' }, why: { type: 'STRING' }, edits: editsSchema(null) } } },
    },
  };
  const r = await generate([{ role: 'user', parts: [...images.map(inlineImage), { text: prompt }] }], { responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' } }, signal);
  const out = r.json as { looksLike: string; goalFit: string; directions: Direction[]; moves: { title: string; why: string; edits: EditLists }[] };
  // what blocks a move: overlaps, floating parts, over the pile, unknown parts (a loose second base is fine mid-build)
  const blocking = (b: Build) => validate(b, have).filter(i => i.kind !== 'loose').length;
  const before = blocking(build);
  const step = Math.max(1, build.steps.length);
  const moves: Move[] = [];
  for (const m of (out.moves ?? []).slice(0, 3)) {
    const edits = toEdits(m.edits).map(e => (e.op === 'add' ? { ...e, step } : e));
    const kept = keepHelpfulEdits(build, edits, have, before, blocking);
    const keptEdits = edits.filter(e => !kept.rejected.includes(e));
    if (keptEdits.length && blocking(kept.build) <= before) moves.push({ title: m.title, why: m.why, edits: keptEdits, build: kept.build });
  }
  const directions = (out.directions ?? [])
    .filter(d => d.name && (!goal || d.name.trim().toLowerCase() !== goal.trim().toLowerCase()))
    .map(d => ({ ...d, fit: Math.max(1, Math.min(5, d.fit || 1)) }))
    .slice(0, 2);
  return { looksLike: out.looksLike, goalFit: goal ? out.goalFit ?? '' : '', directions, moves };
}
