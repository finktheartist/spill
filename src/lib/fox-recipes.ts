import type { Recipe, RecipePart, RecipeStep, Role } from './library-recipes';
import { assemble, layer as s, part as p, recipe, studs, type Module } from './recipe-kit';

export type FoxFinish = 'curved' | 'sloped' | 'layered';
// Each contour is a whole construction option with the same mounting footprint.
// The layered option changes height and silhouette; it is not an approximate part substitution.
function contour(f: FoxFinish, role: Role, x: number, y: number, z: number, rot = 0, narrow = false): RecipePart[] {
  if (f !== 'layered') return [p(`${f === 'curved' ? 'curve' : 'slope'}-${narrow ? 1 : 2}x2`, f === 'sloped' && narrow && role === 'body' ? 'light' : role, x, y, z, rot)];
  if (narrow) return [p('plate-1x2', role, x, y, z, 90), p('tile-1x2', role, x, y, z + 1, 90)];
  const w = narrow ? 1 : 2;
  const highY = rot === 180 ? y : y + 1;
  return [p(`plate-${w}x2`, role, x, y, z, narrow ? 90 : 0), p(`plate-1x${w}`, role, x, highY, z + 1), p(`tile-1x${w}`, role, x, highY, z + 2)];
}

function foxBody(f: FoxFinish): Module {
  const boot: Role = f === 'layered' ? 'body' : 'dark';
  return { id: `fox-anatomy-${f}`, label: 'Narrow lower legs, full chest and separate haunches', ports: { head: studs(4, 6, 16, 2, 2), tail: studs(4, 14, 13, 2, 1) }, steps: [
    s('Set four narrow paws apart, with the hind paws farther back.', ...[3, 6].flatMap(x => [p('brick-1x2', boot, x, 6, 0, 90), p('brick-1x2', boot, x, 12, 0, 90)])),
    s('Raise the slim lower legs and bring the hind knees forward.', ...[3, 6].flatMap(x => [p('brick-1x2', 'body', x, 6, 3, 90), p('brick-1x2', 'body', x, 11, 3, 90)])),
    s('Build the shoulders and the broader folded hind thighs.', ...[3, 6].map(x => p(f === 'layered' ? 'brick-1x3' : 'brick-1x2', 'light', x, f === 'layered' ? 6 : 7, 6, 90)), p('brick-2x2', 'body', 2, 10, 6), p('brick-2x2', 'body', 6, 10, 6)),
    s('Bridge the legs with the belly and extend the haunch ledges.', ...(f === 'layered' ? [p('plate-6x8', 'base', 2, 7, 9, 90)] : [p('plate-4x8', 'base', 3, 7, 9, 90), p('plate-1x4', 'body', 2, 9, 9, 90), p('plate-1x4', 'body', 7, 9, 9, 90)])),
    s('Build a pale chest between the shoulders, then interlock the ribs and rump.', ...(f === 'layered' ? [p('brick-2x4', 'light', 3, 7, 10), p('brick-1x6', 'body', 3, 9, 10, 90), p('brick-2x6', 'body', 4, 9, 10, 90), p('brick-1x6', 'body', 6, 9, 10, 90)] : [ p('brick-1x6', 'body', 3, 7, 10, 90), p('brick-2x2', 'light', 4, 7, 10), p('brick-1x6', 'body', 6, 7, 10, 90), p('brick-2x4', 'body', 4, 9, 10, 90), p('brick-2x4', 'body', 3, 13, 10)])),
    s('Give the chest height and raise the hip line above the belly.', ...(f === 'layered' ? [p('brick-2x4', 'light', 3, 7, 13), p('plate-2x4', 'body', 3, 12, 13), p('plate-1x4', 'body', 3, 12, 14), p('tile-1x4', 'body', 3, 12, 15)] : [ p('brick-1x2', 'body', 3, 7, 13, 90), p('brick-2x2', 'light', 4, 7, 13), p('brick-1x2', 'body', 6, 7, 13, 90), p('brick-2x4', 'body', 3, 12, 13)])),
    s('Contour the shoulders, recessed back and hindquarters.', ...(f === 'layered' ? [p('plate-2x4', 'body', 3, 10, 13), p('tile-1x2', 'body', 2, 10, 10, 90), p('tile-1x2', 'body', 7, 10, 10, 90)] : [ ...[3, 6].flatMap(x => contour(f, 'body', x, 8, 16, 0, true)), ...(f === 'sloped' ? [p('plate-2x4', 'body', 3, 10, 13)] : [3, 5].flatMap(x => contour(f, 'body', x, 10, 13))), ...[3, 5].flatMap(x => contour(f, 'body', x, 12, 16, 180)), ...[2, 7].flatMap(x => contour(f, 'body', x, 10, 10, 0, true))])),
  ] };
}

function foxHead(f: FoxFinish): Module {
  const face: Role = f === 'layered' ? 'trim' : 'light';
  const steps: RecipeStep[] = [
    s('Mount the wide cheek support low on the shoulders.', p('plate-2x6', f === 'layered' ? face : 'base', 0, 3, 0)),
    s('Project the narrow lower jaw and support both cheeks.', p('plate-2x4', face, 2, 0, 1, 90), ...[0, 4].map(x => p(f === 'layered' ? 'plate-2x3' : 'plate-2x2', face, x, f === 'layered' ? 2 : 3, 1, f === 'layered' ? 90 : 0))),
    s('Bridge the skull behind the muzzle and finish the small dark nose.', p('plate-2x4', 'base', 1, 3, 2), p('plate-1x2', 'dark', 2, 0, 2), ...(f === 'layered' ? [0, 5].flatMap(x => [p('plate-1x4', face, x, 1, 2, 90), p('tile-1x2', face, x, 1, 3, 90)]) : [0, 5].flatMap(x => contour(f, face, x, 2, f === 'curved' ? 1 : 2, 0, true))), ...contour(f, 'body', 2, 1, 2)),
  ];
  if (f === 'layered') {
    steps.push(s('Set two small eyes apart on the cheek line and raise the brow behind them.', p('plate-1x4', 'body', 1, 3, 3), p('brick-1x4', 'body', 1, 4, 3), p('tile-1x1', 'dark', 1, 3, 4), p('tile-1x1', 'dark', 4, 3, 4), p('brick-1x2', 'body', 2, 3, 4)));
    steps.push(s('Close the crown behind the eyes.', p('plate-1x4', 'body', 1, 4, 6), p('plate-2x4', 'body', 1, 3, 7)));
  } else {
    steps.push(s('Place two separated eyes beside the central brow.', p('brick-1x2', 'dark', 1, 3, 3, 90), p('brick-2x2', 'body', 2, 3, 3), p('brick-1x2', 'dark', 4, 3, 3, 90)));
    steps.push(s('Cap the crown while keeping the eye faces exposed.', p('plate-2x4', 'base', 1, 3, 6)));
  }
  const z = f === 'layered' ? 8 : 7;
  steps.push(s('Shape the forehead and two tall separated ears.', ...(f === 'layered' ? [p('brick-1x2', 'body', 2, 3, z)] : contour(f, 'body', 2, 3, z)), ...[1, 4].flatMap(x => f === 'layered' ? [p('brick-1x2', 'body', x, 4, z, 90), p('cheese-1x1', 'accent', x, 5, z + 3)] : [p('slope-1x2', 'dark', x, 4, z), ...(f === 'curved' ? [p('cheese-1x1', 'dark', x, 5, z + 3)] : [])])));
  return { id: `fox-face-${f}`, label: 'Tapered muzzle, separate eyes and pointed ears', inlet: studs(2, 3, 0, 2, 2), steps };
}

function foxTail(f: FoxFinish): Module {
  if (f === 'sloped') return { id: 'fox-tail-sloped', label: 'Slender rising brush with a pale tip', inlet: studs(0, 0, 0, 2, 1), steps: [s('Extend the narrow brush from the rump.', p('plate-2x6', 'base', 0, 0, 0, 90), p('brick-2x3', 'body', 0, 1, 1, 90)), s('Give the brush a tapered outline and pale tip.', p('slope-2x2', 'body', 0, 2, 4, 180), p('brick-2x2', 'light', 0, 4, 1), p('tile-2x2', 'light', 0, 4, 4))] };
  if (f === 'layered') return { id: 'fox-tail-layered', label: 'Broad layered brush tapering to a pale tip', inlet: studs(0, 0, 0, 2, 1), steps: [s('Extend the tail root and widen its middle.', p('plate-2x8', 'dark', 0, 0, 0, 90), p('plate-2x4', 'body', -1, 2, 1), p('plate-2x3', 'body', 0, 4, 1, 90), p('plate-2x2', 'base', 0, 0, 1)), s('Build a taper with overlapping strips and a pale tip.', p('plate-4x4', 'body', -1, 2, 2), p('plate-2x2', 'light', 0, 7, 1), p('plate-2x6', 'body', 0, 0, 3, 90), p('tile-1x2', 'light', 0, 8, 2))] };
  return { id: `fox-tail-${f}`, label: 'Full brush narrowing to a pale tip', inlet: studs(0, 0, 0, 2, 1), steps: [
    s('Extend a strong narrow tail root from the rump.', p('plate-2x8', 'base', 0, 0, 0, 90), p('brick-2x2', 'body', 0, 0, 1)),
    s('Widen the brush and build its solid center.', p('plate-4x4', 'body', -1, 2, 1), p('plate-2x2', 'light', 0, 6, 1), p('brick-2x4', 'body', -1, 2, 2, 90), p('brick-2x4', 'body', 1, 2, 2, 90), p('brick-2x2', 'light', 0, 6, 2)),
    s('Taper the brush in both directions and finish the pale tip.', ...[-1, 1].flatMap(x => [...contour(f, 'body', x, 2, 5), ...contour(f, 'body', x, 4, 5, 180)]), ...contour(f, 'light', 0, 7, f === 'curved' ? 4 : 5, 180)),
  ] };
}

export const FOX_RECIPES: Recipe[] = (['curved', 'sloped', 'layered'] as const).map(f => recipe({
  id: `fox-anatomical-${f}`, family: 'fox', name: 'Woodland Fox', category: 'Animals', designLevel: 2, animalBase: 'quadruped',
  pitch: 'A long tapered muzzle, separate eyes, pale chest, slim legs, shaped haunches and a full white-tipped brush.',
  features: ['Tapered muzzle and separate eyes', 'Chest and haunches above slim legs', 'Full white-tipped brush'],
  tags: ['fox', 'anatomical', 'animal'], variant: f === 'curved' ? 'Anatomical · curved contours' : f === 'sloped' ? 'Anatomical · sloped contours' : 'Anatomical · layered contours',
  palette: { body: f === 'layered' ? 'reddish-brown' : 'orange', light: 'white', dark: 'black', base: 'orange', trim: 'tan', accent: 'medium-nougat' }, contrast: [['body', 'light'], ['light', 'dark'], ...(f === 'layered' ? [['body', 'trim'], ['trim', 'dark']] as [Role, Role][] : [])],
}, assemble([{ key: 'body', module: foxBody(f) }, { key: 'head', module: foxHead(f), parent: 'body', socket: 'head' }, { key: 'tail', module: foxTail(f), parent: 'body', socket: 'tail' }])));
