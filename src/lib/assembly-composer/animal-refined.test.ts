import { beforeAll, describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import { parsePartId, type Placed } from '../bricks';
import { compileConnections, connectionPairs, definition, frame, requiredContactIssues, validateConnections } from '../connections';
import { animalSilhouetteKey } from './animal-silhouette';
import { composeModules, searchModuleCompositions } from './compose';
import { refinedAnimalIssues, refinedAnimalPlans } from './animal-refined';
import type { AssemblyComposition, AssemblyPlan } from './types';

const stock: Record<string, number> = Object.freeze({ ...large.stock });
const roles = ['frame', 'chest', 'hips', 'torso', 'neck', 'head', 'face', 'muzzle', 'ear-left', 'ear-right', 'tail',
  'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'];
const all = (c: AssemblyComposition) => c.build.steps.flatMap(s => s.parts);
const pp = (c: AssemblyComposition, role: string) => c.receipts.find(r => r.role === role)!.indices.map(i => all(c)[i]);
const cost = (p: AssemblyPlan) => {
  const counts: Record<string, number> = {};
  for (const n of p.nodes) for (const op of n.option.program.operations) counts[op.partId] = (counts[op.partId] ?? 0) + 1;
  return counts;
};
const bounds = (parts: Placed[]) => {
  const f = parts.map(frame), min = [0, 1, 2].map(a => Math.min(...f.map(f => f.bounds.min[a])) / 20);
  const max = [0, 1, 2].map(a => Math.max(...f.map(f => f.bounds.max[a])) / 20);
  return { min, max, size: max.map((v, a) => v - min[a]) };
};
const joined = (a: Placed[], b: Placed[]) => a.some(p => b.some(q => connectionPairs(frame(p), frame(q)).length));
let plans: AssemblyPlan[], models: AssemblyComposition[], bearModel: AssemblyComposition, foxModel: AssemblyComposition;
beforeAll(() => {
  plans = refinedAnimalPlans(stock, 'Animal');
  models = plans.map(p => composeModules(p, stock));
  bearModel = models.find(c => c.plan.name === 'Bear')!;
  foxModel = models.find(c => c.plan.name === 'Fox')!;
});

describe('explicit refined animal recipes', () => {
  it('returns complete canonical plans using fifteen real independently compiled anatomical modules', () => {
    expect(Object.values(stock).reduce((n, v) => n + v, 0)).toBe(408);
    expect(plans.map(p => p.id)).toEqual(['animal-refined:dog:raised', 'animal-refined:dog:inverted', 'animal-refined:fox:sweeping', 'animal-refined:bear:compact']);
    expect(models.map(c => all(c).length)).toEqual([40, 40, 42, 36]);
    for (const c of models) {
      expect(c.plan.nodes.map(n => n.option.role).sort()).toEqual([...roles].sort());
      expect(c.receipts.map(r => r.role).sort()).toEqual([...roles].sort());
      expect(c.plan.nodes.every(n => n.option.program.operations.length < all(c).length)).toBe(true);
      expect(validateConnections(c.build, stock, 24)).toEqual([]);
      expect(refinedAnimalIssues(c)).toEqual([]);
      for (const n of c.plan.nodes) {
        const own: Record<string, number> = {};
        for (const op of n.option.program.operations) own[op.partId] = (own[op.partId] ?? 0) + 1;
        const b = compileConnections(n.option.program, own);
        expect(validateConnections(b, own, 24)).toEqual([]);
      }
    }
  });

  it('keeps exact input stock immutable and bills every module against one original ledger', () => {
    const before = JSON.stringify(stock), original = JSON.stringify(plans);
    for (const c of models) {
      const billed = cost(c.plan), receipts: Record<string, number> = {};
      for (const r of c.receipts) for (const [id, amount] of Object.entries(r.cost)) receipts[id] = (receipts[id] ?? 0) + amount;
      expect(receipts).toEqual(billed);
      for (const [id, amount] of Object.entries(billed)) {
        expect(amount).toBeLessThanOrEqual(stock[id]);
        expect(c.remaining[id]).toBe(stock[id] - amount);
      }
      expect(new Set(c.receipts.flatMap(r => r.indices)).size).toBe(all(c).length);
    }
    // Alternatives receive the full original pile. Dog and Bear jointly would
    // require six of a plate that the bucket has four of.
    expect(cost(plans[0])['plate-2x4-reddish-brown'] + cost(bearModel.plan)['plate-2x4-reddish-brown']).toBe(6);
    expect(JSON.stringify(stock)).toBe(before);
    expect(JSON.stringify(plans)).toBe(original);
    expect(cost(plans[0])['plate-1x4-reddish-brown']).toBe(3);
    expect(cost(plans[0])['plate-1x4-tan']).toBeUndefined();
  });

  it('has actual full-width bodies, an interlocked lower waist and four aligned grounded load paths', () => {
    for (const c of models) {
      const canine = c.plan.name !== 'Bear', body = bounds(['chest', 'torso', 'hips'].flatMap(r => pp(c, r)));
      expect(body.size.slice(0, 2)).toEqual(canine ? [3, 8] : [4, 6]);
      expect(bounds(pp(c, 'torso')).size[2]).toBeCloseTo(1.2);
      expect(bounds(pp(c, 'chest')).max[2] - bounds(pp(c, 'torso')).max[2]).toBeCloseTo(.4);
      const own = c.plan.nodes.find(n => n.id === 'torso')!;
      expect(own.option.program.requiredContacts!.length).toBeGreaterThanOrEqual(16);
      for (const role of roles.filter(r => r.startsWith('leg-'))) {
        expect(bounds(pp(c, role)).min[2]).toBe(0);
        expect(bounds(pp(c, role)).size).toEqual([1, 1, 1.2]);
        expect(joined(pp(c, role), pp(c, 'frame'))).toBe(true);
      }
      expect(bounds(pp(c, 'frame')).min[2]).toBeCloseTo(1.2);
      expect(bounds(pp(c, 'face')).size[0]).toBe(canine ? 3 : 4);
      const real = bounds(all(c));
      c.size.forEach((n, a) => expect(n).toBeCloseTo(real.size[a], 8));
    }
  });

  it('independently compiles crowns, central skulls and connected ear bases with actual required contacts', () => {
    for (const c of models) {
      const program = c.plan.nodes.find(n => n.id === 'head')!.option.program;
      const own: Record<string, number> = {};
      for (const op of program.operations) own[op.partId] = (own[op.partId] ?? 0) + 1;
      const b = compileConnections(program, own), parts = b.steps.flatMap(s => s.parts);
      const crownIndex = program.operations.findIndex(op => c.plan.name !== 'Bear' ? op.partId === 'plate-2x3-dark-brown' : op.partId === 'plate-2x4-reddish-brown');
      expect(crownIndex).toBeGreaterThan(0);
      const crown = frame(parts[crownIndex]);
      const skulls = parts.filter(p => parsePartId(p.partId)?.type === 'brick');
      expect(skulls).toHaveLength(c.plan.name !== 'Bear' ? 1 : 4);
      expect(skulls.every(p => connectionPairs(crown, frame(p)).length >= 2)).toBe(true);
      expect(parts.every(p => frame(p).bounds.min[2] >= 0)).toBe(true);
      expect(requiredContactIssues(parts, program.requiredContacts)).toEqual([]);
    }
  });

  it('protects every internal closure and remaps intermodule anchor contracts into final steps', () => {
    for (const c of models) {
      const parts = all(c), required = c.build.requiredContacts!;
      expect(requiredContactIssues(parts, required)).toEqual([]);
      expect(required.length).toBeLessThanOrEqual(160);
      for (const n of c.plan.nodes) {
        const own = c.receipts.find(r => r.id === n.id)!;
        for (const contact of n.option.program.requiredContacts!) expect(required).toContainEqual({
          ...contact, a: own.indices[contact.a], b: own.indices[contact.b],
        });
        if (n.attachment) {
          const a = n.attachment, parent = c.receipts.find(r => r.id === a.parent)!;
          expect(required).toContainEqual({ a: parent.indices[a.parentPart], b: own.indices[0], aPort: a.parentPort, bPort: a.childPort });
        }
      }
    }
  });

  it('supports the symmetric Dog face across the crown and puts low studless curves on real skull-side bases', () => {
    const dog = models[0], face = bounds(pp(dog, 'face')), head = bounds(pp(dog, 'head'));
    expect(dog.plan.nodes.find(n => n.id === 'face')!.attachment!.parent).toBe('head');
    expect(joined(pp(dog, 'face'), pp(dog, 'head'))).toBe(true);
    expect(pp(dog, 'head')).toHaveLength(6);
    expect(pp(dog, 'face')).toHaveLength(5);
    const rail = pp(dog, 'face').find(p => p.partId === 'plate-1x3-white')!;
    const crown = pp(dog, 'head').find(p => p.partId === 'plate-2x3-dark-brown')!;
    expect(connectionPairs(frame(rail), frame(crown))).toHaveLength(3);
    expect(bounds([rail]).min[2]).toBe(bounds([crown]).max[2]);
    for (const role of ['ear-left', 'ear-right']) {
      const p = pp(dog, role)[0], k = parsePartId(p.partId)!;
      expect(k.type).toBe('curve');
      expect(definition(k).ports.every(port => port.kind === 'grip')).toBe(true);
      expect(bounds(pp(dog, role)).max[2]).toBeLessThan(head.max[2]);
      expect(bounds(pp(dog, role)).min[1]).toBe(face.min[1]);
      expect(joined(pp(dog, role), pp(dog, 'head'))).toBe(true);
    }
    const nose = pp(dog, 'muzzle').find(p => parsePartId(p.partId)?.type === 'roundplate')!;
    expect(bounds([nose]).size.slice(0, 2)).toEqual([1, 1]);
    expect(face.min[1] - bounds([nose]).min[1]).toBe(1);
    expect(bounds([nose]).max[2]).toBe(face.min[2]);
    expect(pp(dog, 'muzzle').map(p => p.partId)).toEqual(['brick-1x1-medium-nougat', 'roundplate-1x1-black']);
  });

  it('builds real paired small Bear round tips and measures the stub against body rather than carrier length', () => {
    const bear = bearModel, body = bounds(['chest', 'torso', 'hips'].flatMap(r => pp(bear, r))), carrier = bounds(pp(bear, 'frame')), tail = bounds(pp(bear, 'tail'));
    expect(carrier.size[1]).toBe(4);
    expect(body.size[1]).toBe(6);
    expect(tail.max[1] - body.max[1]).toBe(1);
    expect(tail.max[1] - carrier.max[1]).toBe(2);
    expect(tail.size[2]).toBeCloseTo(.8);
    expect(joined(pp(bear, 'tail'), pp(bear, 'hips'))).toBe(true);
    for (const role of ['ear-left', 'ear-right']) {
      expect(pp(bear, role).map(p => p.partId)).toEqual(['plate-1x1-white', 'roundbrick-1x1-tan']);
      bounds(pp(bear, role)).size.forEach((n, a) => expect(n).toBeCloseTo([1, 1, 1.6][a]));
      expect(bounds(pp(bear, role)).max[2] - bounds(pp(bear, 'face')).max[2]).toBeCloseTo(.4);
    }
    expect(cost(bear.plan)['roundbrick-1x1-tan']).toBe(4);
  });

  it('offers genuine alternate tail solids rather than renamed or repainted copies', () => {
    expect(animalSilhouetteKey(models[0].build)).not.toBe(animalSilhouetteKey(models[1].build));
    expect(new Set(models.map(c => animalSilhouetteKey(c.build))).size).toBe(4);
    expect(pp(models[0], 'tail').some(p => parsePartId(p.partId)?.type === 'brick')).toBe(true);
    expect(pp(models[1], 'tail').some(p => parsePartId(p.partId)?.type === 'invslope')).toBe(true);
    const result = searchModuleCompositions(plans, stock, { limit: 4, minParts: 20, maxParts: 80, validate: refinedAnimalIssues });
    expect(result.candidates).toHaveLength(4);
    expect(result.rejected).toBe(0);
  });

  it('supports the Fox face on its crown with a two-projecting muzzle, high ear bases and a tapering broad tail', () => {
    const fox = foxModel, face = bounds(pp(fox, 'face')), head = bounds(pp(fox, 'head'));
    expect(fox.plan.nodes.find(n => n.id === 'face')!.attachment!.parent).toBe('head');
    expect(pp(fox, 'muzzle').map(p => p.partId)).toEqual(['brick-1x2-reddish-brown', 'roundplate-1x1-black']);
    expect(joined(pp(fox, 'face'), pp(fox, 'head'))).toBe(true);
    const rail = pp(fox, 'face').find(p => p.partId === 'plate-1x3-white')!;
    const crown = pp(fox, 'head').find(p => p.partId === 'plate-2x3-dark-brown')!;
    expect(connectionPairs(frame(rail), frame(crown))).toHaveLength(3);
    expect(face.min[1] - bounds(pp(fox, 'muzzle')).min[1]).toBe(2);
    for (const role of ['ear-left', 'ear-right']) {
      expect(pp(fox, role).map(p => p.partId)).toEqual(['slope-1x2-green']);
      expect(bounds(pp(fox, role)).min[2]).toBe(head.max[2]);
      expect(bounds(pp(fox, role)).max[2] - face.max[2]).toBeCloseTo(.4);
      expect(joined(pp(fox, role), pp(fox, 'head'))).toBe(true);
    }
    const tail = bounds(pp(fox, 'tail')), body = bounds(['chest', 'torso', 'hips'].flatMap(r => pp(fox, r)));
    expect(tail.size.slice(0, 2)).toEqual([2, 5]);
    expect(tail.size[2]).toBeCloseTo(2.4);
    expect(tail.max[1] - body.max[1]).toBe(4);
    expect(joined(pp(fox, 'tail'), pp(fox, 'hips'))).toBe(true);
    expect(pp(fox, 'tail').filter(p => parsePartId(p.partId)?.type === 'curve')).toHaveLength(2);
    expect(cost(fox.plan)['plate-2x4-reddish-brown']).toBe(3);
    expect(cost(fox.plan)['brick-2x2-reddish-brown']).toBe(2);
    expect(cost(fox.plan)['curve-1x2-black']).toBe(2);
    expect(cost(fox.plan)['plate-1x4-reddish-brown']).toBe(3);
    expect(cost(fox.plan)['plate-1x6-tan']).toBeUndefined();
    expect(cost(fox.plan)['brick-1x3-reddish-brown']).toBeUndefined();
  });
});

describe('fail-closed refined policy and validation', () => {
  it('keeps actual canonical species labels and policy ordering without claiming unsupported breeds', () => {
    expect(refinedAnimalPlans(stock, 'Bear')[0].name).toBe('Bear');
    expect(refinedAnimalPlans(stock, 'Golden retriever')[0].name).toBe('Dog');
    expect(refinedAnimalPlans(stock, 'Fox').map(p => p.name)).toEqual(['Fox', 'Dog', 'Dog', 'Bear']);
    for (const name of ['Rabbit', 'Giraffe', 'Bird', 'Dinosaur', 'Foxglove', 'Dogfish', 'Bear chair', 'Boxer', 'Dog or Bear', 'dog'.repeat(100)]) expect(refinedAnimalPlans(stock, name)).toEqual([]);
    expect(plans.every(p => !/breed|puppy|cub|working|movable/i.test(p.description))).toBe(true);
  });

  it('rejects depletion of exact shared parts, malformed stock and unavailable recipes', () => {
    expect(refinedAnimalPlans({}, 'Dog')).toEqual([]);
    expect(refinedAnimalPlans({ ...stock, 'roundbrick-1x1-tan': NaN }, 'Dog')).toEqual([]);
    expect(refinedAnimalPlans({ ...stock, 'roundbrick-1x1-tan': -1 }, 'Dog')).toEqual([]);
    expect(refinedAnimalPlans({ ...stock, 'plate-2x4-reddish-brown': 3 }, 'Animal').every(p => p.name !== 'Bear')).toBe(true);
    expect(refinedAnimalPlans({ ...stock, 'plate-1x3-tan': 2 }, 'Animal').every(p => p.name !== 'Dog')).toBe(true);
    const scarce = { ...stock, 'curve-1x2-black': 1 };
    expect(() => composeModules(plans[0], scarce)).toThrow(/Shared stock exhausted/);
    expect(refinedAnimalPlans(scarce, 'Dog').every(p => p.name !== 'Dog')).toBe(true);
    for (const id of ['slope-1x2-green', 'plate-1x4-reddish-brown', 'plate-1x3-white']) {
      expect(refinedAnimalPlans({ ...stock, [id]: 0 }, 'Fox').every(p => p.name !== 'Fox')).toBe(true);
    }
  });

  it('rejects renaming or corrupt module ownership, receipt costs, sizes and unsupported metadata', () => {
    for (const original of [models[0], bearModel, foxModel]) {
      const c = structuredClone(original), label = c.plan.name === 'Dog' ? 'Bear' : 'Dog';
      c.plan.name = label; c.build.name = label; c.plan.id = `animal-refined:${label.toLowerCase()}:fake`;
      expect(refinedAnimalIssues(c).length).toBeGreaterThan(0);
    }
    const missing = structuredClone(models[0]); missing.receipts.pop();
    expect(refinedAnimalIssues(missing).join(' ')).toMatch(/fifteen/);
    const duplicate = structuredClone(models[0]); duplicate.receipts[1].indices[0] = duplicate.receipts[0].indices[0];
    expect(refinedAnimalIssues(duplicate).join(' ')).toMatch(/own every part/);
    const bill = structuredClone(models[0]); bill.receipts[0].cost['plate-1x3-tan']++;
    expect(refinedAnimalIssues(bill).join(' ')).toMatch(/exact part costs/);
    const size = structuredClone(models[0]); size.size[2] /= .4;
    expect(refinedAnimalIssues(size).join(' ')).toMatch(/studs/);
    expect(refinedAnimalIssues(null as unknown as AssemblyComposition)).toEqual(['Unsupported or noncanonical refined animal.']);
  });

  it('rejects corrupt feet, belly filling, hidden nose/eyes, ear profiles and tail placement', () => {
    const mutations: [string, (c: AssemblyComposition) => void][] = [
      ['grounded', c => pp(c, 'leg-front-left').forEach(p => { p.z += 1; })],
      ['flanks', c => pp(c, 'leg-front-left').forEach(p => { p.x -= 1; })],
      ['open belly', c => pp(c, 'torso').forEach(p => { p.z -= 4; })],
      ['dark eyes', c => pp(c, 'face').filter(p => p.partId === 'plate-1x1-dark-gray').forEach(p => { p.partId = 'plate-1x1-white'; })],
      ['forward nose', c => pp(c, 'muzzle').filter(p => parsePartId(p.partId)?.type === 'roundplate').forEach(p => { p.y += 1; })],
      ['low curved ears', c => pp(c, 'ear-left').forEach(p => { p.partId = 'plate-1x2-black'; })],
      ['hip connection', c => pp(c, 'tail').forEach(p => { p.y += 1; })],
    ];
    for (const [text, mutate] of mutations) {
      const c = structuredClone(models[0]); mutate(c);
      expect(refinedAnimalIssues(c).join(' '), text).toContain(text);
    }
    const bear = structuredClone(bearModel);
    pp(bear, 'ear-left').filter(p => parsePartId(p.partId)?.type === 'roundbrick').forEach(p => { p.partId = 'roundplate-1x1-green'; });
    expect(refinedAnimalIssues(bear).join(' ')).toMatch(/round ear tips/);
  });

  it('rejects reversed Fox ear/tail profiles and a shortened or concealed snout', () => {
    for (const [role, id] of [['ear-left', 'slope-1x2-green'], ['tail', 'curve-1x2-black']]) {
      const c = structuredClone(foxModel);
      const p = pp(c, role).find(p => p.partId === id)!;
      p.orientation = undefined;
      p.rot = role === 'tail' ? 0 : 180;
      expect(refinedAnimalIssues(c).join(' ')).toContain('front-facing slope ears');
    }
    const c = structuredClone(foxModel);
    pp(c, 'muzzle').forEach(p => { p.y += 1; });
    expect(refinedAnimalIssues(c).join(' ')).toContain('forward nose');
  });
});
