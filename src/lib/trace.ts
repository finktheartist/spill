// A record of how the builder decided, for the "How it decided" screen: which ideas it proposed and which fit,
// then every step each candidate build went through (with timestamps), every judge verdict with the build it
// scored, and how each run ended. Built from the same events the build cards show.
import { partCount, type Build } from './bricks';
import { passes, type BuildEvent, type Idea, type IdeaRound, type Verdict } from './gemini';

/** One pipeline event, without the heavy parts (builds and issue lists). */
export interface TraceEvent {
  t: number; phase: BuildEvent['phase'];
  round?: number; summary?: string; parts?: number; changes?: string[]; reason?: string;
  verdict?: Verdict; pass?: boolean; removed?: number; moved?: number; count?: number; patches?: number; when?: string;
  features?: string[]; reserved?: number; selected?: 'original' | 'refinement';
}
/** A build the judge scored: the first version after the self-review, or a redesign. */
export interface Attempt { label: 'first version' | 'redesign'; build: Build; parts: number; verdict: Verdict; pass: boolean }
export interface CardTrace {
  idea: Idea; startedAt: number; events: TraceEvent[]; attempts: Attempt[];
  end?: { at: number; status: 'passed' | 'best attempt' | 'ready' | 'failed' | 'stopped'; reason?: string; build?: Build; parts?: number; verdict?: Verdict; improved?: boolean };
}
export interface Trace {
  pipeline?: 'staged-v1' | 'quality-v2' | 'quality-v3';
  searching?: boolean;
  searchError?: string;
  startedAt: number;
  pile: { usable: number; kinds: number; other: number; colors: [string, number][] };
  ideaRounds: IdeaRound[];
  cards: CardTrace[];
}

export const newCardTrace = (idea: Idea): CardTrace => ({ idea, startedAt: Date.now(), events: [], attempts: [] });

/** Fold one build event into a card's trace. */
export function record(c: CardTrace, e: BuildEvent, now = Date.now()): CardTrace {
  const t = (now - c.startedAt) / 1000;
  const { phase } = e;
  const ev: TraceEvent = { t, phase };
  if ('round' in e) ev.round = e.round;
  if (phase === 'issues') ev.summary = e.summary;
  if (phase === 'checking') ev.parts = e.parts;
  if (phase === 'improving') ev.changes = e.changes;
  if (phase === 'kept' || phase === 'failed') ev.reason = e.reason;
  if (phase === 'planned') { ev.features = e.features; ev.reserved = e.reserved; }
  if (phase === 'compared') { ev.selected = e.selected; ev.reason = e.reason; }
  if (phase === 'trimmed') ev.removed = e.removed;
  if (phase === 'settled') ev.moved = e.moved;
  if (phase === 'matched') ev.count = e.count;
  if (phase === 'colorcheck') { ev.patches = e.patches; ev.when = e.when; }
  if (phase === 'preview' || phase === 'rebuilt') ev.parts = e.partsUsed;
  const next: CardTrace = { ...c, events: [...c.events, ev] };
  if (phase === 'judged') {
    ev.verdict = e.verdict; ev.pass = e.pass;
    next.attempts = [...c.attempts, { label: c.attempts.length ? 'redesign' : 'first version', build: e.build, parts: partCount(e.build), verdict: e.verdict, pass: e.pass }];
  }
  if (phase === 'ready') {
    ev.parts = e.partsUsed;
    const status = !e.verdict ? 'ready' : passes(e.verdict) ? 'passed' : 'best attempt';
    next.end = { at: t, status, build: e.build, parts: e.partsUsed, verdict: e.verdict, improved: e.improved };
  }
  if (phase === 'failed') next.end = { at: t, status: 'failed', reason: e.reason };
  return next;
}

/** A backup stopped because the three cards shown had all passed. */
export const stopped = (c: CardTrace, now = Date.now()): CardTrace =>
  c.end ? c : { ...c, end: { at: (now - c.startedAt) / 1000, status: 'stopped', reason: 'Stopped: the three cards shown had all passed' } };

/** What the timeline shows: a run of time doing one kind of work. */
export type Work = 'design' | 'fix' | 'review' | 'judge' | 'redesign';
export const WORK_LABEL: Record<Work, string> = {
  design: 'Designing', fix: 'Checking & fixing', review: 'Self-review', judge: 'Judging', redesign: 'Redesigning',
};

/** Each event starts a stretch of one kind of work that lasts until the next event. */
export function segments(c: CardTrace, now?: number): { work: Work; from: number; to: number }[] {
  const out: { work: Work; from: number; to: number }[] = [];
  const kind = (e: TraceEvent): Work | null => {
    switch (e.phase) {
      case 'designing': return e.round ? 'fix' : 'design';
      case 'planning': case 'planned': case 'blueprinting': case 'blueprint': case 'section': case 'sectionDone': return 'design';
      case 'checking': case 'issues': case 'settled': case 'trimmed': return 'fix';
      case 'preview': case 'looking': case 'colorcheck': case 'improving': case 'kept': case 'matched': case 'rebuilt': return 'review';
      case 'judging': case 'judged': case 'compared': return 'judge';
      case 'rebuilding': return 'redesign';
      default: return null;
    }
  };
  const evs = c.events;
  const stop = c.end?.at ?? (now !== undefined ? (now - c.startedAt) / 1000 : evs[evs.length - 1]?.t ?? 0);
  evs.forEach((e, i) => {
    const w = kind(e);
    if (!w) return;
    const to = i + 1 < evs.length ? evs[i + 1].t : stop;
    const last = out[out.length - 1];
    if (last && last.work === w && Math.abs(last.to - e.t) < 1e-6) last.to = to;
    else out.push({ work: w, from: e.t, to });
  });
  return out.filter(s => s.to > s.from);
}

/** The run's totals, for the counts on the diagram. */
export function funnel(tr: Trace) {
  const verdicts = tr.ideaRounds.flatMap(r => r.verdicts);
  const judgedFirst = tr.cards.filter(c => c.attempts.length);
  return {
    proposed: verdicts.length,
    fit: verdicts.filter(v => v.ok).length,
    dropped: verdicts.filter(v => !v.ok),
    askedAgain: tr.ideaRounds.length > 1,
    built: tr.cards.length,
    stoodUp: judgedFirst.length,
    collapsed: tr.cards.filter(c => c.end?.status === 'failed' && !c.attempts.length).length,
    passedFirst: judgedFirst.filter(c => c.attempts[0].pass).length,
    redesigned: tr.cards.filter(c => c.events.some(e => e.phase === 'rebuilding')).length,
    redesignWon: tr.cards.filter(c => c.attempts.length > 1 && (c.end?.improved ?? (c.end?.build === c.attempts[c.attempts.length - 1].build))).length,
    passedAfter: tr.cards.filter(c => c.attempts.length > 1 && c.end?.status === 'passed').length,
    passed: tr.cards.filter(c => c.end?.status === 'passed').length,
    best: tr.cards.filter(c => c.end?.status === 'best attempt').length,
    running: tr.cards.filter(c => !c.end).length,
    stopped: tr.cards.filter(c => c.end?.status === 'stopped').length,
  };
}

/** A trace as a file to keep (builds included, so the scorecards can be redrawn). */
export const traceFile = (tr: Trace) => new Blob([JSON.stringify(tr)], { type: 'application/json' });
