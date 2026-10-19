// The workbench in 3D: a 24×24 stud plate, the build, a see-through "ghost" of the part in hand that follows the
// pointer and snaps to studs, and the builder's suggested moves shown as see-through parts. Clicks (not drags)
// place or remove; dragging orbits, right-drag pans, the wheel zooms. Rules live in workbench.ts.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLORS, footprint, heightOf, parsePartId, type Build, type PartKind, type Placed } from './bricks';
import { PH, fitShadow, partObject, stage } from './render';
import { BENCH, allParts, type Side } from './workbench';

/** The cell under the pointer, and which wall of a part it's against (none over a top or the plate). */
export interface Hover { cx: number; cy: number; side?: Side }

/** Give a part object its own see-through materials, so the shared brick materials are never touched. */
function ghostly(root: THREE.Object3D, color: number, opacity: number) {
  root.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.material = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, roughness: 0.6 });
      o.castShadow = false;
    } else if (o instanceof THREE.LineSegments) {
      o.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity + 0.35) });
    }
  });
  root.renderOrder = 2;
  return root;
}

const placeAt = (root: THREE.Object3D, k: PartKind, p: Placed) => {
  const { fw, fd } = footprint(k, p.rot);
  root.position.set(p.x + fw / 2, p.z * PH, -(p.y + fd / 2));
  root.rotation.y = (p.rot * Math.PI) / 180;
};

export class BenchView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
  private controls: OrbitControls;
  private plate = new THREE.Group();
  private parts = new THREE.Group();
  private marks = new THREE.Group();
  private preview = new THREE.Group();
  private ghost: THREE.Object3D | null = null;
  private ro: ResizeObserver;
  private ray = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  private pulse = 0;

  /** Called with the cell under the pointer (null when off the plate). */
  onHover: (h: Hover | null) => void = () => {};
  /** A click (not a drag): on a cell to place, or on a part with remove = true (Shift, or the remove tool). */
  onClick: (h: Hover, partIndex: number | null, remove: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const s = stage(canvas);
    this.renderer = s.renderer; this.scene = s.scene; this.sun = s.sun;
    this.scene.add(this.plate, this.parts, this.marks, this.preview);
    this.buildPlate();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.target.set(BENCH / 2, 0, -BENCH / 2);
    this.camera.position.set(BENCH / 2 + 22, 26, 22);
    this.controls.minDistance = 10; this.controls.maxDistance = 90;
    fitShadow(this.sun, new THREE.Box3(new THREE.Vector3(0, 0, -BENCH), new THREE.Vector3(BENCH, 8, 0)));
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerdown', this.press);
    canvas.addEventListener('pointerup', this.release);
    canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('contextmenu', this.noMenu);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** The base plate: 24×24 studs in the app's warm gray, with a slightly darker edge. */
  private buildPlate() {
    const color = new THREE.Color('#d8d1c2');
    const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH, 0.16, BENCH), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    top.position.set(BENCH / 2, -0.08, -BENCH / 2);
    top.receiveShadow = true;
    top.name = 'plate';
    const studGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16).translate(0, 0.07, 0);
    const studs = new THREE.InstancedMesh(studGeo, new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.94), roughness: 0.7 }), BENCH * BENCH);
    const m = new THREE.Matrix4();
    for (let x = 0; x < BENCH; x++) for (let y = 0; y < BENCH; y++) studs.setMatrixAt(x * BENCH + y, m.makeTranslation(x + 0.5, 0, -(y + 0.5)));
    studs.receiveShadow = true;
    studs.raycast = () => {}; // clicks land on the plate itself
    this.plate.add(top, studs);
  }

  setBuild(build: Build, flagged: Map<number, string> = new Map()) {
    this.parts.clear();
    this.marks.clear();
    allParts(build).forEach((p, i) => {
      const k = parsePartId(p.partId);
      if (!k) return;
      const o = partObject(k, p);
      o.root.userData.index = i;
      o.root.userData.top = (p.z + heightOf(k)) * PH;
      this.parts.add(o.root);
      if (flagged.has(i)) {
        const box = new THREE.BoxHelper(o.root, flagged.get(i) === 'loose' ? 0xc2871a : 0xa3361f);
        this.marks.add(box);
      }
    });
  }

  /** The part in hand, where it would go; red when it can't go there. null hides it. */
  setGhost(k: PartKind | null, p?: Placed, ok = true) {
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = null;
    if (!k || !p) return;
    const o = partObject(k);
    ghostly(o.root, ok ? new THREE.Color(COLORS[k.color]).getHex() : 0xa3361f, ok ? 0.55 : 0.45);
    placeAt(o.root, k, p);
    this.ghost = o.root;
    this.scene.add(o.root);
  }

  /** A suggested move: parts it adds (blue, see-through) and parts it takes away (red, see-through). */
  setPreview(adds: Placed[], removes: Placed[]) {
    this.preview.clear();
    for (const [list, color] of [[adds, 0x2d7fd0], [removes, 0xa3361f]] as const) {
      for (const p of list) {
        const k = parsePartId(p.partId);
        if (!k) continue;
        const o = partObject(k);
        ghostly(o.root, color, 0.5);
        placeAt(o.root, k, p);
        // a removal sits exactly on the real part: grow it a hair so it shows over it
        if (color === 0xa3361f) o.root.scale.setScalar(1.03);
        this.preview.add(o.root);
      }
    }
  }

  private cellAt(e: PointerEvent): { h: Hover; index: number | null } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    // Solid surfaces only. The bricks' outline edges are lines, and a ray counts a line as hit anywhere within a
    // stud of it, with no surface direction: the pointer snapped to a nearby edge, a stud off, read as a top.
    const hit = this.ray.intersectObjects([this.plate, this.parts], true).find(h => (h.object as THREE.Mesh).isMesh);
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object, index: number | null = null, top = 0;
    while (o) { if (typeof o.userData.index === 'number') { index = o.userData.index; top = o.userData.top; break; } o = o.parent; }
    // Over a top face, the studs on it or the plate: the cell under the pointer. (A stud's round side faces
    // sideways, so it can't count as a wall: anything at or above the part's top is its top.)
    // Against a wall below the top: the cell next to it, and which way the wall faces.
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const wall = index !== null && Math.abs(n.y) < 0.5 && hit.point.y < top - 0.02;
    const dx = wall ? Math.round(n.x) : 0, dz = wall ? Math.round(n.z) : 0;
    const cx = Math.floor(hit.point.x + dx * 0.5), cy = Math.floor(-(hit.point.z + dz * 0.5));
    if (cx < 0 || cy < 0 || cx >= BENCH || cy >= BENCH) return null;
    // world +z faces the front, which is lower y on the grid
    return { h: { cx, cy, side: wall ? { dx: dx as Side['dx'], dy: -dz as Side['dy'] } : undefined }, index };
  }

  private move = (e: PointerEvent) => { const c = this.cellAt(e); this.onHover(c?.h ?? null); };
  private press = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private release = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || e.button !== 0) return;
    const c = this.cellAt(e);
    if (c) this.onClick(c.h, c.index, e.shiftKey);
  };
  private leave = () => this.onHover(null);
  private noMenu = (e: Event) => e.preventDefault();

  /** Where a point on the grid (x, y in studs, z in plates) shows on the canvas, in page pixels. For tests. */
  screenOf(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, z * PH, -y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    this.pulse += 0.05;
    const o = 0.38 + Math.sin(this.pulse) * 0.14;
    this.preview.traverse(m => { if (m instanceof THREE.Mesh) (m.material as THREE.MeshStandardMaterial).opacity = o; });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerdown', this.press);
    this.canvas.removeEventListener('pointerup', this.release);
    this.canvas.removeEventListener('pointerleave', this.leave);
    this.canvas.removeEventListener('contextmenu', this.noMenu);
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
