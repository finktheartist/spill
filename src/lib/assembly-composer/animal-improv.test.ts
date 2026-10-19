import { beforeAll, describe, expect, it } from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import { type Placed } from '../bricks';
import { attachmentTwist, compileConnections, connectionPairs, frame, requiredContactIssues, validateConnections, type RequiredContact } from '../connections';
import { animalSilhouetteKey } from './animal-silhouette';
import { composeFoxImprovisation, createFoxImprovContext, foxImprovIssues, type FoxImprovContext, type FoxImprovOperation, type FoxImprovProposal, type FoxImprovRole } from './animal-improv';
import type { AssemblyComposition } from './types';

type Labelled = Placed & { role: FoxImprovRole };
const stock: Record<string, number> = Object.freeze({ ...large.stock });
const all = (c: AssemblyComposition) => c.build.steps.flatMap(s => s.parts);
const count = (parts: Placed[]) => {
  const used: Record<string, number> = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
};

/** Independently authored test geometry, not provider output or a visual
 * qualification. The factory contains neither this fixture nor a head lookup. */
function authoredFixture(curved: boolean): Labelled[] {
  const raw: Labelled[] = [], brown = 'reddish-brown';
  const put = (role: FoxImprovRole, partId: string, x: number, y: number, z: number, rot = 0) => raw.push({ role, partId, x, y, z, rot });
  const base = curved ? 12 : 10;
  put('neck', curved ? `invslope-1x2-${brown}` : 'plate-2x2-tan', 1, curved ? 1 : 0, 9, curved ? 90 : 0);
  put('head', curved ? 'plate-2x4-white' : 'plate-2x4-tan', 0, 0, base);
  put('head', `brick-1x2-${brown}`, 1, 1, base + 1);
  for (const x of [0, 3]) {
    put('head', `brick-1x2-${brown}`, x, 1, base + 1, 90);
    if (curved) {
      // The raised rear socket seats on the head plate at base + 1.
      put('head', 'curve-1x2-black', x, -1, base);
      put('head', `plate-1x2-${brown}`, x, 0, base + 4, 90);
    } else put('head', 'brick-1x1-medium-nougat', x, 0, base + 1);
  }
  put('head', `plate-1x4-${brown}`, 0, curved ? 2 : 1, base + 4);
  for (const [x, side] of [[0, 'left'], [3, 'right']] as const) put(`eye-${side}`, 'plate-1x1-dark-gray', x, 0, base + (curved ? 5 : 4));
  put('ear-left', 'slope-2x2-black', 0, curved ? 2 : 1, base + 5, 90);
  put('ear-right', 'slope-2x2-black', 2, curved ? 2 : 1, base + 5, 270);
  const front = curved ? -3 : -2;
  put('muzzle', curved ? `plate-2x4-${brown}` : 'plate-2x3-tan', 1, front, base + 1, 90);
  put('nose', 'plate-1x2-black', 1, front, base + 2);
  put('muzzle', 'plate-1x2-tan', 1, front + 1, base + 2);
  put('muzzle', `plate-1x2-${brown}`, 1, front + 2, base + 2);
  put('muzzle', 'tile-1x2-tan', 1, front + 2, base + 3);
  return raw;
}

/** Converts the independent raw fixture into a proposal through real clutches.
 * This helper is test-only; production receives entirely fresh operations. */
function proposal(context: FoxImprovContext, raw: Labelled[], id: string): FoxImprovProposal {
  const frames = raw.map(frame), order = [0], seen = new Set(order), operations: FoxImprovOperation[] = [
    { partId: raw[0].partId, parent: -1, parentPort: '', childPort: '', twist: 0, role: raw[0].role },
  ];
  while (order.length < raw.length) {
    let added = false;
    next: for (let i = 1; i < raw.length; i++) if (!seen.has(i)) for (const [parent, j] of order.entries()) for (const [parentPort, childPort] of connectionPairs(frames[j], frames[i])) {
      const twist = attachmentTwist(raw[j], parentPort, raw[i], childPort);
      if (twist !== null) { operations.push({ partId: raw[i].partId, parent, parentPort, childPort, twist, role: raw[i].role }); order.push(i); seen.add(i); added = true; break next; }
    }
    if (!added) throw Error('Authored fixture is disconnected.');
  }
  const requiredContacts: RequiredContact[] = [];
  for (let a = 0; a < order.length; a++) for (let b = 0; b < a; b++) for (const [aPort, bPort] of connectionPairs(frames[order[a]], frames[order[b]])) requiredContacts.push({ a, b, aPort, bPort });
  for (const port of context.shoulderPorts) for (const [parentPort, childPort] of connectionPairs(port.frame, frames[0])) if (parentPort === port.parentPort) {
    const twist = attachmentTwist(port.part, parentPort, raw[0], childPort);
    if (twist !== null) return { id, rootRotation: raw[0].rot, operations, requiredContacts, attachment: { parentPart: port.parentPart, parentPort, childPort, twist } };
  }
  throw Error('No real fixture shoulder boundary.');
}

let context: FoxImprovContext, proposals: FoxImprovProposal[], candidates: AssemblyComposition[];
/** Root's local harness may use these as test-only legal seed evidence. They
 * must never be copied into the runtime provider's prompt or candidate menu. */
export function authoredFoxImprovTestProposals(c: FoxImprovContext): FoxImprovProposal[] {
  return [proposal(c, authoredFixture(false), 'authored-low'), proposal(c, authoredFixture(true), 'authored-curved')];
}
beforeAll(() => {
  context = createFoxImprovContext(stock)!;
  proposals = authoredFoxImprovTestProposals(context);
  candidates = proposals.map(p => composeFoxImprovisation(context, p));
});

describe('headless Fox improvisation context', () => {
  it('creates only nine independently legal fixed modules, without allocating any complete head', () => {
    expect(context).not.toBeNull();
    expect(context.chassis.plan.nodes.map(n => n.id).sort()).toEqual(['frame', 'chest', 'hips', 'torso', 'tail', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].sort());
    expect(all(context.chassis)).toHaveLength(21);
    expect(Object.values(context.remaining).reduce((n, v) => n + v, 0)).toBe(387);
    expect(context.available['slope-2x2-black']).toBe(2);
    expect(context.available['curve-1x2-black']).toBe(2);
    expect(validateConnections(context.chassis.build, stock, 24)).toEqual([]);
    for (const node of context.chassis.plan.nodes) {
      const own = context.chassis.receipts.find(r => r.id === node.id)!.cost;
      expect(validateConnections(compileConnections(node.option.program, own), own, 24)).toEqual([]);
    }
    const noHeadSupplies = { ...stock, 'slope-2x2-black': 0, 'curve-1x2-black': 0, 'plate-1x1-dark-gray': 0, 'plate-1x2-black': 0, 'brick-1x1-medium-nougat': 0 };
    expect(createFoxImprovContext(noHeadSupplies)?.chassis.plan.nodes).toHaveLength(9);
    expect(createFoxImprovContext({ ...stock, 'slope-2x2-white': 0 })).toBeNull();
  });

  it('exposes actual free shoulder ports, nearby world obstacles and bounded all-stud goals', () => {
    expect(context.shoulderPorts).toHaveLength(8);
    const parts = all(context.chassis), chest = context.chassis.receipts.find(r => r.id === 'chest')!;
    for (const p of context.shoulderPorts) {
      expect(p.parent).toBe('chest');
      expect(p.part).toEqual(parts[chest.indices[p.parentPart]]);
      expect(p.frame).toEqual(frame(p.part));
      expect(p.frame.ports.find(port => port.id === p.parentPort)).toMatchObject({ kind: 'stud', point: p.pointLDU, normal: [0, 0, 1] });
      expect(p.pointLDU[2] / 20).toBe(3.6);
      expect(parts.some((q, i) => i !== chest.indices[p.parentPart] && connectionPairs(p.frame, frame(q)).some(([id]) => id === p.parentPort))).toBe(false);
    }
    expect(context.obstacles.length).toBeGreaterThan(0);
    expect(context.obstacles.every(o => o.part === parts[o.index] && o.frame.bounds.min[1] <= 80)).toBe(true);
    expect(context.goals).toMatchObject({ units: 'studs', maxProposalParts: 24, maxTotalParts: 80, maxSpanStuds: 24, centerX: 2, forward: [0, -1, 0] });
  });

  it('copies/freezes context and rejects malformed or fixed-chassis-scarce stock honestly', () => {
    const input = { ...stock }, c = createFoxImprovContext(input)!;
    input['slope-2x2-black'] = 0;
    expect(c.available['slope-2x2-black']).toBe(2);
    expect(Object.isFrozen(c.stock)).toBe(true);
    expect(Object.isFrozen(c.chassis.plan.nodes[0].option.program.operations)).toBe(true);
    expect(() => { c.stock['slope-2x2-black'] = 0; }).toThrow();
    expect(createFoxImprovContext({})).toBeNull();
    expect(createFoxImprovContext({ ...stock, 'roundbrick-1x1-tan': 3 })).toBeNull();
    expect(createFoxImprovContext({ ...stock, 'plate-2x8-reddish-brown': NaN })).toBeNull();
    expect(createFoxImprovContext({ ...stock, 'plate-2x8-reddish-brown': -1 })).toBeNull();
    expect(createFoxImprovContext(Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`unknown-${i}`, 1])))).toBeNull();
  });
});

describe('fresh compound proposal compilation', () => {
  it('accepts two independently authored, physically distinct proposals without an authored-head dependency', () => {
    expect(candidates.map(c => all(c).length)).toEqual([38, 40]);
    expect(new Set(candidates.map(c => animalSilhouetteKey(c.build))).size).toBe(2);
    for (const [i, c] of candidates.entries()) {
      expect(c.plan.name).toBe('Fox');
      expect(c.plan.id).toBe(`animal-improv:fox:${proposals[i].id}`);
      expect(c.plan.nodes).toHaveLength(10);
      expect(foxImprovIssues(c)).toEqual([]);
      expect(validateConnections(c.build, stock, 24)).toEqual([]);
      const node = c.plan.nodes.find(n => n.id === 'head-neck')!;
      expect(node.option.program.operations).toEqual(proposals[i].operations);
      expect(node.option.program.operations.length).toBeLessThanOrEqual(24);
      expect(validateConnections(compileConnections(node.option.program, context.available), context.available, 24)).toEqual([]);
      expect(c.plan.nodes.slice(0, 9)).toEqual(context.chassis.plan.nodes);
    }
  });

  it('owns every original/generated part once, preserves semantic recipe indices and bills one exact ledger', () => {
    const source = JSON.stringify(context), proposed = JSON.stringify(proposals);
    for (const c of candidates) {
      const used = count(all(c)), bill: Record<string, number> = {};
      for (const r of c.receipts) for (const [id, n] of Object.entries(r.cost)) bill[id] = (bill[id] ?? 0) + n;
      expect(bill).toEqual(used);
      expect(new Set(c.receipts.flatMap(r => r.indices)).size).toBe(all(c).length);
      for (const [id, n] of Object.entries(used)) expect(c.remaining[id]).toBe(stock[id] - n);
      const r = c.receipts.find(r => r.id === 'head-neck')!, ops = c.plan.nodes.find(n => n.id === 'head-neck')!.option.program.operations as FoxImprovOperation[];
      ops.forEach((op, i) => expect(all(c)[r.indices[i]].partId).toBe(op.partId));
      expect(new Set(ops.map(op => op.role)).size).toBe(8);
      const frames = all(c).map(frame);
      c.size.forEach((n, a) => expect(n).toBeCloseTo((Math.max(...frames.map(f => f.bounds.max[a])) - Math.min(...frames.map(f => f.bounds.min[a]))) / 20, 8));
    }
    expect(JSON.stringify(context)).toBe(source);
    expect(JSON.stringify(proposals)).toBe(proposed);
  });

  it('protects all proposed closures and the real shoulder anchor after whole-build ground ordering', () => {
    for (const c of candidates) {
      const node = c.plan.nodes.find(n => n.id === 'head-neck')!, r = c.receipts.find(r => r.id === 'head-neck')!;
      expect(requiredContactIssues(all(c), c.build.requiredContacts)).toEqual([]);
      for (const contact of node.option.program.requiredContacts!) expect(c.build.requiredContacts).toContainEqual({ ...contact, a: r.indices[contact.a], b: r.indices[contact.b] });
      const a = node.attachment!, host = c.receipts.find(r => r.id === 'chest')!;
      expect(c.build.requiredContacts).toContainEqual({ a: host.indices[a.parentPart], b: r.indices[0], aPort: a.parentPort, bPort: a.childPort });
      expect(all(c).filter(p => frame(p).bounds.min[2] === 0)).toHaveLength(4);
    }
  });

  it('handles held-out stock changes and explicit new geometry instead of silently fitting or substituting', () => {
    const scarce = createFoxImprovContext({ ...stock, 'plate-2x2-tan': 0 })!;
    expect(scarce).not.toBeNull();
    expect(() => composeFoxImprovisation(scarce, proposals[0])).toThrow();
    expect(foxImprovIssues(composeFoxImprovisation(scarce, proposals[1]))).toEqual([]);
    const taller = createFoxImprovContext({ ...stock, 'plate-2x2-tan': 0, 'brick-2x2-tan': 1 })!;
    const raised = structuredClone(proposals[0]); raised.id = 'authored-heldout-throat'; raised.operations[0].partId = 'brick-2x2-tan';
    const third = composeFoxImprovisation(taller, raised);
    expect(foxImprovIssues(third)).toEqual([]);
    expect(animalSilhouetteKey(third.build)).not.toBe(animalSilhouetteKey(candidates[0].build));
    const newNoseStock = createFoxImprovContext({ ...stock, 'plate-1x2-black': 0, 'plate-1x2-dark-gray': 1 })!;
    const changed = structuredClone(proposals[0]); changed.id = 'authored-heldout-nose'; changed.operations.find(op => op.role === 'nose')!.partId = 'plate-1x2-dark-gray';
    expect(foxImprovIssues(composeFoxImprovisation(newNoseStock, changed))).toEqual([]);
    const oneEar = createFoxImprovContext({ ...stock, 'slope-2x2-black': 1 })!;
    expect(oneEar).not.toBeNull();
    expect(() => composeFoxImprovisation(oneEar, proposals[0])).toThrow();
  });

  it('rejects bounded-input, stock, topology and semantic failures without returning partial candidates', () => {
    const maxId = structuredClone(proposals[0]); maxId.id = 'x'.repeat(64);
    expect(composeFoxImprovisation(context, maxId).plan.id).toBe(`animal-improv:fox:${maxId.id}`);
    const tooMany = structuredClone(proposals[0]); tooMany.operations = Array.from({ length: 25 }, () => tooMany.operations[0]);
    expect(() => composeFoxImprovisation(context, tooMany)).toThrow(/unbounded/);
    const unmade = structuredClone(proposals[0]); unmade.operations[0].partId = 'brick-9x9-tan';
    expect(() => composeFoxImprovisation(context, unmade)).toThrow(/operation/);
    const earlier = structuredClone(proposals[0]); earlier.operations[1].parent = 1;
    expect(() => composeFoxImprovisation(context, earlier)).toThrow(/operation/);
    const semantic = structuredClone(proposals[0]); semantic.operations.find(op => op.role === 'eye-left')!.role = 'head';
    expect(() => composeFoxImprovisation(context, semantic)).toThrow(/eight semantic/);
    const boundary = structuredClone(proposals[0]); boundary.attachment.parentPart = 999;
    expect(() => composeFoxImprovisation(context, boundary)).toThrow(/shoulder/);
    const child = structuredClone(proposals[0]); child.attachment.childPort = 'stud:0:0';
    expect(() => composeFoxImprovisation(context, child)).toThrow(/grip/);
    const pose = structuredClone(proposals[0]); pose.attachment.twist = 90;
    expect(() => composeFoxImprovisation(context, pose)).toThrow();
    const closure = structuredClone(proposals[0]); closure.requiredContacts![0].aPort = 'missing';
    expect(() => composeFoxImprovisation(context, closure)).toThrow(/Required connection/);
    const fakeContext = structuredClone(context); all(fakeContext.chassis)[0].z += 1;
    expect(() => composeFoxImprovisation(fakeContext, proposals[0])).toThrow(/context was changed/);
    expect(composeFoxImprovisation(structuredClone(context), proposals[0]).build).toEqual(candidates[0].build);
  });

  it('rejects renamed/mutated geometry, dropped contracts, ownership errors and square ear posts', () => {
    expect(foxImprovIssues(context.chassis).join(' ')).toContain('noncanonical');
    const rename = structuredClone(candidates[0]); rename.plan.name = 'Dog'; rename.build.name = 'Dog';
    expect(foxImprovIssues(rename).join(' ')).toContain('noncanonical');
    const ownership = structuredClone(candidates[0]); ownership.receipts[1].indices[0] = ownership.receipts[0].indices[0];
    expect(foxImprovIssues(ownership).join(' ')).toContain('owned exactly once');
    const contracts = structuredClone(candidates[0]); contracts.build.requiredContacts = [];
    expect(foxImprovIssues(contracts).join(' ')).toContain('contacts');
    const foot = structuredClone(candidates[0]), footIndex = foot.receipts.find(r => r.id === 'leg-front-left')!.indices[0]; all(foot)[footIndex].z += 1;
    expect(foxImprovIssues(foot).length).toBeGreaterThan(0);
    const squares = structuredClone(proposals[0]); squares.operations.filter(op => op.role.startsWith('ear-')).forEach(op => { op.partId = 'brick-2x2-reddish-brown'; });
    expect(() => composeFoxImprovisation(context, squares)).toThrow(/tapered contours/);
    const asymmetricRaw = authoredFixture(false);
    asymmetricRaw.find(p => p.role === 'ear-right')!.rot = 90;
    expect(() => composeFoxImprovisation(context, proposal(context, asymmetricRaw, 'authored-asymmetric-ears'))).toThrow(/tapered contours/);
    const label = structuredClone(proposals[0]); label.operations.find(op => op.role === 'nose')!.partId = 'plate-1x2-tan';
    expect(() => composeFoxImprovisation(context, label)).toThrow(/dark front nose/);
  });
});
