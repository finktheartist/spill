// Procedural three.js renderer for the brick contract. One set of geometry functions draws
// the instructions, the box-art thumbnails, the part icons and the hero pile, so every
// picture in the app matches the brick data exactly.
import * as THREE from 'three';
import { definition, connectionOnly, frame, apply, add, straightProfile, type Rotation } from './connections';
import { isOutlinePart, outlinePolygon, outlineStudCells } from './outline-parts';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLOR_NAMES, isTrans, COLORS, footprint, heightOf, parsePartId, type Build, type PartKind, type Placed } from './bricks';
import { curvedPart } from './curved-parts';
import { specialMold } from './special-mold-geometry';
import {popularMold} from './popular-molds';
import type {MoldPrism,MoldHull} from './popular-mold-types';

export const PH = 0.4; // one plate in stud units
const GAP = 0.035;
const INK = 0x1d1d1b;

// ---------------------------------------------------------------- shared geometry + materials

const geoCache = new Map<string, { body: THREE.BufferGeometry; edges: THREE.BufferGeometry; studs: [number, number][]; h: number }>();
const studGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.17, 24).translate(0, 0.085, 0);
const studEdges = new THREE.EdgesGeometry(studGeo, 30);
const openStudShape=new THREE.Shape();openStudShape.absarc(0,0,.3,0,Math.PI*2,false);
const openStudHole=new THREE.Path();openStudHole.absarc(0,0,.2,0,Math.PI*2,true);openStudShape.holes.push(openStudHole);
const openStudGeo=new THREE.ExtrudeGeometry(openStudShape,{depth:.17,bevelEnabled:false,curveSegments:16}).rotateX(-Math.PI/2);
const openStudEdges=new THREE.EdgesGeometry(openStudGeo,30);

/**
 * Directional profiles share one frame: the part's run is local z with the LOW edge at the front (+z)
 * and the high side at the back (−z); the profile is drawn in (z, height) and extruded across the width.
 */
function profile(w: number, d: number, draw: (s: THREE.Shape, pt: (z: number, y: number) => [number, number], zb: number, zf: number) => void) {
  const zb = -d / 2, zf = d / 2;
  const s = new THREE.Shape();
  const pt = (z: number, y: number): [number, number] => [-z, y]; // shape x = −z (see rotateY below)
  draw(s, pt, zb, zf);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, curveSegments: 14 });
  g.rotateY(Math.PI / 2); // (sx, sy, e) → (e, sy, −sx)
  g.translate(-w / 2, 0, 0);
  return g;
}

/** Straight outer profiles share their nominal contour with collision geometry. */
const straight = (k:PartKind) => profile(k.w,k.d,(s,pt)=>{
  straightProfile(k)!.forEach(([y,z],i)=>{
    const q=pt(k.d/2-y/20,z/20);if(i)s.lineTo(...q);else s.moveTo(...q);
  });
});
/** Real source-facet outline, including the raised underside. Cosmetic height
 * and width seams do not change the shared connector or collision definition. */
const curved = (k: PartKind) => profile(k.w - GAP, k.d, (s, pt) => {
  const definition=curvedPart(k);
  if(!definition)throw Error('Unsupported curved mold');
  const seam=(heightOf(k)*PH-.004)/(heightOf(k)*PH);
  definition.profile.forEach(([y,z],i)=>{const p=pt(k.d/2-y/20,z/20*seam);if(i)s.lineTo(...p);else s.moveTo(...p);});
});
/**
 * Corner (L) parts, 2x2 with the back-right cell missing at rot 0 (local +x right, +z front). The outline
 * is drawn in (x, -z) and extruded upward, inset by half a gap on every side.
 */
function corner(h: number) {
  const g = GAP / 2;
  const s = new THREE.Shape();
  const pt = (x: number, z: number): [number, number] => [x, -z];
  s.moveTo(...pt(-1 + g, 1 - g)); s.lineTo(...pt(1 - g, 1 - g)); s.lineTo(...pt(1 - g, g)); s.lineTo(...pt(-g, g));
  s.lineTo(...pt(-g, -1 + g)); s.lineTo(...pt(-1 + g, -1 + g)); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
}

/** Arch: a bar standing on its end studs with the span cut out underneath, leaving the top plate. */
function arch(len: number, depth: number, h: number) {
  const s = new THREE.Shape();
  const a = -len / 2, b = len / 2;
  s.moveTo(a, 0); s.lineTo(a + 1 - GAP / 2, 0);
  s.quadraticCurveTo(0, 2 * (h - PH), b - 1 + GAP / 2, 0);
  s.lineTo(b, 0); s.lineTo(b, h); s.lineTo(a, h); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, -depth / 2);
}

function partGeometry(k: PartKind) {
  const key = `${k.type}-${k.w}x${k.d}`;
  let g = geoCache.get(key);
  if (g) return g;
  const h = heightOf(k) * PH - 0.004;
  // Local frame = the rot-0 footprint (bricks lie long side along x; see footprint()).
  const { fw: X, fd: Z } = footprint(k, 0);
  const r = Math.min(X, Z) / 2 - GAP / 2;
  const mold=specialMold(k);
  let body: THREE.BufferGeometry;
  if(mold){
      const shape=new THREE.Shape();
      const contour=(path:THREE.Path,points:readonly(readonly[number,number])[])=>{
        points.forEach(([x,y],i)=>{const q:[number,number]=[x/20-X/2,y/20-Z/2];if(i)path.lineTo(...q);else path.moveTo(...q);});path.closePath();
      };
      contour(shape,mold.outline);
      for(const hole of mold.holes??[]){const path=new THREE.Path();contour(path,hole);shape.holes.push(path);}
      body=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false}).rotateX(-Math.PI/2);
  }else switch (k.type) {
    case 'wedgeleft': case 'wedgeright': case 'quarterplate': {
      const shape = new THREE.Shape(), points = outlinePolygon(k);
      points.forEach(([x,y],i) => { const q:[number,number]=[x-X/2,y-Z/2]; if(i)shape.lineTo(...q);else shape.moveTo(...q); });
      shape.closePath(); body = new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false}).rotateX(-Math.PI/2); break;
    }
    case 'slope': case 'invslope': case 'cheese': body = straight(k); break;
    case 'curve': body = curved(k); break;
    case 'arch': body = arch(X - GAP, Z - GAP, h); break;
    case 'roundendplate': {
      const shape=new THREE.Shape();shape.absarc(.5,0,r,-Math.PI/2,Math.PI/2,false);shape.absarc(-.5,0,r,Math.PI/2,Math.PI*1.5,false);shape.closePath();
      body=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:18}).rotateX(-Math.PI/2);break;
    }
    case 'roundbrick': case 'roundplate': case 'roundtile':
      body = new THREE.CylinderGeometry(r, r, h, 40).translate(0, h / 2, 0); break;
    case 'cone': body = new THREE.CylinderGeometry(0.3, r, h, 40).translate(0, h / 2, 0); break;
    case 'cornerplate': case 'cornertile': case 'cornerbrick': body = corner(h); break;
    default: body = new THREE.BoxGeometry(X - GAP, h, Z - GAP).translate(0, h / 2, 0);
  }
  const studs: [number, number][] = [];
  const grid = () => { for (let i = 0; i < X; i++) for (let j = 0; j < Z; j++) studs.push([-X / 2 + i + 0.5, Z / 2 - j - 0.5]); };
  if (['brick', 'plate', 'invslope', 'arch', 'roundbrick', 'roundplate', 'roundendplate', 'cone', 'cornerplate', 'cornerbrick'].includes(k.type)) grid();
  // corners: no stud on the empty back-right cell
  if (k.type === 'cornerplate' || k.type === 'cornerbrick') studs.splice(0, studs.length, ...studs.filter(([sx, sz]) => !(sx > 0 && sz < 0)));
  else if (k.type === 'slope') for (let i = 0; i < k.w; i++) studs.push([-k.w / 2 + i + 0.5, -k.d / 2 + 0.5]);
  if(isOutlinePart(k.type)) studs.push(...outlineStudCells(k,{partId:k.partId,x:0,y:0,z:0,rot:0}).map(([x,y]):[number,number]=>[x+.5-X/2,Z/2-y-.5]));
  if(mold)studs.splice(0,studs.length,...mold.studs.map(({point:[x,y]}):[number,number]=>[x/20-X/2,Z/2-y/20]));
  g = { body, edges: new THREE.EdgesGeometry(body, 30), studs, h: h + 0.004 };
  geoCache.set(key, g);
  return g;
}

const connectionGeoCache=new Map<string,{body:THREE.BufferGeometry;edges:THREE.BufferGeometry}[]>();
function moldGeometry(p:MoldPrism,fw:number,fd:number):THREE.BufferGeometry {
  const shape=new THREE.Shape();
  const draw=(path:THREE.Path,ps:readonly(readonly[number,number])[])=>{ps.forEach(([x,y],i)=>i?path.lineTo(x,y):path.moveTo(x,y));path.closePath();};
  draw(shape,p.polygon);
  for(const hole of p.holes??[]){const path=new THREE.Path();draw(path,hole);shape.holes.push(path);}
  const g=new THREE.ExtrudeGeometry(shape,{depth:p.max-p.min,bevelEnabled:false});
  const pos=g.getAttribute('position');
  for(let i=0;i<pos.count;i++){
    const a=pos.getX(i),b=pos.getY(i),t=pos.getZ(i)+p.min;
    const [x,y,z]=p.axis==='x'?[t,a,b]:p.axis==='y'?[a,t,b]:[a,b,t];
    pos.setXYZ(i,x/20-fw/2,z/20,fd/2-y/20);
  }
  // The y-extrusion basis reverses winding; preserve outward-facing surfaces.
  if(p.axis==='y')for(let i=0;i<pos.count;i+=3){const a=[pos.getX(i),pos.getY(i),pos.getZ(i)];pos.setXYZ(i,pos.getX(i+2),pos.getY(i+2),pos.getZ(i+2));pos.setXYZ(i+2,a[0],a[1],a[2]);}
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}
function moldHullGeometry(h:MoldHull,fw:number,fd:number):THREE.BufferGeometry {
  const points=h.faces.flatMap(f=>Array.from({length:f.length-2},(_,i)=>[f[0],f[i+1],f[i+2]]).flat()).flatMap(i=>{const [x,y,z]=h.points[i];return [x/20-fw/2,z/20,fd/2-y/20];});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}
const matCache = new Map<string, THREE.Material>();
function bodyMat(color: string) {
  let m = matCache.get(color);
  if (!m) {
    const trans = isTrans(color);
    m = new THREE.MeshStandardMaterial({
      color: COLORS[color as keyof typeof COLORS] ?? '#ff00ff', roughness: 0.3, metalness: 0,
      transparent: trans, opacity: trans ? 0.42 : 1, depthWrite: !trans,
    });
    matCache.set(color, m);
  }
  return m;
}
function isDark(color: string) {
  const c = new THREE.Color(COLORS[color as keyof typeof COLORS] ?? '#888');
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.06;
}
function edgeMat(color: string) {
  return new THREE.LineBasicMaterial({ color: isDark(color) ? 0x8a949c : INK, transparent: true, opacity: 0.4 });
}

export interface PartObject { root: THREE.Group; edges: THREE.LineBasicMaterial; restY: number; step: number }

/** A single part as an Object3D, positioned on the grid. */
// Wheels: a tire + hub with the axle along x; a pair rides on a 2x2 axle plate (3 plates tall in all).
const tireGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.78, 36).rotateZ(Math.PI / 2);
const tireEdges = new THREE.EdgesGeometry(tireGeo, 30);
const hubGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.84, 24).rotateZ(Math.PI / 2);
const axleGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.4, 12).rotateZ(Math.PI / 2);
const holderTop = new THREE.BoxGeometry(2 - GAP, PH - 0.004, 2 - GAP).translate(0, PH * 2.5, 0);
const holderBody = new THREE.BoxGeometry(2 - GAP, PH, 1).translate(0, PH * 1.5, 0);
const tireMat = (color: string) => {
  const key = `tire-${color}`;
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: COLORS[color as keyof typeof COLORS] ?? '#1B2A34', roughness: 0.85 }); matCache.set(key, m); }
  return m;
};

function wheel(root: THREE.Group, x: number, color: string, em: THREE.LineBasicMaterial) {
  const tire = new THREE.Mesh(tireGeo, tireMat(color));
  const hub = new THREE.Mesh(hubGeo, bodyMat('light-gray'));
  const edges = new THREE.LineSegments(tireEdges, em);
  for (const o of [tire, hub, edges]) { o.position.set(x, 0.6, 0); o.castShadow = true; }
  root.add(tire, hub, edges);
}

function wheelObject(k: PartKind, root: THREE.Group, em: THREE.LineBasicMaterial) {
  if (k.type === 'wheel') { wheel(root, 0, k.color, em); return; }
  wheel(root, -1.5, k.color, em);
  wheel(root, 1.5, k.color, em);
  const axle = new THREE.Mesh(axleGeo, bodyMat('dark-gray'));
  axle.position.y = 0.6;
  const plateMat = bodyMat('light-gray');
  const pe = edgeMat('light-gray');
  for (const geo of [holderTop, holderBody]) {
    const m = new THREE.Mesh(geo, plateMat); m.castShadow = m.receiveShadow = true;
    root.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), pe));
  }
  root.add(axle);
  for (const [sx, sz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const st = new THREE.Mesh(studGeo, plateMat);
    st.position.set(sx, 3 * PH, sz); st.castShadow = true;
    const se = new THREE.LineSegments(studEdges, pe); se.position.copy(st.position);
    root.add(st, se);
  }
}

export function partObject(k: PartKind, p?: Placed, step = 0): PartObject {
  const root = new THREE.Group();
  const em = edgeMat(k.color);
  if (k.type === 'wheel' || k.type === 'wheels') return place(k, root, em, p, step, () => wheelObject(k, root, em));
  return place(k, root, em, p, step, () => brickObject(k, root, em));
}

function place(k: PartKind, root: THREE.Group, em: THREE.LineBasicMaterial, p: Placed | undefined, step: number, build: () => void): PartObject {
  build();
  let restY = 0;
  if (p) {
    if(p.orientation || connectionOnly(k)) {
      const f=frame(p),{fw,fd}=footprint(k,0);
      const [x,y,z]=add(apply(f.rotation,[fw*10,fd*10,0]),f.translation);
      root.position.set(x/20,z/20,-y/20);
      // C R C^-1 converts the contract's z-up basis to three.js y-up.
      const r=f.rotation, m:Rotation=[r[0],r[2],-r[1],r[6],r[8],-r[7],-r[3],-r[5],r[4]];
      root.setRotationFromMatrix(new THREE.Matrix4().set(m[0],m[1],m[2],0,m[3],m[4],m[5],0,m[6],m[7],m[8],0,0,0,0,1));
      restY=root.position.y;
      return {root,edges:em,restY,step};
    }
    const { fw, fd } = footprint(k, p.rot);
    restY = p.z * PH;
    root.position.set(p.x + fw / 2, restY, -(p.y + fd / 2));
    root.rotation.y = (p.rot * Math.PI) / 180;
  }
  return { root, edges: em, restY, step };
}

function brickObject(k: PartKind, root: THREE.Group, em: THREE.LineBasicMaterial) {
  const popular=popularMold(k);
  if(popular){
    const key=`${k.type}-${k.w}x${k.d}`,fw=popular.widthLdu/20,fd=popular.depthLdu/20;
    if(!connectionGeoCache.has(key))connectionGeoCache.set(key,[...popular.render.map(p=>moldGeometry(p,fw,fd)),...(popular.renderHulls??popular.hulls??[]).map(h=>moldHullGeometry(h,fw,fd))].map(body=>({body,edges:new THREE.EdgesGeometry(body,30)})));
    for(const g of connectionGeoCache.get(key)!){const body=new THREE.Mesh(g.body,bodyMat(k.color));body.castShadow=body.receiveShadow=true;root.add(body,new THREE.LineSegments(g.edges,em));}
    for(const p of popular.ports.filter(p=>p.kind==='stud')){
      const g=p.open?openStudGeo:studGeo,e=p.open?openStudEdges:studEdges;
      const stud=new THREE.Mesh(g,bodyMat(k.color)),edge=new THREE.LineSegments(e,em);
      stud.position.set(p.point[0]/20-fw/2,p.point[2]/20,fd/2-p.point[1]/20);
      stud.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(p.normal[0],p.normal[2],-p.normal[1]));
      edge.position.copy(stud.position);edge.quaternion.copy(stud.quaternion);stud.castShadow=true;root.add(stud,edge);
    }
    return;
  }
  if(connectionOnly(k)&&!specialMold(k)) {
    const {fw,fd}=footprint(k,0),d=definition(k);
    const key=`${k.type}-${k.w}x${k.d}`;
    if(!connectionGeoCache.has(key))connectionGeoCache.set(key,d.boxes.map(b=>{
      const size=b.max.map((n,i)=>(n-b.min[i])/20), center=b.max.map((n,i)=>(n+b.min[i])/40);
      const geo=new THREE.BoxGeometry(size[0]-0.006,size[2]-0.004,size[1]-0.006).translate(center[0]-fw/2,center[2],fd/2-center[1]);
      return {body:geo,edges:new THREE.EdgesGeometry(geo,30)};
    }));
    for(const geo of connectionGeoCache.get(key)!){
      const mesh=new THREE.Mesh(geo.body,bodyMat(k.color));mesh.castShadow=mesh.receiveShadow=true;root.add(mesh,new THREE.LineSegments(geo.edges,em));
    }
    for(const p of d.ports.filter(p=>p.kind==='stud')){
      // 4070 stud2a / 99780 stud2 front studs are hollow in the source.
      // Rendering the opening does not qualify a bar or bore connection.
      const open=(k.type==='headlight'||k.type==='invertedbracket')&&p.id.startsWith('side:');
      const st=new THREE.Mesh(open?openStudGeo:studGeo,bodyMat(k.color)),se=new THREE.LineSegments(open?openStudEdges:studEdges,em);
      st.position.set(p.point[0]/20-fw/2,p.point[2]/20,fd/2-p.point[1]/20);
      st.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(p.normal[0],p.normal[2],-p.normal[1]));
      se.position.copy(st.position);se.quaternion.copy(st.quaternion);st.castShadow=true;root.add(st,se);
    }
    return;
  }
  const g = partGeometry(k);
  const body = new THREE.Mesh(g.body, bodyMat(k.color));
  body.castShadow = body.receiveShadow = !isTrans(k.color);
  root.add(body, new THREE.LineSegments(g.edges, em));
  for (const [sx, sz] of g.studs) {
    const open=k.type==='roundendplate'||specialMold(k)?.openStuds===true;
    const s = new THREE.Mesh(open?openStudGeo:studGeo, bodyMat(k.color));
    s.position.set(sx, g.h, sz); s.castShadow = true;
    const se = new THREE.LineSegments(open?openStudEdges:studEdges, em);
    se.position.copy(s.position);
    root.add(s, se);
  }
}

// ---------------------------------------------------------------- a lit stage

export function stage(canvas: HTMLCanvasElement, opts: { preserve?: boolean } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ad98, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-6, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.002; ground.receiveShadow = true;
  scene.add(ground);
  return { renderer, scene, sun, pmrem };
}

export function fitShadow(sun: THREE.DirectionalLight, box: THREE.Box3) {
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2 + 2;
  sun.target.position.copy(c);
  sun.position.copy(c).add(new THREE.Vector3(-6, 14, 9));
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -r; cam.right = cam.top = r; cam.near = 0.5; cam.far = 60;
  cam.updateProjectionMatrix();
}

const VIEW_DIR = new THREE.Vector3(0.95, 0.8, 1.35).normalize();

// ---------------------------------------------------------------- the build viewer

export interface Pad { top: number; right: number; bottom: number; left: number }

export class BuildViewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 400);
  private controls?: OrbitControls;
  private pivot = new THREE.Group();
  private parts: PartObject[] = [];
  private anims: { obj: PartObject; t0: number }[] = [];
  private box = new THREE.Box3();
  private ro: ResizeObserver;
  private disposed = false;
  private connectionBuild = false;
  private clock = new THREE.Clock();
  pad: Pad = { top: 0, right: 0, bottom: 0, left: 0 };
  turntable = false;

  constructor(private canvas: HTMLCanvasElement, opts: { interactive?: boolean; turntable?: boolean } = {}) {
    const s = stage(canvas);
    this.renderer = s.renderer; this.scene = s.scene; this.sun = s.sun;
    this.scene.add(this.pivot);
    this.turntable = !!opts.turntable;
    if (opts.interactive) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.enablePan = false;
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.addEventListener('start', () => { this.turntable = false; });
    }
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setBuild(build: Build) {
    this.connectionBuild=build.engine==='connections-v2';
    this.pivot.clear();
    this.parts = [];
    const inner = new THREE.Group();
    build.steps.forEach((st, si) => st.parts.forEach(p => {
      const k = parsePartId(p.partId);
      if (!k) return;
      const o = partObject(k, p, si);
      this.parts.push(o);
      inner.add(o.root);
    }));
    this.box.setFromObject(inner);
    const c = this.box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, 0, -c.z);
    this.pivot.add(inner);
    this.box.setFromObject(this.pivot);
    fitShadow(this.sun, this.box.clone().expandByScalar(1));
    this.resetView();
  }

  /** Show steps 0..i; parts in step i drop in. i ≥ steps shows the whole build quietly. */
  showStep(i: number, animate = true) {
    const now = performance.now();
    this.anims = [];
    let n = 0;
    for (const o of this.parts) {
      o.root.visible = o.step <= i;
      const isNew = o.step === i;
      o.edges.opacity = isNew ? 0.95 : 0.32;
      o.root.position.y = o.restY;
      if (isNew && animate && !this.connectionBuild) this.anims.push({ obj: o, t0: now + 90 * n++ });
    }
    for (const a of this.anims) a.obj.root.position.y = a.obj.restY + 2.6;
  }

  resetView() {
    const sphere = this.box.getBoundingSphere(new THREE.Sphere());
    const { w, h } = this.size();
    const freeW = Math.max(1, w - this.pad.left - this.pad.right), freeH = Math.max(1, h - this.pad.top - this.pad.bottom);
    // Fit the bounding sphere inside the free (unpadded) region of the canvas.
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const vFree = 2 * Math.atan(t * (freeH / h)), hFree = 2 * Math.atan(t * (freeW / h));
    const dist = (sphere.radius / Math.sin(Math.min(vFree, hFree) / 2)) * 1.02;
    const target = new THREE.Vector3(0, sphere.center.y * 0.9, 0);
    this.camera.position.copy(target).addScaledVector(VIEW_DIR, dist);
    this.camera.near = dist / 50; this.camera.far = dist * 6;
    this.camera.lookAt(target);
    this.camera.setViewOffset(w, h, (this.pad.right - this.pad.left) / 2, (this.pad.bottom - this.pad.top) / 2, w, h);
    this.camera.updateProjectionMatrix();
    this.pivot.rotation.y = 0;
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.minDistance = dist * 0.45; this.controls.maxDistance = dist * 2.2;
      this.controls.update();
    }
  }

  private size() {
    const el = this.canvas.parentElement ?? this.canvas;
    return { w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) };
  }

  private resize() {
    if (this.disposed) return;
    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.parts.length) this.resetView(); else this.camera.updateProjectionMatrix();
  }

  private tick() {
    const dt = this.clock.getDelta();
    const now = performance.now();
    this.anims = this.anims.filter(a => {
      const t = Math.min(1, Math.max(0, (now - a.t0) / 340));
      const e = 1 - Math.pow(1 - t, 4);
      a.obj.root.position.y = a.obj.restY + 2.6 * (1 - e);
      return t < 1;
    });
    if (this.turntable) this.pivot.rotation.y += dt * 0.35;
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls?.dispose();
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------- part icons (shared offscreen renderer)

let iconStage: ReturnType<typeof stage> | null = null;
const iconCache = new Map<string, string>();
const ICON = 192;

export function partIcon(partId: string): string {
  const hit = iconCache.get(partId);
  if (hit) return hit;
  const k = parsePartId(partId);
  if (!k) return '';
  if (!iconStage) {
    const c = document.createElement('canvas');
    iconStage = stage(c, { preserve: true });
    iconStage.renderer.setPixelRatio(1);
    iconStage.renderer.setSize(ICON, ICON, false);
    iconStage.renderer.shadowMap.enabled = false;
  }
  const { renderer, scene } = iconStage;
  const o = partObject(k);
  o.edges.opacity = 0.7;
  scene.add(o.root);
  const box = new THREE.Box3().setFromObject(o.root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 200);
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(11)) * 1.04;
  cam.position.copy(sphere.center).addScaledVector(VIEW_DIR, dist);
  cam.lookAt(sphere.center);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(o.root);
  iconCache.set(partId, url);
  return url;
}

/**
 * A labeled key of the catalog's shapes, rendered by the app itself, sent to the scanner next to the photo
 * so it has something to compare unusual pieces against (curved vs cheese vs inverted slopes, rounds, arches).
 */
const KEY_PARTS: [string, string][] = [
  ['brick-2x4', 'brick 2x4'], ['plate-2x4', 'plate 2x4'], ['tile-1x4', 'tile 1x4 (no studs)'], ['slope-2x2', 'slope 2x2 (45°)'],
  ['curve-2x2', 'curve 2x2'], ['curve-1x3', 'curve 1x3'], ['invslope-2x2', 'invslope 2x2'], ['cheese-1x1', 'cheese 1x1'],
  ['roundbrick-2x2', 'roundbrick 2x2'], ['roundbrick-1x1', 'roundbrick 1x1'], ['roundplate-2x2', 'roundplate 2x2'], ['roundtile-1x1', 'roundtile 1x1'],
  ['cone-1x1', 'cone 1x1'], ['arch-1x4', 'arch 1x4'], ['arch-1x6', 'arch 1x6'], ['wheel-1x1', 'wheel'],
  ['cornerplate-2x2', 'cornerplate 2x2'], ['cornerbrick-2x2', 'cornerbrick 2x2'], ['cornertile-2x2', 'cornertile 2x2'],
  ['roundendplate-1x2','round ends 1x2'], ['jumper-1x2','jumper 1x2'], ['jumper-2x2','jumper 2x2'],
  ['wedgeleft-2x4', 'wedge left 2x4'], ['wedgeright-2x4', 'wedge right 2x4'], ['quarterplate-4x4', 'quarter plate 4x4'],
];
let keyCache: Promise<string> | null = null;
export function scanKey(): Promise<string> {
  return (keyCache ??= (async () => {
    const cell = 200, label = 30, cols = 4, rows = Math.ceil(KEY_PARTS.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * cell; c.height = rows * (cell + label);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1d1d1b'; g.font = '600 20px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
    for (const [i, [id, name]] of KEY_PARTS.entries()) {
      const img = new Image();
      img.src = partIcon(`${id}-light-gray`);
      await img.decode();
      const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + label);
      g.drawImage(img, x + 4, y + 4, cell - 8, cell - 8);
      g.fillText(name, x + cell / 2, y + cell + 20);
    }
    return c.toDataURL('image/jpeg', 0.9);
  })());
}

/** The palette as labeled chips, sent with the close-ups so colors are matched by eye, not by name. */
let colorKeyCache: string | null = null;
export function colorKey(): string {
  if (colorKeyCache) return colorKeyCache;
  const cols = 6, cw = 170, ch = 92, rows = Math.ceil(COLOR_NAMES.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * cw; c.height = rows * ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.font = '600 15px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  COLOR_NAMES.forEach((name, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    g.fillStyle = COLORS[name]; g.fillRect(x + 10, y + 8, cw - 20, 52);
    g.strokeStyle = '#999'; g.lineWidth = 1; g.strokeRect(x + 10, y + 8, cw - 20, 52);
    g.fillStyle = '#1d1d1b'; g.fillText(name, x + cw / 2, y + 80);
  });
  return (colorKeyCache = c.toDataURL('image/jpeg', 0.92));
}

// ---------------------------------------------------------------- hero: a spilled pile, slowly orbiting

export function spillHero(canvas: HTMLCanvasElement, ids: string[]) {
  const { renderer, scene, sun } = stage(canvas);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 400);
  const pile = new THREE.Group();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const placed: { x: number; z: number; r: number; top: number }[] = [];
  ids.forEach((id, i) => {
    const k = parsePartId(id);
    if (!k) return;
    const o = partObject(k);
    const r = Math.hypot(k.w, k.d) * 0.5;
    const onTop = i % 3 === 2 && placed.length > 3;
    if (onTop) {
      // rest on a ground part, tipped a little, as if it slid off the heap
      const base = placed[Math.floor(rnd() * placed.length)];
      o.root.position.set(base.x + (rnd() - 0.5) * 0.6, base.top + 0.05, base.z + (rnd() - 0.5) * 0.6);
      o.root.rotation.set((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35);
    } else {
      let x = 0, z = 0;
      for (let tries = 0; tries < 200; tries++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (4 + tries / 40);
        x = Math.cos(a) * d; z = Math.sin(a) * d;
        if (placed.every(p => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 0.92)) break;
      }
      placed.push({ x, z, r, top: heightOf(k) * PH + (k.type === 'tile' ? 0 : 0.17) });
      o.root.position.set(x, 0, z);
      o.root.rotation.y = rnd() * Math.PI * 2;
    }
    pile.add(o.root);
  });
  scene.add(pile);
  fitShadow(sun, new THREE.Box3().setFromObject(pile).expandByScalar(1));
  const sphere = new THREE.Box3().setFromObject(pile).getBoundingSphere(new THREE.Sphere());
  const resize = () => {
    const el = canvas.parentElement ?? canvas;
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const fov = 2 * Math.atan(t * Math.min(1, camera.aspect));
    const dist = (sphere.radius / Math.sin(fov / 2)) * 0.98; // a little crop reads as "more pile than frame"
    camera.position.set(0, 0, 0).addScaledVector(new THREE.Vector3(0, 0.62, 1).normalize(), dist);
    camera.lookAt(0, 0.3, 0);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement ?? canvas);
  resize();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    pile.rotation.y += clock.getDelta() * 0.12;
    renderer.render(scene, camera);
  });
  return () => { ro.disconnect(); renderer.setAnimationLoop(null); renderer.dispose(); };
}

// ---------------------------------------------------------------- views for the model's self-review

let viewStage: ReturnType<typeof stage> | null = null;
const VIEW = 640;

/** The build as JPEGs from the front-right 3/4, straight front, and straight side, on paper, for Gemini to look at. */
export function renderViews(build: Build): string[] {
  return renderReviewViews(build, false);
}

/** The editable builder also sees the rear, where exposed carriers and lonely
 * supports can be hidden by an otherwise convincing front silhouette. */
export function renderWholeModelViews(build: Build): string[] {
  return renderReviewViews(build, true);
}

function renderReviewViews(build: Build, rear: boolean): string[] {
  if (!viewStage) {
    viewStage = stage(document.createElement('canvas'), { preserve: true });
    viewStage.renderer.setPixelRatio(1);
    viewStage.renderer.setSize(VIEW, VIEW, false);
    viewStage.renderer.setClearColor(0xf3efe6, 1);
  }
  const { renderer, scene, sun } = viewStage;
  const g = new THREE.Group();
  build.steps.forEach((st, si) => st.parts.forEach(p => { const k = parsePartId(p.partId); if (k) g.add(partObject(k, p, si).root); }));
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  g.position.set(-c.x, 0, -c.z);
  scene.add(g);
  const b2 = new THREE.Box3().setFromObject(g);
  fitShadow(sun, b2.clone().expandByScalar(1));
  const sphere = b2.getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 400);
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(14))) * 1.04;
  const directions = [VIEW_DIR, new THREE.Vector3(0, 0.15, 1).normalize(), new THREE.Vector3(1, 0.18, 0).normalize()];
  if (rear) directions.push(new THREE.Vector3(0, 0.18, -1).normalize());
  const out = directions.map(dir => {
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.near = dist / 50; cam.far = dist * 4;
    cam.lookAt(sphere.center);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/jpeg', 0.85);
  });
  scene.remove(g);
  return out;
}
