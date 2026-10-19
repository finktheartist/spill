/** A fixed, stock-bound feature sets the scale; the body is assembled around its real geometry.
 * Design order differs from instruction order. No volume fitting or resizing of the seed occurs. */
import { parsePartId, type Build, type Placed } from './bricks';
import { compileConnections, connectionPairs, frame, solidContains, validateConnections, type RequiredContact, type V3 } from './connections';
import { isMade } from './catalog';
import type { FeatureChoice } from './moc-features';
import type { FeatureReceipt } from './moc-feature-edit';

export interface FeaturePlan {
  choiceId: string; rotation: number; pose: string; traits: string[];
  /** Maximum body extent in studs, measured relative to the actual seed's dimensions. */
  bodySize: number[]; colors: string[];
}
export interface BodyPart extends Placed { role: string }
export interface FeatureBody { reasoning: string; parts: BodyPart[] }
export interface ReservedFeature {
  choice: FeatureChoice; plan: FeaturePlan; build: Build; parts: Placed[];
  remaining: Record<string,number>; size: number[];
}
export interface FeatureConstruction { build: Build; feature: FeatureReceipt; remaining: Record<string,number>; size: number[] }

const extent = (parts:Placed[]) => {
  const fs=parts.map(frame);
  const min=[0,1,2].map(i=>Math.min(...fs.map(f=>f.bounds.min[i])));
  const max=[0,1,2].map(i=>Math.max(...fs.map(f=>f.bounds.max[i])));
  return {min,max,size:max.map((v,i)=>(v-min[i])/20)};
};
/** Sampling the upper working space allows a narrow functional detail while preventing a cabinet fill. */
function bayClearance(seed:ReservedFeature,added:Placed[]) {
  if(seed.choice.studyId!=='open-working-bay')return '';
  const root=frame(seed.parts[0]),anchor=root.ports.find(p=>p.id==='stud:0:0')!.point,frames=added.map(frame),blocking=new Set<number>();
  let occupied=0;
  for(const x of [0,1])for(const y of [0,1])for(const z of [4.5,5.5,6.5]) {
    const local=[x*20,y*20,(z-1)*8],point=[0,1,2].map(i=>anchor[i]+local.reduce((n,v,j)=>n+root.rotation[i*3+j]*v,0));
    const hits=frames.flatMap((f,i)=>f.solids.some(s=>solidContains(s,point as V3))?[i]:[]);
    if(hits.length){occupied++;hits.forEach(i=>blocking.add(i));}
  }
  return occupied>6?`The protected upper working bay is filled by ${[...blocking].map(i=>`body ${i}`).join(', ')}. Keep at least half of the space below the front overhang open; the defining feature is an open bay, not a closed cabinet.`:'';
}

/** The planner and compiler share this exact bound; the chosen assembly determines it. */
export function featurePlanLimits(choice:FeatureChoice,rotation=0) {
  const build=compileConnections({...choice.program,rootRotation:rotation},choice.cost),parts=build.steps.flatMap(s=>s.parts),size=extent(parts).size;
  return {size,ceiling:Math.min(16,Math.max(6,Math.max(...size)*3))};
}

export function reserveFeature(choice:FeatureChoice, plan:FeaturePlan, stock:Record<string,number>):ReservedFeature {
  if(plan.choiceId!==choice.id || ![0,90,180,270].includes(plan.rotation))throw Error('Select an offered feature and a quarter-turn orientation.');
  if(typeof plan.pose!=='string'||!plan.pose.trim()||plan.pose.length>600||!Array.isArray(plan.traits)||plan.traits.length<2||plan.traits.length>3||plan.traits.some(t=>typeof t!=='string'||!t.trim()||t.length>200))throw Error('Protect two or three visible traits and specify a compact pose.');
  if(!Array.isArray(plan.colors)||plan.colors.length<1||plan.colors.length>5||new Set(plan.colors).size!==plan.colors.length||plan.colors.some(c=>!Object.entries(stock).some(([id,n])=>n>0&&parsePartId(id)?.color===c)))throw Error('Choose up to five distinct colors actually in the pile.');
  const remaining={...stock};
  for(const [id,n] of Object.entries(choice.cost)){
    if(!Number.isSafeInteger(remaining[id])||remaining[id]<n)throw Error(`The defining feature needs ${n} × ${id}.`);
    remaining[id]-=n;
  }
  const build=compileConnections({...choice.program,rootRotation:plan.rotation},stock),parts=build.steps.flatMap(s=>s.parts),size=extent(parts).size;
  // Generous, bounded envelope tied to actual feature size, not an unrelated large sculpture.
  const ceiling=featurePlanLimits(choice,plan.rotation).ceiling;
  if(!Array.isArray(plan.bodySize)||plan.bodySize.length!==3||plan.bodySize.some(n=>!Number.isFinite(n)||n<1||n>ceiling))throw Error(`Body extent must be three dimensions between 1 and ${ceiling} studs.`);
  return {choice,plan:structuredClone(plan),build,parts,remaining,size};
}

/** Exact stock after reservation is the only source for body parts. Seed parts cannot be edited/refunded. */
export function compileFeatureBody(seed:ReservedFeature, body:FeatureBody, stock:Record<string,number>, name:string, pitch:string, minParts=20):FeatureConstruction {
  if(!body||typeof body.reasoning!=='string'||body.reasoning.length>3000||!Array.isArray(body.parts)||body.parts.length>64)throw Error('Describe a body using at most 64 additional parts.');
  const remaining={...seed.remaining},preflight:string[]=[];
  const added=body.parts.map((p,i)=>{
    const k=p&&parsePartId(p.partId);
    if(!k)throw Error(`body ${i}: unknown part ${p?.partId}. Use an exact remaining-stock ID.`);
    if(k.type==='wheel'||k.type==='wheels')throw Error(`body ${i}: wheel/axle geometry is not supported by this connection compiler.`);
    if(!isMade(p.partId)||!seed.plan.colors.includes(k.color)||!Number.isSafeInteger(remaining[p.partId])||remaining[p.partId]<1)preflight.push(`body ${i}: ${p.partId} is unavailable after reserving the feature, or outside the planned colors.`);
    if(![0,90,180,270].includes(p.rot))throw Error(`body ${i}: rot=${p.rot} is invalid. Use DEGREES: 0, 90, 180 or 270, never quarter-turn counts 1, 2, 3.`);
    if(typeof p.role!=='string'||!p.role.trim()||p.role.length>100||![p.x,p.y,p.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=48)||p.orientation!==undefined)throw Error(`body ${i}: provide a short role, finite coordinates and no orientation matrix.`);
    remaining[p.partId]=(remaining[p.partId]??0)-1;
    return {partId:p.partId,x:p.x,y:p.y,z:p.z,rot:p.rot};
  });
  const parts=[...structuredClone(seed.parts),...added],seedCount=seed.parts.length;
  if(parts.length<minParts||parts.length>80)preflight.push(`The complete model needs ${minParts}–80 purposeful pieces; proposed ${parts.length}.`);
  if(!added.length||extent(added).size.some((v,i)=>v>seed.plan.bodySize[i]+1e-5))preflight.push(`Body extent [${added.length?extent(added).size.join(', '):'empty'}] exceeds the reserved [${seed.plan.bodySize.join(', ')}] STUD envelope along x,y,z respectively. Keep the body in proportion to the seed.`);
  const clearance=bayClearance(seed,added);if(clearance)preflight.push(clearance);
  const box=extent(parts);
  parts.forEach(p=>{p.x-=box.min[0]/20;p.y-=box.min[1]/20;p.z-=box.min[2]/8;});
  const fs=parts.map(frame),links=parts.map(()=>[] as number[]);
  for(let i=0;i<parts.length;i++)for(let j=0;j<i;j++)if(connectionPairs(fs[i],fs[j]).length){links[i].push(j);links[j].push(i);}
  const root=fs.findIndex(f=>Math.abs(f.bounds.min[2])<1e-5),order=[root],seen=new Set(order),parent=new Map<number,number>();
  for(let j=0;j<order.length;j++)for(const i of links[order[j]])if(!seen.has(i)){seen.add(i);order.push(i);parent.set(i,order[j]);}
  const label=(i:number)=>i<seedCount?`seed ${i}`:`body ${i-seedCount}`;
  const raw:Build={name,description:pitch,engine:'connections-v2',steps:parts.map(p=>({caption:'',parts:[p]})),requiredContacts:seed.build.requiredContacts};
  const structural=validateConnections(raw,stock,24).filter(i=>i.kind!=='floating');
  const errors=[...preflight,...structural.map(i=>`${i.message} [${i.parts.map(p=>label(parts.indexOf(p))).join(', ')}]`)];
  if(order.length!==parts.length)errors.unshift(`Disconnected: ${parts.flatMap((_,i)=>seen.has(i)?[]:[label(i)]).join(', ')}. Every body part must connect to the seed through real mating studs and grips.`);
  if(errors.length)throw Error([...new Set(errors)].slice(0,30).join('\n'));
  const indices=new Map(order.map((i,j)=>[i,j]));
  const contacts:RequiredContact[]=(seed.build.requiredContacts??[]).map(c=>({...c,a:indices.get(c.a)!,b:indices.get(c.b)!}));
  const build:Build={name,description:pitch,engine:'connections-v2',requiredContacts:contacts,steps:order.map((i,j)=>({
    caption:!j?'Place this first piece flat on the table.':`${i<seedCount?seed.choice.name:body.parts[i-seedCount].role}: attach to the piece from step ${indices.get(parent.get(i)!)!+1}. Match the orientation shown.`,parts:[parts[i]],
  }))};
  const issues=validateConnections(build,stock,24);if(issues.length)throw Error(issues.map(i=>i.message).join('\n'));
  return {build,remaining,size:box.size,feature:{id:'seed',studyId:seed.choice.studyId,choiceId:seed.choice.id,cost:{...seed.choice.cost},indices:seed.parts.map((_,i)=>indices.get(i)!)} };
}

/** Real coordinates rather than idealized sizes; all seed connectors are included for underside attachment. */
export function seedGeometry(seed:ReservedFeature) {
  return seed.parts.map((p,i)=>{const f=frame(p);return `seed ${i}: ${p.partId}; body min=[${[p.x,p.y,p.z]}], max=[${f.bounds.max.map((n,j)=>n/(j===2?8:20))}]; ports ${f.ports.map(c=>`${c.id}=${c.point.map((n,j)=>n/(j===2?8:20)).join(',')}`).join('; ')}`;}).join('\n');
}

/** A small pile can omit an invalid extra piece instead of corrupting the whole design. Search only
 * pieces named in the first concrete error, at most three removals/40 trials. Never touch the seed,
 * move/recolor a part, relax stock or the part floor. The resulting silhouette still needs blind review. */
export function simplifyFeatureBody(seed:ReservedFeature, body:FeatureBody, stock:Record<string,number>, name:string, pitch:string, minParts=20) {
  if(!Array.isArray(body?.parts)||body.parts.length>64)return null;
  const queue:{removed:number[]}[]=[{removed:[]}],seen=new Set<string>();
  for(let trial=0;queue.length&&trial<40;trial++) {
    const {removed}=queue.shift()!,key=removed.join(',');if(seen.has(key))continue;seen.add(key);
    const kept=body.parts.map((p,i)=>({p,i})).filter(({i})=>!removed.includes(i));
    if(kept.length+seed.parts.length<minParts)continue;
    const actual={...body,parts:kept.map(({p})=>p)};
    try{return {construction:compileFeatureBody(seed,actual,stock,name,pitch,minParts),body:actual,removed};}
    catch(e){
      if(removed.length>=3)continue;
      const first=(e as Error).message.split('\n')[0];
      const indices=[...new Set([...first.matchAll(/body (\d+)/g)].map(m=>Number(m[1])))].filter(i=>i>=0&&i<kept.length);
      for(const i of indices.slice(0,6))queue.push({removed:[...removed,kept[i].i].sort((a,b)=>a-b)});
    }
  }
  return null;
}
