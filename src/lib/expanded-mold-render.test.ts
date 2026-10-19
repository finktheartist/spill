import {describe,it,expect} from 'vitest';
import {Mesh,Raycaster,Vector3} from 'three';
import {EXPANDED_PLAIN_MOLD_SPECS} from './expanded-plain-molds';
import {FLAT_MOLD_SPECS} from './expanded-flat-molds';
import {CONNECTOR_MOLD_SPECS} from './connector-mold-geometry';
import {parsePartId,type Placed} from './bricks';
import {frame,apply,add,solidContains,type V3} from './connections';
import {partObject} from './render';

const specs=[...EXPANDED_PLAIN_MOLD_SPECS,...FLAT_MOLD_SPECS,...CONNECTOR_MOLD_SPECS];
const point=(p:V3)=>new Vector3(p[0]/20,p[2]/20,-p[1]/20);
const sorted=(ps:number[][])=>ps.map(p=>p.map(n=>+n.toFixed(8)).join(',')).sort();
const placed=(id:string,rot:number):Placed=>({partId:id,x:3,y:4,z:2,rot});

describe('expanded mold renderer follows real shapes and connector planes',()=>{
 it.each(specs)('renders only actual top/front studs at every yaw for $num',s=>{
  const id=`${s.type}-${s.w}x${s.d}-white`,k=parsePartId(id)!;
  for(const rot of [0,90,180,270]){
   const p=placed(id,rot),f=frame(p),o=partObject(k,p);o.root.updateMatrixWorld(true);
   const meshes=o.root.children.filter((c):c is Mesh=>c instanceof Mesh),bodyCount=s.type==='headlight'||s.type==='invertedbracket'?2:1;
   const studs=meshes.slice(bodyCount),ports=f.ports.filter(p=>p.kind==='stud');
   expect(studs).toHaveLength(ports.length);
   expect(sorted(studs.map(s=>new Vector3().setFromMatrixPosition(s.matrixWorld).toArray()))).toEqual(sorted(ports.map(p=>point(p.point).toArray())));
   expect(sorted(studs.map(s=>new Vector3(0,1,0).transformDirection(s.matrixWorld).toArray()))).toEqual(sorted(ports.map(p=>new Vector3(p.normal[0],p.normal[2],-p.normal[1]).toArray())));
  }
 });

 it.each([
  ['roundtile-2x2-white',[[2,2,4],[38,38,4],[20,20,4]],[false,false,true]],
  ['halftile-1x1-white',[[1,1,4],[19,1,4],[10,2,4],[1,19,4]],[false,false,true,true]],
  ['quarterroundtile-1x1-white',[[19,1,4],[1,19,4],[10,10,4]],[false,true,true]],
  ['roundjumper-2x2-white',[[2,2,4],[38,38,4],[20,20,4]],[false,false,true]],
  ['triangletile-2x2-white',[[30,30,4],[39,1,4],[10,10,4],[2,32,4]],[false,false,true,true]],
 ] as [string,V3[],boolean[]][])('keeps source cutouts empty in both frame and rendered body at all yaws: %s',(id,samples,hits)=>{
  for(const rot of [0,90,180,270]){
   const p=placed(id,rot),f=frame(p),o=partObject(parsePartId(id)!,p);o.root.updateMatrixWorld(true);
   const body=o.root.children.find((c):c is Mesh=>c instanceof Mesh)!;
   samples.forEach((local,i)=>{
    const world=add(apply(f.rotation,local),f.translation),q=point(world),ray=new Raycaster(q.clone().add(new Vector3(0,2,0)),new Vector3(0,-1,0));
    expect(f.solids.some(s=>solidContains(s,world)),`${id}/${rot}/${local}`).toBe(hits[i]);
    expect(ray.intersectObject(body,false).length>0,`${id}/${rot}/${local}`).toBe(hits[i]);
   });
  }
 });

 it('keeps the headlight recess and inverted-bracket upper void empty',()=>{
  for(const [id,samples,hits] of [
   ['headlight-1x1-white',[[10,2,12],[10,2,2],[10,6,12]],[false,true,true]],
   ['invertedbracket-1x2-white',[[10,14,14],[10,2,14],[10,14,4]],[false,true,true]],
  ] as [string,V3[],boolean[]][]){
   for(const rot of [0,90,180,270]){
    const p=placed(id,rot),f=frame(p),o=partObject(parsePartId(id)!,p);o.root.updateMatrixWorld(true);
    const bodies=o.root.children.filter((c):c is Mesh=>c instanceof Mesh).slice(0,2);
    samples.forEach((local,i)=>{
     const world=add(apply(f.rotation,local),f.translation),q=point(world),direction=new Vector3(1,.31,.27).normalize();
     expect(f.solids.some(s=>solidContains(s,world))).toBe(hits[i]);
     // Cast from inside the queried point. An inward-facing surface occurs only
     // when this point is in a conservative body, independent of front studs.
     const ray=new Raycaster(q,direction,0,10),old=bodies.map(b=>b.material);
     bodies.forEach(b=>{const material=Array.isArray(b.material)?b.material[0]:b.material;b.material=material.clone();(b.material as import('three').Material).side=1;});
     const crossings=ray.intersectObjects(bodies,false).filter(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).dot(direction)>0);
     // Restrict to the box containing the sample; adjacent boxes may be ahead.
     const contained=bodies.some(b=>{b.geometry.computeBoundingBox();return b.geometry.boundingBox!.containsPoint(b.worldToLocal(q.clone()));});
     expect(contained).toBe(hits[i]);if(hits[i])expect(crossings.length).toBeGreaterThan(0);
     bodies.forEach((b,i)=>{(b.material as import('three').Material).dispose();b.material=old[i];});
    });
   }
  }
 });
});
