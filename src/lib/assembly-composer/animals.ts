import { CATALOG, footprint, heightOf, parsePartId, type ColorName, type PartType, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { attachmentTwist, compileConnections, connectionPairs, frame, type ConnectionOperation } from '../connections';
import { moduleConnected, packRegion } from '../robot-module-layout';
import { animalKindName, animalRelatedKinds, animalSubjectKind, type AnimalKind } from './animal-subjects';
import { refinedAnimalIssues, refinedAnimalPlans } from './animal-refined';
import { foxCraftIssues, foxCraftPlans } from './fox-craft';
import { foxImprovIssues } from './animal-improv';
import {wholeAnimalIssues} from './animal-whole';
import { composeModules } from './compose';
import type { AssemblyComposition, AssemblyNode, AssemblyOption, AssemblyPlan } from './types';

type Stock=Record<string,number>;
type Region={id:string;role:string;x:number;y:number;z:number;w:number;d:number;h:number;types:PartType[];colors:ColorName[];rotations?:number[];pair?:string};
type Tagged=Placed&{region:string;role:string};
type Shape={kind:AnimalKind;length:6|8|10;feet:'round'|'paw';coat:'warm'|'blue';ties:'corner'|'split';alertHeight:2|3;waist:1|3;cap:boolean;tailRise:2|3};
const BLUE:ColorName[]=['dark-azure','azure','dark-blue','medium-blue','blue'];
const WARM:ColorName[]=['reddish-brown','dark-brown','dark-tan','tan','medium-nougat','bright-light-orange','orange'];
const NEUTRAL:ColorName[]=['light-gray','dark-gray','black','white'];
const DARK:ColorName[]=['black','dark-gray','dark-green','dark-blue','dark-azure','reddish-brown'];
const unique=(colors:ColorName[])=>[...new Set(colors)];

/** These are anatomical envelopes, not brick coordinates supplied by an AI. The
 * allocator may change seams/materials inside them, but never the species shape. */
function regions(s:Shape):Region[] {
  const out:Region[]=[],coat=s.coat==='warm'?(s.kind==='fox'?WARM:WARM.slice(0,5)):BLUE;
  const surface=unique([...coat,...NEUTRAL,'tan','medium-nougat','dark-tan']);
  const structure=unique([...surface,'reddish-brown','red','bright-light-orange','orange','sand-green']);
  const add=(id:string,role:string,x:number,y:number,z:number,w:number,d:number,h:number,types:PartType[],colors:ColorName[]=surface,extra:Partial<Region>={})=>out.push({id,role,x,y,z,w,d,h,types,colors,...extra});
  const L=s.length,H=s.feet==='round'?3:4,B=H+1,headZ=B+5;
  // Four genuinely independent load paths. Their bridge is above the ground;
  // nothing fills the space between the front and rear feet.
  for(const [y,end] of [[1,'front'],[L-2,'rear']] as const) for(const [x,side] of [[0,'left'],[3,'right']] as const) {
    const role=`leg-${end}-${side}`;
    if(s.feet==='paw') add(`paw-${end}-${side}`,`foot-${end}-${side}`,x,y-1,0,1,2,1,['plate','roundendplate'],unique([...coat,'tan','white','reddish-brown','red']),{pair:`paws-${end}`});
    add(`shaft-${end}-${side}`,role,x,y,s.feet==='round'?0:1,1,1,3,['roundbrick'],['tan','white','light-gray','black'],{pair:`shafts-${end}`});
    add(`tie-${end}-${side}`,'frame',side==='left'?0:2,y,H,2,s.ties==='corner'?2:1,1,s.ties==='corner'?['cornerplate']:['plate','roundendplate'],unique([...structure,'green']),{pair:`ties-${end}`});
  }
  add('belly-bridge','frame',1,0,H+1,2,L,1,['plate'],structure);
  add('chest-core','chest',s.kind==='bear'?0:1,0,B+1,s.kind==='bear'?4:2,2,3,['brick','plate']);
  add('hip-core','hips',1,L-2,B+1,2,2,3,['brick','plate']);
  add('waist','torso',1,2,B+1,2,L-4,s.waist,s.waist===3?['brick','plate','tile']:['tile','plate'],s.waist===3?surface:structure);
  add('chest-finish','chest',1,0,B+4,2,1,1,['tile','plate'],unique([...surface,'reddish-brown']));
  add('hip-finish','hips',1,L-2,B+4,2,2,1,['plate','roundendplate']);
  add('neck','neck',1,1,B+4,2,1,1,['plate','roundendplate'],structure);
  const projection=s.kind==='fox'?2:1,jawDepth=s.kind==='bear'?3:4;
  add('jaw-carrier','head',1,-projection,headZ,2,jawDepth,1,['plate'],structure,{rotations:[90]});
  add('skull','head',s.kind==='bear'?0:1,0,headZ+1,s.kind==='bear'?4:2,2,3,['brick','plate']);
  add('eye-rail','face',0,0,headZ+4,4,1,1,['plate','roundendplate'],structure);
  for(const x of [0,3]) add(`eye-${x}`,'face',x,0,headZ+5,1,1,1,['plate'],DARK,{pair:'eyes'});
  add('brow','face',1,0,headZ+5,2,1,1,['plate'],surface);
  if(s.cap)add('eye-cap','face',0,0,headZ+6,4,1,1,['tile','plate'],unique([...coat,'reddish-brown','tan','white','light-gray']));
  const muzzleHeight=s.kind==='bear'?1:3;
  add('muzzle','muzzle',1,-projection,headZ+1,2,projection,muzzleHeight,muzzleHeight===1?['plate','roundendplate']:['brick','plate'],unique(['tan','white','light-gray','medium-nougat','reddish-brown',...coat]));
  add('nose','muzzle',1,-projection,headZ+1+muzzleHeight,2,1,1,['plate'],DARK);
  if(s.kind==='bear') {
    add('crown','head',1,1,headZ+4,2,1,1,['tile','plate'],unique([...surface,'reddish-brown']));
    for(const x of [0,3]) add(`ear-${x}`,`ear-${x===0?'left':'right'}`,x,1,headZ+4,1,2,2,['curve'],unique([...coat,'black','white']),{pair:'rounded-ears',rotations:[0]});
    add('stub-root','tail',1,L-1,B+5,2,2,1,['plate','roundendplate'],structure,{rotations:[90]});
    add('stub-tip','tail',1,L,B+6,2,1,1,['tile','plate'],unique([...surface,'reddish-brown']));
  } else {
    for(const x of [1,2]) add(`forehead-${x}`,'head',x,1,headZ+4,1,2,3,['slope','brick','plate'],surface,{pair:'forehead',rotations:[0,90]});
    if(s.kind==='dog') {
      for(const x of [0,3]) add(`ear-${x}`,`ear-${x===0?'left':'right'}`,x,0,headZ+1,1,2,3,['slope','brick','plate'],surface,{pair:'drop-ears',rotations:[180,90]});
      add('tail-root','tail',1,L-1,B+5,1,2,1,['plate','roundendplate'],structure);
      add('tail-rise','tail',1,L-1,B+6,1,2,s.tailRise,s.tailRise===2?['plate']:['brick','plate']);
      add('tail-taper','tail',1,L-1,B+6+s.tailRise,1,2,2,['curve'],unique([...coat,'black']),{rotations:[180]});
    } else {
      for(const x of [1,2]) add(`ear-${x}`,`ear-${x===1?'left':'right'}`,x,2,headZ+7,1,s.alertHeight===2?1:2,s.alertHeight,s.alertHeight===2?['cheese','plate']:['slope'],unique([...surface,'green']),{pair:s.alertHeight===2?'alert-ears':undefined,rotations:s.alertHeight===2?[x===1?90:270]:[0]});
      add('tail-root','tail',1,L-1,B+5,2,4,1,['plate'],structure);
      add('tail-core','tail',1,L,B+6,2,3,3,['brick','plate']);
      for(const x of [1,2]) add(`tail-taper-${x}`,'tail',x,L+1,B+9,1,2,2,['curve'],unique([...coat,'black']),{pair:'tail-tapers',rotations:[180]});
    }
  }
  return out;
}

/** Bounded joint allocation. Paired identity regions reserve actual manufactured
 * parts first; every subsequent choice debits the same immutable stock snapshot. */
function allocate(stock:Stock,zones:Region[],budget:number):Tagged[][] {
  const groups:Region[][]=[];
  for(const r of zones) { const pair=r.pair&&groups.find(g=>g[0].pair===r.pair);if(pair)pair.push(r);else groups.push([r]); }
  type Allocation={parts:Placed[];used:Stock;cost:number;members?:Placed[][]};
  const choices=(g:Region[],left:Stock):Allocation[]=>{
    const r=g[0],whole=Object.entries(left).flatMap(([id,n])=>{
      const k=parsePartId(id)!;if(n<g.length||!r.types.includes(k.type)||!r.colors.includes(k.color)||heightOf(k)!==r.h)return [];
      return (r.rotations??[0,90]).flatMap(rot=>{const f=footprint(k,rot);return f.fw===r.w&&f.fd===r.d?[{parts:[{partId:id,x:0,y:0,z:0,rot}],used:{[id]:g.length},cost:2+r.colors.indexOf(k.color)*.28}]:[];});
    });
    const mixed:Allocation[]=[];
    // Same geometry and exposed eye/ear placement may use two honest dark/coat
    // shades. Singleton colors never become fictitious duplicate IDs.
    if(g.length===2 && ['eyes','alert-ears'].includes(r.pair??'')) {
      const ids=Object.entries(left).filter(([id,n])=>{const k=parsePartId(id)!;return n>0&&r.types.includes(k.type)&&r.colors.includes(k.color)&&k.w===1&&k.d===1&&heightOf(k)===r.h;});
      for(let a=0;a<ids.length;a++)for(let z=a+1;z<ids.length;z++) {
        if(parsePartId(ids[a][0])!.type!==parsePartId(ids[z][0])!.type)continue;
        const members=ids.filter((_,i)=>i===a||i===z).map(([partId])=>[{partId,x:0,y:0,z:0,rot:0}]);
        mixed.push({parts:members[0],members,used:{[ids[a][0]]:1,[ids[z][0]]:1},cost:5});
      }
    }
    const packing={...r,connected:zones.filter(z=>z.role===r.role).length===1};
    const packed=r.id==='jaw-carrier'&&zones.some(r=>r.id==='stub-root')?[]:packRegion(packing,left,g.length,r.colors,4);
    // A greedy three-stud strip plus a loose singleton is not a legal face
    // bridge. Explore other real seams before declaring the region impossible.
    if(['eye-rail','belly-bridge','jaw-carrier','chest-core','skull','waist'].includes(r.id)&&packed.length) {
      for(const id of Object.keys(packed[0].used).slice(0,2))packed.push(...packRegion(packing,{...left,[id]:0},g.length,r.colors,4));
    }
    const visible=!['frame','neck'].includes(r.role);
    return [...whole,...mixed,...packed].map(a=>({...a,cost:a.cost+a.parts.length*3+(visible?a.parts.reduce((n,p)=>n+Math.max(0,r.colors.indexOf(parsePartId(p.partId)!.color))*3.5,0):0)}));
  };
  const priority=(r:Region)=>r.pair==='eyes'||r.id==='nose'||r.id.startsWith('shaft-')?0:r.id==='brow'||r.id.startsWith('ear-')&&r.id!=='ear-bridge'||r.types.includes('curve')?1:['neck','muzzle'].includes(r.id)?2:['eye-rail','eye-cap','ear-bridge','hip-finish','chest-finish','tail-root','stub-root','stub-tip'].includes(r.id)?3:r.pair?4:['belly-bridge','jaw-carrier'].includes(r.id)?5:6;
  groups.sort((a,b)=>priority(a[0])-priority(b[0]));
  type State={parts:Tagged[];left:Stock;score:number};let states:State[]=[{parts:[],left:{...stock},score:0}];
  const completed=new Set<string>();
  for(const g of groups) {
    if(performance.now()>budget)return [];
    g.forEach(r=>completed.add(r.id));
    const closed=[...new Set(g.map(r=>r.role))].filter(role=>zones.filter(r=>r.role===role).every(r=>completed.has(r.id)));
    // The narrow Bear jaw is one continuous carrier. An isolated outer cheek
    // cannot be rescued by the later two-stud central crown or an external face.
    if(g[0].id==='skull'&&zones.some(r=>r.id==='stub-root'))closed.push('head');
    const next:State[]=[],cache=new Map<string,ReturnType<typeof choices>>();
    for(const state of states) {
      const key=JSON.stringify(state.left);let allocations=cache.get(key);if(!allocations){allocations=choices(g,state.left);cache.set(key,allocations);}
      for(const a of allocations) {
        const left={...state.left};for(const [id,n] of Object.entries(a.used))left[id]-=n;
        const parts=[...state.parts,...g.flatMap((r,i)=>(a.members?.[i]??a.parts).map(p=>({...p,x:p.x+r.x,y:p.y+r.y,z:p.z+r.z,rot:r.pair==='alert-ears'?r.rotations![0]:p.rot,region:r.id,role:r.role})))];
        if(parts.length<=80 && Object.values(left).every(n=>n>=0) && closed.every(role=>moduleConnected(parts.filter(p=>p.role===role))))next.push({parts,left,score:state.score+a.cost});
      }
    }
    if(!next.length)return [];
    const seen=new Set<string>();states=next.sort((a,b)=>a.score-b.score).filter(s=>{const key=JSON.stringify(s.parts);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,24);
  }
  return states.map(s=>s.parts);
}

/** Find real boundary ports and compile each small anatomical module separately.
 * The same observed ports/twists are replayed by composeModules, so this creates
 * neither coordinate-only joins nor a whole-animal module disguised as anatomy. */
function modularPlan(parts:Tagged[],s:Shape,index:number):AssemblyPlan {
  const roles=['frame','chest','hips','torso','neck','head','face','muzzle','ear-left','ear-right','tail','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right',...(s.feet==='paw'?['foot-front-left','foot-front-right','foot-rear-left','foot-rear-right']:[])];
  const nodes:AssemblyNode[]=[],placed=new Map<string,number[]>(),frames=parts.map(frame);
  const remaining=new Set(roles);
  while(remaining.size) {
    let progress=false;
    for(const role of remaining) {
      const members=parts.flatMap((p,i)=>p.role===role?[i]:[]);if(!members.length)throw Error(`Missing ${role}`);
      let root=-1,attachment:AssemblyNode['attachment'];
      for(const i of [...members].sort((a,b)=>frames[a].bounds.min[2]-frames[b].bounds.min[2])) {
        if(!nodes.length && role==='frame') {root=i;break;}
        for(const [parent,order] of placed) {
          for(let parentPart=0;parentPart<order.length;parentPart++) {
            const j=order[parentPart];
            for(const [parentPort,childPort] of connectionPairs(frames[j],frames[i])) {
              const twist=attachmentTwist(parts[j],parentPort,parts[i],childPort);
              if(twist!==null) { root=i;attachment={parent,parentPart,parentPort,childPort,twist};break; }
            }
            if(root>=0)break;
          }
          if(root>=0)break;
        }
        if(root>=0)break;
      }
      if(root<0)continue;
      const order=[root],seen=new Set(order),operations:ConnectionOperation[]=[{partId:parts[root].partId,parent:-1,parentPort:'',childPort:'',twist:0}];
      while(order.length<members.length) {
        let found=false;
        for(const i of members) if(!seen.has(i)) {
          for(let parent=0;parent<order.length;parent++) {
            const j=order[parent];
            for(const [parentPort,childPort] of connectionPairs(frames[j],frames[i])) {
              const twist=attachmentTwist(parts[j],parentPort,parts[i],childPort);
              if(twist!==null) {operations.push({partId:parts[i].partId,parent,parentPort,childPort,twist});order.push(i);seen.add(i);found=true;break;}
            }
            if(found)break;
          }
          if(found)break;
        }
        if(!found)throw Error(`Disconnected ${role}`);
      }
      const option:AssemblyOption={id:`animal:${s.kind}:${role}:${s.length}:${s.feet}:${s.ties}:${s.waist}:${+s.cap}:${s.tailRise}:${index}`,role,program:{name:role,description:`Static ${role} anatomy with exact mating ports.`,rootRotation:parts[root].rot,operations}};
      const cost:Stock={};for(const op of operations)cost[op.partId]=(cost[op.partId]??0)+1;
      compileConnections(option.program,cost);
      nodes.push({id:role,option,...(attachment?{attachment}:{})});placed.set(role,order);remaining.delete(role);progress=true;
    }
    if(!progress)throw Error('No connected anatomical module boundary');
  }
  return {id:`animal:${s.kind}:${s.length}:${s.feet}:${s.coat}:${s.ties}:${s.waist}:${+s.cap}:${s.tailRise}:${index}`,name:animalKindName(s.kind),description:`Static ${animalKindName(s.kind)} with four separate grounded feet, an open belly, a ${s.waist}-plate waist and raised chest/hips. ${s.kind==='dog'?'Moderate muzzle, hanging ears and narrow raised tail':s.kind==='fox'?'Long slender muzzle, alert ears and a substantial sweeping tail':'Broad compact chest/skull, short muzzle, rounded ears and a stub tail'}. ${s.length}-stud torso and ${s.feet==='round'?'round grounded legs':'separate projecting paws'}${s.cap?', recessed eye fronts below a thin forehead cap':''}.`,nodes};
}

export function animalModulePlans(stock:Stock,requestedSubject:string):AssemblyPlan[] {
  if(!stock||typeof stock!=='object'||Array.isArray(stock)||Object.values(stock).some(n=>!Number.isSafeInteger(n)||n<0))return [];
  const kinds=animalRelatedKinds(requestedSubject);if(!kinds.length)return [];
  const safe=Object.fromEntries(Object.entries(stock).filter(([id,n])=>{const k=parsePartId(id);return n>0&&k&&isMade(id)&&k.type!=='wheels'&&CATALOG[k.type]?.includes(`${k.w}x${k.d}`);}));
  const craft=foxCraftPlans(safe,requestedSubject);
  const refined=refinedAnimalPlans(safe,requestedSubject);
  const plans:AssemblyPlan[]=[],deadline=performance.now()+6300;
  for(const kind of kinds) {
    const kindDeadline=Math.min(deadline,performance.now()+2000);
    const profiles=[{waist:3,cap:true},{waist:3,cap:false},{waist:1,cap:false},{waist:1,cap:true}] as const;
    // Try relaxed facial/torso capability on each frame before spending the
    // budget on many paints, feet, stations or lengths of the strongest profile.
    for(const length of (kind==='fox'?[8,10]:kind==='bear'?[6,8]:[8,6]) as (6|8|10)[]) for(const feet of ['round','paw'] as const) for(const ties of ['corner','split'] as const) for(const tailRise of (kind==='dog'?[2,3]:[3]) as (2|3)[]) for(const {waist,cap} of profiles) for(const coat of ['warm','blue'] as const) {
    if(performance.now()>kindDeadline)continue;
    const smallTips=Object.entries(safe).filter(([id])=>{const k=parsePartId(id)!;return k.type==='cheese'&&k.w===1&&k.d===1&&(coat==='warm'?WARM:BLUE).includes(k.color);}).reduce((n,[,count])=>n+count,0);
    const shape:Shape={kind,length,feet,coat,ties,alertHeight:smallTips>=2?2:3,waist,cap,tailRise},zones=regions(shape);
    for(const [index,parts] of allocate(safe,zones,kindDeadline).entries()) {
      if(index>=2)break;
      try {
        const plan=modularPlan(parts,shape,index),candidate=composeModules(plan,safe,{minParts:20,maxParts:80});
        if(!animalCompositionIssues(candidate).length)plans.push(plan);
      }catch { /* Every actual module and finished animal must compile legally. */ }
    }
    }
  }
  // Keep actual species routing intact while trying each species' fuller
  // recipes before its existing stock-adaptable anatomical alternatives.
  return kinds.flatMap(kind=>{
    const name=animalKindName(kind);
    return [...craft.filter(p=>p.name===name),...refined.filter(p=>p.name===name),...plans.filter(p=>p.name===name)];
  });
}

type Bounds={min:number[];max:number[];size:number[];center:number[]};
function bounds(parts:Placed[]):Bounds {
  if(!parts.length)throw Error('Empty anatomy');const ff=parts.map(frame);
  const min=[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20),max=[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20);
  return {min,max,size:max.map((n,a)=>n-min[a]),center:max.map((n,a)=>(n+min[a])/2)};
}
const close=(a:number,b:number)=>Math.abs(a-b)<1e-6;

/** Species is measured from completed role geometry, never paint or the request.
 * Frame coordinates and all proportions here are in STUDS, including height. */
export function animalCompositionIssues(candidate:AssemblyComposition,subject=candidate.plan.name):string[] {
  const kind=animalSubjectKind(subject),actual=animalSubjectKind(candidate.plan.name),issues:string[]=[];
  if(!kind||!actual||actual==='quadruped'||candidate.plan.name!==animalKindName(actual))return ['Unsupported or noncanonical animal subject.'];
  if(kind!=='quadruped'&&kind!==actual)return ['Requested and actual animal kinds differ; review the explicitly labelled actual kind.'];
  if(candidate.plan.id.startsWith('animal-whole:'))return wholeAnimalIssues(candidate,subject);
  if(candidate.plan.id.startsWith('animal-improv:'))return foxImprovIssues(candidate);
  if(candidate.plan.id.startsWith('animal-craft:'))return foxCraftIssues(candidate);
  if(candidate.plan.id.startsWith('animal-refined:'))return refinedAnimalIssues(candidate);
  const parts=candidate.build.steps.flatMap(s=>s.parts),hasPaws=candidate.receipts.some(r=>r.role.startsWith('foot-'));
  const roles=['frame','chest','hips','torso','neck','head','face','muzzle','ear-left','ear-right','tail','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right',...(hasPaws?['foot-front-left','foot-front-right','foot-rear-left','foot-rear-right']:[])];
  if(parts.length<20||parts.length>80)issues.push('Animal needs 20–80 purposeful parts.');
  if(candidate.receipts.length!==roles.length||roles.some(r=>candidate.receipts.filter(p=>p.role===r).length!==1))return [...issues,'Animal requires all fifteen anatomical roles, plus all four paws when present.'];
  const indices=candidate.receipts.flatMap(r=>r.indices);
  if(indices.length!==parts.length||new Set(indices).size!==parts.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=parts.length))return [...issues,'Anatomy receipts must own every part exactly once.'];
  const module=(role:string)=>candidate.receipts.find(r=>r.role===role)!.indices.map(i=>parts[i]),b=(role:string)=>bounds(module(role));
  try {
    const body=b('frame'),chest=b('chest'),hips=b('hips'),waist=b('torso'),neck=b('neck'),head=b('head'),face=b('face'),muzzle=b('muzzle'),tail=b('tail'),ears=[b('ear-left'),b('ear-right')];
    const legRoles=roles.filter(r=>r.startsWith('leg-'));
    const legs=legRoles.map(role=>bounds([...module(role),...(hasPaws?module(role.replace('leg-','foot-')):[])])),axis=body.center[0],L=body.size[1];
    if(legs.some(p=>!close(p.min[2],0))||legs.some(p=>p.size[2]<1.1)||!legs.every(p=>p.size[0]<=1.1))issues.push('Four narrow separate feet must reach the shared ground plane.');
    if(legs[1].min[0]-legs[0].max[0]<1||legs[2].min[1]-legs[0].max[1]<1||!close((legs[0].center[0]+legs[1].center[0])/2,axis)||!close((legs[2].center[0]+legs[3].center[0])/2,axis))issues.push('Four feet must remain distinct front/rear and left/right load paths.');
    if(body.min[2]<1.1||waist.max[2]>=Math.min(chest.max[2],hips.max[2])-.3||waist.size[0]>2.1)issues.push('Animal needs an open belly and a lower narrow waist between raised chest and hips.');
    const voidParts=parts.filter(p=>{const bb=bounds([p]);return bb.min[2]<body.min[2]-.01&&bb.max[0]>legs[0].max[0]+.01&&bb.min[0]<legs[1].min[0]-.01&&bb.max[1]>legs[0].max[1]+.01&&bb.min[1]<legs[2].min[1]-.01;});
    if(voidParts.length)issues.push('The belly opening cannot contain scenery, padding or hidden supports.');
    if(neck.size[0]>chest.size[0]+.01||neck.size[1]>1.1||head.size[1]>L*.8||neck.min[1]>chest.max[1])issues.push('Neck and head must remain subordinate to the chest and torso.');
    const eyes=module('face').filter(p=>{const k=parsePartId(p.partId),bb=bounds([p]);return k?.type==='plate'&&k.w===1&&k.d===1&&DARK.includes(k.color)
      &&close(bb.min[2],face.min[2]+.4)&&(close(bb.min[0],face.min[0])||close(bb.max[0],face.max[0]));});
    if(eyes.length!==2)issues.push('The face needs two real separated dark eyes.');
    else {const ee=eyes.map(p=>bounds([p]));if(ee[1].min[0]-ee[0].max[0]<.9&&ee[0].min[0]-ee[1].max[0]<.9)issues.push('Eyes must be separated by a visible forehead, not a dark stripe.');}
    const nose=module('muzzle').filter(p=>{const k=parsePartId(p.partId),bb=bounds([p]);return k?.type==='plate'&&DARK.includes(k.color)&&close(bb.min[1],muzzle.min[1])&&close(bb.max[2],muzzle.max[2]);});
    if(nose.length!==1||muzzle.min[1]>=face.min[1]||muzzle.min[1]>=neck.min[1]||muzzle.size[0]>2.1)issues.push('A distinct visible nose must project ahead of both eyes and neck.');
    if(!ears[0].size.every((n,a)=>close(n,ears[1].size[a]))||!close(ears[0].min[1],ears[1].min[1])||!close(ears[0].min[2],ears[1].min[2]))issues.push('Paired ears must share actual shape and station.');
    if(tail.min[1]<hips.min[1]+.9||!module('tail').some(p=>module('hips').some(q=>connectionPairs(frame(p),frame(q)).length)))issues.push('The tail must attach directly at the rear hips.');
    const projection=face.min[1]-muzzle.min[1],tailProjection=tail.max[1]-body.max[1];
    if(actual==='dog') {
      if(projection<.9||projection>1.1||ears.some(e=>e.max[2]>head.max[2]-.5)||ears.some(e=>e.size[0]>1.1||e.size[1]<1.9))issues.push('Dog needs a moderate muzzle and genuinely low hanging ears.');
      if(tail.size[0]>1.1||tail.size[0]>=head.size[0]||tail.size[2]<1.8||tailProjection>.01+1)issues.push('Dog needs a narrow raised tail, not the fox sweeping tail.');
      if(chest.size[0]>2.1)issues.push('Dog chest must retain the narrower canine proportions.');
    } else if(actual==='fox') {
      if(projection<1.9||projection/muzzle.size[0]<.9||ears.some(e=>e.min[2]<head.max[2]-.01))issues.push('Fox needs a longer slender muzzle and alert ear tips above the skull.');
      if(tail.size[0]<1.9||tail.size[1]<3.9||tailProjection<2.9||tail.size[2]<1.8)issues.push('Fox needs a substantial thick sweeping tail, distinct from a dog tail.');
      if(chest.size[0]>2.1)issues.push('Fox needs a slender canine chest and waist.');
    } else {
      if(chest.size[0]<3.9||head.size[0]/L<.49||projection>.01+1||muzzle.size[0]<1.9)issues.push('Bear needs a broad compact chest/skull and a short broad muzzle.');
      if(module('ear-left').concat(module('ear-right')).some(p=>parsePartId(p.partId)?.type!=='curve'))issues.push('Bear needs real paired rounded ears.');
      if(tailProjection>1.01||tailProjection>L/4||tail.size[1]>2.1||tail.size[2]>.81)issues.push('Bear needs a compact rear stub, shorter than either canine tail.');
    }
    if(parts.some(p=>['wheels','wheel'].includes(parsePartId(p.partId)?.type??'')))issues.push('Animal anatomy must not contain wheels or scenery.');
  } catch {issues.push('Invalid or empty animal module geometry.');}
  return [...new Set(issues)];
}
