import {frame} from '../connections';
import type {WholeAnimalLayout,WholeAnimalRole} from '../assembly-composer/animal-whole';
import type {AnimalAttachmentRequest} from '../assembly-composer/animal-attachment-search';
import type {WholeAnimalConnectionIntent,WholeAnimalConnection} from './whole-animal-connections';
import type {AnimalBlueprint} from './animal-blueprint';

/** Search is explicitly requested by the designer. Part IDs, anatomy ownership
 * and the checked prefix remain fixed; only real connector bindings vary. */
export function wholeAnimalAttachmentRequests(prefix:WholeAnimalConnectionIntent,operations:WholeAnimalConnection[]):AnimalAttachmentRequest[]{
 const roles=prefix.operations.map(o=>o.role);
 const permitted=(role:WholeAnimalRole):WholeAnimalRole[]=>{
  if(role.startsWith('leg-'))return ['chest','hips','torso','frame',role];
  switch(role){
   case 'head':return ['head','neck'];
   case 'neck':return ['head','neck'];
   case 'muzzle':return ['head','muzzle'];
   case 'nose':return ['muzzle','nose'];
   case 'eye-left':case 'eye-right':case 'ear-left':case 'ear-right':return ['head',role];
   case 'tail':return ['hips','torso','frame','tail'];
   default:return ['neck','chest','hips','torso','frame'];
  }
 };
 return operations.map(op=>{
  const allowed=permitted(op.role),all=roles.flatMap((r,i)=>allowed.includes(r)?[i]:[]);
  const parents=roles.length?[...new Set([...(all.includes(op.parent)?[op.parent]:[]),...all])].slice(0,16):[-1];
  roles.push(op.role);return {...op,parents};
 });
}

/** A ranking heuristic, never a geometry/animal acceptance gate. Align partial
 * construction to the plan through its two ear landmarks so adding lower parts
 * cannot shift the objective. Carriers are included in actual role bounds. */
export function wholeAnimalAttachmentScore(blueprint:AnimalBlueprint,requests:AnimalAttachmentRequest[],prefixLength:number){
 // Nominal upright bounds depend on ID/yaw, not the mutable partial layout.
 // Cache those immutable local values, then translate numerically. Rebuilding
 // every earlier frame for every hypothetical port choice dominated search.
 const localBounds=new Map<string,{min:number[];max:number[]}>();
 return (layout:WholeAnimalLayout,_added:number):number=>{
  const boxes=layout.parts.map(p=>{const key=`${p.partId}/${p.rot}`;let b=localBounds.get(key);if(!b){const f=frame({...p,x:0,y:0,z:0});b={min:f.bounds.min.map(n=>n/20),max:f.bounds.max.map(n=>n/20)};localBounds.set(key,b);}const t=[p.x,p.y,p.z];return {min:b.min.map((n,a)=>n+t[a]),max:b.max.map((n,a)=>n+t[a])};});
  const regions=new Map(blueprint.regions.map(r=>[r.role,r]));
  const ears=layout.parts.flatMap((p,i)=>p.role==='ear-left'||p.role==='ear-right'?[{role:p.role,box:boxes[i]}]:[]);
  const shift=[0,0,0];
  if(ears.length===2)for(let a=0;a<3;a++)shift[a]=ears.reduce((n,e)=>{const r=regions.get(e.role)!;return n+(a===2?r.min[a]-e.box.min[a]:(r.min[a]+r.max[a]-e.box.min[a]-e.box.max[a])/2);},0)/2;
  let score=0;
  for(let i=prefixLength;i<layout.parts.length;i++){
   const p=layout.parts[i],r=regions.get(p.role);if(!r)continue;
   const b=boxes[i],center=b.min.map((n,a)=>(n+b.max[a])/2+shift[a]),goal=r.min.map((n,a)=>(n+r.max[a])/2);
   // Skull carriers that support a specific facial feature should form a real
   // landing near that feature rather than all clustering under the crown.
   if(p.role==='head'){
    const child=requests.find(o=>o.parent===i&&['muzzle','eye-left','eye-right'].includes(o.role)),target=child?regions.get(child.role):undefined;
    if(target){goal[0]=(target.min[0]+target.max[0])/2;goal[1]=target.max[1]-.5;goal[2]=target.min[2]-(b.max[2]-b.min[2])/2;}
   }
   for(let a=0;a<3;a++){
    const low=b.min[a]+shift[a],high=b.max[a]+shift[a],outside=Math.max(0,r.min[a]-r.tolerance-low)+Math.max(0,high-r.max[a]-r.tolerance);
    score+=outside*outside*40+Math.abs(center[a]-goal[a])*(a===2?1.5:1);
   }
  }
  const center=(role:WholeAnimalRole)=>{const ids=layout.parts.flatMap((p,i)=>p.role===role?[i]:[]);if(!ids.length)return;const min=[0,1,2].map(a=>Math.min(...ids.map(i=>boxes[i].min[a]))),max=[0,1,2].map(a=>Math.max(...ids.map(i=>boxes[i].max[a])));return {min,max,c:min.map((n,a)=>(n+max[a])/2)};};
  const head=center('head'),muzzle=center('muzzle'),nose=center('nose'),left=center('eye-left'),right=center('eye-right');
  if(head&&muzzle)score+=Math.abs(head.c[0]-muzzle.c[0])*25;
  if(muzzle&&nose){score+=Math.abs(muzzle.c[0]-nose.c[0])*20+Math.max(0,nose.min[1]-muzzle.min[1])*30;}
  if(head&&left&&right){score+=Math.abs((left.c[0]+right.c[0])/2-head.c[0])*30+Math.abs(left.c[1]-right.c[1])*20+Math.abs(left.c[2]-right.c[2])*20+Math.max(0,.4-right.min[0]+left.max[0])*30;}
  if(muzzle&&left&&right)score+=Math.max(0,.75-Math.min(left.min[1],right.min[1])+Math.min(muzzle.min[1],nose?.min[1]??muzzle.min[1]))*40;
  // This upright pilot has no sideways spinal articulation. A broad carrier
  // can fit an envelope while leaving the animal visibly bent at the waist.
  // Rank the actual masses and stance around one spine, allowing half-stud
  // parity differences; this remains a preference, never a physical repair.
  const core=['chest','torso','hips'].map(role=>center(role as WholeAnimalRole));
  const spine=head?.c[0]??core.find(Boolean)?.c[0];
  if(spine!==undefined){
   for(const mass of core)if(mass)score+=Math.pow(Math.abs(mass.c[0]-spine),2)*45;
   for(const side of ['front','rear']){
    const l=center(`leg-${side}-left` as WholeAnimalRole),r=center(`leg-${side}-right` as WholeAnimalRole);
    if(l&&r)score+=Math.pow((l.c[0]+r.c[0])/2-spine,2)*45+Math.abs(l.c[1]-r.c[1])*12;
   }
  }
  return score;
 };
}
