import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { COLORS, type Build, type ColorName } from '../lib/bricks';
import { colorsOf, openCatalog, passes, type BuildEvent, type Idea, type Mode, type Verdict } from '../lib/gemini';
import { BuildViewer } from '../lib/render';
import { Arrow } from '../components/Icons';
import { RequestBar } from '../components/RequestBar';
import { PartsList } from '../components/PartsList';
import { shoppingList } from '../lib/catalog';
import { BuildLibrary } from '../components/BuildLibrary';
import type { LibraryEntry } from '../lib/library';
import type { LibraryState } from '../hooks/useBuildLibrary';
import { finishedSizeIssue } from '../lib/finished-build';
import { SHAPE_TABS, ShapeSection, type ShapeTabState } from '../components/ShapeCards';
import type { ShapeIdea, ShapeMode } from '../lib/shape-first/pipeline';
import type {StockEvidence} from '../lib/shape-first/stock-evidence';
import type {ShapeSlot} from '../lib/shape-first/run';
import type {WholeModelCheckpoint} from '../lib/shape-first/whole-model-checkpoint';

/** The shape-first tabs' state and actions; when absent, the bucket tab uses the classic AI designs. */
export interface ShapeTabs { pile: ShapeTabState; shopping: ShapeTabState; onStart: (mode: ShapeMode) => void; onDifferent: (mode: ShapeMode) => void; onStop?:(mode:ShapeMode)=>void; onResume?:(mode:ShapeMode,slot:ShapeSlot)=>void; onOpen: (build: Build, mode: ShapeMode,draft?:boolean) => void; onChoose?: (mode:ShapeMode,idea:ShapeIdea)=>void;stockEvidence?:StockEvidence }
export type Collection = 'bucket' | 'shopping' | 'display';

const DisplayLibrary = lazy(() => import('../components/DisplayLibrary'));
const IdeaAtlas=lazy(()=>import('../components/IdeaAtlas').then(m=>({default:m.IdeaAtlas})));

export interface LogLine { text: string; tone: 'work' | 'bad' | 'good' | 'note'; t: number }
export interface Card {
  idea: Idea;
  phase: 'queued' | 'designing' | 'checking' | 'fixing' | 'looking' | 'judging' | 'ready' | 'failed';
  /** 'first' while getting a version that holds together; 'review' while improving it from renders. */
  stage: 'first' | 'review';
  log: LogLine[]; startedAt: number; rounds: number;
  preview?: Build; build?: Build; partsUsed?: number; improved?: boolean;
  /** The quality judge's last scores; failed reviews remain drafts. */
  verdict?: Verdict;
  /** Includes critical-feature gates beyond the independent blind scores. */
  craftPass?:boolean;
  /** Set only after a whole-model result passes native construction checks. */
  instructionsReady?:boolean;
  checkpoint?:WholeModelCheckpoint;
  /** Typed requests are tracked by key rather than position. */
  key?: string;
}

/** Defensive handling for an older or externally restored ready card below the current standard. */
export const weak = (c: Card) => c.phase === 'ready' && (c.craftPass===false || (!!c.verdict && !passes(c.verdict)) || (!!c.build && !!finishedSizeIssue(c.build)));

export const newCard = (idea: Idea): Card => ({ idea, phase: 'queued', stage: 'first', log: [], startedAt: Date.now(), rounds: 0 });

/** Fold one pipeline event into a card's state and its workbench log. */
export function reduceCard(c: Card, e: BuildEvent, totalInBucket: number): Card {
  const t = Math.round((Date.now() - c.startedAt) / 1000);
  const add = (text: string, tone: LogLine['tone']) => [...c.log, { text, tone, t }];
  switch (e.phase) {
    case 'planning':
      return { ...c, phase: 'designing', log: add('Planning the silhouette, details and colors…', 'work') };
    case 'planned':
      return { ...c, log: add(e.reserved ? `Set aside ${e.reserved} pieces for ${e.features.join(', ')}` : 'Feature and color plan ready', 'note') };
    case 'compared':
      return { ...c, log: add(`${e.selected === 'refinement' ? '✓ Kept the refinement' : 'Kept the original'} after comparing both: ${e.reason}`, e.selected === 'refinement' ? 'good' : 'note') };
    case 'designing':
      return e.round === 0
        ? { ...c, phase: 'designing', log: add('Designing…', 'work') }
        : { ...c, phase: 'fixing', rounds: c.stage === 'first' ? e.round : c.rounds, log: add(`Fixing · round ${e.round}…`, 'work') };
    case 'checking':
      return { ...c, phase: 'checking', log: add(`Checking ${e.parts} parts…`, 'work') };
    case 'issues': {
      const log = add(`✗ ${e.summary}`, 'bad');
      if (e.sabotaged) log.push({ text: 'Test mode: one part was knocked loose on purpose', tone: 'note', t });
      return { ...c, log };
    }
    case 'silhouettePlanned':
      return { ...c, log: add('Drawing the target silhouette before fitting pieces…', 'work') };
    case 'silhouetteLocked':
      return { ...c, log: add(e.restored ? 'Restored the target for the stronger draft' : 'Silhouette chosen. Now fitting the available pieces to it…', 'note') };
    case 'silhouetteFitted':
      return { ...c, log: add(`Target outline match: front ${Math.round(e.fit.front*100)}%, side ${Math.round(e.fit.side*100)}%`, 'note') };
    case 'bodyPlanned':
      return { ...c, log: add(`Checked ${e.candidates} complete body plans. ${e.description}`, 'note') };
    case 'connectionsFitted':
      return { ...c, log: add(`Adjusted ${e.changed} attachments to avoid intersections; all proposed pieces retained`, 'note') };
    case 'settled':
      return { ...c, log: add(`Snapped ${e.moved} ${e.moved === 1 ? 'part' : 'parts'} onto the nearest studs`, 'note') };
    case 'trimmed':
      return { ...c, log: add(`Removed ${e.removed} ${e.removed === 1 ? 'part' : 'parts'} the fixes couldn't place`, 'note') };
    case 'preview':
      return { ...c, stage: 'review', preview: e.build, partsUsed: e.partsUsed, log: add(`✓ ${e.build.engine==='connections-v2'?'Connections checked':'First version stands on its own'} · ${e.partsUsed} parts`, 'good') };
    case 'colorcheck':
      return e.when === 'before'
        ? { ...c, log: add(e.patches ? `Color check: ${e.patches} stray ${e.patches === 1 ? 'color' : 'colors'} on the outside` : 'Color check: outside colors are consistent', e.patches ? 'bad' : 'good') }
        : { ...c, log: add(e.patches ? `Color check after: ${e.patches} stray ${e.patches === 1 ? 'color' : 'colors'} left (no spare parts to match)` : 'Color check after: outside colors are consistent, apart from deliberate details', e.patches ? 'note' : 'good') };
    case 'matched':
      return { ...c, log: add(`Matched ${e.count} more outside ${e.count === 1 ? 'part' : 'parts'} to their area's color (same-size swaps, re-checked)`, 'good') };
    case 'looking':
      return { ...c, phase: 'looking', log: add('Looking at it from three angles…', 'work') };
    case 'improving':
      return { ...c, log: add(e.changes.length ? `Improving: ${e.changes.join(' · ')}` : 'Improving it…', 'work') };
    case 'kept':
      return { ...c, log: add(e.reason, 'note') };
    case 'judging':
      return { ...c, phase: 'judging', log: add('Quality check: identifying the model without its name…', 'work') };
    case 'judged': {
      const v = e.verdict;
      const scores = `recognizable ${v.recognizable} · complete ${v.complete} · colors ${v.colors} · impressive ${v.impressive}`;
      return { ...c, verdict: v, log: add(`${e.pass ? '✓ Passed' : '✗ Not yet'}: looks like “${v.looksLike}” · ${scores}${e.pass ? '' : ` · fixing: ${v.fixes.join(' · ')}`}`, e.pass ? 'good' : 'bad') };
    }
    case 'rebuilding':
      return { ...c, phase: 'designing', log: add(`Revising with the reviewer's notes · round ${e.round} of ${e.of}…`, 'work') };
    case 'rebuilt':
      return { ...c, preview: e.build, partsUsed: e.partsUsed, log: add(`✓ Rebuilt version stands on its own · ${e.partsUsed} parts`, 'good') };
    case 'ready': {
      const verdict = e.verdict ?? c.verdict;
      const issue = finishedSizeIssue(e.build) ?? (verdict && !passes(verdict) ? 'This draft still needs improvement after visual review.' : undefined);
      if (issue) return { ...c, phase: 'failed', preview: e.build, build: undefined, partsUsed: e.partsUsed, verdict, log: add(issue, 'bad') };
      const uses = openCatalog(c.idea.mode) ? `${e.partsUsed} parts` : `uses ${e.partsUsed} of your ${totalInBucket} parts`;
      const text = e.improved ? `✓ Improved version stands on its own · ${uses}` : `✓ Stands on its own · ${uses}`;
      return { ...c, phase: 'ready', build: e.build, partsUsed: e.partsUsed, improved: e.improved, verdict: e.verdict ?? c.verdict, log: add(text, 'good') };
    }
    case 'failed':
      return { ...c, phase: 'failed', log: add(e.reason, 'bad') };
    case 'blueprinting':
      return { ...c, phase: 'designing', log: add('Drawing up the blueprint…', 'work') };
    case 'blueprint':
      return { ...c, log: add(`Blueprint: ${e.size}, ${e.sections} sections, ~${e.parts} parts`, 'good') };
    case 'section':
      return { ...c, phase: 'designing', log: add(`Section ${e.index + 1} of ${e.total}: ${e.name}…`, 'work') };
    case 'sectionDone':
      return {
        ...c, preview: e.build, partsUsed: e.partsUsed,
        log: add(`✓ ${e.name} built · ${e.partsUsed} parts so far${e.dropped ? ` (left out ${e.dropped} that wouldn't fit)` : ''}`, 'good'),
      };
  }
}

export const MODE_LABEL: Record<Mode, string> = { bucket: 'from your bucket', accurate: 'most accurate', super: 'super fidelity' };

const PHASE_WORD: Record<Card['phase'], string> = {
  queued: 'Queued', designing: 'Designing', checking: 'Checking', fixing: 'Fixing', looking: 'Looking', judging: 'Judging', ready: '', failed: '',
};

function Art({ build }: { build: Build }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const v = new BuildViewer(ref.current!, { turntable: true });
    v.setBuild(build);
    v.showStep(1e9, false);
    return () => v.dispose();
  }, [build]);
  return <canvas ref={ref} aria-label={`3D preview of ${build.name}`} />;
}

/** Three bricks stacking on a loop while Gemini works; they shake when the checker sends it back. */
function Stacker({ phase }: { phase: Card['phase'] }) {
  return (
    <div className={`stacker ${phase}`} aria-hidden>
      <i style={{ background: 'var(--b1)' }} /><i style={{ background: 'var(--b2)' }} /><i style={{ background: 'var(--b3)' }} />
    </div>
  );
}

function useNow(on: boolean) {
  const [now, set] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => set(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

function BuildCard({ card, replaced, onOpen, onRetry, onRemix, bucket }: { card: Card; replaced?: string; onOpen: () => void; onRetry: () => void; onRemix?: () => void; bucket?: Record<string, number> }) {
  const [listOpen, setListOpen] = useState(false);
  const accurate = openCatalog(card.idea.mode);
  const need = accurate && card.build && bucket ? shoppingList(card.build, bucket) : null;
  const working = !['ready', 'failed'].includes(card.phase);
  const canBuild=!!card.build&&!working&&!finishedSizeIssue(card.build)&&(card.instructionsReady||(card.phase==='ready'&&!weak(card)));
  const draft=card.phase==='failed'||weak(card);
  const now = useNow(working);
  const shown = card.build ?? card.preview;
  const steps = shown?.steps.length;
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, card.log.length - 7);
  return (
    <article className="card fade-in">
      <div className="card-art">
        {shown ? <Art build={shown} /> : (
          <div className="working">
            {working && <Stacker phase={card.phase} />}
            <div className="phase">{working ? PHASE_WORD[card.phase] : 'No luck'}</div>
            {working && <div className="clock">{Math.round((now - card.startedAt) / 1000)}s</div>}
          </div>
        )}
        {shown && card.phase === 'failed' && <span className="art-chip weak">Draft · needs improvement</span>}
        {shown && working && <span className="art-chip">{card.phase === 'judging' ? 'Judging' : card.stage === 'review' ? 'Improving' : 'Building'}… {Math.round((now - card.startedAt) / 1000)}s</span>}
        {card.phase === 'ready' && (card.verdict
          ? (weak(card) ? <span className="art-chip weak">Draft · needs improvement</span> : <span className="art-chip done">AI review passed</span>)
          : card.improved && <span className="art-chip done">Improved</span>)}
      </div>
      <div className="card-body">
        {replaced && <p className="stepped-in">Stepped in for {replaced}, which didn't pass the checks</p>}
        {card.idea.request && <p className="card-kicker">You asked for “{card.idea.request}” · {MODE_LABEL[card.idea.mode ?? 'bucket']}</p>}
        <h3>{shown?.name || card.idea.name}</h3>
        <p className="pitch">{card.idea.pitch}</p>
        {card.idea.why && <p className="card-why">{card.idea.why}</p>}
        {card.idea.note && <p className="card-note">{card.idea.note}</p>}
        {card.instructionsReady&&draft&&<p className="card-note">Appearance review did not pass{card.verdict?`; the reviewer saw “${card.verdict.looksLike}”`:''}. Parts and instructions are available for this draft.</p>}
        <div className="card-meta">
          <span>{card.partsUsed ?? `~${card.idea.estimatedParts}`} parts</span>
          {!card.idea.request && colorsOf(card.idea).length ? (
            <span className="palette" aria-label={`Colors: ${colorsOf(card.idea).slice(0, 5).map(c => c.replace(/-/g, ' ')).join(', ')}`}>
              {colorsOf(card.idea).slice(0, 5).map(c => <i key={c} style={{ background: COLORS[c as ColorName] }} title={c.replace(/-/g, ' ')} />)}
            </span>
          ) : null}
          {steps ? <span>{steps} steps</span> : null}
          <span className="dots" aria-label={`difficulty ${card.idea.difficulty} of 3`}>
            {'●'.repeat(Math.min(3, card.idea.difficulty))}{'○'.repeat(Math.max(0, 3 - card.idea.difficulty))}
          </span>
        </div>
        <ol className="log">
          {hidden > 0 && <li className="more"><button className="linkbtn" onClick={() => setAll(true)}>Show all {card.log.length} lines</button></li>}
          {card.log.map((l, i) => {
            if (i < hidden) return null;
            const live = working && i === card.log.length - 1;
            return (
              <li key={i} className={l.tone}>
                <span>{l.text}</span>
                <span className="t">{live ? Math.round((now - card.startedAt) / 1000) : l.t}s</span>
              </li>
            );
          })}
        </ol>
        {need && <p className="card-need">{need.getCount ? `Uses ${need.haveCount} of your parts + ${need.getCount} to get` : 'Your bucket has every part'}</p>}
        {canBuild && (
          <div className="card-actions">
            {(need||(card.instructionsReady&&bucket)) && <button className="btn" onClick={() => setListOpen(true)}>Parts list</button>}
            {onRemix && !need && card.build?.engine!=='connections-v2' && <button className="btn" onClick={onRemix} title="Open it on the workbench and change it, with the builder suggesting moves">Remix this</button>}
            <button className="btn primary" onClick={onOpen}>{draft?'Build this draft':'Build this'} <Arrow /></button>
          </div>
        )}
        {listOpen && card.build && bucket && <PartsList build={card.build} bucket={bucket} onClose={() => setListOpen(false)} />}
        {card.phase === 'failed' && <button className="btn" onClick={onRetry}>{card.checkpoint?'Continue this model':'Try again'}</button>}
      </div>
    </article>
  );
}

export interface Slot { card: Card; index: number; replaced?: string }

/**
 * Three visible slots over a larger pool of candidates. A slot keeps its own candidate while that one is
 * alive; when it fails, the next backup takes its slot. Once enough candidates have finished successfully,
 * show those immediately so a slow primary candidate cannot hold up three checked results.
 */
export function assignSlots(cands: Card[], visible = 3): Slot[] {
  const finished = cands.flatMap((card, index) => card.phase === 'ready' && !weak(card) ? [{ card, index }] : []);
  if (finished.length >= visible) {
    const backups = finished.filter(s => s.index >= visible);
    return cands.slice(0, visible).map((card, index) => {
      if (card.phase === 'ready' && !weak(card)) return { card, index };
      return { ...backups.shift()!, replaced: card.phase === 'failed' || weak(card) ? card.idea.name : undefined };
    });
  }
  // ok = still working, or ready and good; weak = ready but below the quality bar; failed = couldn't stand up
  const status = (i: number) => (cands[i].phase === 'failed' ? 'failed' : weak(cands[i]) ? 'weak' : 'ok');
  const used = new Set<number>();
  const backup = (want: string) => {
    for (let j = visible; j < cands.length; j++) if (!used.has(j) && status(j) === want) { used.add(j); return j; }
    return -1;
  };
  return cands.slice(0, visible).map((c, k) => {
    if (status(k) === 'ok') return { card: c, index: k };
    // a backup that's working or good takes the slot; a failed slot would rather show a weak backup than nothing
    let j = backup('ok');
    if (j < 0 && status(k) === 'failed') j = backup('weak');
    return j < 0 ? { card: c, index: k } : { card: cands[j], index: j, replaced: c.idea.name };
  });
}

export type IdeasState = { status: 'idle' | 'loading' | 'done' | 'error'; error?: string };

export function Builds({ slots, tried, ideasState, requests, bucket, library, libraryState, libraryNotice, onOpenLibrary, onOpen, onRetry, onRetryIdeas, onRequest, onOpenRequest, onRetryRequest, onSuggest, onDifferent, onDecisions, onBench, collection = 'bucket', onCollection, onOpenDisplay, shape }: {
  slots: Slot[]; tried: number; ideasState: IdeasState; requests: Card[]; bucket: Record<string, number>;
  library: LibraryEntry[]; libraryState?: LibraryState; libraryNotice?: string; onOpenLibrary: (build: Build) => void;
  onOpen: (i: number) => void; onRetry: (i: number) => void; onRetryIdeas: () => void;
  onRequest: (text: string) => void; onOpenRequest: (key: string) => void; onRetryRequest: (key: string) => void; onSuggest: () => void; onDifferent: () => void; onDecisions?: () => void;
  /** Open the workbench: empty, or with a finished build to remix. */
  onBench: (build?: Build, goal?: string) => void;
  collection?: Collection; onCollection?: (collection: Collection) => void; onOpenDisplay?: (build: Build) => void;
  shape?: ShapeTabs;
}) {
  const suggesting = ideasState.status !== 'idle';
  return (
    <main className="builds">
      <div className="builds-head">
        <h2>{collection === 'display' ? 'Detailed models, any parts.' : collection === 'shopping' ? 'Builds with a shopping list' : shape ? 'Builds from your pile' : 'Builds from your bucket'}</h2>
        <span className="meta">{collection === 'display' ? 'Choose the model first. The parts list comes with it.' : collection === 'shopping' ? SHAPE_TABS.shopping.intro : 'Start with a library design that fits your pieces, or ask the builder for something new.'}</span>
      </div>
      {onCollection && (shape
        ? <div className="collection-switch" role="group" aria-label="Build collection">
            <button className="btn" aria-pressed={collection === 'bucket'} onClick={() => onCollection('bucket')}>{SHAPE_TABS.pile.label}</button>
            <button className="btn" aria-pressed={collection === 'shopping'} onClick={() => onCollection('shopping')}>{SHAPE_TABS.shopping.label}</button>
            <button className="btn" aria-pressed={collection === 'display'} onClick={() => onCollection('display')}>Detailed models · any parts</button>
          </div>
        : <div className="collection-switch" role="group" aria-label="Build collection"><button className="btn" aria-pressed={collection === 'bucket'} onClick={() => onCollection('bucket')}>From your bucket</button><button className="btn" aria-pressed={collection === 'display'} onClick={() => onCollection('display')}>Detailed models · any parts</button></div>)}
      {collection === 'display' ? <Suspense fallback={<p role="status">Opening the display collection…</p>}><DisplayLibrary onOpen={onOpenDisplay ?? onOpenLibrary} /></Suspense>
      : collection === 'shopping' && shape ? (
        <>
          {shape.onChoose&&<Suspense fallback={<p role="status">Opening the idea catalog…</p>}><IdeaAtlas stock={bucket} evidence={shape.stockEvidence} mode="shopping" busy={shape.shopping.status==='running'} onChoose={idea=>shape.onChoose!('shopping',idea)} onOpen={b=>shape.onOpen(b,'shopping')} /></Suspense>}
          <ShapeSection mode="shopping" state={shape.shopping} bucket={bucket} startLabel={SHAPE_TABS.shopping.start}
            onStart={() => shape.onStart('shopping')} onStop={shape.onStop&&(()=>shape.onStop!('shopping'))} onDifferent={() => shape.onDifferent('shopping')} onOpen={(build,draft) => shape.onOpen(build, 'shopping',draft)} />
        </>
      ) : <>
      {shape?.onChoose&&<Suspense fallback={<p role="status">Opening the idea catalog…</p>}><IdeaAtlas stock={bucket} evidence={shape.stockEvidence} mode="pile" busy={shape.pile.status==='running'} onChoose={idea=>shape.onChoose!('pile',idea)} onOpen={b=>shape.onOpen(b,'pile')} /></Suspense>}
      <BuildLibrary loading={libraryState?.loading} completed={libraryState?.completed} total={libraryState?.total} error={libraryState?.error} notice={libraryNotice} entries={library} bucket={bucket} onOpen={onOpenLibrary} onRemix={build => onBench(build, build.name)} />
      <RequestBar onSubmit={onRequest} />
      <div className="bench-cta">
        <span className="meta">Or build it yourself in 3D from your parts, with the builder suggesting moves as you go.</span>
        <button className="btn" onClick={() => onBench()}>Build it yourself <Arrow /></button>
      </div>

      {requests.length > 0 && <>
        <div className="section-title">Your requests</div>
        <div className="cards">
          {requests.map(c => <BuildCard key={c.key} card={c} bucket={bucket} onOpen={() => onOpenRequest(c.key!)} onRetry={() => onRetryRequest(c.key!)} />)}
        </div>
      </>}

      {shape ? <>
        <div className="section-title">New AI designs</div>
        <p className="meta shape-intro">{SHAPE_TABS.pile.intro}</p>
        <ShapeSection mode="pile" state={shape.pile} bucket={bucket} startLabel="Explore new AI designs"
          onStart={() => shape.onStart('pile')} onStop={shape.onStop&&(()=>shape.onStop!('pile'))} onResume={shape.onResume&&(s=>shape.onResume!('pile',s))} onDifferent={() => shape.onDifferent('pile')} onOpen={(build,draft) => shape.onOpen(build, 'pile',draft)}
          onShopping={onCollection && (() => { onCollection('shopping'); if (shape.shopping.status === 'idle') shape.onStart('shopping'); window.scrollTo({ top: 0 }); })} />
      </> : suggesting ? <>
        <div className="section-title row">
          <span>New AI designs{tried > 3 ? ` · trying ${tried} ideas, showing 3` : ''}</span>
          <span className="grow" />
          {onDecisions && <button className="linkbtn" onClick={onDecisions}>How it decided</button>}
          {ideasState.status === 'done' && <button className="linkbtn" onClick={onDifferent}>Suggest different builds</button>}
        </div>
        {ideasState.status === 'error' && (
          <div className="banner"><span>Couldn't get ideas: {ideasState.error}</span><button className="btn" onClick={onRetryIdeas}>Try again</button></div>
        )}
        <div className="cards">
          {ideasState.status === 'loading' && [0, 1, 2].map(i => (
            <article className="card" key={i}>
              <div className="card-art"><div className="working"><Stacker phase="designing" /><div className="phase">Thinking</div></div></div>
              <div className="card-body"><h3 style={{ color: 'var(--rule)' }}>Reading your parts…</h3></div>
            </article>
          ))}
          {slots.map(s => <BuildCard key={s.index} card={s.card} replaced={s.replaced} onOpen={() => onOpen(s.index)} onRetry={() => onRetry(s.index)} onRemix={s.card.build ? () => onBench(s.card.build, s.card.idea.name) : undefined} />)}
        </div>
      </> : (
        <button className="btn suggest-more" onClick={onSuggest}>Explore new AI designs <Arrow /></button>
      )}
      </>}
    </main>
  );
}
