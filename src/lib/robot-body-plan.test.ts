import {expect,it} from 'vitest';
import {robotBodyCandidates,robotBodyIssues,robotSilhouette,robotRequest,type RobotCandidate} from './robot-body-plan';
import {constructionIssues} from './construction';
import {fitConnectionProgram} from './connection-fit';
import {buildCounts} from './library';
import {frame,compileConnections} from './connections';
import {parsePartId} from './bricks';
import photo from '../../test/fixtures/photo-stock.json';
const candidates=robotBodyCandidates(photo.stock),seed=candidates[0];
const clone=()=>structuredClone(seed);
function allowMovement(c:RobotCandidate){for(const b of Object.values(c.contract.envelopes)){b.min=b.min.map(v=>v-1000) as typeof b.min;b.max=b.max.map(v=>v+1000) as typeof b.max;}}
it('compiles different complete robot proportions from the unchanged photo stock',()=>{
 const before=JSON.stringify(photo.stock);expect(candidates.length).toBeGreaterThan(1);
 expect(new Set(candidates.map(c=>c.proportions.legHeight)).size).toBe(2);
 expect(new Set(candidates.map(c=>c.proportions.torsoHeight)).size).toBe(2);
 expect(new Set(candidates.map(c=>c.proportions.chest)).size).toBe(2);
 for(const c of candidates){
  expect(robotBodyIssues(c.build,c.contract)).toEqual([]);expect(constructionIssues(c.build,photo.stock,24)).toEqual([]);
  expect(c.program.operations.length).toBeGreaterThanOrEqual(20);
  for(const [id,n]of Object.entries(buildCounts(c.build)))expect(n).toBeLessThanOrEqual(photo.stock[id as keyof typeof photo.stock]);
  const floor=c.build.steps.flatMap(s=>s.parts).flatMap((p,i)=>frame(p).bounds.min[2]===0?[c.contract.roles[i]]:[]);
  expect(new Set(floor)).toEqual(new Set(['leftFoot','rightFoot']));
 }
 expect(JSON.stringify(photo.stock)).toBe(before);
});
it('substitutes a complete chest module when the shaping part is unavailable',()=>{
 const stock:Record<string,number>={...photo.stock};for(const id of Object.keys(stock))if(id.startsWith('slope-'))stock[id]=0;
 const options=robotBodyCandidates(stock);expect(options.length).toBeGreaterThan(0);
 expect(options.every(c=>c.proportions.chest==='plain')).toBe(true);
 expect(robotBodyCandidates({})).toEqual([]);
});
it('rejects off-center heads independently of collision validity and envelopes',()=>{
 const c=clone();allowMovement(c);c.build.steps.flatMap(s=>s.parts).forEach((p,i)=>{if(c.contract.roles[i]==='head')p.x+=1;});
 expect(robotBodyIssues(c.build,c.contract)).toContain('head must stay centered over the hips.');
});
it('requires each leg to connect to the hip, not just somewhere in the global graph',()=>{
 const c=clone();allowMovement(c);const ps=c.build.steps.flatMap(s=>s.parts);
 // Keep the geometry/connector graph intact but remove the semantic right-leg to hip path.
 const top=Math.max(...ps.flatMap((p,i)=>c.contract.roles[i]==='rightLeg'?[p.z]:[]));
 c.contract.roles.forEach((r,i)=>{if(r==='rightLeg'&&ps[i].z===top)c.contract.roles[i]='hips';});
 expect(constructionIssues(c.build,photo.stock,24)).toEqual([]);
 expect(robotBodyIssues(c.build,c.contract).some(i=>i.includes('matching proportions')||i.includes('hips must be one'))).toBe(true);
 // Move the entire leg down while preserving the declared roomy envelope.
 const d=clone();allowMovement(d);d.build.steps.flatMap(s=>s.parts).forEach((p,i)=>{if(d.contract.roles[i]==='rightLeg')p.z-=1;});
 expect(robotBodyIssues(d.build,d.contract)).toContain('rightLeg must connect directly to hips.');
});
it('rejects unequal limb colors, missing role assignments, and separated module pieces',()=>{
 const c=clone(),ps=c.build.steps.flatMap(s=>s.parts),index=c.contract.roles.indexOf('rightArm');
 ps[index].partId=ps[index].partId.replace(parsePartId(ps[index].partId)!.color,'yellow');
 expect(robotBodyIssues(c.build,c.contract)).toContain('leftArm and rightArm must use the same palette.');
 c.contract.roles.pop();expect(robotBodyIssues(c.build,c.contract)).toEqual(['Robot role assignment does not match the assembly.']);
 const d=clone();allowMovement(d);d.build.steps.flatMap(s=>s.parts)[d.contract.roles.indexOf('head')].x+=6;
 expect(robotBodyIssues(d.build,d.contract)).toContain('head must be one connected module.');
});
it('constrains every fitting prefix and rejects a forbidden final body without mutating stock',()=>{
 const before=JSON.stringify(seed.program),stock=JSON.stringify(photo.stock);
 const good=fitConnectionProgram(seed.program,photo.stock,{validate:(b,complete)=>robotBodyIssues(b,seed.contract,complete)});
 expect(good.changes).toEqual([]);
 const c=clone();c.contract.envelopes.head.max[0]-=20;
 expect(()=>fitConnectionProgram(c.program,photo.stock,{validate:(b,complete)=>robotBodyIssues(b,c.contract,complete)})).toThrow(/head.*planned space/);
 expect(JSON.stringify(seed.program)).toBe(before);expect(JSON.stringify(photo.stock)).toBe(stock);
});
it('renders a color-free planning copy without altering the allocated build',()=>{
 const before=JSON.stringify(seed.build),gray=robotSilhouette(seed.build);
 expect(gray.steps.flatMap(s=>s.parts).every(p=>parsePartId(p.partId)?.color==='light-gray')).toBe(true);
 expect(gray.steps.flatMap(s=>s.parts).map(p=>frame(p).bounds)).toEqual(seed.build.steps.flatMap(s=>s.parts).map(p=>frame(p).bounds));
 expect(JSON.stringify(seed.build)).toBe(before);
});

it('keeps the plan constraints in three dimensions and permits real quarter-turned root feet',()=>{
 expect(seed.program.rootRotation).toBe(90);
 expect(()=>compileConnections({...seed.program,rootRotation:45},photo.stock)).toThrow(/quarter turn/);
 const c=clone();allowMovement(c);c.build.steps.flatMap(s=>s.parts).forEach((p,i)=>{if(c.contract.roles[i]==='leftLeg'||c.contract.roles[i]==='rightLeg')p.y+=1;});
 expect(robotBodyIssues(c.build,c.contract)).toContain('Legs must support the torso depth and stay centered beneath it.');
 expect(robotRequest('Survey robot')).toBe(true);expect(robotRequest('Robot dog')).toBe(false);expect(robotRequest('Robot car')).toBe(false);
});
