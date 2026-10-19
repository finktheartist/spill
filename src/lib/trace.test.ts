import { describe, expect, it } from 'vitest';
import type { Build } from './bricks';
import type { BuildEvent, Verdict } from './gemini';
import { funnel, newCardTrace, record, segments, stopped, type Trace } from './trace';

const idea = { name: 'Cabin', pitch: '', estimatedParts: 40, difficulty: 1, keyParts: [] };
const build = (n: number): Build => ({ name: 'b', description: '', steps: [{ caption: '', parts: Array.from({ length: n }, (_, i) => ({ partId: 'plate-1x2-red', x: i * 2, y: 0, z: 0, rot: 0 })) }] });
const v = (n: number): Verdict => ({ looksLike: 'x', fixes: ['y'], recognizable: n, complete: n, colors: n, impressive: n });
// play events at given seconds after the start
const play = (evs: [number, BuildEvent][]) => {
  let c = newCardTrace(idea);
  for (const [s, e] of evs) c = record(c, e, c.startedAt + s * 1000);
  return c;
};

describe('the decision trace', () => {
  const first = build(10), second = build(12);
  const c = play([
    [0, { phase: 'designing', round: 0 }], [40, { phase: 'checking', parts: 10, round: 0 }],
    [41, { phase: 'issues', round: 0, summary: '1 floating', issues: [] }], [42, { phase: 'designing', round: 1 }],
    [50, { phase: 'preview', build: first, partsUsed: 10 }], [51, { phase: 'looking' }], [70, { phase: 'judging' }],
    [80, { phase: 'judged', verdict: v(2), pass: false, build: first }], [81, { phase: 'rebuilding', round: 1, of: 1 }],
    [120, { phase: 'checking', parts: 12, round: 0 }], [121, { phase: 'rebuilt', build: second, partsUsed: 12 }],
    [122, { phase: 'judging' }], [130, { phase: 'judged', verdict: v(4), pass: true, build: second }],
    [131, { phase: 'ready', build: second, rounds: 1, partsUsed: 12, seconds: 131, improved: true, verdict: v(4) }],
  ]);
  it('keeps every judged build with its verdict, and how the run ended', () => {
    expect(c.attempts.map(a => [a.label, a.parts, a.pass])).toEqual([['first version', 10, false], ['redesign', 12, true]]);
    expect(c.end).toMatchObject({ status: 'passed', at: 131, parts: 12 });
  });
  it('turns the events into stretches of work for the timeline', () => {
    expect(segments(c).map(s => [s.work, s.from, s.to])).toEqual([
      ['design', 0, 40], ['fix', 40, 50], ['review', 50, 70], ['judge', 70, 81], ['redesign', 81, 120], ['fix', 120, 121], ['review', 121, 122], ['judge', 122, 131],
    ]);
  });
  it('adds up the run for the diagram', () => {
    const fell = play([[0, { phase: 'designing', round: 0 }], [60, { phase: 'failed', reason: "Couldn't make this one stand up", seconds: 60 }]]);
    const tr: Trace = {
      startedAt: 0, pile: { usable: 100, kinds: 20, other: 5, colors: [] },
      ideaRounds: [{ proposed: [idea, idea, idea], verdicts: [{ name: 'Cabin', ok: true }, { name: 'Cabin', ok: true }, { name: 'Tower', ok: false, reason: 'needs 9 × brick-2x4-red, bucket has 2' }] }],
      cards: [c, fell, stopped(newCardTrace(idea))],
    };
    expect(funnel(tr)).toMatchObject({ proposed: 3, fit: 2, built: 3, stoodUp: 1, collapsed: 1, passedFirst: 0, redesigned: 1, redesignWon: 1, passedAfter: 1, passed: 1, stopped: 1, running: 0 });
  });
  it('preserves the selected original and comparison decision in saved runs', () => {
    const card = play([
      [0, { phase: 'planning' }],
      [5, { phase: 'planned', features: ['Roof'], reserved: 2 }],
      [10, { phase: 'judged', verdict: v(4), pass: true, build: first }],
      [20, { phase: 'judged', verdict: v(3), pass: false, build: second }],
      [21, { phase: 'compared', selected: 'original', reason: 'Clearer silhouette' }],
      [22, { phase: 'ready', build: first, verdict: v(4), rounds: 0, partsUsed: 10, seconds: 22, improved: false }],
    ]);
    const saved = JSON.parse(JSON.stringify(card));
    expect(saved.events[1]).toMatchObject({ features: ['Roof'], reserved: 2 });
    expect(saved.events[4]).toMatchObject({ selected: 'original', reason: 'Clearer silhouette' });
    expect(saved.end).toMatchObject({ verdict: v(4), status: 'passed', improved: false });
  });
});
