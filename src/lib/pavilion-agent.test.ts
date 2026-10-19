import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { designBuild, type BuildEvent } from './gemini';
import * as allocator from './pavilion-fit';
import { pavilionCandidates, type PavilionAllocation } from './pavilion-modules';
import { parsePartId } from './bricks';
import type { Inventory } from './inventory';
import data from '../../test/fixtures/photo-stock.json';

const inv: Inventory = { source: 'photo', photos: [], others: [], parts: Object.fromEntries(Object.entries(data.stock).map(([id, count]) => [id, { kind: parsePartId(id)!, count, confidence: .8, boxes: [] }])) };
const idea = { name: 'Timber gazebo', pitch: 'Open timber pavilion with a layered roof', estimatedParts: 60, difficulty: 3, keyParts: [] };
const good = { looksLike: 'wooden gazebo', recognizable: 4, complete: 4, impressive: 4, colors: 4, fixes: [] };
const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
let allocation: PavilionAllocation;
beforeAll(() => { allocation = pavilionCandidates(data.stock); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() { vi.spyOn(allocator, 'allocatePavilions').mockImplementation(async () => structuredClone(allocation)); }
const views = () => ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,AQ==', 'data:image/jpeg;base64,Ag=='];

it('normal requests compare actual rendered alternatives before an anonymous quality review', async () => {
  setup(); const events: BuildEvent[] = [], fetch = vi.fn().mockResolvedValueOnce(reply({ candidateId: allocation.candidates[0].id, reason: 'Open proportions' })).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({ matchesSubject: true })); vi.stubGlobal('fetch', fetch);
  const build = await designBuild(inv, idea, e => events.push(e), { views });
  expect(build).not.toBeNull(); expect(events.at(-1)?.phase).toBe('ready'); expect(fetch).toHaveBeenCalledTimes(3);
  const selection = JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts;
  expect(selection.filter((p: { inlineData?: unknown }) => p.inlineData)).toHaveLength(9);
  const blind = fetch.mock.calls[1][1].body; expect(blind).not.toContain('Timber gazebo'); expect(blind).not.toContain('pavilion-hipped');
});
it('keeps weak models as drafts, excludes previously tried geometry and restores the better draft', async () => {
  setup(); const fetch = vi.fn(), events: BuildEvent[] = [];
  for (const [i, score] of [[0, 3], [1, 2]]) fetch.mockResolvedValueOnce(reply({ candidateId: allocation.candidates[i].id, reason: 'Shape' })).mockResolvedValueOnce(reply({ ...good, impressive: score })).mockResolvedValueOnce(reply({ matchesSubject: true }));
  vi.stubGlobal('fetch', fetch);
  expect(await designBuild(inv, idea, e => events.push(e), { views })).toBeNull();
  expect(events.some(e => e.phase === 'ready')).toBe(false); expect(events.filter(e => e.phase === 'judged').at(-1)).toMatchObject({ pass: false, verdict: { impressive: 3 } });
  expect(JSON.parse(fetch.mock.calls[3][1].body).generationConfig.responseSchema.properties.candidateId.enum).not.toContain(allocation.candidates[0].id);
});
it('does not review a repeated candidate or promote a mismatched subject', async () => {
  setup(); const id = allocation.candidates[0].id, fetch = vi.fn().mockResolvedValueOnce(reply({ candidateId: id })).mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(reply({ matchesSubject: false })).mockResolvedValueOnce(reply({ candidateId: id })); vi.stubGlobal('fetch', fetch);
  const events: BuildEvent[] = []; expect(await designBuild(inv, idea, e => events.push(e), { views })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(4); expect(events.filter(e => e.phase === 'looking')).toHaveLength(1); expect(events.some(e => e.phase === 'ready')).toBe(false);
});
it('cancels at the preview boundary before spending on review', async () => {
  setup(); const controller = new AbortController(), fetch = vi.fn().mockImplementation(async () => reply({ candidateId: allocation.candidates[0].id })); vi.stubGlobal('fetch', fetch);
  expect(await designBuild(inv, idea, e => { if (e.phase === 'preview') controller.abort(); }, { views, signal: controller.signal })).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('validates worker output before exposing or reviewing it', async () => {
  const bad = structuredClone(allocation); bad.candidates[0].build.steps[1].parts[0].partId = 'brick-2x3-red';
  vi.spyOn(allocator, 'allocatePavilions').mockResolvedValue(bad); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const events: BuildEvent[] = []; expect(await designBuild(inv, idea, e => events.push(e), { views })).toBeNull(); expect(fetch).not.toHaveBeenCalled(); expect(events.some(e => e.phase === 'preview')).toBe(false);
});
