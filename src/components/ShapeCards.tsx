import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, partCount, type Build, type ColorName } from '../lib/bricks';
import { BuildViewer, renderViews } from '../lib/render';
import { judgeBuild, passes, type Idea } from '../lib/gemini';
import { MIN_PILE_PARTS, MIN_SMALL_CELLS, MIN_SMALL_PARTS, pileReach, smallPile, type PileReach, type RankedIdea, type ShapeMode } from '../lib/shape-first/pipeline';
import type { ShapeSlot, ShapeVerdict } from '../lib/shape-first/run';
import { PartsList } from './PartsList';
import { Arrow } from './Icons';
import './shape-cards.css';

/** Labels and copy for the two shape-first tabs, shared by the main Builds screen and the standalone page. */
export const SHAPE_TABS: Record<ShapeMode, { label: string; intro: string; start: string }> = {
  pile: { label: 'Only your pile', intro: 'Every part comes from your pile. The builder creates each model from scratch, revises its shape using real previews, and checks its defining features before an independent review.', start: 'Find builds from your pile' },
  shopping: { label: 'With a shopping list', intro: 'Bigger models in their true colors. They start from your pile, and the parts list shows exactly what to get.', start: 'Find builds with a shopping list' },
};

/** One tab's shape-first builds: idle → running (cards fill in) → done or error. `small`: the pile is too small for a sculpture. */
export type ShapeTabState = { status: 'idle' | 'running' | 'done' | 'error'; slots: ShapeSlot[]; error?: string; small?: PileReach;startedAt?:number;statusLine?:string };
export const SHAPE_IDLE: ShapeTabState = { status: 'idle', slots: [] };

/** The app's blind review, unchanged, for a shape-first build. */
export async function reviewShape(build: Build, idea: RankedIdea, total: number, signal?: AbortSignal): Promise<ShapeVerdict> {
  const asIdea: Idea = { name: idea.name, pitch: idea.pitch, estimatedParts: partCount(build), difficulty: 2, keyParts: [] };
  const v = await judgeBuild(asIdea, renderViews(build), partCount(build), total, signal);
  return { looksLike: v.looksLike, recognizable: v.recognizable, complete: v.complete, colors: v.colors, impressive: v.impressive, fixes: v.fixes, pass: passes(v), named: !!(v.named ?? v.subjectMatched) };
}

const PHASE: Record<ShapeSlot['phase'], string> = { designing: 'Designing', building: 'Laying bricks', revising: 'Revising', judging: 'Reviewing', ready: '', failed: 'No luck' };
const pct = (x: number) => `${Math.round(x * 100)}%`;

function useNow(on: boolean) {
  const [now, set] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => set(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

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

export function ShapeCard({ slot, mode, onBuild, onList, onResume }: { slot: ShapeSlot; mode: ShapeMode; onBuild: () => void; onList: () => void; onResume?:()=>void }) {
  const working = !['ready', 'failed'].includes(slot.phase);
  const now = useNow(working);
  const st = slot.stats, v = slot.verdict;
  const shown=slot.build??slot.preview;
  const colors = [...new Set(slot.idea.palette.map(p => p.color))];
  return (
    <article className="card fade-in">
      <div className="card-art">
        {shown ? <Art build={shown} /> : (
          <div className="working">
            <div className="phase">{PHASE[slot.phase]}</div>
            {working && <div className="clock">{Math.round((now - slot.startedAt) / 1000)}s</div>}
          </div>
        )}
        {shown && working && <span className="art-chip">{PHASE[slot.phase]}… {Math.round((now - slot.startedAt) / 1000)}s</span>}
        {shown&&slot.phase==='failed'&&<span className="art-chip weak">{slot.instructionsReady?slot.unrecognized?'Draft · subject not recognized':'Draft · not approved':'Unfinished draft'}</span>}
        {slot.phase === 'ready' && v && (v.pass
          ? <span className="art-chip done">AI review passed</span>
          : slot.smallModel && !st?.wholeModel
            ? <span className="art-chip">Small model · reviewer named it</span>
            : <span className="art-chip weak">Draft · {v.recognizable + v.complete + v.colors + v.impressive}/20</span>)}
      </div>
      <div className="card-body">
        {slot.replaced && <p className="stepped-in">{st?.assemblyFamily==='animal'?'Requested':'Stepped in for'} {slot.replaced}</p>}
        <h3>{slot.build?.name || slot.idea.name}</h3>
        <p className="pitch">{slot.idea.pitch}</p>
        {slot.idea.why && <p className="card-why">{slot.idea.why}</p>}
        {slot.instructionsReady&&slot.unrecognized&&<p className="card-note">The reviewer did not identify the requested subject{v?`; it saw “${v.looksLike}”`:''}. Parts and instructions are available for this draft.</p>}
        <div className="card-meta">
          <span>{st ? `${st.parts} parts` : `${slot.idea.length} × ${slot.idea.width} × ${slot.idea.height} studs`}</span>
          <span className="palette" aria-label={`Colors: ${colors.map(c => c.replace(/-/g, ' ')).join(', ')}`}>
            {colors.map(c => <i key={c} style={{ background: COLORS[c as ColorName] }} title={c.replace(/-/g, ' ')} />)}
          </span>
          {st && mode === 'pile' && <span>{st.stockUnverified?'Saved scan · verify pieces':st.wholeModel ? `Original model · ${st.unused} pieces unused` : st.assemblyFirst ? st.assemblyFamily==='animal'?'Shaped body, head and four legs':'Wings, tail and matched floats' : st.featureFirst ? 'Built around its defining feature' : st.appearanceRevised ? 'Visually revised' : st.onPalette!==undefined ? `${pct(st.onPalette)} true color` : 'From your pile'}</span>}
          {st && mode === 'shopping' && <span>{st.fromPile} yours · {st.toGet} to get</span>}
        </div>
        {!!slot.excludedParts?.length&&<p className="meta">Not supported by the connection catalog; left unused: {slot.excludedParts.join(', ')}.</p>}
        <ol className="log">
          {slot.log.slice(-6).map((l, i) => <li key={i} className={l.tone}><span className="mk">{l.tone === 'good' ? '✓' : l.tone === 'bad' ? '✕' : l.tone === 'work' ? '…' : '·'}</span>{l.text}</li>)}
        </ol>
        {!working&&!v?.pass&&!!slot.checkpoint?.state.pieces.length&&onResume&&<button className="btn" disabled={st?.stockUnverified} title={st?.stockUnverified?'Check your saved scan before continuing the design':undefined} onClick={onResume}>Continue this model</button>}
        {slot.build&&(slot.phase==='ready'||slot.instructionsReady)&& (
          <div className="shape-actions">
            <button className="btn" onClick={onList}>Parts list</button>
            <button className="btn primary" onClick={onBuild}>{v?.pass?'Build it':'Build this draft'}</button>
          </div>
        )}
      </div>
    </article>
  );
}

/** Only your pile, when the pile can't make anything that reads as its subject. */
function SmallPile({ reach, total, tried, smallModels, onShopping, onDifferent }: { reach: PileReach; total: number; tried: boolean; smallModels: boolean; onShopping?: () => void; onDifferent: () => void }) {
  return (
    <div className="shape-small" role="status">
      <h3>Your pile is a bit small for a sculpture</h3>
      <p>
        {reach.parts} of your {total} parts are pieces the builder can use (bricks, plates, tiles, slopes and curves), spread over {reach.colorCount} colors.
        {!tried ? ` Even a small model needs about ${MIN_SMALL_PARTS} of them in two or three colors to look like its subject.`
          : smallModels ? ' The builder tried small models too, and none came out looking like its subject.'
            : ` A sculpture needs about ${MIN_PILE_PARTS} in two or three colors to look like its subject. None of the designs tried here got there.`}
      </p>
      <p>With a shopping list, the builder starts from your pile and lists what to get.</p>
      <div className="shape-actions">
        {onShopping && <button className="btn primary" onClick={onShopping}>See builds with a shopping list <Arrow /></button>}
        {tried && <button className="btn" onClick={onDifferent}>Try other subjects</button>}
      </div>
    </div>
  );
}

/** The cards for one tab, with its start / "different builds" controls and the parts list sheet. */
export function ShapeSection({ mode, state, bucket, startLabel, onStart, onStop, onDifferent, onOpen, onShopping, onResume }: {
  mode: ShapeMode; state: ShapeTabState; bucket: Record<string, number>; startLabel: string;
  onStart: () => void; onDifferent: () => void; onOpen: (build: Build,draft?:boolean) => void;
  onStop?:()=>void;
  onResume?:(slot:ShapeSlot)=>void;
  /** Only your pile: switch to the shopping-list tab (offered when the pile is too small). */
  onShopping?: () => void;
}) {
  const [list, setList] = useState<Build | null>(null);
  const now=useNow(state.status==='running');
  const total = Object.values(bucket).reduce((a, b) => a + b, 0);
  // Only your pile: a pile too small for a sculpture gets small models (the same test the run uses).
  const smallModels = useMemo(() => { if (mode !== 'pile') return false; const r = pileReach(bucket); return r.cells >= MIN_SMALL_CELLS && smallPile(r); }, [mode, bucket]);
  return (
    <>
      {state.status === 'idle' && <button className="btn suggest-more" onClick={onStart}>{startLabel} <Arrow /></button>}
      {state.status === 'running' && !state.slots.length && <p className="meta" role="status">{state.statusLine??'Reading your pile’s colors and choosing subjects…'}{state.startedAt?` · ${Math.max(0,Math.round((now-state.startedAt)/1000))}s`:''}</p>}
      {state.status==='running'&&onStop&&<button className="btn" onClick={onStop}>Stop designing</button>}
      {state.status === 'error' && <div className="banner"><span>Couldn’t finish: {state.error}</span><button className="btn" onClick={onStart}>Try again</button></div>}
      {smallModels && state.status !== 'idle' && !state.small && (
        <div className="shape-note">
          <p>Your pile is too small for a big sculpture, so these are small models built around its special pieces, like slopes, curves and tiles. Models that pass construction checks remain available as drafts when the appearance reviewer cannot identify them.</p>
          {onShopping && <button className="btn" onClick={onShopping}>Bigger builds with a shopping list <Arrow /></button>}
        </div>
      )}
      {state.small && <SmallPile reach={state.small} total={total} tried={state.slots.length > 0} smallModels={smallModels} onShopping={onShopping} onDifferent={onDifferent} />}
      {state.slots.length > 0 && !state.small && (
        <div className="cards shape-cards">
          {state.slots.map(s => <ShapeCard key={s.key} slot={s} mode={mode} onList={() => setList(s.build!)} onBuild={() => onOpen(s.build!,!s.verdict?.pass)} onResume={state.status!=='running'&&onResume?()=>onResume(s):undefined} />)}
        </div>
      )}
      {state.status === 'done' && !state.small && <div className="shape-more"><button className="btn" onClick={onDifferent}>Suggest different builds</button></div>}
      {list && <PartsList build={list} bucket={bucket} onClose={() => setList(null)} />}
    </>
  );
}
