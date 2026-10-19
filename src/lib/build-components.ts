import { subjectWords } from './construction-families';
import { layer as s, part as p, studs } from './recipe-kit';
import type { Component, ComponentPlan, ComponentPort } from './component-kit';
import type { RecipeStep } from './library-recipes';

// Newly authored upright-stud adaptations of studied construction principles, NOT
// copies of the source modules. Their side studs, clips, hinges and printed eyes
// are not supported by this app and are never silently replaced with fake parts.
const animalEvidence = ['study/round-02/cards/puppy-core.md', 'study/round-02/cards/kitten-core.md', 'study/round-02/knowledge/core-comparison.json'];
const roofEvidence = ['study/round-02/cards/tea-house-roof.md'];
const carEvidence = ['study/round-02/cards/vehicle-door.md', 'study/round-02/cards/vehicle-headlight.md'];
const port = (contract: string, x: number, y: number, z: number, w: number, d: number, pads?: [number, number][]): ComponentPort => ({ ...studs(x, y, z, w, d), contract, pads });

export function quadrupedCore(length: 6 | 8): Component {
  return { id: `waisted-body-${length}`, label: 'Four separated legs and a narrower waist', evidence: animalEvidence,
    preserves: ['Open belly and four feet', 'Head and tail interfaces survive length changes', 'Narrow waist between broad shoulders and hips'],
    ports: { head: port('neck-2x2', 3, 3, 8, 2, 2), tail: port('tail-2x1', 3, length + 2, 8, 2, 1) },
    steps: [
      s('Set four forward-facing paws apart.', ...[1, 5].flatMap(x => [2, length].map(y => p('plate-2x3', 'light', x, y, 0, 90)))),
      s('Raise four legs behind the toes.', ...[2, 5].flatMap(x => [3, length + 1].map(y => p('brick-1x2', 'body', x, y, 1, 90)))),
      s('Bridge front and rear legs above the open belly.', ...[2, 4].map(x => p(`plate-2x${length}`, 'base', x, 3, 4, 90))),
      s('Cross the belly seams at the shoulders and hips; narrow the waist.', p('brick-2x4', 'body', 2, 3, 5), p('brick-2x4', 'body', 2, length + 1, 5), ...Array.from({ length: (length - 4) / 2 }, (_, i) => p('brick-2x2', 'body', 3, 5 + 2 * i, 5))),
      s('Cap the narrower back, leaving the neck and tail connections open.', ...Array.from({ length: (length - 4) / 2 }, (_, i) => p('tile-2x2', 'body', 3, 5 + 2 * i, 8))),
    ],
  };
}

export function petHead(muzzle: 'long' | 'short', ears: 'folded' | 'pointed'): Component {
  return { id: `pet-head-${muzzle}-${ears}`, label: `${muzzle === 'long' ? 'Projecting' : 'Short'} muzzle, paired eyes and ${ears} ears`, evidence: animalEvidence,
    preserves: ['Two separated dark eyes', 'Nose projects ahead of the eyes', 'Same neck grip for alternative heads'],
    inlet: port('neck-2x2', 1, 2, 0, 2, 2), steps: [
      s('Mount the broad head behind its projecting muzzle.', p('plate-4x4', 'body', 0, 0, 0)),
      s('Build the cheeks and skull around the muzzle.', p('brick-1x2', 'body', 0, 1, 1, 90), p('brick-1x2', 'body', 3, 1, 1, 90), p('brick-1x2', 'body', 1, 2, 1), p('brick-1x4', 'body', 0, 3, 1), p(muzzle === 'long' ? 'plate-2x2' : 'plate-1x2', 'light', 1, muzzle === 'long' ? 0 : 1, 1)),
      s('Project the dark nose and layer the pale muzzle.', p('tile-1x2', 'dark', 1, muzzle === 'long' ? 0 : 1, 2), ...(muzzle === 'long' ? [p('tile-1x2', 'light', 1, 1, 2)] : [])),
      s('Place the two small eyes and bridge the crown behind them.', p('tile-1x1', 'dark', 0, 1, 4), p('tile-1x1', 'dark', 3, 1, 4), p('plate-2x4', 'body', 0, 2, 4)),
      s('Give the head its own ear silhouette.', ...[0, 3].map(x => p(ears === 'folded' ? 'tile-1x2' : 'cheese-1x1', 'trim', x, 2, 5, ears === 'folded' ? 90 : 0))),
    ] };
}
export function petTail(style: 'long' | 'raised' | 'tipped'): Component {
  return { id: `pet-tail-${style}`, label: `${style} tail`, evidence: animalEvidence, preserves: ['Tail attaches to rump, not head', 'Distinct silhouette behind the body'],
    inlet: port('tail-2x1', 0, 0, 0, 2, 1), steps: style === 'raised' ? [
      s('Raise a narrow tail from the rump.', p('brick-1x2', 'body', 0, 0, 0), p('brick-1x2', 'body', 0, 0, 3), p('plate-1x2', 'body', 0, 0, 6), p('tile-1x2', 'trim', 0, 0, 7)),
    ] : [
      s('Extend the tail behind the rump.', p('plate-1x4', 'body', 0, 0, 0, 90), p('plate-1x4', 'body', 1, 0, 0, 90)),
      s('Cross the tail seam and taper the tip.', p('plate-1x2', 'body', 0, 1, 1), p('plate-1x2', style === 'tipped' ? 'light' : 'body', 0, 2, 1), p('tile-1x2', style === 'tipped' ? 'light' : 'body', 0, 3, 1)),
    ] };
}

export function cottageWalls(width: 6 | 8): Component {
  const ring: [number, number][] = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < width; x++) if (x === 0 || x === width - 1 || y === 0 || y === 3) ring.push([x, y]);
  return { id: `cottage-walls-${width}`, label: 'Recessed doorway, window openings and continuous wall ring', evidence: roofEvidence,
    preserves: ['Open doorway beneath a lintel', 'Side window openings', 'A level ring supports all roof alternatives'],
    ports: { roof: port(`wall-ring-${width}x4`, 1, 1, 9, width, 4, ring) }, steps: [
      s('Lay a floor with a one-stud border.', p(`plate-6x${width + 2}`, 'base', 0, 0, 0)),
      s('Raise door jambs and a back wall; leave the entrance open.', p('brick-1x2', 'body', 1, 1, 1), p(`brick-1x${width - 4}`, 'body', 5, 1, 1), p(`brick-1x${width}`, 'body', 1, 4, 1), p('brick-1x2', 'body', 1, 2, 1, 90), p('brick-1x2', 'body', width, 2, 1, 90)),
      s('Continue the front jambs and rear wall, leaving both side windows open.', p('brick-1x2', 'body', 1, 1, 4), p(`brick-1x${width - 4}`, 'body', 5, 1, 4), p(`brick-1x${width}`, 'body', 1, 4, 4)),
      s('Bridge the doorway and side windows at the same height.', p(`plate-1x${width}`, 'light', 1, 1, 7), p(`plate-1x${width}`, 'light', 1, 4, 7), p('plate-1x4', 'light', 1, 1, 8, 90), p('plate-1x4', 'light', width, 1, 8, 90), p(`plate-1x${width - 2}`, 'light', 2, 1, 8), p(`plate-1x${width - 2}`, 'light', 2, 4, 8)),
    ] };
}
export function cottageRoof(width: 6 | 8, style: 'layered' | 'pitched'): Component {
  const len = width + 2;
  const steps: RecipeStep[] = [s('Bridge the wall ring with a continuous overhanging roof backing.', p(`plate-6x${len}`, 'trim', 0, 0, 0))];
  if (style === 'layered') steps.push(
    s('Step both eaves inward symmetrically.', p(`plate-4x${len}`, 'trim', 0, 1, 1)),
    s('Thicken the paired roof courses before stepping inward.', p(`plate-4x${len}`, 'trim', 0, 1, 2)),
    s('Step the upper roof inward and build up its ridge.', p(`plate-2x${len}`, 'trim', 0, 2, 3), p(`plate-2x${len}`, 'trim', 0, 2, 4)),
    s('Finish the ridge with narrow caps.', p('tile-1x4', 'trim', 0, 2, 5), p(`tile-1x${len - 4}`, 'trim', 4, 2, 5)),
  );
  else steps.push(
    s('Build symmetrical roof slopes rising toward the ridge.', ...Array.from({ length: len / 2 }, (_, i) => [p('slope-2x2', 'trim', 2 * i, 0, 1), p('slope-2x2', 'trim', 2 * i, 4, 1, 180)]).flat(), p(`brick-2x${len}`, 'trim', 0, 2, 1)),
    s('Cap the central ridge, keeping the roof symmetrical.', ...Array.from({ length: len / 2 }, (_, i) => p('tile-2x2', 'trim', i * 2, 2, 4))),
  );
  return { id: `cottage-roof-${width}-${style}`, label: `${style} roof with overhanging eaves and a raised ridge`, evidence: roofEvidence,
    preserves: ['Continuous backing', 'Symmetric eaves', 'Roof rises above the walls', 'Common wall-ring interface'],
    inlet: port(`wall-ring-${width}x4`, 1, 1, 0, width, 4), steps };
}

export function rollingChassis(length: 10 | 12): Component {
  return { id: `rolling-chassis-${length}`, label: 'Low deck on two complete wheel assemblies', evidence: carEvidence,
    preserves: ['Actual complete wheel holders', 'Low floor and long wheelbase', 'Cab and cargo stock reserved together'],
    ports: { cab: port('cab-4x6', 0, 0, 4, 4, 6), load: port(`load-4x${length - 6}`, 0, 6, 4, 4, length - 6) }, steps: [
      s('Place complete wheel-and-holder pairs at the axles.', p('wheels-4x2', 'dark', 0, 1, 0), p('wheels-4x2', 'dark', 0, length - 3, 0)),
      s('Span both axles with staggered deck seams.', p(`plate-2x${length - 4}`, 'base', 0, 0, 3, 90), p('plate-2x4', 'base', 0, length - 4, 3, 90), p('plate-2x4', 'base', 2, 0, 3, 90), p(`plate-2x${length - 4}`, 'base', 2, 4, 3, 90)),
    ] };
}
export function truckCab(glazing: 'clear' | 'open', bonnet: 'sloped' | 'layered'): Component {
  return { id: `truck-cab-${glazing}-${bonnet}`, label: `${glazing} windows, ${bonnet} hood and a thin roof`, evidence: carEvidence,
    preserves: ['Hood below the windshield', 'Roof only one plate thick', 'Paired headlamps and a separate grille', 'Same chassis interface'],
    inlet: port('cab-4x6', 0, 0, 0, 4, 6), steps: [
      s('Frame the grille with two lights and build the hood behind it.', p('brick-1x1', 'light', 0, 0, 0), p('brick-1x2', 'dark', 1, 0, 0), p('brick-1x1', 'light', 3, 0, 0),
        ...(bonnet === 'sloped' ? [p('slope-2x2', 'body', 0, 1, 0), p('slope-2x2', 'body', 2, 1, 0)] : [p('plate-2x4', 'body', 0, 1, 0), p('plate-2x4', 'body', 0, 1, 1), p('plate-1x4', 'body', 0, 2, 2)])),
      s('Build the cab sill and back, keeping the floor low.', p('brick-2x4', 'body', 0, 3, 0), p('brick-1x4', 'body', 0, 5, 0)),
      s('Raise the windshield and leave side windows open.', ...(glazing === 'clear' ? [p('brick-1x2', 'glass', 0, 3, 3), p('brick-1x2', 'glass', 2, 3, 3)] : [p('brick-1x1', 'body', 0, 3, 3), p('brick-1x1', 'body', 3, 3, 3)]), p('brick-1x4', 'body', 0, 5, 3)),
      s('Bridge the cab with a thin contrasting roof.', p('plate-2x4', 'light', 0, 3, 6), p('plate-1x4', 'light', 0, 5, 6)),
    ] };
}
export function cargoBed(length: 4 | 6, style: 'pickup' | 'flatbed'): Component {
  return { id: `cargo-${length}-${style}`, label: style === 'pickup' ? 'Recessed open cargo bed with side rails and tailgate' : 'Low open flatbed with rear stops', evidence: carEvidence,
    preserves: ['Cargo space remains open', 'Bed shares the chassis floor', 'All body sections use one stock ledger'],
    inlet: port(`load-4x${length}`, 0, 0, 0, 4, length), steps: style === 'pickup' ? [
      s('Raise two rails around an empty cargo bed.', p(`brick-1x${length}`, 'body', 0, 0, 0, 90), p(`brick-1x${length}`, 'body', 3, 0, 0, 90), p('brick-1x2', 'body', 1, length - 1, 0)),
      s('Finish the rails and tailgate without filling the load area.', p(`tile-1x${length}`, 'body', 0, 0, 3, 90), p(`tile-1x${length}`, 'body', 3, 0, 3, 90), p('tile-1x2', 'body', 1, length - 1, 3)),
    ] : [s('Lay low deck strips and two rear load stops.', p(`tile-1x${length}`, 'body', 0, 0, 0, 90), p(`tile-1x${length}`, 'body', 3, 0, 0, 90), p('brick-1x2', 'body', 1, length - 1, 0), p('tile-1x2', 'body', 1, length - 1, 3))] };
}

export function componentPlans(subject: string): ComponentPlan[] {
  const terms = subjectWords(subject);
  const has = (...words: string[]) => words.some(w => terms.includes(w));
  const plans: ComponentPlan[] = [];
  // Deliberately exact subject families; no fox silently renamed as a horse or a roof offered for an airplane.
  if (has('dog', 'puppy', 'hound', 'cat', 'kitten', 'fox', 'wolf')) {
    const species = has('cat', 'kitten') ? 'cat' : has('fox') ? 'fox' : has('wolf') ? 'wolf' : 'dog';
    for (const length of [6, 8] as const) for (const tail of (species === 'cat' ? ['raised'] : species === 'fox' ? ['tipped'] : ['long', 'raised']) as ('long' | 'raised' | 'tipped')[]) {
      const head = petHead(species === 'cat' ? 'short' : 'long', species === 'dog' ? 'folded' : 'pointed');
      plans.push({ id: `${species}-${length}-${tail}`, name: `${species} with a shaped waist`, family: species, category: 'Animals',
        palette: { body: 'reddish-brown', base: 'reddish-brown', light: 'tan', dark: 'black', trim: 'reddish-brown' },
        features: ['Four separate paws and an open belly', 'Narrow waist between shoulders and hips', head.label, `${tail} tail`],
        mounts: [{ key: 'body', component: quadrupedCore(length) }, { key: 'head', component: head, parent: 'body', socket: 'head' }, { key: 'tail', component: petTail(tail), parent: 'body', socket: 'tail' }] });
    }
  }
  if (has('cottage', 'cabin', 'house', 'building')) for (const width of [6, 8] as const) for (const style of ['pitched', 'layered'] as const) {
    plans.push({ id: `cottage-${width}-${style}`, name: 'Cottage with deep window openings', family: 'cottage', category: 'Buildings',
      palette: { body: 'white', base: 'tan', light: 'reddish-brown', trim: 'reddish-brown' }, features: ['Recessed open doorway', 'Deep side windows', 'Overhanging eaves and a raised roof ridge'],
      mounts: [{ key: 'walls', component: cottageWalls(width) }, { key: 'roof', component: cottageRoof(width, style), parent: 'walls', socket: 'roof' }] });
  }
  if (has('pickup', 'truck', 'flatbed')) for (const length of [10, 12] as const) for (const glazing of ['clear', 'open'] as const) for (const bonnet of ['sloped', 'layered'] as const) {
    const bed = has('flatbed') ? 'flatbed' : 'pickup';
    plans.push({ id: `${bed}-${length}-${glazing}-${bonnet}`, name: `${glazing === 'clear' ? 'Glazed' : 'Open-window'} ${bed}`, family: 'truck', category: 'Vehicles',
      palette: { body: 'red', base: 'light-gray', light: 'white', dark: 'black', glass: 'trans-clear' }, allowedColors: { base: ['light-gray', 'dark-gray', 'black'] }, features: ['Long wheelbase on complete wheel holders', 'Low hood, defined windshield and thin roof', bed === 'pickup' ? 'Deep open cargo bed' : 'Low flat load deck'],
      mounts: [{ key: 'chassis', component: rollingChassis(length) }, { key: 'cab', component: truckCab(glazing, bonnet), parent: 'chassis', socket: 'cab' }, { key: 'cargo', component: cargoBed((length - 6) as 4 | 6, bed), parent: 'chassis', socket: 'load' }] });
  }
  return plans;
}
