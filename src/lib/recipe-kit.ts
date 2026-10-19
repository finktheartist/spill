import type { ColorName } from './bricks';
import type { Recipe, RecipePart, RecipeStep, Role } from './library-recipes';

export const part = (shape: string, role: Role, x: number, y: number, z: number, rot = 0): RecipePart => ({ shape, role, x, y, z, rot });
export const layer = (caption: string, ...parts: RecipePart[]): RecipeStep => ({ caption, parts });
export interface Port { kind: 'studs'; x: number; y: number; z: number; w: number; d: number }
export const studs = (x: number, y: number, z: number, w: number, d: number): Port => ({ kind: 'studs', x, y, z, w, d });
export interface Module {
  id: string; label: string; steps: RecipeStep[];
  /** A rectangular grip patch at the module's origin; surrounding parts may overhang it. */
  inlet?: Port; ports?: Record<string, Port>;
}
export interface Mount { key: string; module: Module; parent?: string; socket?: string }
export interface Assembly { steps: RecipeStep[]; modules: { id: string; label: string; parent?: string; socket?: string; offset: [number, number, number] }[] }

/** Ports describe allowed alignment, never proof of a connection. Every resulting recipe is geometrically checked. */
export function assemble(mounts: Mount[]): Assembly {
  const mounted = new Map<string, { module: Module; offset: [number, number, number] }>();
  const steps: RecipeStep[] = [], modules: Assembly['modules'] = [];
  for (const mount of mounts) {
    if (mounted.has(mount.key)) throw new Error(`Duplicate module key: ${mount.key}`);
    let offset: [number, number, number] = [0, 0, 0];
    if (mount.parent) {
      const parent = mounted.get(mount.parent), inlet = mount.module.inlet;
      const port = parent?.module.ports?.[mount.socket ?? ''];
      if (!parent || !port || !inlet || inlet.kind !== port.kind || inlet.w > port.w || inlet.d > port.d) {
        throw new Error(`Incompatible attachment: ${mount.key} -> ${mount.parent}.${mount.socket}`);
      }
      offset = [parent.offset[0] + port.x - inlet.x, parent.offset[1] + port.y - inlet.y, parent.offset[2] + port.z - inlet.z];
    } else if (mounted.size) throw new Error('An assembly must have one connected root');
    mounted.set(mount.key, { module: mount.module, offset });
    steps.push(...mount.module.steps.map(s => ({ ...s, feature: s.feature ?? { name: mount.module.label, kind: mount.parent ? 'identity' as const : 'structure' as const }, parts: s.parts.map(p => ({ ...p, x: p.x + offset[0], y: p.y + offset[1], z: p.z + offset[2] })) })));
    modules.push({ id: mount.module.id, label: mount.module.label, parent: mount.parent, socket: mount.socket, offset });
  }
  return { steps, modules };
}

export const PALETTE: Partial<Record<Role, ColorName>> = { body: 'reddish-brown', trim: 'red', base: 'light-gray', light: 'white', dark: 'black', glass: 'trans-clear' };
export function recipe(info: Omit<Recipe, 'palette' | 'contrast' | 'steps'> & { palette?: Recipe['palette']; contrast?: Recipe['contrast'] }, assembly: Assembly | RecipeStep[]): Recipe {
  return { palette: PALETTE, contrast: [], ...info, ...(Array.isArray(assembly) ? { steps: assembly } : assembly) };
}

/** A wide platform and a centered socket. The platform can use different actual plate sizes. */
export function platform(w: number, d: number, socketW = w, socketD = d): Module {
  const a = Math.min(w, d), b = Math.max(w, d);
  return { id: `platform-${w}x${d}`, label: `${w} × ${d} base`, steps: [layer('Start with the base.', part(`plate-${a}x${b}`, 'base', 0, 0, 0, w < d ? 90 : 0))],
    ports: { top: studs(Math.floor((w - socketW) / 2), Math.floor((d - socketD) / 2), 1, socketW, socketD) } };
}

export function pitchedRoof(w: 4 | 6, style: 'slopes' | 'steps'): Module {
  const slopes = Array.from({ length: w / 2 }, (_, i) => [part('slope-2x2', 'trim', i * 2, 0, 1), part('slope-2x2', 'trim', i * 2, 2, 1, 180)]).flat();
  return { id: `roof-${w}-${style}`, label: style === 'slopes' ? 'Sloping roof' : 'Stepped roof', inlet: studs(0, 0, 0, w, 4), steps: [
    layer('Bridge the walls with the roof base.', part(`plate-2x${w}`, 'trim', 0, 0, 0), part(`plate-2x${w}`, 'trim', 0, 2, 0)),
    style === 'slopes' ? layer('Face the roof slopes inward toward the ridge.', ...slopes) : layer('Step the roof inward to a narrow ridge.', part(`plate-2x${w}`, 'trim', 0, 1, 1), part(`plate-1x${w}`, 'trim', 0, 1, 2)),
  ] };
}

export function tableLegs(length: 4 | 6 | 8, tall = false): Module {
  const legs = [0, length - 2].flatMap(x => [part('brick-1x2', 'body', x, 0, 0, 90), ...(tall ? [part('brick-1x2', 'body', x, 0, 3, 90)] : [])]);
  return { id: `legs-${length}-${tall ? 'tall' : 'low'}`, label: tall ? 'Tall legs' : 'Low legs', steps: [layer('Set the legs apart.', ...legs)], ports: { top: studs(0, 0, tall ? 6 : 3, length, 2) } };
}

export function animalBody(length: 4 | 6): Module {
  return { id: `animal-body-${length}`, label: length === 4 ? 'Compact body' : 'Long body', steps: [
    layer('Set out four feet.', ...[1, 4].flatMap(x => [part('brick-1x2', 'trim', x, 1, 0, 90), part('brick-1x2', 'trim', x, length - 1, 0, 90)])),
    layer('Join the feet with the body.', part(`plate-2x${length}`, 'base', 1, 1, 3, 90), part(`plate-2x${length}`, 'base', 3, 1, 3, 90)),
    layer('Raise the shoulders and hips.', part('brick-2x4', 'body', 1, 1, 4), part('brick-2x4', 'body', 1, length - 1, 4)),
  ], ports: { head: studs(2, 1, 7, 2, 2), tail: studs(2, length, 7, 2, 1) } };
}

export function vehicleChassis(length: 6 | 8): Module {
  return { id: `chassis-${length}`, label: length === 6 ? 'Short wheelbase' : 'Long wheelbase', steps: [
    layer('Set out two complete wheel-and-holder assemblies.', part('wheels-4x2', 'dark', 0, 0, 0), part('wheels-4x2', 'dark', 0, length - 2, 0)),
    layer('Connect the holders with the chassis.', part(`plate-4x${length}`, 'base', 0, 0, 3, 90)),
  ], ports: { body: studs(0, 0, 4, 4, length) } };
}
