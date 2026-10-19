import { parsePartId, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { apply, attachmentTwist, compileConnections, connectionPairs, frame, validateConnections, type ConnectionOperation, type RequiredContact } from '../connections';
import { animalRelatedKinds } from './animal-subjects';
import { composeModules } from './compose';
import type { AssemblyComposition, AssemblyNode, AssemblyPlan } from './types';

type Stock = Record<string, number>;
type Variant = 'shallow-face' | 'broad-cheeks' | 'tapered-neck';
type Raw = Placed & { role: string };
const VARIANTS: Variant[] = ['shallow-face', 'broad-cheeks', 'tapered-neck'];
const ROLES = ['frame', 'chest', 'hips', 'torso', 'neck', 'head', 'muzzle', 'eye-left', 'eye-right',
  'ear-left', 'ear-right', 'tail', 'leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'];
const close = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const count = (parts: Placed[]) => {
  const used: Stock = {};
  for (const p of parts) used[p.partId] = (used[p.partId] ?? 0) + 1;
  return used;
};

/** Three fixed envelopes, not a geometric search or a stock-driven repaint.
 * All dimensions below are world studs; elevations are plates. Specialty parts
 * retain their actual directional connector frames and conservative physics. */
function recipe(variant: Variant): Raw[] {
  const raw: Raw[] = [], brown = 'reddish-brown', narrow = variant === 'broad-cheeks', right = narrow ? 2 : 3;
  const put = (role: string, partId: string, x: number, y: number, z: number, rot = 0) => raw.push({ role, partId, x, y, z, rot });
  for (const [y, station] of [[1, 'front'], [6, 'rear']] as const) for (const [x, side] of [[0, 'left'], [right, 'right']] as const) {
    put(`leg-${station}-${side}`, 'roundbrick-1x1-tan', x, y, 0);
  }
  if (narrow) {
    for (const y of [1, 6]) put('frame', 'plate-1x3-tan', 0, y, 3);
    put('frame', 'plate-1x8-tan', 1, 0, 4, 90);
    for (const x of [0, 1, 2]) {
      put('chest', `brick-1x2-${brown}`, x, 0, 5, 90);
      put('hips', `brick-1x2-${brown}`, x, 6, 5, 90);
    }
    // Broad cheek study widens its actual front shoulder cap to carry a
    // centered even-width skull; the rear torso remains the leaner chassis.
    put('chest', 'plate-2x4-dark-tan', 0, 0, 8);
    put('hips', 'plate-2x3-tan', 0, 6, 8);
    put('torso', `plate-2x4-${brown}`, 0, 2, 5, 90);
    put('torso', `plate-1x4-${brown}`, 2, 2, 5, 90);
    for (const y of [2, 4]) put('torso', 'plate-2x3-tan', 0, y, 6);
    put('torso', `plate-2x4-${brown}`, 1, 2, 7, 90);
    put('torso', `plate-1x4-${brown}`, 0, 2, 7, 90);
  } else {
    for (const y of [1, 6]) put('frame', `plate-1x4-${brown}`, 0, y, 3);
    put('frame', `plate-2x8-${brown}`, 1, 0, 4, 90);
    for (const x of [0, 3]) {
      put('chest', `brick-1x2-${brown}`, x, 0, 5, 90);
      put('hips', `brick-1x2-${brown}`, x, 6, 5, 90);
    }
    // Real central roots mate to the wider spine; caps then clutch the outer
    // shoulder/hip bars. A cap-only boundary would not compile independently.
    put('chest', `brick-1x2-${brown}`, 1, 0, 5);
    put('hips', `brick-1x2-${brown}`, 1, 7, 5);
    put('chest', 'plate-2x4-dark-tan', 0, 0, 8);
    put('hips', 'plate-2x4-tan', 0, 6, 8);
    put('torso', `brick-2x6-${brown}`, 1, 1, 5, 90);
    put('torso', `plate-2x4-${brown}`, 1, 2, 8, 90);
  }

  if (variant === 'shallow-face') {
    for (const x of [0, 3]) put('chest', 'curve-1x2-black', x, 0, 9);
    put('neck', `slope-2x2-${brown}`, 1, 0, 9);
    put('head', 'plate-2x4-tan', 0, 0, 12);
    put('head', `brick-1x2-${brown}`, 1, 1, 13);
    for (const x of [0, 3]) put('head', `brick-1x2-${brown}`, x, 1, 13, 90);
    for (const x of [0, 3]) put('head', 'brick-1x1-medium-nougat', x, 0, 13);
    put('head', `plate-1x4-${brown}`, 0, 1, 16);
    for (const [x, side] of [[0, 'left'], [3, 'right']] as const) {
      put(`eye-${side}`, 'plate-1x1-dark-gray', x, 0, 16);
    }
    put('ear-left', 'slope-2x2-black', 0, 1, 17, 90);
    put('ear-right', 'slope-2x2-black', 2, 1, 17, 270);
    put('muzzle', 'plate-2x3-tan', 1, -2, 13, 90);
    put('muzzle', 'plate-1x2-black', 1, -2, 14);
    put('muzzle', 'plate-1x2-tan', 1, -1, 14);
    put('muzzle', `plate-1x2-${brown}`, 1, 0, 14);
    put('muzzle', 'tile-1x2-tan', 1, 0, 15);
  } else if (variant === 'broad-cheeks') {
    for (const z of [9, 10]) put('neck', `plate-1x2-${brown}`, 1, 0, z, 90);
    put('head', 'plate-2x4-tan', 0, 0, 11);
    put('head', `brick-1x2-${brown}`, 1, 1, 12);
    for (const x of [0, 3]) {
      put('head', `brick-1x2-${brown}`, x, 1, 12, 90);
      // The cheek's rear socket is one plate above its lowest face.
      put('head', 'curve-1x2-black', x, -1, 11);
      // Forward eye carriers clutch skull studs behind the studless cheek.
      put('head', `plate-1x2-${brown}`, x, 0, 15, 90);
    }
    put('head', `plate-1x4-${brown}`, 0, 2, 15);
    for (const [x, side] of [[0, 'left'], [3, 'right']] as const) put(`eye-${side}`, 'plate-1x1-dark-gray', x, 0, 16);
    put('ear-left', 'slope-2x2-black', 0, 2, 16, 90);
    put('ear-right', 'slope-2x2-black', 2, 2, 16, 270);
    put('muzzle', `plate-2x4-${brown}`, 1, -3, 12, 90);
    put('muzzle', 'plate-1x2-black', 1, -3, 13);
    put('muzzle', 'plate-1x2-tan', 1, -2, 13);
    put('muzzle', `plate-1x2-${brown}`, 1, -1, 13);
    put('muzzle', 'tile-1x2-tan', 1, -1, 14);
  } else {
    put('chest', `slope-2x2-${brown}`, 1, 0, 9);
    put('neck', `plate-1x2-${brown}`, 1, 1, 12);
    put('head', 'plate-2x4-tan', 0, 0, 13);
    put('head', `brick-1x2-${brown}`, 1, 1, 14);
    for (const x of [0, 3]) {
      put('head', 'curve-1x2-black', x, -1, 13);
      put('head', `brick-1x2-${brown}`, x, 1, 14, 90);
      put('head', `plate-1x2-${brown}`, x, 0, 17, 90);
    }
    put('head', `plate-1x4-${brown}`, 0, 2, 17);
    for (const [x, side] of [[0, 'left'], [3, 'right']] as const) put(`eye-${side}`, 'plate-1x1-dark-gray', x, 0, 18);
    put('ear-left', 'slope-2x2-black', 0, 2, 18, 90);
    put('ear-right', 'slope-2x2-black', 2, 2, 18, 270);
    put('muzzle', 'plate-2x3-tan', 1, -2, 14, 90);
    put('muzzle', 'plate-1x2-black', 1, -2, 15);
    put('muzzle', 'plate-1x2-tan', 1, -1, 15);
    put('muzzle', 'tile-1x2-tan', 1, -1, 16);
  }
  const tailX = narrow ? 0 : 1;
  put('tail', `plate-2x4-${brown}`, tailX, 7, 9, 90);
  put('tail', `brick-2x2-${brown}`, tailX, 8, 10);
  put('tail', 'slope-2x2-white', tailX, 10, 10, 180);
  put('tail', `tile-2x2-${brown}`, tailX, 8, 13);
  return raw;
}

const DESCRIPTIONS: Record<Variant, string> = {
  'shallow-face': 'Static Fox study with a shallow tan plate snout, separate raised dark eyes, inward-tapering black ear peaks, curved shoulder edges and a broad sloped neck. Its long shaped tail has a white sloping tip.',
  'broad-cheeks': 'Static Fox study with broad curved cheeks, a longer thin projecting snout, separate forward dark eyes and inward-tapering black ears. Wider shoulders carry a short plated throat above a leaner rear torso; the white-tipped tail sweeps slightly to one side.',
  'tapered-neck': 'Static Fox study with a warm skull, swept curved cheeks, a thin tan snout, separate forward dark eyes and inward-tapering black ears. Sloping shoulders lead through a short collar into the head; the long tail has a white sloping tip.',
};

/** Each anatomical module is independently legal. This infers actual exact
 * ports/twists, never coordinates snapped to an imagined clutch or a low lip. */
function makePlan(raw: Raw[], variant: Variant): AssemblyPlan {
  const frames = raw.map(frame), nodes: AssemblyNode[] = [], placed = new Map<string, number[]>(), pending = new Set(ROLES);
  while (pending.size) {
    let progress = false;
    for (const role of pending) {
      const members = raw.flatMap((p, i) => p.role === role ? [i] : []), lowest = Math.min(...members.map(i => frames[i].bounds.min[2]));
      let root = -1, attachment: AssemblyNode['attachment'];
      chooseRoot: for (const i of members.filter(i => close(frames[i].bounds.min[2], lowest))) {
        if (!nodes.length && role === 'frame') { root = i; break; }
        for (const [parent, order] of placed) for (const [parentPart, j] of order.entries()) {
          for (const [parentPort, childPort] of connectionPairs(frames[j], frames[i])) {
            const twist = attachmentTwist(raw[j], parentPort, raw[i], childPort);
            if (twist !== null) { root = i; attachment = { parent, parentPart, parentPort, childPort, twist }; break chooseRoot; }
          }
        }
      }
      if (root < 0) continue;
      const order = [root], seen = new Set(order), operations: ConnectionOperation[] = [
        { partId: raw[root].partId, parent: -1, parentPort: '', childPort: '', twist: 0 },
      ];
      while (order.length < members.length) {
        let joined = false;
        nextPart: for (const i of members) if (!seen.has(i)) for (const [parent, j] of order.entries()) {
          for (const [parentPort, childPort] of connectionPairs(frames[j], frames[i])) {
            const twist = attachmentTwist(raw[j], parentPort, raw[i], childPort);
            if (twist !== null) {
              operations.push({ partId: raw[i].partId, parent, parentPort, childPort, twist });
              seen.add(i); order.push(i); joined = true; break nextPart;
            }
          }
        }
        if (!joined) throw Error(`Disconnected craft ${role}.`);
      }
      const requiredContacts: RequiredContact[] = [];
      for (let a = 0; a < order.length; a++) for (let b = 0; b < a; b++) {
        for (const [aPort, bPort] of connectionPairs(frames[order[a]], frames[order[b]])) requiredContacts.push({ a, b, aPort, bPort });
      }
      const program = { name: role, description: `Static Fox ${role}, using actual manufactured connector frames.`, rootRotation: raw[root].rot, operations, requiredContacts };
      compileConnections(program, count(order.map(i => raw[i])));
      nodes.push({ id: role, option: { id: `animal-craft:fox:${variant}:${role}`, role, program }, ...(attachment ? { attachment } : {}) });
      placed.set(role, order); pending.delete(role); progress = true;
    }
    if (!progress) throw Error('Craft modules have no actual attachment boundary.');
  }
  return { id: `animal-craft:fox:${variant}`, name: 'Fox', description: DESCRIPTIONS[variant], nodes };
}

/** Bounded authored alternatives. Every returned plan has already compiled all
 * its modules and composed against one exact original ledger. Rendered craft
 * scoring is a separate gate: anatomical checks do not establish beauty. */
export function foxCraftPlans(stock: Stock, requestedSubject: string): AssemblyPlan[] {
  if (!stock || typeof stock !== 'object' || Array.isArray(stock) || Object.values(stock).some(n => !Number.isSafeInteger(n) || n < 0) || !animalRelatedKinds(requestedSubject).includes('fox')) return [];
  const plans: AssemblyPlan[] = [];
  for (const variant of VARIANTS) {
    const raw = recipe(variant), used = count(raw);
    if (Object.entries(used).some(([id, n]) => !Object.hasOwn(stock, id) || stock[id] < n || !isMade(id))) continue;
    try {
      const plan = makePlan(raw, variant), composition = composeModules(plan, stock, { minParts: 20, maxParts: 80 });
      if (!foxCraftIssues(composition).length) plans.push(plan);
    } catch { /* Incomplete, colliding or unstocked recipes never become candidates. */ }
  }
  return plans;
}

function bounds(parts: Placed[]) {
  if (!parts.length) throw Error('Missing craft anatomy.');
  const ff = parts.map(frame), min = [0, 1, 2].map(a => Math.min(...ff.map(f => f.bounds.min[a])) / 20);
  const max = [0, 1, 2].map(a => Math.max(...ff.map(f => f.bounds.max[a])) / 20);
  return { min, max, size: max.map((v, a) => v - min[a]), center: max.map((v, a) => (v + min[a]) / 2) };
}
const joined = (a: Placed[], b: Placed[]) => a.some(p => b.some(q => connectionPairs(frame(p), frame(q)).length));

/** Shared Fox anatomy checks with proportion ranges, not one universal recipe
 * width, eye band, muzzle block or tail equality. The caller checks original
 * inventory again; this checks actual geometry, ownership and required clutches. */
export function foxCraftIssues(c: AssemblyComposition): string[] {
  if (!c?.plan || !c.build || c.plan.name !== 'Fox' || c.build.name !== 'Fox' || !VARIANTS.some(v => c.plan.id === `animal-craft:fox:${v}`)) return ['Unsupported or noncanonical Fox craft plan.'];
  const issues: string[] = [];
  try {
    if (!Array.isArray(c.build.steps) || !c.build.steps.length || c.build.steps.length > 80 || !Array.isArray(c.plan.nodes) || !Array.isArray(c.receipts)) return ['Invalid or unbounded Fox craft anatomy.'];
    let amount = 0;
    for (const step of c.build.steps) if (!Array.isArray(step?.parts) || (amount += step.parts.length) > 80) return ['Fox craft needs 20–80 parts.'];
    const all = c.build.steps.flatMap(s => s.parts);
    if (amount < 20) issues.push('Fox craft needs 20–80 parts.');
    if (c.plan.nodes.length !== ROLES.length || c.receipts.length !== ROLES.length || ROLES.some(role =>
      c.plan.nodes.filter(n => n.id === role && n.option.role === role).length !== 1 || c.receipts.filter(r => r.id === role && r.role === role).length !== 1)) return ['Fox craft requires separate anatomical modules and independent eyes.'];
    if (c.receipts.some(r => !Array.isArray(r.indices) || r.indices.length > 80)) return ['Invalid Fox craft receipts.'];
    const owned = c.receipts.flatMap(r => r.indices);
    if (owned.length !== amount || new Set(owned).size !== amount || owned.some(i => !Number.isSafeInteger(i) || i < 0 || i >= amount)) return ['Fox craft receipts must own every part exactly once.'];
    for (const r of c.receipts) {
      const node = c.plan.nodes.find(n => n.id === r.id)!, used = count(r.indices.map(i => all[i]));
      if (r.optionId !== node.option.id || Object.keys(used).length !== Object.keys(r.cost).length || Object.entries(used).some(([id, n]) => r.cost[id] !== n) ||
          node.option.program.operations.length !== r.indices.length || node.option.program.operations.some((op, i) => op.partId !== all[r.indices[i]].partId)) issues.push('Fox craft needs exact module costs and option ownership.');
    }
    if (all.some(p => !isMade(p.partId))) issues.push('Fox craft needs actual manufactured part IDs.');
    issues.push(...validateConnections(c.build, count(all), 24).map(i => i.message));
    const pp = (role: string) => c.receipts.find(r => r.role === role)!.indices.map(i => all[i]), b = (role: string) => bounds(pp(role));
    const whole = bounds(all), body = bounds([...pp('chest'), ...pp('torso'), ...pp('hips')]), chest = b('chest'), hips = b('hips'), carrier = b('frame'), head = b('head'), neck = b('neck'), muzzle = b('muzzle'), tail = b('tail');
    if (!Array.isArray(c.size) || c.size.length !== 3 || c.size.some((v, a) => !Number.isFinite(v) || !close(v, whole.size[a]))) issues.push('Fox craft size must describe actual bounds in studs.');
    if (body.size[0] < 2.5 || body.size[0] > 5 || body.size[1] / body.size[0] < 1.5 || body.size[1] > 12 || head.size[0] > body.size[0] * 1.3 || head.size[1] > body.size[1] * .7 || Math.abs(head.center[0] - body.center[0]) > .3) issues.push('Fox craft needs an elongated coherent torso and a centered proportionate head.');
    if (!joined(pp('chest'), pp('frame')) || !joined(pp('hips'), pp('frame')) || !joined(pp('torso'), pp('frame')) || !joined(pp('neck'), pp('chest')) || !joined(pp('head'), pp('neck')) || neck.size[0] > chest.size[0] || neck.size[2] > head.size[2]) issues.push('Fox shoulders, waist, neck and head need actual connected load paths.');
    const feet = ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].map(b);
    for (const [i, role] of ['leg-front-left', 'leg-front-right', 'leg-rear-left', 'leg-rear-right'].entries()) {
      const f = feet[i], host = i < 2 ? chest : hips;
      if (!close(f.min[2], 0) || f.size[0] > 1.5 || f.size[1] > 1.5 || !joined(pp(role), pp('frame')) || f.min[0] < host.min[0] - 1e-5 || f.max[0] > host.max[0] + 1e-5 || f.min[1] < host.min[1] - 1e-5 || f.max[1] > host.max[1] + 1e-5) issues.push('Fox craft needs four separate grounded legs below its flanks.');
    }
    if (feet[1].min[0] - feet[0].max[0] < .5 || feet[2].min[1] - feet[0].max[1] < 1 || !close(feet[0].center[0], feet[2].center[0]) || !close(feet[1].center[0], feet[3].center[0])) issues.push('Fox feet need separated, aligned stations.');
    const voidMin = [feet[0].max[0], feet[0].max[1], 0], voidMax = [feet[1].min[0], feet[2].min[1], carrier.min[2]];
    if (carrier.min[2] < .8 || all.some(p => frame(p).solids.some(s => [0, 1, 2].every(a => Math.min(s.bounds.max[a] / 20, voidMax[a]) - Math.max(s.bounds.min[a] / 20, voidMin[a]) > 1e-5)))) issues.push('Fox craft needs an open belly without scenery or hidden ground supports.');
    const eyes = [b('eye-left'), b('eye-right')];
    if (['eye-left', 'eye-right'].some(role => pp(role).length !== 1 || !['black', 'dark-gray'].includes(parsePartId(pp(role)[0].partId)!.color) || !joined(pp(role), pp('head'))) ||
        eyes[1].min[0] - eyes[0].max[0] < .5 || !close(eyes[0].min[1], eyes[1].min[1]) || !close(eyes[0].min[2], eyes[1].min[2])) issues.push('Fox craft needs two independently attached, separated dark eyes.');
    const noses = pp('muzzle').filter(p => parsePartId(p.partId)?.color === 'black'), projection = eyes[0].min[1] - muzzle.min[1];
    if (noses.length !== 1 || !close(bounds(noses).min[1], muzzle.min[1]) || !joined(pp('muzzle'), pp('head')) || projection < 1 || projection > body.size[1] * .65 || Math.abs(muzzle.center[0] - body.center[0]) > .3 || muzzle.size[0] > head.size[0] * .75 || muzzle.size[2] > head.size[2] * .8) issues.push('Fox craft needs a supported thin projecting muzzle with a dark front nose.');
    const ears = [b('ear-left'), b('ear-right')], earParts = [pp('ear-left'), pp('ear-right')];
    const peaks = earParts.map((parts, i) => {
      const top = parts.flatMap(p => frame(p).ports).filter(p => p.kind === 'stud' && close(p.point[2] / 20, ears[i].max[2]));
      return top.reduce((n, p) => n + p.point[0] / 20, 0) / top.length;
    });
    const inward = earParts.map((parts, i) => parts.some(p => parsePartId(p.partId)?.type === 'slope' && close(apply(frame(p).rotation, [0, -1, 0])[0], i ? -1 : 1)));
    // Bounding boxes meet at the low lips; the actual high flat rows establish
    // separated peaks. Do not mistake conservative ear AABBs for square posts.
    if (earParts.some(parts => !joined(parts, pp('head'))) || !ears[0].size.every((v, a) => close(v, ears[1].size[a])) || !close(ears[0].min[1], ears[1].min[1]) || !close(ears[0].min[2], ears[1].min[2]) || ears.some(e => e.max[2] <= head.max[2] + .39) || !peaks.every(Number.isFinite) || peaks[1] - peaks[0] < .5 || inward.some(v => !v)) issues.push('Fox craft needs matched separated inward-tapering alert ear peaks above the skull.');
    if (!joined(pp('tail'), pp('hips')) || tail.max[1] - body.max[1] < body.size[1] * .25 || tail.size[0] < body.size[0] * .35 || tail.size[2] > body.size[2] * 1.3 || !pp('tail').some(p => ['slope', 'curve', 'invslope'].includes(parsePartId(p.partId)!.type))) issues.push('Fox craft needs a substantial shaped rear tail connected to its hips.');
  } catch { issues.push('Invalid or incomplete Fox craft geometry.'); }
  return [...new Set(issues)];
}
