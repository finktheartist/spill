import {parsePartId,type Build,type Placed} from '../bricks';
import {isMade} from '../catalog';
import {connectionPairs,definition,frame,validateConnections} from '../connections';
import type {WholeAnimalLayout,WholeAnimalRole} from '../assembly-composer/animal-whole';
import {connectedAnimalLayout,WHOLE_ANIMAL_ROLES,type WholeAnimalConnectionIntent} from './whole-animal-connections';
export type WholeAnimalStage='features'|'body'|'legs'|'tail';
export interface WholeAnimalStageState {stage:WholeAnimalStage;prefix:WholeAnimalConnectionIntent}
export interface WholeAnimalStageProgress {complete:boolean;state?:WholeAnimalStageState;remaining:Record<string,number>;feedback:string}

const FEATURES:WholeAnimalRole[]=['neck','head','muzzle','nose','eye-left','eye-right','ear-left','ear-right'];
const CORE:WholeAnimalRole[]=['chest','hips','torso'];
const LEGS:WholeAnimalRole[]=['leg-front-left','leg-front-right','leg-rear-left','leg-rear-right'];
const BODY:WholeAnimalRole[]=[...CORE,...LEGS];
const REQUIRED=[...FEATURES,...BODY,'tail'] as WholeAnimalRole[];
const EPS=1e-5;
const OP_KEYS=['partId','role','parent','parentPort','childPort','twist'] as const;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function ledger(stock:Record<string,number>):Record<string,number> {
 if(!object(stock)||Object.keys(stock).length>1024||Object.entries(stock).some(([id,n])=>id.length>80||!Number.isSafeInteger(n)||n<0))throw Error('Stage stock requires bounded nonnegative exact integer counts.');
 return Object.fromEntries(Object.entries(stock));
}
function intentCopy(intent:WholeAnimalConnectionIntent,empty=false):WholeAnimalConnectionIntent {
 if(!object(intent)||![0,90,180,270].includes(intent.rootRotation)||!Array.isArray(intent.operations)||intent.operations.length<(empty?0:1)||intent.operations.length>80)throw Error('Stage connector intent needs 1–80 operations and a quarter-turn root.');
 for(const [i,op]of intent.operations.entries()) {
  if(!object(op)||Object.keys(op).length!==6||Object.keys(op).some(k=>!OP_KEYS.some(key=>key===k))||typeof op.partId!=='string'||op.partId.length>80||!WHOLE_ANIMAL_ROLES.includes(op.role)||!Number.isSafeInteger(op.parent)||
   ![0,90,180,270,-90,-180,-270].includes(op.twist)||typeof op.parentPort!=='string'||typeof op.childPort!=='string'||Math.max(op.parentPort.length,op.childPort.length)>80)throw Error(`Stage connector operation ${i} is malformed or unbounded.`);
 }
 // Preserve exact advertised values, including ±270. Object property order is
 // irrelevant; the operation array order and all six values are prepaid.
 return structuredClone(intent);
}
function stateCopy(state:WholeAnimalStageState):WholeAnimalStageState {
 if(!object(state)||!['features','body','legs','tail'].includes(state.stage))throw Error('Invalid prior whole-animal stage state.');
 const prefix=intentCopy(state.prefix,state.stage==='features'),roles=new Set(prefix.operations.map(op=>op.role));
 const need=state.stage==='tail'?[...FEATURES,...BODY]:state.stage==='legs'?[...FEATURES,...CORE]:FEATURES;
 const allowed=state.stage==='tail'||state.stage==='legs'?[...FEATURES,...BODY,'frame']:FEATURES;
 if(state.stage==='features'?prefix.operations.length!==0:need.some(r=>!roles.has(r))||[...roles].some(r=>!allowed.includes(r))||(state.stage==='body'&&prefix.operations.length>28))throw Error('Prior stage prefix does not cover exactly its accepted anatomy phase.');
 return {stage:state.stage,prefix};
}
function geometry(layout:WholeAnimalLayout,stock:Record<string,number>):{parts:Placed[];cost:Record<string,number>} {
 if(!object(layout)||typeof layout.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(layout.id)||typeof layout.description!=='string'||layout.description.length>1000||!['standing','crouching'].includes(layout.stance??'standing')||!Array.isArray(layout.parts)||layout.parts.length<1||layout.parts.length>80)throw Error('Stage layout requires a bounded 1–80-part standing/crouching target.');
 const cost:Record<string,number>={},raw=layout.parts.map((p,i)=>{
  if(!object(p)||typeof p.partId!=='string'||p.partId.length>80||!WHOLE_ANIMAL_ROLES.includes(p.role)||![p.x,p.y,p.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=24)||![0,90,180,270].includes(p.rot)||Math.abs(p.z/.4-Math.round(p.z/.4))>1e-6||!isMade(p.partId))throw Error(`Stage part ${i} needs actual parts, roles and finite quarter-turn STUD poses.`);
  const k=parsePartId(p.partId);if(!k||!definition(k).ports.length)throw Error(`Stage part ${i} has no supported connectors.`);
  cost[p.partId]=(cost[p.partId]??0)+1;
  return {partId:p.partId,x:p.x,y:p.y,z:p.z/.4,rot:p.rot};
 });
 for(const [id,n]of Object.entries(cost))if((stock[id]??0)<n)throw Error(`Stage exact stock exhausted for ${id}: charged ${n}, available ${stock[id]??0}.`);
 const original=raw.map(frame),min=[0,1,2].map(a=>Math.min(...original.map(f=>f.bounds.min[a]))),max=[0,1,2].map(a=>Math.max(...original.map(f=>f.bounds.max[a])));
 if(max.some((n,a)=>n-min[a]>24*20+EPS))throw Error('Stage target exceeds the 24-stud envelope.');
 const parts=raw.map(p=>({...p,x:p.x-min[0]/20,y:p.y-min[1]/20,z:p.z-min[2]/8})),ff=parts.map(frame);
 let work=0;for(let a=0;a<ff.length;a++)for(let b=0;b<a;b++)work+=ff[a].ports.length*ff[b].ports.length;
 if(work>8_000_000)throw Error('Stage exceeds bounded connector-inspection work.');
 const links=parts.map(()=>[] as number[]);
 for(let a=0;a<parts.length;a++)for(let b=0;b<a;b++)if(connectionPairs(ff[a],ff[b]).length){links[a].push(b);links[b].push(a);}
 const root=ff.findIndex(f=>Math.abs(f.bounds.min[2])<EPS),order=[root],seen=new Set(order);
 for(let at=0;at<order.length;at++)for(const i of links[order[at]])if(!seen.has(i)){seen.add(i);order.push(i);}
 if(root<0||seen.size!==parts.length)throw Error('Stage parts must form one real mating-contact graph.');
 // Design root may now sit above newly appended feet. Validate in a real
 // ground-first graph traversal without changing any relative target pose.
 const build:Build={name:'Unchecked partial Fox',description:'Internal staged geometry; no anatomy or visual qualification.',engine:'connections-v2',steps:order.map(i=>({caption:'Internal stage check',parts:[parts[i]]}))};
 const issues=validateConnections(build,stock,24);if(issues.length)throw Error(`Stage physical validation failed: ${[...new Set(issues.map(i=>i.message))].join(' ')}`);
 return {parts,cost};
}

/** PURE progress/stock/physical gate. Throws on invalid input without committing
 * a prefix. complete means role coverage ONLY; callers must still compile the
 * full whole-animal anatomy and selected blueprint, and never offer a partial. */
export function advanceWholeAnimalStage(layout:WholeAnimalLayout,connections:WholeAnimalConnectionIntent|undefined,stock:Record<string,number>,state?:WholeAnimalStageState):WholeAnimalStageProgress {
 const remaining=ledger(stock),prior=state?stateCopy(state):undefined,intent=connections===undefined?undefined:intentCopy(connections);
 if(prior) {
  if(!intent)throw Error('A staged prepaid prefix cannot be completed or replaced with free coordinates.');
  if(intent.rootRotation!==prior.prefix.rootRotation||intent.operations.length<prior.prefix.operations.length||prior.prefix.operations.some((op,i)=>OP_KEYS.some(key=>op[key]!==intent.operations[i][key])))throw Error('Keep rootRotation, operation array order and all six values of EVERY prepaid prior operation exact; append only.');
  if(prior.stage==='legs') {
   const appended=intent.operations.slice(prior.prefix.operations.length);
   if(!appended.length||appended.some(op=>!LEGS.includes(op.role)))throw Error('Stage legs must append ONLY leg roles without changing prepaid parts.');
  }
 }
 const checked=geometry(layout,remaining);
 if(intent) {
  const expanded=connectedAnimalLayout(remaining,layout,intent);
  if(expanded.parts.length!==layout.parts.length)throw Error('Stage layout does not match its exact connector intent.');
  const shift=layout.parts[0];
  const delta=[shift.x-expanded.parts[0].x,shift.y-expanded.parts[0].y,shift.z-expanded.parts[0].z];
  if(layout.parts.some((p,i)=>{const q=expanded.parts[i];return p.partId!==q.partId||p.role!==q.role||p.rot!==q.rot||[p.x-q.x,p.y-q.y,p.z-q.z].some((n,a)=>Math.abs(n-delta[a])>EPS);}))throw Error('Stage target changed an exact connector pose; only ONE whole-origin translation is allowed.');
 }
 const roles=new Set(layout.parts.map(p=>p.role));
 if(LEGS.every(role=>roles.has(role)))for(const role of LEGS) {
  const feet=checked.parts.filter((_,i)=>layout.parts[i].role===role);
  if(Math.abs(Math.min(...feet.map(p=>frame(p).bounds.min[2])))>EPS)throw Error(`Stage legs need four grounded roles; ${role} does not reach the normalized ground.`);
 }
 for(const [id,n]of Object.entries(checked.cost))remaining[id]-=n;
 if(REQUIRED.every(role=>roles.has(role)))return {complete:true,remaining,feedback:'All sixteen roles are present. This is coverage ONLY: run full whole-animal compilation, anatomy and blueprint checks before any model acceptance.'};
 if(!intent)throw Error('Partial stages require exact connector intent; free coordinates are supported only for a complete role-covered target.');
 const stage=prior?.stage??'features',required=stage==='features'?FEATURES:stage==='body'?[...FEATURES,...CORE]:stage==='legs'?[...FEATURES,...BODY]:REQUIRED;
 const allowed=stage==='features'?FEATURES:stage==='body'||stage==='legs'?[...FEATURES,...BODY,'frame']:WHOLE_ANIMAL_ROLES;
 const missing=required.filter(r=>!roles.has(r));
 if(missing.length)throw Error(`Stage ${stage} is incomplete; required roles: ${missing.join(', ')}.`);
 if([...roles].some(r=>!allowed.includes(r)))throw Error(`Stage ${stage} includes later-phase anatomy; construct features, body core, four legs, then tail.`);
 if(stage==='features'&&intent.operations.length>28)throw Error('First feature stage is limited to 28 operations.');
 const appended=intent.operations.slice(prior?.prefix.operations.length??0);
 const appendRoles=stage==='features'?FEATURES:stage==='body'?[...BODY,'frame']:stage==='legs'?LEGS:['tail'];
 if(!appended.length||appended.some(op=>!appendRoles.includes(op.role)))throw Error(`Stage ${stage} must append only its new anatomy roles without changing prepaid parts.`);
 // A tail-stage success necessarily covers REQUIRED and returned above.
 const next:WholeAnimalStage=stage==='features'?'body':stage==='body'&&!LEGS.every(role=>roles.has(role))?'legs':'tail';
 const nextRoles=next==='body'?CORE:next==='legs'?LEGS:['tail'];
 return {complete:false,state:{stage:next,prefix:structuredClone(intent)},remaining,
  feedback:`Exact ${stage} stage physically checked; not a finished model. Charged cost ONCE: ${JSON.stringify(checked.cost)}. Keep the returned state.prefix EXACTLY unchanged (rootRotation and every operation) and append ${[...nextRoles,...(next==='body'?['optional frame']:[])].join(', ')}. Required next roles: ${nextRoles.join(', ')}.${next==='legs'?' Append ONLY leg roles and make all four leg roles reach the ground.':''} One whole-origin shift may change as lower feet are added; joins determine poses, so do not guess coordinates. Final coverage is not anatomy, blueprint or quality acceptance.`};
}
