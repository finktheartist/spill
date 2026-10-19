import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileComponents } from './component-kit';
import { componentPlans } from './build-components';
import { componentCandidates } from './component-planner';
import { builderAssemblies, assemblyText } from './library-context';
import { buildCounts, matchContext, matchRecipe, recipeExample } from './library';
import { constructionIssues } from './construction';
import { counts, sampleInventory } from './inventory';
import { partCount, voxels, parsePartId } from './bricks';
import { designBuild, type BuildEvent } from './gemini';
import { isMade } from './catalog';

import scans from './fixtures/library-stock.json';
const plans = ['dog', 'cat', 'fox', 'wolf', 'cottage', 'pickup', 'flatbed'].flatMap(componentPlans);
const volume = (b: ReturnType<typeof recipeExample>) => b.steps.flatMap(s => s.parts).flatMap(p => voxels(parsePartId(p.partId)!, p).map(c => c.join(','))).sort();
afterEach(() => vi.unstubAllGlobals());

describe('executable building components', () => {
  it.each(plans.map(p => [p.id, p] as const))('%s has real interface contacts and legal assembly steps', (_id, plan) => {
    const { recipe, summary } = compileComponents(plan), build = recipeExample(recipe);
    expect(constructionIssues(build, buildCounts(build), 24)).toEqual([]);
    expect(Object.keys(buildCounts(build)).every(isMade)).toBe(true);
    expect(summary.interfaces).toHaveLength(plan.mounts.length - 1);
    expect(summary.interfaces.every(p => p.contacts >= 2)).toBe(true);
    for (let n = 1; n <= build.steps.length; n++) expect(constructionIssues({ ...build, steps: build.steps.slice(0, n) }, buildCounts(build), 24).filter(i => i.kind !== 'loose')).toEqual([]);
  });
  it('rejects wrong interfaces, occupied sockets and invented contact surfaces', () => {
    const original = componentPlans('dog')[0];
    const wrong = structuredClone(original); wrong.mounts[1].component.inlet!.contract = 'wall-ring-6x4';
    expect(() => compileComponents(wrong)).toThrow('Incompatible');
    const consumed = structuredClone(original); consumed.mounts.push({ ...consumed.mounts[1], key: 'second-head' });
    expect(() => compileComponents(consumed)).toThrow('Occupied');
    const falsePort = structuredClone(original); falsePort.mounts[0].component.ports!.head.z++;
    expect(() => compileComponents(falsePort)).toThrow('missing or covered');
    const duplicate = structuredClone(original); duplicate.mounts[0].component.ports!.head.pads = [[0,0],[0,0]];
    expect(() => compileComponents(duplicate)).toThrow('Invalid component interface');
    const missingGrip = structuredClone(original); missingGrip.mounts[1].component.inlet!.x += 10;
    expect(() => compileComponents(missingGrip)).toThrow('real interface contacts');
    const unknown = structuredClone(original); unknown.mounts[1].component.steps[0].parts[0].shape = 'plate-99x99';
    expect(() => compileComponents(unknown)).toThrow('Unknown component shape');
  });
  it('recognizes supported plural subjects without matching unrelated compounds', () => {
    expect(componentPlans('wolves').map(p => p.id)).toEqual(componentPlans('wolf').map(p => p.id));
    expect(componentPlans('puppies').length).toBeGreaterThan(0);
    expect(componentPlans('birdhouse')).toEqual([]);
  });
  it('checks whole geometry even when the port itself matches', () => {
    const bad = structuredClone(componentPlans('dog')[0]);
    bad.mounts[1].component.steps[0].parts.push({ ...bad.mounts[1].component.steps[0].parts[0] });
    expect(() => compileComponents(bad)).toThrow('overlaps');
  });
  it('fits alternatives to photo stock without changing stock or replacing the silhouette', () => {
    const have: Record<string, number> = scans.photo4, before = structuredClone(have);
    for (const subject of ['dog', 'cat', 'cottage']) {
      const matches = componentCandidates(subject, have, 89);
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        expect(constructionIssues(m.build, have, 24)).toEqual([]);
        const plan = componentPlans(subject).find(p => p.id === m.componentPlan!.planId)!;
        expect(volume(m.build)).toEqual(volume(recipeExample(compileComponents(plan).recipe)));
        expect(partCount(m.build)).toBeGreaterThanOrEqual(20);
        expect(partCount(m.build)).toBeLessThanOrEqual(89);
        for (const [id, n] of Object.entries(m.parts)) expect(n).toBeLessThanOrEqual(have[id] ?? 0);
      }
    }
    expect(have).toEqual(before);
    expect(componentCandidates('pickup', have, 89)).toEqual([]);
    expect(componentCandidates('dog', have, 19)).toEqual([]);
    expect(componentCandidates('airplane', have, 89)).toEqual([]);
    expect(componentCandidates('dog', {}, 89)).toEqual([]);
  }, 15000);
  it('jointly allocates components and rejects a shortage of their shared structural parts', () => {
    const r = compileComponents(componentPlans('dog')[0]).recipe;
    const stock = buildCounts(recipeExample(r));
    expect(matchRecipe(r, stock)).not.toBeNull();
    for (const k of Object.keys(stock).filter(k => k.includes('reddish-brown'))) stock[k] = 0;
    expect(matchRecipe(r, stock)).toBeNull();
  });
  it('keeps color boundaries across exact, split, mixed and cached replacement search', () => {
    const r = compileComponents(componentPlans('pickup')[0]).recipe;
    const stock = counts(sampleInventory()), ctx = matchContext(stock);
    expect(matchRecipe({ ...r, allowedColors: undefined }, stock, ctx)).not.toBeNull();
    const constrained = matchRecipe(r, stock, ctx)!;
    expect(constrained).not.toBeNull();
    const chassis = constrained.features!.find(f => f.name === 'Low deck on two complete wheel assemblies')!;
    expect(Object.keys(chassis.parts).every(k => ['black','dark-gray','light-gray'].includes(parsePartId(k)!.color))).toBe(true);
    const onlyGreen = Object.fromEntries(Object.entries(stock).filter(([id]) => !id.startsWith('plate-') || id.endsWith('-green')));
    expect(matchRecipe(r, onlyGreen)).toBeNull();
  }, 10000);
  it('executes the chosen plan without asking the model to reconstruct its coordinates', async () => {
    const inv = sampleInventory(), stock = counts(inv);
    const seed = builderAssemblies('pickup', stock, 119).find(m => m.componentPlan)!;
    expect(assemblyText([seed])).toContain('COMPILED COMPONENT PLAN');
    const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
    const fetch = vi.fn().mockResolvedValueOnce(reply({ assemblyId: seed.recipeId, features: [], colorZones: [] })).mockImplementation(async () => reply({ steps: [] }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const build = await designBuild(inv, { name: 'Pickup', pitch: 'Low truck with a deep empty bed.', difficulty: 2, estimatedParts: 40, keyParts: [] }, e => events.push(e));
    expect(build).not.toBeNull();
    expect(build!.steps).toEqual(seed.build.steps);
    expect(constructionIssues(build!, stock, 24)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1); // complete modules do not trigger unreviewed additive growth
    expect(events.some(e => e.phase === 'section')).toBe(false);
    expect(events.some(e => e.phase === 'preview' && e.build.steps.length === seed.build.steps.length)).toBe(true);
    // Omitted views test execution only; this is NOT a visual-quality pass.
  }, 15000);
  it('reviews a complete component model before edits and still rejects a poor appearance score', async () => {
    const inv = sampleInventory(), seed = componentCandidates('pickup', counts(inv), 119)[0];
    const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply({ assemblyId: seed.recipeId, features: [], colorZones: [] }))
      .mockResolvedValueOnce(reply({ looksLike: 'red pickup truck', recognizable: 4, complete: 3, colors: 4, impressive: 2, fixes: ['Improve proportions.'] }))
      .mockResolvedValueOnce(reply({ matchesSubject: true }))
      .mockImplementation(async () => reply({ removes: [], moves: [], recolors: [], adds: [], changes: [], details: [] }));
    vi.stubGlobal('fetch', fetch);
    const events: BuildEvent[] = [];
    const result = await designBuild(inv, { name: 'Pickup', pitch: 'A low pickup truck.', difficulty: 2, estimatedParts: 40, keyParts: [] }, e => events.push(e), { views: () => ['data:image/jpeg;base64,AA=='] });
    expect(result).toBeNull();
    expect(events.some(e => e.phase === 'section')).toBe(false);
    expect(events.findIndex(e => e.phase === 'judged')).toBeLessThan(events.findIndex(e => e.phase === 'rebuilding'));
    expect(events.some(e => e.phase === 'ready')).toBe(false);
    expect(events.some(e => e.phase === 'failed' && e.reason.includes('visual quality'))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
  }, 15000);

});
