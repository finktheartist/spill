import type { PartType } from './bricks';
import type { Box } from './connections';
import type { RobotRole } from './robot-body-plan';

export const ROBOT_MODULE_OPTIONS={legHeight:[7,10],torsoProfile:['undercut','tapered','layered'],shoulderProfile:['angled','stepped','capped','beveled'],armPose:['bent','reaching'],handStyle:['palm','gripper'],footStyle:['boot','runner'],headStyle:['curved','visor','sensor']} as const;
export interface RobotModuleSpec {
 legHeight:7|10;torsoProfile:'undercut'|'tapered'|'layered';shoulderProfile:'angled'|'stepped'|'capped'|'beveled';armPose:'bent'|'reaching';handStyle:'palm'|'gripper';footStyle:'boot'|'runner';headStyle:'curved'|'visor'|'sensor';
}
export const DEFAULT_ROBOT_MODULES:RobotModuleSpec={legHeight:7,torsoProfile:'undercut',shoulderProfile:'angled',armPose:'bent',handStyle:'palm',footStyle:'boot',headStyle:'curved'};
export type RobotMaterial='shell'|'frame'|'joint'|'accent'|'visor';
/** Desired construction regions. No part identifiers, stock or assembled candidates. */
export interface RobotZone {
 id:string;role:RobotRole;feature:string;pair?:string;mirror?:boolean;
 x:number;y:number;z:number;w:number;d:number;h:number;material:RobotMaterial;types:PartType[];rotations?:number[];connected?:boolean;
 profile?:'ramp'|'undercut'|'curve'|'chamfer';
}
export const ROBOT_MODULE_SCHEMA={type:'OBJECT',required:[...Object.keys(ROBOT_MODULE_OPTIONS),'reason'],properties:{
 ...Object.fromEntries(Object.entries(ROBOT_MODULE_OPTIONS).map(([k,v])=>[k,{type:k==='legHeight'?'INTEGER':'STRING',...(k==='legHeight'?{}:{enum:[...v]})}])),reason:{type:'STRING'},
}};
export const ROBOT_MODULE_BRIEF=`Design a robot's EXTERIOR shape before part allocation. No built candidates exist yet.
Return legHeight (7 or 10 plates), torsoProfile (undercut, tapered or layered), shoulderProfile (angled, stepped, capped or beveled), armPose (bent or reaching), handStyle (palm or gripper), footStyle (boot or runner), headStyle (curved, visor or sensor), and a reason.
The combined outline must contain exposed shaped edges in BOTH views, across at least three body regions. Interior slopes hidden behind rectangular body masses do not count. Prefer undercut + angled + curved: their shaping changes the outer boundary. Old stepped/flat combinations remain for manual exploration but generally fail this exterior gate.
Undercut: sloping hip sides, an inverted-slope belly, a narrower collar and chest chamfers. Requires two 1x2 slopes, one inverted 2x2 slope and two cheese slopes. Tapered: central front chest slope but otherwise rectangular body; layered: stepped rectangular chest. Both are less expressive externally.
Angled shoulders: two outward 2x2 slopes above a substantial rear connection, with longer upper arms putting the hands near the waist. Shoulder and hip shell shapes mirror but colors may differ when matching pairs are unavailable. Stepped/capped/beveled shoulders retain rectangular shoulder blocks; bevels add small cheese corners.
Curved head: compact centered visor and two parallel curved crown strips, each a 1x3 curved slope, 3 plates tall. Both curves face forward to form one rounded helmet profile. Their two lower socket rows mount on the visor/casing; the rear socket row is one plate higher and is not a flat-bottom connection. The two crown strips may differ in color. Visor heads are 2 studs wide with a flat roof; sensor heads are broader and rectangular.
Bent/reaching forearms project 2/3 studs forward in a fixed pose, without working hinges. Palm hands use compact plates; grippers use two separated fingers and a bridge and can be bulky; prefer compact palms for these proportions. Boots/runners have 2x3/2x4 soles, narrow heels and smooth toes. Legs have aligned knee bands and remain upright.
Respect the exact stock, including shaping types. Colors can differ between shells, while arms, feet and legs retain mirrored constructions. Never invent missing slopes, curves or connection hardware. A target change must be explicit; the solver cannot replace a mandatory curve with a rectangular block.`;
export function robotModuleSpec(raw:unknown):RobotModuleSpec {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Provide robot module choices.');
 const p=raw as Record<string,unknown>;
 for(const [k,options]of Object.entries(ROBOT_MODULE_OPTIONS))if(!(options as readonly unknown[]).includes(p[k]))throw Error(`Robot module ${k} must be ${options.join(' or ')}.`);
 return Object.fromEntries(Object.keys(ROBOT_MODULE_OPTIONS).map(k=>[k,p[k]])) as unknown as RobotModuleSpec;
}
export const zoneBox=(r:RobotZone):Box=>({min:[r.x*20,r.y*20,r.z*8],max:[(r.x+r.w)*20,(r.y+r.d)*20,(r.z+r.h)*8]});

/** Interfaces are fixed in stud/plate space; shape choices alter the volumes inside them. */
export function robotModuleZones(s:RobotModuleSpec):RobotZone[]{
 const zones:RobotZone[]=[],dy=s.footStyle==='runner'?1:0;
 const add=(id:string,role:RobotRole,feature:string,x:number,y:number,z:number,w:number,d:number,h:number,material:RobotMaterial,types:PartType[]=['brick','plate'],extra:Partial<RobotZone>={})=>zones.push({id,role,feature,x,y:y+dy,z,w,d,h,material,types,...extra});
 const pair=(id:string,roles:[RobotRole,RobotRole],feature:string,x:number,y:number,z:number,w:number,d:number,h:number,material:RobotMaterial,types:PartType[]=['brick','plate'],extra:Partial<RobotZone>={})=>{
  const connected=['forearm','upperArm','shin','thigh','hand.bridge'].includes(id);
  add('left.'+id,roles[0],feature,x,y,z,w,d,h,material,types,{pair:id,connected,...extra});
  add('right.'+id,roles[1],feature,6-x-w,y,z,w,d,h,material,types,{pair:id,mirror:true,connected,...extra,...(extra.rotations?{rotations:extra.rotations.map(r=>(360-r)%360)}:{})});
 };
 const feet:[RobotRole,RobotRole]=['leftFoot','rightFoot'],legs:[RobotRole,RobotRole]=['leftLeg','rightLeg'],arms:[RobotRole,RobotRole]=['leftArm','rightArm'];
 pair('sole',feet,'Sole',0,-dy,0,2,3+dy,1,'frame',['plate']);
 pair('heel',feet,'Narrow raised heel',1,1,1,1,2,1,'joint',['plate']);
 pair('toe',feet,'Smooth toe',0,-dy,1,2,1+dy,1,'accent',['tile']);
 pair('shin',legs,'Shin',1,1,2,1,2,3,'frame');
 pair('knee',legs,'Aligned knee band',1,1,5,1,2,1,'joint',['plate']);
 pair('thigh',legs,'Thigh',1,1,6,1,2,s.legHeight-4,'frame');
 const hip=2+s.legHeight,body=hip+5,shoulder=body+8;
 add('pelvis.base','hips','Pelvis tie',1,1,hip,4,2,1,'shell',['plate']);
 if(s.torsoProfile==='undercut'){
  add('pelvis.left','hips','Angled left hip',1,1,hip+1,2,1,3,'shell',['slope'],{rotations:[270],profile:'ramp'});
  add('pelvis.right','hips','Angled right hip',3,1,hip+1,2,1,3,'shell',['slope'],{rotations:[90],profile:'ramp'});
  add('pelvis.back','hips','Recessed hip support',2,2,hip+1,2,1,3,'shell');
 }else add('pelvis.core','hips','Narrow pelvis',1,1,hip+1,4,2,3,'shell');
 add('waist','waist','Recessed waist',2,1,hip+4,2,2,1,'joint',['plate']);
 if(s.torsoProfile==='undercut'){
  add('abdomen','torso','Undercut belly',2,0,body,2,2,3,'shell',['invslope'],{rotations:[0],profile:'undercut'});
  add('chest.tie','torso','Chest above the undercut',1,0,body+3,4,2,3,'shell');
  add('chest.collar','torso','Narrow upper chest',2,0,body+6,2,2,2,'shell',['plate']);
  pair('chest.chamfer',['torso','torso'],'Exposed chest chamfer',1,0,body+6,1,1,2,'accent',['cheese'],{rotations:[270],profile:'chamfer'});
 }else{
 add('abdomen','torso','Recessed abdomen',2,1,body,2,2,1,'joint',['plate']);
 add('chest.tie','torso','Widening chest',1,1,body+1,4,2,3,'shell');
 if(s.torsoProfile==='tapered'){
  add('chest.face','torso','Sloping breastplate',2,0,body+4,2,2,3,'accent',['slope'],{rotations:[0]});
  pair('chest.side',['torso','torso'],'Recessed chest side armor',1,1,body+4,1,2,3,'shell');
  add('chest.back','torso','Chest rear wall',2,2,body+4,2,1,3,'shell');
  add('chest.cap','torso','Collar tie',1,1,body+7,4,2,1,'shell',['plate']);
 }else{
  add('chest.core','torso','Layered chest',1,1,body+4,4,2,3,'shell');
  add('chest.face','torso','Projecting breastplate',2,0,body+7,2,2,1,'accent',['tile']);
  pair('chest.side',['torso','torso'],'Collar sides',1,1,body+7,1,2,1,'shell',['plate']);
  add('chest.back','torso','Rear collar',2,2,body+7,2,1,1,'shell',['plate']);
 }
 }
 if(s.shoulderProfile==='angled'){
  add('shoulders.tie','shoulders','Shoulder core',-1,1,shoulder,8,1,3,'frame',['brick','plate'],{connected:true});
  add('left.shoulder.pad','shoulders','Sloping left shoulder',-1,1,shoulder+3,2,2,3,'accent',['slope'],{rotations:[270],profile:'ramp'});
  add('right.shoulder.pad','shoulders','Sloping right shoulder',5,1,shoulder+3,2,2,3,'accent',['slope'],{rotations:[90],profile:'ramp'});
 }else{
 add('shoulders.tie','shoulders','Recessed shoulder tie',0,2,shoulder,6,1,3,'shell');
 pair('shoulder.pad',['shoulders','shoulders'],'Separate shoulder pad',-1,1,shoulder+3,2,2,1,'accent',s.shoulderProfile==='capped'?['tile']:['plate'],{connected:s.shoulderProfile!=='stepped'});
 if(s.shoulderProfile==='stepped')pair('shoulder.cap',['shoulders','shoulders'],'Narrow shoulder cap',0,1,shoulder+4,1,2,1,'shell',['tile']);
 if(s.shoulderProfile==='beveled')pair('shoulder.cap',['shoulders','shoulders'],'Outward shoulder bevel',-1,1,shoulder+4,1,1,2,'accent',['cheese'],{rotations:[270]});
 }
 const armShoulder=shoulder-(s.shoulderProfile==='angled'?6:0),upperHeight=s.shoulderProfile==='angled'?6:3;
 const foreY=s.armPose==='bent'?-1:-2,foreD=s.armPose==='bent'?3:4;
 pair('upperArm',arms,'Upper arm',-1,1,armShoulder,1,2,upperHeight,'frame');
 pair('elbow',arms,'Elbow band',-1,1,armShoulder-1,1,2,1,'joint',['plate']);
 pair('forearm',arms,'Forward forearm',-1,foreY,armShoulder-4,1,foreD,3,'frame');
 if(s.handStyle==='palm'){
  pair('hand.palm',arms,'Compact palm',-2,foreY-1,armShoulder-5,2,2,1,'shell',['plate']);
  pair('hand.knuckle',arms,'Smooth knuckle',-2,foreY-1,armShoulder-4,2,1,1,'accent',['tile']);
 }else{
  pair('hand.outer',arms,'Outer gripper finger',-3,foreY-1,armShoulder-10,1,2,3,'frame');
  pair('hand.inner',arms,'Inner gripper finger',-1,foreY-1,armShoulder-10,1,2,3,'frame');
  pair('hand.bridge',arms,'Gripper palm bridge',-3,foreY,armShoulder-7,3,1,3,'shell');
 }
 const neck=shoulder+3;
 add('neck','neck','Centered neck',2,1,neck,2,s.shoulderProfile==='angled'?1:2,1,'joint',['plate']);
 const head=neck+1;
 if(s.headStyle==='curved'){
  add('head.base','head','Helmet base',2,0,head,2,3,1,'shell',['plate']);
  add('head.visor','head','Dark visor',2,0,head+1,2,1,3,'visor',['brick']);
  add('head.back','head','Helmet casing',2,1,head+1,2,2,3,'shell');
  add('head.crown.left','head','Left curved crown',2,0,head+4,1,3,3,'accent',['curve'],{rotations:[0],profile:'curve'});
  add('head.crown.right','head','Right curved crown',3,0,head+4,1,3,3,'accent',['curve'],{rotations:[0],profile:'curve'});
 }else if(s.headStyle==='visor'){
  add('head.base','head','Head base',2,1,head,2,3,1,'shell',['plate'],{pair:'head.casing'});
  add('head.visor','head','Dark visor',2,1,head+1,2,1,3,'visor',['brick']);
  add('head.back','head','Head casing',2,2,head+1,2,2,3,'shell');
  add('head.roof','head','Head roof',2,1,head+4,2,3,1,'shell',['plate'],{pair:'head.casing'});
 }else{
  add('head.base','head','Sensor head base',1,1,head,4,2,1,'shell',['plate'],{pair:'head.casing'});
  add('head.visor','head','Wide sensor visor',1,1,head+1,4,2,3,'visor',['brick']);
  add('head.roof','head','Sensor housing roof',1,1,head+4,4,2,1,'shell',['plate'],{pair:'head.casing'});
 }
 return zones;
}
