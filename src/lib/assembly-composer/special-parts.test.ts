import { describe, expect, it } from 'vitest';
import small from '../fixtures/small-pile-stock.json';
import medium from '../fixtures/atlas-photo-pile-20261013-stock.json';
import large from '../fixtures/large-pile-stock.json';
import { definition, type ConnectionOperation } from '../connections';
import { parsePartId as parse } from '../bricks';
import { composeModules } from './compose';
import { refinedAnimalPlans } from './animal-refined';
import { inspectSpecialParts, specialPartUsage, SPECIAL_PART_TYPES } from './special-parts';
import type { AssemblyComposition, AssemblyNode, AssemblyPlan } from './types';

const stock = large.stock as Record<string, number>;
const root = (partId: string): ConnectionOperation => ({ partId, parent: -1, parentPort: '', childPort: '', twist: 0 });
function one(partId: string): AssemblyComposition {
  const plan: AssemblyPlan = { id: 'analysis', name: 'Contour specimen', description: 'A real standalone part.', nodes: [
    { id: 'head', option: { id: 'head', role: 'head', program: { name: 'head', description: 'Contour specimen.', operations: [root(partId)] } } },
  ] };
  return composeModules(plan, { [partId]: 1 });
}

describe('exact special-part capabilities', () => {
  it('audits actual fixture counts, preserves identical pairs and identifies absent connector families', () => {
    const stocks = [small.stock, medium, stock] as Record<string, number>[];
    expect(stocks.map(s => Object.values(s).reduce((n, v) => n + v, 0))).toEqual([96, 150, 408]);
    for (const s of stocks) {
      const snapshot = JSON.stringify(s), capabilities = inspectSpecialParts(s);
      expect(capabilities.length).toBeGreaterThan(0);
      for (const c of capabilities.filter(c => c.status === 'usable')) {
        expect(c.status).toBe('usable');expect(c.issues).toEqual([]);expect(c.count).toBe(s[c.id]);
        expect(c.pairedCount).toBe(Math.floor(s[c.id] / 2));expect(c.shapeRoles.length).toBeGreaterThan(0);
        const ports = definition(parse(c.id)!).ports;
        expect(c.ports.map(p => p.id)).toEqual(ports.map(p => p.id));
        c.ports.forEach((p, i) => expect(p.pointStuds).toEqual(ports[i].point.map(n => n / 20)));
      }
      for (const c of capabilities.filter(c => c.status !== 'usable')) {
        expect(c.count).toBe(s[c.id]);expect(c.shapeRoles).toEqual([]);expect(c.ports).toEqual([]);expect(c.issues.length).toBeGreaterThan(0);
      }
      expect(JSON.stringify(s)).toBe(snapshot);
    }
    const largeCaps = inspectSpecialParts(stock), types = new Set(largeCaps.map(c => c.type));
    expect(largeCaps.filter(c => c.status !== 'usable').map(c => c.id)).toEqual(['plate-3x8-dark-gray']);
    expect(inspectSpecialParts(small.stock).every(c => c.status === 'usable')).toBe(true);
    expect(inspectSpecialParts(medium).every(c => c.status === 'usable')).toBe(true);
    for (const t of ['sidebrick', 'sidebricktall', 'sidebrickadjacent', 'sidebrickall', 'bracket', 'jumper', 'cornerplate'] as const) expect(types.has(t)).toBe(false);
    expect(largeCaps.find(c => c.id === 'curve-1x2-black')?.count).toBe(2);
    expect(largeCaps.find(c => c.id === 'invslope-1x2-reddish-brown')?.pairedCount).toBe(0);
    expect(inspectSpecialParts(small.stock).find(c => c.id === 'jumper-1x2-blue')?.pairedCount).toBe(1);
    expect(inspectSpecialParts(medium).find(c => c.id === 'jumper-1x2-medium-blue')?.pairedCount).toBe(1);
    expect(SPECIAL_PART_TYPES).toContain('curve');
  });

  it('reports real port limitations instead of granting studs on curves or inverse-slope lips', () => {
    const caps = inspectSpecialParts(stock), curve = caps.find(c => c.id === 'curve-1x2-black')!, inverse = caps.find(c => c.id === 'invslope-1x2-reddish-brown')!;
    expect(curve.ports.every(p => p.kind === 'grip')).toBe(true);
    expect(curve.connectorConstraints.join(' ')).toMatch(/no top studs/);
    expect(curve.allocationGuidance.join(' ')).toMatch(/tail leaves none/);
    expect(inverse.ports.filter(p => p.kind === 'grip').map(p => p.id)).toEqual(['grip:0:1']);
    expect(inverse.connectorConstraints.join(' ')).toMatch(/lip cannot anchor/);
    expect(inverse.allocationGuidance.join(' ')).toMatch(/Singleton/);
    expect(curve.conservativeCollisionBounds).toBe(true);
    expect(caps.find(c => c.id === 'slope-2x2-reddish-brown')!.conservativeCollisionBounds).toBe(false);
    const jumper = inspectSpecialParts(small.stock).find(c => c.type === 'jumper' && c.id.includes('1x2'))!;
    expect(jumper.ports.filter(p => p.kind === 'stud')).toEqual([{ id: 'stud:center', kind: 'stud', pointStuds: [1, .5, .4], normal: [0, 0, 1] }]);
  });

  it('retains malformed/unsupported raw inventory entries without usable-geometry claims', () => {
    const caps = inspectSpecialParts({ 'curve-9x9-red': 2, 'slope-1x2-not-a-color': 1, 'curve-1x2-black': NaN, 'sidebrick-1x9-black': 1, 'unknown-special-1x2-red': 3, 'brick-1x2-red': 1 });
    expect(caps.map(c => c.id)).not.toContain('brick-1x2-red');
    expect(caps).toHaveLength(5);
    expect(caps.find(c => c.id === 'curve-9x9-red')!.status).toBe('unsupported');
    const badCount = caps.find(c => c.id === 'curve-1x2-black')!;
    expect(badCount.status).toBe('malformed');expect(badCount.count).toBeNull();expect(badCount.rawCount).toBeNaN();expect(badCount.pairedCount).toBe(0);
    for (const c of caps) { expect(c.shapeRoles).toEqual([]);expect(c.ports).toEqual([]);expect(c.sizeStuds).toBeNull();expect(c.issues.length).toBeGreaterThan(0); }
    expect(inspectSpecialParts({ 'curve-1x2-black': -1 })[0].count).toBeNull();
    expect(inspectSpecialParts({ 'curve-1x2-black': 1.5 })[0].count).toBeNull();
    expect(inspectSpecialParts({ 'curve-1x2-black': 0 })).toEqual([]);
    expect(inspectSpecialParts({})).toEqual([]);
  });
});

describe('estimated contour usage from actual composed roles', () => {
  it('counts exact visible-role parts/remaining stock without mutating the compiled model', () => {
    const plan = refinedAnimalPlans(stock, 'Fox').find(p => p.name === 'Fox')!, c = composeModules(plan, stock), before = JSON.stringify(c);
    const report = specialPartUsage(c), actual = c.build.steps.flatMap(s => s.parts);
    expect(report.partCount).toBe(actual.length);
    expect(report.specialPartCount).toBe(actual.filter(p => SPECIAL_PART_TYPES.some(t => t === parse(p.partId)!.type)).length);
    const curves = report.used.find(p => p.id === 'curve-1x2-black')!;
    expect(curves.count).toBe(2);expect(curves.remaining).toBe(0);expect(curves.roles).toEqual(['tail']);
    const tail = report.roles.find(r => r.role === 'tail')!;
    expect(tail.removedContourCells).toBeGreaterThan(0);expect(tail.estimatedExposedContourCells.top).toBeGreaterThan(0);
    expect(report.sampleResolutionStuds).toEqual([.25, .25, .2]);
    expect(report.caveats.join(' ')).toMatch(/not rendered recognition/);expect(report.caveats.join(' ')).toMatch(/clutch strength/);
    for (const role of report.roles) {
      const own = c.receipts.find(r => r.role === role.role)!;
      expect(role.partCount).toBe(own.indices.length);
      expect(Object.values(role.partIds).reduce((n, v) => n + v, 0)).toBe(role.partCount);
    }
    expect(JSON.stringify(c)).toBe(before);
  });

  it('measures a real slope/curve/round contour and gives a rectangular brick zero contour changes', () => {
    for (const id of ['slope-2x2-reddish-brown', 'curve-1x2-black', 'roundbrick-1x1-tan', 'invslope-1x2-reddish-brown', 'cornerplate-2x2-white']) {
      const role = specialPartUsage(one(id)).roles[0];
      expect(role.specialPartCount).toBe(1);expect(role.removedContourCells).toBeGreaterThan(0);
      expect(Object.values(role.estimatedExposedContourCells).some(n => n > 0)).toBe(true);
    }
    const brick = specialPartUsage(one('brick-2x2-reddish-brown'));
    expect(brick.specialPartCount).toBe(0);expect(brick.roles[0].removedContourCells).toBe(0);
    expect(Object.values(brick.roles[0].estimatedExposedContourCells)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('does not count a contour hidden behind a real connected front wall as front-visible', () => {
    const node = (role: string, id: string): AssemblyNode => ({ id: role, option: { id: role, role, program: { name: role, description: 'Exact test module.', operations: [root(id)] } } });
    const base = node('frame', 'plate-2x3-tan'), wall = node('chest', 'brick-1x2-red'), slope = node('head', 'slope-2x2-reddish-brown');
    wall.attachment = { parent: 'frame', parentPart: 0, parentPort: 'stud:0:0', childPort: 'grip:0:0', twist: 0 };
    slope.attachment = { parent: 'frame', parentPart: 0, parentPort: 'stud:0:1', childPort: 'grip:0:0', twist: 0 };
    const c = composeModules({ id: 'occluded', name: 'Contour specimen', description: 'Connected occlusion case.', nodes: [base, wall, slope] }, { 'plate-2x3-tan': 1, 'brick-1x2-red': 1, 'slope-2x2-reddish-brown': 1 });
    const head = specialPartUsage(c).roles.find(r => r.role === 'head')!;
    expect(head.removedContourCells).toBeGreaterThan(0);expect(head.estimatedExposedContourCells.front).toBe(0);expect(head.estimatedExposedContourCells.top).toBeGreaterThan(0);
  });

  it('fails closed on incomplete ownership, invalid frames and unbounded sample dimensions', () => {
    const c = one('curve-1x2-black'), missing = structuredClone(c);missing.receipts=[];
    expect(() => specialPartUsage(missing)).toThrow(/own each actual part/);
    const duplicate = structuredClone(c);duplicate.receipts[0].indices.push(0);
    expect(() => specialPartUsage(duplicate)).toThrow(/own each actual part/);
    const invalid = structuredClone(c);invalid.build.steps[0].parts[0].x=NaN;
    expect(() => specialPartUsage(invalid)).toThrow(/finite/);
    const wide = structuredClone(c);wide.build.steps.push({ caption: 'Far away', parts: [{ partId: 'curve-1x2-black', x: 100, y: 0, z: 0, rot: 0 }] });wide.receipts[0].indices.push(1);
    expect(() => specialPartUsage(wide)).toThrow(/24 studs/);
  });
});
