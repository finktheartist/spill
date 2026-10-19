import {parsePartId,type Placed} from '../bricks';
import {attachPart,definition,frame,connectionPairs} from '../connections';
import {isMade} from '../catalog';
import type {WholeAnimalLayout,WholeAnimalRole} from '../assembly-composer/animal-whole';

export const WHOLE_ANIMAL_ROLES:WholeAnimalRole[]=['frame','chest','hips','torso','tail','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right','neck','head','muzzle','nose','eye-left','eye-right','ear-left','ear-right'];
export interface WholeAnimalConnection {partId:string;role:WholeAnimalRole;parent:number;parentPort:string;childPort:string;twist:number}
export interface WholeAnimalConnectionIntent {rootRotation:0|90|180|270;operations:WholeAnimalConnection[]}
/** Design-intent expansion only. The caller must still compile independently
 * owned anatomical modules, check stock/collisions/closures and bind the plan.
 * Positions come solely from requested real connector joins, with one global
 * origin normalization. No authored body, snapping or collision repair. */
export function connectedAnimalLayout(stock:Record<string,number>,base:Pick<WholeAnimalLayout,'id'|'description'|'stance'>,intent:WholeAnimalConnectionIntent):WholeAnimalLayout {
 if(!intent||![0,90,180,270].includes(intent.rootRotation)||!Array.isArray(intent.operations)||intent.operations.length<1||intent.operations.length>80)throw Error('Connector intent requires1–80 design operations and a quarter-turn root.');
 const placed:Placed[]=[],cost:Record<string,number>={},usedPorts=new Set<string>();
 for(const [i,op]of intent.operations.entries()){
  if(!op||typeof op.partId!=='string'||op.partId.length>80||!isMade(op.partId)||!WHOLE_ANIMAL_ROLES.includes(op.role)||!Number.isSafeInteger(op.parent)||![0,90,180,270,-90,-180,-270].includes(op.twist)||typeof op.parentPort!=='string'||typeof op.childPort!=='string'||Math.max(op.parentPort.length,op.childPort.length)>80)throw Error(`Connector operation${i}: use an actual part, anatomy role, earlier parent, real ports and quarter twist.`);
  const k=parsePartId(op.partId);if(!k||!definition(k).ports.length)throw Error(`Connector operation${i} has no supported real connectors.`);
  const available=stock[op.partId],used=cost[op.partId]=(cost[op.partId]??0)+1;if(!Number.isSafeInteger(available)||available<used)throw Error(`Connector operation${i} exhausts ${op.partId}: needs${used}, available${available??0}.`);
  if(!i){if(op.parent!==-1||op.twist!==0||op.parentPort!==''||op.childPort!=='')throw Error('Root connector operation needs parent-1, empty ports and twist0.');placed.push({partId:op.partId,x:0,y:0,z:0,rot:intent.rootRotation});}
  else {
   if(op.parent<0||op.parent>=i)throw Error(`Connector operation${i} must attach to an earlier operation.`);
   const parent=placed[op.parent],pf=frame(parent),childPorts=definition(k).ports;
   try{
    if(usedPorts.has(`${op.parent}/${op.parentPort}`))throw Error('The requested parent connector is already used by an earlier explicit join.');
    placed.push(attachPart(parent,op.parentPort,op.partId,op.childPort,((op.twist+180)%360+360)%360-180));usedPorts.add(`${op.parent}/${op.parentPort}`);usedPorts.add(`${i}/${op.childPort}`);
   }catch(error){
    throw Error(`ZERO-BASED connector operation${i} (${op.role}, ${op.partId}) requested childPort ${op.childPort} onto operation${op.parent} (${parent.partId}) parentPort ${op.parentPort}: ${error instanceof Error?error.message:String(error)}. Actual parent local port IDs: ${pf.ports.slice(0,64).map(p=>p.id).join(', ')}. Actual child local port IDs: ${childPorts.slice(0,64).map(p=>p.id).join(', ')}. Explicitly unused parent IDs: ${pf.ports.filter(p=>!usedPorts.has(`${op.parent}/${p.id}`)).slice(0,64).map(p=>p.id).join(', ')}. Port IDs rotate with the part; they are local coordinates, not world indices.`);
   }
  }
 }
 const ff=placed.map(frame),min=[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20),max=[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20);
 if(max.some((n,a)=>!Number.isFinite(n)||n-min[a]>24+1e-5))throw Error('Connector intent exceeds24studs on an axis.');
 const parts=placed.map((p,i)=>{
  const r=ff[i].rotation,quarter=[0,90,180,270].find(angle=>{const a=angle*Math.PI/180,expected=[Math.cos(a),-Math.sin(a),0,Math.sin(a),Math.cos(a),0,0,0,1];return r.every((n,j)=>Math.abs(n-expected[j])<1e-6);});
  if(quarter===undefined)throw Error(`Connector operation${i} makes a tilted/SNOT part; this pilot supports upright quarter turns only.`);
  return {partId:p.partId,role:intent.operations[i].role,x:p.x-min[0],y:p.y-min[1],z:p.z*.4-min[2],rot:quarter as 0|90|180|270};
 });
 return {...base,parts};
}

export function unmatedAnimalPortBrief(layout:WholeAnimalLayout,stage:string){
 const ff=layout.parts.map(p=>frame({...p,z:p.z/.4})),used=new Set<string>();let work=0;
 for(let i=0;i<ff.length;i++)for(let j=0;j<i;j++)work+=ff[i].ports.length*ff[j].ports.length;
 if(work>8_000_000)return [];
 for(let i=0;i<ff.length;i++)for(let j=0;j<i;j++)for(const[a,b]of connectionPairs(ff[i],ff[j])){used.add(`${i}/${a}`);used.add(`${j}/${b}`);}
 const desired=stage==='body'?new Set(['neck']):stage==='legs'?new Set(['chest','hips','torso','frame']):stage==='tail'?new Set(['hips','torso']):new Set(['head','neck']);
 return layout.parts.flatMap((p,i)=>desired.has(p.role)?[{globalParentIndex:i,partId:p.partId,role:p.role,unmatedPorts:ff[i].ports.filter(port=>!used.has(`${i}/${port.id}`)).slice(0,32).map(port=>({id:port.id,kind:port.kind,pointStuds:port.point.map(n=>n/20),normal:port.normal}))}]:[]);
}
