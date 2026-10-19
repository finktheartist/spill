import {expect,it} from 'vitest';
import {createRobotTarget,silhouetteFit,targetContract} from './robot-silhouette';
import {ROBOT_MODULE_OPTIONS,type RobotModuleSpec} from './robot-module-shapes';
import {robotBodyIssues,solveRobotTarget} from './robot-body-plan';
import {moduleConnected} from './robot-module-layout';
import {constructionIssues} from './construction';
import {buildCounts} from './library';
import {frame,axisAngle} from './connections';
import photo from '../../test/fixtures/photo-stock.json';
// Keep the previous manual vocabulary covered independently of the new default.
const DEFAULT_ROBOT_MODULES:RobotModuleSpec={legHeight:7,torsoProfile:'tapered',shoulderProfile:'stepped',armPose:'bent',handStyle:'palm',footStyle:'boot',headStyle:'visor'};
const target=createRobotTarget(DEFAULT_ROBOT_MODULES),solutions=solveRobotTarget(photo.stock,target),seed=solutions[0];
it('plans independently changeable, frozen module geometry before accepting any parts',()=>{
 expect(target.version).toBe(2);expect(Object.isFrozen(target.zones![0].types)).toBe(true);
 expect(JSON.stringify(target)).not.toMatch(/partId|operations|inventory/);
 for(const [field,options]of Object.entries(ROBOT_MODULE_OPTIONS))for(const value of options.filter(v=>v!==DEFAULT_ROBOT_MODULES[field as keyof RobotModuleSpec])){
  const alternative=createRobotTarget({...DEFAULT_ROBOT_MODULES,[field]:value});expect(alternative.id).not.toBe(target.id);expect(alternative.volumes).not.toEqual(target.volumes);
 }
 expect(()=>createRobotTarget({...DEFAULT_ROBOT_MODULES,handStyle:'imaginary'})).toThrow();
 expect(()=>targetContract(target,seed.contract.roles)).toThrow(/assignment/);
});
it('assembles the shaped modules from the unchanged photo stock with genuine connector interfaces',()=>{
 const stock=JSON.stringify(photo.stock);expect(solutions.length).toBeGreaterThan(1);
 for(const c of solutions){
  expect(c.target).toBe(target);expect(c.build.steps.length).toBeGreaterThanOrEqual(20);expect(c.build.steps.length).toBeLessThanOrEqual(60);
  expect(constructionIssues(c.build,photo.stock,24)).toEqual([]);expect(robotBodyIssues(c.build,c.contract)).toEqual([]);
  expect(silhouetteFit(c.build,target,c.contract.roles).issues).toEqual([]);
  for(const [id,n]of Object.entries(buildCounts(c.build)))expect(n).toBeLessThanOrEqual(photo.stock[id as keyof typeof photo.stock]);
  const features=c.contract.features!,parts=c.build.steps.flatMap(s=>s.parts);
  for(const z of features.zones.filter(z=>z.connected))expect(moduleConnected(parts.filter((_,i)=>features.assignment[i]===z.id))).toBe(true);
  expect(c.modules!.regions.some(r=>r.feature==='Forward forearm')).toBe(true);expect(c.build.steps.some(s=>s.caption.startsWith('Compact palm.'))).toBe(true);
 }
 expect(JSON.stringify(photo.stock)).toBe(stock);
});
it('builds open gripper hands and mirrored outward bevels without pretending there are working hinges',()=>{
 const target=createRobotTarget({...DEFAULT_ROBOT_MODULES,handStyle:'gripper',shoulderProfile:'beveled'}),cs=solveRobotTarget(photo.stock,target);expect(cs.length).toBeGreaterThan(0);
 const c=cs[0],features=c.contract.features!,ps=c.build.steps.flatMap(s=>s.parts);
 expect(features.zones.some(z=>z.id==='left.hand.outer')).toBe(true);expect(features.zones.some(z=>z.id==='left.hand.inner')).toBe(true);
 for(const [id,angle]of [['left.shoulder.cap',270],['right.shoulder.cap',90]] as const){const p=ps[features.assignment.indexOf(id)];expect(frame(p).rotation).toEqual(axisAngle([0,0,1],angle));}
 expect(robotBodyIssues(c.build,c.contract)).toEqual([]);expect(constructionIssues(c.build,photo.stock,24)).toEqual([]);
});
it('replaces missing whole forearm bricks with connected plate laminations while preserving the same target',()=>{
 const stock:Record<string,number>={...photo.stock};for(const id of Object.keys(stock))if(id.startsWith('brick-1x4-'))delete stock[id];
 const target=createRobotTarget({...DEFAULT_ROBOT_MODULES,armPose:'reaching'}),before=JSON.stringify(target),cs=solveRobotTarget(stock,target);expect(cs.length).toBeGreaterThan(0);
 for(const c of cs){const ids=c.contract.features!.assignment,parts=c.build.steps.flatMap(s=>s.parts),forearm=parts.filter((_,i)=>ids[i]==='left.forearm');expect(forearm.length).toBeGreaterThan(1);expect(forearm.every(p=>p.partId.startsWith('plate-'))).toBe(true);expect(moduleConnected(forearm)).toBe(true);expect(constructionIssues(c.build,stock,24)).toEqual([]);expect(silhouetteFit(c.build,target,c.contract.roles).issues).toEqual([]);}
 expect(JSON.stringify(target)).toBe(before);
});
it('requires an explicit torso redesign when the shaping parts are missing',()=>{
 const stock:Record<string,number>={...photo.stock};for(const id of Object.keys(stock))if(id.startsWith('slope-'))delete stock[id];
 expect(solveRobotTarget(stock,target)).toEqual([]);
 const next=createRobotTarget({...DEFAULT_ROBOT_MODULES,torsoProfile:'layered',shoulderProfile:'capped'});expect(next.id).not.toBe(target.id);expect(solveRobotTarget(stock,next).length).toBeGreaterThan(0);
});
it('rejects lost hands and pieces moved within a broad arm envelope but outside their feature region',()=>{
 const c=structuredClone(seed),assignment=c.contract.features!.assignment,ps=c.build.steps.flatMap(s=>s.parts),i=assignment.indexOf('left.hand.palm');ps[i].y+=1;
 expect(robotBodyIssues(c.build,c.contract).some(s=>s.startsWith('Compact palm:'))).toBe(true);
 const missing=structuredClone(seed),j=missing.contract.features!.assignment.indexOf('left.hand.knuckle');missing.build.steps.splice(j,1);missing.contract.roles.splice(j,1);missing.contract.features!.assignment.splice(j,1);
 expect(robotBodyIssues(missing.build,missing.contract).some(s=>s.includes('Smooth knuckle: the planned module region'))).toBe(true);
});
it('enforces shaping-face direction even when a coarse bounding-box silhouette is unchanged',()=>{
 const target=createRobotTarget({...DEFAULT_ROBOT_MODULES,shoulderProfile:'beveled',handStyle:'gripper'}),c=structuredClone(solveRobotTarget(photo.stock,target)[0]);
 const i=c.contract.features!.assignment.indexOf('left.shoulder.cap'),p=c.build.steps.flatMap(s=>s.parts)[i];p.orientation=axisAngle([0,0,1],90);p.rot=0;
 expect(silhouetteFit(c.build,target,c.contract.roles).issues).toEqual([]);
 expect(robotBodyIssues(c.build,c.contract)).toContain('Outward shoulder bevel: shaping face points the wrong way.');
});
it('does not relabel failed richer modules as a successful legacy block robot',()=>{
 const before=JSON.stringify(target),stock={'brick-1x2-reddish-brown':100},diagnostics:string[]=[];
 expect(solveRobotTarget(stock,target,diagnostics)).toEqual([]);expect(diagnostics.some(d=>d.includes('Missing a construction'))).toBe(true);expect(JSON.stringify(target)).toBe(before);
});
it('compares the visible sloping chest profile rather than treating a brick and slope as the same box',()=>{
 const c=structuredClone(seed),i=c.contract.features!.assignment.indexOf('chest.face'),p=c.build.steps.flatMap(s=>s.parts)[i],before=frame(p).bounds;
 p.partId='brick-2x2-medium-blue';expect(frame(p).bounds).toEqual(before);
 expect(silhouetteFit(c.build,target,c.contract.roles).roles.torso).toBeLessThan(1);
 expect(robotBodyIssues(c.build,c.contract).some(s=>s.includes('required shaping technique'))).toBe(true);
});
it('keeps palms smaller than the forearms and uses matching head casing constructions',()=>{
 const f=seed.contract.features!,ps=seed.build.steps.flatMap(s=>s.parts);
 const colorParts=(id:string)=>ps.filter((_,i)=>f.assignment[i]===id).map(p=>p.partId).sort();
 expect(colorParts('head.base')).toEqual(colorParts('head.roof'));
 const z=(id:string)=>f.zones.find(z=>z.id===id)!;
 expect(z('left.hand.palm').h+z('left.hand.knuckle').h).toBeLessThan(z('left.forearm').h);
 expect(z('left.knee').y).toBe(z('left.shin').y);expect(z('left.knee').y).toBe(z('left.thigh').y);
});
