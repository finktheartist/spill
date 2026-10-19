import type { Recipe } from './library-recipes';
import { part as p, layer as s, recipe, assemble, studs, platform, pitchedRoof, tableLegs, animalBody, vehicleChassis, type Module } from './recipe-kit';

const out: Recipe[] = [];
const add = (r: Recipe) => out.push(r);

// Architecture: roofs and tower tops fit explicit sockets on several wall/base sizes.
for (const w of [4, 6] as const) for (const roof of ['slopes', 'steps'] as const) {
  const walls: Module = { id: `cottage-walls-${w}`, label: 'Walls with recessed doorway', inlet: studs(0, 0, 0, w, 4), ports: { roof: studs(0, 0, 6, w, 4) }, steps: [
    s('Build the walls around an open front doorway.', p('brick-1x3', 'body', 0, 0, 0, 90), p('brick-1x3', 'body', w - 1, 0, 0, 90), p(`brick-1x${w}`, 'body', 0, 3, 0)),
    s('Raise the doorway and rear wall.', p('brick-1x3', 'body', 0, 0, 3, 90), p('brick-1x3', 'body', w - 1, 0, 3, 90), p(`brick-1x${w}`, 'body', 0, 3, 3)),
  ] };
  add(recipe({ id: `cottage-${w}-${roof}`, family: 'cottage', name: 'Tiny Cottage', pitch: 'A deep doorway under a broad pitched roof.', category: 'Buildings', tags: ['house', 'cabin'], variant: `${w}-stud cottage · ${roof === 'slopes' ? 'sloping' : 'stepped'} roof`, features: ['Open doorway', 'Pitched roof', 'Deep eaves'] }, assemble([
    { key: 'base', module: platform(w === 4 ? 6 : 8, 6, w, 4) }, { key: 'walls', module: walls, parent: 'base', socket: 'top' }, { key: 'roof', module: pitchedRoof(w, roof), parent: 'walls', socket: 'roof' },
  ])));
}
for (const h of [2, 3]) for (const w of [4, 6] as const) {
  const tower: Module = { id: `tower-${w}-${h}`, label: `${h}-storey tower`, inlet: studs(0, 0, 0, w, 4), ports: { roof: studs(0, 0, h * 3, w, 4) }, steps: Array.from({ length: h }, (_, i) => s(i ? 'Raise the walls, leaving the window recess clear.' : 'Leave a tall entrance between the walls.', p('brick-1x2', 'body', 0, 0, i * 3, 90), p('brick-1x2', 'body', w - 1, 0, i * 3, 90), p(`brick-1x${w}`, 'body', 0, 3, i * 3))) };
  const crown: Module = { id: `battlements-${w}`, label: 'Castle battlements', inlet: studs(0, 0, 0, w, 4), steps: [s('Bridge the tower with the battlement floor.', p(`plate-2x${w}`, 'base', 0, 0, 0), p(`plate-2x${w}`, 'base', 0, 2, 0)), s('Add four corner battlements.', ...[0, w - 1].flatMap(x => [p('brick-1x1', 'body', x, 0, 1), p('brick-1x1', 'body', x, 3, 1)]))] };
  add(recipe({ id: `castle-${w}-${h}`, family: 'castle', name: 'Castle Keep', pitch: 'An open gate beneath four stout battlements.', category: 'Buildings', tags: ['fort', 'tower'], variant: `${w} studs · ${h} wall layers`, features: ['Open gate', 'Corner battlements', 'Overhanging crown'], palette: { body: 'light-gray', base: 'dark-gray' } }, assemble([{ key: 'base', module: platform(w === 4 ? 6 : 8, 6, w, 4) }, { key: 'tower', module: tower, parent: 'base', socket: 'top' }, { key: 'crown', module: crown, parent: 'tower', socket: 'roof' }])));
}
for (const span of [4, 6] as const) for (const h of [1, 2]) {
  const pier: Module = { id: `gate-piers-${span}-${h}`, label: 'Twin gate piers', inlet: studs(0, 0, 0, span, 2), ports: { lintel: studs(0, 0, h * 3, span, 1) }, steps: Array.from({ length: h }, (_, i) => s('Raise the two gate posts.', p('brick-1x2', 'body', 0, 0, i * 3, 90), p('brick-1x2', 'body', span - 1, 0, i * 3, 90))) };
  const arch: Module = { id: `arch-${span}`, label: 'Arched lintel', inlet: studs(0, 0, 0, span, 1), steps: [s('Connect the posts with the arch.', p(`arch-1x${span}`, 'body', 0, 0, 0)), s('Finish the lintel with a narrow cap.', p(`plate-1x${span}`, 'trim', 0, 0, 3))] };
  add(recipe({ id: `gate-${span}-${h}`, family: 'gate', name: 'Garden Arch', pitch: 'Two pillars frame a clear, curved passage.', category: 'Buildings', variant: `${span}-stud arch · ${h === 1 ? 'low' : 'tall'} posts`, features: ['Curved arch', 'Open passage', 'Capped lintel'] }, assemble([{ key: 'base', module: platform(span, 4, span, 2) }, { key: 'piers', module: pier, parent: 'base', socket: 'top' }, { key: 'arch', module: arch, parent: 'piers', socket: 'lintel' }])));
}
for (const length of [6, 8, 10] as const) {
  add(recipe({ id: `bridge-${length}`, family: 'bridge', name: 'Footbridge', pitch: 'A raised walkway with open space and twin rails.', category: 'Buildings', variant: `${length}-stud span`, features: ['Raised walkway', 'Two handrails', 'Open underside'] }, [
    s('Set the abutments apart.', p('brick-2x4', 'body', 0, 0, 0), p('brick-2x4', 'body', 0, length - 2, 0)),
    s('Bridge the supports with the walkway.', p(`plate-2x${length}`, 'base', 0, 0, 3, 90), p(`plate-2x${length}`, 'base', 2, 0, 3, 90)),
    s('Place four handrail posts.', ...[0, 3].flatMap(x => [p('brick-1x2', 'body', x, 0, 4, 90), p('brick-1x2', 'body', x, length - 2, 4, 90)])),
    s('Join each pair of posts with a long rail.', p(`plate-1x${length}`, 'body', 0, 0, 7, 90), p(`plate-1x${length}`, 'body', 3, 0, 7, 90)),
  ]));
}
for (const roof of ['slopes', 'steps'] as const) {
  const well: Module = { id: 'well-ring', label: 'Hollow well and roof supports', inlet: studs(0, 0, 0, 4, 4), ports: { roof: studs(0, 0, 9, 4, 4) }, steps: [
    s('Surround the open center of the well.', p('brick-1x4', 'body', 0, 0, 0), p('brick-1x4', 'body', 0, 3, 0), p('brick-1x2', 'body', 0, 1, 0, 90), p('brick-1x2', 'body', 3, 1, 0, 90)),
    ...[3, 6].map(z => s('Raise the two roof supports.', p('brick-1x2', 'body', 0, 1, z, 90), p('brick-1x2', 'body', 3, 1, z, 90))),
  ] };
  add(recipe({ id: `well-${roof}`, family: 'well', name: 'Wishing Well', pitch: 'An open stone ring sheltered by a little roof.', category: 'Buildings', variant: `${roof === 'slopes' ? 'Sloping' : 'Stepped'} canopy`, features: ['Hollow well', 'Twin uprights', 'Canopy'] }, assemble([{ key: 'base', module: platform(6, 6, 4, 4) }, { key: 'well', module: well, parent: 'base', socket: 'top' }, { key: 'roof', module: pitchedRoof(4, roof), parent: 'well', socket: 'roof' }])));
}
for (const levels of [2, 3]) {
  add(recipe({ id: `pagoda-${levels}`, family: 'pagoda', name: 'Garden Pagoda', pitch: 'Tiered eaves around a slender central tower.', category: 'Buildings', variant: `${levels} roof tiers`, features: ['Separated roof tiers', 'Narrow central tower', 'Stepped roof caps'], palette: { base: 'light-gray', body: 'white', trim: 'red' } }, [
    s('Lay the square foundation.', p('plate-4x4', 'base', 0, 0, 0)),
    ...Array.from({ length: levels }, (_, i) => [s('Raise the next narrow storey.', p('brick-2x2', 'body', 1, 1, 1 + i * 5)), s('Add a broad eave and a smaller upper roof.', p('plate-4x4', 'trim', 0, 0, 4 + i * 5), p('plate-2x2', 'trim', 1, 1, 5 + i * 5))]).flat(),
  ]));
}
for (const h of [2, 3]) {
  add(recipe({ id: `townhouse-${h}`, family: 'townhouse', name: 'Narrow Townhouse', pitch: 'Stacked recessed windows beneath a roof terrace.', category: 'Buildings', variant: `${h} floors`, features: ['Stacked windows', 'Tall narrow silhouette', 'Roof terrace'], palette: { base: 'light-gray', body: 'white', trim: 'red', dark: 'black' } }, [
    s('Set out the doorstep.', p('plate-4x6', 'base', 0, 0, 0, 90)),
    ...Array.from({ length: h }, (_, i) => [s('Frame a recessed window.', p('brick-1x2', 'body', 0, 1, 1 + i * 4, 90), p('brick-1x2', 'body', 3, 1, 1 + i * 4, 90), p('brick-1x4', 'body', 0, 4, 1 + i * 4), p('brick-1x2', 'dark', 1, 2, 1 + i * 4)), s('Add the projecting floor ledge.', p('plate-2x4', 'trim', 0, 1, 4 + i * 4), p('plate-2x4', 'trim', 0, 3, 4 + i * 4))]).flat(),
    s('Finish with two terrace walls.', p('brick-1x4', 'body', 0, 1, 1 + h * 4), p('brick-1x4', 'body', 0, 4, 1 + h * 4)),
  ]));
}

// Furniture and objects share supporting leg modules; tops connect through the same sized interface.
for (const length of [4, 6, 8] as const) for (const tall of [false, true]) {
  const top: Module = { id: `desktop-${length}`, label: 'Overhanging desktop', inlet: studs(0, 0, 0, length, 2), ports: { surface: studs(0, 0, 1, length, 2) }, steps: [s('Join the legs with the tabletop.', p(`plate-2x${length}`, 'trim', 0, 0, 0))] };
  add(recipe({ id: `table-${length}-${tall}`, family: 'table', name: 'Little Table', pitch: 'A slim tabletop held above two recessed trestles.', category: 'Objects', variant: `${length}-stud ${tall ? 'dining' : 'coffee'} table`, features: ['Open underside', 'Thin tabletop', 'Two trestles'] }, assemble([{ key: 'legs', module: tableLegs(length, tall) }, { key: 'top', module: top, parent: 'legs', socket: 'top' }])));
  if (length >= 6 && tall) {
    const monitor: Module = { id: 'desktop-monitor', label: 'Monitor with a narrow stand', inlet: studs(0, 0, 0, 2, 2), steps: [s('Add a keyboard and the monitor stand.', p('tile-1x2', 'dark', 0, 0, 0), p('brick-1x2', 'body', 0, 1, 0)), s('Widen the monitor above its stand.', p('brick-1x4', 'dark', -1, 1, 3)), s('Cap the display.', p('plate-1x4', 'light', -1, 1, 6))] };
    top.ports = { surface: studs(2, 0, 1, 2, 2) };
    add(recipe({ id: `desk-${length}`, family: 'desk', name: 'Computer Desk', pitch: 'A tiny screen and keyboard above an airy desk.', category: 'Objects', variant: `${length}-stud desk`, features: ['Separate monitor and stand', 'Keyboard', 'Open leg space'] }, assemble([{ key: 'legs', module: tableLegs(length, true) }, { key: 'top', module: top, parent: 'legs', socket: 'top' }, { key: 'monitor', module: monitor, parent: 'top', socket: 'surface' }])));
  }
}
for (const w of [4, 6] as const) for (const h of [1, 2]) {
  add(recipe({ id: `chair-${w}-${h}`, family: 'chair', name: 'Armchair', pitch: 'A recessed seat between armrests and a high back.', category: 'Objects', variant: `${w}-stud seat · ${h === 1 ? 'low' : 'high'} back`, features: ['Recessed seat', 'Armrests', 'High back'] }, [
    s('Set out the two feet.', p('brick-1x2', 'base', 0, 1, 0, 90), p('brick-1x2', 'base', w - 1, 1, 0, 90)),
    s('Connect the feet with the seat.', p(`plate-2x${w}`, 'body', 0, 0, 3), p(`plate-2x${w}`, 'body', 0, 2, 3)),
    s('Frame the seat with armrests and the lower back.', p('brick-1x2', 'body', 0, 0, 4, 90), p('brick-1x2', 'body', w - 1, 0, 4, 90), p(`brick-1x${w}`, 'body', 0, 3, 4)),
    ...Array.from({ length: h }, (_, i) => s('Raise the back above the arms.', p(`brick-1x${w}`, 'body', 0, 3, 7 + i * 3))),
    s('Finish the back with a narrow cap.', p(`tile-1x${w}`, 'body', 0, 3, 7 + h * 3)),
  ]));
}
for (const w of [4, 6] as const) {
  add(recipe({ id: `piano-${w}`, family: 'piano', name: 'Upright Piano', pitch: 'Black and white keys beneath a tall cabinet.', category: 'Objects', variant: `${w}-stud keyboard`, features: ['Stepped keyboard', 'Contrasting keys', 'Tall upright cabinet'], palette: { body: 'reddish-brown', light: 'white', dark: 'black' }, contrast: [['light', 'dark']] }, [
    s('Stand the cabinet on its two feet.', p('brick-1x2', 'body', 0, 0, 0, 90), p('brick-1x2', 'body', w - 1, 0, 0, 90)),
    s('Join the feet and form the cabinet.', p(`plate-2x${w}`, 'body', 0, 0, 3), p(`brick-1x${w}`, 'body', 0, 1, 4)),
    s('Lay the light keyboard across the front.', p(`plate-1x${w}`, 'light', 0, 0, 4)),
    s('Add the raised dark keys and upper cabinet.', ...Array.from({ length: w / 2 }, (_, i) => p('tile-1x1', 'dark', i * 2, 0, 5)), p(`brick-1x${w}`, 'body', 0, 1, 7)),
    s('Cap the cabinet.', p(`tile-1x${w}`, 'body', 0, 1, 10)),
  ]));
  add(recipe({ id: `camera-${w}`, family: 'camera', name: 'Pocket Camera', pitch: 'A projecting lens, raised viewfinder and shutter button.', category: 'Objects', variant: `${w}-stud body`, features: ['Projecting lens', 'Viewfinder', 'Shutter button'], palette: { base: 'light-gray', body: 'black', trim: 'light-gray', light: 'white' } }, [
    s('Make a deep base for the lens and body.', p(`plate-4x${w}`, 'base', 0, 0, 0)),
    s('Build the camera body behind the lens.', p(`brick-2x${w}`, 'body', 0, 2, 1), p('brick-1x2', 'trim', Math.floor((w - 2) / 2), 1, 1), p('brick-1x2', 'body', Math.floor((w - 2) / 2), 0, 1)),
    s('Finish the body and raise the viewfinder.', p(`plate-2x${w}`, 'trim', 0, 2, 4), p('brick-1x2', 'body', Math.floor((w - 2) / 2), 3, 5), p('plate-1x2', 'light', w - 2, 2, 5)),
  ]));
}
for (const h of [2, 3]) {
  add(recipe({ id: `mug-${h}`, family: 'mug', name: 'Coffee Mug', pitch: 'A hollow cup with an open, squared handle.', category: 'Objects', variant: `${h} layers tall`, features: ['Hollow cup', 'Open handle', 'Raised rim'], palette: { body: 'white', base: 'white' } }, [
    s('Lay out the cup and the bottom of the handle.', p('plate-4x6', 'base', 0, 0, 0)),
    ...Array.from({ length: h }, (_, i) => s('Build the cup walls and outer handle post.', p('brick-1x4', 'body', 0, 0, 1 + i * 3), p('brick-1x4', 'body', 0, 3, 1 + i * 3), p('brick-1x2', 'body', 0, 1, 1 + i * 3, 90), p('brick-1x2', 'body', 3, 1, 1 + i * 3, 90), p('brick-1x2', 'body', 5, 1, 1 + i * 3, 90))),
    s('Close the top of the handle.', p('plate-2x3', 'body', 3, 1, 1 + h * 3)),
  ]));
}

// Vehicles: body modules sit on checked complete wheel assemblies, never loose wheels.
for (const length of [6, 8] as const) for (const bodyStyle of ['roadster', 'pickup', 'bus'] as const) {
  const cab: Module = { id: `${bodyStyle}-body-${length}`, label: bodyStyle === 'roadster' ? 'Low open cockpit' : bodyStyle === 'pickup' ? 'Cab and open cargo bed' : 'Long passenger cabin', inlet: studs(0, 0, 0, 4, length), steps: [
    s('Build the nose and rear body.', p('brick-2x4', 'body', 0, 0, 0), bodyStyle === 'pickup' ? p('brick-1x4', 'body', 0, length - 1, 0) : p('brick-2x4', 'body', 0, length - 2, 0)),
    s('Add the front bumper and windshield.', ...(bodyStyle === 'roadster' ? [] : [p('plate-1x4', 'base', 0, 0, 3)]), p('brick-1x4', 'glass', 0, 2, 0)),
    ...(bodyStyle === 'roadster' ? [s('Add side rails around the open cockpit.', p(`plate-1x${length}`, 'body', 0, 0, 3, 90), p(`plate-1x${length}`, 'body', 3, 0, 3, 90))] : [
      s('Raise the cabin above the windshield.', p('brick-1x4', 'glass', 0, bodyStyle === 'bus' ? length - 3 : 3, 0), p('plate-2x4', 'trim', 0, 2, 3), ...(bodyStyle === 'bus' && length === 8 ? [p('plate-2x4', 'trim', 0, 4, 3)] : [])),
      ...(bodyStyle === 'pickup' ? [s('Outline the cargo bed with two low rails.', p('plate-1x2', 'body', 0, length - 2, 3, 90), p('plate-1x2', 'body', 3, length - 2, 3, 90))] : []),
    ]),
  ] };
  if (bodyStyle === 'bus') cab.steps = [
    s('Run the passenger cabin along both sides of the chassis.', p(`brick-1x${length}`, 'body', 0, 0, 0, 90), p(`brick-1x${length}`, 'body', 3, 0, 0, 90)),
    s('Add front and rear windows above the lower body.', p('brick-1x4', 'glass', 0, 1, 3), p('brick-1x4', 'glass', 0, length - 2, 3)),
    s('Separate the side windows with two pillars.', p('brick-1x2', 'body', 0, 2, 3, 90), p('brick-1x2', 'body', 3, 2, 3, 90)),
    s('Cover the full passenger cabin with a long roof.', p(`plate-4x${length}`, 'trim', 0, 0, 6, 90)),
  ];
  const name = bodyStyle === 'roadster' ? 'Open Roadster' : bodyStyle === 'pickup' ? 'Pickup Truck' : 'Mini Bus';
  add(recipe({ id: `${bodyStyle}-${length}`, family: bodyStyle, name, pitch: bodyStyle === 'roadster' ? 'A low bonnet and open cockpit between four wheels.' : bodyStyle === 'pickup' ? 'A compact cab ahead of an open cargo bed.' : 'A long bright cabin above a sturdy wheelbase.', category: 'Vehicles', variant: `${length}-stud wheelbase`, tags: ['car', 'vehicle', bodyStyle], features: ['Four working wheels', bodyStyle === 'pickup' ? 'Cargo bed' : 'Cabin', 'Front bumper'], palette: { base: 'light-gray', body: 'red', trim: 'white', glass: 'trans-clear', dark: 'black' } }, assemble([{ key: 'chassis', module: vehicleChassis(length) }, { key: 'body', module: cab, parent: 'chassis', socket: 'body' }])));
}
for (const length of [6, 8] as const) {
  add(recipe({ id: `tug-${length}`, family: 'tugboat', name: 'Harbor Tug', pitch: 'A broad hull, raised wheelhouse and little smokestack.', category: 'Vehicles', variant: `${length}-stud hull`, tags: ['boat', 'ship'], features: ['Stepped hull', 'Wheelhouse', 'Smokestack'], palette: { base: 'black', body: 'red', trim: 'white', dark: 'black' } }, [
    s('Lay out the hull keel.', p(`plate-2x${length}`, 'base', 1, 0, 0, 90)),
    s('Widen the deck above the keel.', p(`plate-4x${length}`, 'body', 0, 0, 1, 90)),
    s('Build the wheelhouse and stern.', p('brick-2x2', 'trim', 1, 2, 2), p('brick-1x4', 'body', 0, length - 1, 2)),
    s('Overhang the wheelhouse roof and add the funnel.', p('plate-2x4', 'trim', 0, 2, 5), p('brick-1x2', 'dark', 1, 3, 6)),
  ]));
  add(recipe({ id: `sailboat-${length}`, family: 'sailboat', name: 'Little Sailboat', pitch: 'A stepped triangular sail rises from a slim hull.', category: 'Vehicles', variant: `${length}-stud hull`, tags: ['boat', 'yacht'], features: ['Triangular sail', 'Narrow hull', 'Tall mast'], palette: { body: 'reddish-brown', light: 'white', trim: 'red' } }, [
    s('Lay the narrow hull.', p(`plate-2x${length}`, 'body', 0, 0, 0)),
    s('Add the gunwales around a shallow deck.', p(`plate-1x${length}`, 'body', 0, 0, 1), p(`plate-1x${length}`, 'body', 0, 1, 1)),
    s('Build the broad foot of the sail.', p('brick-1x4', 'light', 1, 1, 2)),
    s('Step the sail inward toward the mast.', p('brick-1x3', 'light', 1, 1, 5), p('brick-1x2', 'light', 1, 1, 8)),
    s('Cap the mast with a small pennant.', p('plate-1x2', 'trim', 1, 1, 11)),
  ]));
  add(recipe({ id: `spaceship-${length}`, family: 'spaceship', name: 'Star Skimmer', pitch: 'Swept wings flank a long fuselage and raised cockpit.', category: 'Vehicles', variant: `${length}-stud fuselage`, tags: ['spacecraft', 'jet'], features: ['Wing silhouette', 'Raised cockpit', 'Twin rear fins'], palette: { body: 'light-gray', trim: 'red', dark: 'black' } }, [
    s('Start the narrow fuselage.', p(`plate-2x${length}`, 'body', 3, 0, 0, 90)),
    s('Spread the wings across the fuselage.', p('plate-2x4', 'body', 0, 3, 1), p('plate-2x4', 'body', 4, 3, 1), p('plate-2x2', 'body', 3, 0, 1)),
    s('Bridge the wings and raise the cockpit.', p('plate-2x4', 'trim', 2, 3, 2), p('slope-2x2', 'dark', 3, 1, 2)),
    s('Add two upright tail fins.', p('brick-1x2', 'trim', 0, 3, 2, 90), p('brick-1x2', 'trim', 7, 3, 2, 90)),
  ]));
}

// Animals: the same body supports different heads and tails through explicit stud sockets.
for (const length of [4, 6] as const) for (const animal of ['dog', 'cat', 'rabbit', 'giraffe'] as const) {
  const neck = animal === 'giraffe' ? 9 : 0;
  const head: Module = { id: `${animal}-head`, label: animal === 'giraffe' ? 'Tall neck and muzzle' : animal === 'rabbit' ? 'Head with tall ears' : animal === 'cat' ? 'Pointed ears and face' : 'Muzzle and floppy ears', inlet: studs(1, 0, 0, 2, 2), steps: [
    ...(neck ? [s('Raise the long neck.', ...[0, 3, 6].map(z => p('brick-1x2', 'body', 1, 1, z)))] : []),
    s('Widen the head above the neck.', p('brick-2x4', 'body', 0, 0, neck)),
    s('Set two dark eyes beside the projecting muzzle.', p('brick-1x2', 'dark', 0, 0, neck + 3, 90), p('brick-1x2', 'dark', 3, 0, neck + 3, 90), p('brick-1x2', 'body', 1, 1, neck + 3), p('plate-2x2', 'body', 1, -1, neck + 3)),
    s('Add the little nose and cap the head.', p('tile-1x2', 'dark', 1, -1, neck + 4), p('plate-2x4', 'body', 0, 0, neck + 6)),
    s(animal === 'rabbit' ? 'Raise two long ears with a clear gap between them.' : 'Add the two ears behind the face.', ...(animal === 'rabbit' ? [p('brick-1x1', 'body', 0, 1, neck + 7), p('brick-1x1', 'body', 3, 1, neck + 7), p('brick-1x1', 'body', 0, 1, neck + 10), p('brick-1x1', 'body', 3, 1, neck + 10)] : animal === 'cat' ? [p('cheese-1x1', 'body', 0, 1, neck + 7), p('cheese-1x1', 'body', 3, 1, neck + 7)] : [p('plate-1x2', 'body', -1, 1, neck + 7), p('plate-1x2', 'body', 3, 1, neck + 7)])),
  ] };
  const tail: Module = { id: `${animal}-tail`, label: animal === 'rabbit' ? 'Short tail' : 'Raised tail', inlet: studs(0, 0, 0, 2, 1), steps: [s('Finish with the tail.', p('plate-1x2', 'body', 0, 0, 0), ...(animal === 'rabbit' ? [] : [p('brick-1x2', 'body', 0, 0, 1)]))] };
  add(recipe({ id: `${animal}-${length}`, family: animal, name: { dog: 'Little Dog', cat: 'Garden Cat', rabbit: 'Long-Eared Rabbit', giraffe: 'Tall Giraffe' }[animal], pitch: { dog: 'Four paws, a projecting muzzle and a perky tail.', cat: 'Pointed ears and a raised tail over four paws.', rabbit: 'Long upright ears above a small dark nose.', giraffe: 'A long neck lifts the muzzle far above the body.' }[animal], category: 'Animals', variant: `${length === 4 ? 'Compact' : 'Long'} body`, features: ['Four separated feet', head.label, tail.label], palette: { body: animal === 'giraffe' ? 'yellow' : animal === 'rabbit' ? 'white' : animal === 'cat' ? 'light-gray' : 'tan', dark: 'black', base: 'light-gray', trim: animal === 'giraffe' ? 'yellow' : animal === 'rabbit' ? 'white' : animal === 'cat' ? 'light-gray' : 'tan' }, contrast: [['body', 'dark']] }, assemble([{ key: 'body', module: animalBody(length) }, { key: 'head', module: head, parent: 'body', socket: 'head' }, { key: 'tail', module: tail, parent: 'body', socket: 'tail' }])));
}
for (const length of [4, 6] as const) {
  add(recipe({ id: `duck-${length}`, family: 'duck', name: 'Pond Duck', pitch: 'A broad bill and raised head above a low body.', category: 'Animals', variant: `${length}-stud body`, features: ['Broad bill', 'Raised neck', 'Rear tail'], palette: { body: 'white', trim: 'yellow', dark: 'black' }, contrast: [['body', 'dark']] }, [
    s('Lay the low body.', p(`plate-2x${length}`, 'body', 0, 0, 0, 90)),
    s('Raise the neck at the front and body behind.', p('brick-2x2', 'body', 0, 0, 1), p('brick-2x2', 'body', 0, length - 2, 1)),
    s('Build the head and extend a broad bill.', p('plate-2x3', 'trim', 0, 0, 4, 90), p('brick-1x2', 'body', 0, 1, 5)),
    s('Add a dark eye stripe and a little tail.', p('plate-1x2', 'dark', 0, 1, 8), p('plate-1x2', 'body', 0, length - 1, 4)),
  ]));
  add(recipe({ id: `turtle-${length}`, family: 'turtle', name: 'Pocket Turtle', pitch: 'A stepped shell between four flippers and a small head.', category: 'Animals', variant: `${length}-stud shell`, features: ['Domed shell', 'Four flippers', 'Projecting head'], palette: { body: 'green', trim: 'reddish-brown', dark: 'black' } }, [
    s('Set out the four flippers.', p('plate-1x4', 'body', 0, 1, 0), p('plate-1x4', 'body', 0, length - 1, 0)),
    s('Join the flippers with the underside of the shell.', p(`plate-2x${length}`, 'body', 1, 1, 1, 90)),
    s('Add the head and shell.', p('plate-2x2', 'body', 1, 0, 2), p(`brick-2x${length}`, 'trim', 1, 2, 2, 90)),
    s('Step the shell inward and mark the head.', p('plate-2x2', 'trim', 1, 3, 5), p('tile-1x2', 'dark', 1, 0, 3)),
  ]));
}
for (const h of [2, 3]) {
  add(recipe({ id: `penguin-${h}`, family: 'penguin', name: 'Little Penguin', pitch: 'A white belly, dark flippers and a bright beak.', category: 'Animals', variant: `${h === 2 ? 'Short' : 'Tall'} body`, features: ['Contrasting belly', 'Two flippers', 'Projecting beak'], palette: { body: 'black', light: 'white', trim: 'yellow' }, contrast: [['body', 'light']] }, [
    s('Spread the two feet.', p('plate-1x2', 'trim', 1, 0, 0, 90), p('plate-1x2', 'trim', 3, 0, 0, 90)),
    s('Join the feet beneath the body.', p('plate-2x4', 'body', 1, 0, 1)),
    ...Array.from({ length: h }, (_, i) => s('Build the light belly with a dark back.', p('brick-1x2', 'light', 2, 0, 2 + i * 3), p('brick-1x4', 'body', 1, 1, 2 + i * 3))),
    s('Spread the flippers and close the shoulders.', p('plate-1x6', 'body', 0, 1, 2 + h * 3)),
    s('Place the beak and head above the belly.', p('plate-2x2', 'trim', 2, 0, 3 + h * 3), p('brick-1x2', 'body', 2, 1, 4 + h * 3)),
  ]));
  add(recipe({ id: `pine-${h}`, family: 'pine', name: 'Pine Tree', pitch: 'Layered branches taper around a slim trunk.', category: 'Nature', variant: `${h} branch tiers`, features: ['Tapering foliage', 'Visible trunk', 'Layered branches'], palette: { base: 'light-gray', body: 'reddish-brown', trim: 'green' } }, [
    s('Plant the trunk on the base.', p('plate-4x4', 'base', 0, 0, 0), p('brick-2x2', 'body', 1, 1, 1)),
    s('Spread the first tier of branches.', p('plate-4x4', 'trim', 0, 0, 4), p('brick-2x2', 'trim', 1, 1, 5)),
    ...(h === 3 ? [s('Add a second wide branch tier.', p('plate-4x4', 'trim', 0, 0, 8), p('brick-2x2', 'trim', 1, 1, 9))] : []),
    s('Taper the crown to a narrow tip.', p('plate-2x2', 'trim', 1, 1, h === 3 ? 12 : 8), p('brick-1x2', 'trim', 1, 1, h === 3 ? 13 : 9)),
  ]));
}
for (const shell of [2, 3]) {
  add(recipe({ id: `snail-${shell}`, family: 'snail', name: 'Garden Snail', pitch: 'A tall stepped shell behind two little feelers.', category: 'Animals', variant: `${shell}-layer shell`, features: ['Low crawling foot', 'Tall shell', 'Two feelers'], palette: { body: 'tan', trim: 'reddish-brown', dark: 'black' } }, [
    s('Lay the long foot.', p('plate-2x6', 'body', 0, 0, 0, 90)),
    s('Raise the head and broad shell base.', p('brick-2x2', 'body', 0, 0, 1), p('brick-2x4', 'trim', 0, 2, 1, 90)),
    ...Array.from({ length: shell - 1 }, (_, i) => s('Step the shell upward.', p('brick-2x2', 'trim', 0, 3, 4 + i * 3))),
    s('Add two upright feelers.', p('brick-1x1', 'body', 0, 0, 4), p('brick-1x1', 'body', 1, 0, 4), p('roundtile-1x1', 'dark', 0, 0, 7), p('roundtile-1x1', 'dark', 1, 0, 7)),
  ]));
}


// Long-board structures make useful designs from sparse mixed collections as well as basic buckets.
for (const length of [6, 8, 10, 12] as const) for (const tall of [false, true]) {
  const height = tall ? 6 : 3;
  const shelf: Module = { id: `shelf-${length}`, label: 'Open shelf bay', inlet: studs(0, 0, 0, length, 2), ports: { top: studs(0, 0, height + 1, length, 2) }, steps: [
    s('Lay the lower shelf.', p(`plate-2x${length}`, 'body', 0, 0, 0)),
    ...Array.from({ length: tall ? 2 : 1 }, (_, i) => s('Raise the side panels, leaving the center open.', p('brick-1x2', 'body', 0, 0, 1 + i * 3, 90), p('brick-1x2', 'body', length - 1, 0, 1 + i * 3, 90))),
  ] };
  const upper: Module = { ...shelf, id: `upper-shelf-${length}`, label: 'Upper shelf bay' };
  const cap: Module = { id: `shelf-cap-${length}`, label: 'Shelf top', inlet: studs(0, 0, 0, length, 2), steps: [s('Cap the bookcase.', p(`plate-2x${length}`, 'body', 0, 0, 0))] };
  add(recipe({ id: `bookcase-${length}-${tall}`, family: 'bookcase', name: 'Open Bookcase', pitch: 'Two long shelves with open bays and slim side panels.', category: 'Objects', variant: `${length}-stud shelves · ${tall ? 'tall' : 'low'} bays`, features: ['Two open shelf bays', 'Thin shelves', 'Slender sides'] }, assemble([{ key: 'lower', module: shelf }, { key: 'upper', module: upper, parent: 'lower', socket: 'top' }, { key: 'cap', module: cap, parent: 'upper', socket: 'top' }])));
  add(recipe({ id: `pergola-${length}-${tall}`, family: 'pergola', name: 'Garden Pergola', pitch: 'Four posts support long beams around an open skylight.', category: 'Buildings', variant: `${length}-stud canopy · ${tall ? 'tall' : 'low'} posts`, features: ['Four posts', 'Open skylight', 'Projecting roof beams'] }, [
    s('Lay two long foundation strips.', p(`plate-2x${length}`, 'base', 0, 0, 0), p(`plate-2x${length}`, 'base', 0, 4, 0)),
    ...Array.from({ length: tall ? 2 : 1 }, (_, i) => s('Raise the four corner posts.', ...[1, length - 3].flatMap(x => [p('brick-1x2', 'body', x, 1, 1 + i * 3), p('brick-1x2', 'body', x, 4, 1 + i * 3)]))),
    s('Connect each pair of posts across the canopy.', p('plate-1x6', 'body', 1, 0, 1 + height, 90), p('plate-1x6', 'body', length - 2, 0, 1 + height, 90)),
    s('Run the long roof beams along each edge.', p(`plate-2x${length}`, 'body', 0, 0, 2 + height), p(`plate-2x${length}`, 'body', 0, 4, 2 + height)),
  ]));
}
for (const length of [6, 8, 10, 12] as const) {
  add(recipe({ id: `picnic-${length}`, family: 'picnic', name: 'Picnic Table', pitch: 'Two attached benches flank a raised central tabletop.', category: 'Objects', variant: `${length}-stud table`, features: ['Two benches', 'Raised tabletop', 'Connected trestles'] }, [
    s('Set out the crosswise trestle feet.', p('brick-1x6', 'base', 0, 1, 0), p('brick-1x6', 'base', 0, length - 2, 0)),
    s('Add the two benches and central supports.', p(`plate-2x${length}`, 'body', 0, 0, 3, 90), p(`plate-2x${length}`, 'body', 4, 0, 3, 90), p('brick-1x2', 'base', 2, 1, 3), p('brick-1x2', 'base', 2, length - 2, 3)),
    s('Bridge the supports with the tabletop.', p(`plate-2x${length}`, 'body', 2, 0, 6, 90)),
  ]));
  add(recipe({ id: `dock-${length}`, family: 'dock', name: 'Fishing Pier', pitch: 'A narrow deck with upright mooring posts at its ends.', category: 'Buildings', variant: `${length}-stud deck`, features: ['Raised deck', 'Open space underneath', 'Mooring posts'] }, [
    s('Set out the two supports.', p('brick-1x2', 'body', 0, 1, 0), p('brick-1x2', 'body', 0, length - 2, 0)),
    s('Connect the supports with the long deck.', p(`plate-2x${length}`, 'base', 0, 0, 3, 90)),
    s('Add two upright mooring posts.', p('brick-1x2', 'body', 0, 1, 4), p('brick-1x2', 'body', 0, length - 2, 4)),
    s('Cap the mooring posts.', p('plate-1x2', 'trim', 0, 1, 7), p('plate-1x2', 'trim', 0, length - 2, 7)),
  ]));
}
export const EXPANDED_RECIPES = out;
