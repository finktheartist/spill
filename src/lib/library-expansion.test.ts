import { afterEach, describe, expect, it, vi } from 'vitest';
import { assemble, layer, part, platform, studs, type Module } from './recipe-kit';
import { RECIPES } from './library-recipes';
import { buildCounts, recipeExample } from './library';
import { assemblyCandidates, assemblyText } from './library-context';
import { discoveryEntries, geometryFingerprint, loadDiscoveries, saveDiscovery, type StorageLike } from './library-discoveries';
import { counts, sampleInventory } from './inventory';
import { constructionIssues } from './construction';
import { designBuild, type BuildEvent, type Idea, type Verdict } from './gemini';
import type { Build } from './bricks';

afterEach(() => vi.unstubAllGlobals());
const reply = (value: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 }));
const storage = (): StorageLike => { const values = new Map<string, string>(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } }; };
const verdict: Verdict = { looksLike: 'A small stepped sculpture', recognizable: 4, complete: 4, colors: 4, impressive: 4, fixes: [], review: 'blind-v1', subjectMatched: true };
const build: Build = { name: 'Stepped Sculpture', description: 'Connected validation fixture.', steps: [
  { caption: 'Feet', parts: [{ partId: 'brick-2x2-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-2x2-red', x: 2, y: 0, z: 0, rot: 0 }] },
  { caption: 'Bridge', parts: [{ partId: 'brick-2x4-red', x: 0, y: 0, z: 3, rot: 0 }] },
  { caption: 'Top', parts: [{ partId: 'plate-1x2-red', x: 1, y: 0, z: 6, rot: 0 }] },
  { caption: 'Layers', parts: Array.from({ length: 16 }, (_, i) => ({ partId: 'plate-2x2-red', x: 1, y: 0, z: 7 + i, rot: 0 })) },
] };

describe('modular catalog', () => {
  it('contains distinct subjects, unique IDs and actual structural variation', () => {
    expect(new Set(RECIPES.map(r => r.family)).size).toBeGreaterThanOrEqual(30);
    expect(new Set(RECIPES.map(r => r.id)).size).toBe(RECIPES.length);
    const shapes = new Set(RECIPES.map(r => geometryFingerprint(recipeExample(r))));
    expect(shapes.size).toBeGreaterThanOrEqual(90);
    expect(RECIPES.filter(r => r.modules && r.modules.length > 1).length).toBeGreaterThan(25);
  });
  it('rejects unknown sockets, oversized inlets, duplicate keys and detached roots', () => {
    const module: Module = { id: 'test', label: 'Test', inlet: studs(0, 0, 0, 6, 4), steps: [] };
    const root = { key: 'base', module: platform(4, 4) };
    expect(() => assemble([root, { key: 'top', module, parent: 'base', socket: 'missing' }])).toThrow('Incompatible attachment');
    expect(() => assemble([root, { key: 'top', module, parent: 'base', socket: 'top' }])).toThrow('Incompatible attachment');
    expect(() => assemble([root, root])).toThrow('Duplicate module key');
    expect(() => assemble([root, { key: 'second', module }])).toThrow('one connected root');
  });
  it('translates a child from its inlet to the parent socket without changing local geometry', () => {
    const m: Module = { id: 'cap', label: 'Cap', inlet: studs(0, 0, 0, 2, 2), steps: [layer('Cap', part('brick-2x2', 'body', 0, 0, 0))] };
    const assembled = assemble([{ key: 'base', module: platform(6, 6, 2, 2) }, { key: 'cap', module: m, parent: 'base', socket: 'top' }]);
    expect(assembled.steps[1].parts[0]).toMatchObject({ x: 2, y: 2, z: 1 });
    expect(m.steps[0].parts[0]).toMatchObject({ x: 0, y: 0, z: 0 });
  });
  it('retrieves only related stock-valid assemblies and includes connection information', () => {
    const have = counts(sampleInventory()), matches = assemblyCandidates('townhouse', have);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.recipeId).toContain('townhouse');
      expect(constructionIssues(m.build, have, 24)).toEqual([]);
    }
    expect(assemblyText(matches)).toContain('Feature allocations');
    expect(assemblyCandidates('octopus', have)).toEqual([]);
    expect(assemblyCandidates('townhouse', {})).toEqual([]);
  });
  it('uses the planner-selected assembly as the actual core and deducts its pieces before growth', async () => {
    const inv = sampleInventory(), have = counts(inv), seed = assemblyCandidates('townhouse', have)[0];
    const fetch = vi.fn().mockResolvedValueOnce(reply({ assemblyId: seed.recipeId, features: [], colorZones: [] })).mockImplementation(async () => reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const idea: Idea = { name: 'Townhouse', pitch: 'A developed house with open window bays.', estimatedParts: 20, difficulty: 1, keyParts: [] };
    const result = await designBuild(inv, idea, e => events.push(e));
    expect(result).not.toBeNull();
    expect(geometryFingerprint(result!)).toBe(geometryFingerprint(seed.build));
    expect(result!.source).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2); // planning and optional growth, no invented core
    const prompts = fetch.mock.calls.map(c => JSON.parse(c[1].body).contents[0].parts.map((p: { text?: string }) => p.text ?? '').join('\n'));
    expect(prompts[0]).toContain('CHECKED MODULAR STARTING ASSEMBLIES');
    expect(prompts[1]).toContain('Remaining pieces only');
    expect(events.some(e => e.phase === 'kept' && e.reason.includes('checked'))).toBe(true);
    expect(constructionIssues(result!, have, 24)).toEqual([]);
  });
});

describe('local discovery library', () => {
  it('persists a qualified build and rechecks it against each new bucket', () => {
    const store = storage(), have = buildCounts(build);
    const result = saveDiscovery(build, verdict, have, store);
    expect(result.status).toBe('saved');
    const loaded = loadDiscoveries(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].build.source?.kind).toBe('discovery');
    expect(discoveryEntries(loaded, have)[0].match).not.toBeNull();
    expect(discoveryEntries(loaded, {})[0].match).toBeNull();
  });
  it('does not save an unreviewed, weak, mismatched, floating or over-budget build', () => {
    const store = storage(), have = buildCounts(build);
    for (const v of [undefined, { ...verdict, impressive: 3 }, { ...verdict, review: undefined }, { ...verdict, subjectMatched: false }]) expect(saveDiscovery(build, v, have, store).status).toBe('rejected');
    expect(saveDiscovery(build, verdict, {}, store).status).toBe('rejected');
    const bad = structuredClone(build); bad.steps[2].parts[0].z = 20;
    expect(saveDiscovery(bad, verdict, have, store).status).toBe('rejected');
    expect(loadDiscoveries(store)).toEqual([]);
  });
  it('deduplicates recolors and translated models, and skips existing catalog shapes', () => {
    const store = storage();
    expect(saveDiscovery(build, verdict, buildCounts(build), store).status).toBe('saved');
    const recolor = structuredClone(build);
    recolor.name = 'Another name';
    for (const p of recolor.steps.flatMap(s => s.parts)) { p.partId = p.partId.replace('red', 'blue'); p.x += 3; p.y += 2; }
    expect(saveDiscovery(recolor, verdict, buildCounts(recolor), store).status).toBe('duplicate');
    const existing = recipeExample(RECIPES.find(r => r.id === 'townhouse-corner-studio')!);
    expect(saveDiscovery(existing, verdict, buildCounts(existing), store).status).toBe('duplicate');
    expect(loadDiscoveries(store)).toHaveLength(1);
  });
  it('ignores corrupt storage, unknown shapes, unsafe sizes and malformed assemblies', () => {
    for (const text of ['{', JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: [{ id: 'bad', savedAt: 1, verdict, build: { ...build, steps: [{ caption: '', parts: [{ partId: 'plate-999x999-red', x: 0, y: 0, z: 0, rot: 0 }] }] } }] })]) {
      const store = storage(); store.setItem('spill.discoveries.v1', text); expect(loadDiscoveries(store)).toEqual([]);
    }
  });
  it('reports full/unavailable storage without breaking a completed build', () => {
    const store: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveDiscovery(build, verdict, buildCounts(build), store).status).toBe('unavailable');
  });
});
