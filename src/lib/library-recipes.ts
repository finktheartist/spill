import { DEVELOPED_RECIPES } from './developed-recipes';
import { SHOWCASE_RECIPES } from './showcase-recipes';
import { FAMILY_RECIPES } from './family-recipes';
import { FOX_RECIPES } from './fox-recipes';
import { ANIMAL_RECIPES, type AnimalBase } from './animal-recipes';
import type { ColorName } from './bricks';
import { EXPANDED_RECIPES } from './library-catalog';
import type { ConstructionFamily } from './construction-families';

export type Role = 'body' | 'trim' | 'dark' | 'light' | 'glass' | 'base' | 'accent' | 'foliage';
export interface RecipePart { shape: string; role: Role; x: number; y: number; z: number; rot: number }
export interface RecipeStep { caption: string; parts: RecipePart[]; feature?: { name: string; kind: 'structure' | 'identity' | 'finish' } }
export interface Recipe {
  id: string; family: string; name: string; pitch: string; features: string[];
  /** Optional hard color boundaries for a functional or visible zone. */
  allowedColors?: Partial<Record<Role, ColorName[]>>;
  palette: Partial<Record<Role, ColorName>>; contrast: [Role, Role][]; steps: RecipeStep[];
  category?: 'Animals' | 'Vehicles' | 'Buildings' | 'Objects' | 'Nature' | 'Characters' | 'Machines';
  strategy?: ConstructionFamily;
  variant?: string; tags?: string[];
  /** Authored construction tier; only set for a developed, visually reviewed design. */
  designLevel?: number;
  animalBase?: AnimalBase;
  modules?: { id: string; label: string; parent?: string; socket?: string; offset: [number, number, number] }[];
}
const p = (shape: string, role: Role, x: number, y: number, z: number, rot = 0): RecipePart => ({ shape, role, x, y, z, rot });
const step = (caption: string, ...parts: RecipePart[]): RecipeStep => ({ caption, parts });

// Original Spill designs, informed by the reference review in qa/references-20261008.
// No part is cosmetic-only: these exact placements drive preview, stock matching and instructions.
// Upright stud connections only. Do not substitute unsupported wedges, hinges or side studs.
const ORIGINAL_RECIPES: Recipe[] = [
  {
    id: 'guitar', family: 'guitar', name: 'Pocket Guitar',
    pitch: 'Twin horns, a long fretboard and two dark pickups.',
    features: ['Stepped body with twin horns', 'Narrow contrasting neck', 'Two pickups'],
    palette: { body: 'red', trim: 'light-gray', dark: 'black', light: 'white' }, contrast: [['body', 'dark'], ['body', 'light']],
    steps: [
      step('Lay out the body backing. The next layer will join the pieces.',
        p('plate-2x4', 'trim', 0, 2, 0, 90), p('plate-2x4', 'trim', 2, 2, 0, 90), p('plate-2x4', 'trim', 4, 2, 0, 90)),
      step('Add a crosswise layer to join the body backing.',
        p('plate-2x6', 'body', 0, 2, 1), p('plate-2x6', 'body', 0, 4, 1)),
      step('Extend the neck and add the two horns beside it.',
        p('plate-2x6', 'trim', 2, 5, 2, 90), p('plate-1x2', 'body', 0, 5, 2, 90), p('plate-1x2', 'body', 5, 5, 2, 90),
        p('tile-1x2', 'dark', 2, 2, 2), p('tile-1x2', 'dark', 2, 4, 2), p('plate-1x2', 'light', 4, 3, 2, 90)),
      step('Run the fretboard along the neck, then cap the headstock.',
        p('plate-2x4', 'light', 2, 6, 3, 90), p('plate-2x2', 'light', 2, 10, 3), p('tile-1x2', 'light', 2, 11, 4)),
    ],
  },
  {
    id: 'biplane', family: 'plane', name: 'Little Biplane',
    pitch: 'Two broad wings, an open cockpit and an upright tail.',
    features: ['Two separated wings', 'Slender fuselage', 'Tail fin and cockpit'],
    palette: { body: 'red', trim: 'black', dark: 'black', light: 'light-gray', glass: 'trans-clear' }, contrast: [['body', 'trim']],
    steps: [
      step('Lay out the narrow fuselage.',
        p('plate-2x6', 'trim', 5, 0, 0, 90), p('plate-2x4', 'trim', 5, 6, 0, 90)),
      step('Add the lower wings, tail support and sloping nose.',
        p('plate-2x6', 'light', 0, 4, 1), p('plate-2x6', 'light', 6, 4, 1),
        p('plate-2x4', 'trim', 5, 6, 1, 90), p('slope-2x2', 'body', 5, 0, 1), p('brick-2x2', 'body', 5, 2, 1)),
      step('Build the wing supports and bridge the fuselage into the tail.',
        p('brick-2x4', 'body', 5, 4, 2, 90), p('brick-1x2', 'dark', 1, 4, 2, 90), p('brick-1x2', 'dark', 10, 4, 2, 90),
        p('plate-2x6', 'trim', 3, 8, 2)),
      step('Join the supports with the upper wings. Add the windshield behind them.',
        p('plate-2x6', 'body', 0, 4, 5), p('plate-2x6', 'body', 6, 4, 5), p('brick-1x2', 'glass', 5, 7, 5)),
      step('Raise the tail fin above the horizontal tail.',
        p('brick-1x2', 'body', 5, 8, 3, 90), p('slope-1x2', 'dark', 5, 8, 6, 180)),
    ],
  },
  {
    id: 'robot', family: 'character', name: 'Hello Robot',
    pitch: 'Big eyes, square boots and an antenna with a little flag.',
    features: ['Oversized face with separated eyes', 'Narrow neck and broad hands', 'Boots with a gap between them'],
    palette: { body: 'red', trim: 'light-gray', dark: 'black', light: 'white' }, contrast: [['light', 'dark'], ['body', 'light']],
    steps: [
      step('Set the boots apart and put a short leg on the back of each.',
        p('brick-2x2', 'body', 1, 0, 0), p('brick-2x2', 'body', 5, 0, 0),
        p('brick-1x2', 'body', 1, 1, 3), p('brick-1x2', 'body', 5, 1, 3)),
      step('Join the legs at the hips, then add the narrower body.',
        p('brick-1x6', 'body', 1, 1, 6), p('brick-2x4', 'body', 2, 1, 9)),
      step('Extend both arms. Add the shoulders and central neck.',
        p('plate-1x4', 'trim', 0, 1, 12), p('plate-1x4', 'trim', 4, 1, 12),
        p('brick-1x2', 'body', 0, 1, 13, 90), p('brick-1x2', 'body', 7, 1, 13, 90), p('brick-1x2', 'body', 3, 1, 13)),
      step('Cap the hands and form the wide base of the head on the neck.',
        p('tile-1x2', 'dark', 0, 0, 16, 90), p('tile-1x2', 'dark', 7, 0, 16, 90), p('plate-2x6', 'trim', 1, 1, 16)),
      step('Make the mouth between the cheeks, with a solid row behind it.',
        p('brick-1x2', 'light', 1, 1, 17), p('brick-1x2', 'dark', 3, 1, 17), p('brick-1x2', 'light', 5, 1, 17), p('brick-1x6', 'light', 1, 2, 17)),
      step('Place two dark eyes, separated by a light center. Fill the back of the head.',
        p('brick-1x2', 'dark', 1, 1, 20), p('brick-1x2', 'light', 3, 1, 20), p('brick-1x2', 'dark', 5, 1, 20), p('brick-1x6', 'light', 1, 2, 20)),
      step('Add the cap, antenna and flag.',
        p('plate-2x6', 'body', 1, 1, 23), p('brick-1x1', 'light', 3, 2, 24), p('plate-1x2', 'body', 3, 2, 27)),
    ],
  },
  {
    id: 'lighthouse', family: 'lighthouse', name: 'Harbor Lighthouse',
    pitch: 'A striped tower, glass lantern and broad lookout balcony.',
    features: ['Alternating tower stripes', 'Overhanging balcony', 'Glass lantern below a pitched roof'],
    palette: { body: 'red', light: 'white', trim: 'light-gray', glass: 'trans-clear' }, contrast: [['body', 'light']],
    steps: [
      step('Center the first tower brick on the base plate.',
        p('plate-4x6', 'trim', 0, 0, 0, 90), p('brick-2x2', 'light', 1, 2, 1)),
      step('Stack alternating stripes, keeping the tower centered.',
        p('brick-2x2', 'body', 1, 2, 4), p('brick-2x2', 'light', 1, 2, 7), p('brick-2x2', 'body', 1, 2, 10), p('brick-2x2', 'light', 1, 2, 13)),
      step('Build the overhanging balcony, then add the clear lantern.',
        p('plate-2x4', 'trim', 0, 1, 16), p('plate-2x4', 'trim', 0, 3, 16),
        p('brick-1x2', 'glass', 1, 2, 17), p('brick-1x2', 'glass', 1, 3, 17)),
      step('Cap the lantern with an overhanging roof base.',
        p('plate-2x4', 'trim', 0, 1, 20), p('plate-2x4', 'trim', 0, 3, 20)),
      step('Face the four roof slopes inward to form a ridge.',
        p('slope-2x2', 'body', 0, 1, 21), p('slope-2x2', 'body', 2, 1, 21),
        p('slope-2x2', 'body', 0, 3, 21, 180), p('slope-2x2', 'body', 2, 3, 21, 180)),
    ],
  },
  ...[10, 12].map((length): Recipe => ({
    id: `bench-${length}`, family: 'bench', name: 'Park Bench',
    pitch: 'A long seat, open back and two neat armrests.',
    features: ['Open space below the seat', 'Two back rails', 'Recessed legs and armrests'],
    palette: { body: 'reddish-brown' }, contrast: [],
    steps: [
      step('Stand the two legs apart, leaving room for the seat overhang.',
        p('brick-1x2', 'body', 1, 0, 0, 90), p('brick-1x2', 'body', length - 2, 0, 0, 90)),
      step('Bridge the legs with the seat.', ...(length === 10 ? [
        p('plate-1x10', 'body', 0, 0, 3), p('plate-1x10', 'body', 0, 1, 3),
      ] : [p('plate-2x12', 'body', 0, 0, 3)])),
      step('Add the armrests and reinforce the middle of the seat.',
        p('brick-1x2', 'body', 0, 0, 4, 90), p('brick-1x2', 'body', length - 1, 0, 4, 90),
        p('plate-2x4', 'body', Math.floor(length / 2) - 2, 0, 4)),
      step('Join the armrests with the first back rail.',
        p(`plate-${length === 10 ? 1 : 2}x${length}`, 'body', 0, 1, 7)),
      step('Add the upper posts and the top back rail.',
        p('brick-1x2', 'body', 1, 1, 8), p('brick-1x2', 'body', length - 3, 1, 8),
        p(`plate-${length === 10 ? 1 : 2}x${length}`, 'body', 0, 1, 11)),
    ],
  })),
];

export const RECIPES: Recipe[] = [...ORIGINAL_RECIPES.map(r => ({ ...r, category: (r.family === 'plane' ? 'Vehicles' : r.family === 'lighthouse' ? 'Buildings' : 'Objects') as Recipe['category'], variant: r.id.startsWith('bench-') ? r.id.slice(6) + '-stud seat' : 'Original' })), ...EXPANDED_RECIPES.flatMap((r, i) => {
  const first = EXPANDED_RECIPES.findIndex(v => v.family === r.family) === i;
  return [...(first ? [...FOX_RECIPES, ...ANIMAL_RECIPES].filter(a => a.family === r.family) : []), r];
}), ...[...FOX_RECIPES, ...ANIMAL_RECIPES].filter(a => !EXPANDED_RECIPES.some(r => r.family === a.family)), ...SHOWCASE_RECIPES, ...DEVELOPED_RECIPES, ...FAMILY_RECIPES];
