import { parsePartId, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { axisAngle, compileConnections, connectionPairs, corners, frame, type ConnectionOperation, type ConnectionProgram, type V3 } from '../connections';
import { FEATURE_STUDIES, FEATURE_VARIANTS } from '../moc-features';
import type { FoxImprovRole } from '../assembly-composer/animal-improv';
import type { FoxHeadLayout } from './fox-head-layout';

export type FoxTechniqueKind = 'cheek' | 'eye-support' | 'neck-transition';
export interface FoxTechniquePlacement {
  x: number; y: number; z: number; rot: 0 | 90 | 180 | 270;
  /** One semantic role per compiled part, in program operation order. */
  roles: FoxImprovRole[];
}
export interface FoxTechniquePort {
  part: number; id: string; kind: 'stud' | 'grip'; pointStuds: V3; normal: V3;
}
export interface FoxTechniqueChoice {
  id: string; studyId: string; kind: FoxTechniqueKind; name: string;
  lesson: string; limitations: string[];
  program: ConnectionProgram;
  /** Upright local poses, with x/y minima and z bottom at zero. ALL in studs. */
  parts: Omit<FoxHeadLayout['parts'][number], 'role'>[];
  cost: Record<string, number>; sizeStuds: V3; maxCopies: number;
  exposedPorts: FoxTechniquePort[];
  supportedPalette: string[];
  palette: { carrier: string; surface: string };
  geometryRestrictions: {
    units: 'studs'; uprightQuarterTurnOnly: true; rotations: [0, 90, 180, 270];
    zLayerStuds: .4; maxWorldCoordinateStuds: 24;
    clearanceStuds: { min: V3; max: V3 };
    /** Nominal body/stud bounds, not a new collision authority. */
    occupiedBoundsStuds: { part: number; bodies: { min: V3; max: V3 }[]; studs: { id: string; min: V3; max: V3 }[] }[];
  };
  provenance: { kind: 'existing-study' | 'independent-adaptation' | 'independent-authoring'; source: string; variantId?: string; note: string };
}

type Spec = Omit<ConnectionOperation, 'partId'> & { shape: string };
type Recipe = {
  id: string; studyId: string; kind: FoxTechniqueKind; name: string; lesson: string; limitations: string[];
  operations: Spec[]; rootRotation?: number; surfaces: number[]; provenance: FoxTechniqueChoice['provenance'];
  contacts?: ConnectionProgram['requiredContacts'];
};
const CARRIERS = ['reddish-brown', 'dark-brown', 'tan', 'dark-tan', 'medium-nougat', 'white'];
const SURFACES = ['black', 'reddish-brown', 'dark-brown', 'tan', 'dark-tan', 'medium-nougat', 'orange', 'dark-orange', 'bright-light-orange', 'white'];
const PALETTE = [...new Set([...CARRIERS, ...SURFACES])];
const ROTS = [0, 90, 180, 270] as const;
const ROLES: FoxImprovRole[] = ['neck', 'head', 'muzzle', 'nose', 'eye-left', 'eye-right', 'ear-left', 'ear-right'];
const root = (shape: string): Spec => ({ shape, parent: -1, parentPort: '', childPort: '', twist: 0 });
const on = (shape: string, parent: number, parentPort: string, childPort: string, twist = 0): Spec => ({ shape, parent, parentPort, childPort, twist });
const costOf = (program: ConnectionProgram) => {
  const cost: Record<string, number> = {};
  for (const op of program.operations) cost[op.partId] = (cost[op.partId] ?? 0) + 1;
  return cost;
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function recipes(): Recipe[] {
  const rounded = FEATURE_STUDIES.find(s => s.id === 'rounded-muzzle'), stepped = FEATURE_STUDIES.find(s => s.id === 'stepped-neck'), chin = FEATURE_STUDIES.find(s => s.id === 'chin-transition');
  const paired = FEATURE_VARIANTS.find(v => v.studyId === 'rounded-muzzle' && v.id === 'paired-curves');
  const result: Recipe[] = [];
  if (rounded) {
    result.push({ id: 'rounded-cap', studyId: rounded.id, kind: 'cheek', name: 'Rounded cheek cap', lesson: rounded.lesson,
      limitations: [rounded.limitation, 'One broad curved cap. Reserve two complete copies separately if using it on both cheeks.'],
      operations: rounded.after.map(({ shape, parent, parentPort, childPort, twist }) => ({ shape, parent, parentPort, childPort, twist })), surfaces: [1], contacts: rounded.contacts,
      provenance: { kind: 'existing-study', source: 'moc-features.ts/FEATURE_STUDIES', note: 'Local independently authored rounded-muzzle connector recipe, bound to actual carrier/cap colors. Source articles supplied lessons, not these instructions.' } });
    if (paired) result.push({ id: 'paired-cheek-curves', studyId: rounded.id, kind: 'cheek', name: 'Paired narrow cheek curves', lesson: paired.lesson,
      limitations: [rounded.limitation, 'Consumes both matched narrow curves as ONE three-part technique; it cannot be duplicated without reserving four curves.'],
      operations: paired.parts.map(({ shape, parent, parentPort, childPort, twist }) => ({ shape, parent, parentPort, childPort, twist })), surfaces: [1, 2],
      provenance: { kind: 'existing-study', source: 'moc-features.ts/FEATURE_VARIANTS', variantId: paired.id, note: 'Reuses the local paired-curves alternative with exact stock-bound colors.' } });
    result.push({ id: 'narrow-cheek', studyId: rounded.id, kind: 'cheek', name: 'Single narrow curved cheek', lesson: 'A thin studded carrier supports one smooth cheek. Reserve its opposite partner before committing the pair.',
      limitations: ['Curve runs local +y, with its low edge toward -y. The carrier runs y at rootRotation 90.', 'The curve has no top studs. Its lower front socket mounts to the carrier; its rear socket is one plate higher and remains exposed. Any extra rear support must reach that exact height.'],
      rootRotation: 90, operations: [root('plate-1x2'), on('curve-1x2', 0, 'stud:0:0', 'grip:0:0', -90)], surfaces: [1],
      provenance: { kind: 'independent-adaptation', source: 'fox-techniques.ts', note: 'New two-part narrow adaptation of the rounded-muzzle lesson, independently authored against the real X-long plate and Y-run curve ports.' } });
  }
  for (const [shape, id, label] of [['plate-1x2', 'low-eye-ledge', 'Low forward eye ledge'], ['brick-1x2', 'raised-eye-ledge', 'Raised forward eye ledge']]) {
    result.push({ id, studyId: 'fox-eye-support', kind: 'eye-support', name: label,
      lesson: 'Carry an eye on a real forward studded ledge anchored to a rear coat support, instead of placing the eye on a studless curve or a floating forehead strip.',
      limitations: ['The eye itself is NOT included; reserve an actual dark feature separately and label these carrier parts head.', 'The ledge projects local -x; rotate the group 90 degrees to project toward Fox world -y.', 'Only the rear ledge grip mates to the lower support. Leave clearance under its one-stud overhang.'],
      operations: [root(shape), on('plate-1x2', 0, 'stud:0:0', 'grip:1:0')], surfaces: [1],
      provenance: { kind: 'independent-authoring', source: 'fox-techniques.ts', note: 'New tiny eye carrier/ledge example, independently authored and compiled. It is not copied from an external MOC and is not a complete head.' } });
  }
  if (stepped) result.push({ id: 'stepped-neck', studyId: stepped.id, kind: 'neck-transition', name: 'Short stepped neck carrier', lesson: stepped.lesson,
    limitations: [stepped.limitation, 'Three plates total, 1.2 studs high. Offset is local +x; rotate 270 degrees to aim it toward world -y.'],
    operations: stepped.after.map(({ shape, parent, parentPort, childPort, twist }) => ({ shape, parent, parentPort, childPort, twist })), surfaces: [], contacts: stepped.contacts,
    provenance: { kind: 'existing-study', source: 'moc-features.ts/FEATURE_STUDIES', note: 'Unchanged local stepped-neck connector topology with one coherent actual stock color.' } });
  if (chin) result.push({ id: 'narrow-undercut', studyId: chin.id, kind: 'neck-transition', name: 'Narrow undercut neck transition', lesson: chin.lesson,
    limitations: [chin.limitation, 'Narrow adaptation runs y, 1×2×2 studs. The lower plate plus inverse slope is a 1.6-stud neck; label the final plate head if using it as a skull carrier.', 'An exposed stud below the undercut is not permission to fill its sloping clearance. Whole-head collision validation remains required.'],
    rootRotation: 90, operations: [root('plate-1x2'), on('invslope-1x2', 0, 'stud:1:0', 'grip:0:1', -90), on('plate-1x2', 1, 'stud:0:0', 'grip:0:0', 90)], surfaces: [1],
    provenance: { kind: 'independent-adaptation', source: 'fox-techniques.ts', note: 'New one-stud-wide adaptation of chin-transition for an actual 1×2 inverse slope; every port/twist is independently compiled.' } });
  return result;
}

function stockCopy(stock: Record<string, number>): Record<string, number> | null {
  try {
    if (!stock || typeof stock !== 'object' || Array.isArray(stock)) return null;
    const entries = Object.entries(stock);
    if (entries.length > 1024 || entries.some(([id, n]) => id.length > 80 || !Number.isSafeInteger(n) || n < 0)) return null;
    // Unknown/unmanufactured raw IDs never fund a recipe. Valid untouched IDs
    // may still fund a technique; no unknown color or shape is substituted.
    return Object.fromEntries(entries.filter(([id]) => isMade(id) && PALETTE.includes(parsePartId(id)?.color ?? '')));
  } catch { return null; }
}

function geometry(program: ConnectionProgram, stock: Record<string, number>) {
  if (!program || !Array.isArray(program.operations) || program.operations.length < 2 || program.operations.length > 5) throw Error('A Fox technique needs 2–5 parts.');
  if (program.operations.some(op => !isMade(op.partId) || !PALETTE.includes(parsePartId(op.partId)?.color ?? ''))) throw Error('Unsupported Fox technique part or palette.');
  const build = compileConnections(program, stock), placed = build.steps.flatMap(s => s.parts), frames = placed.map(frame);
  const rotations = frames.map(f => {
    const rot = ROTS.find(rot => { const expected = axisAngle([0, 0, 1], rot); return f.rotation.every((n, i) => n === expected[i]); });
    if (rot === undefined) throw Error('Technique contains an angled or nonupright piece.');
    return rot;
  });
  if (placed.some(p => Math.abs(p.z - Math.round(p.z)) > 1e-6)) throw Error('Technique does not fit upright plate-height layers.');
  const min = [0, 1, 2].map(a => Math.min(...frames.map(f => f.bounds.min[a]))) as V3;
  const max = [0, 1, 2].map(a => Math.max(...frames.map(f => f.bounds.max[a]))) as V3;
  const parts = placed.map((p, i) => ({ partId: p.partId, x: (frames[i].bounds.min[0] - min[0]) / 20, y: (frames[i].bounds.min[1] - min[1]) / 20, z: (frames[i].bounds.min[2] - min[2]) / 20, rot: rotations[i] }));
  const sizeStuds = max.map((v, a) => (v - min[a]) / 20) as V3;
  const point = (p: V3) => p.map((n, a) => (n - min[a]) / 20) as V3;
  const exposedPorts: FoxTechniquePort[] = [];
  for (const [part, f] of frames.entries()) for (const port of f.ports) {
    if (frames.some((g, j) => j !== part && connectionPairs(f, g).some(([id]) => id === port.id))) continue;
    exposedPorts.push({ part, id: port.id, kind: port.kind, pointStuds: point(port.point), normal: [...port.normal] as V3 });
  }
  const occupiedBoundsStuds = frames.map((f, part) => ({ part,
    bodies: f.solids.map(s => ({ min: point(s.bounds.min), max: point(s.bounds.max) })),
    studs: f.studs.map(s => ({ id: s.id, min: point(s.solid.bounds.min), max: point(s.solid.bounds.max) })),
  }));
  return { parts, sizeStuds, exposedPorts, occupiedBoundsStuds };
}

/** One stock-bound palette per small structural recipe; at most nine choices.
 * Each alternative receives the entire input remainder independently. There is
 * no mutable cache and no complete-head recipe or physics relaxation. */
export function foxTechniqueChoices(remainingStock: Record<string, number>): FoxTechniqueChoice[] {
  const stock = stockCopy(remainingStock);
  if (!stock) return [];
  const choices: FoxTechniqueChoice[] = [];
  for (const recipe of recipes()) {
    if (choices.length >= 9) break;
    bind: for (const carrier of CARRIERS) for (const surface of recipe.surfaces.length ? recipe.kind === 'eye-support' ? CARRIERS : SURFACES : [carrier]) {
      const program: ConnectionProgram = { name: recipe.name, description: recipe.lesson, rootRotation: recipe.rootRotation ?? 0,
        operations: recipe.operations.map(({ shape, ...op }, i) => ({ ...op, partId: `${shape}-${recipe.surfaces.includes(i) ? surface : carrier}` })),
        ...(recipe.contacts ? { requiredContacts: structuredClone(recipe.contacts) } : {}) };
      const cost = costOf(program);
      if (Object.entries(cost).some(([id, n]) => (stock[id] ?? 0) < n)) continue;
      try {
        const g = geometry(program, stock);
        choices.push(freeze({ id: `fox-technique:${recipe.id}:${carrier}:${surface}`, studyId: recipe.studyId, kind: recipe.kind, name: recipe.name, lesson: recipe.lesson,
          limitations: [...recipe.limitations, 'Free ports describe this module alone. The complete head must still satisfy actual stock, obstacle clearance, grounding, required contacts and Fox morphology.'],
          program, parts: g.parts, cost, sizeStuds: g.sizeStuds, maxCopies: Math.min(...Object.entries(cost).map(([id, n]) => Math.floor(stock[id] / n))), exposedPorts: g.exposedPorts,
          supportedPalette: [...PALETTE], palette: { carrier, surface },
          geometryRestrictions: { units: 'studs', uprightQuarterTurnOnly: true, rotations: [0, 90, 180, 270], zLayerStuds: .4, maxWorldCoordinateStuds: 24,
            clearanceStuds: { min: [0, 0, 0], max: [...g.sizeStuds] }, occupiedBoundsStuds: g.occupiedBoundsStuds }, provenance: { ...recipe.provenance } }));
        break bind;
      } catch { /* An angled, colliding or nonmanufactured recipe is not offered. */ }
    }
  }
  return choices;
}

const yaw = ([x, y, z]: V3, rot: number): V3 => rot === 0 ? [x, y, z] : rot === 90 ? [-y, x, z] : rot === 180 ? [-x, -y, z] : [y, -x, z];

/** Exact rigid yaw then one group translation. x/y are the group's minimum
 * AFTER yaw; z is its bottom. No angle/grid fitting or contact invention. */
export function expandFoxTechnique(choice: FoxTechniqueChoice, placement: FoxTechniquePlacement): FoxHeadLayout['parts'] {
  if (!choice || !placement || ![placement.x, placement.y, placement.z].every(Number.isFinite) || !ROTS.includes(placement.rot) ||
      Math.max(Math.abs(placement.x), Math.abs(placement.y), Math.abs(placement.z)) > 24 || placement.z < 0 || Math.abs(placement.z / .4 - Math.round(placement.z / .4)) > 1e-6 ||
      !Array.isArray(placement.roles) || !Array.isArray(choice.parts) || placement.roles.length !== choice.parts.length || placement.roles.some(role => !ROLES.includes(role))) throw Error('Use a bounded upright quarter-turn placement and one valid role per compiled part.');
  const cost = costOf(choice.program), g = geometry(choice.program, cost);
  if (JSON.stringify(g.parts) !== JSON.stringify(choice.parts) || JSON.stringify(cost) !== JSON.stringify(choice.cost)) throw Error('Technique compiled poses or exact costs were changed.');
  const placed: Placed[] = g.parts.map(p => ({ ...p, z: p.z / .4 }));
  const rotated = placed.map(p => {
    const points = corners(frame(p).bounds).map(v => yaw(v, placement.rot));
    return [0, 1, 2].map(a => Math.min(...points.map(v => v[a]))) as V3;
  });
  const min = [0, 1, 2].map(a => Math.min(...rotated.map(v => v[a]))) as V3;
  const parts = g.parts.map((p, i) => ({ partId: p.partId, role: placement.roles[i], x: placement.x + (rotated[i][0] - min[0]) / 20,
    y: placement.y + (rotated[i][1] - min[1]) / 20, z: placement.z + (rotated[i][2] - min[2]) / 20, rot: (p.rot + placement.rot) % 360 }));
  if (parts.some(p => [p.x, p.y, p.z].some(v => !Number.isFinite(v) || Math.abs(v) > 24))) throw Error('Expanded technique exceeds supported world-coordinate bounds.');
  return parts;
}

/** A bounded executable menu, not visual qualification or a head template. */
export function foxTechniqueText(choices: readonly FoxTechniqueChoice[]): string {
  if (!Array.isArray(choices) || choices.length > 9 || choices.some(c => !c || !Array.isArray(c.parts) || c.parts.length < 2 || c.parts.length > 5)) throw Error('Provide at most nine small offered Fox techniques.');
  return `OPTIONAL STOCK-BOUND FOX TECHNIQUES. These are 2–5-part learned skills, not complete heads or a craft guarantee. Select an offered choiceId; give x/y/z in WORLD STUDS, quarter-turn rot and one semantic role per compiled part. The origin is x/y minimum AFTER yaw and z bottom. Expansion keeps every internal pose/contact rigid. Plain 1xN bars run X at rot0; directional slopes/curves run Y at rot0. Reserve complete costs for every placement; alternatives below independently use the same remainder. maxCopies is an inventory ceiling, not a placement or strength guarantee. Add the rest of the head using fresh geometry; the unchanged composer owns the combined ledger and all clearance/clutch/subject checks.\n${JSON.stringify(choices.map(c => ({ id: c.id, studyId: c.studyId, kind: c.kind, name: c.name, lesson: c.lesson, limitations: c.limitations,
    parts: c.parts, cost: c.cost, sizeStuds: c.sizeStuds, maxCopies: c.maxCopies, exposedPorts: c.exposedPorts, supportedPalette: c.supportedPalette,
    palette: c.palette, geometryRestrictions: c.geometryRestrictions, provenance: c.provenance })))}`;
}
