import { describe, expect, it } from 'vitest';
import { Mesh, Raycaster, Vector3 } from 'three';
import { bottomCells, footprint, parsePartId, studCells, type Build, type Placed } from './bricks';
import { apply, add, attachPart, axisAngle, connectionPairs, definition, frame, solidContains, validateConnections, type V3 } from './connections';
import { constructionIssues } from './construction';
import { partObject } from './render';
import { specialMold } from './special-mold-geometry';

const ids = ['endstudplate-1x4-azure', 'edgeplate-2x2-reddish-brown', 'roundtile-3x3-dark-blue', 'quartertile-2x2-blue'];
const rots = [0, 90, 180, 270];
const piece = (partId: string, x = 0, y = 0, z = 0, rot = 0): Placed => ({ partId, x, y, z, rot });
const build = (parts: Placed[]): Build => ({ engine: 'connections-v2', name: 'Special mold integration', description: '',
  steps: parts.map(p => ({ caption: 'Attach the exact piece.', parts: [p] })) });
const ledger = (parts: Placed[]) => parts.reduce<Record<string, number>>((a, p) => ({ ...a, [p.partId]: (a[p.partId] ?? 0) + 1 }), {});
const sorted = (ps: readonly (readonly number[])[]) => ps.map(p => p.map(n => +n.toFixed(8)).join(',')).sort();
const renderPoint = (p: V3) => new Vector3(p[0] / 20, p[2] / 20, -p[1] / 20);

describe('root special-mold adapters use the qualified helper unchanged', () => {
  it.each(ids)('keeps frame ports, bounds and legacy upright cells aligned at every yaw: %s', id => {
    const k = parsePartId(id)!, d = specialMold(k)!;
    expect(k).not.toBeNull();
    expect(definition(k).convex).toHaveLength(d.sections.length);
    for (const rot of rots) {
      const p = piece(id, 5, 6, 7, rot), f = frame(p), size = footprint(k, rot);
      expect(f.bounds.min).toEqual([100, 120, 56]);
      expect(f.bounds.max).toEqual([100 + size.fw * 20, 120 + size.fd * 20, 64]);
      const cells = (ps: [number, number][], z: number) => ps.map(([x, y]) => [x * 20 + 10, y * 20 + 10, z]);
      expect(sorted(f.ports.filter(p => p.kind === 'stud').map(p => p.point))).toEqual(sorted(cells(studCells(k, p), 64)));
      expect(sorted(f.ports.filter(p => p.kind === 'grip').map(p => p.point))).toEqual(sorted(cells(bottomCells(k, p), 56)));
      for (const port of f.ports) expect(port.normal).toEqual(port.kind === 'stud' ? [0, 0, 1] : [0, 0, -1]);
    }
  });

  it.each(ids)('mates actual underside sockets legally with exact stock at all four yaws: %s', id => {
    const base = piece('plate-1x1-red', 10, 10), mold = specialMold(parsePartId(id)!)!;
    for (const rot of rots) for (const grip of mold.grips) {
      const child = attachPart(base, 'stud:0:0', id, grip.id, rot === 270 ? -90 : rot);
      expect(connectionPairs(frame(base), frame(child))).toContainEqual(['stud:0:0', grip.id]);
      expect(constructionIssues(build([base, child]), ledger([base, child]), 24)).toEqual([]);
    }
  });

  it('permits only the two real top studs, with no invented center or smooth-row joints', () => {
    for (const [id, cells] of [[ids[0], [[0, 0], [3, 0]]], [ids[1], [[0, 1], [1, 1]]]] as const) {
      const base = piece(id, 2, 2), k = parsePartId(id)!;
      expect(studCells(k, base)).toEqual(cells.map(([x, y]) => [x + 2, y + 2]));
      for (const port of definition(k).ports.filter(p => p.kind === 'stud')) {
        const child = attachPart(base, port.id, 'plate-1x1-red', 'grip:0:0');
        expect(constructionIssues(build([base, child]), ledger([base, child]), 24)).toEqual([]);
      }
      expect(() => attachPart(base, 'stud:center', 'plate-1x1-red', 'grip:0:0')).toThrow(/existing/);
      const blank = id === ids[0] ? piece('plate-1x1-red', 3, 2, 1) : piece('plate-1x1-red', 2, 2, 1);
      expect(connectionPairs(frame(base), frame(blank))).toEqual([]);
      expect(constructionIssues(build([base, blank]), ledger([base, blank]), 24).some(i => i.kind === 'floating')).toBe(true);
    }
    for (const id of ids.slice(2)) {
      const base = piece(id);
      expect(definition(parsePartId(id)!).ports.filter(p => p.kind === 'stud')).toEqual([]);
      expect(() => attachPart(base, 'stud:0:0', 'plate-1x1-red', 'grip:0:0')).toThrow();
    }
  });

  it('does not accept an unqualified 67095 corner or tube-center socket', () => {
    const tile = piece(ids[2], 2, 2, 1);
    for (const [x, y] of [[2, 2], [2, 4], [4, 2], [4, 4], [2.5, 2.5], [3.5, 3.5]]) {
      const base = piece('plate-1x1-red', x, y);
      expect(connectionPairs(frame(base), frame(tile))).toEqual([]);
      expect(constructionIssues(build([base, tile]), ledger([base, tile]), 24).length).toBeGreaterThan(0);
    }
  });

  it('quartertile SAT preserves both real empty regions and rejects actual material intersections', () => {
    const q = piece(ids[3]), f = frame(q);
    expect(f.solids).toHaveLength(8);
    expect(f.solids.some(s => solidContains(s, [5, 35, 4]))).toBe(false);
    expect(f.solids.some(s => solidContains(s, [35, 5, 4]))).toBe(false);
    expect(f.solids.some(s => solidContains(s, [10, 10, 4]))).toBe(true);
    const inCutout = { ...piece('plate-1x1-red', 0, 1.25), orientation: axisAngle([0, 1, 0], 90) };
    const inMaterial = { ...inCutout, x: .5 };
    // Deliberately separate objects test collision only, not a claimed assembly.
    const cutIssues = validateConnections(build([q, inCutout]), ledger([q, inCutout]));
    expect(cutIssues.some(i => i.kind === 'overlap')).toBe(false);
    expect(cutIssues.some(i => i.kind === 'loose')).toBe(true);
    expect(validateConnections(build([q, inMaterial]), ledger([q, inMaterial])).some(i => i.kind === 'overlap')).toBe(true);
  });

  it('retains exact inventory and unchanged physical rejection of overlap and a shifted joint', () => {
    const base = piece('plate-1x1-red', 4, 4), child = attachPart(base, 'stud:0:0', ids[0], 'grip:0:0');
    const good = build([base, child]), stock = ledger([base, child]), before = structuredClone({ good, stock });
    expect(constructionIssues(good, stock, 24)).toEqual([]);
    expect(constructionIssues(good, { ...stock, [child.partId]: 0 }, 24).some(i => i.kind === 'inventory')).toBe(true);
    expect(constructionIssues(build([base, child, { ...child }]), { ...stock, [child.partId]: 2 }, 24).some(i => i.kind === 'overlap')).toBe(true);
    expect(constructionIssues(build([base, { ...child, x: child.x + .1 }]), stock, 24).some(i => i.kind === 'overlap')).toBe(true);
    expect({ good, stock }).toEqual(before);
  });

  it.each(ids)('renders only real studs at their validated world positions for every yaw: %s', id => {
    const k = parsePartId(id)!, d = specialMold(k)!;
    for (const rot of rots) {
      const p = piece(id, 3, 4, 2, rot), obj = partObject(k, p);
      obj.root.updateMatrixWorld(true);
      const meshes = obj.root.children.filter((o): o is Mesh => o instanceof Mesh);
      expect(meshes).toHaveLength(1 + d.studs.length);
      const actual = meshes.slice(1).map(s => new Vector3().setFromMatrixPosition(s.matrixWorld).toArray());
      const expected = frame(p).ports.filter(p => p.kind === 'stud').map(p => renderPoint(p.point).toArray());
      expect(sorted(actual)).toEqual(sorted(expected));
    }
  });

  it('quartertile rendered cutout has the same orientation as the convex frame at every yaw', () => {
    for (const rot of rots) {
      const p = piece(ids[3], 3, 4, 2, rot), f = frame(p), obj = partObject(parsePartId(ids[3])!, p);
      obj.root.updateMatrixWorld(true);
      const body = obj.root.children.find((o): o is Mesh => o instanceof Mesh)!;
      for (const [local, hit] of [[[5, 35, 4], false], [[35, 5, 4], false], [[10, 10, 4], true]] as [V3, boolean][]) {
        const world = add(apply(f.rotation, local), f.translation), point = renderPoint(world);
        expect(f.solids.some(s => solidContains(s, world))).toBe(hit);
        const ray = new Raycaster(new Vector3(point.x, point.y + 2, point.z), new Vector3(0, -1, 0));
        expect(ray.intersectObject(body, false).length > 0).toBe(hit);
      }
    }
  });
});
