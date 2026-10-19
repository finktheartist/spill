import {describe,it,expect} from 'vitest';
import {Mesh,Vector3,Box3,Raycaster} from 'three';
import {COMMON_MOLDS} from './common-molds';
import {parsePartId,footprint,heightOf,type Placed} from './bricks';
import {madeIn} from './catalog';
import {frame,type V3} from './connections';
import {partObject} from './render';
const world=(p:V3)=>new Vector3(p[0]/20,p[2]/20,-p[1]/20);
function sameVectors(actual:number[][],expected:number[][]){
 expect(actual).toHaveLength(expected.length);
 const remaining=expected.slice();
 for(const a of actual){const i=remaining.findIndex(b=>a.every((n,j)=>Math.abs(n-b[j])<1e-5));expect(i,'Float32 renderer frame must match its exact source port within 0.00001 stud').toBeGreaterThanOrEqual(0);remaining.splice(i,1);}
}
describe('200 common reusable molds share actual renderer and connection frames',()=>{
 it.each(COMMON_MOLDS)('places every real stud at its port and exposes finite body geometry for #$num',m=>{
  const id=`${m.type}-${m.w}x${m.d}-${madeIn(`${m.type}-${m.w}x${m.d}`)![0]}`,k=parsePartId(id)!;
  for(const rot of [0,90,180,270]){
   const p:Placed={partId:id,x:3,y:4,z:2,rot},f=frame(p),o=partObject(k,p);o.root.updateMatrixWorld(true);
   const meshes=o.root.children.filter((v):v is Mesh=>v instanceof Mesh),bodyCount=m.render.length+(m.renderHulls??m.hulls??[]).length;
   expect(bodyCount).toBeGreaterThan(0);expect(meshes.length).toBe(bodyCount+f.ports.filter(p=>p.kind==='stud').length);
   const bodies=meshes.slice(0,bodyCount),studs=meshes.slice(bodyCount),ports=f.ports.filter(p=>p.kind==='stud');
   sameVectors(studs.map(s=>new Vector3().setFromMatrixPosition(s.matrixWorld).toArray()),ports.map(p=>world(p.point).toArray()));
   sameVectors(studs.map(s=>new Vector3(0,1,0).transformDirection(s.matrixWorld).toArray()),ports.map(p=>[p.normal[0],p.normal[2],-p.normal[1]]));
   const box=new Box3();for(const b of bodies){b.geometry.computeBoundingBox();expect([...b.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);expect(b.geometry.getAttribute('position').count).toBeGreaterThan(8);box.union(b.geometry.boundingBox!.clone().applyMatrix4(b.matrixWorld));}
   // Actual exterior may be source-clipped inside a conservative collision hull,
   // but must remain within the registered nominal pose envelope.
   for(const v of [box.min,box.max])expect([v.x,v.y,v.z].every(Number.isFinite)).toBe(true);
   const {fw,fd}=footprint(k,rot),eps=1e-5;
   expect(box.min.x).toBeGreaterThanOrEqual(p.x-eps);expect(box.max.x).toBeLessThanOrEqual(p.x+fw+eps);
   expect(box.min.y).toBeGreaterThanOrEqual(p.z*.4-eps);expect(box.max.y).toBeLessThanOrEqual((p.z+heightOf(k))*.4+eps);
   expect(box.min.z).toBeGreaterThanOrEqual(-p.y-fd-eps);expect(box.max.z).toBeLessThanOrEqual(-p.y+eps);
   for(const body of bodies){
    const pos=body.geometry.getAttribute('position');
    const a=new Vector3().fromBufferAttribute(pos,0).applyMatrix4(body.matrixWorld),b=new Vector3().fromBufferAttribute(pos,1).applyMatrix4(body.matrixWorld),c=new Vector3().fromBufferAttribute(pos,2).applyMatrix4(body.matrixWorld),normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),center=a.clone().add(b).add(c).multiplyScalar(1/3);
    expect(normal.lengthSq(),m.num+' nondegenerate exterior triangle').toBeGreaterThan(.99);
    const ray=new Raycaster(center.clone().addScaledVector(normal,.001),normal.clone().negate(),0,.01);expect(ray.intersectObject(body,false).length,m.num+' visible exterior triangle').toBeGreaterThan(0);
   }
  }
 });
});
