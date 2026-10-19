import { expect,it } from 'vitest';
import { Vector3 } from 'three';
import { attachPart, compileConnections, definition, frame, connectionPairs, IDENTITY, validRotation, axisAngle } from './connections';
import { parsePartId, validate, settle, applyEdits, buildSize, type Build, type Placed } from './bricks';
import { constructionIssues, orderBuild, constructionKey } from './construction';
import { partObject } from './render';
import { buildCounts } from './library';
import { surveyRobot } from './connection-models';
import { saveDiscovery, loadDiscoveries, geometryFingerprint } from './library-discoveries';
import { isMade, shoppingList } from './catalog';
import photo from '../../test/fixtures/photo-stock.json';
const piece=(partId:string,x=0,y=0,z=0,rot=0):Placed=>({partId,x,y,z,rot});
const assembly=(parts:Placed[]):Build=>({engine:'connections-v2',name:'Test',description:'',steps:parts.map(p=>({caption:'Connect',parts:[p]}))});
const issues=(parts:Placed[])=>{const b=assembly(parts);return constructionIssues(b,buildCounts(b),24);};
it('uses the LDraw side stud height and mates a sideways plate without snapping',()=>{
 const p=piece('sidebrick-1x1-red',1,1),q=attachPart(p,'side:0','plate-1x1-black','grip:0:0');
 expect(definition(parsePartId(p.partId)!).ports.find(p=>p.id==='side:0')?.point).toEqual([10,0,14]);
 expect(q.z).toBe(.5);expect(q.y).toBe(.6);
 expect(connectionPairs(frame(p),frame(q))).toContainEqual(['side:0','grip:0:0']);
 expect(issues([p,q])).toEqual([]);
 expect(validate({...assembly([p,q]),engine:undefined},buildCounts(assembly([p,q])))[0].kind).toBe('invalid');
 const displaced={...q,z:q.z+.01};expect(issues([p,displaced]).some(i=>i.kind==='floating')).toBe(true);
});
it('requires the jumper center, never imaginary grid studs',()=>{
 const p=piece('jumper-1x2-red'),q=attachPart(p,'stud:center','brick-1x1-black','grip:0:0');
 expect(q.x).toBe(.5);expect(issues([p,q])).toEqual([]);
 expect(issues([p,{...q,x:0}]).some(i=>i.kind==='floating')).toBe(true);
 expect(()=>attachPart(p,'stud:0:0',q.partId,'grip:0:0')).toThrow();
});
it('models the bracket void and fractional body envelope',()=>{
 const p=piece('brick-1x2-black',0,1),q=attachPart(p,'stud:0:0','bracket-1x2-red','grip:0:0');
 expect(q.z).toBe(1.5);expect(q.y).toBe(.8);expect(issues([p,q])).toEqual([]);
 const face=attachPart(q,'side:0','tile-1x2-yellow','grip:0:0');expect(issues([p,q,face])).toEqual([]);
 expect(buildSize(assembly([q])).heightPlates).toBe(4);
});
it('rejects nonrigid, reflected, nonfinite and ambiguous transforms before geometry',()=>{
 expect(validRotation(IDENTITY)).toBe(true);expect(validRotation(axisAngle([1,1,0],23))).toBe(true);
 for(const orientation of [[2,0,0,0,1,0,0,0,1],[-1,0,0,0,1,0,0,0,1],[NaN,0,0,0,1,0,0,0,1]])expect(()=>frame({...piece('brick-1x1-red'),orientation:orientation as typeof IDENTITY})).toThrow();
 expect(()=>frame({...piece('brick-1x1-red',0,0,0,90),orientation:IDENTITY})).toThrow();
 expect(()=>frame(piece('plate-999x999-red'))).toThrow();
});
it('rejects duplicate connector use, intersections, stock exhaustion and wrong assembly order',()=>{
 const p=piece('sidebrick-1x1-red',1,1),q=attachPart(p,'side:0','plate-1x1-black','grip:0:0');
 expect(issues([p,q,{...q}]).map(i=>i.kind)).toContain('overlap');
 expect(issues([p,q,{...q}]).map(i=>i.message).join()).toContain('occupied by two');
 expect(issues([q,p]).map(i=>i.kind)).toContain('floating');
 expect(validate(assembly([p,q]),{[p.partId]:1}).some(i=>i.kind==='inventory')).toBe(true);
 expect(validate(assembly([p]),{[p.partId]:NaN}).some(i=>i.kind==='inventory')).toBe(true);
});
it('rotates rendered local points into exactly the frame checked by the validator',()=>{
 const parent=piece('sidebrick-1x1-red',4,4,4,90),child=attachPart(parent,'side:0','plate-1x4-black','grip:1:0',23);
 const obj=partObject(parsePartId(child.partId)!,child);obj.root.updateMatrixWorld(true);
 // Local geometry origin is the unrotated body center at its base (40,10,0) LDU.
 const measured=new Vector3(-1.5,0,0).applyMatrix4(obj.root.matrixWorld);
 const port=frame(child).ports.find(p=>p.id==='grip:0:0')!.point;
 expect(measured.x).toBeCloseTo(port[0]/20,8);expect(measured.y).toBeCloseTo(port[2]/20,8);expect(measured.z).toBeCloseTo(-port[1]/20,8);
});
it('compiles all robot angles, preserving real stock, instructions and transforms',()=>{
 for(const angle of [0,10,20,30]){
  const {program,stock,build}=surveyRobot(angle);
  expect(constructionIssues(build,stock,24)).toEqual([]);expect(program.operations.length).toBeGreaterThanOrEqual(20);
  expect(Object.keys(stock).filter(id=>!isMade(id))).toEqual([]);
  expect(orderBuild(build,true)).toBe(build);expect(settle(build,stock)).toEqual({build,moved:0});
  expect(()=>applyEdits(build,[])).toThrow(/attachment/);
  const decoded=JSON.parse(JSON.stringify(build));expect(constructionIssues(decoded,stock,24)).toEqual([]);
  expect(()=>compileConnections(program,{...stock,'bracket-1x2-light-gray':0})).toThrow(/stock/);
  expect(shoppingList(build,photo.stock).getCount).toBeGreaterThan(0);
 }
 expect(constructionKey(surveyRobot(0).build)).not.toBe(constructionKey(surveyRobot(20).build));
 expect(geometryFingerprint(surveyRobot(0).build)).not.toBe(geometryFingerprint(surveyRobot(20).build));
});
it('persists exact transforms only after the unchanged finished-quality gate passes',()=>{
 let data='';const storage={getItem:()=>data,setItem:(_key:string,value:string)=>{data=value;}};
 const {stock,build}=surveyRobot();
 const verdict={looksLike:'robot',recognizable:4,complete:4,impressive:4,colors:4,fixes:[],review:'blind-v1' as const,subjectMatched:true};
 expect(saveDiscovery(build,{...verdict,impressive:3},stock,storage).status).toBe('rejected');
 expect(saveDiscovery(build,verdict,stock,storage).status).toBe('saved');
 const loaded=loadDiscoveries(storage)[0].build;
 expect(constructionKey(loaded)).toBe(constructionKey(build));expect(loaded.engine).toBe('connections-v2');
 expect(constructionIssues(loaded,stock,24)).toEqual([]);
});
it('uses oriented solids instead of overlapping world bounding boxes for diagonal panels',()=>{
 const p={...piece('plate-1x4-red',2,2),orientation:axisAngle([0,0,1],45)};
 const q={...p,x:1.25,y:2.75};
 expect(issues([p,q]).some(i=>i.kind==='overlap')).toBe(false);
 expect(issues([p,{...q,x:1.5,y:2.5}]).some(i=>i.kind==='overlap')).toBe(true);
});
it('rejects a stud entering an offset socket, even when bodies do not overlap',()=>{
 const p=piece('plate-1x2-red'),q={...piece('plate-1x2-black',.25,0,1),orientation:IDENTITY};
 expect(issues([p,q]).some(i=>i.message.includes('unmatched stud'))).toBe(true);
});
it('catches opposing studs that collide across a gap between otherwise separate bodies',()=>{
 const p=piece('sidebrick-1x1-red',1,2),q=piece('sidebrick-1x1-red',1,.8,0,180);
 expect(issues([p,q]).some(i=>i.message.includes('Studs on parts'))).toBe(true);
});
