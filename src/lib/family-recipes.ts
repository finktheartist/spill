import type { Recipe } from './library-recipes';
import { assemble, part as p, layer as s, recipe, studs, type Module } from './recipe-kit';

type Info = Omit<Recipe, 'steps' | 'modules' | 'variant'>;
interface FeatureSlot { key: string; socket: string; choices: Module[] }
/** Complete combinations only: no module is independently called a finished model. */
export function compileBlueprint(info: Info, roots: Module[], slots: FeatureSlot[]): Recipe[] {
  let combinations: Module[][] = [[]];
  for (const slot of slots) combinations = combinations.flatMap(parts => slot.choices.map(choice => [...parts, choice]));
  if (roots.length * combinations.length > 64) throw new Error('Bound each blueprint to 64 complete constructions');
  return roots.flatMap(root => combinations.map(features => recipe({
    ...info, id: [info.id, root.id, ...features.map(f => f.id)].join('--'),
    variant: [root.label, ...features.map(f => f.label)].join(' · '),
  }, assemble([{ key: 'structure', module: root }, ...features.map((module, i) => ({ key: slots[i].key, module, parent: 'structure', socket: slots[i].socket }))]))));
}

const airframe: Module = {
  id: 'airframe-10', label: 'Long narrow fuselage',
  ports: { wings: studs(5, 4, 4, 2, 2), nose: studs(5, 0, 1, 2, 2), tail: studs(5, 8, 1, 2, 2) },
  steps: [s('Lay the narrow fuselage.', p('plate-2x10', 'base', 5, 0, 0, 90)),
    s('Interlock the middle of the fuselage and raise the wing mount.', p('brick-2x4', 'body', 5, 3, 1, 90))],
};
function wings(span: 12, closed: boolean): Module {
  const half = span / 2, x = 6 - half;
  return { id: `wings-${span}-${closed ? 'canopy' : 'open'}`, label: closed ? 'Wings and raised canopy' : 'Wings and open cockpit', inlet: studs(5 - x, 0, 0, 2, 2), steps: [
    s('Attach the two matching wings through the fuselage.', p(`plate-2x${half}`, 'body', 0, 0, 0), p(`plate-2x${half}`, 'body', half, 0, 0)),
    s('Join both wings across the center and step their upper surfaces inward.', p('plate-2x4', 'trim', half - 2, 0, 1), p('plate-1x4', 'body', 0, 1, 1), p('plate-1x4', 'body', span - 4, 1, 1)),
    closed ? s('Raise the dark canopy above the joined wings.', p('slope-2x2', 'dark', half - 1, 0, 2))
      : s('Outline the open cockpit with a raised rear rim.', p('tile-1x2', 'dark', half - 1, 0, 2), p('brick-1x2', 'trim', half - 1, 1, 2)),
  ] };
}
const aircraftTail: Module = { id: 'tailplane', label: 'Horizontal tail and upright fin', inlet: studs(2, 0, 0, 2, 2), steps: [
  s('Spread the tailplane across the rear fuselage.', p('plate-2x6', 'trim', 0, 0, 0)),
  s('Raise the narrow tail fin.', p('brick-1x2', 'body', 2, 0, 1, 90), p('slope-1x2', 'dark', 2, 0, 4, 180)),
] };
const noses: Module[] = ['slope', 'curve'].map(shape => ({ id: `${shape}-nose`, label: shape === 'curve' ? 'Rounded nose' : 'Tapered nose', inlet: studs(0, 0, 0, 2, 2), steps: [s('Shape the nose ahead of the main wings.', p(`${shape}-2x2`, 'body', 0, 0, 0))] }));
const aircraft = compileBlueprint({ id: 'survey-plane', family: 'survey-plane', name: 'Survey Plane', category: 'Vehicles', strategy: 'aircraft', tags: ['plane', 'airplane', 'aircraft'], pitch: 'Broad paired wings, a narrow fuselage, a raised cockpit and separate tail surfaces.', features: ['Paired wings', 'Distinct cockpit', 'Horizontal and vertical tail'], palette: { body: 'red', base: 'light-gray', trim: 'white', dark: 'black' }, contrast: [['body', 'dark']] }, [airframe], [
  { key: 'wings', socket: 'wings', choices: [wings(12, true), wings(12, false)] },
  { key: 'nose', socket: 'nose', choices: noses }, { key: 'tail', socket: 'tail', choices: [aircraftTail] },
]);

function figureFrame(tall: boolean): Module {
  const z = tall ? 3 : 0;
  return { id: tall ? 'tall-stance' : 'low-stance', label: tall ? 'Tall stance' : 'Compact stance', ports: { head: studs(3, 3, 11 + z, 2, 1), arms: studs(1, 2, 8 + z, 6, 2) }, steps: [
    s('Separate the two narrow boots.', p('brick-1x2', 'dark', 2, 2, 0, 90), p('brick-1x2', 'dark', 5, 2, 0, 90)),
    ...(tall ? [s('Raise the two legs separately.', p('brick-1x2', 'body', 2, 2, 3, 90), p('brick-1x2', 'body', 5, 2, 3, 90))] : []),
    s('Connect the hips and raise the narrower torso.', p('plate-2x4', 'base', 2, 2, 3 + z), p('brick-2x2', 'body', 3, 2, 4 + z)),
    s('Widen the shoulders and add the central neck.', p('plate-2x6', 'base', 1, 2, 7 + z), p('brick-1x2', 'trim', 3, 3, 8 + z)),
  ] };
}
const figureArms: Module = { id: 'arms', label: 'Separate arms and dark hands', inlet: studs(0, 0, 0, 6, 2), steps: [s('Add an arm at each shoulder.', ...[0, 5].map(x => p('brick-1x2', 'body', x, 0, 0, 90))), s('Finish the two hands.', ...[0, 5].map(x => p('tile-1x2', 'dark', x, 0, 3, 90)))] };
const robotHead: Module = { id: 'robot-face', label: 'Separate eyes and antenna', inlet: studs(1, 1, 0, 2, 1), steps: [
  s('Mount the head on the narrow neck.', p('plate-2x4', 'body', 0, 0, 0)),
  s('Build the pale lower face and solid rear head.', p('brick-1x4', 'light', 0, 0, 1), p('brick-1x4', 'body', 0, 1, 1)),
  s('Separate the eyes with a pale center.', p('brick-1x1', 'dark', 0, 0, 4), p('brick-1x2', 'light', 1, 0, 4), p('brick-1x1', 'dark', 3, 0, 4), p('brick-1x4', 'body', 0, 1, 4)),
  s('Cap the head and add its antenna.', p('plate-2x4', 'body', 0, 0, 7), p('brick-1x1', 'trim', 1, 1, 8), p('tile-1x2', 'dark', 1, 1, 11)),
] };
const helmet: Module = { id: 'helmet', label: 'Dark visor and rounded helmet', inlet: studs(1, 1, 0, 2, 1), steps: [
  s('Mount the helmet above the narrow neck.', p('plate-2x4', 'light', 0, 0, 0)),
  s('Build a continuous dark visor with a solid helmet back.', p('brick-1x4', 'dark', 0, 0, 1), p('brick-1x4', 'light', 0, 1, 1)),
  s('Close and curve the helmet crown.', p('plate-2x4', 'light', 0, 0, 4), p('curve-2x2', 'light', 0, 0, 5), p('curve-2x2', 'light', 2, 0, 5)),
] };
// Whole head alternatives change their supporting geometry together; no piece is stretched.
const deepEyes: Module = { ...robotHead, id: 'robot-face-deep', label: 'Deep eye blocks and antenna', steps: robotHead.steps.map((step, i) => i !== 2 ? step : s('Use two deep eye blocks with a narrower rear head between them.', p('brick-1x2', 'dark', 0, 0, 4, 90), p('brick-1x2', 'light', 1, 0, 4), p('brick-1x2', 'dark', 3, 0, 4, 90), p('brick-1x2', 'body', 1, 1, 4))) };
const slopedHelmet: Module = { ...helmet, id: 'sloped-helmet', label: 'Dark visor and sloping helmet', steps: [...helmet.steps.slice(0, 2), s('Close the crown and shape it with narrow slopes.', p('plate-2x4', 'light', 0, 0, 4), ...[0, 1, 2, 3].map(x => p('slope-1x2', 'light', x, 0, 5)))] };
const characters = [
  { id: 'scout-robot', name: 'Scout Robot', heads: [robotHead, deepEyes], tags: ['robot', 'character'] },
  { id: 'space-explorer', name: 'Space Explorer', heads: [helmet, slopedHelmet], tags: ['astronaut', 'character'] },
].flatMap(info => compileBlueprint({ id: info.id, family: info.id, name: info.name, category: 'Characters', strategy: 'characters', tags: info.tags, pitch: 'Separated boots and arms, a narrow waist and neck, and a distinctive raised head.', features: ['Separated boots and arms', 'Narrow waist and neck', 'Distinct face or visor'], palette: { body: 'red', dark: 'black', light: 'white', base: 'light-gray', trim: 'light-gray' }, contrast: [['body', 'dark'], ['light', 'dark']] }, [figureFrame(true), figureFrame(false)], [{ key: 'head', socket: 'head', choices: info.heads }, { key: 'arms', socket: 'arms', choices: [figureArms] }]));

function gantryFrame(tall: boolean): Module {
  const layers = tall ? 4 : 3;
  return { id: tall ? 'high-gantry' : 'low-gantry', label: tall ? 'Tall supported frame' : 'Low supported frame', ports: { equipment: studs(2, 3, 2 + layers * 3, 2, 2), work: studs(5, 3, 1, 2, 2) }, steps: [
    s('Lay the broad workshop foundation.', p('plate-4x8', 'base', 2, 2, 0)),
    ...Array.from({ length: layers }, (_, i) => s('Raise the two separated side supports.', p('brick-1x2', 'body', 2, 3, 1 + i * 3, 90), p('brick-1x2', 'body', 8, 3, 1 + i * 3, 90))),
    s('Join both supports with the overhead beam.', p('plate-2x8', 'base', 2, 3, 1 + layers * 3)),
  ] };
}
const operatorCab: Module = { id: 'operator-cab', label: 'Windowed operator cabin', inlet: studs(0, 0, 0, 2, 2), steps: [
  s('Set the operator cabin above the support.', p('brick-2x2', 'body', 0, 0, 0)),
  s('Add the cabin window and rear wall.', p('brick-1x2', 'glass', 0, 0, 3), p('brick-1x2', 'body', 0, 1, 3)),
  s('Overhang the cabin roof.', p('plate-2x4', 'trim', -1, 0, 6)),
] };
const controls: Module = { id: 'controls', label: 'Raised control housing', inlet: studs(0, 0, 0, 2, 2), steps: [s('Shape the control housing above the frame.', p('slope-2x2', 'dark', 0, 0, 0))] };
function worktable(tall: boolean): Module {
  return { id: tall ? 'tall-press' : 'low-press', label: 'Loading table and static press head', inlet: studs(0, 0, 0, 2, 2), steps: [
    s('Raise a loading table inside the open work bay.', p('brick-2x2', 'dark', 0, 0, 0)),
    s('Widen the table surface.', p('plate-2x4', 'trim', -1, 0, 3)),
    s('Place a workpiece in the loading area.', p('brick-1x2', 'light', 0, 0, 4)),
    ...(tall ? [s('Raise the fixed press ram from the workpiece.', p('brick-1x2', 'dark', 0, 0, 7))] : []),
    s('Close the static press head against the overhead beam. These pieces do not move.', p('plate-1x2', 'dark', 0, 0, tall ? 10 : 7), p('plate-1x2', 'dark', 0, 0, tall ? 11 : 8)),
  ] };
}
const machines = [false, true].flatMap(tall => compileBlueprint({ id: 'workshop-gantry', family: 'gantry', name: 'Workshop Gantry', category: 'Machines', strategy: 'machines', tags: ['machine', 'press', 'gantry'], pitch: 'A static gantry press with separated supports, a raised loading table and a press head against the workpiece.', features: ['Open supported frame', 'Raised work table', 'Static press head'], palette: { body: 'yellow', base: 'light-gray', trim: 'red', dark: 'black', light: 'white', glass: 'trans-clear' }, contrast: [['body', 'dark']] }, [gantryFrame(tall)], [{ key: 'equipment', socket: 'equipment', choices: [operatorCab, controls] }, { key: 'work', socket: 'work', choices: [worktable(tall)] }]));

export const FAMILY_RECIPES: Recipe[] = [...aircraft, ...characters, ...machines];
