import { createRobotTarget, silhouetteFit, targetContract, type RobotTarget } from './robot-silhouette';
import { footprint, heightOf, parsePartId, type Build, type ColorName, type Placed } from './bricks';
import { add, apply, attachmentTwist, compileConnections, connectionPairs, corners, definition, frame, type Box, type ConnectionOperation, type ConnectionProgram } from './connections';
import { allocateRobotModules, moduleConnected } from './robot-module-layout';
import { zoneBox, type RobotZone } from './robot-module-shapes';

export const ROBOT_ROLES = ['leftFoot','rightFoot','leftLeg','rightLeg','hips','waist','torso','shoulders','leftArm','rightArm','neck','head'] as const;
export type RobotRole = typeof ROBOT_ROLES[number];
export interface RobotContract {
  family:'robot'; roles:RobotRole[]; envelopes:Record<RobotRole,Box>; anchor:[number,number];
  features?:{zones:RobotZone[];assignment:string[]};
}
export interface RobotCandidate {
  target:RobotTarget; id:string; label:string; program:ConnectionProgram; build:Build; contract:RobotContract;
  proportions:{legHeight:number;torsoHeight:number;stance:number;chest:string}; palette:string[];
  modules?:{choices:NonNullable<RobotTarget['shape']['modules']>;regions:{id:string;feature:string;parts:number}[]};
}
type Tagged = Placed & {role:RobotRole};
const close=(a:number,b:number,t=.01)=>Math.abs(a-b)<=t;
const extent=(parts:Placed[]):Box=>{
  const boxes=parts.map(p=>frame(p).bounds);
  return {min:[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]))) as Box['min'],max:[0,1,2].map(i=>Math.max(...boxes.map(b=>b.max[i]))) as Box['max']};
};
const center=(b:Box,i:number)=>(b.min[i]+b.max[i])/2;
const size=(b:Box,i:number)=>b.max[i]-b.min[i];

/** Object-level invariants, independent of which part is a program's chosen parent.
 * Actual mating connectors establish both legs' load paths, even with a shared hip.
 * This checks anatomy, not physical strength or center of mass.
 */
export function robotBodyIssues(build:Build,contract:RobotContract,complete=true):string[]{
  const parts=build.steps.flatMap(s=>s.parts),issues:string[]=[];
  if(contract.family!=='robot'||parts.length>contract.roles.length||complete&&parts.length!==contract.roles.length)return ['Robot role assignment does not match the assembly.'];
  if(!parts.length)return ['Robot is empty.'];
  const shift=[parts[0].x*20-contract.anchor[0],parts[0].y*20-contract.anchor[1]];
  const groups=Object.fromEntries(ROBOT_ROLES.map(r=>[r,[] as number[]])) as Record<RobotRole,number[]>;
  parts.forEach((p,i)=>{
    const role=contract.roles[i],e=contract.envelopes[role];
    if(!e){issues.push(`Part ${i+1} has no body role.`);return;}
    groups[role].push(i);const b=frame(p).bounds;
    if([0,1,2].some(a=>b.min[a]-(shift[a]??0)<e.min[a]-.01||b.max[a]-(shift[a]??0)>e.max[a]+.01))issues.push(`${role}: part ${i+1} leaves its planned space.`);
  });
  if(contract.features){
   const {zones,assignment}=contract.features;
   if(assignment.length!==contract.roles.length)return ['Robot module assignment does not match the assembly.'];
   const packed:Record<string,Box[]>={};
   parts.forEach((p,i)=>{
    const zone=zones.find(z=>z.id===assignment[i]),k=parsePartId(p.partId)!;
    if(!zone||zone.role!==contract.roles[i]){issues.push(`Part ${i+1} has no matching module region.`);return;}
    const expected=zoneBox(zone),f=frame(p),offset=[parts[0].x*20,parts[0].y*20,0];
    if([0,1,2].some(a=>f.bounds.min[a]-offset[a]<expected.min[a]-.01||f.bounds.max[a]-offset[a]>expected.max[a]+.01))issues.push(`${zone.feature}: part ${i+1} leaves its chosen region.`);
    if(!zone.types.includes(k.type))issues.push(`${zone.feature}: part ${i+1} loses its required shaping technique.`);
    if(zone.rotations&&!zone.rotations.some(rot=>frame({...p,orientation:undefined,rot}).rotation.every((v,j)=>close(v,f.rotation[j]))))issues.push(`${zone.feature}: shaping face points the wrong way.`);
    // The allocator tiles nominal part envelopes, not the material inside a
    // curved/sloping mold. Convex section AABBs can overlap or leave intentional
    // contour cutouts; summing them is neither packing nor physical volume.
    const points=definition(k).boxes.flatMap(b=>corners(b).map(v=>add(apply(f.rotation,v),f.translation)));
    const nominal:Box={min:[0,1,2].map(a=>Math.min(...points.map(v=>v[a]))) as Box['min'],max:[0,1,2].map(a=>Math.max(...points.map(v=>v[a]))) as Box['max']};
    if([0,1,2].some(a=>nominal.min[a]-offset[a]<expected.min[a]-.01||nominal.max[a]-offset[a]>expected.max[a]+.01))issues.push(`${zone.feature}: part ${i+1}'s nominal envelope leaves its chosen region.`);
    (packed[zone.id]??=[]).push(nominal);
   });
   if(complete)for(const z of zones){
    const boxes=packed[z.id]??[],filled=boxes.reduce((n,b)=>n+[0,1,2].reduce((v,a)=>v*(b.max[a]-b.min[a]),1),0);
    if(boxes.some((b,i)=>boxes.slice(i+1).some(c=>[0,1,2].every(a=>Math.min(b.max[a],c.max[a])-Math.max(b.min[a],c.min[a])>.01))))issues.push(`${z.feature}: nominal part envelopes overlap instead of tiling the module region.`);
    if(!close(filled,z.w*z.d*z.h*20*20*8))issues.push(`${z.feature}: the planned module region is not completely filled.`);
    if(z.connected&&!moduleConnected(parts.filter((_,i)=>assignment[i]===z.id)))issues.push(`${z.feature}: its pieces must form a connected subassembly.`);
   }
  }
  if(!complete)return issues;
  for(const role of ROBOT_ROLES)if(!groups[role].length)issues.push(`Missing ${role}.`);
  if(issues.length)return issues;
  const boxes=Object.fromEntries(ROBOT_ROLES.map(r=>[r,extent(groups[r].map(i=>parts[i]))])) as Record<RobotRole,Box>;
  const frames=parts.map(frame),adjacent=(a:RobotRole,b:RobotRole)=>groups[a].some(i=>groups[b].some(j=>connectionPairs(frames[i],frames[j]).length));
  const links:[RobotRole,RobotRole][]=[['leftFoot','leftLeg'],['rightFoot','rightLeg'],['leftLeg','hips'],['rightLeg','hips'],['hips','waist'],['waist','torso'],['torso','shoulders'],['shoulders','leftArm'],['shoulders','rightArm'],['shoulders','neck'],['neck','head']];
  for(const [a,b]of links)if(!adjacent(a,b))issues.push(`${a} must connect directly to ${b}.`);
  // A disconnected piece cannot borrow another piece's role to appear anatomically attached.
  for(const role of ROBOT_ROLES){const members=groups[role],seen=new Set<number>(),visit=(i:number)=>{if(seen.has(i))return;seen.add(i);for(const j of members)if(connectionPairs(frames[i],frames[j]).length)visit(j);};visit(members[0]);if(seen.size!==members.length)issues.push(`${role} must be one connected module.`);}
  const axis=center(boxes.hips,0);
  for(const r of ['waist','torso','shoulders','neck','head'] as const)if(!close(center(boxes[r],0),axis,5))issues.push(`${r} must stay centered over the hips.`);
  for(const [l,r]of [['leftFoot','rightFoot'],['leftLeg','rightLeg'],['leftArm','rightArm']] as const){
    if(![0,1,2].every(a=>close(size(boxes[l],a),size(boxes[r],a)))||!close(boxes[l].min[2],boxes[r].min[2])||!close(center(boxes[l],1),center(boxes[r],1))||!close(center(boxes[l],0)+center(boxes[r],0),axis*2))issues.push(`${l} and ${r} must have matching proportions and placement.`);
    const colors=(role:RobotRole)=>groups[role].map(i=>parsePartId(parts[i].partId)!.color).sort().join(',');
    if(colors(l)!==colors(r))issues.push(`${l} and ${r} must use the same palette.`);
  }
  if(boxes.rightLeg.min[0]-boxes.leftLeg.max[0]<20-.01)issues.push('Keep a visible gap of at least one stud between the legs.');
  if(boxes.torso.min[0]-boxes.leftArm.max[0]<10||boxes.rightArm.min[0]-boxes.torso.max[0]<10)issues.push('Keep the arms distinct from the torso.');
  if(!close(boxes.leftFoot.min[2],0)||!close(boxes.rightFoot.min[2],0))issues.push('Both feet must reach the ground.');
  if(boxes.head.min[2]<boxes.torso.max[2]||size(boxes.head,0)>size(boxes.torso,0)||size(boxes.head,0)<size(boxes.torso,0)*.4)issues.push('The head must sit above the torso at an appropriate width.');
  // Shaped chests may deliberately project beyond the load-bearing pelvis.
  // Module legs must align with their actual hip interface, not a decorative overhang.
  const supported=contract.features?boxes.hips:boxes.torso;
  if(size(boxes.leftLeg,1)<size(supported,1)*.75||Math.abs(center(boxes.leftLeg,1)-center(supported,1))>5)issues.push(contract.features?'Legs must support the pelvis depth and stay centered beneath it.':'Legs must support the torso depth and stay centered beneath it.');
  const ratio=size(boxes.leftLeg,2)/size(boxes.torso,2);
  if(ratio<.6||ratio>1.8)issues.push('Leg and torso lengths are out of proportion.');
  if(size(boxes.waist,2)>size(boxes.torso,2)*.25)issues.push('Keep the waist short enough to join the torso and pelvis, rather than a thin column.');
  if(size(boxes.shoulders,2)<24)issues.push('Shoulders need substantial connected structure, not a thin exposed bar.');
  if(size(boxes.waist,0)>=size(boxes.torso,0))issues.push('The torso must step inward at the waist.');
  return [...new Set(issues)];
}

/** Exact rectangular layers, with shared stock consumption. Paired layers reserve both sides
 * atomically. Search is bounded; no inventory is fabricated when a tiling cannot be made.
 */
function layer(stock:Record<string,number>,w:number,d:number,h:number,colors:ColorName[],copies:number,types=['brick','plate']):Placed[]|null{
  const options=Object.keys(stock).flatMap(id=>{const k=parsePartId(id);if(!k||!types.includes(k.type)||heightOf(k)!==h||!colors.includes(k.color)||stock[id]<copies)return [];return [0,90].flatMap(rot=>{const f=footprint(k,rot);return f.fw<=w&&f.fd<=d?[{id,rot,...f,color:k.color}]:[];});}).sort((a,b)=>Number(b.fw*b.fd===w*d)-Number(a.fw*a.fd===w*d)||colors.indexOf(a.color)-colors.indexOf(b.color)||b.fw*b.fd-a.fw*a.fd||a.id.localeCompare(b.id));
  let checks=0;const occupied=new Set<number>(),result:Placed[]=[];
  const fill=():boolean=>{
    if(++checks>240)return false;
    let cell=0;while(occupied.has(cell))cell++;if(cell===w*d)return true;
    const x=cell%w,y=Math.floor(cell/w);
    for(const o of options){if(stock[o.id]<copies||x+o.fw>w||y+o.fd>d)continue;
      const cells=Array.from({length:o.fw*o.fd},(_,i)=>(y+Math.floor(i/o.fw))*w+x+i%o.fw);if(cells.some(c=>occupied.has(c)))continue;
      cells.forEach(c=>occupied.add(c));stock[o.id]-=copies;result.push({partId:o.id,x,y,z:0,rot:o.rot});
      if(fill())return true;
      result.pop();stock[o.id]+=copies;cells.forEach(c=>occupied.delete(c));
    }return false;
  };
  return fill()?result:null;
}

/** Compile a semantic layout into real port operations. The second leg is assembled
 * down from the hip, so there is no common plinth falsely joining detached limbs.
 */
function programFromLayout(layout:Tagged[],stock:Record<string,number>,label:string):{program:ConnectionProgram;roles:RobotRole[];order:number[]}{
  const root=layout.findIndex(p=>p.role==='leftFoot'&&p.z===0);
  if(root<0)throw Error('No upright starting foot');
  const order=[root],used=new Set(order),operations:ConnectionOperation[]=[{partId:layout[root].partId,parent:-1,parentPort:'',childPort:'',twist:0}];
  const frames=layout.map(frame);
  while(order.length<layout.length){let found=false;
    for(let j=0;j<layout.length&&!found;j++){if(used.has(j))continue;
      for(let parent=0;parent<order.length&&!found;parent++)for(const [parentPort,childPort]of connectionPairs(frames[order[parent]],frames[j])){
        const twist=attachmentTwist(layout[order[parent]],parentPort,layout[j],childPort);
        if(twist!==null){
          operations.push({partId:layout[j].partId,parent,parentPort,childPort,twist});order.push(j);used.add(j);found=true;
        }if(found)break;
      }
    }
    if(!found)throw Error('Disconnected modules: '+layout.filter((_,i)=>!used.has(i)).map(p=>`${p.role}/${p.partId}@${p.x},${p.y},${p.z}`).join('; '));
  }
  const program={name:label,rootRotation:layout[root].rot,description:'A stock-fitted robot with paired feet and limbs, a narrow waist, broad shoulders and a centered visor head.',operations};
  compileConnections(program,stock);return {program,roles:order.map(i=>layout[i].role),order};
}

const palettes:ColorName[][]=[['light-gray','dark-gray','white','black','medium-blue','reddish-brown','tan'],['white','light-gray','dark-gray','black','medium-blue','reddish-brown','tan'],['reddish-brown','tan','dark-brown','dark-tan','black'],['dark-gray','light-gray','medium-blue','white','black','reddish-brown','tan'],['medium-blue','dark-blue','light-gray','white','black','reddish-brown','tan']];
/** Fit pieces only AFTER a target is frozen. Palette and equivalent tilings can vary;
 * all dimensions, role envelopes and outline thresholds remain locked to target. */
export function solveRobotTarget(stock:Record<string,number>,target:RobotTarget,diagnostics?:string[]):RobotCandidate[]{
 const canonical=createRobotTarget(target.shape);
 if(JSON.stringify(canonical)!==JSON.stringify(target))throw Error('The frozen silhouette target was altered.');
 if(target.version===2){
  const problems=diagnostics??[],candidates:RobotCandidate[]=[];
  for(const layout of allocateRobotModules(stock,target.zones!,problems)){
   try{
    const compiled=programFromLayout(layout,stock,'Field robot'),build=compileConnections(compiled.program,stock),assignment=compiled.order.map(i=>layout[i].zone),contract=targetContract(target,compiled.roles,assignment);
    const issues=[...robotBodyIssues(build,contract),...silhouetteFit(build,target,compiled.roles).issues];if(issues.length)throw Error(issues.join('; '));
    if(build.steps.length<20||build.steps.length>60)throw Error('Module assembly must use 20–60 pieces.');
    build.description='A robot with a shaped chest, separate shoulder caps, fixed bent arms, compact hands, jointed legs and raised-heel feet.';
    build.steps.forEach((step,i)=>{const feature=target.zones!.find(z=>z.id===assignment[i])!.feature;step.caption=`${feature}. ${step.caption}`;});
    const modules={choices:target.shape.modules!,regions:target.zones!.map(z=>({id:z.id,feature:z.feature,parts:assignment.filter(id=>id===z.id).length}))};
    candidates.push({target,id:`robot-modules-${candidates.length+1}`,label:Object.values(target.shape.modules!).join(' / '),build,program:compiled.program,contract,modules,proportions:{legHeight:target.shape.legHeight,torsoHeight:8,stance:2,chest:target.shape.chest},palette:[...new Set(layout.map(p=>parsePartId(p.partId)!.color))]});
    if(candidates.length===4)break;
   }catch(e){problems.push((e as Error).message);}
  }
  return candidates;
 }
 const {legHeight,torsoHeight,armHeight,stance,depth,headWidth,chest}=target.shape;
 const candidates:RobotCandidate[]=[],seen=new Set<string>();
 for(const palette of palettes){
  const left={...stock},layout:Tagged[]=[];const span=4+stance,cx=span/2,hipZ=1+legHeight,bodyZ=hipZ+5,shoulderZ=bodyZ+torsoHeight;
  const put=(role:RobotRole,parts:Placed[],x:number,y:number,z:number)=>parts.forEach(p=>layout.push({...p,role,x:p.x+x,y:p.y+y,z:p.z+z}));
  const fill=(role:RobotRole,w:number,d:number,h:number,x:number,y:number,z:number,colors=palette,types?:string[])=>{const ps=layer(left,w,d,h,colors,1,types);if(!ps)throw Error('Stock cannot fill '+role);put(role,ps,x,y,z);};
  const pair=(a:RobotRole,b:RobotRole,w:number,d:number,h:number,x1:number,x2:number,y:number,z:number,colors=palette,types?:string[])=>{const ps=layer(left,w,d,h,colors,2,types);if(!ps)throw Error('Stock cannot fill paired '+a+'/'+b);put(a,ps,x1,y,z);put(b,ps,x2,y,z);};
  try{
   pair('leftFoot','rightFoot',2,depth+1,1,0,span-2,0,0,[...palette,'tan']);
   // Try coherent limb allocations atomically; one failed color cannot consume the next one's stock.
   let limbColor:ColorName|undefined;
   for(const color of palette){
    const saved={...left},length=layout.length;
    try{
     // Reserve the narrower arms first: their few usable bricks can otherwise
     // be spent in the legs even when a complete same-color allocation exists.
     for(let h=0;h<armHeight;h+=3)pair('leftArm','rightArm',1,depth,3,-1,span,1,shoulderZ-armHeight+h,[color]);
     for(let h=0;h<legHeight;h+=3)pair('leftLeg','rightLeg',2,depth,3,0,span-2,1,1+h,[color]);
     limbColor=color;break;
    }catch{Object.assign(left,saved);layout.length=length;}
   }
   if(!limbColor)throw Error('Stock cannot fill coherent paired limb modules at the target dimensions');
   fill('hips',span,depth,3,0,1,hipZ);fill('hips',span,depth,1,0,1,hipZ+3);
   fill('waist',2,depth,1,cx-1,1,hipZ+4);
   for(let h=0;h<torsoHeight;h+=3){
    if(chest==='sloped'&&h===torsoHeight-3){
      fill('torso',2,2,3,cx-1,1,bodyZ+h,['medium-blue','white','light-gray','dark-gray','reddish-brown'],['slope']);
      if(depth>2)fill('torso',2,depth-2,3,cx-1,3,bodyZ+h);
      fill('torso',1,depth,3,cx-2,1,bodyZ+h);fill('torso',1,depth,3,cx+1,1,bodyZ+h);
    }else fill('torso',4,depth,3,cx-2,1,bodyZ+h);
   }
   fill('shoulders',span+2,1,3,-1,depth,shoulderZ,[limbColor,...palette]);
   fill('shoulders',span,depth-1,3,0,1,shoulderZ,palette);
   fill('shoulders',span+2,depth,1,-1,1,shoulderZ+3,['black',...palette]);
   fill('neck',2,1,1,cx-1,depth,shoulderZ+4);
   fill('head',headWidth,depth,1,cx-headWidth/2,1,shoulderZ+5);
   fill('head',headWidth,1,3,cx-headWidth/2,1,shoulderZ+6,['black','dark-blue','dark-gray']);
   fill('head',headWidth,depth-1,3,cx-headWidth/2,2,shoulderZ+6,palette);
   fill('head',headWidth,depth,1,cx-headWidth/2,1,shoulderZ+9,palette);
   pair('leftFoot','rightFoot',2,1,1,0,span-2,0,1,palette,['tile']);
   const compiled=programFromLayout(layout,stock,'Workshop robot'),build=compileConnections(compiled.program,stock),parts=build.steps.flatMap(s=>s.parts);
   if(parts.length<20||parts.length>60)throw Error('Target needs a construction outside the 20–60 piece range');
   const contract=targetContract(target,compiled.roles);
   const issues=[...robotBodyIssues(build,contract),...silhouetteFit(build,target,compiled.roles).issues];
   if(issues.length)throw Error(issues.join('; '));
   const key=JSON.stringify(build.steps);if(seen.has(key))continue;seen.add(key);
   candidates.push({target,id:`robot-${candidates.length+1}`,label:`${legHeight===6?'Compact':'Tall'} legs / ${torsoHeight===6?'short':'deep'} torso / ${chest} chest / ${palette[0]} palette`,program:compiled.program,build,contract,proportions:{legHeight,torsoHeight,stance,chest},palette});
  }catch(e){diagnostics?.push((e as Error).message);}
 }
 return candidates;
}
/** Legacy manual gallery, separate from the silhouette-first AI pipeline. */
export function robotBodyCandidates(stock:Record<string,number>,limit=12,diagnostics?:string[]):RobotCandidate[]{
 const candidates:RobotCandidate[]=[];
 for(const legHeight of [6,9])for(const torsoHeight of [6,9])for(const stance of [2,1])for(const chest of ['sloped','plain'] as const){
  if(stance===1)continue; // Odd centers require a different connection grammar.
  const target=createRobotTarget({legHeight,torsoHeight,armHeight:6,stance,depth:2,headWidth:2,chest});
  for(const c of solveRobotTarget(stock,target,diagnostics))candidates.push({...c,id:`robot-${candidates.length+1}`});
 }
 const selected:RobotCandidate[]=[];const bins=new Map<string,RobotCandidate[]>();for(const c of candidates){const key=JSON.stringify(c.proportions);bins.set(key,[...(bins.get(key)??[]),c]);}
 while(selected.length<limit&&[...bins.values()].some(b=>b.length))for(const b of bins.values()){if(b.length&&selected.length<limit)selected.push(b.shift()!);}
 return selected;
}
export const robotRequest=(name:string)=>/\b(robot|robots|droid|android|mech)\b/i.test(name)&&!/\b(dog|cat|fox|horse|spider|bird|fish|snake|car|truck|plane|airplane|drone|quadruped)\b/i.test(name);
/** Remove palette cues for the plan-selection pass; never substitute this into the stock build. */
export function robotSilhouette(build:Build):Build{return {...build,name:'Untitled form',description:'',steps:build.steps.map(s=>({...s,caption:'',parts:s.parts.map(p=>({...p,partId:`${parsePartId(p.partId)!.type}-${parsePartId(p.partId)!.w}x${parsePartId(p.partId)!.d}-light-gray`}))}))};}
