import { beforeAll, describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import { isMade } from '../catalog';
import { parsePartId, type Build, type Placed } from '../bricks';
import { apply, compileConnections, connectionPairs, frame, requiredContactIssues, validateConnections } from '../connections';
import { animalSilhouetteKey } from './animal-silhouette';
import { composeModules, searchModuleCompositions } from './compose';
import { foxCraftIssues, foxCraftPlans } from './fox-craft';
import type { AssemblyComposition, AssemblyPlan } from './types';

const stock: Record<string, number> = Object.freeze({ ...large.stock });
const roles = ['frame', 'chest', 'hips', 'torso', 'neck', 'head', 'muzzle', 'eye-left', 'eye-right',
  'ear-left', 'ear-right', 'tail', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'];
const all = (c: AssemblyComposition) => c.build.steps.flatMap(s => s.parts);
const pp = (c: AssemblyComposition, role: string) => c.receipts.find(r => r.role === role)!.indices.map(i => all(c)[i]);
const count = (parts: Placed[]) => {
  const used: Record<string, number> = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
};
const bounds = (parts: Placed[]) => {
  const ff = parts.map(frame), min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a])) / 20);
  const max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])) / 20);
  return { min, max, size: max.map((n, a) => n - min[a]) };
};
const joined = (a: Placed[], b: Placed[]) => a.some(p => b.some(q => connectionPairs(frame(p), frame(q)).length));
const fragment = (c: AssemblyComposition, roles: string[]): Build => ({
  ...c.build, steps: [{ ...c.build.steps[0], parts: roles.flatMap(role => pp(c, role)) }], requiredContacts: undefined,
});
let plans: AssemblyPlan[], candidates: AssemblyComposition[];
beforeAll(() => {
  plans = foxCraftPlans(stock, 'Fox');
  candidates = plans.map(plan => composeModules(plan, stock, { minParts: 20, maxParts: 80 }));
});

describe('stock-coherent Fox craft constructions', () => {
  it('returns three complete canonical Fox plans with independently legal anatomy and eyes', () => {
    expect(plans.map(p => p.id)).toEqual(['animal-craft:fox:shallow-face', 'animal-craft:fox:broad-cheeks', 'animal-craft:fox:tapered-neck']);
    expect(candidates.map(c => all(c).length)).toEqual([40, 45, 40]);
    for (const c of candidates) {
      expect(c.plan.name).toBe('Fox');
      expect(c.plan.nodes.map(n => n.option.role).sort()).toEqual([...roles].sort());
      expect(c.receipts.map(r => r.role).sort()).toEqual([...roles].sort());
      expect(foxCraftIssues(c)).toEqual([]);
      expect(validateConnections(c.build, stock, 24)).toEqual([]);
      for (const node of c.plan.nodes) {
        const own = count(c.receipts.find(r => r.id === node.id)!.indices.map(i => all(c)[i]));
        const module = compileConnections(node.option.program, own);
        expect(validateConnections(module, own, 24)).toEqual([]);
        expect(node.option.program.operations.length).toBeLessThan(all(c).length);
        expect(module.steps.flatMap(s => s.parts).every(p => frame(p).bounds.min[2] >= 0)).toBe(true);
      }
    }
  });

  it('shares one exact original ledger across all roles without changing stock or immutable recipes', () => {
    const originalStock = JSON.stringify(stock), originalPlans = JSON.stringify(plans);
    for (const c of candidates) {
      const used = count(all(c)), billed: Record<string, number> = {};
      for (const r of c.receipts) for (const [id, amount] of Object.entries(r.cost)) billed[id] = (billed[id] ?? 0) + amount;
      expect(billed).toEqual(used);
      expect(new Set(c.receipts.flatMap(r => r.indices)).size).toBe(all(c).length);
      for (const [id, n] of Object.entries(used)) {
        expect(isMade(id)).toBe(true);
        expect(n).toBeLessThanOrEqual(stock[id]);
        expect(c.remaining[id]).toBe(stock[id] - n);
      }
      expect(used['slope-2x2-black']).toBe(2);
      expect(c.remaining['slope-2x2-black']).toBe(0);
      expect(used['curve-1x2-black']).toBe(2);
      const b = bounds(all(c));
      c.size.forEach((n, a) => expect(n).toBeCloseTo(b.size[a], 8));
    }
    expect(JSON.stringify(stock)).toBe(originalStock);
    expect(JSON.stringify(plans)).toBe(originalPlans);
  });

  it('changes the actual head, neck and shoulder solids rather than names, paint or part segmentation', () => {
    expect(new Set(candidates.map(c => animalSilhouetteKey(c.build))).size).toBe(3);
    expect(new Set(candidates.map(c => animalSilhouetteKey(fragment(c, ['head', 'neck', 'chest'])))).size).toBe(3);
    expect(new Set(candidates.map(c => bounds(pp(c, 'neck')).size.join(','))).size).toBe(3);
    expect(bounds(pp(candidates[0], 'neck')).size[2]).toBeCloseTo(1.2);
    expect(bounds(pp(candidates[1], 'neck')).size[2]).toBeCloseTo(.8);
    expect(bounds(pp(candidates[2], 'neck')).size[2]).toBeCloseTo(.4);
    expect(pp(candidates[0], 'chest').filter(p => parsePartId(p.partId)?.type === 'curve')).toHaveLength(2);
    for (const c of candidates.slice(1)) expect(pp(c, 'head').filter(p => parsePartId(p.partId)?.type === 'curve')).toHaveLength(2);
    expect(pp(candidates[0], 'neck').some(p => p.partId === 'slope-2x2-reddish-brown')).toBe(true);
    expect(pp(candidates[2], 'chest').some(p => p.partId === 'slope-2x2-reddish-brown')).toBe(true);
  });

  it('gives the two black slopes real mirrored inward-tapering ear clutches and a white shaped tail tip', () => {
    for (const c of candidates) {
      const peakX: number[] = [];
      for (const [i, role] of ['ear-left', 'ear-right'].entries()) {
        expect(pp(c, role)).toHaveLength(1);
        const p = pp(c, role)[0], f = frame(p);
        expect(p.partId).toBe('slope-2x2-black');
        expect(joined([p], pp(c, 'head'))).toBe(true);
        expect(apply(f.rotation, [0, -1, 0])).toEqual(i ? [-1, 0, 0] : [1, 0, 0]);
        const top = f.ports.filter(p => p.kind === 'stud');
        expect(top).toHaveLength(2);
        peakX.push(top.reduce((n, p) => n + p.point[0], 0) / top.length / 20);
      }
      // Low lips meet in the middle. The actual high rows are three studs apart.
      expect(peakX[1] - peakX[0]).toBe(3);
      expect(pp(c, 'tail').filter(p => p.partId === 'slope-2x2-white')).toHaveLength(1);
      expect(pp(c, 'tail').some(p => p.partId === 'curve-1x2-black')).toBe(false);
      expect(joined(pp(c, 'tail'), pp(c, 'hips'))).toBe(true);
    }
  });

  it('attaches thin plated muzzles and raised separate eyes to real carriers rather than studless curve lips', () => {
    for (const c of candidates) {
      expect(pp(c, 'muzzle').every(p => ['plate', 'tile', 'roundplate'].includes(parsePartId(p.partId)!.type))).toBe(true);
      expect(bounds(pp(c, 'muzzle')).size[2]).toBeCloseTo(1.2);
      const nose = pp(c, 'muzzle').find(p => parsePartId(p.partId)?.color === 'black')!;
      for (const role of ['eye-left', 'eye-right']) {
        expect(pp(c, role).map(p => p.partId)).toEqual(['plate-1x1-dark-gray']);
        expect(joined(pp(c, role), pp(c, 'head'))).toBe(true);
        expect(bounds(pp(c, role)).min[2]).toBeGreaterThan(bounds([nose]).max[2]);
      }
      expect(joined(pp(c, 'muzzle'), pp(c, 'head'))).toBe(true);
      const curves = ['head', 'chest'].flatMap(role => pp(c, role)).filter(p => parsePartId(p.partId)?.type === 'curve');
      for (const curve of curves) expect(frame(curve).ports.every(p => p.kind === 'grip')).toBe(true);
      expect(all(c).some(p => /sidebrick|bracket|jumper/.test(p.partId))).toBe(false);
    }
  });

  it('preserves every recipe closure and exact intermodule anchor after legal ground ordering', () => {
    for (const c of candidates) {
      expect(requiredContactIssues(all(c), c.build.requiredContacts)).toEqual([]);
      for (const node of c.plan.nodes) {
        const own = c.receipts.find(r => r.id === node.id)!;
        for (const contact of node.option.program.requiredContacts!) expect(c.build.requiredContacts).toContainEqual({
          ...contact, a: own.indices[contact.a], b: own.indices[contact.b],
        });
        if (node.attachment) {
          const a = node.attachment, parent = c.receipts.find(r => r.id === a.parent)!;
          expect(c.build.requiredContacts).toContainEqual({ a: parent.indices[a.parentPart], b: own.indices[0], aPort: a.parentPort, bPort: a.childPort });
        }
      }
      for (const role of roles.filter(r => r.startsWith('leg-'))) {
        expect(bounds(pp(c, role)).min[2]).toBe(0);
        expect(joined(pp(c, role), pp(c, 'frame'))).toBe(true);
      }
    }
    const moved = structuredClone(candidates[0]);
    pp(moved, 'ear-left')[0].x += 1;
    expect(requiredContactIssues(all(moved), moved.build.requiredContacts).length).toBeGreaterThan(0);
    expect(foxCraftIssues(moved).length).toBeGreaterThan(0);
  });
});

describe('bounded fail-closed Fox craft policy', () => {
  it('labels supported actual adaptations Fox and rejects unknown classes and misleading compounds', () => {
    expect(foxCraftPlans(stock, 'Red fox').map(p => p.name)).toEqual(['Fox', 'Fox', 'Fox']);
    expect(foxCraftPlans(stock, 'Golden retriever').map(p => p.name)).toEqual(['Fox', 'Fox', 'Fox']);
    for (const name of ['Foxglove', 'Sea fox', 'Dogfish', 'Rabbit', 'Giraffe', 'Bird', 'Dinosaur', 'Dog or fox', 'Boxer', 'fox'.repeat(100)]) expect(foxCraftPlans(stock, name)).toEqual([]);
    expect(plans.every(p => !/breed|working|movable|qualifi|beaut/i.test(p.description))).toBe(true);
  });

  it('returns no partial candidate after stock scarcity, malformed inputs or callback rejection', () => {
    for (const id of ['slope-2x2-black', 'curve-1x2-black', 'plate-1x2-black', 'roundbrick-1x1-tan']) {
      expect(foxCraftPlans({ ...stock, [id]: stock[id] - 1 }, 'Fox')).toEqual([]);
    }
    expect(foxCraftPlans({}, 'Fox')).toEqual([]);
    expect(foxCraftPlans({ ...stock, 'slope-2x2-black': NaN }, 'Fox')).toEqual([]);
    expect(foxCraftPlans({ ...stock, 'slope-2x2-black': -1 }, 'Fox')).toEqual([]);
    expect(() => composeModules(plans[0], { ...stock, 'slope-2x2-black': 1 })).toThrow(/Shared stock exhausted/);
    const rejected = searchModuleCompositions(plans, stock, { minParts: 20, maxParts: 80, limit: 3, maxAttempts: 3, maxMillis: 10_000, validate: () => ['Rejected by rendered phenotype gate.'] });
    expect(rejected.candidates).toEqual([]);
    expect(rejected.rejected).toBe(3);
    const bounded = searchModuleCompositions(plans, stock, { minParts: 20, maxParts: 80, limit: 3, maxAttempts: 1, maxMillis: 10_000, validate: foxCraftIssues });
    expect(bounded.attempts).toBe(1);
    expect(bounded.candidates).toHaveLength(1);
  });

  it('rejects false species labels, lost anatomy, corrupt ownership and mixed-unit size claims', () => {
    expect(foxCraftIssues(null as unknown as AssemblyComposition)).toEqual(['Unsupported or noncanonical Fox craft plan.']);
    const renamed = structuredClone(candidates[0]); renamed.plan.name = 'Dog'; renamed.build.name = 'Dog';
    expect(foxCraftIssues(renamed).join(' ')).toContain('noncanonical');
    const missing = structuredClone(candidates[0]); missing.receipts.pop();
    expect(foxCraftIssues(missing).join(' ')).toContain('separate anatomical');
    const owned = structuredClone(candidates[0]); owned.receipts[1].indices[0] = owned.receipts[0].indices[0];
    expect(foxCraftIssues(owned).join(' ')).toContain('exactly once');
    const billed = structuredClone(candidates[0]); billed.receipts[0].cost['plate-1x4-reddish-brown']++;
    expect(foxCraftIssues(billed).join(' ')).toContain('exact module costs');
    const size = structuredClone(candidates[0]); size.size[2] /= .4;
    expect(foxCraftIssues(size).join(' ')).toContain('studs');
    const tooMany = structuredClone(candidates[0]); tooMany.build.steps[0].parts = Array.from({ length: 81 }, () => all(candidates[0])[0]);
    expect(foxCraftIssues(tooMany).join(' ')).toContain('20–80');
  });

  it('rejects disconnected noses/eyes, ground padding, displaced feet and reversed ear peaks', () => {
    const mutations: [string, (c: AssemblyComposition) => void][] = [
      ['grounded legs', c => pp(c, 'leg-front-left').forEach(p => { p.z += 1; })],
      ['open belly', c => pp(c, 'torso').forEach(p => { p.z -= 4; })],
      ['dark eyes', c => pp(c, 'eye-left')[0].partId = 'plate-1x1-white'],
      ['front nose', c => pp(c, 'muzzle').find(p => p.partId === 'plate-1x2-black')!.y += 1],
      ['inward-tapering', c => { const p = pp(c, 'ear-left')[0]; p.orientation = undefined; p.rot = 270; }],
      ['rear tail', c => pp(c, 'tail').forEach(p => { p.y -= 4; })],
    ];
    for (const [text, mutate] of mutations) {
      const c = structuredClone(candidates[0]); mutate(c);
      expect(foxCraftIssues(c).join(' '), text).toContain(text);
    }
  });
});
