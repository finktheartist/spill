import { parsePartId, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { connectionPairs, frame, type ConnectionOperation } from '../connections';
import type { AssemblyComposition, AssemblyNode, AssemblyOption, AssemblyPlan } from './types';

/** Pilot support is deliberately narrow: no flying boats, biplanes or invented hardware. */
const supported = (subject:string) => /^(?:twin[\s-]+boom[\s-]+)?(?:seaplane|floatplane)$/i.test(subject.trim());
const FLOAT_COLORS = ['dark-azure','azure','dark-blue','white','light-gray','reddish-brown','bright-light-orange'];
const AIRFRAME_COLORS = ['bright-light-orange','orange','white','blue','azure','yellow','red','reddish-brown'];
const STRUCTURE_COLORS = ['white','dark-blue','black','light-gray','dark-gray','azure','tan','reddish-brown'];
type Stock = Record<string,number>;
type FloatShape = { width:1|2; baseLength:4|6|8; extension:boolean };
type WingShape = { chord:1|2; length:4|6|8 };

/** One reservation ledger per complete proposal; neither repeated modules nor color
 * alternatives get independent copies of the pile. IDs always come from actual stock. */
class Ledger {
  private remaining:Stock;
  constructor(stock:Stock) {
    this.remaining = Object.fromEntries(Object.entries(stock).filter(([id,n]) =>
      Number.isSafeInteger(n) && n > 0 && parsePartId(id) && isMade(id)));
  }
  take(type:string,w:number,d:number,colors:string[],count=1):string {
    const available = Object.keys(this.remaining).filter(id => {
      const p = parsePartId(id)!;
      return p.type === type && p.w === w && p.d === d && this.remaining[id] >= count;
    }).sort((a,b) => {
      const rank = (id:string) => { const n=colors.indexOf(parsePartId(id)!.color); return n<0 ? colors.length : n; };
      return rank(a)-rank(b) || a.localeCompare(b);
    });
    if (!available.length) throw Error(`No ${count} copies of ${type}-${w}x${d}`);
    const id=available[0]; this.remaining[id]-=count; return id;
  }
  pair(type:string,w:number,d:number,colors:string[]):[string,string] {
    const id=this.take(type,w,d,colors,2); return [id,id];
  }
  /** Matching fin shapes may share a neutral/blue paint family when the pile has
   * singleton shades. This never substitutes a different geometry or extra stock. */
  finPair():[string,string] {
    try { return this.pair('brick',1,2,['dark-azure','dark-blue','light-gray','dark-gray','white']); } catch { /* try one coherent family */ }
    for (const colors of [['dark-azure','dark-blue','blue','azure'],['light-gray','dark-gray','black','white']]) {
      const ids=Object.keys(this.remaining).filter(id => {
        const p=parsePartId(id)!; return p.type==='brick' && p.w===1 && p.d===2 && colors.includes(p.color) && this.remaining[id]>0;
      }).sort((a,b)=>colors.indexOf(parsePartId(a)!.color)-colors.indexOf(parsePartId(b)!.color));
      if(ids.length>=2) { this.remaining[ids[0]]--; this.remaining[ids[1]]--; return [ids[0],ids[1]]; }
    }
    throw Error('No coherent pair of narrow vertical-fin bases');
  }
}

function recipe(role:string,tag:string,rootRotation=0) {
  const operations:ConnectionOperation[]=[];
  const put=(partId:string,parent=-1,parentPort='',childPort='grip:0:0',twist=0) => {
    operations.push({partId,parent,parentPort,childPort,twist}); return operations.length-1;
  };
  const finish=():AssemblyOption => ({id:`${role}:${tag}`,role,program:{
    name:role,description:`Fixed ${role} subassembly, connected through exact catalog ports.`,rootRotation,operations,
  }});
  return {put,finish};
}

function floatOption(role:string,shape:FloatShape,ids:{base:string;nose:string;rear:string;extension?:string;tapered?:boolean}):AssemblyOption {
  const r=recipe(role,`${shape.width}x${shape.extension?6:shape.baseLength}${ids.tapered?'-tapered':''}`,90);
  const root=r.put(ids.base);
  // The root plate runs fore/aft after its explicit 90-degree pose. A slope's
  // canonical run is along y, hence -90 around the rotated root's top stud.
  r.put(ids.nose,root,`stud:0:${shape.width-1}`,'grip:0:0',-90);
  if(shape.extension) {
    const rear=r.put(ids.extension!,root,`stud:3:${shape.width-1}`,`grip:0:${shape.width-1}`);
    r.put(ids.rear,rear,`stud:2:${shape.width-1}`,'grip:0:0',-90);
  } else if(ids.tapered) r.put(ids.rear,root,`stud:${shape.baseLength-1}:0`,'grip:0:0',90);
  else r.put(ids.rear,root,`stud:${shape.baseLength-2}:0`);
  return r.finish();
}

function proposal(stock:Stock,subject:string,float:FloatShape,wing:WingShape,boomLength:6|8,high:boolean,setback:0|1,stepped:boolean,crafted=false):AssemblyPlan {
  const ledger=new Ledger(stock);
  const floatBase=ledger.pair('plate',float.width,float.baseLength,FLOAT_COLORS);
  const floatNose=ledger.pair('slope',float.width,2,FLOAT_COLORS);
  const floatRear=crafted ? ledger.pair('curve',1,2,FLOAT_COLORS) : ledger.pair('tile',1,2,FLOAT_COLORS);
  const floatExtension=float.extension ? ledger.pair('plate',2,3,FLOAT_COLORS) : undefined;
  const beamLength=float.width===1 ? 6 : 8;
  const beamChord=float.extension ? 1 : 2;
  const beam=ledger.take('plate',beamChord,beamLength,STRUCTURE_COLORS);
  const spine=ledger.take('plate',2,6,STRUCTURE_COLORS);
  const nose=ledger.take('curve',2,2,AIRFRAME_COLORS);
  const cabin=ledger.take('brick',2,crafted?2:3,crafted?['black','dark-gray','dark-blue']:['black','dark-blue','dark-gray']);
  const glazing=crafted ? [ledger.take('tile',1,2,['dark-azure','black','azure','trans-clear'])]
    : ledger.pair('curve',1,2,['black','dark-azure','azure','medium-blue','trans-clear']);
  const aftCap=crafted ? ledger.take('slope',2,2,['dark-orange','bright-light-orange','orange'])
    : ledger.take('tile',1,2,['white','black','dark-azure',...AIRFRAME_COLORS]);
  // Reserve matched flying surfaces before choosing the center connector.
  const wings=ledger.pair('plate',wing.chord,wing.length,AIRFRAME_COLORS);
  const wingCorners=stepped || crafted ? ledger.pair('cornerplate',2,2,AIRFRAME_COLORS) : undefined;
  const trailing=crafted ? ledger.pair('plate',1,4,[parsePartId(wings[0])!.color,...AIRFRAME_COLORS]) : undefined;
  const engines=crafted ? ledger.pair('curve',1,2,['red','black','dark-gray',...AIRFRAME_COLORS]) : undefined;
  const booms=ledger.pair('plate',1,boomLength,['reddish-brown','white','dark-gray',...AIRFRAME_COLORS]);
  const hub=high ? ledger.take('brick',2,2,['light-gray','white','dark-gray']) : ledger.take('plate',2,2,['azure','white','tan','dark-orange']);
  const tailplane=ledger.take('plate',1,4,['yellow','white',...AIRFRAME_COLORS]);
  const shortFinBase=crafted ? ledger.take('plate',1,2,AIRFRAME_COLORS,4) : undefined;
  const finBases=crafted ? [shortFinBase!,shortFinBase!] : ledger.finPair();
  const finTops=ledger.pair('slope',1,2,['dark-azure','dark-blue','light-gray','white','blue']);
  const tag=`${crafted?'crafted-':''}f${float.width}-${float.baseLength}${float.extension?'e':''}-w${wing.chord}-${wing.length}-b${boomLength}-${high?'high':'shoulder'}-${setback}-${crafted?'composite':stepped?'chord':'slim'}`;
  const nodes:AssemblyNode[]=[];
  const add=(id:string,option:AssemblyOption,attachment?:AssemblyNode['attachment']) => nodes.push({id,option,...(attachment?{attachment}:{})});
  const attach=(parent:string,parentPart:number,parentPort:string,childPort='grip:0:0',twist=0) => ({parent,parentPart,parentPort,childPort,twist});
  add('float-left',floatOption('float-left',float,{base:floatBase[0],nose:floatNose[0],rear:floatRear[0],extension:floatExtension?.[0],tapered:crafted}));
  const beamRecipe=recipe('float-crossbeam',`${beamChord}x${beamLength}`); beamRecipe.put(beam);
  add('float-crossbeam',beamRecipe.finish(),attach('float-left',0,`stud:2:${float.width-1}`,'grip:0:0',-90));
  // Downward mating reverses the twist sign, placing the second complete float
  // alongside the first at the same waterline. Its module root is not recolored.
  add('float-right',floatOption('float-right',float,{base:floatBase[1],nose:floatNose[1],rear:floatRear[1],extension:floatExtension?.[1],tapered:crafted}),
    attach('float-crossbeam',0,`grip:${beamLength-float.width}:0`,`stud:2:${float.width-1}`,-90));
  const body=recipe('fuselage',crafted?'tapered-pod':'six-stud-pod',90);
  const floor=body.put(spine);
  body.put(nose,floor,'stud:0:1','grip:0:0',-90);
  const cockpit=body.put(cabin,floor,'stud:2:1','grip:0:1');
  body.put(glazing[0],cockpit,'stud:0:1','grip:0:0',-90);
  if(!crafted) body.put(glazing[1],cockpit,'stud:0:0','grip:0:0',-90);
  body.put(aftCap,floor,crafted?'stud:5:0':'stud:5:1','grip:0:0',crafted?90:-90);
  add('fuselage',body.finish(),attach('float-crossbeam',0,`stud:${beamLength/2-1}:0`,`grip:${setback===1?1:2}:1`,90));
  const root=recipe('wing-root',high?'pylon':'shoulder'); root.put(hub);
  add('wing-root',root.finish(),attach('fuselage',cockpit,crafted?'stud:1:1':'stud:2:1','grip:0:0',-90));
  for(const side of ['left','right'] as const) {
    const r=recipe(`wing-${side}`,`${wing.chord}x${wing.length}-${crafted?'composite':stepped?'stepped':'slim'}`);
    const w=r.put(wings[side==='left'?0:1]);
    if(crafted) {
      // Both principal panels lie at z=0. The L carrier sits above them and
      // actually grips a stud on each panel; a shared edge alone is never a join.
      const carrier=side==='left'
        ? r.put(wingCorners![0],w,`stud:${wing.length-4}:0`)
        : r.put(wingCorners![1],w,'stud:2:0','grip:0:1',90);
      if(side==='left') {
        r.put(trailing![0],carrier,'grip:0:1','stud:0:0');
        r.put(engines![0],carrier,'stud:1:0','grip:0:1');
      } else {
        r.put(trailing![1],carrier,'grip:1:0','stud:3:0',90);
        r.put(engines![1],carrier,'stud:0:1','grip:0:1',-90);
      }
    } else if(wingCorners) {
      if(side==='left') r.put(wingCorners[0],w,`stud:${wing.length-3}:0`,'grip:1:0');
      else r.put(wingCorners[1],w,'stud:2:0','grip:0:1',90);
    }
    add(`wing-${side}`,r.finish(),attach('wing-root',0,`stud:${side==='left'?0:1}:0`,`grip:${side==='left'?wing.length-1:0}:0`));
  }
  for(const side of ['left','right'] as const) {
    const r=recipe(`boom-${side}`,`one-by-${boomLength}`,90); r.put(booms[side==='left'?0:1]);
    add(`boom-${side}`,r.finish(),attach(`wing-${side}`,0,`stud:${side==='left'?wing.length-2:1}:0`,'grip:0:0',90));
  }
  const tail=recipe('tail',crafted?'bridged-matched-short-fins':'bridged-twin-fins'); const horizontal=tail.put(tailplane);
  for(const [index,x] of [0,3].entries()) {
    let fin=tail.put(finBases[index],horizontal,`stud:${x}:0`,'grip:0:0',90);
    if(crafted) fin=tail.put(finBases[index],fin,'stud:0:0');
    tail.put(finTops[index],fin,'stud:0:0','grip:0:0',-90);
  }
  add('tail',tail.finish(),attach('boom-left',0,`stud:${boomLength-1}:0`,'grip:0:0',-90));
  return {id:`aircraft:${tag}`,name:subject,description:`Static twin-boom floatplane: separated ${float.width}-stud-wide pontoons, ${wing.length*2}-stud projecting wings, a forward cockpit, paired ${boomLength}-stud tail booms and two upright tapered fins. ${high?'Raised high-wing pylon':'Shoulder-mounted wing'}; ${crafted?'coplanar two-stud inner wing chord, narrow tips, paired raised engine fairings, tapered aft pod/floats and matching short fins':stepped?'stepped chord extensions':'thin unbroken wing panels'}.`,nodes};
}

/** Enumerate geometry choices, not painted copies of a single blueprint. Missing
 * capabilities fail closed. The composer remains the authority for full collisions,
 * exact stock accounting and final assembly validity. No provider calls or fitting. */
export function aircraftModulePlans(stock:Stock,subject:string):AssemblyPlan[] {
  if(typeof subject!=='string' || subject.length>80 || !supported(subject) || !stock || typeof stock!=='object' || Array.isArray(stock)) return [];
  if(Object.values(stock).some(n=>!Number.isSafeInteger(n)||n<0)) return [];
  const floats:FloatShape[]=[{width:1,baseLength:6,extension:false},{width:1,baseLength:8,extension:false},{width:2,baseLength:4,extension:true}];
  const wings:WingShape[]=[{chord:1,length:6},{chord:2,length:4},{chord:1,length:8},{chord:2,length:6}];
  const plans:AssemblyPlan[]=[];
  // Craft-improved panels go first in bounded search. Existing legal assemblies
  // remain alternatives; this prefix spends stock on shape, never hidden fill.
  for(const high of [false,true]) for(const setback of [0,1] as const)
    for(const f of floats.filter(f=>f.width===1)) for(const length of [6,8] as const) for(const b of [8,6] as const) {
      try { plans.push(proposal(stock,subject,f,{chord:1,length},b,high,setback,false,true)); }
      catch { /* These exact paired components are absent or already reserved. */ }
    }
  // Round-robin shapes before height/station variants: a small search limit still
  // sees materially different float, wing and boom geometries.
  for(const stepped of [false,true]) for(const high of [false,true]) for(const setback of [0,1] as const)
    for(const f of floats) for(const w of wings) for(const b of [8,6] as const) {
      try {
        const plan=proposal(stock,subject,f,w,b,high,setback,stepped);
        const count=plan.nodes.reduce((n,node)=>n+node.option.program.operations.length,0);
        if(count>=20 && count<=60) plans.push(plan);
      } catch { /* Insufficient actual shapes/counts for this layout. */ }
      if(plans.length>=96) return plans;
    }
  return plans;
}

type Bounds = {min:number[];max:number[];size:number[];center:number[]};
function bounds(parts:Placed[]):Bounds {
  const frames=parts.map(frame);
  const min=[0,1,2].map(a=>Math.min(...frames.map(f=>f.bounds.min[a]))/20);
  const max=[0,1,2].map(a=>Math.max(...frames.map(f=>f.bounds.max[a]))/20);
  return {min,max,size:max.map((n,a)=>n-min[a]),center:max.map((n,a)=>(n+min[a])/2)};
}
const close=(a:number,b:number)=>Math.abs(a-b)<1e-6;

/** Purposeful role and silhouette guard, separate from blind visual qualification.
 * All three axes below are STUDS. Fins are measured from their actual rigid frames,
 * including non-plate heights; no 6-stud restriction is imposed on the wings. */
export function aircraftCompositionIssues(candidate:AssemblyComposition,subject:string):string[] {
  if(!supported(subject)) return ['This aircraft subject needs an unsupported layout.'];
  const issues:string[]=[];
  const parts=candidate.build.steps.flatMap(s=>s.parts);
  const roles=['float-left','float-right','float-crossbeam','fuselage','wing-root','wing-left','wing-right','boom-left','boom-right','tail'];
  if(parts.length<20 || parts.length>60) issues.push('Aircraft must contain 20–60 purposeful parts.');
  if(candidate.receipts.length!==roles.length || roles.some(role=>candidate.receipts.filter(r=>r.role===role).length!==1)) return [...issues,'Aircraft must contain exactly the ten supported aircraft roles.'];
  const indexSets=candidate.receipts.flatMap(r=>r.indices);
  if(new Set(indexSets).size!==parts.length || indexSets.length!==parts.length || indexSets.some(i=>!Number.isSafeInteger(i)||i<0||i>=parts.length)) return [...issues,'Role receipts must own every aircraft part exactly once.'];
  const module=(role:string)=>candidate.receipts.find(r=>r.role===role)!.indices.map(i=>parts[i]);
  const b=(role:string)=>bounds(module(role));
  const optionId=(role:string)=>candidate.receipts.find(r=>r.role===role)!.optionId;
  // Only the fourth part of the explicit composite recipe is a nacelle. Unknown
  // additions remain flying-surface geometry and cannot bypass wing thinness.
  const composite=(role:string)=>new RegExp(`^${role}:1x[68]-composite$`).test(optionId(role));
  const surface=(role:string)=>composite(role)?module(role).filter((_,i)=>i!==3):module(role);
  let left:Bounds,right:Bounds,body:Bounds,lw:Bounds,rw:Bounds,lb:Bounds,rb:Bounds,tail:Bounds;
  try { left=b('float-left');right=b('float-right');body=b('fuselage');lw=bounds(surface('wing-left'));rw=bounds(surface('wing-right'));lb=b('boom-left');rb=b('boom-right');tail=b('tail'); } catch { return [...issues,'Aircraft contains invalid or empty module geometry.']; }
  const axis=(left.center[0]+right.center[0])/2;
  if(right.min[0]-left.max[0]<1 || left.size[1]<5 || left.size[1]<left.size[0]*2.5) issues.push('Floats must be separated, narrow and at least five studs long.');
  if(!left.size.every((n,i)=>close(n,right.size[i])) || !close(left.min[1],right.min[1]) || !close(left.min[2],right.min[2])) issues.push('The two floats must have matching proportions and a shared waterline.');
  const floatSignature=(role:string)=>{
    const pp=module(role),bb=b(role);
    return pp.map(p=>{const f=frame(p);return JSON.stringify([p.partId,...f.rotation,...f.bounds.min.map((n,a)=>Number((n/20-bb.min[a]).toFixed(6)))]);}).sort();
  };
  if(JSON.stringify(floatSignature('float-left'))!==JSON.stringify(floatSignature('float-right'))) issues.push('Paired floats must use matching shapes, paint and relative geometry.');
  if(!close(body.center[0],axis) || body.size[0]>2.1 || body.size[1]<4 || body.size[1]>7 || body.size[2]>3.8 || body.size[1]<body.size[0]*2) issues.push('The forward fuselage must remain a centered, slender cockpit pod.');
  const span=rw.max[0]-lw.min[0];
  if(span<8 || span<body.size[1]*1.25 || lw.min[0]>body.min[0]-2 || rw.max[0]<body.max[0]+2 || !close((lw.min[0]+rw.max[0])/2,axis)) issues.push('Wings must project symmetrically well beyond the narrow body.');
  if(lw.size[2]>.81 || rw.size[2]>.81 || Math.max(lw.size[1],rw.size[1])>3.1 || !close(lw.min[1],rw.min[1]) || !close(lw.min[2],rw.min[2])) issues.push('Wings must be thin matched surfaces at one fore/aft station.');
  if(surface('wing-left').concat(surface('wing-right')).some(p=>!['plate','cornerplate'].includes(parsePartId(p.partId)?.type??''))) issues.push('Wing geometry must be actual thin flying surfaces, not stacked body bricks.');
  if(composite('wing-left') || composite('wing-right')) {
    if(!composite('wing-left') || !composite('wing-right') || span<1.4*(right.max[0]-left.min[0])) issues.push('Composite wings must span at least 1.4 times the outer float span.');
    const engines:Placed[]=[];
    for(const side of ['left','right']) {
      const wingParts=module(`wing-${side}`);
      if(wingParts.length!==4) { issues.push('A composite wing needs exactly two panels, one stitch carrier and one engine fairing.'); continue; }
      const [leading,carrier,trailing,engine]=wingParts;
      const [lead,stitch,trail,nacelle]=wingParts.map(p=>bounds([p]));
      const ids=wingParts.map(p=>parsePartId(p.partId)!);
      const panelShape=ids[0]?.type==='plate' && ids[0].w===1 && [6,8].includes(ids[0].d)
        && ids[1]?.type==='cornerplate' && ids[1].w===2 && ids[1].d===2
        && ids[2]?.type==='plate' && ids[2].w===1 && ids[2].d===4;
      const coplanar=close(lead.min[2],trail.min[2]) && close(lead.max[2],trail.max[2])
        && close(trail.min[1],lead.max[1]) && close(trail.size[0],4) && close(trail.size[1],1)
        && close(side==='left'?trail.max[0]:trail.min[0],side==='left'?lead.max[0]:lead.min[0]);
      if(!panelShape || !coplanar || !close(stitch.min[2],lead.max[2])
        || !connectionPairs(frame(leading),frame(carrier)).length || !connectionPairs(frame(trailing),frame(carrier)).length) {
        issues.push('Composite wings need coplanar leading/trailing panels and a real overlapping stitch connection, with narrow outer tips.');
      }
      if(ids[3]?.type!=='curve' || ids[3].w!==1 || ids[3].d!==2
        || !close(nacelle.size[0],1) || !close(nacelle.size[1],2) || !close(nacelle.size[2],.8)
        // The actual rear socket is .4 stud above the lowest curved face.
        || !close(nacelle.min[2]+.4,stitch.max[2]) || !close(nacelle.min[1],lead.min[1]-1)
        || !close(nacelle.center[0],axis+(side==='left'?-2.5:2.5))
        || !connectionPairs(frame(carrier),frame(engine)).length) {
        issues.push('Engine fairings must be real narrow fore/aft curves connected near the wing roots.');
      }
      engines.push(engine);
    }
    if(engines.length===2) {
      const [a,z]=engines.map(p=>bounds([p]));
      if(engines[0].partId!==engines[1].partId || !close(a.min[1],z.min[1]) || !close(a.min[2],z.min[2])
        || !close((a.center[0]+z.center[0])/2,axis)) issues.push('Paired engine fairings must match in shape, paint and station.');
    }
  }
  if(lb.size[0]>1.1 || rb.size[0]>1.1 || !close(lb.size[1],rb.size[1]) || lb.size[1]<6 || rb.min[0]-lb.max[0]<1 || !close((lb.center[0]+rb.center[0])/2,axis)) issues.push('A twin-boom aircraft requires two distinct narrow symmetric tail booms.');
  if(tail.min[1]<body.max[1]+2 || !close(tail.center[0],axis) || tail.size[2]<2 || tail.size[0]<3.9) issues.push('The tail must sit behind the body and visibly bridge both booms with upright fins.');
  const tailRoot=module('tail')[0];
  if(!connectionPairs(frame(module('boom-left')[0]),frame(tailRoot)).length || !connectionPairs(frame(module('boom-right')[0]),frame(tailRoot)).length) issues.push('The tailplane must actually connect to both boom tips.');
  const tailParts=module('tail');
  if(optionId('tail')==='tail:bridged-matched-short-fins') {
    if(tailParts.length!==7) issues.push('Short twin fins need two complete stacked-plate bases and matched tapered caps.');
    else {
      const finStacks=[tailParts.slice(1,4),tailParts.slice(4,7)];
      for(const stack of finStacks) {
        const bb=bounds(stack),[bottom,upper,cap]=stack.map(p=>bounds([p]));
        const ids=stack.map(p=>parsePartId(p.partId)!);
        if(!ids.slice(0,2).every(p=>p?.type==='plate' && p.w===1 && p.d===2)
          || ids[2]?.type!=='slope' || ids[2].w!==1 || ids[2].d!==2
          || !close(bb.size[0],1) || !close(bb.size[1],2) || !close(bb.size[2],2)
          || !close(bottom.min[2],bounds([tailRoot]).max[2]) || !close(bottom.max[2],upper.min[2]) || !close(upper.max[2],cap.min[2])
          || !connectionPairs(frame(stack[0]),frame(stack[1])).length || !connectionPairs(frame(stack[1]),frame(stack[2])).length) {
          issues.push('Short fin bases must form two thin upright plate stacks with real tapered caps.');
        }
      }
      if(finStacks[0].some((p,i)=>p.partId!==finStacks[1][i].partId)
        || !close(bounds(finStacks[0]).min[1],bounds(finStacks[1]).min[1])
        || !close(bounds(finStacks[1]).center[0]-bounds(finStacks[0]).center[0],3)) {
        issues.push('Short twin fins must match in paint and geometry at the two boom tips.');
      }
    }
  } else {
    const fins=tailParts.filter(p=>parsePartId(p.partId)?.type==='brick');
    if(fins.length!==2 || fins.some(p=>{const bb=bounds([p]);return bb.size[0]>1.1 || bb.size[2]<1.1;})) issues.push('The tail needs two thin upright fin bases, not one generic block or horizontal plate.');
  }
  const fuselage=module('fuselage');
  const tapered=optionId('fuselage')==='fuselage:tapered-pod';
  if(fuselage.length!==(tapered?5:6) || !['curve','slope'].includes(parsePartId(fuselage[1]?.partId)?.type??'')
    || !fuselage[2] || bounds([fuselage[1]]).center[1]>=body.center[1] || bounds([fuselage[2]]).size[2]<1.1) issues.push('The body needs a shaped forward nose and a distinct raised cockpit.');
  if(tapered && fuselage.length===5) {
    const cabin=bounds([fuselage[2]]),glass=bounds([fuselage[3]]),aft=bounds([fuselage[4]]);
    if(parsePartId(fuselage[3].partId)?.type!=='tile' || !close(glass.size[0],2) || !close(glass.size[1],1)
      || !close(glass.min[2],cabin.max[2]) || !close(glass.min[1],cabin.min[1])
      || parsePartId(fuselage[4].partId)?.type!=='slope' || !close(aft.min[1],cabin.max[1])
      || !close(aft.max[1],body.max[1]) || !close(frame(fuselage[4]).rotation[0],-1)
      || !close(frame(fuselage[4]).rotation[4],-1)) issues.push('The tapered pod needs forward cockpit glazing and a descending aft slope.');
  }
  const forbidden=parts.filter(p=>['wheel','wheels'].includes(parsePartId(p.partId)?.type??''));
  if(forbidden.length) issues.push('This floatplane must not add wheels or a display pedestal.');
  return issues;
}
