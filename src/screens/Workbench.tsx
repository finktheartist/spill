import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, parsePartId, partCount, placedKey, remaining, type Build, type ColorName, type PartKind } from '../lib/bricks';
import { BenchView, type Hover } from '../lib/bench-view';
import { judgeBuild, passes, suggestMoves, type Direction, type Move, type Verdict } from '../lib/gemini';
import { counts, type Inventory } from '../lib/inventory';
import { partIcon, renderViews } from '../lib/render';
import { FAMILIES, allParts, emptyBench, rotFor, rotsFor, toBooklet, tryPlace, warnings, withoutPart } from '../lib/workbench';
import { shapeName } from '../lib/catalog';

/** How long the builder waits after your last change before it suggests moves. */
const PAUSE_MS = 2500;

/**
 * Build together: you place parts from your own pile on a 24×24 plate in 3D; the builder watches, says what it
 * looks like it's becoming, and suggests next moves you can preview and take. The judge is one click away, and
 * the result becomes a booklet.
 */
export function Workbench({ inv, start, goal: startGoal, onBooklet, onBack, onChange, autoSuggest, debug }: {
  inv: Inventory; start?: Build; goal?: string; onBooklet: (b: Build) => void; onBack: () => void;
  /** Keeps the bench's build and goal outside the screen, so leaving and coming back keeps your work. */
  onChange: (build: Build, goal: string) => void;
  /** Whether the builder suggests on its own when you pause (the sandbox starts with it off). */
  autoSuggest?: boolean;
  /** The sandbox's readout of every placement decision. */
  debug?: boolean;
}) {
  const have = useMemo(() => counts(inv), [inv]);
  const [build, setBuild] = useState<Build>(() => start ?? emptyBench());
  const [past, setPast] = useState<Build[]>([]);
  const [future, setFuture] = useState<Build[]>([]);
  const [hand, setHand] = useState<PartKind | null>(null);
  const [rot, setRot] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [goal, setGoal] = useState(startGoal ?? '');
  const [family, setFamily] = useState(0);
  const [moves, setMoves] = useState<Move[]>([]);
  const [looksLike, setLooksLike] = useState('');
  const [goalFit, setGoalFit] = useState('');
  const [directions, setDirections] = useState<Direction[]>([]);
  const [thinking, setThinking] = useState<'idle' | 'busy' | 'error'>('idle');
  const [auto, setAuto] = useState(autoSuggest ?? true);
  useEffect(() => { if (autoSuggest !== undefined) setAuto(autoSuggest); }, [autoSuggest]);
  const [peek, setPeek] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [judging, setJudging] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<BenchView | null>(null);
  const ask = useRef<AbortController | null>(null);

  useEffect(() => { onChange(build, goal); }, [build, goal, onChange]);
  const left = useMemo(() => remaining(build, have), [build, have]);
  const flagged = useMemo(() => warnings(build, have), [build, have]);
  const total = partCount(build);

  // every change goes through here, so undo always works
  const commit = useCallback((next: Build) => {
    setPast(p => [...p.slice(-80), build]);
    setFuture([]);
    setBuild(next);
    setMoves([]); setPeek(null); setVerdict(null);
  }, [build]);
  const undo = () => { if (!past.length) return; setFuture(f => [build, ...f]); setBuild(past[past.length - 1]); setPast(p => p.slice(0, -1)); setMoves([]); setPeek(null); };
  const redo = () => { if (!future.length) return; setPast(p => [...p, build]); setBuild(future[0]); setFuture(f => f.slice(1)); setMoves([]); setPeek(null); };

  // the 3D view lives as long as the screen
  useEffect(() => {
    const v = new BenchView(canvas.current!);
    view.current = v;
    if (debug) (window as unknown as { __bench?: BenchView }).__bench = v; // the sandbox's tests aim with it
    return () => { v.dispose(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.setBuild(build, flagged); }, [build, flagged]);

  // the part in hand follows the pointer
  const attempt = useMemo(() => (hand && hover && !removing ? tryPlace(build, have, hand, hover.cx, hover.cy, rot, hover.side) : null), [hand, hover, removing, build, have, rot]);
  // R turns the part through the rotations it really has (plain bricks: 0 and 90)
  const turn = useCallback((by = 1) => { if (!hand) return; const rs = rotsFor(hand); setRot(r => rs[(rs.indexOf(rotFor(hand, r)) + by + rs.length) % rs.length]); }, [hand]);
  useEffect(() => { view.current?.setGhost(attempt ? hand : null, attempt?.placed, attempt?.ok); }, [attempt, hand]);

  // a suggested move, shown in place while you hover it
  useEffect(() => {
    const m = peek !== null ? moves[peek] : null;
    if (!m) { view.current?.setPreview([], []); return; }
    const now = new Set(allParts(build).map(placedKey));
    const then = new Set(allParts(m.build).map(placedKey));
    view.current?.setPreview(allParts(m.build).filter(p => !now.has(placedKey(p))), allParts(build).filter(p => !then.has(placedKey(p))));
  }, [peek, moves, build]);

  // clicks on the plate: place, remove, or pick up a part like one you click
  const latest = useRef({ attempt, removing, hand, build, commit });
  latest.current = { attempt, removing, hand, build, commit };
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.onHover = setHover;
    v.onClick = (_h, index, shift) => {
      const s = latest.current;
      if ((s.removing || shift) && index !== null) { s.commit(withoutPart(s.build, index)); return; }
      if (s.hand && s.attempt?.ok) { s.commit(s.attempt.next); return; }
      if (!s.hand && index !== null) {
        const p = allParts(s.build)[index];
        const k = parsePartId(p.partId);
        if (k) { setHand(k); setRot(p.rot); }
      }
    };
  }, []);

  // keys: R rotates, Esc puts the part down, X toggles removing, Cmd/Ctrl+Z undoes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (e.key === 'r' || e.key === 'R') turn(e.shiftKey ? -1 : 1);
      if (e.key === 'Escape') { setHand(null); setRemoving(false); }
      if (e.key === 'x' || e.key === 'X') setRemoving(r => !r);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The builder suggests when you pause (or when asked). Once there are a few parts it sees renders of the build,
  // so it reads the shape the way you see it. `towards` switches the goal (picking one of its other directions).
  const suggest = useCallback(async (hints: string[] = [], towards?: string) => {
    ask.current?.abort();
    const ctl = new AbortController();
    ask.current = ctl;
    setThinking('busy');
    try {
      const images = total >= 3 ? renderViews(build) : [];
      const r = await suggestMoves(inv, build, (towards ?? goal).trim(), { hints, images, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      setLooksLike(r.looksLike); setGoalFit(r.goalFit); setDirections(r.directions); setMoves(r.moves); setPeek(null); setThinking('idle');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setThinking('error');
    }
  }, [inv, build, goal, total]);
  /** Take one of the builder's other directions: it becomes the goal, and moves toward it come next. */
  const steer = (d: Direction) => { setGoal(d.name); setDirections([]); setMoves([]); setGoalFit(''); suggest([], d.name); };
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => suggest(), PAUSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, auto]);
  useEffect(() => () => ask.current?.abort(), []);

  const take = (m: Move) => { commit(m.build); };
  const judge = async () => {
    if (!total) return;
    setJudging(true);
    try {
      const v = await judgeBuild({ name: goal.trim() || looksLike || 'my build', pitch: 'built by hand on the workbench', estimatedParts: total, difficulty: 1, keyParts: [] }, renderViews(build), total, Object.values(have).reduce((a, b) => a + b, 0));
      setVerdict(v);
    } finally { setJudging(false); }
  };

  const tray = useMemo(() => Object.entries(have)
    .map(([id]) => parsePartId(id)!)
    .filter(k => k && FAMILIES[family][1].includes(k.type))
    .sort((a, b) => a.w * a.d - b.w * b.d || a.w - b.w || a.color.localeCompare(b.color)), [have, family]);

  return (
    <main className="bench">
      <div className="bench-stage">
        <canvas ref={canvas} className={removing ? 'removing' : hand ? 'placing' : ''} aria-label="The workbench: a 24 by 24 stud plate in 3D" />
        <div className="bench-hud">
          {removing ? <span>Removing: click a part to take it off. <kbd>X</kbd> to stop.</span>
            : hand ? <span><b>{shapeName(hand)}</b> {hand.color.replace(/-/g, ' ')} · {left[hand.partId] ?? 0} left · <kbd>R</kbd> rotate · <kbd>Esc</kbd> put down{attempt && !attempt.ok ? <em> · can't go here: {attempt.reason}</em> : null}</span>
            : <span>Pick a part below, then click the plate. Drag to look around, right-drag to slide, scroll to zoom. Click a placed part to pick up another like it.</span>}
        </div>
        {debug && (
          <pre className="bench-debug">{hover
            ? [`pointer: cell ${hover.cx},${hover.cy}${hover.side ? ` against a wall facing ${hover.side.dx ? (hover.side.dx > 0 ? 'east' : 'west') : hover.side.dy > 0 ? 'back' : 'front'}` : ' (top or plate)'}`,
              attempt ? `part: ${attempt.placed.partId} at x=${attempt.placed.x} y=${attempt.placed.y} z=${attempt.placed.z} rot=${attempt.placed.rot}` : hand ? '' : 'no part in hand',
              attempt ? (attempt.ok ? 'decision: can go here' : `decision: blocked (${attempt.reason})`) : '',
              ...(attempt?.issues ?? []).map(i => `  checker ${i}`)].filter(Boolean).join('\n')
            : 'pointer: off the plate'}</pre>
        )}
        <div className="bench-tools">
          <button className="btn" onClick={undo} disabled={!past.length} title="Undo (⌘Z)">Undo</button>
          <button className="btn" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)">Redo</button>
          <button className="btn" onClick={() => turn()} disabled={!hand} title="Rotate (R)">Rotate</button>
          <button className={`btn${removing ? ' primary' : ''}`} onClick={() => setRemoving(r => !r)} title="Remove parts (X, or Shift-click)">Remove</button>
          <span className="meta">{total} parts{flagged.size ? ` · ${flagged.size} not holding on` : ''}</span>
        </div>
      </div>

      <aside className="bench-side">
        <button className="linkbtn" onClick={onBack}>← Back</button>
        <label className="pe-label" htmlFor="bench-goal">What are you building?</label>
        <input id="bench-goal" className="pe-search" value={goal} onChange={e => setGoal(e.target.value)} placeholder="Leave empty and the builder will guess" />
        {looksLike && <p className="meta">The builder thinks it looks like: <b>{looksLike}</b></p>}
        {goal.trim() && goalFit && <p className="meta">Your {goal.trim()} so far: {goalFit}</p>}
        {directions.length > 0 && <>
          <div className="bench-head"><h3>{goal.trim() ? 'It could also become' : 'It could become'}</h3></div>
          <div className="bench-moves">
            {directions.map(d => (
              <article key={d.name} className="bench-move bench-direction">
                <div className="row"><b>{d.name}</b><span className="grow" /><span className="bench-fit" aria-label={`fits ${d.fit} of 5`} title={`How naturally your shape and parts lead there: ${d.fit} of 5`}>{'●'.repeat(d.fit)}{'○'.repeat(5 - d.fit)}</span></div>
                <span className="meta">{d.why}</span>
                <div className="row"><button className="btn" onClick={() => steer(d)}>{goal.trim() ? 'Build this instead' : 'Go with this'}</button></div>
              </article>
            ))}
          </div>
        </>}

        <div className="bench-head">
          <h3>The builder suggests</h3>
          <label className="bench-auto"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> when I pause</label>
        </div>
        {thinking === 'busy' && <p className="meta">Looking at your build…</p>}
        {thinking === 'error' && <p className="card-note">Couldn't get suggestions. <button className="linkbtn" onClick={() => suggest()}>Try again</button></p>}
        <div className="bench-moves">
          {moves.map((m, i) => (
            <article key={i} className={`bench-move${peek === i ? ' on' : ''}`} onMouseEnter={() => setPeek(i)} onMouseLeave={() => setPeek(null)} onFocus={() => setPeek(i)}>
              <b>{m.title}</b>
              <span className="meta">{m.why}</span>
              <span className="meta">{describe(m, build)}</span>
              <div className="row">
                <button className="btn primary" onClick={() => take(m)}>Use this</button>
                <button className="linkbtn" onClick={() => setMoves(ms => ms.filter(x => x !== m))}>Not this</button>
              </div>
            </article>
          ))}
          {!moves.length && thinking === 'idle' && <button className="btn" onClick={() => suggest()}>Suggest moves</button>}
        </div>

        <div className="bench-head"><h3>How's it looking?</h3></div>
        <button className="btn" onClick={judge} disabled={!total || judging}>{judging ? 'The judge is looking…' : 'Ask the judge'}</button>
        {verdict && (
          <div className="bench-verdict">
            <p className="dc-quote">Looks like “{verdict.looksLike}”</p>
            <p className="meta">recognizable {verdict.recognizable} · complete {verdict.complete} · colors {verdict.colors} · impressive {verdict.impressive} · {passes(verdict) ? 'passes' : 'not there yet'}</p>
            {!passes(verdict) && <><ul className="dc-fixes">{verdict.fixes.map((f, i) => <li key={i}>{f}</li>)}</ul>
              <button className="btn" onClick={() => suggest(verdict.fixes)}>Suggest moves for these</button></>}
          </div>
        )}

        <button className="btn primary bench-booklet" onClick={() => onBooklet(toBooklet(build, goal.trim() || looksLike))} disabled={!total || flagged.size > 0}
          title={flagged.size ? 'Some parts aren’t holding on yet' : undefined}>Make the booklet</button>
      </aside>

      <section className="bench-tray" aria-label="Your parts">
        <div className="dc-tabs">
          {FAMILIES.map(([name], i) => <button key={name} className={`dc-tab${family === i ? ' on' : ''}`} onClick={() => setFamily(i)}>{name}</button>)}
        </div>
        <div className="bench-parts">
          {tray.map(k => {
            const n = left[k.partId] ?? 0;
            return (
              <button key={k.partId} className={`bench-part${hand?.partId === k.partId ? ' on' : ''}`} disabled={!n}
                title={`${shapeName(k)} ${k.color.replace(/-/g, ' ')}: ${n} left`} onClick={() => { setHand(k); setRemoving(false); }}>
                <img src={partIcon(k.partId)} alt="" loading="lazy" />
                <span>{k.w}×{k.d}</span><em>{n}</em>
                <i style={{ background: COLORS[k.color as ColorName] }} />
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

/** "adds 4 parts, removes 1" for a move card. */
function describe(m: Move, build: Build) {
  const now = new Set(allParts(build).map(placedKey)), then = new Set(allParts(m.build).map(placedKey));
  const adds = allParts(m.build).filter(p => !now.has(placedKey(p))).length;
  const takes = allParts(build).filter(p => !then.has(placedKey(p))).length;
  return [adds && `adds ${adds} part${adds === 1 ? '' : 's'}`, takes && `takes off ${takes}`].filter(Boolean).join(', ');
}
