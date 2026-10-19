import { layer as s, part as p, recipe } from './recipe-kit';
import type { Recipe } from './library-recipes';

// Larger silhouettes use real openings, overlapping structure and subject-specific
// details. These are complete designs, never enlarged by decorative filler.
const townhouse = recipe({
  id: 'townhouse-corner-studio', family: 'townhouse', name: 'Corner Studio', category: 'Buildings', strategy: 'buildings', designLevel: 2,
  pitch: 'A two-storey corner studio with deep window bays, a recessed entry, projecting canopy, roof terrace and chimney.',
  variant: 'Two-storey studio · open window bays', tags: ['townhouse', 'house', 'building', 'architecture', 'shop'],
  features: ['Recessed entry and open window bays', 'Projecting floor ledges and canopy', 'Roof terrace and chimney'],
  palette: { body: 'tan', base: 'light-gray', trim: 'reddish-brown', accent: 'dark-green', dark: 'black', light: 'white' }, contrast: [],
}, [
  s('Lay the foundation with a clear doorstep in front.', p('plate-6x8', 'base', 0, 0, 0)),
  ...[0, 1].flatMap(level => {
    const z = 1 + level * 7;
    const posts = [0, 3, 7].map(x => p('brick-1x2', 'body', x, 1, z, 90));
    return [
      s('Set the window jambs back from the front ledge.', ...posts, p('brick-1x6', 'body', 1, 5, z), p('brick-1x2', 'body', 0, 3, z, 90), p('brick-1x2', 'body', 7, 3, z, 90)),
      s('Raise the jambs, keeping the openings clear.', ...[0, 3, 7].map(x => p('brick-1x2', 'body', x, 1, z + 3, 90)), p('brick-1x6', 'body', 1, 5, z + 3), p('brick-1x2', 'body', 0, 3, z + 3, 90), p('brick-1x2', 'body', 7, 3, z + 3, 90)),
      s('Bridge the openings with a projecting floor cornice.', p('plate-2x8', 'trim', 0, 0, z + 6), p('plate-2x8', 'base', 0, 2, z + 6), p('plate-2x8', 'trim', 0, 4, z + 6)),
    ];
  }),
  s('Build low terrace walls above the roof, leaving its center open.', p('brick-1x6', 'body', 1, 5, 15), p('brick-1x4', 'body', 0, 1, 15, 90), p('brick-1x4', 'body', 7, 1, 15, 90)),
  s('Cap the terrace walls.', p('tile-1x6', 'trim', 1, 5, 18), p('tile-1x4', 'trim', 0, 1, 18, 90), p('tile-1x4', 'trim', 7, 1, 18, 90)),
  s('Raise a stepped chimney inside the terrace.', p('brick-2x2', 'body', 5, 3, 15), p('brick-1x2', 'body', 5, 4, 18), p('tile-1x2', 'dark', 5, 4, 21)),
  s('Add a projecting canopy and contrasting entry threshold.', p('plate-1x4', 'accent', 0, 0, 8), p('tile-1x2', 'trim', 1, 0, 1)),
  s('Finish the upper window sills and terrace planters.', p('tile-1x2', 'light', 1, 1, 8), p('tile-1x3', 'light', 4, 1, 8), p('plate-1x2', 'accent', 2, 3, 15), p('plate-1x2', 'accent', 2, 3, 16)),
]);

const airplane = recipe({
  id: 'survey-plane-expedition', family: 'survey-plane', name: 'Expedition Plane', category: 'Vehicles', strategy: 'aircraft', designLevel: 2,
  pitch: 'A long fuselage above twin landing skids, layered wings, a glazed cockpit, tapered nose and separate tail surfaces.',
  variant: 'Expedition airframe · layered wings and skids', tags: ['plane', 'airplane', 'aircraft', 'survey', 'machine'],
  features: ['Stepped wings and long tapered fuselage', 'Glazed cockpit with raised coaming', 'Twin landing skids and upright tail fin'],
  palette: { body: 'white', base: 'light-gray', trim: 'red', dark: 'black', accent: 'yellow', light: 'tan', glass: 'trans-clear' }, contrast: [],
}, [
  s('Lay two long landing skids and raise four supports.', p('plate-1x10', 'base', 5, 2, 0, 90), p('plate-1x10', 'base', 8, 2, 0, 90), ...[5, 8].flatMap(x => [4, 8].map(y => p('brick-1x2', 'base', x, y, 1, 90)))),
  s('Tie the landing gear across the airframe.', p('plate-2x4', 'base', 5, 4, 4), p('plate-2x4', 'base', 5, 8, 4)),
  s('Join the floor of the long narrow fuselage.', p('plate-2x8', 'base', 6, 1, 5, 90), p('plate-2x6', 'base', 6, 9, 5, 90)),
  s('Interlock the fuselage seam and leave the cockpit open.', p('brick-2x4', 'body', 6, 7, 6, 90), p('brick-1x2', 'body', 6, 5, 6, 90), p('brick-1x2', 'body', 7, 5, 6, 90), p('brick-2x3', 'body', 6, 2, 6, 90), p('plate-2x4', 'body', 6, 11, 6, 90)),
  s('Build the broad main wing across the fuselage.', p('plate-1x6', 'trim', 1, 7, 9), p('plate-1x6', 'trim', 7, 7, 9), p('plate-1x6', 'light', 1, 8, 9), p('plate-1x6', 'light', 7, 8, 9)),
  s('Bridge the wing seam and step both wings toward their tips.', p('plate-2x4', 'trim', 5, 7, 10), p('tile-1x4', 'body', 1, 8, 10), p('tile-1x4', 'body', 9, 8, 10), p('tile-1x2', 'body', 3, 7, 10), p('tile-1x2', 'body', 9, 7, 10)),
  s('Raise the fuselage spine behind the wing and taper the rear deck.', p('slope-2x2', 'body', 6, 9, 9, 180), p('plate-2x3', 'body', 6, 11, 7, 90), p('plate-1x3', 'body', 6, 11, 8, 90), p('tile-1x3', 'body', 7, 11, 8, 90)),
  s('Shape the nose and its top ridge.', p('plate-2x2', 'body', 6, 0, 6), p('slope-2x2', 'body', 6, 0, 7), p('plate-2x2', 'body', 6, 2, 9), p('tile-1x2', 'body', 6, 3, 10)),
  s('Frame the cockpit with an instrument panel and a transparent canopy.', p('tile-1x2', 'dark', 6, 4, 9), p('plate-1x2', 'trim', 6, 5, 9, 90), p('plate-1x2', 'trim', 7, 5, 9, 90), p('brick-2x2', 'glass', 6, 5, 10)),
  s('Add a separate horizontal tailplane and narrow upright fin.', p('plate-2x6', 'body', 4, 14, 7), p('brick-2x2', 'body', 6, 14, 8), p('slope-2x2', 'dark', 6, 14, 11, 180)),
  s('Finish the paired wingtip markers and curved skid noses.', p('plate-1x2', 'accent', 1, 7, 10), p('plate-1x2', 'accent', 11, 7, 10), p('curve-1x2', 'dark', 5, 2, 1), p('curve-1x2', 'dark', 8, 2, 1)),
]);

export const SHOWCASE_RECIPES: Recipe[] = [townhouse, airplane];
