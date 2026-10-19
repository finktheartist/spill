import { listing, parsePartId, type Build, type Placed } from './bricks';
import { constructionIssues } from './construction';

interface Slot { shape: string; x: number; y: number; z: number; rot?: number }
interface Recipe { name: string; purpose: string; slots: Slot[] }
export interface Technique { name: string; purpose: string; build: Build }

// Local coordinates, ordinary stud connections only. These are construction components,
// not suggested subjects. Each instantiated example is checked against the actual stock.
const RECIPES: Recipe[] = [
  { name: 'Pitched roof', purpose: 'Two opposing slopes make a ridge; keep their high edges together.', slots: [
    { shape: 'plate-2x4', x: 0, y: 0, z: 0, rot: 90 },
    { shape: 'slope-2x2', x: 0, y: 0, z: 1 }, { shape: 'slope-2x2', x: 0, y: 2, z: 1, rot: 180 },
  ] },
  ...[4, 6].map(length => ({ name: `Arch opening ${length}`, purpose: 'Support both ends and leave the opening clear.', slots: [
    { shape: `plate-1x${length}`, x: 0, y: 0, z: 0 },
    { shape: 'brick-1x1', x: 0, y: 0, z: 1 }, { shape: 'brick-1x1', x: length - 1, y: 0, z: 1 },
    { shape: `arch-1x${length}`, x: 0, y: 0, z: 4 },
  ] })),
  { name: 'Open frame', purpose: 'A bar joins two posts while leaving visible negative space.', slots: [
    { shape: 'plate-1x4', x: 0, y: 0, z: 0 },
    { shape: 'brick-1x1', x: 0, y: 0, z: 1 }, { shape: 'brick-1x1', x: 3, y: 0, z: 1 },
    { shape: 'plate-1x4', x: 0, y: 0, z: 4 },
  ] },
  { name: 'Wheel chassis', purpose: 'Two confirmed wheel assemblies connect through a shared plate.', slots: [
    { shape: 'wheels-4x2', x: 0, y: 0, z: 0 }, { shape: 'wheels-4x2', x: 0, y: 4, z: 0 },
    { shape: 'plate-4x6', x: 0, y: 0, z: 3, rot: 90 },
  ] },
];

export function techniquesFor(have: Record<string, number>): Technique[] {
  return RECIPES.flatMap(recipe => {
    const left = { ...have };
    const parts: Placed[] = [];
    for (const slot of recipe.slots) {
      const id = Object.keys(left).filter(id => {
        const k = parsePartId(id);
        return left[id] > 0 && k && `${k.type}-${k.w}x${k.d}` === slot.shape;
      }).sort((a, b) => left[b] - left[a] || a.localeCompare(b))[0];
      if (!id) return [];
      left[id]--;
      parts.push({ partId: id, x: slot.x, y: slot.y, z: slot.z, rot: slot.rot ?? 0 });
    }
    const build: Build = { name: recipe.name, description: recipe.purpose, steps: [{ caption: recipe.name, parts }] };
    return constructionIssues(build, have, 24).length ? [] : [{ name: recipe.name, purpose: recipe.purpose, build }];
  });
}

export function techniqueText(have: Record<string, number>): string {
  const examples = techniquesFor(have);
  if (!examples.length) return '';
  return `OPTIONAL CHECKED CONSTRUCTION EXAMPLES (each is an independent alternative using this stock, not a kit to add all at once):
${examples.map(t => `${t.name}: ${t.purpose}\n${listing(t.build)}`).join('\n\n')}
Use a technique only if it serves this subject. Translate the whole example together to connect it to the model; account for every piece already used. Recheck attachments and clearances in the full model. You may share an existing supporting plate instead of adding a duplicate. These examples do not prescribe what to build.`;
}
