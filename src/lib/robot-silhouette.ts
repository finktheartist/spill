import { frame, type Box, type V3 } from './connections';
import type { Build } from './bricks';
import type { RobotContract, RobotRole } from './robot-body-plan';
import { robotModuleSpec, robotModuleZones, zoneBox, type RobotModuleSpec, type RobotZone } from './robot-module-shapes';
import {partContours,targetZoneContours} from './robot-contours';

/** A design target contains dimensions and volumes only. No parts or stock are accepted here. */
export interface RobotShape {
 legHeight:number; torsoHeight:number; armHeight:number; stance:number; depth:number; headWidth:number; chest:'sloped'|'plain';modules?:RobotModuleSpec;
}
export interface RobotTarget {version:1|2;id:string;shape:RobotShape;volumes:Record<RobotRole,Box[]>;bounds:Box;zones?:RobotZone[]}
export interface SilhouetteFit {targetId:string;front:number;side:number;roles:Record<RobotRole,number>;issues:string[]}
export const DEFAULT_ROBOT_SHAPE:RobotShape={legHeight:9,torsoHeight:6,armHeight:6,stance:2,depth:2,headWidth:2,chest:'sloped'};
export const ROBOT_SHAPE_SCHEMA={type:'OBJECT',required:['legHeight','torsoHeight','armHeight','stance','depth','headWidth','chest','reason'],properties:{
 legHeight:{type:'INTEGER'},torsoHeight:{type:'INTEGER'},armHeight:{type:'INTEGER'},stance:{type:'INTEGER'},depth:{type:'INTEGER'},headWidth:{type:'INTEGER'},chest:{type:'STRING'},reason:{type:'STRING'},
}};
export const ROBOT_SHAPE_BRIEF=`Design the robot's SHAPE FIRST. No candidate builds exist yet. Return dimensions, never a candidateId, part placements or a parts list.
A shape is described by legHeight (6, 9 or 12 plate units), torsoHeight (6, 9 or 12 plates), armHeight (3, 6 or 9 plates), stance (2 or 4 studs of open space between the legs), depth (2 or 3 studs), headWidth (2 or 4 studs), and chest (sloped or plain). Choose arm and leg lengths in proportion to the torso; legHeight/torsoHeight must be 0.6–1.8 and armHeight at most torsoHeight+3.
The silhouette has paired 2-stud-wide legs and feet, a 4-stud-wide torso, a short recessed waist, a centered visor head and substantial shoulders. Foot depth is depth+1. Arms are 1 stud wide. Shoulders extend one stud past each hip side and carry both arms. Head height is 5 plates. All dimensions are desired design volumes; these do NOT describe prebuilt LEGO candidates.
Choose purposeful proportions for the requested subject. Longer legs or a longer torso are available, not automatically better. Account for likely stock limits, but establish the target before any piece allocation. Give a short reason describing the intended outline.`;

function shape(raw:unknown):RobotShape {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Provide a robot silhouette specification.');
 const p=raw as Record<string,unknown>;
 for(const [key,allowed]of Object.entries({legHeight:[6,9,12],torsoHeight:[6,9,12],armHeight:[3,6,9],stance:[2,4],depth:[2,3],headWidth:[2,4]}))if(!allowed.includes(p[key] as number))throw Error(`Silhouette ${key} must be one of ${allowed.join(', ')}.`);
 if(p.chest!=='sloped'&&p.chest!=='plain')throw Error('Silhouette chest must be sloped or plain.');
 const s={legHeight:p.legHeight,torsoHeight:p.torsoHeight,armHeight:p.armHeight,stance:p.stance,depth:p.depth,headWidth:p.headWidth,chest:p.chest} as RobotShape;
 if(s.legHeight/s.torsoHeight<.6||s.legHeight/s.torsoHeight>1.8||s.armHeight>s.torsoHeight+3)throw Error('Silhouette limb and torso lengths are out of proportion.');
 return s;
}
export function unionBounds(boxes:Box[]):Box{return {min:[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]))) as V3,max:[0,1,2].map(i=>Math.max(...boxes.map(b=>b.max[i]))) as V3};}
const volume=(x:number,y:number,z:number,w:number,d:number,h:number):Box=>({min:[20*x,20*y,8*z],max:[20*(x+w),20*(y+d),8*(z+h)]});
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function createRobotTarget(raw:unknown):RobotTarget {
 const p=raw as Record<string,unknown>|null;
 if(p&&typeof p==='object'&&('modules' in p||'torsoProfile' in p)){
  const modules=robotModuleSpec(p.modules??p),zones=robotModuleZones(modules);
  const s:RobotShape={legHeight:modules.legHeight,torsoHeight:8,armHeight:modules.handStyle==='gripper'?13:10,stance:2,depth:3,headWidth:modules.headStyle==='sensor'?4:2,chest:modules.torsoProfile==='tapered'?'sloped':'plain',modules};
  const volumes=Object.fromEntries([...new Set(zones.map(z=>z.role))].map(role=>[role,zones.filter(z=>z.role===role).map(zoneBox)])) as Record<RobotRole,Box[]>;
  const arm=unionBounds(volumes.leftArm),head=unionBounds(volumes.head),torso=unionBounds(volumes.torso);
  s.armHeight=(arm.max[2]-arm.min[2])/8;s.headWidth=(head.max[0]-head.min[0])/20;s.depth=(torso.max[1]-torso.min[1])/20;
  return freeze({version:2,id:`robot-modules-v2-r6-${Object.values(modules).join('-')}`,shape:s,zones,volumes,bounds:unionBounds(Object.values(volumes).flat())});
 }
 const s=shape(raw),span=4+s.stance,cx=span/2,hip=1+s.legHeight,body=hip+5,shoulder=body+s.torsoHeight;
 const foot=(x:number)=>[volume(x,0,0,2,s.depth+1,1),volume(x,0,1,2,1,1)];
 const volumes:Record<RobotRole,Box[]>={
  leftFoot:foot(0),rightFoot:foot(span-2),leftLeg:[volume(0,1,1,2,s.depth,s.legHeight)],rightLeg:[volume(span-2,1,1,2,s.depth,s.legHeight)],
  hips:[volume(0,1,hip,span,s.depth,4)],waist:[volume(cx-1,1,hip+4,2,s.depth,1)],torso:[volume(cx-2,1,body,4,s.depth,s.torsoHeight)],
  shoulders:[volume(-1,s.depth,shoulder,span+2,1,3),volume(0,1,shoulder,span,s.depth-1,3),volume(-1,1,shoulder+3,span+2,s.depth,1)],
  leftArm:[volume(-1,1,shoulder-s.armHeight,1,s.depth,s.armHeight)],rightArm:[volume(span,1,shoulder-s.armHeight,1,s.depth,s.armHeight)],
  neck:[volume(cx-1,s.depth,shoulder+4,2,1,1)],head:[volume(cx-s.headWidth/2,1,shoulder+5,s.headWidth,s.depth,5)],
 };
 return freeze({version:1,id:`robot-outline-v1-${Object.values(s).join('-')}`,shape:s,volumes,bounds:unionBounds(Object.values(volumes).flat())});
}
/** Target envelopes are fixed BEFORE allocation; they are never inferred from the finished build. */
export function targetContract(target:RobotTarget,roles:RobotRole[],assignment?:string[]):RobotContract {
 const dx=-target.bounds.min[0],dy=-target.bounds.min[1];
 const move=(b:Box):Box=>({min:[b.min[0]+dx,b.min[1]+dy,b.min[2]],max:[b.max[0]+dx,b.max[1]+dy,b.max[2]]});
 if(target.version===2&&(!assignment||assignment.length!==roles.length))throw Error('Module targets require a region assignment for every piece.');
 return {family:'robot',roles:[...roles],anchor:[dx,dy],envelopes:Object.fromEntries(Object.entries(target.volumes).map(([r,v])=>[r,move(unionBounds(v))])) as Record<RobotRole,Box>,...(target.version===2?{features:{zones:target.zones!,assignment:[...assignment!]}}:{})};
}
// Coarse body-volume projections, excluding studs; 4 LDU pixels, shared origin and scale.
// Collision proxies conservatively enclose slopes/curves. This is outline fidelity, not craft scoring.
function mask(boxes:Box[],axis:0|1,resolution=4):Set<string>{
 const result=new Set<string>();
 for(const b of boxes)for(let x=Math.floor(b.min[axis]/resolution);x<Math.ceil(b.max[axis]/resolution);x++)for(let z=Math.floor(b.min[2]/resolution);z<Math.ceil(b.max[2]/resolution);z++)result.add(`${x}:${z}`);
 return result;
}
const overlap=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const key of a)if(b.has(key))shared++;return shared/(a.size+b.size-shared||1);};
/** Measures shaping visible on the combined outline. A slope hidden behind a
 * rectangular backing contributes nothing. This is a geometry gate, not a taste score. */
export function exteriorContour(target:RobotTarget):{front:number;side:number;frontEdge:number;sideEdge:number;roles:string[];issues:string[]}{
 const boxes=Object.values(target.volumes).flat(),profiles=target.zones?.flatMap(targetZoneContours)??boxes;
 const roles=new Set<string>();
 const exposed=(axis:0|1)=>{const full=mask(boxes,axis,1),shaped=mask(profiles,axis,1),removed=new Set([...full].filter(c=>!shaped.has(c)));let edges=0;
  for(const c of shaped){const [x,z]=c.split(':').map(Number);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])if(removed.has(`${x+dx}:${z+dz}`))edges++;}
  for(const zone of target.zones??[]){const region=mask([zoneBox(zone)],axis,1),contour=mask(targetZoneContours(zone),axis,1);if([...region].some(c=>!contour.has(c)&&removed.has(c)))roles.add(zone.role);}
  return {area:removed.size/(full.size||1),edge:edges};};
 const front=exposed(0),side=exposed(1),issues:string[]=[];
 // Boundary exposure is the relevant quantity: a long gentle curve removes
 // little area. Three shaped roles prevent tiny shoulder wedges doing all the work.
 if(front.edge<60)issues.push('Front outline needs at least three studs of exposed shaped edge; use angled shoulders and sculpted hips.');
 if(side.edge<40)issues.push('Side outline needs at least two studs of exposed shaped edge; use a curved head and undercut torso with no backing hiding them.');
 if(roles.size<3)issues.push('Exterior shaping must remain visible in at least three body regions; interior decoration does not count.');
 return {front:front.area,side:side.area,frontEdge:front.edge,sideEdge:side.edge,roles:[...roles].sort(),issues};
}
export function silhouetteFit(build:Build,target:RobotTarget,roles:RobotRole[]):SilhouetteFit {
 const parts=build.steps.flatMap(s=>s.parts),issues:string[]=[];
 if(!parts.length||parts.length!==roles.length)return {targetId:target.id,front:0,side:0,roles:{} as Record<RobotRole,number>,issues:['The target role assignment does not match the build.']};
 const dx=parts[0].x*20,dy=parts[0].y*20;
 const actual=parts.map(p=>(target.version===2?partContours(p):frame(p).solids.map(s=>s.bounds)).map(b=>({min:[b.min[0]-dx,b.min[1]-dy,b.min[2]] as V3,max:[b.max[0]-dx,b.max[1]-dy,b.max[2]] as V3})));
 const score=(a:Box[],b:Box[],axis:0|1)=>overlap(mask(a,axis),mask(b,axis));
 const expected=target.version===2?Object.fromEntries(Object.keys(target.volumes).map(role=>[role,target.zones!.filter(z=>z.role===role).flatMap(targetZoneContours)])):target.volumes;
 const desired=Object.values(expected).flat(),all=actual.flat(),front=score(desired,all,0),side=score(desired,all,1);
 const roleScores=Object.fromEntries(Object.entries(expected).map(([role,boxes])=>{const boxesActual=actual.flatMap((v,i)=>roles[i]===role?v:[]);return [role,Math.min(score(boxes,boxesActual,0),score(boxes,boxesActual,1))];})) as Record<RobotRole,number>;
 if(front<.95)issues.push(`Front outline matches only ${Math.round(front*100)}% of the frozen target (95% required).`);
 if(side<.95)issues.push(`Side outline matches only ${Math.round(side*100)}% of the frozen target (95% required).`);
 for(const [role,fit]of Object.entries(roleScores))if(fit<.90)issues.push(`${role} matches only ${Math.round(fit*100)}% of its target outline (90% required).`);
 return {targetId:target.id,front,side,roles:roleScores,issues};
}
