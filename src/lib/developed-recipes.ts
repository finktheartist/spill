import { layer as s, part as p, recipe } from './recipe-kit';
import type { Recipe, RecipeStep } from './library-recipes';

// Complete upright-stud assemblies. Parameters change proportions or silhouette,
// never inventory counts or scale individual parts. All variants are validated.
function tug(length: 10 | 12): Recipe {
  const stern = length - 2;
  return recipe({ id: `harbor-tug-developed-${length}`, family: 'tugboat', name: 'Harbor Workboat', category: 'Vehicles', strategy: 'watercraft', designLevel: 2,
    variant: length === 10 ? 'Short harbor tug' : 'Long working deck', tags: ['boat', 'tug', 'ship', 'workboat'],
    pitch: 'A stepped bow and stern, raised wheelhouse, open working deck, side rails and a tall exhaust stack.',
    features: ['Layered narrowing hull', 'Raised wheelhouse and overhanging roof', 'Open stern working deck and exhaust'],
    palette: { base: 'reddish-brown', body: 'white', trim: 'red', dark: 'black', light: 'tan', glass: 'trans-clear' },
  }, [
    s('Start with the narrow keel.', p('plate-2x8', 'base', 3, 1, 0, 90), ...(length === 12 ? [p('plate-2x2', 'base', 3, 9, 0)] : [])),
    s('Widen the central hull, leaving the bow and stern narrower.', ...[2, 4].map(x => p(`plate-2x${length - 2}`, 'base', x, 1, 1, 90))),
    s('Bind the hull across its seams and step the bow forward.', ...Array.from({ length: (length - 2) / 2 }, (_, i) => p('plate-2x6', 'trim', 1, 1 + i * 2, 2)), p('plate-2x2', 'trim', 3, 0, 3), p('plate-2x2', 'trim', 3, stern, 3)),
    s('Raise the side rails and the wheelhouse floor.', ...[1, 6].flatMap(x => [3, stern - 2].map(y => p('brick-1x2', 'base', x, y, 3, 90))), p('brick-2x4', 'body', 2, 3, 3)),
    s('Frame an open front window and give the cabin a solid back.', p('brick-1x2', 'body', 2, 3, 6, 90), p('brick-1x2', 'body', 5, 3, 6, 90), p('brick-1x2', 'body', 3, 4, 6)),
    s('Bridge the cabin with an overhanging roof.', p('plate-2x6', 'body', 1, 3, 9)),
    s('Cap the cabin roof and both side rails.', p('tile-2x4', 'light', 2, 3, 10), ...[1, 6].flatMap(x => [3, stern - 2].map(y => p('tile-1x2', 'light', x, y, 6, 90)))),
    s('Build the exhaust behind the wheelhouse.', p('brick-2x2', 'trim', 3, 6, 3), p('brick-1x2', 'trim', 3, 6, 6), p('tile-1x2', 'dark', 3, 6, 9)),
    s('Finish the bow deck and two stern bollards.', p('plate-2x2', 'body', 3, 0, 4), p('tile-1x2', 'light', 3, 0, 5), p('brick-1x1', 'body', 2, stern - 1, 3), p('brick-1x1', 'body', 5, stern - 1, 3), p('plate-1x1', 'dark', 2, stern - 1, 6), p('plate-1x1', 'dark', 5, stern - 1, 6)),
  ]);
}

function crawler(long: boolean): Recipe {
  const length = long ? 10 : 8;
  return recipe({ id: `cargo-crawler-${length}`, family: 'cargo-crawler', name: 'Cargo Crawler', category: 'Machines', strategy: 'machines', designLevel: 2,
    variant: long ? 'Long cargo bed' : 'Short utility carrier', tags: ['crawler', 'machine', 'carrier', 'cargo', 'tracked'],
    pitch: 'A static tracked carrier with exposed track blocks, an inset cab, raised engine cover and an open cargo bed.',
    features: ['Separate brick-built static tracks', 'Inset cabin above a wide chassis', 'Open cargo bed with raised rails'],
    palette: { base: 'light-gray', body: 'reddish-brown', trim: 'yellow', dark: 'black', glass: 'trans-clear' },
  }, [
    s('Lay out the two static track runs; these do not roll.', p(`plate-2x${length}`, 'base', 0, 0, 0, 90), p(`plate-2x${length}`, 'base', 6, 0, 0, 90)),
    s('Build the front and rear track blocks.', ...[0, 6].flatMap(x => [0, length - 2].map(y => p('brick-2x2', 'base', x, y, 1)))),
    s('Bridge the track ends with two rigid crossbars.', p('plate-2x8', 'base', 0, 0, 4), p('plate-2x8', 'base', 0, length - 2, 4)),
    s('Bridge the tracks with a recessed chassis floor.', ...[1, 3, 5].map(x => p(`plate-2x${length}`, 'body', x, 0, 5, 90))),
    s('Cross the chassis seams beneath the cab and cargo bay.', p('plate-2x6', 'body', 1, 1, 6), p('plate-2x6', 'body', 1, length - 3, 6)),
    s('Raise the cab sides and keep a central window opening.', p('brick-1x2', 'trim', 2, 1, 7, 90), p('brick-1x2', 'trim', 5, 1, 7, 90), p('brick-1x2', 'body', 3, 2, 7)),
    s('Bridge the window and set back the cab roof.', p('plate-2x4', 'trim', 2, 1, 10), p('plate-1x4', 'body', 2, 1, 11), p('tile-1x2', 'dark', 3, 2, 11)),
    s('Raise the cargo-bed rails and tailgate.', ...[1, 6].map(x => p(`brick-1x${length - 4}`, 'body', x, 4, 7, 90)), p('brick-1x4', 'body', 2, length - 2, 7)),
    s('Raise and cap the engine cover behind the cab.', p('brick-2x2', 'trim', 3, 3, 6), p('plate-2x4', 'trim', 2, 3, 9), p('tile-1x4', 'base', 2, 3, 10)),
    s('Finish both track runs with repeated tread caps.', ...[0, 7].flatMap(x => [0, length - 2].map(y => p('plate-1x2', 'base', x, y, 5, 90)))),
    s('Cap the bed rails while leaving the load area open.', ...[1, 6].map(x => p(`tile-1x${length - 4}`, 'trim', x, 4, 10, 90)), p('tile-1x4', 'base', 2, length - 2, 10)),
  ]);
}

function robot(tall: boolean): Recipe {
  const leg = tall ? 7 : 4, hip = leg + 3, shoulder = hip + 4, head = shoulder + 4;
  return recipe({ id: `workshop-robot-${tall ? 'tall' : 'compact'}`, family: 'workshop-robot', name: 'Workshop Robot', category: 'Characters', strategy: 'characters', designLevel: 2,
    variant: tall ? 'Long-legged technician' : 'Broad-footed helper', tags: ['robot', 'character', 'mech', 'technician'],
    pitch: 'A framed face above stepped shoulders, separate hands, an inset chest panel, belt and shaped boots.',
    features: ['Framed face and small eyes', 'Stepped shoulders with separate hands', 'Open stance and layered boot toes'],
    palette: { base: 'light-gray', body: 'reddish-brown', trim: 'tan', dark: 'black', light: 'white' }, contrast: [['light', 'dark']],
  }, [
    s('Set the two boots apart and raise the ankles behind the toes.', ...[1, 5].flatMap(x => [p('plate-2x3', 'base', x, 0, 0, 90), p('brick-1x2', 'body', x, 2, 1)])),
    ...(tall ? [s('Extend the two legs without closing the stance.', p('brick-1x2', 'body', 1, 2, 4), p('brick-1x2', 'body', 5, 2, 4))] : []),
    s('Shape the boot toes and cross the hips.', p('slope-2x2', 'base', 1, 0, 1), p('slope-2x2', 'base', 5, 0, 1), p('brick-1x6', 'body', 1, 2, leg)),
    s('Make a belt, then step inward for the torso.', p('plate-2x6', 'trim', 1, 1, hip), p('brick-2x4', 'body', 2, 1, hip + 1)),
    s('Extend the shoulders and set a neck behind the chest panel.', p('plate-2x4', 'body', 0, 1, shoulder), p('plate-2x4', 'body', 4, 1, shoulder), p('brick-1x2', 'trim', 3, 2, shoulder + 1)),
    s('Form separate raised hands and shoulder caps.', p('brick-1x2', 'base', 0, 1, shoulder + 1, 90), p('brick-1x2', 'base', 7, 1, shoulder + 1, 90), p('tile-1x2', 'trim', 0, 1, shoulder + 4, 90), p('tile-1x2', 'trim', 7, 1, shoulder + 4, 90)),
    s('Lay a broad jaw plate on the narrower neck.', p('plate-2x4', 'trim', 2, 1, head)),
    s('Build the cheeks and keep the front eye layer thin.', p('plate-1x4', 'light', 2, 1, head + 1), p('brick-1x4', 'body', 2, 2, head + 1)),
    s('Separate the eyes with a pale nose bridge.', p('plate-1x1', 'dark', 2, 1, head + 2), p('plate-1x2', 'light', 3, 1, head + 2), p('plate-1x1', 'dark', 5, 1, head + 2)),
    s('Add the brow and a projecting helmet rim.', p('plate-1x4', 'light', 2, 1, head + 3), p('plate-2x6', 'body', 1, 1, head + 4), p('tile-2x4', 'trim', 2, 1, head + 5)),
    s('Finish the inset chest controls and paired belt clasps.', p('tile-1x2', 'dark', 3, 1, shoulder + 1), p('plate-1x1', 'trim', 2, 1, shoulder + 1), p('plate-1x1', 'trim', 5, 1, shoulder + 1), p('tile-1x1', 'light', 1, 1, hip + 1), p('tile-1x1', 'light', 6, 1, hip + 1)),
  ]);
}

function beacon(levels: 2 | 3): Recipe {
  const top = 1 + levels * 7;
  const walls: RecipeStep[] = Array.from({ length: levels }, (_, i) => {
    const z = 1 + i * 7;
    return [s('Raise the four corner piers, preserving the hollow center.', ...[1, 4].flatMap(x => [1, 3].map(y => p('brick-1x2', i % 2 ? 'trim' : 'body', x, y, z, 90)))),
      s('Raise the next wall course and keep the observation slots open.', ...[1, 4].flatMap(x => [1, 3].map(y => p('brick-1x2', i % 2 ? 'trim' : 'body', x, y, z + 3, 90)))),
      s('Tie the four piers with a crossing balcony layer.', p('plate-2x6', 'base', 0, 1, z + 6), p('plate-2x6', 'base', 0, 3, z + 6))];
  }).flat();
  return recipe({ id: `harbor-beacon-${levels}`, family: 'lighthouse', name: 'Harbor Beacon', category: 'Buildings', strategy: 'buildings', designLevel: 2,
    variant: levels === 2 ? 'Low observation tower' : 'Tall observation tower', tags: ['lighthouse', 'beacon', 'tower'],
    pitch: 'A hollow tower with deep observation slots, projecting balcony bands, a glass lantern and a stepped crown.',
    features: ['Hollow piers and recessed observation slots', 'Projecting balcony bands', 'Glass lantern and stepped roof'],
    palette: { base: 'light-gray', body: 'reddish-brown', trim: 'white', glass: 'trans-clear', dark: 'black' },
  }, [s('Start with a broad foundation.', p('plate-6x6', 'base', 0, 0, 0)), ...walls,
    s('Set the central glass lantern and corner railing posts.', p('brick-2x2', 'glass', 2, 2, top), ...[0, 5].flatMap(x => [1, 4].map(y => p('brick-1x1', 'body', x, y, top)))),
    s('Bridge the lantern with a roof wider than the glass.', p('plate-2x4', 'trim', 1, 1, top + 3), p('plate-2x4', 'trim', 1, 3, top + 3)),
    s('Step the roof inward and cap the beacon.', p('plate-2x4', 'body', 1, 2, top + 4), p('plate-2x2', 'body', 2, 2, top + 5), p('tile-1x2', 'dark', 2, 2, top + 6)),
    s('Cap the four corner railing posts.', ...[0, 5].flatMap(x => [1, 4].map(y => p('tile-1x1', 'trim', x, y, top + 3)))),
  ]);
}

function pavilion(roof: 'terrace' | 'lantern'): Recipe {
  return recipe({ id: `atrium-pavilion-${roof}`, family: 'atrium-pavilion', name: 'Atrium Pavilion', category: 'Buildings', strategy: 'buildings', designLevel: 2,
    variant: roof === 'terrace' ? 'Open roof terrace' : 'Raised roof lantern', tags: ['pavilion', 'building', 'garden', 'atrium'],
    pitch: 'Four open bays surround a recessed floor beneath a layered roof and projecting entrance canopy.',
    features: ['Open bays on all sides', 'Layered roof and offset entry canopy', roof === 'terrace' ? 'Open roof terrace' : 'Raised roof lantern'],
    palette: { base: 'tan', body: 'reddish-brown', trim: 'light-gray', accent: 'green', light: 'white' },
  }, [
    s('Lay the floor with a one-stud border.', p('plate-6x8', 'base', 0, 0, 0)),
    ...[1, 4].map(z => s('Raise four deep corner piers around the open room.', ...[1, 6].flatMap(x => [1, 3].map(y => p('brick-1x2', 'body', x, y, z, 90))))),
    s('Bridge the front and back openings with projecting lintels.', p('plate-2x8', 'trim', 0, 0, 7), p('plate-2x8', 'trim', 0, 4, 7)),
    s('Interlock the roof across the lintels.', ...[0, 2, 4, 6].map(x => p('plate-2x6', 'body', x, 0, 8, 90))),
    s('Give the upper roof an inset border and leave its center open.', p('brick-1x6', 'body', 1, 1, 9), p('brick-1x6', 'body', 1, 4, 9), p('brick-1x2', 'body', 1, 2, 9, 90), p('brick-1x2', 'body', 6, 2, 9, 90)),
    ...(roof === 'lantern' ? [s('Bridge the upper lantern and step its crown inward.', p('plate-2x6', 'trim', 1, 1, 12), p('plate-2x6', 'trim', 1, 3, 12), p('plate-2x4', 'body', 2, 2, 13), p('tile-1x4', 'trim', 2, 2, 14))] : [s('Cap the terrace parapets.', p('tile-1x6', 'trim', 1, 1, 12), p('tile-1x6', 'trim', 1, 4, 12), p('tile-1x2', 'trim', 1, 2, 12, 90), p('tile-1x2', 'trim', 6, 2, 12, 90))]),
    s('Build a shallow entry bench and two planters.', p('brick-1x2', 'body', 2, 4, 1), p('tile-1x2', 'light', 2, 4, 4), p('plate-1x2', 'accent', 1, 0, 1), p('plate-1x2', 'accent', 5, 0, 1)),
    s('Finish the projecting entrance canopy and threshold.', p('plate-1x4', 'accent', 2, 0, 9), p('tile-1x2', 'light', 3, 0, 1)),
  ]);
}

function lander(pods: 'short' | 'wide'): Recipe {
  const left = pods === 'short' ? 1 : 0, right = pods === 'short' ? 7 : 8;
  return recipe({ id: `survey-lander-${pods}`, family: 'survey-lander', name: 'Survey Lander', category: 'Vehicles', strategy: 'aircraft', designLevel: 2,
    variant: pods === 'short' ? 'Compact landing frame' : 'Wide instrument pods', tags: ['lander', 'spacecraft', 'spaceship', 'shuttle', 'survey'],
    pitch: 'A raised central capsule between paired instrument pods, with a glazed cockpit and four separate landing pads.',
    features: ['Four separate landing pads', 'Central capsule with glazed cockpit', 'Paired side pods and stepped rear equipment'],
    palette: { base: 'light-gray', body: 'white', trim: 'red', dark: 'black', glass: 'trans-clear' },
  }, [
    s('Set four landing pads around a clear central gap.', ...[left, right].flatMap(x => [0, 6].map(y => p('plate-2x3', 'base', x, y, 0, 90)))),
    s('Raise four landing struts.', ...[left, right].flatMap(x => [1, 6].map(y => p('brick-1x2', 'base', x, y, 1)))),
    s('Bridge the landing pads with two long equipment pods.', ...[left, right].map(x => p('plate-2x8', 'body', x, 0, 4, 90))),
    s('Join both pods beneath the central capsule.', p(`plate-2x${right - left + 2}`, 'base', left, 2, 5), p(`plate-2x${right - left + 2}`, 'base', left, 5, 5)),
    s('Lay the central capsule floor across both crossbars.', p('plate-4x6', 'body', 3, 1, 6, 90)),
    s('Raise the capsule rear and two cockpit sidewalls.', p('brick-2x4', 'body', 3, 4, 7), p('brick-1x2', 'body', 3, 2, 7, 90), p('brick-1x2', 'body', 6, 2, 7, 90)),
    s('Set a transparent cabin above a raised front sill.', p('plate-2x2', 'trim', 4, 2, 7), p('brick-2x2', 'glass', 4, 2, 8)),
    s('Form a stepped nose and a narrow rear equipment ridge.', p('plate-1x4', 'trim', 3, 1, 7), p('tile-1x2', 'dark', 4, 1, 8), p('plate-2x4', 'body', 3, 4, 10), p('brick-1x2', 'trim', 4, 5, 11), p('tile-1x2', 'dark', 4, 5, 14)),
    s('Build matching equipment heads on both side pods.', ...[left, right].flatMap(x => [p('brick-2x2', 'trim', x, 0, 5), p('slope-2x2', 'body', x, 0, 8), p('brick-2x2', 'body', x, 6, 6), p('tile-2x2', 'base', x, 6, 9)])),
    s('Cap the cockpit sides and finish the rear deck.', p('tile-1x2', 'body', 3, 2, 10, 90), p('tile-1x2', 'body', 6, 2, 10, 90), p('tile-1x4', 'trim', 3, 6, 7)),
  ]);
}

function bonsai(tall: boolean): Recipe {
  const crown = tall ? 22 : 19;
  const foliage = (x: number, y: number, z: number, wide = false): RecipeStep[] => [
    s('Spread a foliage pad across its branch, leaving gaps between the canopies.', p(wide ? 'plate-4x6' : 'plate-4x4', 'foliage', x, y, z)),
    s('Step the foliage inward so the branch stays visible beneath it.', p(wide ? 'plate-2x6' : 'plate-2x4', 'foliage', x, y + 1, z + 1), p('plate-2x2', 'foliage', x + (wide ? 2 : 1), y + 1, z + 2), p('tile-1x2', 'foliage', x + (wide ? 2 : 1), y + 1, z + 3)),
  ];
  return recipe({ id: `terraced-bonsai-${tall ? 'tall' : 'low'}`, family: 'terraced-bonsai', name: 'Terraced Bonsai', category: 'Nature', strategy: 'nature', designLevel: 2,
    variant: tall ? 'Raised crown and three canopies' : 'Low spreading crown', tags: ['bonsai', 'tree', 'plant', 'foliage'],
    pitch: 'Three staggered foliage pads on exposed offset branches, rising from a framed planter.',
    features: ['Three separated canopy levels', 'Exposed offset branches', 'Framed planter and tapering foliage'],
    palette: { base: 'tan', foliage: 'green', trim: 'reddish-brown' },
  }, [
    s('Lay the planter floor and build its low border.', p('plate-6x6', 'base', 0, 0, 0), p('brick-1x6', 'base', 0, 0, 1), p('brick-1x6', 'base', 0, 5, 1), p('brick-1x4', 'base', 0, 1, 1, 90), p('brick-1x4', 'base', 5, 1, 1, 90)),
    s('Cap the planter rim and raise the trunk inside it.', p('tile-1x6', 'base', 0, 0, 4), p('tile-1x6', 'base', 0, 5, 4), p('tile-1x4', 'base', 0, 1, 4, 90), p('tile-1x4', 'base', 5, 1, 4, 90), ...[1, 4, 7].map(z => p('brick-2x2', 'trim', 2, 2, z))),
    s('Reach left with the first branch and offset the continuing trunk.', p('plate-1x6', 'trim', 0, 2, 10), p('brick-1x2', 'trim', 4, 2, 11)),
    ...foliage(0, 0, 11),
    s('Reach right with the next branch and raise the crown stem behind it.', p('plate-2x4', 'trim', 3, 2, 14), p('brick-1x2', 'trim', 4, 2, 15, 90), ...(tall ? [p('brick-1x2', 'trim', 4, 2, 18, 90)] : [])),
    ...foliage(5, 1, 15),
    s('Turn the crown back toward the center.', p('plate-2x4', 'trim', 2, 3, crown - 1)),
    ...foliage(1, 2, crown, true),
  ]);
}

export const DEVELOPED_RECIPES: Recipe[] = [tug(10), tug(12), crawler(false), crawler(true), robot(false), robot(true), beacon(2), beacon(3), pavilion('terrace'), pavilion('lantern'), lander('short'), lander('wide'), bonsai(false), bonsai(true)];
