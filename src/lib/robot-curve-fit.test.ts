import {beforeAll,expect,it} from 'vitest';
import {type Placed} from './bricks';
import {compileConnections,connectionPairs,frame} from './connections';
import {constructionIssues} from './construction';
import {robotBodyIssues,solveRobotTarget,type RobotCandidate} from './robot-body-plan';
import {DEFAULT_ROBOT_MODULES,robotModuleZones} from './robot-module-shapes';
import {createRobotTarget,silhouetteFit} from './robot-silhouette';
import photo from '../../test/fixtures/photo-stock.json';

const target=createRobotTarget(DEFAULT_ROBOT_MODULES);
let seed:RobotCandidate;
beforeAll(()=>{
 const diagnostics:string[]=[],solutions=solveRobotTarget(photo.stock,target,diagnostics);
 expect(solutions.length,diagnostics.join('\n')).toBeGreaterThan(0);
 seed=solutions[0];
});

it('gives both real 50950 crowns three-plate regions and lower-row helmet mounts',()=>{
 const crowns=robotModuleZones(DEFAULT_ROBOT_MODULES).filter(z=>z.id.startsWith('head.crown.'));
 expect(crowns).toHaveLength(2);expect(crowns.every(z=>z.h===3&&z.w===1&&z.d===3)).toBe(true);
 const parts=seed.build.steps.flatMap(s=>s.parts),assignment=seed.contract.features!.assignment;
 for(const crown of crowns){
  const i=assignment.indexOf(crown.id),f=frame(parts[i]);
  expect(parts[i].partId).toMatch(/^curve-1x3-/);expect(f.bounds.max[2]-f.bounds.min[2]).toBe(24);
  const mounts=parts.flatMap((p,j)=>j===i?[]:connectionPairs(frame(p),f).map(([,grip])=>grip));
  expect(mounts).toContain('grip:0:0');expect(mounts).toContain('grip:0:1');expect(mounts).not.toContain('grip:0:2');
 }
 expect(robotBodyIssues(seed.build,seed.contract)).toEqual([]);
 expect(constructionIssues(seed.build,photo.stock,24)).toEqual([]);
 expect(silhouetteFit(seed.build,target,seed.contract.roles).issues).toEqual([]);
});

it('keeps the raised rear socket off a flat stud and supports its actual one-plate landing',()=>{
 const curve:Placed={partId:'curve-1x3-white',x:0,y:0,z:1,rot:0};
 const rear:Placed={partId:'plate-1x1-white',x:0,y:2,z:0,rot:0};
 expect(connectionPairs(frame(rear),frame(curve))).toEqual([]);
 expect(connectionPairs(frame({...rear,z:1}),frame(curve))).toContainEqual(['stud:0:0','grip:0:2']);
 const stock={'plate-1x1-white':1,'curve-1x3-white':1};
 const build=compileConnections({name:'Raised rear socket',description:'Exact stepped socket interface.',operations:[
  {partId:'plate-1x1-white',parent:-1,parentPort:'',childPort:'',twist:0},
  {partId:'curve-1x3-white',parent:0,parentPort:'stud:0:0',childPort:'grip:0:2',twist:0},
 ]},stock);
 expect(constructionIssues(build,stock,24)).toEqual([]);
 expect(build.steps[1].parts[0].z).toBe(0);
});

it('counts a complete nominal crown region despite its deliberate curve and underside cutouts',()=>{
 const assignment=seed.contract.features!.assignment,parts=seed.build.steps.flatMap(s=>s.parts);
 for(const id of ['head.crown.left','head.crown.right']){
  const f=frame(parts[assignment.indexOf(id)]),boxVolume=(b:typeof f.bounds)=>[0,1,2].reduce((v,a)=>v*(b.max[a]-b.min[a]),1);
  // Convex-section AABBs are not the allocator's nominal rectangular cell cost.
  expect(f.solids.reduce((v,s)=>v+boxVolume(s.bounds),0)).not.toBe(boxVolume(f.bounds));
 }
 expect(robotBodyIssues(seed.build,seed.contract)).toEqual([]);
});

it('still rejects a missing crown, an out-of-region crown and the wrong shaping type',()=>{
 const missing=structuredClone(seed),i=missing.contract.features!.assignment.indexOf('head.crown.left');
 missing.build.steps.splice(i,1);missing.contract.roles.splice(i,1);missing.contract.features!.assignment.splice(i,1);
 expect(robotBodyIssues(missing.build,missing.contract)).toContain('Left curved crown: the planned module region is not completely filled.');
 const outside=structuredClone(seed);outside.build.steps[i].parts[0].z+=1;
 expect(robotBodyIssues(outside.build,outside.contract).some(s=>s.includes('Left curved crown:')&&s.includes('chosen region'))).toBe(true);
 const wrong=structuredClone(seed);wrong.build.steps[i].parts[0].partId='brick-1x3-white';
 expect(robotBodyIssues(wrong.build,wrong.contract)).toContain(`Left curved crown: part ${i+1} loses its required shaping technique.`);
});

it('rejects overlapping nominal envelopes even when their summed volume conceals a gap',()=>{
 const c=structuredClone(seed),features=c.contract.features!,parts=c.build.steps.flatMap(s=>s.parts),zone=features.zones.find(z=>z.id==='head.back')!;
 const x=zone.x+parts[0].x,y=zone.y+parts[0].y;
 const retained=c.build.steps.flatMap((step,i)=>features.assignment[i]==='head.back'?[]:[{step,role:c.contract.roles[i],zone:features.assignment[i]}]);
 const replacement=[[0,0],[0,0],[1,0],[1,1]].map(([dx,dy])=>({step:{caption:'Invalid duplicate used to conceal an empty cell.',parts:[{partId:'brick-1x1-white',x:x+dx,y:y+dy,z:zone.z,rot:0}]},role:'head' as const,zone:'head.back'}));
 const entries=[...retained,...replacement];
 c.build.steps=entries.map(e=>e.step);c.contract.roles=entries.map(e=>e.role);features.assignment=entries.map(e=>e.zone);
 const issues=robotBodyIssues(c.build,c.contract);
 expect(issues).toContain('Helmet casing: nominal part envelopes overlap instead of tiling the module region.');
 expect(issues).not.toContain('Helmet casing: the planned module region is not completely filled.');
 expect(constructionIssues(c.build,{'brick-1x1-white':4},24).some(i=>i.kind==='overlap')).toBe(true);
});
