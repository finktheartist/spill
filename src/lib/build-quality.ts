import { applyEdits, parsePartId, partCount, studsOnTop, type Build, type Edit } from './bricks';
import { constructionIssues, constructionKey, orderBuild } from './construction';
import type { Verdict } from './gemini';
import { cleanComposition, compositionText, type CompositionPlan } from './design-language';
import { MIN_FINISHED_PARTS, finishedSizeIssue } from './finished-build';

export interface SignatureFeature { name: string; purpose: string; parts: { partId: string; count: number }[] }
export interface QualityPlan { composition?: CompositionPlan; features: SignatureFeature[]; colorZones: { zone: string; color: string }[] }
export interface Allocation { plan: QualityPlan; reserved: Record<string, number>; core: Record<string, number>; notes: string[] }
export const emptyQualityPlan = (): QualityPlan => ({ features: [], colorZones: [] });
export const reservationLimit = (have: Record<string, number>, hi: number) =>
  Math.max(0, Math.min(12, Math.floor(hi / 3), Math.floor(Object.values(have).reduce((a, n) => a + n, 0) / 4)));

/** Reservations are real stock deductions, never merely a suggestion in the prompt. */
export function allocateFeatures(raw: QualityPlan, have: Record<string, number>, hi: number): Allocation {
  const plan = emptyQualityPlan(), core = { ...have }, reserved: Record<string, number> = {}, notes: string[] = [];
  const composition = cleanComposition(raw?.composition);
  if (composition) plan.composition = composition;
  const limit = reservationLimit(have, hi);
  let used = 0;
  // Keep one useful base and at least half the ordinary connecting stock available for the core.
  const structural = Object.keys(have).filter(id => ['brick', 'plate'].includes(parsePartId(id)?.type ?? ''));
  const base = structural.sort((a, b) => {
    const ka = parsePartId(a)!, kb = parsePartId(b)!;
    return kb.w * kb.d - ka.w * ka.d || a.localeCompare(b);
  })[0];
  const structuralTotal = structural.reduce((n, id) => n + have[id], 0);
  for (const feature of (Array.isArray(raw?.features) ? raw.features : []).slice(0, 3)) {
    if (typeof feature?.name !== 'string' || typeof feature.purpose !== 'string' || !Array.isArray(feature.parts)) continue;
    const need: Record<string, number> = {};
    let invalid = false;
    for (const p of feature.parts) {
      if (!p || !Number.isSafeInteger(p.count) || p.count < 1 || !have[p.partId]) { invalid = true; break; }
      need[p.partId] = (need[p.partId] ?? 0) + p.count;
    }
    const n = Object.values(need).reduce((a, b) => a + b, 0);
    const left = Object.fromEntries(Object.entries(core).map(([id, qty]) => [id, qty - (need[id] ?? 0)]));
    const hasStuds = Object.entries(left).some(([id, qty]) => qty > 0 && studsOnTop(parsePartId(id)!.type));
    if (invalid || used + n > limit || Object.values(left).some(qty => qty < 0) || !hasStuds || (base && left[base] < 1) ||
        structural.reduce((sum, id) => sum + left[id], 0) < Math.ceil(structuralTotal / 2)) {
      notes.push(`Skipped reservation for ${feature.name}: preserve a feasible core and stay within actual stock.`);
      continue;
    }
    for (const [id, qty] of Object.entries(need)) { core[id] -= qty; reserved[id] = (reserved[id] ?? 0) + qty; }
    used += n;
    plan.features.push({ name: feature.name.slice(0, 80), purpose: feature.purpose.slice(0, 240), parts: Object.entries(need).map(([partId, count]) => ({ partId, count })) });
  }
  const colors = new Set(Object.keys(have).map(id => parsePartId(id)?.color));
  plan.colorZones = (Array.isArray(raw?.colorZones) ? raw.colorZones : []).filter(z => typeof z?.zone === 'string' && colors.has(z.color as never))
    .slice(0, 4).map(z => ({ zone: z.zone.slice(0, 120), color: z.color }));
  return { plan, reserved, core: Object.fromEntries(Object.entries(core).filter(([, n]) => n > 0)), notes };
}

export function qualityPlanText(plan: QualityPlan): string {
  return `${compositionText(plan.composition)}SIGNATURE FEATURES:\n${plan.features.map(f => `- ${f.name}: ${f.purpose}. Reserved: ${f.parts.map(p => `${p.partId} × ${p.count}`).join(', ') || 'none'}`).join('\n') || 'Use the subject’s defining silhouette.'}
VISIBLE COLOR PLAN:\n${plan.colorZones.map(z => `- ${z.zone}: ${z.color}`).join('\n') || 'Use repeated, deliberate color patterns from the available pieces.'}
Use mixed colors in hidden supports when possible. Preserve intentional accents; do not force matching colors the inventory cannot supply.`;
}

export const refinementLimits = (build: Build) => ({ changed: Math.max(4, Math.ceil(partCount(build) * 0.4)), added: 12 });

/** Apply a revision atomically. Invalid shape changes never get trimmed into a worse valid build. */
export function refinementCandidate(original: Build, edits: Edit[], have: Record<string, number>, hi: number): { build?: Build; issues: string[] } {
  if(original.engine==='connections-v2')return {issues:['Use attachment operations to refine a connection build.']};
  const issues: string[] = [], parts = original.steps.flatMap(s => s.parts), touched = new Set<number>(), removed = new Set<number>(), other = new Set<number>();
  const seen = new Set<string>(), limits = refinementLimits(original);
  let added = 0;
  for (const e of edits) {
    if (!['move', 'remove', 'add', 'recolor'].includes(e.op)) { issues.push('Unknown edit operation.'); continue; }
    if (e.op === 'add') {
      added++;
      if (!e.partId || !have[e.partId] || ![e.x, e.y, e.z, e.rot].every(Number.isInteger) || !Number.isInteger(e.step) || e.step! < 1 || e.step! > original.steps.length + 1) issues.push('Each addition needs a stocked part, integer coordinates/rotation, and a valid step.');
      continue;
    }
    if (!Number.isInteger(e.index) || !parts[e.index!]) { issues.push('Every changed part index must exist in the original.'); continue; }
    const index = e.index!;
    touched.add(index);
    if (seen.has(`${e.op}:${index}`)) issues.push('Do not repeat an operation for the same part.');
    seen.add(`${e.op}:${index}`);
    if (e.op === 'remove') removed.add(index); else other.add(index);
    if (e.op === 'move' && ![e.x, e.y, e.z, e.rot].every(Number.isInteger)) issues.push('Moves need all integer coordinates and rotation.');
    if (e.op === 'recolor') {
      const a = parsePartId(parts[index].partId), b = parsePartId(e.partId ?? '');
      if (!a || !b || !have[e.partId!] || a.type !== b.type || a.w !== b.w || a.d !== b.d) issues.push('Recolors must use the same stocked shape and size.');
    }
  }
  if ([...removed].some(i => other.has(i))) issues.push('A removed part cannot also be moved or recolored.');
  if (touched.size > limits.changed || added > limits.added) issues.push(`Keep this revision local: change at most ${limits.changed} existing parts and add at most ${limits.added}.`);
  if (issues.length) return { issues };
  // Old captions may name colors or features that the revision replaced. Rebuild the
  // instruction layers from the final geometry so the text cannot describe removed parts.
  const candidate = orderBuild(applyEdits(original, edits), true);
  if (parts.length >= MIN_FINISHED_PARTS && finishedSizeIssue(candidate)) issues.push(finishedSizeIssue(candidate)!);
  if (partCount(candidate) > hi) issues.push(`The complete model must use at most ${hi} pieces.`);
  if (partCount(candidate) < Math.ceil(parts.length * 0.65)) issues.push('Preserve at least 65% of the original part count; refine the model rather than dismantling it.');
  issues.push(...constructionIssues(candidate, have, 24).map(i => i.message));
  return issues.length ? { issues } : { build: constructionKey(candidate) === constructionKey(original) ? original : candidate, issues: [] };
}

export function validVerdict(v: Verdict | undefined): v is Verdict {
  return !!v && typeof v.looksLike === 'string' && Array.isArray(v.fixes) && v.fixes.every(f => typeof f === 'string') && [v.recognizable, v.complete, v.colors, v.impressive].every(n => Number.isInteger(n) && n >= 1 && n <= 5);
}

/** A tie, malformed verdict, or a loss of identity/completeness keeps the original. */
export function refinementWins(original: Verdict, candidate: Verdict, preferred: boolean): boolean {
  if (!preferred || !validVerdict(original) || !validVerdict(candidate)) return false;
  const scores = [candidate.recognizable, candidate.complete, candidate.colors, candidate.impressive];
  const sum = (v: Verdict) => v.recognizable + v.complete + v.colors + v.impressive;
  return Math.min(...scores) >= 3 && sum(candidate) >= 14 && sum(candidate) > sum(original) &&
    candidate.recognizable >= original.recognizable && candidate.complete >= original.complete && candidate.impressive >= original.impressive;
}

/** Local drafts can improve between integer score bands. This never means finished.
 * A real A/B preference, recognized subject and no score regression are required.
 */
export function draftRefinementWins(original: Verdict, candidate: Verdict, preferred: boolean): boolean {
  if (!preferred || !validVerdict(original) || !validVerdict(candidate) || candidate.subjectMatched === false || candidate.recognizable < 4) return false;
  return (['recognizable','complete','colors','impressive'] as const).every(k => candidate[k] >= 3 && candidate[k] >= original[k]);
}
