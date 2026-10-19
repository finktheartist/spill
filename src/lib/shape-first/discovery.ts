/** Subject discovery is separate from the recipe library. These are search directions, not designs. */
export const IDEA_FAMILIES = {
  objects: 'everyday objects, tools, furniture, instruments and food',
  architecture: 'buildings, landmarks, infrastructure and architectural fragments',
  machines: 'stationary machinery, scientific equipment and mechanical devices',
  watercraft: 'working, recreational and imagined waterborne vessels',
  aircraft: 'flying machines and spacecraft with distinct wing or propulsion layouts',
  vehicles: 'ground transport and working vehicles with different running gear',
  nature: 'plants, geological forms and natural environments',
  animals: 'land, water and airborne creatures with different body plans',
  characters: 'figures and characters distinguished by occupation, gesture or anatomy',
  scenes: 'one compact interaction between connected elements; no filler scenery',
} as const;
export type IdeaFamily = keyof typeof IDEA_FAMILIES;
export interface IdeaIdentity { family: IdeaFamily; concept: string; form: string }
export interface SeenIdea { name: string; discovery?: IdeaIdentity }
export interface IdeaStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const KEY = 'spill.idea-history.v1', MAX_PILES = 12, MAX_IDEAS = 120;
type Ledger = { key: string; ideas: SeenIdea[] }[];
const memory = new Map<string, string>();
const fallback: IdeaStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => { memory.set(k,v); } };

/** If browser storage is blocked, repeats are still avoided within this page session. Node callers opt in. */
function defaultStorage(): IdeaStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  return { getItem(k) { try { return fallback.getItem(k) ?? localStorage.getItem(k); } catch { return fallback.getItem(k); } },
    setItem(k,v) { try { localStorage.setItem(k,v); memory.delete(k); } catch { fallback.setItem(k,v); } } };
}
export const inventoryKey = (mode: string, stock: Record<string, number>) => mode + ':' + JSON.stringify(
  Object.entries(stock).filter(([,n]) => Number.isSafeInteger(n) && n > 0).sort(([a],[b]) => a.localeCompare(b)));

const text = (v: unknown, max = 100): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function identityOf(value: unknown): IdeaIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as IdeaIdentity;
  return Object.hasOwn(IDEA_FAMILIES, d.family) && text(d.concept,80) && text(d.form,120)
    ? { family:d.family, concept:d.concept.trim(), form:d.form.trim() } : undefined;
}
function readLedger(storage?: IdeaStorage): Ledger {
  try {
    const raw = storage?.getItem(KEY); if (!raw || raw.length > 1_000_000) return [];
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.piles)) return [];
    return data.piles.slice(-MAX_PILES).filter((p: { key?:unknown; ideas?:unknown }) => text(p?.key,30_000) && Array.isArray(p.ideas))
      .map((p: { key:string; ideas:SeenIdea[] }) => ({ key:p.key, ideas:p.ideas.slice(-MAX_IDEAS).filter(i => text(i?.name,100)).map(i => ({ name:i.name, discovery:identityOf(i.discovery) })) }));
  } catch { return []; }
}
export function loadIdeaHistory(mode:string, stock:Record<string,number>, storage = defaultStorage()): SeenIdea[] {
  return readLedger(storage).find(p => p.key === inventoryKey(mode,stock))?.ideas ?? [];
}
export function rememberIdeas(mode:string, stock:Record<string,number>, ideas:SeenIdea[], storage = defaultStorage()) {
  if (!storage) return;
  const key = inventoryKey(mode,stock), ledger = readLedger(storage), previous = ledger.find(p => p.key === key)?.ideas ?? [];
  const next = ideas.filter(i => text(i.name,100)).map(i => ({ name:i.name, discovery:identityOf(i.discovery) }));
  const combined = [...previous];
  for (const idea of next) if (!combined.some(old => sameConcept(idea,old))) combined.push(idea);
  try { storage.setItem(KEY, JSON.stringify({ version:1, piles:[...ledger.filter(p => p.key !== key), { key,ideas:combined.slice(-MAX_IDEAS) }].slice(-MAX_PILES) })); } catch { /* private or full storage must not stop a build */ }
}

const normalize = (s:string) => s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const NAME_MODIFIERS = new Set([
  'a','an','the','small','tiny','mini','miniature','compact','little','large','big','lego','brick','built','model',
  'red','blue','green','yellow','orange','white','black','azure','brown','gray','grey','dark','light','bright',
  'sitting','standing','perched','sleeping','seated','crouching','exploration',
]);
const plainName = (s:string) => normalize(s).split(' ').filter(w => !NAME_MODIFIERS.has(w)).join(' ');
export function sameConcept(a:SeenIdea,b:SeenIdea) {
  if(normalize(a.name) === normalize(b.name)) return true;
  const an = plainName(a.name), bn = plainName(b.name);
  if (an && an === bn) return true;
  const x=identityOf(a.discovery),y=identityOf(b.discovery);
  return !!x && !!y && ((normalize(x.concept) === normalize(y.concept)) || (x.family === y.family && normalize(x.form) === normalize(y.form)));
}
export function explorationOrder(history:SeenIdea[]): IdeaFamily[] {
  const counts = new Map<IdeaFamily,number>();
  for (const i of history) { const d=identityOf(i.discovery); if(d) counts.set(d.family,(counts.get(d.family)??0)+1); }
  return (Object.keys(IDEA_FAMILIES) as IdeaFamily[]).sort((a,b)=>(counts.get(a)??0)-(counts.get(b)??0));
}
export function discoveryPrompt(history:SeenIdea[], count:number) {
  const order=explorationOrder(history);
  return `SEARCH BREADTH: Propose ${count} candidates before any are built. Explore at least six of these subject families, with no more than three ideas per family. Directions are open-ended, not a list of approved subjects. Prioritize the first six, which have been explored least for this pile:
${order.map(f=>`- ${f}: ${IDEA_FAMILIES[f]}`).join('\n')}
Start from what the parts can EXPRESS: a taper, an arch, a smooth shell, a projecting arm, a narrow stem, a layered surface, an open frame. Reinterpret the same geometry across unrelated subjects. Do not default to a bird, fox and robot trio. A man-made object's body may use a plausible painted or manufactured color from the pile; it does not need to match a famous brand. Natural subjects still need credible natural colors.
For each idea add discovery {family, concept, form}. concept is the plain everyday object kind without colors, size, pose, mood or decorative adjectives. form is a brief reusable silhouette/body-plan description without species or marketing names. Changing a bird species, vehicle paint, a robot's job, or a model's pose alone does not make a new concept. Seek different outlines, functions and construction layouts.
Never require unavailable moving joints, axles or sideways connections; a static representation must be recognizable and described honestly. Fit and recognizability take precedence over filling a category. Ideas are proposals, not proof of a successful build.
${history.length ? `PREVIOUSLY SELECTED OR EXPLICITLY EXCLUDED — do not repeat these concepts or merely rename their body plans:\n${JSON.stringify(history.slice(-MAX_IDEAS))}` : 'There is no previous selection for this pile.'}`;
}

/** Feasibility tier first, then family coverage, then the existing fit order. No novelty bonus can promote
 * an over-budget idea above a feasible one. Legacy ideas without metadata retain their original order. */
export function selectDistinctIdeas<T extends SeenIdea & { worst:number; shortfall:number; cells:number;pieceOpportunity?:{tier:string};opportunity?:{tier:string} }>(
  ranked:T[], n:number, history:SeenIdea[], mode:'pile'|'shopping',
) {
  const remaining=ranked.filter(i=>!history.some(old=>sameConcept(i,old))), selected:T[]=[], rejected:{name:string;reason:string}[]=[];
  for(const i of ranked) if(!remaining.includes(i))rejected.push({name:i.name,reason:'Previously selected concept'});
  const counts=new Map<IdeaFamily,number>(),order=explorationOrder(history);
  while(remaining.length && selected.length<n) {
    remaining.sort((a,b)=>{
      const tier=(i:T)=>mode==='pile'?4*Math.max(...[i.pieceOpportunity?.tier,i.opportunity?.tier].map(t=>({blocked:3,unverified:2,scarce:1}[String(t) as 'blocked'|'unverified'|'scarce']??0)))+Number(i.worst>.9):Math.floor(4*i.shortfall/Math.max(1,i.cells));
      const x=identityOf(a.discovery),y=identityOf(b.discovery);
      return tier(a)-tier(b) || (x&&y ? (counts.get(x.family)??0)-(counts.get(y.family)??0) || order.indexOf(x.family)-order.indexOf(y.family) : 0);
    });
    const idea=remaining.shift()!;
    if(selected.some(i=>sameConcept(i,idea))) { rejected.push({name:idea.name,reason:'Duplicate concept or body plan in this batch'}); continue; }
    selected.push(idea);const d=identityOf(idea.discovery);if(d)counts.set(d.family,(counts.get(d.family)??0)+1);
  }
  return {selected,rejected};
}
