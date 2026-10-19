import { describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import small from '../fixtures/small-pile-stock.json';
import medium from '../fixtures/atlas-photo-pile-20261013-stock.json';
import { parsePartId, type Build, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { apply, axisAngle, compileConnections, connectionPairs, frame, multiply, requiredContactIssues, validateConnections, type V3 } from '../connections';
import { FEATURE_STUDIES, FEATURE_VARIANTS, featureProgram } from '../moc-features';
import { createFoxImprovContext, type FoxImprovRole } from '../assembly-composer/animal-improv';
import { expandFoxTechnique, foxTechniqueChoices, foxTechniqueText, type FoxTechniqueChoice, type FoxTechniquePlacement } from './fox-techniques';

const stock = createFoxImprovContext(large.stock)!.available;
const choices = foxTechniqueChoices(stock);
const recipe = (name: string, list = choices) => list.find(c => c.id.startsWith(`fox-technique:${name}:`))!;
const placed = (parts: FoxTechniqueChoice['parts']): Placed[] => parts.map(p => ({ ...p, z: p.z / .4 }));
const costs = (parts: Placed[]) => {
  const used: Record<string, number> = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
};
const bounds = (parts: Placed[]) => {
  const frames = parts.map(frame);
  return { min: [0, 1, 2].map(a => Math.min(...frames.map(f => f.bounds.min[a]))) as V3,
    max: [0, 1, 2].map(a => Math.max(...frames.map(f => f.bounds.max[a]))) as V3 };
};
const pairs = (parts: Placed[]) => parts.flatMap((p, a) => parts.slice(a + 1).flatMap((q, n) => connectionPairs(frame(p), frame(q)).map(([aPort, bPort]) => ({ a, b: a + n + 1, aPort, bPort }))));
const build = (parts: Placed[]): Build => ({ name: 'Technique fixture', description: 'Independent placement regression, not a complete Fox or visual qualification.', engine: 'connections-v2', steps: parts.map(p => ({ caption: 'Exact compiled technique part', parts: [p] })) });
const placement = (choice: FoxTechniqueChoice, rot: FoxTechniquePlacement['rot'] = 0): FoxTechniquePlacement => ({ x: -3.5, y: 2.5, z: 4, rot, roles: choice.parts.map(() => 'head') });

describe('stock-bound tiny Fox techniques', () => {
  it('honestly reports stock-fitting skills on the real 96/150/408 piles without inventing missing coverage', () => {
    const piles: Record<string, number>[] = [small.stock, medium, large.stock];
    expect(piles.map(s => Object.values(s).reduce((n, v) => n + v, 0))).toEqual([96, 150, 408]);
    const offered = piles.map(foxTechniqueChoices);
    expect(offered.map(cs => cs.length)).toEqual([0, 1, 7]);
    expect(offered[1][0]).toMatchObject({ kind: 'cheek', cost: { 'plate-2x2-tan': 1, 'curve-2x2-bright-light-orange': 1 } });
    for (const [i, cs] of offered.entries()) for (const c of cs) {
      expect(validateConnections(compileConnections(c.program, piles[i]), c.cost, 24)).toEqual([]);
      for (const [id, n] of Object.entries(c.cost)) expect(n).toBeLessThanOrEqual(piles[i][id]);
    }
    // A skill may fit a smaller pile without a whole fixed Fox chassis fitting.
    // Root's context/composer, rather than this tiny menu, owns that boundary.
    expect(piles.map(s => Boolean(createFoxImprovContext(s)))).toEqual([false, false, true]);
  });

  it('offers all three kinds on the actual chassis remainder as independently legal small modules', () => {
    expect(choices).toHaveLength(7);
    expect(new Set(choices.map(c => c.kind))).toEqual(new Set(['cheek', 'eye-support', 'neck-transition']));
    expect(new Set(choices.map(c => c.id)).size).toBe(choices.length);
    for (const choice of choices) {
      expect(choice.parts.length).toBeGreaterThanOrEqual(2);
      expect(choice.parts.length).toBeLessThanOrEqual(5);
      expect(choice.program.operations).toHaveLength(choice.parts.length);
      expect(choice.parts.every(p => isMade(p.partId) && choice.supportedPalette.includes(parsePartId(p.partId)!.color))).toBe(true);
      const compiled = compileConnections(choice.program, stock), parts = compiled.steps.flatMap(s => s.parts);
      expect(validateConnections(compiled, choice.cost, 24)).toEqual([]);
      expect(validateConnections(build(placed(choice.parts)), choice.cost, 24)).toEqual([]);
      expect(costs(parts)).toEqual(choice.cost);
      expect(costs(placed(choice.parts))).toEqual(choice.cost);
      expect(choice.maxCopies).toBe(Math.min(...Object.entries(choice.cost).map(([id, n]) => Math.floor(stock[id] / n))));
      for (const [id, n] of Object.entries(choice.cost)) expect(n).toBeLessThanOrEqual(stock[id]);
      const b = bounds(placed(choice.parts));
      expect(b.min).toEqual([0, 0, 0]);
      b.max.forEach((n, a) => expect(n / 20).toBeCloseTo(choice.sizeStuds[a], 10));
      expect(choice.geometryRestrictions.units).toBe('studs');
      expect(choice.geometryRestrictions.clearanceStuds).toEqual({ min: [0, 0, 0], max: choice.sizeStuds });
    }
    expect(recipe('raised-eye-ledge').sizeStuds[2]).toBe(1.6);
    expect(recipe('narrow-undercut').sizeStuds[2]).toBe(2);
  });

  it('preserves every port and internal contact under whole-group yaw and translation', () => {
    for (const choice of choices) for (const rot of [0, 90, 180, 270] as const) {
      const original = placed(choice.parts), p = placement(choice, rot);
      const expanded = expandFoxTechnique(choice, p), actual = placed(expanded);
      const before = original.map(frame), after = actual.map(frame), r = axisAngle([0, 0, 1], rot);
      const firstPort = before[0].ports[0], firstActual = after[0].ports.find(port => port.id === firstPort.id)!;
      const rotatedFirst = apply(r, firstPort.point), translation = firstActual.point.map((n, a) => n - rotatedFirst[a]);
      const b = bounds(actual), expectedSize = rot === 90 || rot === 270 ? [choice.sizeStuds[1], choice.sizeStuds[0], choice.sizeStuds[2]] : choice.sizeStuds;
      expect(b.min).toEqual([p.x * 20, p.y * 20, p.z * 20]);
      b.max.forEach((n, a) => expect((n - b.min[a]) / 20).toBeCloseTo(expectedSize[a], 10));
      for (const [i, f] of before.entries()) {
        expect(after[i].rotation).toEqual(multiply(r, f.rotation));
        expect(expanded[i]).toMatchObject({ partId: original[i].partId, role: p.roles[i] });
        for (const port of f.ports) {
          const target = after[i].ports.find(q => q.id === port.id)!;
          expect(target.normal).toEqual(apply(r, port.normal));
          const expected = apply(r, port.point).map((n, a) => n + translation[a]);
          expected.forEach((n, a) => expect(target.point[a]).toBeCloseTo(n, 10));
        }
      }
      expect(pairs(actual)).toEqual(pairs(original));
      expect(requiredContactIssues(actual, pairs(original))).toEqual([]);
      // Elevated head placements need their eventual shoulder/chassis. Ground
      // this isolated test copy to check its unchanged internal physics.
      const grounded = actual.map(q => ({ ...q, x: q.x - b.min[0] / 20, y: q.y - b.min[1] / 20, z: q.z - b.min[2] / 8 }));
      expect(validateConnections(build(grounded), choice.cost, 24)).toEqual([]);
    }
  });

  it('keeps actual X-long ledges and Y-run curves without rounding half-stud group offsets', () => {
    const ledge = recipe('low-eye-ledge'), p = { ...placement(ledge, 90), roles: ['head', 'head'] as FoxImprovRole[] };
    const result = expandFoxTechnique(ledge, p);
    expect(result).toEqual([
      { partId: 'plate-1x2-reddish-brown', role: 'head', x: -3.5, y: 3.5, z: 4, rot: 90 },
      { partId: 'plate-1x2-reddish-brown', role: 'head', x: -3.5, y: 2.5, z: 4.4, rot: 90 },
    ]);
    const curve = recipe('narrow-cheek');
    expect(curve.parts.map(p => p.rot)).toEqual([90, 0]);
    expect(curve.sizeStuds).toEqual([1, 2, 1.2]);
    const labelled = expandFoxTechnique(curve, { x: 1, y: 1, z: 0, rot: 270, roles: ['head', 'muzzle'] });
    expect(labelled.map(p => p.role)).toEqual(['head', 'muzzle']);
    expect(labelled.map(p => p.rot)).toEqual([0, 270]);
  });

  it('exposes exactly the free real ports and nominal body/stud clearance for each compiled part', () => {
    for (const choice of choices) {
      const frames = placed(choice.parts).map(frame);
      const free = frames.flatMap((f, part) => f.ports.filter(port => !frames.some((g, j) => j !== part && connectionPairs(f, g).some(([id]) => id === port.id)))
        .map(port => ({ part, id: port.id, kind: port.kind, pointStuds: port.point.map(n => n / 20), normal: port.normal })));
      expect(choice.exposedPorts).toHaveLength(free.length);
      free.forEach((port, i) => {
        expect(choice.exposedPorts[i]).toMatchObject({ part: port.part, id: port.id, kind: port.kind, normal: port.normal });
        port.pointStuds.forEach((n, a) => expect(choice.exposedPorts[i].pointStuds[a]).toBeCloseTo(n, 10));
      });
      expect(choice.geometryRestrictions.occupiedBoundsStuds).toHaveLength(frames.length);
      frames.forEach((f, part) => {
        const reported = choice.geometryRestrictions.occupiedBoundsStuds[part];
        expect(reported.part).toBe(part);
        expect(reported.bodies).toHaveLength(f.solids.length);
        expect(reported.studs.map(s => s.id)).toEqual(f.studs.map(s => s.id));
        for (const side of ['min', 'max'] as const) {
          f.solids.forEach((s, i) => s.bounds[side].forEach((n, a) => expect(reported.bodies[i][side][a]).toBeCloseTo(n / 20, 10)));
          f.studs.forEach((s, i) => s.solid.bounds[side].forEach((n, a) => expect(reported.studs[i][side][a]).toBeCloseTo(n / 20, 10)));
        }
      });
    }
    expect(recipe('narrow-cheek').exposedPorts.filter(p=>p.part===1)).toEqual([
      {part:1,id:'grip:0:1',kind:'grip',pointStuds:[.5,1.5,.8],normal:[0,0,-1]},
    ]);
    const eye = recipe('low-eye-ledge');
    expect(eye.exposedPorts).toContainEqual({ part: 1, id: 'stud:0:0', kind: 'stud', pointStuds: [.5, .5, .8], normal: [0, 0, 1] });
    expect(recipe('narrow-undercut').exposedPorts.some(p => p.part === 1 && p.kind === 'grip')).toBe(false);
  });

  it('bills repeats and reserves scarce curved/inverse pieces without filling absent families', () => {
    const oneCurve = { ...stock, 'curve-1x2-black': 1 };
    const single = foxTechniqueChoices(oneCurve);
    expect(recipe('paired-cheek-curves', single)).toBeUndefined();
    expect(recipe('narrow-cheek', single).cost['curve-1x2-black']).toBe(1);
    expect(recipe('narrow-cheek', single).maxCopies).toBe(1);
    expect(recipe('paired-cheek-curves').cost['curve-1x2-black']).toBe(2);
    expect(recipe('paired-cheek-curves').maxCopies).toBe(1);
    const withoutCurves = Object.fromEntries(Object.entries(stock).filter(([id]) => !id.startsWith('curve-')));
    expect(foxTechniqueChoices(withoutCurves).some(c => c.kind === 'cheek')).toBe(false);
    const withoutInverse = foxTechniqueChoices({ ...stock, 'invslope-1x2-reddish-brown': 0 });
    expect(recipe('narrow-undercut', withoutInverse)).toBeUndefined();
    expect(recipe('stepped-neck', withoutInverse)).toBeDefined();
    const twoPlates = foxTechniqueChoices({ 'plate-1x2-reddish-brown': 2 });
    expect(twoPlates.map(c => c.kind)).toEqual(['eye-support']);
    expect(twoPlates[0].cost).toEqual({ 'plate-1x2-reddish-brown': 2 });
    expect(twoPlates[0].maxCopies).toBe(1);
    expect(() => compileConnections(twoPlates[0].program, { 'plate-1x2-reddish-brown': 1 })).toThrow(/stock|bucket/);
    const threePlates = foxTechniqueChoices({ 'plate-1x2-reddish-brown': 3 });
    expect(recipe('stepped-neck', threePlates).cost).toEqual({ 'plate-1x2-reddish-brown': 3 });
  });

  it('does not substitute unknown IDs, bright unrelated palettes or scarce SNOT/angled studies', () => {
    expect(foxTechniqueChoices({ 'plate-1x2-mystery-brown': 100, 'curve-1x2-mystery-brown': 100 })).toEqual([]);
    expect(foxTechniqueChoices({ 'plate-1x2-blue': 100, 'brick-1x2-blue': 100, 'curve-1x2-blue': 100 })).toEqual([]);
    const extra = foxTechniqueChoices({ ...stock, 'sidebrick-1x1-white': 100, 'jumper-1x2-white': 100, 'roundplate-2x2-white': 100 });
    expect(extra.map(c => c.id)).toEqual(choices.map(c => c.id));
    expect(extra.some(c => ['side-face', 'turned-head', 'offset-neck'].includes(c.studyId))).toBe(false);
    expect(extra.flatMap(c => c.parts).every(p => [0, 90, 180, 270].includes(p.rot))).toBe(true);
    for (const id of ['turned-head', 'side-face']) {
      const choice = structuredClone(choices[0]);
      choice.program = featureProgram(FEATURE_STUDIES.find(s => s.id === id)!, 'white', 'black');
      expect(() => expandFoxTechnique(choice, placement(choice))).toThrow(/angled|nonupright/);
    }
  });

  it('leaves stock and study inputs immutable, freezes returned records and recomputes fresh choices', () => {
    const input = { ...stock }, snapshot = JSON.stringify({ input, studies: FEATURE_STUDIES, variants: FEATURE_VARIANTS });
    const first = foxTechniqueChoices(input), second = foxTechniqueChoices(input);
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].parts).not.toBe(second[0].parts);
    expect(Object.isFrozen(first[0].program.operations)).toBe(true);
    expect(Object.isFrozen(first[0].geometryRestrictions.occupiedBoundsStuds[0].bodies)).toBe(true);
    expect(() => { first[0].parts[0].x = 99; }).toThrow();
    const result = expandFoxTechnique(first[0], placement(first[0]));
    result[0].x = 19;
    expect(expandFoxTechnique(first[0], placement(first[0]))[0].x).toBe(-3.5);
    expect(JSON.stringify({ input, studies: FEATURE_STUDIES, variants: FEATURE_VARIANTS })).toBe(snapshot);
    input['curve-1x2-black'] = 0;
    expect(recipe('narrow-cheek', foxTechniqueChoices(input))).toBeUndefined();
    expect(recipe('narrow-cheek', first)).toBeDefined();
  });

  it('fails closed on malformed/oversize stock, invalid placement and altered compiled geometry', () => {
    for (const bad of [null, [], { ...stock, 'plate-1x2-reddish-brown': NaN }, { ...stock, 'plate-1x2-reddish-brown': -1 }, { ...stock, 'plate-1x2-reddish-brown': 1.5 },
      Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`unknown-${i}`, 1]))]) expect(foxTechniqueChoices(bad as Record<string, number>)).toEqual([]);
    const choice = recipe('low-eye-ledge'), p = placement(choice), original = JSON.stringify(choice);
    for (const patch of [{ x: NaN }, { y: Infinity }, { x: 25 }, { z: -.4 }, { z: 3.7 }, { rot: 45 }, { roles: [] }, { roles: ['head', 'tail'] }])
      expect(() => expandFoxTechnique(choice, { ...p, ...patch } as FoxTechniquePlacement)).toThrow();
    const changed = structuredClone(choice); changed.parts[1].z += .4;
    expect(() => expandFoxTechnique(changed, p)).toThrow(/poses|costs/);
    const underbilled = structuredClone(choice); underbilled.cost['plate-1x2-reddish-brown'] = 1;
    expect(() => expandFoxTechnique(underbilled, p)).toThrow(/poses|costs/);
    const bound = { ...p, y: 24, rot: 90 as const };
    expect(() => expandFoxTechnique(choice, bound)).toThrow(/world-coordinate/);
    expect(JSON.stringify(choice)).toBe(original);
  });

  it('reports honest provenance, executable costs and limits without presenting a full-head template', () => {
    expect(recipe('rounded-cap').provenance.kind).toBe('existing-study');
    expect(recipe('paired-cheek-curves').provenance.variantId).toBe('paired-curves');
    expect(recipe('narrow-cheek').provenance.kind).toBe('independent-adaptation');
    expect(recipe('low-eye-ledge').studyId).toBe('fox-eye-support');
    expect(recipe('low-eye-ledge').provenance.kind).toBe('independent-authoring');
    expect(recipe('low-eye-ledge').limitations.some(s => s.includes('eye itself is NOT included'))).toBe(true);
    const readonlyChoices: readonly FoxTechniqueChoice[] = choices;
    const text = foxTechniqueText(readonlyChoices), menu = JSON.parse(text.slice(text.indexOf('\n') + 1));
    expect(text).toContain('WORLD STUDS');
    expect(text).toContain('x/y minimum AFTER yaw');
    expect(text).toContain('not complete heads or a craft guarantee');
    expect(text).toContain('unchanged composer owns the combined ledger');
    expect(menu).toHaveLength(choices.length);
    expect(menu.map((c: FoxTechniqueChoice) => c.cost)).toEqual(choices.map(c => c.cost));
    expect(menu.every((c: FoxTechniqueChoice) => c.maxCopies >= 1 && c.exposedPorts.length > 0)).toBe(true);
    expect(foxTechniqueText([])).toContain('\n[]');
    expect(() => foxTechniqueText(Array.from({ length: 10 }, () => choices[0]))).toThrow(/nine/);
  });
});
