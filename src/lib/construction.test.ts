import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentMap, constructionIssues, joinConstruction, orderBuild } from './construction';
import { parsePartId, validate, type Build, type Placed } from './bricks';
import { addPart, counts, emptyInventory } from './inventory';
import { designBuild, feasible, type BuildEvent } from './gemini';

const p = (partId: string, x = 0, y = 0, z = 0): Placed => ({ partId, x, y, z, rot: 0 });
const b = (...parts: Placed[]): Build => ({ name: 'Tiny tower', description: '', steps: [{ caption: 'Build', parts }] });
const have = { 'brick-2x2-red': 6, 'tile-2x2-white': 2 };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('construction from actual pieces', () => {
  it('orders an added support before its dependent without changing geometry', () => {
    const original = b(p('tile-2x2-white', 0, 0, 3), p('brick-2x2-red'));
    expect(validate(original, have).map(i => i.kind)).toContain('floating');
    const ordered = orderBuild(original);
    expect(validate(ordered, have)).toEqual([]);
    expect(ordered.steps.flatMap(s => s.parts)).toEqual([...original.steps[0].parts].reverse());
    expect(original.steps[0].parts[0].partId).toBe('tile-2x2-white');
  });
  it('does not turn overlaps, shortages or disconnected parts into successes', () => {
    expect(constructionIssues(orderBuild(b(p('brick-2x2-red'), p('brick-2x2-red'))), have).map(i => i.kind)).toContain('overlap');
    expect(constructionIssues(b(p('brick-2x2-blue')), have).map(i => i.kind)).toContain('inventory');
    expect(constructionIssues(b(p('brick-2x2-red'), p('brick-2x2-red', 6)), have).map(i => i.kind)).toContain('loose');
    expect(constructionIssues({ name: '', description: '', steps: [] }, have).map(i => i.kind)).toContain('invalid');
    expect(constructionIssues(b(p('brick-2x2-red', 23)), have, 24).map(i => i.kind)).toContain('invalid');
  });
  it('exposes only unobstructed studs, never tile tops', () => {
    expect(attachmentMap(b(p('brick-2x2-red')))).toContain('z=3, y=0: x=0,1');
    expect(attachmentMap(b(p('brick-2x2-red'), p('tile-2x2-white', 0, 0, 3)))).toMatch(/^No exposed studs/);
  });
  it('preserves the core when constructing candidate additions', () => {
    const base = b(p('brick-2x2-red'));
    const candidate = joinConstruction(base, [{ caption: 'Top', parts: [p('brick-2x2-red', 0, 0, 3)] }]);
    expect(constructionIssues(candidate, have)).toEqual([]);
    expect(base.steps[0].parts).toHaveLength(1);
  });
  it('never creates a wheel holder from loose wheels', () => {
    const inv = addPart(emptyInventory(), parsePartId('wheel-1x1-black')!, 8);
    expect(counts(inv)).toEqual({});
    const confirmed = addPart(inv, parsePartId('wheels-4x2-black')!, 1);
    expect(counts(confirmed)).toEqual({ 'wheels-4x2-black': 1 });
  });
  it('rejects a multi-piece idea with no connecting studs', () => {
    const inv = addPart(emptyInventory(), parsePartId('tile-2x2-white')!, 2);
    expect(feasible({ name: 'Tiles', pitch: '', difficulty: 1, estimatedParts: 2, keyParts: [{ partId: 'tile-2x2-white', count: 2 }] }, inv).ok).toBe(false);
  });
});

describe('staged bucket pipeline', () => {
  const inv = addPart(emptyInventory(), parsePartId('brick-2x2-red')!, 24);
  const idea = { name: 'Tiny tower', pitch: 'A small stepped tower', estimatedParts: 24, difficulty: 1, keyParts: [{ partId: 'brick-2x2-red', count: 24 }] };
  const core = (n = 20) => b(...Array.from({ length: n }, (_, i) => p('brick-2x2-red', 0, 0, i * 3)));
  const plan = { features: [], colorZones: [] };
  const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
  it('keeps a checked core when a repeated invalid addition cannot be placed', async () => {
    const original = core();
    const bad = { steps: [{ caption: 'Bad addition', parts: [p('brick-2x2-red')] }] };
    const fetch = vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(original)).mockImplementation(async () => reply(bad));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const result = await designBuild(inv, idea, e => events.push(e));
    expect(result).toEqual(original);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(events.some(e => e.phase === 'kept')).toBe(true);
    expect(events.at(-1)?.phase).toBe('ready');
    expect(constructionIssues(result!, counts(inv))).toEqual([]);
  });
  it('accepts a legal extension with inventory and connections intact', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(core(19)))
      .mockResolvedValueOnce(reply({ steps: [{ caption: 'Tower', parts: [p('brick-2x2-red', 0, 0, 57)] }] })).mockImplementation(async () => reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const result = await designBuild(inv, idea, () => {});
    expect(result?.steps.flatMap(s => s.parts)).toHaveLength(20);
    expect(constructionIssues(result!, counts(inv))).toEqual([]);
    const growthPrompt = JSON.parse(fetch.mock.calls[2][1].body).contents[0].parts[0].text;
    expect(growthPrompt).toContain('brick-2x2-red × 5');
    expect(growthPrompt).toContain('z=57, y=0: x=0,1');
  });
  it('judges refinements against the updated remaining stock', async () => {
    const v = (n: number) => ({ looksLike: 'tower', recognizable: n, complete: n, colors: n, impressive: n, fixes: ['Raise the tower'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(plan))
      .mockResolvedValueOnce(reply(core()))
      .mockResolvedValueOnce(reply({ steps: [] }))
      .mockResolvedValueOnce(reply(v(2)))
      .mockResolvedValueOnce(reply({ matchesSubject: true }))
      .mockResolvedValueOnce(reply({ moves: [], removes: [], adds: [{ step: 2, partId: 'brick-2x2-red', x: 0, y: 0, z: 60, rot: 0 }], recolors: [], details: [], changes: ['Raise the tower'] }))
      .mockResolvedValueOnce(reply({ a: v(4), b: v(2), preferred: 'A', reason: 'Clearer silhouette' }))
      .mockResolvedValueOnce(reply(v(4))).mockResolvedValueOnce(reply({ matchesSubject: true }));
    vi.stubGlobal('fetch', fetch);
    const result = await designBuild(inv, idea, () => {}, { views: () => ['data:image/png;base64,AA=='] });
    expect(result?.steps.flatMap(s => s.parts)).toHaveLength(21);
    const prompt = (call: number) => JSON.parse(fetch.mock.calls[call][1].body).contents[0].parts.map((p: { text?: string }) => p.text ?? '').join('');
    expect(prompt(3)).not.toContain('brick-2x2-red');
    expect(prompt(5)).toContain('Unused pieces:\nbrick-2x2-red × 4');
    expect(prompt(6)).toContain('MODEL A — 21 pieces, unused: brick-2x2-red × 3');
    expect(prompt(6)).toContain('MODEL B — 20 pieces, unused: brick-2x2-red × 4');
  });
});
