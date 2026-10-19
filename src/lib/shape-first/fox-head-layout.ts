import {frame,connectionPairs,attachmentTwist,validateConnections,type RequiredContact} from '../connections';
import type {Placed} from '../bricks';
import type {FoxImprovContext,FoxImprovProposal,FoxImprovRole,FoxImprovOperation} from '../assembly-composer/animal-improv';
export interface FoxHeadLayout {
 id:string;description:string;
 /** Desired world poses, entirely in studs. They do not establish a legal build. */
 parts:{partId:string;role:FoxImprovRole;x:number;y:number;z:number;rot:number}[];
}

/** Solve a fresh target layout's real connection graph. No snapping, omitted
 * parts, fabricated contacts or authored head recipes. The existing composer
 * still owns stock, intersections, grounding and Fox morphology acceptance. */
export function foxLayoutProposal(context:FoxImprovContext,layout:FoxHeadLayout):FoxImprovProposal {
 if(!layout||!Array.isArray(layout.parts)||layout.parts.length<8||layout.parts.length>24)throw Error(`A head layout needs 8–24 actual parts; received ${layout?.parts?.length??0}.`);
 const raw:(Placed&{role:FoxImprovRole})[]=layout.parts.map((p,i)=>{
  if(!p||!context.available[p.partId]||![p.x,p.y,p.z,p.rot].every(Number.isFinite)||![0,90,180,270].includes(p.rot)||Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))>24||Math.abs(p.z/.4-Math.round(p.z/.4))>1e-6)throw Error(`Layout part ${i}: use an available ID, finite bounded stud coordinates, .4-stud height layers and quarter-turn rotation.`);
  return {...p,z:Math.round(p.z/.4)};
 });
 const frames=raw.map(frame);
 for(let root=0;root<raw.length;root++){
  if(raw[root].role!=='neck')continue;
  for(const port of context.shoulderPorts)for(const[parentPort,childPort]of connectionPairs(port.frame,frames[root])){
   if(parentPort!==port.parentPort)continue;
   const twist=attachmentTwist(port.part,parentPort,raw[root],childPort);if(twist===null)continue;
   const order=[root],seen=new Set(order),operations:FoxImprovOperation[]=[{partId:raw[root].partId,parent:-1,parentPort:'',childPort:'',twist:0,role:raw[root].role}];
   while(order.length<raw.length){let found=false;
    next:for(let i=0;i<raw.length;i++)if(!seen.has(i))for(const[parent,j]of order.entries())for(const[pp,cp]of connectionPairs(frames[j],frames[i])){
     const t=attachmentTwist(raw[j],pp,raw[i],cp);if(t===null)continue;
     operations.push({partId:raw[i].partId,parent,parentPort:pp,childPort:cp,twist:t,role:raw[i].role});order.push(i);seen.add(i);found=true;break next;
    }
    if(!found)throw Error(`No real connector path reaches layout parts ${raw.map((p,i)=>!seen.has(i)?`${i}:${p.role}(${p.partId})`:null).filter(Boolean).join(', ')}. Add or reposition actual studded carriers; no floating pieces are accepted.`);
   }
   const requiredContacts:RequiredContact[]=[];
   for(let a=0;a<order.length;a++)for(let b=0;b<a;b++)for(const[aPort,bPort]of connectionPairs(frames[order[a]],frames[order[b]]))requiredContacts.push({a,b,aPort,bPort});
   return {id:layout.id,description:layout.description,rootRotation:raw[root].rot,attachment:{parentPart:port.parentPart,parentPort,childPort,twist},operations,requiredContacts};
  }
 }
 throw Error('No neck part mates to an actual exposed shoulder stud at z=3.6 studs.');
}

/** Diagnostic only: inspecting an invalid target never makes it acceptable. */
export function foxLayoutDiagnostics(context:FoxImprovContext,layout:FoxHeadLayout):unknown {
 try{
  if(!Array.isArray(layout?.parts)||layout.parts.length>32)return {count:layout?.parts?.length};
  const raw=layout.parts.map(p=>({...p,z:p.z/.4})),frames=raw.map(frame),roles=[...new Set(layout.parts.map(p=>p.role))];
  const fixed=context.chassis.build.steps.flatMap(s=>s.parts),all=[...fixed,...raw];
  const minX=Math.min(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),shifted=all.map(p=>({...p,x:p.x-minX,y:p.y-minY}));
  const issues=validateConnections({name:'Diagnostic target',description:'Unaccepted target poses',engine:'connections-v2',steps:shifted.map(p=>({caption:'Diagnostic only',parts:[p]}))},context.stock)
   .filter(i=>i.kind!=='floating').slice(0,20).map(i=>({problem:i.message,headPartIndices:i.parts.map(p=>shifted.indexOf(p)-fixed.length).filter(i=>i>=0)}));
  const roleBounds=Object.fromEntries(roles.map(role=>{const fs=frames.filter((_,i)=>layout.parts[i].role===role);return [role,{minStuds:[0,1,2].map(a=>Math.min(...fs.map(f=>f.bounds.min[a]))/20),maxStuds:[0,1,2].map(a=>Math.max(...fs.map(f=>f.bounds.max[a]))/20)}];}));
  return {count:raw.length,issues,roleBounds,note:'Head indices are zero-based original layout indices. No target was accepted.'};
 }catch(e){return {diagnosticError:String(e)};}
}
