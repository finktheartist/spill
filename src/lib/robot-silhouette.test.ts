import {expect,it} from 'vitest';
import {createRobotTarget,DEFAULT_ROBOT_SHAPE,silhouetteFit,targetContract} from './robot-silhouette';
import {robotBodyIssues,solveRobotTarget} from './robot-body-plan';
import {constructionIssues} from './construction';
import photo from '../../test/fixtures/photo-stock.json';
const target=createRobotTarget(DEFAULT_ROBOT_SHAPE),solutions=solveRobotTarget(photo.stock,target);
it('creates immutable geometry without stock, parts, candidate builds or a derived envelope',()=>{
 expect(Object.isFrozen(target)).toBe(true);expect(Object.isFrozen(target.volumes.head[0].min)).toBe(true);
 expect(target.shape).toEqual(DEFAULT_ROBOT_SHAPE);expect(JSON.stringify(target)).not.toMatch(/partId|operations|steps|inventory|candidate/);
 expect(()=>{target.shape.legHeight=6;}).toThrow();
 const tall=createRobotTarget({...DEFAULT_ROBOT_SHAPE,torsoHeight:12});expect(tall.bounds.max[2]).toBeGreaterThan(target.bounds.max[2]);
 expect(()=>createRobotTarget({...DEFAULT_ROBOT_SHAPE,legHeight:3})).toThrow();expect(()=>createRobotTarget({...DEFAULT_ROBOT_SHAPE,legHeight:12,torsoHeight:6})).toThrow(/proportion/);
});
it('solves different part combinations to the same frozen target and preserves stock',()=>{
 const before=JSON.stringify(photo.stock),shape=JSON.stringify(target);expect(solutions.length).toBeGreaterThan(1);
 for(const c of solutions){
  expect(c.target).toBe(target);expect(c.contract).toEqual(targetContract(target,c.contract.roles));
  expect(constructionIssues(c.build,photo.stock,24)).toEqual([]);expect(robotBodyIssues(c.build,c.contract)).toEqual([]);
  const fit=silhouetteFit(c.build,target,c.contract.roles);expect(fit.issues).toEqual([]);expect(fit.front).toBe(1);expect(fit.side).toBe(1);
 }
 expect(JSON.stringify(photo.stock)).toBe(before);expect(JSON.stringify(target)).toBe(shape);
});
it('fails the target instead of swapping its shape when required shaping pieces are absent',()=>{
 const stock:Record<string,number>={...photo.stock};for(const id of Object.keys(stock))if(id.startsWith('slope-'))stock[id]=0;
 const diagnostics:string[]=[];expect(solveRobotTarget(stock,target,diagnostics)).toEqual([]);expect(diagnostics.length).toBeGreaterThan(0);
 const revised=createRobotTarget({...target.shape,chest:'plain'});expect(revised.id).not.toBe(target.id);expect(solveRobotTarget(stock,revised).length).toBeGreaterThan(0);
});
it('measures both views against the original target rather than refitting the target to changed parts',()=>{
 const c=structuredClone(solutions[0]);c.build.steps.flatMap(s=>s.parts).forEach((p,i)=>{if(c.contract.roles[i]==='head')p.x+=2;});
 expect(silhouetteFit(c.build,target,c.contract.roles).issues.some(i=>i.startsWith('head'))).toBe(true);
 const d=structuredClone(solutions[0]);d.build.steps.flatMap(s=>s.parts).forEach((p,i)=>{if(c.contract.roles[i]==='head')p.y+=2;});
 expect(silhouetteFit(d.build,target,d.contract.roles).side).toBeLessThan(1);
 const shifted=structuredClone(solutions[0]);shifted.build.steps.flatMap(s=>s.parts).forEach(p=>{p.x+=3;p.y+=2;});expect(silhouetteFit(shifted.build,target,shifted.contract.roles).issues).toEqual([]);
});
it('rejects missing parts, malformed role maps and altered target volumes',()=>{
 const c=structuredClone(solutions[0]);c.build.steps.pop();expect(silhouetteFit(c.build,target,c.contract.roles).issues.length).toBeGreaterThan(0);
 const altered=structuredClone(target);altered.volumes.head[0].max[0]+=20;expect(()=>solveRobotTarget(photo.stock,altered)).toThrow(/altered/);
});
it('reserves narrow arm bricks before broader legs and still enforces structural checks',()=>{
 const deeper=createRobotTarget({...DEFAULT_ROBOT_SHAPE,legHeight:6,depth:3}),diagnostics:string[]=[];
 const solutions=solveRobotTarget(photo.stock,deeper,diagnostics);
 expect(diagnostics.length).toBeGreaterThan(0);
 expect(diagnostics.some(d=>d.includes('one connected module'))).toBe(true);
 expect(diagnostics.some(d=>d.includes('coherent paired limb'))).toBe(false);
 for(const c of solutions)expect(robotBodyIssues(c.build,c.contract)).toEqual([]);
});
