import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { partCount, parsePartId, type Build } from './bricks';
import { MIN_FINISHED_PARTS, finishedSizeIssue } from './finished-build';
import { buildCounts, finishedRecipeFamilies, libraryFor, matchRecipe } from './library';
import type { Recipe } from './library-recipes';
import { refinementCandidate } from './build-quality';
import { loadDiscoveries, saveDiscovery } from './library-discoveries';
import { designBuild, frameRequest, ideasThatFit, type BuildEvent, type Verdict } from './gemini';
import { addPart, emptyInventory } from './inventory';
import { Builds, newCard, reduceCard, weak, type Card } from '../screens/Builds';

const fixture = (n: number): Build => ({ name: 'Tower', description: 'Connected validation fixture', steps: [{ caption: 'Layers', parts: Array.from({ length: n }, (_, z) => ({ partId: 'plate-2x2-red', x: 0, y: 0, z, rot: 0 })) }] });
const stock = { 'plate-2x2-red': 30 };
const inventory = addPart(emptyInventory(), parsePartId('plate-2x2-red')!, 30);
const idea = { name: 'Tower', pitch: 'A stepped tower', estimatedParts: 24, difficulty: 1, keyParts: [] };
const verdict: Verdict = { looksLike: 'tower', recognizable: 4, complete: 4, impressive: 4, colors: 4, fixes: [], review: 'blind-v1', subjectMatched: true };
const reply = (value: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 }));
const emptyEdits = { moves: [], removes: [], adds: [], recolors: [], changes: [], details: [] };
afterEach(() => vi.unstubAllGlobals());

describe('finished build standard', () => {
  it('requires twenty parts but keeps small construction modules available internally', () => {
    expect(MIN_FINISHED_PARTS).toBe(20);
    expect(finishedSizeIssue(fixture(19))).toContain('at least 20');
    expect(finishedSizeIssue(fixture(20))).toBeUndefined();
    const compact: Recipe = { id: 'compact', family: 'test', name: 'Compact', pitch: '', features: [], contrast: [], palette: { body: 'red' }, steps: [{ caption: 'Stack', parts: Array.from({ length: 7 }, (_, i) => ({ shape: 'brick-2x2', role: 'body', x: 0, y: 0, z: i * 3, rot: 0 })) }] };
    const match = matchRecipe(compact, stock)!;
    expect(partCount(match.build)).toBe(21); // seven slots become three plate layers each
    expect(libraryFor(stock, [compact])).toEqual([]); // fragmentation cannot qualify a tiny design
    expect(finishedRecipeFamilies().flat().every(r => r.steps.reduce((n, s) => n + s.parts.length, 0) >= 20)).toBe(true);
  });

  it('does not let refinement shrink a finished model below the floor', () => {
    const result = refinementCandidate(fixture(20), [{ op: 'remove', index: 19 }], stock, 30);
    expect(result.build).toBeUndefined();
    expect(result.issues.join(' ')).toContain('20');
  });

  it('rejects an undersized draft before spending requests on visual review', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ features: [], colorZones: [] })).mockResolvedValueOnce(reply(fixture(19))).mockImplementation(async () => reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    expect(await designBuild(inventory, idea, e => events.push(e), { views: () => ['data:image/png;base64,AA=='] })).toBeNull();
    expect(events.some(e => e.phase === 'judging' || e.phase === 'ready')).toBe(false);
    expect(events.at(-1)).toMatchObject({ phase: 'failed', reason: expect.stringContaining('at least 20') });
  });

  it('retains a draft when its final visual review fails instead of emitting ready', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ features: [], colorZones: [] })).mockResolvedValueOnce(reply(fixture(20)))
      .mockResolvedValueOnce(reply({ steps: [] })).mockResolvedValueOnce(reply({ ...verdict, impressive: 3, fixes: ['Shape the upper silhouette'] }))
      .mockResolvedValueOnce(reply({ matchesSubject: true })).mockResolvedValueOnce(reply(emptyEdits));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    expect(await designBuild(inventory, idea, e => events.push(e), { views: () => ['data:image/png;base64,AA=='] })).toBeNull();
    expect(events.some(e => e.phase === 'preview')).toBe(true);
    expect(events.some(e => e.phase === 'ready')).toBe(false);
    expect(events.at(-1)).toMatchObject({ phase: 'failed', reason: expect.stringContaining('visual quality review') });
  });

  it('makes no API calls when the bucket cannot supply twenty pieces', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const small = addPart(emptyInventory(), parsePartId('plate-2x2-red')!, 19);
    expect((await ideasThatFit(small)).ideas).toEqual([]);
    await expect(frameRequest(small, 'tower')).rejects.toThrow('at least 20');
    expect(await designBuild(small, idea, () => {})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not offer finished instructions for rejected or stale weak cards', () => {
    const noop = () => {};
    const html = (card: Card) => renderToStaticMarkup(createElement(Builds, { slots: [{ card, index: 0 }], tried: 1, ideasState: { status: 'done' }, requests: [], bucket: stock, library: [], onOpenLibrary: noop, onOpen: noop, onRetry: noop, onRetryIdeas: noop, onRequest: noop, onOpenRequest: noop, onRetryRequest: noop, onSuggest: noop, onDifferent: noop, onBench: noop }));
    for (const [build, v] of [[fixture(19), verdict], [fixture(20), { ...verdict, impressive: 3 }]] as const) {
      const card = reduceCard(newCard(idea), { phase: 'ready', build, verdict: v, partsUsed: partCount(build), seconds: 1, rounds: 0, improved: false }, 30);
      expect(card.phase).toBe('failed');
      expect(card.preview).toBe(build);
      expect(html(card)).toContain('Draft · needs improvement');
      expect(html(card)).not.toContain('>Build this');
      const stale: Card = { ...card, phase: 'ready', build };
      expect(weak(stale)).toBe(true);
      expect(html(stale)).not.toContain('>Build this');
    }
    expect(html({ ...newCard(idea), phase: 'ready', build: fixture(20), verdict })).toContain('>Build this');
    const failedCraft:Card={...newCard(idea),phase:'ready',build:fixture(20),verdict,craftPass:false};
    expect(weak(failedCraft)).toBe(true);expect(html(failedCraft)).toContain('Draft · needs improvement');expect(html(failedCraft)).not.toContain('>Build this');
  });

  it('filters legacy miniature discoveries without overwriting the stored data', () => {
    const small = fixture(19);
    const value = JSON.stringify({ version: 1, items: [{ id: 'old', build: small, verdict, savedAt: 1 }] });
    const store = { getItem: () => value, setItem: vi.fn() };
    expect(loadDiscoveries(store)).toEqual([]);
    expect(saveDiscovery(small, verdict, buildCounts(small), store).status).toBe('rejected');
    expect(store.setItem).not.toHaveBeenCalled();
  });
});
