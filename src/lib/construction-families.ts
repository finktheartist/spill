import type { Recipe } from './library-recipes';
import { ANIMAL_BASES } from './animal-recipes';

export type ConstructionFamily = 'animals' | 'buildings' | 'road-vehicles' | 'aircraft' | 'watercraft' | 'characters' | 'machines' | 'objects' | 'nature';
export interface FamilyStrategy {
  id: ConstructionFamily; name: string; terms: string[]; structure: string; features: string[]; quality: string[];
}

/** The same contract drives discovery, related alternatives, planning and the named craft review. */
export const FAMILY_STRATEGIES: FamilyStrategy[] = [
  { id: 'animals', name: 'Animals', terms: ['animal', 'quadruped', 'snail', ...ANIMAL_BASES.flatMap(b => b.relatives)], structure: 'A compatible body plan, stance and head attachment', features: ['Species-specific head and ears or beak', 'Tail, shell or other defining silhouette'], quality: ['Distinct head, chest and hips with deliberate proportions', 'Separated limbs and a recognizable species silhouette', 'Eyes, muzzle and signature features stay distinct; color alone cannot identify the species'] },
  { id: 'buildings', name: 'Buildings', terms: ['building', 'house', 'cottage', 'cabin', 'castle', 'gate', 'arch', 'bridge', 'tower', 'lighthouse', 'well', 'pagoda', 'townhouse', 'pergola', 'dock', 'pier', 'gatehouse', 'barn', 'beacon', 'pavilion', 'atrium', 'studio'], structure: 'A foundation and walls or piers that support every roof or span', features: ['Doorways and window openings', 'Roofline, crown or spanning structure'], quality: ['Entrances and windows are actual recesses or openings', 'Roof and wall proportions form a coherent building', 'Use eaves, ledges and depth; avoid a solid box with decoration'] },
  { id: 'road-vehicles', name: 'Cars & trucks', terms: ['car', 'truck', 'vehicle', 'roadster', 'pickup', 'bus', 'van', 'buggy', 'racer', 'automobile'], structure: 'Confirmed wheel-and-holder assemblies joined by a chassis', features: ['Cabin or open cockpit', 'Distinct nose and rear or cargo bed'], quality: ['Wheelbase and overhangs suit the body proportions', 'Cabin, nose and rear have distinct volumes', 'Wheels remain exposed; loose tires are not an axle assembly'] },
  { id: 'aircraft', name: 'Aircraft & spacecraft', terms: ['aircraft', 'airplane', 'aeroplane', 'plane', 'biplane', 'glider', 'jet', 'shuttle', 'spaceship', 'spacecraft', 'lander'], structure: 'A narrow fuselage with joined wings and a tail attachment', features: ['Paired wings and separated tail surfaces', 'Cockpit and nose or engine treatment'], quality: ['Wing span, fuselage length and tail proportions form a readable aircraft', 'Left and right wings agree in shape', 'Cockpit, main wings and tail remain distinct from three views'] },
  { id: 'watercraft', name: 'Boats', terms: ['boat', 'ship', 'tug', 'tugboat', 'sailboat', 'yacht', 'workboat'], structure: 'A connected keel and wider deck', features: ['Bow and stern', 'Cabin, mast or sail'], quality: ['Hull narrows or steps toward the ends', 'Cabin or sail is proportionate to the hull', 'Keep deck details distinct from the main hull'] },
  { id: 'characters', name: 'Characters', terms: ['character', 'robot', 'humanoid', 'person', 'astronaut', 'explorer', 'knight', 'mech'], structure: 'Separated feet, connected hips, torso and supported head', features: ['Face or visor', 'Arms and recognizable outfit or equipment'], quality: ['Head, torso and limbs have intentional proportions', 'Face or visor reads at thumbnail size', 'Limbs remain separate and equipment is integrated into the silhouette'] },
  { id: 'machines', name: 'Machines', terms: ['machine', 'crane', 'gantry', 'press', 'drill', 'excavator', 'loader', 'forklift', 'factory', 'crawler', 'carrier'], structure: 'A supported frame or chassis carrying a visible working area', features: ['Boom, tool or press head', 'Open work area and supporting frame'], quality: ['The tool and work area make the machine identifiable', 'Beams and supports form an intelligible structure', 'Label static models honestly; do not imply working hinges, gears or lifting mechanisms'] },
  { id: 'objects', name: 'Furniture & objects', terms: ['object', 'furniture', 'table', 'desk', 'chair', 'bench', 'bookcase', 'shelf', 'camera', 'piano', 'guitar', 'mug'], structure: 'Connected supports or a shaped body sized for its visible features', features: ['Functional surface or opening', 'Distinctive controls, handle or other signature detail'], quality: ['Preserve functional negative space', 'Keep supports and surfaces proportionate', 'Defining features change the silhouette, rather than decorate a generic block'] },
  { id: 'nature', name: 'Plants', terms: ['plant', 'tree', 'pine', 'flower', 'bonsai', 'foliage'], structure: 'A supported trunk or stem', features: ['Tapered foliage or petals'], quality: ['Foliage has a coherent taper and rhythm', 'Stem and foliage have distinct proportions'] },
];

export const subjectWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(w => w === 'wolves' ? 'wolf' : w === 'buses' ? 'bus' : /(?:x|ch|sh|ss)es$/.test(w) ? w.slice(0, -2) : w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('s') && !['bus', 'press', 'glass', 'chassis', 'rhinoceros'].includes(w) ? w.slice(0, -1) : w);
export function strategiesFor(subject: string) {
  const words = new Set(subjectWords(subject));
  return FAMILY_STRATEGIES.filter(f => f.terms.some(t => words.has(t)));
}
export function strategyForRecipe(recipe: Pick<Recipe, 'family' | 'category' | 'animalBase' | 'strategy'>): FamilyStrategy {
  const id = recipe.strategy ?? (recipe.animalBase || recipe.category === 'Animals' ? 'animals'
    : recipe.category === 'Buildings' ? 'buildings' : ['plane', 'spaceship', 'glider', 'jet'].includes(recipe.family) ? 'aircraft'
    : ['tugboat', 'sailboat'].includes(recipe.family) ? 'watercraft' : recipe.family === 'character' || recipe.category === 'Characters' ? 'characters'
    : recipe.category === 'Machines' ? 'machines' : recipe.category === 'Vehicles' ? 'road-vehicles' : recipe.category === 'Nature' ? 'nature' : 'objects');
  return FAMILY_STRATEGIES.find(f => f.id === id)!;
}
export function familyPlanText(subject: string): string {
  const families = strategiesFor(subject);
  if (!families.length) return '';
  return `CONSTRUCTION FAMILY PLAN:\n${families.map(f => `${f.name}: ${f.structure}.\nReserve defining features before the core spends their stock: ${f.features.join('; ')}.\nVisual requirements: ${f.quality.join('; ')}.`).join('\n')}\nChoose a complete combination whose structure AND defining features fit one shared stock ledger. A bare chassis, body or frame is unfinished. A missing support cannot be omitted. Related subjects are alternatives, not permission to relabel a completed model as the requested subject. All current modules use upright stud connections; working mechanical joints need separate supported geometry.`;
}
