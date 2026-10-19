import { expect, it } from 'vitest';
import { bottomCells, cells, parsePartId, studCells, validate, type Build, type Placed } from './bricks';
import { checkFeatures, type Features } from './identify';
import { confirmOutlineObservation, outlineOptions } from './specialty-review';
import { counts, emptyInventory, type OtherEntry } from './inventory';
import { partObject } from './render';
import { Mesh, Vector3 } from 'three';

it('renders studs at the same world cells the validator uses in every rotation',()=>{
 for(const id of ['wedgeleft-2x4-red','wedgeright-2x4-red','quarterplate-4x4-red'])for(const rot of [0,90,180,270]){
  const k=parsePartId(id)!,p={partId:id,x:3,y:5,z:2,rot};
  const {root}=partObject(k,p);root.updateMatrixWorld(true);
  const visible=root.children.filter(o=>o instanceof Mesh&&o.geometry.type==='CylinderGeometry').map(o=>{
   const v=o.getWorldPosition(new Vector3());return [Math.floor(v.x),Math.floor(-v.z)].join();
  }).sort();
  expect(visible).toEqual(studCells(k,p).map(c=>c.join()).sort());
 }
});

it('keeps handed wedges and the quarter outline inside their rotated footprints with only real studs',()=>{
 for(const id of ['wedgeleft-2x4-red','wedgeright-2x4-red','quarterplate-4x4-red'])for(const rot of [0,90,180,270]){
  const k=parsePartId(id)!,p={partId:id,x:3,y:5,z:0,rot};
  const occupied=cells(k,p),studs=studCells(k,p);
  expect(studs.length).toBe(k.type==='quarterplate'?11:4);
  expect(new Set(studs.map(c=>c.join())).size).toBe(studs.length);
  expect(bottomCells(k,p)).toEqual(studs);
  expect(studs.every(c=>occupied.some(o=>o.join()===c.join()))).toBe(true);
  const w=rot%180?k.d:k.w,d=rot%180?k.w:k.d;
  expect(occupied.every(([x,y])=>x>=3&&y>=5&&x<3+w&&y<5+d)).toBe(true);
 }
 expect(parsePartId('wedgeleft-3x6-red')).toBeNull();
 expect(parsePartId('quarterplate-2x2-red')).toBeNull();
});

it('does not support a brick over the tapered margin or rounded cutout',()=>{
 const issues=(base:Placed,top:Placed)=>{
  const build:Build={name:'test',description:'',steps:[{caption:'Base',parts:[base]},{caption:'Top',parts:[top]}]};
  return validate(build,{[base.partId]:1,[top.partId]:1}).map(i=>i.kind);
 };
 const base={partId:'wedgeleft-2x4-red',x:0,y:0,z:0,rot:0};
 expect(issues(base,{partId:'brick-1x1-white',x:0,y:0,z:1,rot:0})).toEqual([]);
 expect(issues(base,{partId:'brick-1x1-white',x:1,y:3,z:1,rot:0})).toContain('floating');
 expect(issues({...base,partId:'quarterplate-4x4-red'},{partId:'brick-1x1-white',x:3,y:0,z:1,rot:0})).toContain('floating');
 const left=parsePartId(base.partId)!,right=parsePartId('wedgeright-2x4-red')!;
 expect(studCells(left,base)).toEqual([[0,0],[0,1],[0,2],[0,3]]);
 expect(studCells(right,{...base,partId:right.partId})).toEqual([[1,0],[1,1],[1,2],[1,3]]);
});

it('requires complete profile evidence and the correct hand in scanner readings',()=>{
 const f:Features={outline:'wedge',topShape:'flat',heightPlates:1,studLayout:'row',studsOnTop:4,handedness:'left'};
 expect(checkFeatures('wedgeleft',2,4,f)).toEqual({type:'wedgeleft',w:2,d:4});
 for(const bad of [{},{...f,handedness:'unknown' as const},{...f,studsOnTop:8}])expect(checkFeatures('wedgeleft',2,4,bad)).toHaveProperty('other');
 expect(checkFeatures('wedgeright',2,4,f)).toHaveProperty('other');
 expect(checkFeatures('quarterplate',4,4,{outline:'quarter-circle',topShape:'flat',heightPlates:1,studLayout:'grid',studsOnTop:11})).toEqual({type:'quarterplate',w:4,d:4});
});

it('keeps observations separate until a specific choice and consumes each at most once',()=>{
 const observation:OtherEntry={description:'Wedge plate 4x2',color:'red',boxes:[{photo:1,box:[0,0,20,20]}]};
 const inv={...emptyInventory(),others:[observation]};
 expect(outlineOptions(observation).map(k=>k.type)).toEqual(['wedgeleft','wedgeright']);
 expect(counts(inv)).toEqual({});
 expect(confirmOutlineObservation(inv,observation,'plate-2x4-red')).toBe(inv);
 const next=confirmOutlineObservation(inv,observation,'wedgeleft-2x4-red');
 expect(counts(next)).toEqual({'wedgeleft-2x4-red':1});expect(next.others).toEqual([]);
 expect(confirmOutlineObservation(next,observation,'wedgeright-2x4-red')).toBe(next);
 expect(outlineOptions({...observation,unknown:true})).toEqual([]);
 expect(outlineOptions({...observation,description:'Wedge plate 3x6'})).toEqual([]);
 expect(inv.others).toEqual([observation]);
});
