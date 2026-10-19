import { CATALOG, gripCells, heightOf, parsePartId, studCells, voxels, type ColorName, type Placed } from './bricks';
import { constructionIssues } from './construction';
import type { Recipe, RecipeStep, Role } from './library-recipes';
import type { Module, Port } from './recipe-kit';

/** Upright, translated stud interfaces. This is deliberately not a generic LDraw importer. */
export interface ComponentPort extends Port {
  contract: string;
  /** Only these relative cells are promised on a hollow interface, e.g. a wall ring. */
  pads?: [number, number][];
}
export interface Component extends Omit<Module, 'inlet' | 'ports'> {
  inlet?: ComponentPort;
  ports?: Record<string, ComponentPort>;
  evidence: string[];
  /** Human-readable constraints preserved when choosing an alternative construction. */
  preserves: string[];
}
export interface ComponentMount { key: string; component: Component; parent?: string; socket?: string }
export interface ComponentPlan {
  id: string; name: string; family: string; category: Recipe['category'];
  features: string[]; mounts: ComponentMount[]; palette: Partial<Record<Role, ColorName>>; allowedColors?: Recipe['allowedColors'];
}
export interface ComponentSummary {
  planId: string; modules: string[]; features: string[]; evidence: string[];
  interfaces: { parent: string; socket: string; child: string; contacts: number }[];
}
const kind = (shape: string) => {
  const k = parsePartId(`${shape}-white`);
  if (!k || (k.type === 'wheels' ? k.w !== 4 || k.d !== 2 : k.type === 'wheel' || !CATALOG[k.type].includes(`${k.w}x${k.d}`))) throw new Error(`Unknown component shape: ${shape}`);
  return k;
};
const placed = (steps: RecipeStep[]): Placed[] => steps.flatMap(s => s.parts.map(p => ({ ...p, partId: `${p.shape}-white` })));
const padCells = (p: ComponentPort) => p.pads ?? Array.from({ length: p.w * p.d }, (_, i) => [i % p.w, Math.floor(i / p.w)] as [number, number]);
function checkPort(p: ComponentPort) {
  if (![p.x, p.y, p.z, p.w, p.d].every(Number.isSafeInteger) || p.w <= 0 || p.d <= 0 || !p.contract || !padCells(p).length || new Set(padCells(p).map(c => c.join(','))).size !== padCells(p).length || padCells(p).some(([x, y]) => !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= p.w || y >= p.d)) throw new Error('Invalid component interface');
}
function exposed(parts: Placed[]) {
  const occupied = new Set(parts.flatMap(p => voxels(parsePartId(p.partId)!, p).map(c => c.join(','))));
  return new Set(parts.flatMap(p => {
    const k = parsePartId(p.partId)!, z = p.z + heightOf(k);
    return studCells(k, p).map(([x, y]) => `${x},${y},${z}`).filter(c => !occupied.has(c));
  }));
}

/** Compile first, allocate stock for the entire assembly second. A named socket alone proves nothing. */
export function compileComponents(plan: ComponentPlan): { recipe: Recipe; summary: ComponentSummary } {
  const mounts = new Map<string, { c: Component; offset: [number, number, number] }>();
  const consumed = new Set<string>(), steps: RecipeStep[] = [], modules: NonNullable<Recipe['modules']> = [], interfaces: ComponentSummary['interfaces'] = [];
  for (const mount of plan.mounts) {
    const c = mount.component;
    c.steps.forEach(s => s.parts.forEach(p => kind(p.shape)));
    const localSurface = exposed(placed(c.steps));
    for (const [name, socket] of Object.entries(c.ports ?? {})) {
      checkPort(socket);
      if (padCells(socket).some(([x, y]) => !localSurface.has(`${socket.x + x},${socket.y + y},${socket.z}`))) throw new Error(`Component ${c.id}.${name} advertises missing or covered studs`);
    }
    if (mounts.has(mount.key)) throw new Error(`Duplicate component key: ${mount.key}`);
    let offset: [number, number, number] = [0, 0, 0];
    if (mount.parent) {
      const parent = mounts.get(mount.parent), socket = parent?.c.ports?.[mount.socket ?? ''], inlet = c.inlet;
      if (!parent || !socket || !inlet) throw new Error(`Missing attachment: ${mount.key}`);
      checkPort(socket); checkPort(inlet);
      if (socket.contract !== inlet.contract || socket.w !== inlet.w || socket.d !== inlet.d) throw new Error(`Incompatible component interface: ${mount.key}`);
      const key = `${mount.parent}.${mount.socket}`;
      if (consumed.has(key)) throw new Error(`Occupied component socket: ${key}`);
      offset = [parent.offset[0] + socket.x - inlet.x, parent.offset[1] + socket.y - inlet.y, parent.offset[2] + socket.z - inlet.z];
      const surface = exposed(placed(steps));
      const pads = padCells(socket).map(([x, y]) => `${parent.offset[0] + socket.x + x},${parent.offset[1] + socket.y + y},${parent.offset[2] + socket.z}`);
      if (pads.some(p => !surface.has(p))) throw new Error(`Socket ${key} promises missing or covered studs`);
      const grip = new Set(c.steps.flatMap(s => s.parts.flatMap(p => gripCells(kind(p.shape), { ...p, partId: `${p.shape}-white` }).filter(([, ,z])=>z===inlet.z).map(([x,y,z]) => `${x + offset[0]},${y + offset[1]},${z + offset[2]}`))));
      const contacts = pads.filter(p => grip.has(p)).length;
      if (contacts < 2) throw new Error(`Component ${mount.key} needs at least two real interface contacts`);
      consumed.add(key); interfaces.push({ parent: mount.parent, socket: mount.socket!, child: mount.key, contacts });
    } else if (mounts.size || c.inlet) throw new Error('Components need exactly one ground root');
    mounts.set(mount.key, { c, offset });
    steps.push(...c.steps.map(s => ({ ...s, feature: s.feature ?? { name: c.label, kind: mount.parent ? 'identity' as const : 'structure' as const }, parts: s.parts.map(p => ({ ...p, x: p.x + offset[0], y: p.y + offset[1], z: p.z + offset[2] })) })));
    modules.push({ id: c.id, label: c.label, parent: mount.parent, socket: mount.socket, offset });
  }
  // Sort individual parts by height, retaining their component captions and feature ownership.
  const ordered: RecipeStep[] = [];
  for (const { s, p } of steps.flatMap(s => s.parts.map(p => ({ s, p }))).sort((a, b) => a.p.z - b.p.z)) {
    const last = ordered.at(-1);
    if (last?.caption === s.caption && last.parts[0].z === p.z) last.parts.push(p);
    else ordered.push({ ...s, parts: [p] });
  }
  const all = placed(ordered), stock: Record<string, number> = {};
  for (const p of all) stock[p.partId] = (stock[p.partId] ?? 0) + 1;
  const issues = constructionIssues({ name: plan.name, description: '', steps: ordered.map(s => ({ caption: s.caption, parts: placed([s]) })) }, stock, 24);
  if (issues.length) throw new Error(`Invalid component assembly ${plan.id}: ${issues.map(i => i.message).join('; ')}`);
  return {
    recipe: { id: `components:${plan.id}`, family: plan.family, name: plan.name, category: plan.category,
      pitch: plan.features.join('; '), features: plan.features, palette: plan.palette, allowedColors: plan.allowedColors, contrast: plan.category === 'Animals' ? [['dark', 'light']] : [], steps: ordered, modules },
    summary: { planId: plan.id, modules: plan.mounts.map(m => m.component.id), features: plan.features,
      evidence: [...new Set(plan.mounts.flatMap(m => m.component.evidence))], interfaces },
  };
}
