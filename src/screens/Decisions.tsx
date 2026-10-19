import { useEffect, useState, type ReactNode } from 'react';
import { COLORS, type Build, type ColorName } from '../lib/bricks';
import { colorsOf, passes, type Verdict } from '../lib/gemini';
import { renderViews } from '../lib/render';
import { constructionKey } from '../lib/construction';
import { WORK_LABEL, funnel, segments, traceFile, type CardTrace, type Trace, type Work } from '../lib/trace';
import type { Slot } from './Builds';

/**
 * How the builder decided: the pipeline as the code runs it (model steps and code steps), with this run's
 * counts on it; every idea and whether it fit; a timeline per build; every judge verdict next to the build it
 * scored; and why each card got its slot. Live while a run is going; a saved run can be loaded back.
 */
export function Decisions({ trace, slots, onBack }: { trace: Trace | null; slots: Slot[]; onBack: () => void }) {
  const [loaded, setLoaded] = useState<Trace | null>(null);
  const tr = loaded ?? trace;
  const running = !loaded && !!tr?.cards.some(c => !c.end);
  const now = useNow(running);
  const [pick, setPick] = useState(0);

  const save = () => {
    if (!tr) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(traceFile(tr));
    a.download = `spill-decisions-${new Date(tr.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
  };
  const open = (f?: File) => f?.text().then(t => { setLoaded(JSON.parse(t) as Trace); setPick(0); }).catch(() => {});

  return (
    <main className="decisions">
      <div className="builds-head">
        <h2>How it decided</h2>
        <span className="meta">Every decision the builder made for the suggestions, from your parts to the three cards. Blue steps are Gemini deciding; outlined steps are fixed rules in the app's code.</span>
      </div>
      <div className="row dc-tools">
        <button className="btn" onClick={onBack}>Back to builds</button>
        <span className="grow" />
        {loaded && <button className="linkbtn" onClick={() => setLoaded(null)}>Back to this session</button>}
        <label className="linkbtn dc-file">Open a saved run<input className="sr" type="file" accept="application/json,.json" onChange={e => open(e.target.files?.[0])} /></label>
        {tr && <button className="linkbtn" onClick={save}>Save this run</button>}
      </div>
      {loaded && <p className="card-note">Viewing a saved run from {new Date(loaded.startedAt).toLocaleString()}.</p>}

      {!tr ? <p className="meta">No suggestions yet. Press “Find builds” on your parts, then come back here.</p> : <>
        <Section title="The pipeline, with this run's counts">
          <Pipeline tr={tr} />
        </Section>

        <Section title={`Ideas · ${tr.pile.usable} usable parts in ${tr.pile.kinds} kinds${tr.pile.other ? `, ${tr.pile.other} the builder can't use yet` : ''}`}>
          <Ideas tr={tr} slots={loaded ? [] : slots} />
        </Section>

        <Section title="Timeline · what each build spent its time on">
          <Timeline tr={tr} now={running ? now : undefined} onPick={setPick} />
        </Section>

        <Section title="The judge's verdicts">
          <div className="dc-tabs" role="tablist">
            {tr.cards.map((c, i) => (
              <button key={i} role="tab" aria-selected={pick === i} className={`dc-tab${pick === i ? ' on' : ''}`} onClick={() => setPick(i)}>
                {c.idea.name} <Status c={c} />
              </button>
            ))}
          </div>
          {tr.cards[pick] && <Verdicts c={tr.cards[pick]} />}
        </Section>

        {!loaded && slots.length > 0 && (
          <Section title="Choosing the three cards">
            <div className="dc-slots">
              {slots.map((s, k) => (
                <div key={k} className="dc-slot">
                  <div className="kicker">Card {k + 1}</div>
                  <b>{s.card.idea.name}</b>
                  <span className="meta">{slotWhy(s, tr)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </>}
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="dc-section"><div className="section-title">{title}</div>{children}</section>;
}

function useNow(on: boolean) {
  const [now, set] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => set(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

const total = (v: Verdict) => v.recognizable + v.complete + v.colors + v.impressive;

function Status({ c }: { c: CardTrace }) {
  const s = c.end?.status;
  const [label, cls] = !s ? ['working', 'run'] : s === 'passed' ? ['passed', 'ok'] : s === 'failed' ? ['fell apart', 'bad'] : s === 'best attempt' ? ['best attempt', 'mid'] : s === 'stopped' ? ['stopped', 'mid'] : ['done', 'mid'];
  return <span className={`dc-pill ${cls}`}>{label}</span>;
}

function slotWhy(s: Slot, tr: Trace): string {
  const c = tr.cards[s.index];
  const end = c?.end?.status;
  const what = !end ? 'still working' : end === 'passed' ? `passed the quality check (${total(bestVerdict(c)!)}/20)` : end === 'best attempt' ? `best attempt, ${total(bestVerdict(c)!)}/20` : end === 'failed' ? 'fell apart, and no backup was left' : 'ready';
  return s.replaced ? `Stepped in for ${s.replaced}: ${what}.` : `Its own slot: ${what}.`;
}
const bestVerdict = (c: CardTrace) => c.end?.verdict ?? c.attempts.find(a => a.build === c.end?.build)?.verdict ?? c.attempts[c.attempts.length - 1]?.verdict;

/* ------------------------------------------------------------------ the pipeline diagram */

type Kind = 'model' | 'code' | 'input';
interface N { id: string; x: number; y: number; w: number; h: number; kind: Kind; title: string; lines: string[]; chip?: string; rule?: boolean }
interface O { x: number; y: number; w: number; label: string; tone: 'ok' | 'mid' | 'bad'; chip?: string }

function Pipeline({ tr }: { tr: Trace }) {
  const f = funnel(tr);
  const blind = tr.pipeline === 'quality-v3';
  const quality = blind || tr.pipeline === 'quality-v2';
  const staged = quality || tr.pipeline === 'staged-v1';
  const L = 40, W = 400, R = 500, RW = 260, cx = L + W / 2;
  const n: Record<string, N> = {
    parts: { id: 'parts', x: L, y: 10, w: W, h: 50, kind: 'input', title: 'Your parts', lines: [`${tr.pile.usable} usable parts in ${tr.pile.kinds} kinds, from the scan`] },
    ideas: { id: 'ideas', x: L, y: 96, w: W, h: 66, kind: 'model', title: 'Ideas from the parts list', lines: ['Gets only the parts list, nothing about what to build.', 'Returns 5 ideas, each with every part it will use.'], chip: `${f.proposed} proposed` },
    fit: { id: 'fit', x: L, y: 198, w: W, h: 50, kind: 'code', rule: true, title: 'Does every count fit what you have?', lines: ['A list asking for more than the pile has is dropped.'], chip: `${f.fit} fit` },
    design: { id: 'design', x: L, y: 284, w: W, h: 66, kind: 'model', title: 'Design: a plan, then every brick', lines: ['All ideas that fit build at the same time, within ±15%', "of the planned size, outside in the list's colors."], chip: `${f.built} built` },
    check: { id: 'check', x: L, y: 386, w: W, h: 50, kind: 'code', rule: true, title: 'Checker: does it stand up?', lines: ['Overlaps, floating parts, loose groups, over your counts.'], chip: `${f.stoodUp} stood up` },
    review: { id: 'review', x: L, y: 472, w: W, h: 66, kind: 'model', title: 'Self-review from renders', lines: ['Looks at 3 views and the color check, edits, re-checks.', 'Then code swaps stray outside colors for spare parts.'] },
    judge: { id: 'judge', x: L, y: 574, w: W, h: 66, kind: 'model', title: 'Judge: a fresh call, renders only', lines: ['Never sees the builder’s reasoning. Scores recognizable,', 'complete, colors and impressive, 1 to 5 each.'] },
    pass: { id: 'pass', x: L, y: 676, w: W, h: 50, kind: 'code', rule: true, title: 'Lowest score ≥ 3 and average ≥ 3.5?', lines: ['The pass rule, in code.'] },
    redesign: { id: 'redesign', x: L, y: 762, w: W, h: 80, kind: 'model', title: 'Redesign from scratch, once', lines: ['Sees the failed attempt’s renders and the critique.', 'If impressive < 3 it may grow to the whole pile.', 'Checked, color-matched, then judged fresh again.'], chip: `${f.redesigned} redesigned` },
    keep: { id: 'keep', x: L, y: 878, w: W, h: 50, kind: 'code', rule: true, title: 'Keep whichever scores higher', lines: ['A redesign that passes always wins.'], chip: `redesign won ${f.redesignWon} of ${f.redesigned}` },
    pass2: { id: 'pass2', x: L, y: 964, w: W, h: 50, kind: 'code', rule: true, title: 'Passes now?', lines: ['Same rule as before.'] },
    cards: { id: 'cards', x: L, y: 1110, w: W, h: 66, kind: 'code', title: 'Choosing the 3 cards', lines: ['Passed or still working first, then best attempts, then', 'builds that fell apart. Backups stop once all 3 pass.'] },
  };
  const out: Record<string, O> = {
    dropped: { x: R, y: 203, w: RW, label: 'Dropped, never built', tone: 'bad', chip: `${f.dropped.length}` },
    fix: { x: R, y: 372, w: RW, label: 'Fix round (Gemini)', tone: 'mid' },
    fell: { x: R, y: 500, w: RW, label: 'Fell apart', tone: 'bad', chip: `${f.collapsed}` },
    passed1: { x: R, y: 681, w: RW, label: 'Passed', tone: 'ok', chip: `${f.passedFirst}` },
    passed2: { x: R, y: 969, w: RW, label: 'Passed', tone: 'ok', chip: `${f.passedAfter}` },
    best: { x: L + 60, y: 1040, w: W - 120, label: 'Best attempt, shown with its score', tone: 'mid', chip: `${f.best}` },
  };
  if (staged) {
    n.ideas.lines = ['Plans compact objects from available shapes and colors.', 'Failed builds inform one additional batch of ideas.'];
    n.design.title = 'Build a small connected core';
    n.design.lines = ['Prove the silhouette with a small set of parts first.', 'Instruction order is derived from the geometry.'];
    n.review.title = 'Grow with checked additions';
    n.review.lines = ['Use remaining pieces and exposed attachment points.', 'Keep the last valid version if an addition fails.'];
    n.judge.title = 'Judge: renders and actual inventory';
    n.judge.lines = ['Scores recognizability, completion, colors and craft.', 'A small complete build can earn the highest score.'];
    n.redesign.title = 'Refine the checked version, once';
    n.redesign.lines = ['Use the critique and remaining stock at this scale.', 'Check every change; retain the valid version on failure.', 'Judge again only when the geometry changed.'];
    n.redesign.chip = `${f.redesigned} refined`;
    n.keep.lines = ['Keep the earlier version if refinement scores lower.'];
    n.keep.chip = `refinement won ${f.redesignWon} of ${f.redesigned}`;
  }
  const H = 1190;
  if (quality) {
    n.design.title = 'Reserve details, then build the core';
    n.design.lines = ['Set aside signature pieces and plan visible colors.', 'Check the core against only its remaining stock.'];
    n.review.lines = ['Release reserved pieces to finish the defining features.', 'Use checked construction examples when they fit.'];
    n.pass.title = 'Score the first complete version';
    n.pass.lines = ['Passing builds get a refinement pass too.'];
    n.redesign.title = 'Try one focused visual refinement';
    n.redesign.lines = ['May replace existing parts and use spare pieces.', 'Check the whole revision; one correction allowed.', 'Keep the original intact if the revision fails.'];
    n.keep.title = 'Compare both, keep a clear improvement';
    n.keep.lines = ['Blind A/B review; ties and lost identity keep the original.'];
    out.passed2.chip = `${f.passed}`;
  }
  if (blind) {
    n.judge.title = 'Identify the model without its name';
    n.judge.lines = ['Renders only: no title, inventory, or design rationale.', 'Match that observation to the subject in a separate call.'];
    n.keep.lines = ['A preferred revision must pass an unnamed review too.'];
    n.pass2.title = 'Identity, completion, craft ≥ 4; colors ≥ 3?';
    n.pass2.lines = ['Recognizable but crude builds stay below the bar.'];
  }
  const down = (a: N, b: N | O, label?: string) => {
    const y1 = a.y + a.h, y2 = b.y;
    return <Arrow key={`${a.id}-${'id' in b ? b.id : 'o'}`} d={`M${cx} ${y1} V${y2 - 2}`} label={label} lx={cx + 8} ly={(y1 + y2) / 2 + 4} />;
  };
  const right = (a: N, o: O, label: string) => <Arrow key={`${a.id}-r`} d={`M${a.x + a.w} ${a.y + a.h / 2} H${o.x - 2}`} label={label} lx={a.x + a.w + 8} ly={a.y + a.h / 2 - 6} />;
  return (
    <div className="dc-diagram">
      <svg viewBox={`0 0 800 ${H}`} role="img" aria-label="The builder's pipeline: ideas from the parts list, a fit check, design, the checker and fix rounds, self-review, the judge, one redesign, and choosing the cards">
        <defs>
          <marker id="dc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink)" /></marker>
        </defs>
        {down(n.parts, n.ideas)}
        {down(n.ideas, n.fit)}
        {down(n.fit, n.design, 'fits')}
        {right(n.fit, out.dropped, 'no')}
        {/* fewer than 3 fit: ask again */}
        <Arrow d={`M${L} ${n.fit.y + n.fit.h / 2} H${L - 22} V${n.ideas.y + n.ideas.h / 2} H${L - 2}`} dashed label={f.askedAgain ? 'fewer than 3 fit: asked once more ✓' : 'fewer than 3 fit: ask once more'} lx={L + 8} ly={n.fit.y + n.fit.h + 16} />
        {down(n.design, n.check)}
        {/* checker → fix → back */}
        <Arrow d={`M${n.check.x + n.check.w} ${n.check.y + 14} H${out.fix.x - 2}`} label="problems" lx={n.check.x + n.check.w + 8} ly={n.check.y + 8} />
        <Arrow d={`M${out.fix.x} ${out.fix.y + 44} H${n.check.x + n.check.w + 2}`} dashed label={staged ? 'check each small addition' : 're-check, up to 6 rounds'} lx={n.check.x + n.check.w + 8} ly={out.fix.y + 58} />
        <Arrow d={`M${out.fix.x + out.fix.w / 2} ${out.fix.y + 81} V${out.fell.y - 2}`} label={staged ? 'no valid core' : 'still broken after 6'} lx={out.fix.x + out.fix.w / 2 + 8} ly={out.fix.y + 99} />
        {down(n.check, n.review, 'stands up')}
        {down(n.review, n.judge)}
        {down(n.judge, n.pass)}
        {!quality && right(n.pass, out.passed1, 'yes')}
        {down(n.pass, n.redesign, quality ? 'every build' : 'no')}
        {down(n.redesign, n.keep)}
        {down(n.keep, n.pass2)}
        {right(n.pass2, out.passed2, 'yes')}
        {down(n.pass2, out.best, 'no')}
        {/* outcomes into the cards: passes along the right edge, best attempts straight down */}
        <Arrow d={`M${cx} ${out.best.y + 40} V${n.cards.y - 2}`} />
        {!quality && <path d={`M${R + RW} ${out.passed1.y + 20} H785 V${n.cards.y + n.cards.h / 2}`} className="dc-line-only" fill="none" />}
        <path d={`M${R + RW} ${out.passed2.y + 20} H785${quality ? ` V${n.cards.y + n.cards.h / 2}` : ''}`} className="dc-line-only" fill="none" />
        <Arrow d={`M785 ${n.cards.y + n.cards.h / 2} H${L + W + 2}`} />
        {Object.values(n).map(node => <Node key={node.id} n={node} />)}
        {Object.entries(out).filter(([k]) => !quality || k !== 'passed1').map(([k, o]) => <Outcome key={k} o={o} sub={staged && k === 'fix' ? ['Fix the core, then freeze it.', 'Replace invalid additions only.', 'Stop repeating identical failures.'] : k === 'fix' ? ['More than 12 problems: rewrite it.', 'Otherwise targeted edits; an edit', 'that makes things worse is rejected.'] : k === 'fell' ? ['Code first snaps nearby parts and', 'drops up to 3, then gives up.'] : undefined} />)}
        <g transform={`translate(${R} 1040)`} className="dc-legend">
          <rect width="18" height="14" rx="3" className="n-model" /><text x="26" y="11">Gemini decides</text>
          <rect y="22" width="18" height="14" rx="3" className="n-code" /><text x="26" y="33">fixed rule in code</text>
        </g>
      </svg>
      {f.dropped.length > 0 && <p className="meta">Dropped: {f.dropped.map(d => `${d.name} (${d.reason})`).join('; ')}.</p>}
    </div>
  );
}

function Arrow({ d, label, lx, ly, dashed, vertical }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean; vertical?: boolean }) {
  return (
    <g className="dc-arrow">
      <path d={d} fill="none" strokeDasharray={dashed ? '4 4' : undefined} markerEnd="url(#dc-arrow)" />
      {label && <text x={lx} y={ly} textAnchor={vertical ? 'end' : 'start'}>{label}</text>}
    </g>
  );
}

function Node({ n }: { n: N }) {
  return (
    <g transform={`translate(${n.x} ${n.y})`}>
      <rect width={n.w} height={n.h} rx={n.rule ? 25 : 8} className={`n-${n.kind}`} />
      <text x="14" y="20" className="dc-title">{n.title}</text>
      {n.lines.map((l, i) => <text key={i} x="14" y={37 + i * 15} className="dc-line">{l}</text>)}
      {n.chip && <g transform={`translate(${n.w - 8} 8)`}><text textAnchor="end" y="12" className="dc-chip">{n.chip}</text></g>}
    </g>
  );
}

function Outcome({ o, sub }: { o: O; sub?: string[] }) {
  const h = sub ? 36 + sub.length * 15 : 40;
  return (
    <g transform={`translate(${o.x} ${o.y})`}>
      <rect width={o.w} height={h} rx="8" className={`o-${o.tone}`} />
      <text x="12" y="24" className="dc-title">{o.label}</text>
      {o.chip !== undefined && <text x={o.w - 12} y="24" textAnchor="end" className="dc-count">{o.chip}</text>}
      {sub?.map((l, i) => <text key={i} x="12" y={42 + i * 15} className="dc-line">{l}</text>)}
    </g>
  );
}

/* ------------------------------------------------------------------ ideas */

function Ideas({ tr, slots }: { tr: Trace; slots: Slot[] }) {
  const shown = new Map(slots.map((s, k) => [s.index, k]));
  return (
    <div className="dc-ideas">
      {tr.ideaRounds.map((round, r) => (
        <div key={r}>
          {tr.ideaRounds.length > 1 && <div className="kicker">{r ? 'Asked again, told why the first ones didn’t fit' : 'First ask'}</div>}
          <div className="dc-idea-grid">
            {round.proposed.map((idea, i) => {
              const v = round.verdicts[i];
              const ci = tr.cards.findIndex(c => c.idea.name === idea.name);
              const c = tr.cards[ci];
              return (
                <article key={i} className={`dc-idea${v?.ok ? '' : ' out'}`}>
                  <div className="row"><b>{idea.name}</b><span className="grow" />{v?.ok ? (c ? <Status c={c} /> : null) : <span className="dc-pill bad">dropped</span>}</div>
                  <p className="pitch">{idea.pitch}</p>
                  {idea.why && <p className="card-why">{idea.why}</p>}
                  <div className="card-meta">
                    <span>{idea.estimatedParts} parts in its list</span>
                    <span className="palette">{colorsOf(idea).slice(0, 6).map(col => <i key={col} style={{ background: COLORS[col as ColorName] }} title={col} />)}</span>
                  </div>
                  <p className="meta">{v?.ok ? (shown.has(ci) ? `Shown as card ${shown.get(ci)! + 1}.` : c?.end ? 'A backup, not shown.' : 'Building.') : `Didn't fit: ${v?.reason}.`}</p>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

const WORK_COLOR: Record<Work, string> = { design: '#2d5f8a', fix: '#c2871a', review: '#6f58a8', judge: '#2a8c8c', redesign: '#c45a3c' };

function Timeline({ tr, now, onPick }: { tr: Trace; now?: number; onPick: (i: number) => void }) {
  const rows = tr.cards.map(c => ({ c, segs: segments(c, now) }));
  const end = Math.max(30, ...rows.flatMap(r => r.segs.map(s => s.to)), ...tr.cards.map(c => c.end?.at ?? 0));
  const L = 170, W = 600, rowH = 40;
  const x = (t: number) => L + (t / end) * W;
  const step = end > 400 ? 120 : end > 160 ? 60 : 30;
  const H = 30 + rows.length * rowH;
  return (
    <div className="dc-timeline">
      <svg viewBox={`0 0 800 ${H}`} role="img" aria-label="Timeline of each build: designing, checking and fixing, self-review, judging and redesigning">
        {Array.from({ length: Math.floor(end / step) + 1 }, (_, k) => (
          <g key={k}><line x1={x(k * step)} x2={x(k * step)} y1={18} y2={H} className="dc-grid" /><text x={x(k * step)} y={12} textAnchor="middle" className="dc-axis">{k * step}s</text></g>
        ))}
        {rows.map(({ c, segs }, i) => {
          const y = 24 + i * rowH;
          return (
            <g key={i} onClick={() => onPick(i)} style={{ cursor: 'pointer' }}>
              <text x={0} y={y + 17} className="dc-title">{c.idea.name.length > 22 ? `${c.idea.name.slice(0, 21)}…` : c.idea.name}</text>
              {segs.map((s, k) => <rect key={k} x={x(s.from)} y={y + 4} width={Math.max(1, x(s.to) - x(s.from))} height={18} fill={WORK_COLOR[s.work]} rx="2"><title>{`${WORK_LABEL[s.work]}: ${Math.round(s.from)}–${Math.round(s.to)}s`}</title></rect>)}
              {c.events.filter(e => e.phase === 'issues').map((e, k) => <line key={`i${k}`} x1={x(e.t)} x2={x(e.t)} y1={y} y2={y + 26} className="dc-issue"><title>{`${Math.round(e.t)}s: ${e.summary}`}</title></line>)}
              {c.events.filter(e => e.phase === 'judged').map((e, k) => (
                <g key={`j${k}`} transform={`translate(${x(e.t)} ${y + 13})`}>
                  <circle r="10" className={e.pass ? 'dc-pass' : 'dc-fail'} />
                  <text textAnchor="middle" y="4" className="dc-score">{total(e.verdict!)}</text>
                  <title>{`Judge at ${Math.round(e.t)}s: ${total(e.verdict!)}/20, "${e.verdict!.looksLike}"`}</title>
                </g>
              ))}
              {c.end && <text x={Math.min(x(c.end.at) + 14, 790)} y={y + 17} className={`dc-end ${c.end.status === 'passed' ? 'ok' : c.end.status === 'failed' ? 'bad' : 'mid'}`} textAnchor={x(c.end.at) + 14 > 700 ? 'end' : 'start'}>{c.end.status === 'passed' ? '✓' : c.end.status === 'failed' ? '✗' : c.end.status === 'stopped' ? '■' : '◐'}<title>{c.end.reason ?? c.end.status}</title></text>}
            </g>
          );
        })}
      </svg>
      <div className="dc-key">
        {(Object.keys(WORK_LABEL) as Work[]).map(w => <span key={w}><i style={{ background: WORK_COLOR[w] }} />{WORK_LABEL[w]}</span>)}
        <span><i className="dc-key-issue" />checker found problems</span>
        <span><i className="dc-key-judge" />judge's score out of 20 (green passed)</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ verdicts */

const imageCache = new WeakMap<Build, string>();
function BuildImage({ build }: { build: Build }) {
  const [rendered, setRendered] = useState<{ build: Build; url: string } | null>(null);
  const url = rendered?.build === build ? rendered.url : imageCache.get(build);
  useEffect(() => {
    if (url) return;
    const t = setTimeout(() => { const u = renderViews(build)[0]; imageCache.set(build, u); setRendered({ build, url: u }); }, 30);
    return () => clearTimeout(t);
  }, [build, url]);
  return url ? <img className="dc-render" src={url} alt="Render of the build the judge scored" /> : <div className="dc-render" />;
}

function Verdicts({ c }: { c: CardTrace }) {
  const kept = c.end?.build;
  const decisions = c.events.filter(e => e.phase === 'compared' || (e.phase === 'kept' && /original|scored higher|best attempt/.test(e.reason ?? '')));
  if (!c.attempts.length) {
    return <p className="meta">{c.end?.status === 'failed' || c.end?.status === 'stopped' ? `No verdict. ${c.end.reason ?? 'It fell apart before the judge saw it'}.` : 'Not judged yet.'}</p>;
  }
  return (
    <div className="dc-verdicts">
      {c.attempts.map((a, i) => {
        const mean = total(a.verdict) / 4;
        const blind = a.verdict.review === 'blind-v1';
        const isKept = !!kept && constructionKey(kept) === constructionKey(a.build);
        return (
          <article key={i} className={`dc-verdict${isKept ? ' kept' : ''}`}>
            <BuildImage build={a.build} />
            <div>
              <div className="row"><b>{a.label === 'first version' ? 'First version' : 'Redesign'}</b><span className="grow" /><span className={`dc-pill ${a.pass ? 'ok' : 'bad'}`}>{a.pass ? 'passes' : 'below the bar'}</span></div>
              <p className="dc-quote">{blind ? 'Without its name: ' : 'Looks like '}“{a.verdict.looksLike}”</p>
              <div className="dc-bars">
                {(['recognizable', 'complete', 'colors', 'impressive'] as const).map(k => (
                  <div key={k} className="dc-bar">
                    <span>{k}</span>
                    <div className="dc-track"><i style={{ width: `${(a.verdict[k] / 5) * 100}%` }} className={a.verdict[k] < (blind && k !== 'colors' ? 4 : 3) ? 'low' : ''} /><b style={{ left: blind && k !== 'colors' ? '80%' : '60%' }} title={`the lowest score allowed: ${blind && k !== 'colors' ? 4 : 3}`} /></div>
                    <em>{a.verdict[k]}</em>
                  </div>
                ))}
              </div>
              <p className="meta">{blind ? 'Needs 4 for identity, completion and craft; 3 for colors' : `Total ${total(a.verdict)}/20 · average ${mean.toFixed(2)} (needs 3.5, nothing below 3)`} · {a.parts} parts</p>
              {!a.pass && a.verdict.fixes.length > 0 && <ul className="dc-fixes">{a.verdict.fixes.map((x, k) => <li key={k}>{x}</li>)}</ul>}
              <p className="meta"><b>{isKept ? 'This is the one shown.' : c.end ? 'Not shown.' : ''}</b></p>
            </div>
          </article>
        );
      })}
      {decisions.map((d, i) => <p key={i} className="card-note">{d.reason}</p>)}
      {c.attempts.length === 1 && c.end && !passes(c.attempts[0].verdict) && !c.events.some(e => e.phase === 'rebuilding') && <p className="card-note">No redesign ran.</p>}
    </div>
  );
}
