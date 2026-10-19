import { CATALOG, parsePartId, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { apply, attachmentTwist, compileConnections, connectionPairs, frame, validateConnections, type ConnectionOperation, type RequiredContact } from '../connections';
import { animalKindName, animalRelatedKinds } from './animal-subjects';
import { composeModules } from './compose';
import type { AssemblyComposition, AssemblyNode, AssemblyPlan } from './types';

type Stock = Record<string, number>;
type Kind = 'dog' | 'fox' | 'bear';
type Raw = Placed & { role: string };
const ROLES = ['frame', 'chest', 'hips', 'torso', 'neck', 'head', 'face', 'muzzle', 'ear-left', 'ear-right', 'tail',
  'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'] as const;
const DARK = new Set(['black', 'dark-gray', 'dark-blue', 'dark-green', 'reddish-brown']);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-5;

function count(parts: Placed[]): Stock {
  const used: Stock = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
}

/** Explicit world-space envelopes. Plain bars run along X at rot 0 and Y at
 * rot 90; directional slopes/curves retain the connector engine's own frame. */
function recipe(kind: Kind, variant: string, stock: Stock): Raw[] {
  const parts: Raw[] = [];
  const put = (role: string, id: string, x: number, y: number, z: number, rot = 0) =>
    parts.push({ role, partId: id, x, y, z, rot });
  const brown = 'reddish-brown';
  if (kind !== 'bear') {
    const fox = kind === 'fox';
    for (const [y, end] of [[1, 'front'], [6, 'rear']] as const) for (const [x, side] of [[0, 'left'], [2, 'right']] as const) {
      put(`leg-${end}-${side}`, 'roundbrick-1x1-tan', x, y, 0);
    }
    for (const y of [1, 6]) put('frame', 'plate-1x3-tan', 0, y, 3);
    put('frame', 'plate-1x8-tan', 1, 0, 4, 90);
    for (const x of [0, 1, 2]) {
      put('chest', `brick-1x2-${brown}`, x, 0, 5, 90);
      put('hips', `brick-1x2-${brown}`, x, 6, 5, 90);
    }
    put('chest', 'plate-2x3-dark-brown', 0, 0, 8);
    put('hips', 'plate-2x3-tan', 0, 6, 8);
    put('torso', `plate-2x4-${brown}`, 0, 2, 5, 90);
    put('torso', `plate-1x4-${brown}`, 2, 2, 5, 90);
    for (const y of [2, 4]) put('torso', 'plate-2x3-tan', 0, y, 6);
    put('torso', `plate-2x4-${brown}`, 1, 2, 7, 90);
    put('torso', `plate-1x4-${brown}`, 0, 2, 7, 90);
    put('neck', `plate-1x2-${brown}`, 1, 1, 9, 90);
    // One connected crosswise base supports the jaw and central skull. The
    // Dog's studless curves use low side bases; Fox's alert ears use the crown.
    put('head', 'plate-1x3-tan', 0, 1, 10);
    put('head', `plate-1x4-${brown}`, 1, -2, 11, 90);
    put('head', `brick-1x2-${brown}`, 1, 0, 12, 90);
    put('head', 'plate-2x3-dark-brown', 0, 0, 15);
    for (const x of [0, 2]) {
      put('head', `plate-1x2-${brown}`, x, fox ? 1 : 0, fox ? 16 : 11, 90);
      put(x ? 'ear-right' : 'ear-left', fox ? 'slope-1x2-green' : 'curve-1x2-black', x, fox ? 1 : 0, fox ? 17 : 12, fox ? 0 : 180);
    }
    put('face', 'plate-1x3-white', 0, 0, 16);
    for (const x of [0, 2]) put('face', 'plate-1x1-dark-gray', x, 0, 17);
    put('face', 'plate-1x1-medium-nougat', 1, 0, 17);
    put('face', 'tile-1x3-tan', 0, 0, 18);
    put('muzzle', fox ? `brick-1x2-${brown}` : 'brick-1x1-medium-nougat', 1, fox ? -2 : -1, 12, fox ? 90 : 0);
    put('muzzle', 'roundplate-1x1-black', 1, fox ? -2 : -1, 15);
    if (fox) {
      put('tail', `plate-2x4-${brown}`, 0, 7, 9, 90);
      for (const y of [8, 10]) put('tail', `brick-2x2-${brown}`, 0, y, 10);
      for (const x of [0, 1]) put('tail', 'curve-1x2-black', x, 10, 13, 180);
    } else {
      put('tail', `plate-1x2-${brown}`, 1, 7, 9, 90);
      put('tail', `${variant === 'inverted' ? 'invslope' : 'brick'}-1x2-${brown}`, 1, 7, 10, variant === 'inverted' ? 0 : 90);
      put('tail', 'slope-1x2-tan', 1, 7, 13);
    }
  } else {
    for (const [y, end] of [[1, 'front'], [4, 'rear']] as const) for (const [x, side] of [[0, 'left'], [3, 'right']] as const) {
      put(`leg-${end}-${side}`, end === 'front' ? 'brick-1x1-light-gray' : 'roundbrick-1x1-tan', x, y, 0);
    }
    for (const y of [1, 4]) put('frame', `plate-1x4-${brown}`, 0, y, 3);
    put('frame', 'plate-2x4-dark-tan', 1, 1, 4, 90);
    for (const x of [0, 2]) {
      put('chest', `brick-2x2-${brown}`, x, 0, 5);
      put('hips', `brick-2x2-${brown}`, x, 4, 5);
    }
    put('chest', 'plate-2x4-dark-tan', 0, 0, 8);
    put('hips', 'plate-2x4-tan', 0, 4, 8);
    for (const z of [5, 6, 7]) put('torso', `plate-2x4-${brown}`, 0, 2, z);
    put('neck', 'plate-1x2-tan', 1, 1, 9);
    put('head', 'plate-2x3-tan', 1, -1, 10, 90);
    for (const x of [0, 1, 2, 3]) put('head', `brick-1x2-${brown}`, x, 0, 11, 90);
    put('head', `plate-2x4-${brown}`, 0, 0, 14);
    put('face', `plate-1x4-${brown}`, 0, 0, 15);
    for (const x of [0, 3]) put('face', 'plate-1x1-dark-gray', x, 0, 16);
    put('face', 'plate-1x2-tan', 1, 0, 16);
    put('face', 'tile-1x4-tan', 0, 0, 17);
    put('muzzle', 'brick-1x2-tan', 1, -1, 11);
    const nose = ['plate-1x2-dark-gray', 'plate-1x2-black'].find(id => (stock[id] ?? 0) > 0) ?? 'plate-1x2-black';
    put('muzzle', nose, 1, -1, 14);
    for (const x of [0, 3]) {
      const role = x ? 'ear-right' : 'ear-left';
      put(role, 'plate-1x1-white', x, 1, 15);
      put(role, 'roundbrick-1x1-tan', x, 1, 16);
    }
    put('tail', 'plate-2x2-dark-tan', 1, 5, 9);
    put('tail', `plate-1x2-${brown}`, 1, 6, 10);
  }
  return parts;
}

/** Infer an immutable recipe for EACH anatomical role from actual mating ports.
 * A complete crown may join cheeks that were disconnected during raw authoring.
 * Lowest roots avoid introducing below-ground descendants in standalone modules. */
function planFromRaw(parts: Raw[], kind: Kind, variant: string): AssemblyPlan {
  const frames = parts.map(frame), nodes: AssemblyNode[] = [], placed = new Map<string, number[]>();
  const pending = new Set<string>(ROLES);
  while (pending.size) {
    let progress = false;
    for (const role of pending) {
      const members = parts.flatMap((p, i) => p.role === role ? [i] : []);
      const lowest = Math.min(...members.map(i => frames[i].bounds.min[2]));
      let root = -1, attachment: AssemblyNode['attachment'];
      for (const i of members.filter(i => close(frames[i].bounds.min[2], lowest))) {
        if (!nodes.length && role === 'frame') { root = i; break; }
        for (const [parent, order] of placed) {
          for (const [parentPart, j] of order.entries()) for (const [parentPort, childPort] of connectionPairs(frames[j], frames[i])) {
            const twist = attachmentTwist(parts[j], parentPort, parts[i], childPort);
            if (twist !== null) { root = i; attachment = { parent, parentPart, parentPort, childPort, twist }; break; }
          }
          if (root >= 0) break;
        }
        if (root >= 0) break;
      }
      if (root < 0) continue;
      const order = [root], seen = new Set(order), operations: ConnectionOperation[] = [
        { partId: parts[root].partId, parent: -1, parentPort: '', childPort: '', twist: 0 },
      ];
      while (order.length < members.length) {
        let joined = false;
        for (const i of members) if (!seen.has(i)) {
          for (const [parent, j] of order.entries()) {
            for (const [parentPort, childPort] of connectionPairs(frames[j], frames[i])) {
              const twist = attachmentTwist(parts[j], parentPort, parts[i], childPort);
              if (twist !== null) {
                operations.push({ partId: parts[i].partId, parent, parentPort, childPort, twist });
                seen.add(i); order.push(i); joined = true; break;
              }
            }
            if (joined) break;
          }
          if (joined) break;
        }
        if (!joined) throw Error(`Disconnected refined ${role}.`);
      }
      const requiredContacts: RequiredContact[] = [];
      for (let a = 0; a < order.length; a++) for (let b = 0; b < a; b++) {
        for (const [aPort, bPort] of connectionPairs(frames[order[a]], frames[order[b]])) requiredContacts.push({ a, b, aPort, bPort });
      }
      const program = { name: role, description: `Static refined ${role}, joined through exact manufactured connectors.`, rootRotation: parts[root].rot, operations, requiredContacts };
      compileConnections(program, count(order.map(i => parts[i])));
      nodes.push({ id: role, option: { id: `animal-refined:${kind}:${variant}:${role}`, role, program }, ...(attachment ? { attachment } : {}) });
      placed.set(role, order); pending.delete(role); progress = true;
    }
    if (!progress) throw Error('Refined anatomy has no legal module boundary.');
  }
  return { id: `animal-refined:${kind}:${variant}`, name: animalKindName(kind), nodes,
    description: kind === 'dog'
      ? `Static Dog with a coherent brown 3-by-8-stud body, four feet below its flanks, a connected lower waist, a symmetric crown-supported face, low black curved skull-side ears, a short warm round-nosed muzzle and a narrow ${variant === 'inverted' ? 'inverted-slope' : 'raised'} tapered tail.`
      : kind === 'fox'
        ? 'Static Fox with a coherent brown 3-by-8-stud body, four feet below its flanks, a connected lower waist, a symmetric crown-supported face, a long narrow round-nosed muzzle, elevated paired slope ears and a broad sweeping tail with a curved rear taper.'
        : 'Static Bear with a coherent brown 4-by-6-stud full body, four feet below its flanks, a connected lower waist, a broad aligned head, a short 2-stud-wide muzzle, matched warm round ears above the forehead and a rear stub tail.' };
}

/** Only complete stock-valid, independently compiled recipes leave this provider.
 * Related species retain their canonical actual labels; no breed/age claims.
 * These targets still need anonymous rendered quality review before qualification. */
export function refinedAnimalPlans(stock: Stock, requestedSubject: string): AssemblyPlan[] {
  if (!stock || typeof stock !== 'object' || Array.isArray(stock) || Object.values(stock).some(n => !Number.isSafeInteger(n) || n < 0)) return [];
  const plans: AssemblyPlan[] = [];
  for (const kind of animalRelatedKinds(requestedSubject)) {
    for (const variant of kind === 'dog' ? ['raised', 'inverted'] : kind === 'fox' ? ['sweeping'] : ['compact']) {
      const raw = recipe(kind, variant, stock), used = count(raw);
      if (Object.entries(used).some(([id, n]) => !Object.hasOwn(stock, id) || stock[id] < n || !isMade(id))) continue;
      try {
        const plan = planFromRaw(raw, kind, variant), c = composeModules(plan, stock, { minParts: 20, maxParts: 80 });
        if (!refinedAnimalIssues(c).length) plans.push(plan);
      } catch { /* Missing clutch, invalid standalone recipes or collisions fail closed. */ }
    }
  }
  return plans;
}

function bounds(parts: Placed[]) {
  if (!parts.length) throw Error('Empty refined anatomy.');
  const ff = parts.map(frame);
  const min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a])) / 20);
  const max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])) / 20);
  return { min, max, size: max.map((n, a) => n - min[a]), center: max.map((n, a) => (n + min[a]) / 2) };
}
const joined = (a: Placed[], b: Placed[]) => a.some(p => b.some(q => connectionPairs(frame(p), frame(q)).length));
const lowFacing = (p: Placed, back: boolean) => {
  const low = apply(frame(p).rotation, [0, -1, 0]);
  return close(low[0], 0) && close(low[1], back ? 1 : -1) && close(low[2], 0);
};

/** Measure the built anatomy, rather than trusting its ID, paint or intended
 * recipe. Body dimensions use chest+waist+hips, not the shorter Bear carrier. */
export function refinedAnimalIssues(c: AssemblyComposition): string[] {
  const issues: string[] = [];
  if (!c?.plan || !c.build || !['Dog', 'Fox', 'Bear'].includes(c.plan.name) || c.build.name !== c.plan.name ||
      typeof c.plan.id !== 'string' || !c.plan.id.startsWith(`animal-refined:${c.plan.name.toLowerCase()}:`)) return ['Unsupported or noncanonical refined animal.'];
  try {
    if (!Array.isArray(c.build.steps) || !c.build.steps.length || c.build.steps.length > 80 ||
        !Array.isArray(c.plan.nodes) || !Array.isArray(c.receipts)) return ['Invalid or unbounded refined anatomy.'];
    let partCount = 0;
    for (const step of c.build.steps) if (!Array.isArray(step?.parts) || (partCount += step.parts.length) > 80) return ['Refined animal needs 20–80 purposeful parts.'];
    const all = c.build.steps.flatMap(s => s.parts), nodes = c.plan.nodes;
    if (all.length < 20 || all.length > 80) issues.push('Refined animal needs 20–80 purposeful parts.');
    if (nodes.length !== ROLES.length || c.receipts.length !== ROLES.length || ROLES.some(role =>
      nodes.filter(n => n.id === role && n.option.role === role).length !== 1 || c.receipts.filter(r => r.role === role && r.id === role).length !== 1)) return [...issues, 'Refined animal requires fifteen separate anatomical modules.'];
    if (c.receipts.some(r => !Array.isArray(r.indices) || r.indices.length > 80)) return ['Invalid refined module receipt.'];
    const indices = c.receipts.flatMap(r => r.indices);
    if (indices.length !== all.length || new Set(indices).size !== all.length || indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= all.length)) return [...issues, 'Refined receipts must own every part exactly once.'];
    for (const r of c.receipts) {
      const n = nodes.find(n => n.id === r.id)!;
      const actual = count(r.indices.map(i => all[i]));
      if (r.optionId !== n.option.id || Object.keys(actual).length !== Object.keys(r.cost).length || Object.entries(actual).some(([id, amount]) => r.cost[id] !== amount) ||
          n.option.program.operations.length !== r.indices.length || n.option.program.operations.some((op, i) => op.partId !== all[r.indices[i]].partId)) issues.push('Refined module receipts must report exact part costs and option identity.');
    }
    if (all.some(p => { const k = parsePartId(p.partId); return !k || !isMade(p.partId) || k.type === 'wheels' || !CATALOG[k.type]?.includes(`${k.w}x${k.d}`); })) issues.push('Refined anatomy needs actual manufactured animal parts without wheels or scenery.');
    issues.push(...validateConnections(c.build, count(all), 24).map(i => i.message));
    const pp = (role: string) => c.receipts.find(r => r.role === role)!.indices.map(i => all[i]);
    const b = (role: string) => bounds(pp(role)), bodyParts = [...pp('chest'), ...pp('torso'), ...pp('hips')];
    const whole = bounds(all), body = bounds(bodyParts), chest = b('chest'), hips = b('hips'), waist = b('torso'), carrier = b('frame'), neck = b('neck'), head = b('head'), face = b('face'), muzzle = b('muzzle'), tail = b('tail');
    if (!Array.isArray(c.size) || c.size.length !== 3 || c.size.some((n, a) => !Number.isFinite(n) || !close(n, whole.size[a]))) issues.push('Refined composition size must match actual bounds in studs on every axis.');
    const dog = c.plan.name === 'Dog', fox = c.plan.name === 'Fox', width = c.plan.name === 'Bear' ? 4 : 3, length = c.plan.name === 'Bear' ? 6 : 8;
    if (!close(body.size[0], width) || !close(body.size[1], length) || !close(chest.size[0], width) || !close(hips.size[0], width) || !close(waist.size[0], width)) issues.push('Refined species needs its full coherent body width and length, rather than a narrow skeleton.');
    if (!close(waist.max[2], chest.max[2] - .4) || !close(waist.max[2], hips.max[2] - .4) || !close(waist.size[2], 1.2)) issues.push('Refined waist must be a connected three-plate mass, one plate below chest and hips.');
    const feet = ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].map(b);
    for (const [i, role] of ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].entries()) {
      const f = feet[i], host = i < 2 ? chest : hips;
      if (!close(f.min[2], 0) || !close(f.size[0], 1) || !close(f.size[1], 1) || !close(f.size[2], 1.2) ||
          f.min[0] < host.min[0] - 1e-5 || f.max[0] > host.max[0] + 1e-5 || f.min[1] < host.min[1] - 1e-5 || f.max[1] > host.max[1] + 1e-5 || !joined(pp(role), pp('frame'))) issues.push('Four separate grounded legs must sit below the actual flanks and mate directly to the frame.');
    }
    if (feet[1].min[0] - feet[0].max[0] < .9 || feet[2].min[1] - feet[0].max[1] < .9 ||
        !close((feet[0].center[0] + feet[1].center[0]) / 2, body.center[0]) || !close((feet[2].center[0] + feet[3].center[0]) / 2, body.center[0])) issues.push('Legs need distinct, aligned front/rear and left/right stations.');
    const voidMin = [feet[0].max[0], feet[0].max[1], 0], voidMax = [feet[1].min[0], feet[2].min[1], carrier.min[2]];
    if (carrier.min[2] < 1.19 || all.some(p => frame(p).solids.some(s => [0, 1, 2].every(a =>
      Math.min(s.bounds.max[a] / 20, voidMax[a]) - Math.max(s.bounds.min[a] / 20, voidMin[a]) > 1e-5)))) issues.push('Refined animal must keep a real open belly without ground padding or hidden supports.');
    if (!close(head.size[0], width) || !close(face.size[0], width) || !close(head.center[0], body.center[0]) || !close(face.center[0], body.center[0]) || neck.size[0] > 2.01 || neck.size[1] > 2.01 || head.size[1] > length * (fox ? .8 : .55) + 1e-5 || !joined(pp('neck'), pp('chest')) || !joined(pp('head'), pp('neck'))) issues.push('Refined head, face and neck must be centered and proportionate, with real load-bearing joins.');
    const faceSupports = pp('face').filter(p => close(bounds([p]).min[2], face.min[2])).reduce((n, p) =>
      n + pp('head').reduce((m, q) => m + connectionPairs(frame(p), frame(q)).length, 0), 0);
    if (faceSupports < width) issues.push('Refined face needs full-width real crown support, rather than an isolated center anchor.');
    const eyeParts = pp('face').filter(p => { const k = parsePartId(p.partId)!, f = bounds([p]); return k.type === 'plate' && k.w === 1 && k.d === 1 && DARK.has(k.color) && close(f.min[2], face.min[2] + .4); });
    const eyes = eyeParts.map(p => bounds([p])).sort((a, b) => a.min[0] - b.min[0]);
    if (eyes.length !== 2 || !close(eyes[0].min[0], face.min[0]) || !close(eyes[1].max[0], face.max[0]) || eyes[1].min[0] - eyes[0].max[0] < .9 || eyes.some(e => !close(e.min[1], face.min[1]))) issues.push('Refined face needs two separated actual dark eyes aligned below its cap.');
    const noses = pp('muzzle').filter(p => { const k = parsePartId(p.partId)!, f = bounds([p]); return DARK.has(k.color) && close(f.min[1], muzzle.min[1]) && close(f.max[2], muzzle.max[2]) && ['plate', 'roundplate'].includes(k.type); });
    if (noses.length !== 1 || !close(face.min[1] - muzzle.min[1], fox ? 2 : 1) || !close(muzzle.center[0], body.center[0]) || !joined(pp('muzzle'), pp('head'))) issues.push('Refined muzzle needs a centered forward nose and real jaw support.');
    const earParts = [pp('ear-left'), pp('ear-right')], ears = earParts.map(bounds);
    if (!ears[0].size.every((v, a) => close(v, ears[1].size[a])) || !close(ears[0].min[1], ears[1].min[1]) || !close(ears[0].min[2], ears[1].min[2]) ||
        !close(ears[0].min[0], head.min[0]) || !close(ears[1].max[0], head.max[0]) || earParts.some(parts => !joined(parts, pp('head')))) issues.push('Refined ears must form a matched pair attached to actual head carriers.');
    if (!joined(pp('tail'), pp('hips')) || !close(tail.max[1] - body.max[1], fox ? 4 : 1) || tail.min[1] < hips.min[1]) issues.push(`Refined tail needs a direct hip connection and ${fox ? 'four' : 'one'}-stud projection beyond the actual body.`);
    if (dog) {
      if (!close(muzzle.size[0], 1) || noses.length !== 1 || parsePartId(noses[0].partId)?.type !== 'roundplate' ||
          earParts.some(parts => parts.length !== 1 || parsePartId(parts[0].partId)?.type !== 'curve') || ears.some(e => e.max[2] >= head.max[2] - .39) || !close(tail.size[0], 1) || tail.size[2] < 2.7 || tail.size[2] > 3.21 ||
          !pp('tail').some(p => parsePartId(p.partId)?.type === 'slope') || !joined(pp('face'), pp('head')) || !close(face.min[2], head.max[2]) ||
          ears.some(e => !close(e.min[1], face.min[1])) || !close(muzzle.size[1], 1) || !close(muzzle.max[2], face.min[2])) issues.push('Refined Dog needs low curved ears at the skull sides, a one-stud round nose, crown-supported face and a narrow raised tapered tail.');
    } else if (fox) {
      const curves = pp('tail').filter(p => parsePartId(p.partId)?.type === 'curve');
      if (!close(muzzle.size[0], 1) || !close(muzzle.size[1], 2) || noses.length !== 1 || parsePartId(noses[0].partId)?.type !== 'roundplate' ||
          earParts.some(parts => parts.length !== 1 || parsePartId(parts[0].partId)?.type !== 'slope' || !lowFacing(parts[0], false)) ||
          ears.some(e => e.min[2] < head.max[2] - 1e-5 || e.max[2] <= face.max[2] + 1e-5 || !close(e.size[2], 1.2)) || !close(tail.size[0], 2) || !close(tail.size[1], 5) || !close(tail.size[2], 2.4) ||
          curves.length !== 2 || curves.some(p => !lowFacing(p, true) || !close(bounds([p]).max[1], tail.max[1])) || !joined(pp('face'), pp('head')) || !close(muzzle.max[2], face.min[2])) issues.push('Refined Fox needs a long narrow muzzle, crown-supported face, elevated front-facing slope ears and a broad sweeping tail with two rear-tapering curves.');
    } else {
      if (!close(muzzle.size[0], 2) || earParts.some(parts => parts.length !== 2 || parts.filter(p => parsePartId(p.partId)?.type === 'roundbrick').length !== 1) ||
          ears.some(e => !close(e.size[0], 1) || !close(e.size[1], 1) || !close(e.size[2], 1.6) || e.max[2] <= face.max[2] + 1e-5) || tail.size[1] > 2.01 || !close(tail.size[2], .8) || !joined(pp('face'), pp('head'))) issues.push('Refined Bear needs a broad short muzzle, small paired round ear tips above the forehead and a compact rear stub.');
    }
  } catch { issues.push('Invalid or incomplete refined animal geometry.'); }
  return [...new Set(issues)];
}
