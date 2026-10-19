import { afterEach, describe, expect, it, vi } from 'vitest';
import { allocateFeatures, refinementCandidate, refinementWins, type QualityPlan } from './build-quality';
import { techniquesFor } from './techniques';
import { constructionIssues } from './construction';
import { parsePartId, type Build, type Edit } from './bricks';
import { addPart, counts, emptyInventory, sampleInventory } from './inventory';
import { designBuild, refineBucketBuild, type BuildEvent, type Verdict } from './gemini';
import { assignSlots, newCard, type Card } from '../screens/Builds';

const p = (z: number, id = 'brick-2x2-red') => ({ partId: id, x: 0, y: 0, z, rot: 0 });
const build: Build = { name: 'Tower', description: '', steps: [{ caption: 'Stack', parts: [p(0), p(3), p(6)] }] };
const inv = addPart(emptyInventory(), parsePartId('brick-2x2-red')!, 8);
const have = counts(inv);
// Minimal fixtures above exercise low-level edits; finished-pipeline fixtures satisfy the 20-piece contract.
const developed = (n = 20): Build => ({ ...build, steps: [{ caption: 'Stack', parts: Array.from({ length: n }, (_, i) => p(i * 3)) }] });
const fullInv = addPart(emptyInventory(), parsePartId('brick-2x2-red')!, 30);
const idea = { name: 'Tower', pitch: 'Stepped tower', estimatedParts: 6, difficulty: 1, keyParts: [] };
const v = (score = 4): Verdict => ({ looksLike: 'tower', recognizable: score, complete: score, colors: score, impressive: score, fixes: ['Improve the silhouette'] });
const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
const emptyEdits = { moves: [], removes: [], adds: [], recolors: [], changes: [], details: [] };
const change = { ...emptyEdits, moves: [{ index: 2, x: 1, y: 0, z: 6, rot: 0 }], changes: ['Stepped silhouette'] };
const views = () => ['data:image/png;base64,AA=='];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('reserving signature pieces', () => {
  const stock = { 'plate-2x4-white': 1, 'brick-2x2-white': 12, 'slope-2x2-red': 2, 'roundtile-1x1-black': 2 };
  const feature = (partId: string, count: number) => ({ name: 'Roof', purpose: 'Opposing slopes on exposed studs', parts: [{ partId, count }] });
  it('deducts exact counts and never spends the same scarce pieces twice', () => {
    const result = allocateFeatures({ features: [feature('slope-2x2-red', 2), feature('slope-2x2-red', 1)], colorZones: [] }, stock, 18);
    expect(result.reserved).toEqual({ 'slope-2x2-red': 2 });
    expect(result.core['slope-2x2-red']).toBeUndefined();
    expect(result.plan.features).toHaveLength(1);
    expect(result.notes).toHaveLength(1);
    expect(stock['slope-2x2-red']).toBe(2);
  });
  it('keeps the only useful base and enough connecting pieces in the core', () => {
    expect(allocateFeatures({ features: [feature('plate-2x4-white', 1)], colorZones: [] }, stock, 18).reserved).toEqual({});
    expect(allocateFeatures({ features: [feature('brick-2x2-red', 3)], colorZones: [] }, { 'brick-2x2-red': 3, 'tile-1x1-white': 30 }, 30).reserved).toEqual({});
  });
  it.each([0, -1, 1.5, 999])('rejects invalid or excessive reservation quantity %s', count => {
    expect(allocateFeatures({ features: [feature('slope-2x2-red', count)], colorZones: [] }, stock, 18).reserved).toEqual({});
  });
  it('ignores unavailable parts/colors and malformed planner output', () => {
    const result = allocateFeatures({ features: [feature('slope-2x2-blue', 1)], colorZones: [{ zone: 'body', color: 'white' }, { zone: 'roof', color: 'blue' }] }, stock, 18);
    expect(result.reserved).toEqual({});
    expect(result.plan.colorZones).toEqual([{ zone: 'body', color: 'white' }]);
    expect(allocateFeatures(null as unknown as QualityPlan, stock, 18).core).toEqual(stock);
  });
});

describe('checked construction techniques', () => {
  it('offers only independently valid recipes that the bucket can supply', () => {
    const stock = { ...counts(sampleInventory()), 'arch-1x4-tan': 1, 'arch-1x6-tan': 1, 'plate-1x6-tan': 1 };
    const examples = techniquesFor(stock);
    expect(examples.map(t => t.name)).toEqual(['Pitched roof', 'Arch opening 4', 'Arch opening 6', 'Open frame', 'Wheel chassis']);
    for (const t of examples) expect(constructionIssues(t.build, stock, 24)).toEqual([]);
  });
  it('never manufactures an axle from loose wheels or offers incomplete components', () => {
    expect(techniquesFor({ 'wheel-1x1-black': 4, 'plate-4x6-white': 1 })).toEqual([]);
    expect(techniquesFor({ 'slope-2x2-red': 1, 'plate-2x4-white': 1 })).toEqual([]);
  });
});

describe('atomic refinement checks', () => {
  it('rebuilds instructions after a recolor instead of keeping a stale color caption', () => {
    const original = { ...build, steps: [{ caption: 'Stack three red bricks', parts: [p(0), p(3), p(6)] }] };
    const result = refinementCandidate(original, [{ op: 'recolor', index: 2, partId: 'brick-2x2-blue' }], { ...have, 'brick-2x2-blue': 1 }, 8);
    expect(result.build?.steps.map(s => s.caption).join(' ')).not.toContain('red');
    expect(result.build?.steps.at(-1)?.parts[0].partId).toBe('brick-2x2-blue');
    expect(original.steps[0].caption).toBe('Stack three red bricks');
  });
  it('allows moving the old core, and reusing a removed piece, without changing the original', () => {
    const edits: Edit[] = [{ op: 'remove', index: 2 }, { op: 'add', step: 1, ...p(6), x: 1 }];
    const result = refinementCandidate(build, edits, { 'brick-2x2-red': 3 }, 3);
    expect(result.issues).toEqual([]);
    expect(result.build?.steps.flatMap(s => s.parts)[2].x).toBe(1);
    expect(build.steps[0].parts[2].x).toBe(0);
  });
  it.each([
    { op: 'move', index: 2, x: 0, y: 0, z: 3, rot: 0 }, // overlap
    { op: 'move', index: 2, x: 5, y: 0, z: 6, rot: 0 }, // floating
    { op: 'move', index: 2, x: 24, y: 0, z: 0, rot: 0 }, // bounds / detached
    { op: 'add', step: 1, ...p(9, 'brick-2x2-blue') }, // shortage
    { op: 'remove', index: 0 }, // lost support
    { op: 'move', index: 999, x: 0, y: 0, z: 0, rot: 0 }, // bad index
    { op: 'move', index: 2, x: 1 }, // incomplete edit
    { op: 'recolor', index: 2, partId: 'plate-2x2-red' }, // not a recolor
  ] as Edit[])('rejects the whole invalid revision: %j', edit => {
    const result = refinementCandidate(build, [edit], have, 8);
    expect(result.build).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(build.steps[0].parts).toEqual([p(0), p(3), p(6)]);
  });
  it('enforces total size and preserves the model against broad dismantling', () => {
    expect(refinementCandidate(build, [{ op: 'add', step: 1, ...p(9) }], have, 3).build).toBeUndefined();
    expect(refinementCandidate(build, [{ op: 'remove', index: 1 }, { op: 'remove', index: 2 }], have, 8).build).toBeUndefined();
  });
  it('keeps ties, uncertain judgments, and regressions in identity or completeness', () => {
    expect(refinementWins(v(4), v(4), true)).toBe(false);
    expect(refinementWins(v(4), v(5), false)).toBe(false);
    expect(refinementWins(v(4), { ...v(5), recognizable: 3 }, true)).toBe(false);
    expect(refinementWins(v(4), { ...v(5), complete: 3 }, true)).toBe(false);
    expect(refinementWins(v(4), { ...v(5), impressive: 3 }, true)).toBe(false);
    expect(refinementWins(v(4), { ...v(5), colors: NaN }, true)).toBe(false);
    expect(refinementWins(v(4), { ...v(4), impressive: 5 }, true)).toBe(true);
  });
});

describe('quality pipeline integration', () => {
  it('falls back to the full inventory when feature planning times out', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    })).mockResolvedValueOnce(reply(developed())).mockResolvedValueOnce(reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const result = designBuild(fullInv, idea, e => events.push(e));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual(developed());
    expect(events.some(e => e.phase === 'kept' && e.reason.includes('Planning was unavailable'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shows three completed candidates without waiting for a slow primary build', () => {
    const ready: Card = { ...newCard(idea), phase: 'ready', verdict: v(), build: developed() };
    const waiting: Card = { ...newCard(idea), phase: 'looking' };
    expect(assignSlots([ready, waiting, ready, waiting, ready]).map(s => s.index)).toEqual([0, 4, 2]);
    expect(assignSlots([waiting, ready, waiting, ready]).map(s => s.index)).toEqual([0, 1, 2]);
  });
  it('bounds a stalled refinement and keeps the checked original', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const result = refineBucketBuild(inv, idea, build, v(), e => events.push(e), { views });
    await vi.advanceTimersByTimeAsync(75_000);
    expect((await result).build).toBe(build);
    expect(events.at(-1)).toMatchObject({ phase: 'kept', reason: expect.stringContaining('time limit') });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels retry backoff at the refinement deadline too', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({}), { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetch);
    const result = refineBucketBuild(inv, idea, build, v(), () => {}, { views });
    await vi.advanceTimersByTimeAsync(75_000);
    expect((await result).build).toBe(build);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, 0.9])('compares a passing build without revealing the revision label (order %s)', async random => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const better = { ...v(), impressive: 5 };
    const pair = random < 0.5 ? { a: better, b: v(), preferred: 'A' } : { a: v(), b: better, preferred: 'B' };
    const fetch = vi.fn().mockResolvedValueOnce(reply(change)).mockResolvedValueOnce(reply({ ...pair, reason: 'A clearer stepped silhouette' }))
      .mockResolvedValueOnce(reply(better)).mockResolvedValueOnce(reply({ matchesSubject: true }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const result = await refineBucketBuild(inv, idea, build, v(), e => events.push(e), { views });
    expect(result.improved).toBe(true);
    expect(result.build.steps.flatMap(s => s.parts)[2].x).toBe(1);
    expect(events.find(e => e.phase === 'compared')).toMatchObject({ selected: 'refinement' });
    const prompt = JSON.parse(fetch.mock.calls[1][1].body).contents[0].parts.map((p: { text?: string }) => p.text ?? '').join('');
    expect(prompt).not.toContain('Stepped silhouette'); // builder's justification stays out
    expect(prompt).toContain('MODEL A');
    expect(prompt).toContain('MODEL B');
  });
  it('rejects a named comparison winner when the blind review does not recognize it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(change))
      .mockResolvedValueOnce(reply({ a: v(5), b: v(4), preferred: 'A', reason: 'Looks better' }))
      .mockResolvedValueOnce(reply({ ...v(5), looksLike: 'a fireplace' }))
      .mockResolvedValueOnce(reply({ matchesSubject: false })));
    const events: BuildEvent[] = [];
    const result = await refineBucketBuild(inv, idea, build, v(), e => events.push(e), { views });
    expect(result.build).toBe(build);
    expect(result.improved).toBe(false);
    expect(events.find(e => e.phase === 'judged')).toMatchObject({ pass: false, verdict: { recognizable: 2, review: 'blind-v1' } });
    expect(events.at(-1)).toMatchObject({ phase: 'compared', selected: 'original' });
  });
  it('keeps the exact original and its score when the revised model loses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(change)).mockResolvedValueOnce(reply({ a: v(3), b: v(4), preferred: 'B', reason: 'More coherent original' })));
    const prior = v();
    const result = await refineBucketBuild(inv, idea, build, prior, () => {}, { views });
    expect(result).toEqual({ build, verdict: prior, improved: false });
    expect(result.build).toBe(build);
  });
  it('bounds invalid proposals to one correction, without a trim or a visual comparison', async () => {
    const fetch = vi.fn().mockImplementation(async () => reply({ ...change, moves: [{ index: 2, x: 9, y: 0, z: 6, rot: 0 }] }));
    vi.stubGlobal('fetch', fetch);
    const result = await refineBucketBuild(inv, idea, build, v(), () => {}, { views });
    expect(result.build).toBe(build);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps the original when the optional service fails; cancellation still propagates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Service offline')));
    expect((await refineBucketBuild(inv, idea, build, v(), () => {}, { views })).build).toBe(build);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Stopped', 'AbortError')));
    await expect(refineBucketBuild(inv, idea, build, v(), () => {}, { views })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('subtracts reserved pieces for the core, then releases them to growth', async () => {
    const inventory = addPart(addPart(fullInv, parsePartId('plate-2x4-white')!, 1), parsePartId('slope-2x2-blue')!, 1);
    const plan = { composition: { dominantForm: 'Stepped tower with a narrower crown', depthLayers: ['Crown inset one stud from the shaft', 'Roof above the supported crown'], focalPoint: 'Upper observation opening', techniques: ['stepped-massing', 'recessed-bay'] }, features: [{ name: 'Roof', purpose: 'Cap the tower', parts: [{ partId: 'slope-2x2-blue', count: 1 }] }], colorZones: [{ zone: 'body', color: 'red' }] };
    const fetch = vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(developed(19)))
      .mockResolvedValueOnce(reply({ steps: [{ caption: 'Roof', parts: [p(57, 'slope-2x2-blue')] }] })).mockImplementation(async () => reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const result = await designBuild(inventory, idea, () => {});
    expect(constructionIssues(result!, counts(inventory))).toEqual([]);
    expect(result?.steps.flatMap(s => s.parts).at(-1)?.partId).toBe('slope-2x2-blue');
    const prompts = fetch.mock.calls.map(c => JSON.parse(c[1].body).contents[0].parts.map((p: { text?: string }) => p.text ?? '').join(' '));
    expect(prompts[0]).toContain('CONSTRUCTION LANGUAGE');
    for (const prompt of [prompts[1], prompts[2]]) {
      expect(prompt).toContain('Crown inset one stud from the shaft');
      expect(prompt).toContain('Bridge the jambs with a lintel touching both');
    }
    const plannerSchema = JSON.parse(fetch.mock.calls[0][1].body).generationConfig.responseSchema;
    expect(plannerSchema.required).toContain('composition');
    const coreSchema = JSON.parse(fetch.mock.calls[1][1].body).generationConfig.responseSchema;
    expect(coreSchema.properties.steps.items.properties.parts.items.properties.partId.enum).not.toContain('slope-2x2-blue');
    const growthSchema = JSON.parse(fetch.mock.calls[2][1].body).generationConfig.responseSchema;
    expect(growthSchema.properties.steps.items.properties.parts.items.properties.partId.enum).toContain('slope-2x2-blue');
  });
  it('refines an already passing build through the full design entrypoint', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ features: [], colorZones: [] })).mockResolvedValueOnce(reply(developed()))
      .mockResolvedValueOnce(reply({ steps: [] })).mockResolvedValueOnce(reply(v())).mockResolvedValueOnce(reply({ matchesSubject: true })).mockResolvedValueOnce(reply(emptyEdits));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    expect(await designBuild(fullInv, idea, e => events.push(e), { views })).toEqual(developed());
    expect(events.some(e => e.phase === 'rebuilding')).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'ready', improved: false, verdict: v() });
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
