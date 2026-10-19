import { componentCandidates } from './component-planner';
import { listing, partCount } from './bricks';
import { matchContext, matchRecipe, finishedRecipeFamilies, type LibraryMatch } from './library';
import { RECIPES } from './library-recipes';
import { ANIMAL_BASES, ANIMAL_BASE_RECIPES, ANIMAL_SPECIES, animalBaseModule } from './animal-recipes';
import { FAMILY_STRATEGIES, strategiesFor, strategyForRecipe, subjectWords } from './construction-families';

const words = (s: string) => subjectWords(s).filter(w => w.length > 2 && !['little', 'tiny', 'small', 'mini', 'build', 'model', 'with', 'from', 'and', 'the'].includes(w));
export function animalBasesFor(subject: string) {
  const query = new Set(words(subject));
  return ANIMAL_BASES.filter(b => b.relatives.some(r => query.has(r)));
}
export function animalPlanText(subject: string): string {
  const bases = animalBasesFor(subject);
  if (!bases.length) return '';
  return `ANIMAL CONSTRUCTION FAMILIES:\n${bases.map(b => {
    const species = ANIMAL_SPECIES.filter(a => a.base === b.id);
    return `${b.label}: ${b.identity}\nFeature examples: ${species.map(a => `${a.id}: ${a.features.join(', ')}`).join('; ')}.`;
  }).join('\n')}\nAdapt anatomy to the requested animal and actual stock. These are reusable body plans, not permission to rename one finished animal as another. Plan its head, ears/beak/horns, stance, and tail or shell together before consuming the stock. Preserve the essential silhouette even when colors change. Other related species may use these bases, but must get their own defining features. Unfinished body bases are not complete animals.`;
}

export function assemblyCandidates(subject: string, stock: Record<string, number>, maxParts = 80): LibraryMatch[] {
  const query = new Set(words(subject)), bases = animalBasesFor(subject);
  const generic = new Set(['animal', 'building', 'house', 'car', 'truck', 'vehicle', 'aircraft', 'airplane', 'plane', 'boat', 'character', 'machine', 'object', 'furniture', 'plant']);
  const generalRequest = words(subject).length > 0 && subjectWords(words(subject).join(' ')).every(w => generic.has(w));
  const families = generalRequest ? strategiesFor(subject).map(f => f.id) : [];
  const ranked = finishedRecipeFamilies().map(variants => {
    const r = variants[0], terms = new Set(words(`${r.family} ${r.name} ${(r.tags ?? []).join(' ')}`));
    const related = families.includes(strategyForRecipe(r).id);
    return { variants, score: generalRequest && !related ? 0 : [...query].filter(w => terms.has(w)).length + (related ? 1 : 0) };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  const matches: LibraryMatch[] = [], context = matchContext(stock);
  const finishedLimit = bases.length ? 2 : 4;
  const alternatives: typeof ranked = [];
  // Find one fitting silhouette per family before spending slots on its variants.
  // Do not truncate families before matching: the first related family may not fit.
  for (const family of ranked) {
    for (let i = 0; i < family.variants.length; i++) {
      const r = family.variants[i];
      if (r.steps.reduce((n, s) => n + s.parts.length, 0) > maxParts) continue;
      const m = matchRecipe(r, stock, context);
      if (!m || partCount(m.build) > maxParts) continue;
      matches.push(m);
      alternatives.push({ ...family, variants: family.variants.slice(i + 1) });
      break;
    }
    if (matches.length >= finishedLimit) break;
  }
  outer: for (const { variants } of alternatives) for (const r of variants) {
    if (matches.length >= finishedLimit) break outer;
    if (r.steps.reduce((n, s) => n + s.parts.length, 0) > maxParts) continue;
    const m = matchRecipe(r, stock, context);
    if (m && partCount(m.build) <= maxParts) matches.push(m);
  }
  const total = Object.values(context.have).reduce((a, n) => a + n, 0);
  for (const r of ANIMAL_BASE_RECIPES.filter(r => bases.some(b => b.id === r.animalBase))) {
    const m = matchRecipe(r, stock, context);
    // Leave a real finishing budget; a body that consumes the pile is not a useful seed.
    if (m && partCount(m.build) + 8 <= Math.min(maxParts, total)) matches.push(m);
    if (matches.length >= 4) break;
  }
  return matches;
}
/** The build agent can also execute newly compiled component plans. Catalog retrieval stays stable. */
export function builderAssemblies(subject: string, stock: Record<string, number>, maxParts = 80): LibraryMatch[] {
  return [...componentCandidates(subject, stock, maxParts), ...assemblyCandidates(subject, stock, maxParts)];
}
export function assemblyText(matches: LibraryMatch[]): string {
  if (!matches.length) return '';
  return `CHECKED MODULAR STARTING ASSEMBLIES (independent alternatives, not extra inventory):\n${matches.map(m => {
    if (m.silhouettePlan) return `${m.recipeId}: ${m.build.name}; ${partCount(m.build)} actual pieces.\nEXPERIMENTAL SILHOUETTE PLAN: ${m.silhouettePlan.outline}\nRequired landmarks: ${m.silhouettePlan.landmarks.join('; ')}.\nThese executable placements fit the shared stock ledger, but appearance is unapproved. Select this ID to execute them exactly. Preserve the silhouette while refining local features; the normal independent appearance gate still applies.\n${listing(m.build)}`;
    if (m.componentPlan) return `${m.recipeId}: ${m.build.name}; ${partCount(m.build)} actual pieces.\nCOMPILED COMPONENT PLAN: all required components are already connected and allocated together. Select this ID to execute these placements; do not rebuild them by guessing coordinates.\nIdentity: ${m.componentPlan.features.join('; ')}.\nComponents: ${m.componentPlan.modules.join(', ')}.\nVerified attachment contacts: ${m.componentPlan.interfaces.map(p => `${p.parent}.${p.socket} -> ${p.child}: ${p.contacts} studs`).join('; ')}.\nOriginal upright-stud adaptations of studied principles; not imported source geometry or physically certified constructions.\n${listing(m.build)}`;
    const r = RECIPES.find(r => r.id === m.recipeId) ?? ANIMAL_BASE_RECIPES.find(r => r.id === m.recipeId)!;
    const incomplete = m.recipeId.startsWith('animal-base-');
    const sockets = incomplete ? animalBaseModule(r.animalBase!, m.recipeId.endsWith('curved') ? 'curved' : 'sloped').ports : undefined;
    const allocation = m.features?.map(f => `${f.kind}: ${f.name} (${Object.values(f.parts).reduce((n, q) => n + q, 0)} actual pieces allocated)`).join('; ');
    return `${m.recipeId}: ${r.name}, ${m.label ?? 'original'}; ${partCount(m.build)} actual pieces.\n${incomplete ? 'UNFINISHED ANIMAL BODY: must add a head and the requested species features before completion.\nOpen module sockets (x,y,z in studs/plates; verify the full attachment map): ' + JSON.stringify(sockets) : 'Complete starting model; all defining modules are already allocated from one shared stock ledger.'}\nIdentity: ${r.features.join('; ')}.\nModules: ${r.modules?.map(p => `${p.label}${p.parent ? ` attached at ${p.parent}.${p.socket}` : ' (root)'}`).join('; ') ?? 'authored connected assembly'}.\n${allocation ? 'Feature allocations (already included, never add these counts again): ' + allocation : ''}\n${listing(m.build)}`;
  }).join('\n\n')}\nThese are checked placements fitted to the actual bucket. Select one only when it serves the requested subject. The application places it exactly; you then refine with the remaining stock. Choose none for a different silhouette. Never combine their parts lists without deducting shared stock.`;
}

export function catalogSubjectsText(): string {
  return `The local checked catalog contains these subjects: ${finishedRecipeFamilies().map(v => v[0].name).join(', ')}. For new ideas, prefer subjects beyond this list or materially different silhouettes. The construction planner can reuse compatible library assemblies where useful.\nConstruction families: ${FAMILY_STRATEGIES.map(f => `${f.name}: ${f.structure}; defining features: ${f.features.join(', ')}`).join('\n')}.\nReusable animal body families: ${ANIMAL_BASES.map(b => `${b.label} (${b.relatives.join(', ')})`).join('; ')}. Suggest a related animal only when the stock can supply its distinguishing head, tail, stance, and other signature features; a bare body is not a finished suggestion.`;
}
