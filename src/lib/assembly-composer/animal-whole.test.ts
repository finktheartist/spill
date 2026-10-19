import { describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import type { Placed } from '../bricks';
import { apply, axisAngle, compileConnections, connectionPairs, corners, frame, multiply, requiredContactIssues, validateConnections, type ConnectionOperation } from '../connections';
import { animalSilhouetteKey } from './animal-silhouette';
import type { AssemblyComposition } from './types';
import { composeWholeAnimal, partialWholeAnimalAnatomyIssues, wholeAnimalDiagnostics, wholeAnimalIssues, type WholeAnimalLayout, type WholeAnimalRole } from './animal-whole';

const parts = (c: AssemblyComposition) => c.build.steps.flatMap(s => s.parts);
const used = (pp: Placed[]) => {
  const cost: Record<string, number> = {};
  for (const p of pp) cost[p.partId] = (cost[p.partId] ?? 0) + 1;
  return cost;
};
const sourceParts = (c: AssemblyComposition) => {
  const actual = parts(c), result: Placed[] = [];
  for (const r of c.receipts) (c.plan.nodes.find(n => n.id === r.id)!.option.program.operations as (ConnectionOperation & { sourceIndex: number })[]).forEach((op, i) => result[op.sourceIndex] = actual[r.indices[i]]);
  return result;
};

/** Independently authored physical fixtures ONLY. These whole layouts are not
 * provider-generated, visually qualified, runtime templates or prompt examples.
 * The production compiler imports no layout, chassis or head factory. */
export function authoredWholeAnimalTestLayouts(): WholeAnimalLayout[] {
  return [false, true].map(wide => {
    const parts: WholeAnimalLayout['parts'] = [], brown = 'reddish-brown';
    const put = (role: WholeAnimalRole, partId: string, x: number, y: number, z: number, rot: 0 | 90 | 180 | 270 = 0) => parts.push({ role, partId, x, y, z, rot });
    if (!wide) {
      for (const [y, station] of [[1, 'front'], [4, 'rear']] as const) for (const [x, side] of [[0, 'left'], [3, 'right']] as const) put(`leg-${station}-${side}`, 'roundbrick-1x1-tan', x, y, 0);
      for (const y of [1, 4]) put('frame', `plate-1x4-${brown}`, 0, y, 1.2);
      put('frame', 'plate-2x6-white', 1, 0, 1.6, 90);
      for (const x of [0, 3]) {
        put('chest', `brick-1x2-${brown}`, x, 0, 2, 90);
        put('hips', `brick-1x2-${brown}`, x, 4, 2, 90);
      }
      put('chest', `brick-1x2-${brown}`, 1, 0, 2);
      put('hips', `brick-1x2-${brown}`, 1, 5, 2);
      put('chest', 'plate-2x4-dark-tan', 0, 0, 3.2);
      put('hips', 'plate-2x4-tan', 0, 4, 3.2);
      for (const y of [1, 3]) put('torso', `brick-2x2-${brown}`, 1, y, 2);
      put('torso', 'plate-2x2-dark-tan', 1, 2, 3.2);
      put('torso', `tile-1x2-${brown}`, 1, 2, 3.6);
    } else {
      for (const [y, station] of [[1, 'front'], [6, 'rear']] as const) for (const [x, side] of [[0, 'left'], [4, 'right']] as const)
        for (const z of [0, .4]) put(`leg-${station}-${side}`, `plate-1x2-${brown}`, x, y, z);
      put('frame', `plate-1x6-${brown}`, 0, 1, .8);
      put('frame', 'plate-1x6-tan', 0, 6, .8);
      put('frame', `plate-4x8-${brown}`, 1, 0, 1.2, 90);
      for (const x of [0, 5]) {
        put('chest', `brick-1x2-${brown}`, x, 0, 1.6, 90);
        put('hips', `brick-1x2-${brown}`, x, 6, 1.6, 90);
      }
      put('chest', `brick-1x4-${brown}`, 1, 0, 1.6);
      put('hips', 'brick-1x4-tan', 1, 7, 1.6);
      put('chest', 'plate-2x6-white', 0, 0, 2.8);
      put('hips', 'plate-4x6-tan', 0, 4, 2.8);
      put('torso', `brick-2x6-${brown}`, 2, 1, 1.6, 90);
      put('torso', 'plate-2x2-tan', 2, 2, 2.8);
    }
    const middle = wide ? 2 : 1, rear = wide ? 7 : 5, top = wide ? 3.2 : 3.6;
    put('tail', `plate-2x4-${brown}`, middle, rear, top, 90);
    put('tail', `brick-2x2-${brown}`, middle, rear + 1, top + .4);
    put('tail', 'slope-2x2-white', middle, rear + 3, top + .4, 180);
    put('tail', `tile-2x2-${brown}`, middle, rear + 1, top + 1.6);
    const left = wide ? 1 : 0, base = wide ? 4.4 : 4;
    put('neck', wide ? `invslope-1x2-${brown}` : 'plate-2x2-tan', middle, wide ? 1 : 0, top, wide ? 90 : 0);
    put('head', wide ? 'plate-2x4-white' : 'plate-2x4-tan', left, 0, base);
    put('head', `brick-1x2-${brown}`, left + 1, 1, base + .4);
    for (const x of [left, left + 3]) {
      put('head', `brick-1x2-${brown}`, x, 1, base + .4, 90);
      if (wide) {
        // The rear socket is .4 studs above the cheek's lowest face;
        // it seats on the head plate at base + .4 without moving the skull.
        put('head', 'curve-1x2-black', x, -1, base);
        put('head', `plate-1x2-${brown}`, x, 0, base + 1.6, 90);
      } else put('head', 'brick-1x1-medium-nougat', x, 0, base + .4);
    }
    put('head', `plate-1x4-${brown}`, left, wide ? 2 : 1, base + 1.6);
    for (const [x, side] of [[left, 'left'], [left + 3, 'right']] as const) put(`eye-${side}`, 'plate-1x1-dark-gray', x, 0, base + (wide ? 2 : 1.6));
    put('ear-left', 'slope-2x2-black', left, wide ? 2 : 1, base + 2, 90);
    put('ear-right', 'slope-2x2-black', left + 2, wide ? 2 : 1, base + 2, 270);
    const front = wide ? -3 : -2;
    put('muzzle', wide ? `plate-2x4-${brown}` : 'plate-2x3-tan', middle, front, base + .4, 90);
    put('nose', 'plate-1x2-black', middle, front, base + .8);
    put('muzzle', 'plate-1x2-tan', middle, front + 1, base + .8);
    put('muzzle', `plate-1x2-${brown}`, middle, front + 2, base + .8);
    put('muzzle', 'tile-1x2-tan', middle, front + 2, base + 1.2);
    return { id: wide ? 'test-wide-crouching' : 'test-compact-standing', description: 'Independently authored test-only whole Fox; not provider output or visual qualification.', stance: wide ? 'crouching' : 'standing', parts };
  });
}

describe('fresh whole-animal compilation', () => {
  it('reuses final morphology before a tail is built without accepting an incomplete animal',()=>{
    for(const full of authoredWholeAnimalTestLayouts()){
      const partial={...full,parts:full.parts.filter(p=>p.role!=='tail')};
      expect(partialWholeAnimalAnatomyIssues(partial)).toEqual([]);
      expect(()=>composeWholeAnimal(large.stock,partial)).toThrow(/Missing.*tail/);
      const bad=structuredClone(partial),left=Math.min(...bad.parts.filter(p=>p.role==='leg-front-left').map(p=>p.x)),right=Math.min(...bad.parts.filter(p=>p.role==='leg-front-right').map(p=>p.x));for(const p of bad.parts)if(p.role==='leg-front-right')p.x-=right-left;
      expect(partialWholeAnimalAnatomyIssues(bad).join(' ')).toMatch(/legs|belly/);
      const missing={...partial,parts:partial.parts.filter(p=>p.role!=='eye-right')};expect(partialWholeAnimalAnatomyIssues(missing).join(' ')).toContain('missing eye-right');
    }
  });
  it('compiles two test-only whole layouts with independently legal anatomical components', () => {
    for (const layout of authoredWholeAnimalTestLayouts()) {
      const diagnostic = wholeAnimalDiagnostics(large.stock, layout) as { issues: string[] };
      expect(diagnostic.issues, JSON.stringify(diagnostic)).toEqual([]);
      const c = composeWholeAnimal(large.stock, layout);
      expect(wholeAnimalIssues(c)).toEqual([]);
      expect(validateConnections(c.build, large.stock, 24)).toEqual([]);
      for (const node of c.plan.nodes) {
        const own = c.receipts.find(r => r.id === node.id)!.cost;
        const local = compileConnections(node.option.program, own);
        expect(validateConnections(local, own, 24)).toEqual([]);
        expect(local.steps[0].parts[0].z).toBe(0);
      }
      const ff = c.build.steps.flatMap(s => s.parts).map(frame);
      c.size.forEach((n, a) => expect(n).toBeCloseTo((Math.max(...ff.map(f => f.bounds.max[a])) - Math.min(...ff.map(f => f.bounds.min[a]))) / 20, 8));
    }
  });

  it('changes whole body/leg/head geometry, owns all parts once and uses one exact original ledger', () => {
    const layouts = authoredWholeAnimalTestLayouts(), input = JSON.stringify({ layouts, stock: large.stock });
    const cs = layouts.map(l => composeWholeAnimal(large.stock, l));
    expect(cs.map(c => parts(c).length)).toEqual([40, 44]);
    expect(cs.map(c => c.size[0])).toEqual([4, 6]);
    expect(new Set(cs.map(c => animalSilhouetteKey(c.build))).size).toBe(2);
    for (const [i, c] of cs.entries()) {
      expect(c.plan.id).toBe(`animal-whole:fox:${layouts[i].id}`);
      expect(c.plan.name).toBe('Fox');
      expect(c.plan.nodes.length).toBeLessThanOrEqual(32);
      expect(c.plan.nodes.length).toBeGreaterThanOrEqual(17);
      expect(c.plan.nodes.every(n => n.option.role !== 'whole-model' && n.option.program.operations.length < layouts[i].parts.length)).toBe(true);
      const indices = c.receipts.flatMap(r => r.indices);
      expect(indices).toHaveLength(layouts[i].parts.length);
      expect(new Set(indices).size).toBe(layouts[i].parts.length);
      const bill: Record<string, number> = {};
      for (const r of c.receipts) for (const [id, n] of Object.entries(r.cost)) bill[id] = (bill[id] ?? 0) + n;
      expect(bill).toEqual(used(parts(c)));
      for (const [id, n] of Object.entries(bill)) expect(c.remaining[id]).toBe(large.stock[id as keyof typeof large.stock] - n);
      expect(Object.values(c.remaining).reduce((n, v) => n + v, 0)).toBe(408 - layouts[i].parts.length);
      expect(parts(c).filter(p => Math.abs(frame(p).bounds.min[2]) < 1e-5)).toHaveLength(4);
    }
    expect(JSON.stringify({ layouts, stock: large.stock })).toBe(input);
  });

  it('preserves every source pose modulo one whole translation at all four yaw angles', () => {
    const input = authoredWholeAnimalTestLayouts()[0];
    for (const rot of [0, 90, 180, 270] as const) {
      const r = axisAngle([0, 0, 1], rot), layout = structuredClone(input);
      layout.parts = layout.parts.map(p => {
        const ff = frame({ ...p, z: p.z / .4 }), points = corners(ff.bounds).map(v => apply(r, v));
        return { ...p, x: Math.min(...points.map(v => v[0])) / 20 + 3.5, y: Math.min(...points.map(v => v[1])) / 20 - 4.5,
          z: p.z + 1.6, rot: ((p.rot + rot) % 360) as typeof p.rot };
      });
      const c = composeWholeAnimal(large.stock, layout), actual = sourceParts(c), expected = layout.parts.map(p => ({ ...p, z: p.z / .4 }));
      const delta = frame(actual[0]).translation.map((n, a) => n - frame(expected[0]).translation[a]);
      actual.forEach((p, i) => {
        const f = frame(p), target = frame(expected[i]);
        expect(p.partId).toBe(layout.parts[i].partId);
        expect(f.rotation).toEqual(multiply(r, frame({ ...input.parts[i], z: input.parts[i].z / .4 }).rotation));
        target.translation.forEach((n, a) => expect(f.translation[a] - n).toBeCloseTo(delta[a], 8));
      });
      expect(wholeAnimalIssues(c)).toEqual([]);
    }
  });

  it('remaps internal contacts and protects every actual intermodule closure after ground ordering', () => {
    const c = composeWholeAnimal(large.stock, authoredWholeAnimalTestLayouts()[1]), pp = parts(c), ff = pp.map(frame), owners = new Map<number, string>();
    for (const r of c.receipts) r.indices.forEach(i => owners.set(i, r.id));
    expect(requiredContactIssues(pp, c.build.requiredContacts)).toEqual([]);
    for (const node of c.plan.nodes) {
      const own = c.receipts.find(r => r.id === node.id)!;
      for (const contact of node.option.program.requiredContacts ?? []) expect(c.build.requiredContacts).toContainEqual({ ...contact, a: own.indices[contact.a], b: own.indices[contact.b] });
      const a = node.attachment;
      if (a) expect(c.build.requiredContacts).toContainEqual({ a: c.receipts.find(r => r.id === a.parent)!.indices[a.parentPart], b: own.indices[0], aPort: a.parentPort, bPort: a.childPort });
    }
    for (let a = 0; a < pp.length; a++) for (let b = a + 1; b < pp.length; b++) if (owners.get(a) !== owners.get(b) && connectionPairs(ff[a], ff[b]).length)
      expect(c.build.requiredContacts!.some(r => r.a === a && r.b === b || r.a === b && r.b === a)).toBe(true);
    // Three other paired feet must attach at their real upper plates, then add
    // their lower feet downward as independently grounded local modules.
    const legModules = c.plan.nodes.filter(n => n.option.role.startsWith('leg-'));
    expect(legModules.length).toBeGreaterThan(4);
    expect(legModules.every(n => compileConnections(n.option.program, c.receipts.find(r => r.id === n.id)!.cost).steps[0].parts[0].z === 0)).toBe(true);
  });

  it('supports optional frame ownership and disconnected same-role head-support islands', () => {
    const noFrame = authoredWholeAnimalTestLayouts()[0];
    noFrame.parts.forEach(p => { if (p.role === 'frame') p.role = 'torso'; });
    const a = composeWholeAnimal(large.stock, noFrame);
    expect(a.receipts.some(r => r.role === 'frame')).toBe(false);
    expect(wholeAnimalIssues(a)).toEqual([]);
    const islands = authoredWholeAnimalTestLayouts()[0];
    islands.parts.find(p => p.role === 'head' && p.partId === 'plate-2x4-tan')!.role = 'neck';
    islands.parts.find(p => p.role === 'muzzle' && p.partId === 'plate-1x2-reddish-brown')!.role = 'head';
    const c = composeWholeAnimal(large.stock, islands);
    expect(c.receipts.filter(r => r.role === 'head').length).toBeGreaterThanOrEqual(3);
    expect(wholeAnimalIssues(c)).toEqual([]);
    for (const n of c.plan.nodes.filter(n => n.option.role === 'head')) expect(validateConnections(compileConnections(n.option.program, c.receipts.find(r => r.id === n.id)!.cost), c.receipts.find(r => r.id === n.id)!.cost)).toEqual([]);
  });

  it('rejects shared-stock scarcity and accepts only explicit held-out part/stock changes', () => {
    const layout = authoredWholeAnimalTestLayouts()[1], scarce = { ...large.stock, 'plate-1x2-reddish-brown': 10 };
    expect(() => composeWholeAnimal(scarce, layout)).toThrow(/stock exhausted/);
    expect(() => composeWholeAnimal({ ...large.stock, 'slope-2x2-black': 1 }, layout)).toThrow(/stock exhausted/);
    const changed = authoredWholeAnimalTestLayouts()[0];
    changed.parts.find(p => p.role === 'neck')!.partId = 'plate-2x2-white';
    const ledger = { ...large.stock, 'plate-2x2-tan': 0, 'plate-2x2-white': 1, 'unknown-original-stock-id': 2 };
    const c = composeWholeAnimal(ledger, changed);
    expect(wholeAnimalIssues(c)).toEqual([]);
    expect(c.remaining['plate-2x2-white']).toBe(0);
    expect(c.remaining['unknown-original-stock-id']).toBe(2);
    expect(c.remaining['plate-2x2-tan']).toBe(0);
  });

  it('rejects legal rectangular ear posts and a legal constant-section cuboid tail', () => {
    const ears = authoredWholeAnimalTestLayouts()[0];
    ears.parts.filter(p => p.role.startsWith('ear-')).forEach(p => p.partId = 'brick-2x2-black');
    const earStock = { ...large.stock, 'brick-2x2-black': 2 }, ed = wholeAnimalDiagnostics(earStock, ears) as { partIssues: unknown[]; issues: string[]; moduleCount: number };
    expect(ed.partIssues).toEqual([]);
    expect(ed.moduleCount).toBeGreaterThan(0);
    expect(ed.issues.some(s => s.includes('ear peaks'))).toBe(true);
    expect(() => composeWholeAnimal(earStock, ears)).toThrow(/ear peaks/);
    const tail = authoredWholeAnimalTestLayouts()[0];
    tail.parts = tail.parts.filter(p => p.role !== 'tail');
    tail.parts.push({ role: 'tail', partId: 'plate-2x6-white', x: 1, y: 5, z: 3.6, rot: 90 }, { role: 'tail', partId: 'brick-2x6-reddish-brown', x: 1, y: 5, z: 4, rot: 90 });
    const tailStock = { ...large.stock, 'plate-2x6-white': 2 }, td = wholeAnimalDiagnostics(tailStock, tail) as { partIssues: unknown[]; issues: string[]; moduleCount: number };
    expect(td.partIssues).toEqual([]);
    expect(td.moduleCount).toBeGreaterThan(0);
    expect(td.issues.some(s => s.includes('generic cuboid'))).toBe(true);
    expect(() => composeWholeAnimal(tailStock, tail)).toThrow(/generic cuboid/);
  });

  it('rejects adjacent same-facing slopes that merge the upper ear tips into one roof stripe', () => {
    for (const layout of authoredWholeAnimalTestLayouts()) {
      // Mirrored 90/270 slopes expose a real gap at the shared upper slice.
      expect(wholeAnimalIssues(composeWholeAnimal(large.stock, layout))).toEqual([]);
      const roof = structuredClone(layout);
      roof.parts.filter(p => p.role.startsWith('ear-')).forEach(p => p.rot = 0);
      const diagnostic = wholeAnimalDiagnostics(large.stock, roof) as { partIssues: unknown[]; issues: string[]; moduleCount: number };
      expect(diagnostic.partIssues).toEqual([]);
      expect(diagnostic.moduleCount).toBeGreaterThan(0);
      // The counterexample still passes the independent per-ear taper and
      // symmetry checks: only the merged, unexposed tip gap rejects it.
      expect(diagnostic.issues).toEqual(['Fox requires an actual exposed gap between its upper ear peaks; a continuous pitched-roof stripe fails.']);
      expect(() => composeWholeAnimal(large.stock, roof)).toThrow(/exposed gap/);
    }
  });

  it('fails closed on role spoofing, unsupported species/stance and changed authoritative contracts', () => {
    const c = composeWholeAnimal(large.stock, authoredWholeAnimalTestLayouts()[0]);
    expect(wholeAnimalIssues(c, 'Dog')).toEqual(['Unsupported requested species or noncanonical whole Fox.']);
    expect(wholeAnimalIssues(c, 'foxglove')).toEqual(['Unsupported requested species or noncanonical whole Fox.']);
    const named = structuredClone(c); named.plan.name = 'Bear';
    expect(wholeAnimalIssues(named).length).toBeGreaterThan(0);
    const spoofed = authoredWholeAnimalTestLayouts()[0];
    spoofed.parts.filter(p => p.role === 'eye-left').forEach(p => p.role = 'head');
    expect(() => composeWholeAnimal(large.stock, spoofed)).toThrow(/Missing.*eye-left/);
    const seated = { ...authoredWholeAnimalTestLayouts()[0], stance: 'seated' };
    expect(() => composeWholeAnimal(large.stock, seated as WholeAnimalLayout)).toThrow(/standing\/crouching/);
    const captions = structuredClone(c); captions.build.steps[0].caption = 'Human wording on authoritative Build';
    expect(wholeAnimalIssues(captions).some(s => s.includes('changed'))).toBe(true);
    const closures = structuredClone(c); closures.build.requiredContacts = [];
    expect(wholeAnimalIssues(closures).some(s => s.includes('changed'))).toBe(true);
    const ownership = structuredClone(c); ownership.receipts[0].indices[0] = ownership.receipts[1].indices[0];
    expect(wholeAnimalIssues(ownership).some(s => s.includes('owned once'))).toBe(true);
    const shifted = structuredClone(c); parts(shifted).find(p => p.partId === 'plate-1x1-dark-gray')!.x += .5;
    expect(wholeAnimalIssues(shifted).length).toBeGreaterThan(0);
  });

  it('rejects overlaps, disconnected parts, oversized inputs and excessive module splitting without mutation', () => {
    const layout = authoredWholeAnimalTestLayouts()[0], snapshot = JSON.stringify({ layout, stock: large.stock });
    const overlap = structuredClone(layout); overlap.parts.push({ ...layout.parts[0] });
    expect(() => composeWholeAnimal({ ...large.stock, 'roundbrick-1x1-tan': 5 }, overlap)).toThrow(/overlap|occupied/);
    const disconnected = structuredClone(layout); disconnected.parts.find(p => p.role === 'nose')!.x += 10;
    expect(() => composeWholeAnimal(large.stock, disconnected)).toThrow(/attachment reaches/);
    for (const patch of [{ x: NaN }, { y: Infinity }, { x: 25 }, { z: .3 }, { rot: 30 }, { partId: 'brick-9x9-tan' }]) {
      const bad = structuredClone(layout); Object.assign(bad.parts[0], patch);
      expect(() => composeWholeAnimal(large.stock, bad)).toThrow(/part 0/);
      expect((wholeAnimalDiagnostics(large.stock, bad) as { accepted: boolean }).accepted).toBe(false);
    }
    const tooMany = { ...layout, parts: Array.from({ length: 81 }, () => layout.parts[0]) };
    expect(() => composeWholeAnimal(large.stock, tooMany)).toThrow(/20–80/);
    const tooWide = structuredClone(layout); tooWide.parts.find(p => p.role === 'nose')!.x = -24;
    expect(() => composeWholeAnimal(large.stock, tooWide)).toThrow(/24 studs/);
    const tower = structuredClone(layout);
    for (let i = 0; i < 34; i++) tower.parts.push({ partId: 'plate-1x1-white', role: i % 2 ? 'hips' : 'chest', x: 1, y: 3, z: 3.6 + i * .4, rot: 0 });
    expect(() => composeWholeAnimal({ ...large.stock, 'plate-1x1-white': 34 }, tower)).toThrow(/more than 32/);
    expect(() => composeWholeAnimal({ ...large.stock, 'plate-2x6-white': -1 }, layout)).toThrow(/stock/);
    expect(JSON.stringify({ layout, stock: large.stock })).toBe(snapshot);
  });
});
