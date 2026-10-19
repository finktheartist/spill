import type { ColorName } from './bricks';
import type { Recipe, RecipeStep, Role } from './library-recipes';
import { assemble, layer as s, part as p, recipe, studs, type Module } from './recipe-kit';

export type AnimalBase = 'quadruped' | 'stocky' | 'longneck' | 'seated' | 'bird' | 'crawler';
type Finish = 'curved' | 'sloped';
export const ANIMAL_BASES: { id: AnimalBase; label: string; relatives: string[]; identity: string }[] = [
  { id: 'quadruped', label: 'Four-legged', relatives: ['dog', 'puppy', 'fox', 'cat', 'kitten', 'wolf', 'coyote', 'raccoon', 'otter'], identity: 'Four separated paws, an open belly, a projecting muzzle, and a species-specific tail and ears.' },
  { id: 'stocky', label: 'Stocky', relatives: ['bear', 'pig', 'rhino', 'rhinoceros', 'hippo', 'wombat', 'boar'], identity: 'A broad low torso, thick feet, a heavy head, and a distinctive snout or horn.' },
  { id: 'longneck', label: 'Long-necked', relatives: ['giraffe', 'llama', 'alpaca', 'deer', 'horse', 'moose', 'camel'], identity: 'Long separated legs, a narrow raised neck, a small head, and the appropriate ears or antlers.' },
  { id: 'seated', label: 'Seated', relatives: ['rabbit', 'bunny', 'hare', 'squirrel', 'kangaroo', 'wallaby', 'chipmunk'], identity: 'Large hind feet and haunches, a raised chest, small front paws, and characteristic ears and tail.' },
  { id: 'bird', label: 'Bird', relatives: ['duck', 'owl', 'penguin', 'puffin', 'parrot', 'chicken', 'eagle', 'bird'], identity: 'Two feet, a shaped breast, separate wings, a head with a beak, and an appropriate tail.' },
  { id: 'crawler', label: 'Low crawler', relatives: ['turtle', 'tortoise', 'crocodile', 'alligator', 'lizard', 'gecko', 'salamander'], identity: 'A low body with four splayed feet, a distinct head, and either a shell or a long tapering tail.' },
];

// Finishing surfaces never carry another module. Curves use their real lower socket row; their rear row is raised one plate.
const cap = (finish: Finish, role: Role, x: number, y: number, z: number, rot = 0, narrow = false) =>
  p(`${finish === 'curved' ? 'curve' : 'slope'}-${narrow ? '1' : '2'}x2`, role, x, y, z, rot);

export function animalBaseModule(base: AnimalBase, finish: Finish): Module {
  const label = ANIMAL_BASES.find(b => b.id === base)!.label;
  const mod: Module = { id: `animal-${base}-${finish}`, label: `${label} body`, steps: [], ports: {} };
  if (base === 'quadruped' || base === 'longneck') {
    const tall = base === 'longneck', z = tall ? 7 : 4;
    mod.steps = [
      s('Set four broad paws apart, with the toes pointing forward.', ...[1, 5].flatMap(x => [p('plate-2x2', 'trim', x, 2, 0), p('plate-2x2', 'trim', x, 6, 0)])),
      s('Raise four separate legs.', ...[2, 5].flatMap(x => [3, 7].flatMap(y => [p(tall ? 'brick-1x1' : 'brick-1x2', 'body', x, y, 1, 90), ...(tall ? [p('brick-1x2', 'body', x, y, 4, 90)] : [])]))),
      s('Bridge the legs, leaving the space beneath the belly open.', p('plate-2x6', 'base', 2, 3, z, 90), p('plate-2x6', 'base', 4, 3, z, 90)),
      s('Cross the belly seams with the shoulders, back, and hips.', ...[3, 5, 7].map(y => p('brick-2x4', 'body', 2, y, z + 1))),
      s('Shape the back, shoulders, and hips, keeping the head and tail sockets clear.', cap(finish, 'body', 2, 5, z + 4, 270), cap(finish, 'body', 4, 5, z + 4, 90), ...(finish === 'curved' ? [2, 5].flatMap(x => [3, 7].map(y => cap(finish, 'body', x, y, z + 4, 0, true))) : [])),
    ];
    mod.ports = { head: studs(3, 3, z + 4, 2, 2), tail: studs(3, 8, z + 4, 2, 1) };
  } else if (base === 'stocky') {
    mod.steps = [
      s('Place four stout feet around an open belly.', ...[2, 6].flatMap(x => [3, 7].map(y => p('brick-2x2', 'body', x, y, 0)))),
      s('Join the feet with the broad belly.', p('plate-6x6', 'base', 2, 3, 3)),
      s('Build the broad torso.', ...[3, 5, 7].map(y => p('brick-2x6', 'body', 2, y, 4))),
      s('Shape the shoulders and flanks around a narrow back.', ...[4, 6].flatMap(y => [cap(finish, 'body', 2, y, 7, 270), p('brick-2x2', 'body', 4, y, 7), cap(finish, 'body', 6, y, 7, 90)])),
      s('Smooth the center of the back.', p('tile-2x4', 'body', 4, 4, 10, 90)),
    ];
    mod.ports = { head: studs(4, 2, 7, 2, 2), tail: studs(4, 8, 7, 2, 1) };
  } else if (base === 'seated') {
    mod.steps = [
      s('Lay out the long hind feet and the rear haunch support.', p('plate-2x2', 'body', 2, 2, 0), p('plate-2x2', 'body', 4, 2, 0), p('plate-4x6', 'body', 1, 4, 0)),
      s('Tie the feet to the rump and shape their toes.', p('plate-2x6', 'body', 1, 3, 1), p('plate-2x6', 'body', 1, 5, 1), p('plate-1x6', 'body', 1, 7, 1), cap(finish, 'body', 2, finish === 'curved' ? 2 : 1, 1), cap(finish, 'body', 4, finish === 'curved' ? 2 : 1, 1)),
      s('Raise the haunches around the lower torso.', p('brick-2x4', 'body', 2, 4, 2), p('brick-2x4', 'body', 2, 6, 2), cap(finish, 'body', 1, 4, 2, 0, true), cap(finish, 'body', 6, 4, 2, 0, true)),
      s('Taper the upright chest and set two small front paws.', p('brick-2x4', 'body', 2, 4, 5), p('brick-2x2', 'body', 3, 6, 5), p('plate-1x2', 'light', 2, 3, 8, 90), p('plate-1x2', 'light', 5, 3, 8, 90)),
    ];
    mod.ports = { head: studs(3, 4, 8, 2, 2), tail: studs(3, 7, 8, 2, 1) };
  } else if (base === 'bird') {
    mod.steps = [
      s('Set two feet apart and raise the short legs.', p('plate-2x3', 'trim', 2, 1, 0, 90), p('plate-2x3', 'trim', 4, 1, 0, 90), p('brick-1x1', 'trim', 3, 3, 1), p('brick-1x1', 'trim', 4, 3, 1)),
      s('Bridge the legs with the belly and build the lower breast.', p('plate-4x4', 'body', 2, 1, 4), p('brick-2x4', 'light', 2, 1, 5), p('brick-2x4', 'body', 2, 3, 5)),
      s('Shape the breast and spread a supporting strip under both wings.', cap(finish, 'light', 2, 0, finish === 'curved' ? 7 : 8), cap(finish, 'light', 4, 0, finish === 'curved' ? 7 : 8), p('plate-2x6', 'body', 1, 2, 8)),
      s('Raise the shoulders between two distinct wings.', p('brick-2x4', 'body', 2, 2, 9), cap(finish, 'body', 1, 2, 9, 0, true), cap(finish, 'body', 6, 2, 9, 0, true)),
    ];
    mod.ports = { head: studs(3, 2, 12, 2, 2), tail: studs(3, 4, 8, 2, 1) };
  } else {
    mod.steps = [
      s('Spread four feet out from the low body.', ...[1, 5].flatMap(x => [3, 6].map(y => p('plate-2x2', 'body', x, y, 0)))),
      s('Bridge the feet and extend a support for the neck.', p('plate-2x6', 'body', 2, 2, 1, 90), p('plate-2x6', 'body', 4, 2, 1, 90)),
      s('Build the low torso, leaving the front ledge for the head.', p('brick-2x4', 'body', 2, 4, 2), p('brick-2x4', 'body', 2, 6, 2)),
    ];
    mod.ports = { head: studs(3, 2, 2, 2, 2), tail: studs(3, 7, 5, 2, 1), back: studs(2, 4, 5, 4, 4) };
  }
  return mod;
}

type Species = { id: string; name: string; base: AnimalBase; body: ColorName; trim?: ColorName; light?: ColorName; features: string[]; neck?: number; ears?: 'pointed' | 'floppy' | 'long' | 'round' | 'antlers' | 'horns' | 'none'; tail: 'raised' | 'bushy' | 'long' | 'stub' | 'flat'; beak?: boolean };
export const ANIMAL_SPECIES: Species[] = [
  { id: 'fox', name: 'Woodland Fox', base: 'quadruped', body: 'orange', features: ['Pointed ears', 'Pale muzzle', 'Broad white-tipped tail'], ears: 'pointed', tail: 'bushy' },
  { id: 'cat', name: 'Garden Cat', base: 'quadruped', body: 'light-gray', features: ['Pointed ears', 'Short muzzle', 'Upright hooked tail'], ears: 'pointed', tail: 'raised' },
  { id: 'dog', name: 'Trail Dog', base: 'quadruped', body: 'tan', features: ['Floppy ears', 'Projecting muzzle', 'Long wagging tail'], ears: 'floppy', tail: 'long' },
  { id: 'bear', name: 'Woodland Bear', base: 'stocky', body: 'reddish-brown', light: 'tan', features: ['Broad shoulders', 'Round ears', 'Pale short muzzle'], ears: 'round', tail: 'stub' },
  { id: 'pig', name: 'Farmyard Pig', base: 'stocky', body: 'bright-pink', light: 'white', features: ['Wide flat snout', 'Small triangular ears', 'Curled upright tail'], ears: 'pointed', tail: 'raised' },
  { id: 'rhino', name: 'Savanna Rhino', base: 'stocky', body: 'light-gray', light: 'light-gray', features: ['Low heavy body', 'Projecting horn', 'Wide armored head'], ears: 'round', tail: 'stub' },
  { id: 'giraffe', name: 'Tall Giraffe', base: 'longneck', body: 'yellow', trim: 'reddish-brown', light: 'tan', features: ['Very tall neck', 'Twin head horns', 'Long separate legs'], neck: 12, ears: 'horns', tail: 'long' },
  { id: 'llama', name: 'Mountain Llama', base: 'longneck', body: 'tan', features: ['Upright neck', 'Two tall ears', 'Short lifted tail'], neck: 6, ears: 'long', tail: 'stub' },
  { id: 'deer', name: 'Forest Deer', base: 'longneck', body: 'reddish-brown', light: 'tan', trim: 'tan', features: ['Slender legs', 'Branched antlers', 'Small raised muzzle'], neck: 3, ears: 'antlers', tail: 'stub' },
  { id: 'rabbit', name: 'Long-Eared Rabbit', base: 'seated', body: 'white', light: 'white', features: ['Long separated ears', 'Large hind feet', 'Small round tail'], ears: 'long', tail: 'stub' },
  { id: 'squirrel', name: 'Woodland Squirrel', base: 'seated', body: 'reddish-brown', light: 'tan', features: ['Tall curled bushy tail', 'Small front paws', 'Upright haunches'], ears: 'pointed', tail: 'bushy' },
  { id: 'kangaroo', name: 'Outback Kangaroo', base: 'seated', body: 'tan', light: 'tan', features: ['Long balancing tail', 'Large hind feet', 'Tall ears and raised head'], neck: 3, ears: 'long', tail: 'long' },
  { id: 'duck', name: 'Pond Duck', base: 'bird', body: 'white', trim: 'orange', light: 'white', features: ['Broad flat bill', 'Two folded wings', 'Webbed feet'], ears: 'none', tail: 'flat', beak: true },
  { id: 'owl', name: 'Woodland Owl', base: 'bird', body: 'tan', light: 'white', trim: 'orange', features: ['Large framed eyes', 'Two ear tufts', 'Small central beak'], ears: 'pointed', tail: 'flat', beak: true },
  { id: 'penguin', name: 'Polar Penguin', base: 'bird', body: 'black', light: 'white', trim: 'orange', features: ['White breast', 'Dark rounded head', 'Short beak and flippers'], ears: 'none', tail: 'flat', beak: true },
  { id: 'turtle', name: 'Garden Turtle', base: 'crawler', body: 'green', light: 'tan', trim: 'dark-green', features: ['Domed shell', 'Four splayed feet', 'Small raised head'], ears: 'none', tail: 'stub' },
  { id: 'crocodile', name: 'River Crocodile', base: 'crawler', body: 'dark-green', light: 'tan', trim: 'green', features: ['Long toothed jaw', 'Dorsal ridges', 'Long tapered tail'], ears: 'none', tail: 'long' },
  { id: 'lizard', name: 'Garden Lizard', base: 'crawler', body: 'green', trim: 'lime', light: 'tan', features: ['Low splayed stance', 'Narrow pointed face', 'Long thin tail'], ears: 'none', tail: 'long' },
];

function owlHead(finish: Finish): Module {
  return { id: `owl-head-${finish}`, label: 'Wide facial disc, framed eyes, and small pointed beak', inlet: studs(2, 2, 0, 2, 2), steps: [
    s('Support the broad facial disc on a short neck.', p('plate-2x2', 'body', 2, 2, 0), p('plate-2x6', 'light', 0, 1, 3)),
    s('Frame two large eyes in a pale face.', ...[0, 3, 5].map(x => p('brick-1x1', 'light', x, 1, 4)), ...[1, 4].map(x => p('brick-1x1', 'dark', x, 1, 4)), p('brick-1x6', 'body', 0, 2, 4), p('plate-1x2', 'trim', 2, 0, 4, 90), p('cheese-1x1', 'trim', 2, 0, 5)),
    s('Cap the facial disc and shape the crown between the ear tufts.', p('plate-2x6', 'body', 0, 1, 7), cap(finish, 'body', 2, 1, 8), p('slope-1x2', 'body', 0, 2, 8), p('slope-1x2', 'body', 5, 2, 8), p('tile-1x2', 'body', 0, 1, 8), p('tile-1x2', 'body', 4, 1, 8)),
  ].map(step => ({ ...step, parts: step.parts.map(part => ({ ...part, z: part.z >= 3 ? part.z - 2 : part.z })) })) };
}

function smallReptileHead(a: Species, finish: Finish): Module {
  return { id: `${a.id}-head-${finish}`, label: 'Small centered reptile head with separate eyes', inlet: studs(0, 1, 0, 2, 2), steps: [
    s('Extend a short neck and low head beyond the shell or back.', p('plate-2x3', 'body', 0, finish === 'curved' ? -1 : 0, 0, 90), p('brick-2x2', 'body', 0, 1, 1)),
    s('Taper the snout and place two eyes above it.', ...(a.id === 'lizard' && finish === 'curved' ? [p('curve-1x3', 'body', 0, -2, 1), p('curve-1x3', 'body', 1, -2, 1)] : [cap(finish, 'body', 0, -1, 1)]), ...[0, 1].map(x => p(finish === 'curved' ? 'roundtile-1x1' : 'plate-1x1', 'dark', x, 1, 4))),
    s('Smooth the rear of the small head.', p('tile-1x2', 'body', 0, 2, 4)),
  ] };
}

function headModule(a: Species, finish: Finish): Module {
  if (a.id === 'owl') return owlHead(finish);
  if (a.id === 'turtle' || a.id === 'lizard') return smallReptileHead(a, finish);
  const n = a.neck ?? 0, steps: RecipeStep[] = [];
  for (let z = 0; z < n; z += 3) steps.push(s('Raise the narrow neck before adding the head.', p('brick-1x2', a.id === 'giraffe' && z % 6 ? 'trim' : 'body', 1, 2, z), p('brick-1x2', 'body', 1, 3, z)));
  steps.push(s('Set the neck and bridge it with the head base.', p('brick-2x2', 'body', 1, 2, n), p('plate-2x4', 'body', 0, 1, n + 3)));
  // One-plate eyes between cheek and brow layers retain expression without a
  // dark three-plate-high visor. Both contour finishes use the same face anatomy.
  const eye = [
    ...[0, 3].flatMap(x => [p('plate-1x2', 'light', x, 1, n + 4, 90), p('plate-1x1', 'dark', x, 1, n + 5), p('plate-1x1', 'body', x, 2, n + 5), p('plate-1x2', 'light', x, 1, n + 6, 90)]),
  ];
  steps.push(s('Frame two separated eyes above a projecting muzzle or beak.', ...eye, p('brick-1x2', 'body', 1, 2, n + 4), p(a.id === 'crocodile' ? 'plate-2x6' : a.id === 'duck' || a.id === 'rhino' ? 'plate-2x3' : 'plate-2x2', a.beak ? 'trim' : a.id === 'pig' || a.id === 'crocodile' ? 'body' : 'light', 1, a.id === 'crocodile' ? -4 : a.id === 'duck' || a.id === 'rhino' ? -1 : 0, n + 4, a.id === 'duck' || a.id === 'rhino' || a.id === 'crocodile' ? 90 : 0)));
  steps.push(s('Finish the nose, close the face, and cap the head.', ...(a.id === 'penguin' ? [1, 2].map(x => p('cheese-1x1', 'trim', x, 0, n + 5)) : [p(a.beak ? 'tile-1x2' : 'plate-1x2', a.beak ? 'trim' : a.id === 'pig' ? 'body' : 'dark', 1, a.id === 'crocodile' ? -4 : a.id === 'duck' || a.id === 'rhino' ? -1 : 0, n + 5)]), p('plate-1x2', a.id === 'pig' ? 'body' : 'light', 1, 1, n + 5), p('plate-1x2', a.id === 'pig' ? 'body' : 'light', 1, 1, n + 6), p('plate-2x4', 'body', 0, 1, n + 7)));
  steps.push(s('Round the forehead without covering the eyes.', cap(finish, 'body', 1, 1, n + 8), ...(finish === 'curved' ? [p('tile-1x1', 'body', 0, 1, n + 8), p('tile-1x1', 'body', 3, 1, n + 8)] : [])));
  const ears = a.ears ?? 'none';
  if (ears !== 'none') steps.push(s('Add the distinctive ears or antlers.', ...[0, 3].flatMap(x => {
    if (ears === 'floppy') return [p('plate-1x2', 'body', x === 0 ? -1 : 3, 2, n + 8), cap(finish, finish === 'sloped' ? 'light' : 'body', x === 0 ? -1 : 4, finish === 'curved' ? 2 : 1, n + 9, 0, true)];
    if (ears === 'long') return [p('brick-1x1', 'body', x, 2, n + 8), p('brick-1x1', 'body', x, 2, n + 11), p(finish === 'curved' ? 'cheese-1x1' : 'plate-1x1', 'body', x, 2, n + 14)];
    if (ears === 'horns') return [p('roundbrick-1x1', 'trim', x, 2, n + 8), p('roundtile-1x1', 'trim', x, 2, n + 11)];
    if (ears === 'antlers') return [p('brick-1x1', 'trim', x, 2, n + 8), p('plate-1x3', 'trim', x === 0 ? -2 : 3, 2, n + 11), p('brick-1x1', 'trim', x === 0 ? -2 : 5, 2, n + 12), p('brick-1x1', 'trim', x, 2, n + 12)];
    if (ears === 'round') return [p(finish === 'curved' ? 'roundbrick-1x1' : 'brick-1x1', 'body', x, 2, n + 8)];
    return [p('slope-1x2', finish === 'sloped' ? 'light' : 'body', x, 2, n + 8)];
  })));
  if (a.id === 'pig') steps.push(s('Build a broad snout with two nostrils.', p('plate-1x2', 'body', 1, 0, n + 6), p('plate-1x2', 'body', 1, 0, n + 7), p('roundtile-1x1', 'dark', 1, 0, n + 8), p('roundtile-1x1', 'dark', 2, 0, n + 8)));
  if (a.id === 'rhino') steps.push(s('Raise the nose horn above the broad snout.', p('plate-1x2', 'light', 1, -1, n + 6), p('cone-1x1', 'light', 1, -1, n + 7)));
  if (a.id === 'crocodile') steps.push(s('Set the teeth along both sides of the long jaw.', ...[-3, -1].flatMap(y => [p('plate-1x1', 'light', 1, y, n + 5), p('plate-1x1', 'light', 2, y, n + 5)])));
  // Stocky animals and birds need their heads nestled into the shoulders.
  const lowNeck = n === 0 && (a.base === 'stocky' || a.base === 'bird');
  return { id: `${a.id}-head-${finish}`, label: a.features.slice(0, 2).join(' and '), inlet: studs(1, 2, 0, 2, 2), steps: lowNeck ? steps.map(step => ({ ...step, parts: step.parts.map(part => part.z === 0 ? { ...part, shape: 'plate-2x2' } : { ...part, z: part.z - 2 }) })) : steps };
}

function tailModule(a: Species, finish: Finish): Module {
  let parts: RecipeStep[];
  if (a.tail === 'bushy') {
    parts = [s('Extend the broad tail from the rump.', p('plate-2x4', 'base', 0, 0, 0, 90), p('brick-2x3', 'body', 0, 1, 1, 90)),
      ...(a.base === 'seated' ? [s('Curl the large tail upward behind the body.', p('brick-2x2', 'body', 0, 2, 4), p('brick-2x2', 'body', 0, 2, 7), cap(finish, 'body', 0, 2, 10, 180))] : [s('Taper the bushy tail to a contrasting tip.', cap(finish, 'body', 0, 1, 4), ...(finish === 'curved' ? [cap(finish, 'light', 0, 3, 3, 180)] : [p('tile-2x2', 'light', 0, 3, 4)]))])];
  } else if (a.tail === 'raised') {
    parts = [s('Raise the tail and hook its tip.', p('brick-1x1', 'body', 0, 0, 0), p('plate-1x2', 'body', 0, 0, 3, 90), p('brick-1x1', 'body', 0, 1, 4), p('tile-1x2', 'body', 0, 1, 7))];
  } else if (a.tail === 'long') {
    const wide = a.base === 'crawler' || a.base === 'seated';
    parts = [s('Extend a long balancing tail and taper the far end.', p(wide ? 'plate-2x6' : 'plate-1x4', 'base', 0, 0, 0, 90), cap(finish, finish === 'sloped' && !wide ? 'light' : 'body', 0, wide ? 2 : 1, 1, 180, !wide), p('tile-1x2', a.id === 'giraffe' ? 'trim' : 'body', 0, wide ? 4 : 3, 1, 90))];
  } else if (a.tail === 'flat') {
    parts = [s('Fan the short tail behind the folded wings.', p('plate-2x3', 'body', 0, 0, 0, 90), cap(finish, 'body', 0, 1, 1, 180))];
  } else {
    parts = [s('Add the short tail at the rear.', p('plate-1x2', 'body', 0, 0, 0), p(finish === 'curved' ? 'roundplate-1x1' : 'plate-1x1', 'body', 0, 0, 1))];
  }
  return { id: `${a.id}-tail-${finish}`, label: a.features[a.features.length - 1], inlet: studs(0, 0, 0, 2, 1), steps: parts };
}

function backModule(a: Species, finish: Finish): Module {
  return { id: `${a.id}-back-${finish}`, label: a.id === 'turtle' ? 'Domed shell' : 'Tapered back and dorsal ridge', inlet: studs(0, 0, 0, 4, 4), steps: a.id === 'turtle' ? [
    s('Build a domed shell with a clear rear opening for the tail.', cap(finish, 'trim', 0, 0, 0), cap(finish, 'trim', 2, 0, 0), cap(finish, 'trim', 0, 2, 0, 180, true), cap(finish, 'trim', 3, 2, 0, 180, true), p('tile-1x2', 'trim', 1, 2, 0)),
  ] : [
    s('Taper the back on either side of the spine.', ...[0, 2].flatMap(y => [cap(finish, 'body', 0, y, 0, 0, true), cap(finish, 'body', 3, y, 0, 0, true)]), p('brick-2x2', 'trim', 1, 0, 0), p('brick-1x2', 'trim', 1, 2, 0)),
    s('Cap the low dorsal ridge while leaving the tail socket open.', p('tile-2x2', 'trim', 1, 0, 3), p('tile-1x2', 'trim', 1, 2, 3)),
  ] };
}

// Shift complete assemblies, not individual parts, when antlers or a long jaw overhang the root.
function normalized(r: Recipe): Recipe {
  const parts = r.steps.flatMap(s => s.parts), dx = -Math.min(0, ...parts.map(p => p.x)), dy = -Math.min(0, ...parts.map(p => p.y));
  if (!dx && !dy) return r;
  return { ...r, steps: r.steps.map(s => ({ ...s, parts: s.parts.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) })), modules: r.modules?.map(m => ({ ...m, offset: [m.offset[0] + dx, m.offset[1] + dy, m.offset[2]] })) };
}
const palettes = (a: Species): Recipe['palette'] => ({ body: a.body, trim: a.trim ?? a.body, light: a.light ?? 'white', dark: 'black', base: a.body });
export const ANIMAL_RECIPES: Recipe[] = ANIMAL_SPECIES.flatMap(a => (['curved', 'sloped'] as const).map(finish => {
  const base = animalBaseModule(a.base, finish), info = ANIMAL_BASES.find(b => b.id === a.base)!;
  return normalized(recipe({ id: `animal-${a.id}-${finish}`, family: a.id, name: a.name, pitch: `${a.features.join(', ')} on a shaped ${info.label.toLowerCase()} body.`, features: a.features,
    category: 'Animals', designLevel: 1, tags: [a.id, info.label, 'animal'], variant: finish === 'curved' ? 'Sculpted curves' : 'Sloped contours', palette: palettes(a), contrast: [['light', 'dark']], animalBase: a.base,
  }, assemble([{ key: 'body', module: base }, { key: 'head', module: headModule(a, finish), parent: 'body', socket: 'head' }, { key: 'tail', module: tailModule(a, finish), parent: 'body', socket: 'tail' }, ...(a.base === 'crawler' ? [{ key: 'back', module: backModule(a, finish), parent: 'body', socket: 'back' }] : [])])));
}));

// Unfinished bases are agent-only. They are never offered as complete animals in the library.
export const ANIMAL_BASE_RECIPES: Recipe[] = ANIMAL_BASES.flatMap(info => (['curved', 'sloped'] as const).map(finish => recipe({
  id: `animal-base-${info.id}-${finish}`, family: `animal-base-${info.id}`, name: `${info.label} animal base`, pitch: info.identity, features: [info.identity],
  palette: { body: 'tan', light: 'white', trim: 'tan', base: 'tan' }, category: 'Animals', tags: info.relatives, variant: finish === 'curved' ? 'Curved body' : 'Sloped body', animalBase: info.id,
}, assemble([{ key: 'body', module: animalBaseModule(info.id, finish) }]))));
