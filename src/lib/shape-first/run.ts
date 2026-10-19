// One tab's run: ideas from the pile's colors, then for each of three slots a shape design, a brick fit in a worker,
// one revision when the pile can't cover it at a good size, a backup idea when it still can't, and a blind review.
// Only your pile: a pile too small for any model is told so up front, without model calls. A pile too small for a
// sculpture (smallPile) gets small models built around its special parts, each shown only when the blind reviewer can
// tell what it is. Otherwise builds under MIN_PILE_PARTS are never shown.
import type { Build } from '../bricks';
import type { summary } from './bricklayer';
import { MIN_PILE_PARTS, MIN_SMALL_CELLS, MIN_SMALL_PARTS, designIdea, pileReach, proposeIdeas, reviseDesign, smallPile, trialReport, type Fitted, type PileReach, type RankedIdea, type ShapeMode } from './pipeline';
import type { ShapeProgram } from './program';
import { refineAppearance } from './appearance';
import type { FeatureReceipt } from '../moc-feature-edit';
import { buildFeatureFirst } from './feature-first';
import type { FeaturePlan } from '../feature-first';
import { rememberIdeas } from './discovery';
import { buildAssemblyFirst } from './assembly-first';
import { partCount } from '../bricks';
import {buildAnimalFirst} from './animal-first';
import {animalSubjectKind} from '../assembly-composer/animal-subjects';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import type {StockEvidence} from './stock-evidence';
import {buildWholeModel} from './whole-model';
import type {WholeModelReview} from './whole-model-review';
import type {WholeModelCheckpoint} from './whole-model-checkpoint';
import {inspectBench} from '../whole-model-workbench';

export interface SlotLine { text: string; tone: 'work' | 'good' | 'bad' | 'note' }
/** `named`: the reviewer's own description, written without the subject, names it or its everyday category. */
export interface ShapeVerdict { looksLike: string; recognizable: number; complete: number; colors: number; impressive: number; fixes: string[]; pass: boolean; named: boolean }
/** A small model is shown only when the blind reviewer described it as its subject (a kingfisher as "small blue bird
 * with yellow beak"), even when its scores are a draft's. */
export const recognized = (v: ShapeVerdict) => v.named && v.recognizable >= 2;
export interface ShapeStats { parts: number; onPalette?: number; holes?: number; symmetry?: number; fit?: number; clean: boolean; toGet?: number; fromPile?: number; appearanceRevised?: boolean; featureFirst?: boolean; assemblyFirst?: boolean; assemblyFamily?:'animal'|'aircraft'; wholeModel?:boolean; decisions?:number; unused?:number;stockUnverified?:boolean }
export interface ShapeSlot {
  key: string; idea: RankedIdea; phase: 'designing' | 'building' | 'revising' | 'judging' | 'ready' | 'failed';
  log: SlotLine[]; startedAt: number; build?: Build; preview?:Build; checkpoint?:WholeModelCheckpoint; program?: ShapeProgram; stats?: ShapeStats; verdict?: ShapeVerdict; replaced?: string;
  /** Failed because no stock-bound size reaches the required part budget. */
  tooSmall?: boolean;
  /** A count/geometry-valid model was not identified by the blind reviewer. */
  unrecognized?:boolean;
  /** A complete native construction is available even if appearance review failed. */
  instructionsReady?:boolean;
  /** One of a small pile's small models (see smallPile). */
  smallModel?: boolean;
  /** Compiled study assemblies retained after independent visual comparison. */
  features?: FeatureReceipt[];
  featurePlan?: FeaturePlan;
  /** Original animal request, retained when stock-bound anatomy is honestly adapted. */
  requestedName?:string;
  craftReview?:WholeModelReview;
  excludedParts?:string[];
}
/** `small` is set when the pile is too small for a sculpture: up front (no slots), or when every slot came out too small. */
export interface ShapeRun { slots: ShapeSlot[]; small?: PileReach }

type Summary = ReturnType<typeof summary>;
type PileFit = { best: Fitted; tries: { fit: number; parts: number; onPalette: number; holes: number; clean: boolean }[]; full: Fitted };
type ShopFit = { build: Build; s: Summary; bought: Record<string, number>; toGet: number; fromPile: number };

function fitInWorker(kind: 'pile', program: ShapeProgram, stock: Record<string, number>, signal?: AbortSignal, minParts?: number): Promise<PileFit>;
function fitInWorker(kind: 'shopping', program: ShapeProgram, stock: Record<string, number>, signal?: AbortSignal): Promise<ShopFit>;
function fitInWorker(kind: 'pile' | 'shopping', program: ShapeProgram, stock: Record<string, number>, signal?: AbortSignal, minParts?: number): Promise<PileFit | ShopFit> {
  return new Promise((resolve, reject) => {
    if(signal?.aborted){reject(new DOMException('Stopped','AbortError'));return;}
    const w = new Worker(new URL('./fit.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => { w.terminate(); reject(new DOMException('Stopped', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
    w.onmessage = e => { w.terminate(); signal?.removeEventListener('abort', stop); e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)); };
    w.onerror = e => { w.terminate(); signal?.removeEventListener('abort', stop); reject(new Error(e.message || 'The brick fitter stopped.')); };
    w.postMessage({ kind, program, stock, minParts });
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** No size of it reaches the part floor from this pile. */
const tooSmall = (f: PileFit, floor: number) => Math.max(...f.tries.map(t => t.parts)) < floor;
const trialLine = (f: PileFit, floor: number) => f.best.clean
  ? `Fits your pile at ${pct(f.best.fit)} size: ${f.best.s.parts} parts, ${pct(f.best.s.onPalette)} in its own colors`
  : tooSmall(f, floor)
    ? `Too small from your pile: ${Math.max(...f.tries.map(t => t.parts))} parts at most, and it takes about ${floor} to read as itself`
    : `Your pile can't cover it cleanly: best ${f.best.s.parts} parts at ${pct(f.best.s.onPalette)} in its own colors`;

export async function runShapeTab(
  mode: ShapeMode, stock: Record<string, number>,
  onChange: (slots: ShapeSlot[]) => void,
  opts: { signal?: AbortSignal; judge?: (build: Build, idea: RankedIdea, signal?:AbortSignal) => Promise<ShapeVerdict>; views?: (build:Build)=>string[]; appearance?: boolean; featureFirst?: boolean; assemblyFirst?: boolean; animalFirst?:boolean; wholeModel?:boolean; editableModel?:boolean; wholeViews?: (build:Build)=>string[]; resume?:WholeModelCheckpoint;resumeFeedback?:string; onStatus?:(text:string)=>void; debug?: (label:string,data:unknown)=>void; avoid?: string[]; ideas?:RankedIdea[];stockEvidence?:StockEvidence } = {},
): Promise<ShapeRun> {
  const reach = mode === 'pile' ? pileReach(stock) : undefined;
  if(opts.resume&&(mode!=='pile'||opts.editableModel!==true||opts.ideas?.length!==1))throw Error('Continue one editable pile model at a time.');
  if (reach && reach.cells < MIN_SMALL_CELLS && !opts.ideas?.length) return { slots: [], small: reach };
  const small = !!reach && smallPile(reach), floor = small ? MIN_SMALL_PARTS : MIN_PILE_PARTS;
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  const { ranked, exploration } = opts.ideas?{ranked:opts.ideas.slice(0,3),exploration:{selected:true,count:opts.ideas.length}}
    :await proposeIdeas(mode, stock, mode === 'pile' ? opts.editableModel?3:6 : 5, opts.avoid ?? [], opts.signal, small,undefined,opts.stockEvidence,mode==='pile'&&opts.editableModel===true,
      p=>{if(p.phase==='start')opts.onStatus?.(p.hop>1?`Choosing subjects · resuming the same reasoning (hop ${p.hop}/3)…`:'Reading your pile’s shapes and colors; choosing subjects…');});
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  if(opts.ideas){rememberIdeas(mode,stock,ranked);const {rememberAtlasIds}=await import('../build-atlas/history');
    if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');rememberAtlasIds(mode,stock,ranked.flatMap(i=>i.atlas?[i.atlas.briefId]:[]));}
  opts.debug?.('ideaDiscovery',exploration);
  if (!ranked.length) throw new Error('No new subjects came back after excluding earlier ideas. Try again to explore another direction.');
  const slots: ShapeSlot[] = ranked.slice(0, 3).map((idea, i) => ({ key: `${mode}-${i}`, idea, phase: 'designing', log: [{ text: 'Designing the shape…', tone: 'work' }], startedAt: Date.now(), smallModel: small || undefined }));
  const backups = ranked.slice(3);
  const emit = () => onChange(slots.map(s => ({ ...s, log: [...s.log] })));
  const update = (i: number, patch: Partial<ShapeSlot>, line?: SlotLine) => { slots[i] = { ...slots[i], ...patch, log: line ? [...slots[i].log, line] : slots[i].log }; emit(); };
  const stepIn = (i: number, why: string) => {
    const next = backups.shift();
    if (!next) return false;
    slots[i] = { key: `${slots[i].key}+`, idea: next, phase: 'designing', replaced: slots[i].idea.name, startedAt: Date.now(), log: [{ text: why, tone: 'note' }, { text: 'Designing the shape…', tone: 'work' }], smallModel: slots[i].smallModel };
    emit();
    return true;
  };
  emit();

  // Each displayed option can use the entire pile, but must have a different occupied shape.
  // Capture the acquired key so failed/mutated drafts release their own lease only.
  const animalOwners=new Map<string,number>(),animalLeases=slots.map(()=>new Map<Build,string>());
  const releaseAnimal=(i:number,build:Build)=>{const key=animalLeases[i].get(build);if(key!==undefined&&animalOwners.get(key)===i)animalOwners.delete(key);animalLeases[i].delete(build);};
  const releaseSlotAnimals=(i:number)=>{for(const build of animalLeases[i].keys())releaseAnimal(i,build);};

  const runSlot = async (i: number, attempt: number): Promise<void> => {
    const idea = slots[i].idea;
    try {
      // The normal app opts into the general empty-state editor. Legacy study
      // routes remain available for their explicit lab/fixture callers only.
      if(mode==='pile'&&opts.editableModel===true){
        if(!opts.wholeViews||!opts.judge)throw Error('Whole-model construction needs four rendered views and an independent reviewer.');
        const a=await buildWholeModel(idea,stock,{signal:opts.signal,minParts:20,views:opts.wholeViews,judge:opts.judge,debug:opts.debug,resume:opts.resume,resumeFeedback:opts.resumeFeedback,
          onCheckpoint:c=>{
            const changed=slots[i].checkpoint?.state.revision!==c.state.revision;
            const b=changed?inspectBench(c.state).build:undefined;
            update(i,{checkpoint:c,...(changed?{preview:b?{...b,name:idea.name,description:'Unfinished generated draft; not reviewed instructions.'}:undefined}:{}),
              stats:{parts:c.state.pieces.length,clean:true,wholeModel:true,unused:Object.values(stock).reduce((a,b)=>a+b,0)-c.state.pieces.length}});
          },
          onProgress:e=>update(i,{phase:e.phase},{text:e.text,tone:'work'})});
        if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
        const stats:ShapeStats={parts:partCount(a.build),clean:true,wholeModel:true,appearanceRevised:a.revisions>0,decisions:a.decisions,unused:a.unused};
        if(!recognized(a.verdict)){
          update(i,{phase:'failed',unrecognized:true,build:a.build,instructionsReady:true,verdict:a.verdict,stats,craftReview:a.review,excludedParts:a.excluded},{text:`Draft: the blind reviewer saw “${a.verdict.looksLike}”. The requested subject did not pass recognition. You can still build this draft.`,tone:'note'});return;
        }
        update(i,{phase:'ready',build:a.build,instructionsReady:true,verdict:a.verdict,stats,craftReview:a.review,excludedParts:a.excluded,smallModel:partCount(a.build)<MIN_PILE_PARTS},
          {text:a.verdict.pass?`Reviewed complete model · ${stats.parts} parts; ${a.unused} left unused`:`Draft: ${a.verdict.fixes.join('; ')}`,tone:a.verdict.pass?'good':'note'});return;
      }
      if(mode==='pile'&&opts.views&&opts.judge&&opts.assemblyFirst!==false&&opts.animalFirst!==false&&animalSubjectKind(idea.name)) {
        const a=await buildAnimalFirst(idea,stock,{signal:opts.signal,minParts:MIN_SMALL_PARTS,views:opts.views,judge:opts.judge,debug:opts.debug,wholeModel:opts.wholeModel===true,
          unavailable:build=>animalOwners.has(animalSilhouetteKey(build)),
          claim:build=>{const key=animalSilhouetteKey(build);if(animalOwners.has(key))return false;animalOwners.set(key,i);animalLeases[i].set(build,key);return true;},
          release:build=>releaseAnimal(i,build),onProgress:text=>update(i,{phase:'building'},{text,tone:'work'})});
        if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
        if(!a)throw Error('The search did not find another complete animal with distinct anatomy in this pile. Try another subject or a shopping list.');
        rememberIdeas(mode,stock,[a.idea]);
        update(i,{idea:a.idea,requestedName:a.requestedName,replaced:a.idea.name!==a.requestedName?a.requestedName:slots[i].replaced,
          program:undefined,featurePlan:undefined,features:a.features,smallModel:small||partCount(a.build)<MIN_PILE_PARTS},
          {text:`Design targets: ${a.traits.join('; ')}`,tone:'note'});
        if(a.build.source?.kind==='library')update(i,{}, {text:'From the Spill library; selected and reviewed for your pile.',tone:'note'});
        const stats:ShapeStats={parts:partCount(a.build),clean:true,assemblyFirst:true,assemblyFamily:'animal',appearanceRevised:a.revised};
        if(!recognized(a.verdict)) {
          releaseAnimal(i,a.composition.build);
          const why=`The reviewer saw “${a.verdict.looksLike}”, not ${a.idea.name}`;
          if(attempt===0&&stepIn(i,`${why}, so another idea steps in.`))return runSlot(i,1);
          update(i,{phase:'failed',unrecognized:true,verdict:a.verdict,stats},{text:`${why}, so it isn't shown.`,tone:'bad'});return;
        }
        update(i,{phase:'ready',build:a.build,verdict:a.verdict,stats},
          {text:`Reviewer saw “${a.verdict.looksLike}” · ${a.verdict.recognizable}/${a.verdict.complete}/${a.verdict.colors}/${a.verdict.impressive}`,tone:a.verdict.pass?'good':'note'});return;
      }
      if(mode==='pile' && opts.views && opts.judge && opts.assemblyFirst!==false) {
        const a=await buildAssemblyFirst(idea,stock,{signal:opts.signal,minParts:MIN_SMALL_PARTS,views:opts.views,judge:opts.judge,debug:opts.debug,
          onProgress:text=>update(i,{phase:'building'},{text,tone:'work'})});
        if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
        if(a) {
          update(i,{features:a.features,smallModel:small||partCount(a.build)<MIN_PILE_PARTS},{text:'Design targets: long thin wings; separated floats; clear cockpit and twin-boom tail',tone:'note'});
          const stats:ShapeStats={parts:partCount(a.build),clean:true,assemblyFirst:true,assemblyFamily:'aircraft',appearanceRevised:a.revised};
          if(!recognized(a.verdict)) {
            const why=`The reviewer saw “${a.verdict.looksLike}”, not ${idea.name}`;
            if(attempt===0 && stepIn(i,`${why}, so another idea steps in.`))return runSlot(i,1);
            update(i,{phase:'failed',unrecognized:true,verdict:a.verdict,stats},{text:`${why}, so it isn't shown.`,tone:'bad'});return;
          }
          update(i,{phase:'ready',build:a.build,verdict:a.verdict,stats},
            {text:`Reviewer saw “${a.verdict.looksLike}” · ${a.verdict.recognizable}/${a.verdict.complete}/${a.verdict.colors}/${a.verdict.impressive}`,tone:a.verdict.pass?'good':'note'});return;
        }
      }
      if(mode==='pile' && small && opts.views && opts.judge && opts.featureFirst!==false) {
        const f=await buildFeatureFirst(idea,stock,{signal:opts.signal,minParts:floor,views:opts.views,judge:opts.judge,debug:opts.debug,
          onProgress:text=>update(i,{phase:'building'},{text,tone:'work'})});
        if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
        if(f) {
          update(i,{features:[f.feature],featurePlan:f.plan},{text:`Design targets: ${f.plan.traits.join('; ')}`,tone:'note'});
          if(!recognized(f.verdict)) {
            const why=`The reviewer saw “${f.verdict.looksLike}”, not ${idea.name}`;
            if(attempt===0 && stepIn(i,`${why}, so another idea steps in.`))return runSlot(i,1);
            update(i,{phase:'failed',unrecognized:true,verdict:f.verdict,stats:{parts:f.build.steps.flatMap(s=>s.parts).length,clean:true,featureFirst:true}},{text:`${why}, so it isn't shown.`,tone:'bad'});return;
          }
          // No voxel-fit percentages are claimed for a directly assembled object.
          update(i,{phase:'ready',build:f.build,verdict:f.verdict,stats:{parts:partCount(f.build),clean:true,featureFirst:true,appearanceRevised:f.revised}},
            {text:`Reviewer saw “${f.verdict.looksLike}” · ${f.verdict.recognizable}/${f.verdict.complete}/${f.verdict.colors}/${f.verdict.impressive}`,tone:f.verdict.pass?'good':'note'});return;
        }
        update(i,{}, {text:'No matching complete feature assembly fits this idea; trying a shape design.',tone:'note'});
      }
      const d = await designIdea(idea, mode, stock, opts.signal);
      update(i, { program: d.program, phase: 'building' }, { text: `Shape: ${d.program.pieces.length} volumes, ${d.program.length} × ${d.program.width} × ${d.program.height} studs (${Math.round(d.seconds)}s)`, tone: 'good' });
      if (mode === 'pile') {
        let f = await fitInWorker('pile', d.program, stock, opts.signal, floor), program = d.program;
        update(i, {}, { text: trialLine(f, floor), tone: f.best.clean ? 'good' : 'note' });
        if (!(f.best.clean && f.best.fit >= 0.7)) {
          update(i, { phase: 'revising' }, { text: 'Revising the design to fit your colors…', tone: 'work' });
          const r = await reviseDesign(d.contents, trialReport(d.program, f.full, f.best.clean ? f.best.fit : null, small), d.schemaColors, opts.signal);
          const f2 = await fitInWorker('pile', r.program, stock, opts.signal, floor);
          const better = (f2.best.clean && !f.best.clean) || (f2.best.clean === f.best.clean && f2.best.s.parts > f.best.s.parts);
          update(i, { phase: 'building' }, { text: `Revision: ${trialLine(f2, floor)}${better ? '' : ' (kept the first version)'}`, tone: f2.best.clean ? 'good' : 'note' });
          if (better) { f = f2; program = r.program; }
        }
        if (!f.best.clean && attempt === 0 && stepIn(i, `${idea.name} can't be built ${tooSmall(f, floor) ? 'big enough' : 'cleanly'} from your pile, so another idea steps in.`)) return runSlot(i, 1);
        if (small) {
          // A small model is shown only when it's clean and the blind reviewer can tell what it is: patched-color drafts
          // were never recognized, so they aren't reviewed.
          if (!f.best.clean || !opts.judge) {
            update(i, { phase: 'failed', tooSmall: true }, { text: tooSmall(f, floor) ? `Your pile makes ${idea.name} too small to read as itself.` : `Your pile can't make ${idea.name} in its own colors.`, tone: 'bad' });
            return;
          }
          const s = f.best.s;
          update(i, { phase: 'judging', program }, { text: `${s.parts} parts, all from your pile · ${pct(s.onPalette)} in its own colors`, tone: 'good' });
          update(i, {}, { text: 'Blind review: shown only if the reviewer can tell what it is…', tone: 'work' });
          let build=f.best.build, v = await opts.judge(build, idea,opts.signal), revised=false;
          if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
          if(opts.views && opts.appearance!==false && !v.pass) {
            const r=await refineAppearance(build,v,idea,stock,{signal:opts.signal,minParts:floor,views:opts.views,judge:opts.judge,debug:opts.debug,
              onProgress:text=>update(i,{phase:'revising'},{text,tone:'work'})});
            build=r.build;v=r.verdict;revised=r.improved;
            update(i,{features:r.edit?.receipts},{text:r.reason,tone:r.improved?'good':'note'});
          }
          if (!recognized(v)) {
            const why = `The reviewer saw “${v.looksLike}”, not ${idea.name}`;
            if (attempt === 0 && stepIn(i, `${why}, so another idea steps in.`)) return runSlot(i, 1);
            update(i, { phase: 'failed', unrecognized:true, verdict: v,stats:{parts:build.steps.flatMap(s=>s.parts).length,clean:true} }, { text: `${why}, so it isn't shown.`, tone: 'bad' });
            return;
          }
          update(i, { phase: 'ready', build, verdict: v, stats: { parts: build.steps.flatMap(s=>s.parts).length, onPalette: s.onPalette, holes: s.visibleHoles, symmetry: s.colorSymmetry, fit: f.best.fit, clean: true, appearanceRevised:revised } },
            { text: `Reviewer saw “${v.looksLike}” · ${v.recognizable}/${v.complete}/${v.colors}/${v.impressive}`, tone: 'good' });
          return;
        }
        if (f.best.s.parts < MIN_PILE_PARTS) {
          update(i, { phase: 'failed', tooSmall: true }, { text: `Your pile makes ${idea.name} too small to read as itself.`, tone: 'bad' });
          return;
        }
        const s = f.best.s;
        update(i, { build: f.best.build, program, stats: { parts: s.parts, onPalette: s.onPalette, holes: s.visibleHoles, symmetry: s.colorSymmetry, fit: f.best.fit, clean: f.best.clean } },
          { text: `${s.parts} parts, all from your pile · ${pct(s.onPalette)} in its own colors`, tone: 'good' });
      } else {
        const r = await fitInWorker('shopping', d.program, stock, opts.signal);
        update(i, { build: r.build, stats: { parts: r.s.parts, onPalette: r.s.onPalette, holes: r.s.visibleHoles, symmetry: r.s.colorSymmetry, fit: 1, clean: true, toGet: r.toGet, fromPile: r.fromPile } },
          { text: `${r.s.parts} parts: ${r.fromPile} from your pile, ${r.toGet} to get`, tone: 'good' });
      }
      if (opts.judge && slots[i].build) {
        update(i, { phase: 'judging' }, { text: 'Blind review…', tone: 'work' });
        let v = await opts.judge(slots[i].build!, idea,opts.signal);
        if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
        if(mode==='pile' && slots[i].stats?.clean && opts.views && opts.appearance!==false && !v.pass) {
          const r=await refineAppearance(slots[i].build!,v,idea,stock,{signal:opts.signal,minParts:floor,views:opts.views,judge:opts.judge,debug:opts.debug,
            onProgress:text=>update(i,{phase:'revising'},{text,tone:'work'})});
          v=r.verdict;
          if(r.improved)update(i,{build:r.build,features:r.edit?.receipts,stats:{...slots[i].stats!,parts:r.build.steps.flatMap(s=>s.parts).length,appearanceRevised:true}});
          update(i,{}, {text:r.reason,tone:r.improved?'good':'note'});
        }
        update(i, { phase: 'ready', verdict: v }, { text: `Reviewer saw “${v.looksLike}” · ${v.recognizable}/${v.complete}/${v.colors}/${v.impressive}`, tone: v.pass ? 'good' : 'note' });
      } else update(i, { phase: 'ready' });
    } catch (e) {
      releaseSlotAnimals(i);
      if ((e as Error).name === 'AbortError' || opts.signal?.aborted) return;
      if(mode==='pile'&&opts.editableModel===true){update(i,{phase:'failed'},{text:`Original-model construction stopped: ${(e as Error).message}`,tone:'bad'});return;}
      if (attempt === 0 && stepIn(i, `${idea.name} hit a problem (${(e as Error).message}), so another idea steps in.`)) return runSlot(i, 1);
      update(i, { phase: 'failed' }, { text: (e as Error).message, tone: 'bad' });
    }
  };
  await Promise.all(slots.map((_, i) => runSlot(i, 0)));
  return { slots, small: reach && slots.every(s => s.tooSmall) ? reach : undefined };
}
