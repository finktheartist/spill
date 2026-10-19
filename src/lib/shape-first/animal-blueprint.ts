import { CATALOG, COLORS, parsePartId, type ColorName, type Placed } from '../bricks';
import { isMade } from '../catalog';
import { connectionPairs, corners, cross, definition, dot, frame, validateConnections, type Solid, type V3 } from '../connections';
import type { AssemblyComposition } from '../assembly-composer/types';

export const ANIMAL_BLUEPRINT_ROLES = ['chest','hips','torso','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right',
  'tail','head','neck','muzzle','nose','eye-left','eye-right','ear-left','ear-right','frame'] as const;
export type AnimalBlueprintRole = typeof ANIMAL_BLUEPRINT_ROLES[number];
export interface AnimalBlueprintBox { min:V3; max:V3 }
export interface AnimalBlueprintRegion extends AnimalBlueprintBox {
  role:AnimalBlueprintRole; tolerance:number;
  /** Visual goals; nominal profile checks below are not measured visual quality
   * or proof that a surface is exposed in a rendered view. */
  intent:'mass'|'taper'|'pointed'|'thin'|'small'|'support'; exterior:boolean;
}
export interface AnimalBlueprintReservation {
  partId:string; count:number; role:AnimalBlueprintRole;
  /** CARRIERS ONLY: a count1 exact physical binding shared across features. */
  shared?:string;
}
export interface AnimalBlueprintFeature {
  id:string; description:string;
  intent:'pointed-ears'|'projecting-muzzle'|'separated-eyes-nose'|'contoured-body'|'sweeping-tail';
  pairing:'none'|'same-shape'|'identical-id';
  /** Default reserved-only. Anatomy paths may also use real, stock-billed
   * parts owned by declared carrier roles; this changes no reservation cost. */
  supportMode?:'reserved-only'|'anatomy';
  pieces:AnimalBlueprintReservation[]; carriers:AnimalBlueprintReservation[];
}
export interface AnimalBlueprint {
  version:1; id:string; subject:'Fox'; description:string; stance:'standing'|'crouching';
  parts:{min:number;max:number}; size:{min:V3;max:V3};
  palette:{coat:ColorName[];accent:ColorName[];dark:ColorName[]};
  proportions:{bodyLengthToWidth:[number,number];headWidthToBody:[number,number];muzzleProjection:[number,number];tailProjection:[number,number];earRise:[number,number]};
  regions:AnimalBlueprintRegion[];
  emptyRegions:(AnimalBlueprintBox&{id:string})[];
  features:AnimalBlueprintFeature[];
}
export interface AnimalBlueprintReservations {
  features:{id:string;supportMode?:AnimalBlueprintFeature['supportMode'];pieces:AnimalBlueprintReservation[];carriers:AnimalBlueprintReservation[]}[];
  total:Record<string,number>; remaining:Record<string,number>; bodyAvailable:number;
}
export interface AnimalBlueprintValidation { blueprint:AnimalBlueprint|null; issues:string[]; reservations?:AnimalBlueprintReservations }
/** Kernel may supply final graph indices. Otherwise roles are read only from
 * exact operation annotations or explicit anatomical module receipts. */
export type AnimalBlueprintRoleIndices = Partial<Record<AnimalBlueprintRole,number[]>>;
export type AnimalBlueprintComposition = AssemblyComposition & { roleIndices?:AnimalBlueprintRoleIndices };

const ROLES = new Set<string>(ANIMAL_BLUEPRINT_ROLES), REQUIRED = ANIMAL_BLUEPRINT_ROLES.filter(r=>r!=='frame');
const DARK = new Set(['black','dark-gray','dark-brown']);
const COATS = [['reddish-brown','dark-brown','medium-nougat','nougat'],['orange','dark-orange','bright-light-orange','medium-nougat'],['white','light-gray','tan','dark-tan'],['black','dark-gray']];
const ACCENTS = new Set(['white','tan','dark-tan','medium-nougat','black','dark-gray','dark-brown']);
const EPS=1e-5;
const tuple={type:'ARRAY',items:{type:'NUMBER'}};
const partSchema={type:'OBJECT',required:['partId','count','role'],properties:{partId:{type:'STRING'},count:{type:'NUMBER'},role:{type:'STRING',enum:[...ANIMAL_BLUEPRINT_ROLES]}}};
const carrierSchema={...partSchema,properties:{...partSchema.properties,shared:{type:'STRING'}}};
export const ANIMAL_BLUEPRINT_SCHEMA = {type:'OBJECT',required:['version','id','subject','description','stance','parts','size','palette','proportions','regions','emptyRegions','features'],properties:{
  version:{type:'NUMBER'},id:{type:'STRING'},subject:{type:'STRING',enum:['Fox']},description:{type:'STRING'},stance:{type:'STRING',enum:['standing','crouching']},
  parts:{type:'OBJECT',required:['min','max'],properties:{min:{type:'NUMBER'},max:{type:'NUMBER'}}},
  size:{type:'OBJECT',required:['min','max'],properties:{min:tuple,max:tuple}},
  palette:{type:'OBJECT',required:['coat','accent','dark'],properties:{coat:{type:'ARRAY',items:{type:'STRING'}},accent:{type:'ARRAY',items:{type:'STRING'}},dark:{type:'ARRAY',items:{type:'STRING'}}}},
  proportions:{type:'OBJECT',required:['bodyLengthToWidth','headWidthToBody','muzzleProjection','tailProjection','earRise'],properties:{bodyLengthToWidth:tuple,headWidthToBody:tuple,muzzleProjection:tuple,tailProjection:tuple,earRise:tuple}},
  regions:{type:'ARRAY',items:{type:'OBJECT',required:['role','min','max','tolerance','intent','exterior'],properties:{role:{type:'STRING',enum:[...ANIMAL_BLUEPRINT_ROLES]},min:tuple,max:tuple,tolerance:{type:'NUMBER'},intent:{type:'STRING',enum:['mass','taper','pointed','thin','small','support']},exterior:{type:'BOOLEAN'}}}},
  emptyRegions:{type:'ARRAY',items:{type:'OBJECT',required:['id','min','max'],properties:{id:{type:'STRING'},min:tuple,max:tuple}}},
  features:{type:'ARRAY',items:{type:'OBJECT',required:['id','description','intent','pairing','pieces','carriers'],properties:{id:{type:'STRING'},description:{type:'STRING'},intent:{type:'STRING',enum:['pointed-ears','projecting-muzzle','separated-eyes-nose','contoured-body','sweeping-tail']},pairing:{type:'STRING',enum:['none','same-shape','identical-id']},supportMode:{type:'STRING',enum:['reserved-only','anatomy']},pieces:{type:'ARRAY',items:partSchema},carriers:{type:'ARRAY',items:carrierSchema}}}},
}} as const;

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const vector=(v:unknown):v is V3=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
function box(v:unknown):v is AnimalBlueprintBox {
  if(!object(v)||!vector(v.min)||!vector(v.max))return false;
  const min=v.min,max=v.max;return min.every((n,a)=>max[a]>n&&Math.abs(n)<=24&&Math.abs(max[a])<=24)&&min[2]>=0;
}
function region(v:unknown):v is AnimalBlueprintRegion {
  return object(v)&&typeof v.role==='string'&&ROLES.has(v.role)&&typeof v.tolerance==='number'&&Number.isFinite(v.tolerance)&&v.tolerance>=0&&v.tolerance<=1&&typeof v.intent==='string'&&['mass','taper','pointed','thin','small','support'].includes(v.intent)&&typeof v.exterior==='boolean'&&box(v);
}
function sizeRange(v:unknown):boolean {
  if(!object(v)||!vector(v.min)||!vector(v.max))return false;
  const min=v.min,max=v.max;return min.every((n,a)=>n>0&&max[a]>=n&&max[a]<=24);
}
const label=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
function known(id:string):boolean {try{const k=parsePartId(id);return !!k&&k.type!=='wheel'&&k.type!=='wheels'&&!!CATALOG[k.type]?.includes(`${k.w}x${k.d}`)&&isMade(id)&&definition(k).ports.length>0;}catch{return false;}}
function stockOf(stock:Record<string,number>):Record<string,number>|null {
  if(!object(stock)||Object.keys(stock).length>1024||Object.entries(stock).some(([id,n])=>id.length>80||!Number.isSafeInteger(n)||n<0))return null;
  return Object.fromEntries(Object.entries(stock).filter(([id,n])=>n>0&&known(id)).sort(([a],[b])=>a.localeCompare(b)));
}
const shape=(id:string)=>{const k=parsePartId(id)!;return `${k.type}:${k.w}x${k.d}`;};
const colors=(values:unknown):values is ColorName[]=>Array.isArray(values)&&values.length>0&&values.length<=3&&new Set(values).size===values.length&&values.every(c=>typeof c==='string'&&Object.hasOwn(COLORS,c));

/** Unique physical costs, not feature references. Inputs are normally validated
 * plans; malformed sharing fails closed rather than silently deleting a cost.
 * Returned rows are detached copies, with all pieces/unmarked carriers retained. */
export function uniqueAnimalReservations(blueprint:AnimalBlueprint):AnimalBlueprintReservation[] {
  if(!object(blueprint)||!Array.isArray(blueprint.features)||blueprint.features.length<2||blueprint.features.length>4)throw Error('Provide bounded complete feature reservations.');
  const result:AnimalBlueprintReservation[]=[],bindings=new Map<string,AnimalBlueprintReservation>();
  for(const f of blueprint.features) {
    if(!object(f))throw Error('Invalid feature reservation.');
    const seen=new Set<string>();
    for(const kind of ['pieces','carriers'] as const) {
      if(!Array.isArray(f[kind])||!f[kind].length||f[kind].length>12)throw Error('Invalid bounded feature reservation rows.');
      for(const p of f[kind]) {
        if(!object(p)||typeof p.partId!=='string'||!p.partId||p.partId.length>80||!Number.isSafeInteger(p.count)||p.count<1||p.count>80||!ROLES.has(p.role))throw Error('Invalid exact feature reservation row.');
        const copy:AnimalBlueprintReservation={partId:p.partId,count:p.count,role:p.role};
        if(Object.hasOwn(p,'shared')) {
          if(kind==='pieces'||!label(p.shared)||p.count!==1||seen.has(p.shared))throw Error('Shared carriers require a unique label per feature and count1; pieces cannot be shared.');
          seen.add(p.shared);copy.shared=p.shared;
          const prior=bindings.get(p.shared);
          if(prior) {
            if(prior.partId!==p.partId||prior.role!==p.role||prior.count!==p.count)throw Error('Shared carrier token has conflicting exact part identity or role.');
            continue;
          }
          bindings.set(p.shared,copy);
        }
        result.push(copy);
      }
    }
  }
  return result;
}

/** Necessary upright-port opportunity only. Ordinary vertical ports have
 * half-integer XY centers, hence integer part bounds; jumpers can offset .5.
 * Other supported vertical offsets use a conservative .1 grid. Horizontal
 * side studs cannot mate to this pilot's upright downward grips. */
function interfaceGrid(stock:Record<string,number>):number {
  let grid=1;
  for(const id of Object.keys(stock)) {
    const k=parsePartId(id)!;
    if(k.type==='jumper'){grid=Math.min(grid,.5);continue;}
    const ports=definition(k).ports.filter(p=>Math.abs(p.normal[2])>1-EPS);
    if(ports.some(p=>[0,1].some(a=>Math.abs(p.point[a]/20-.5-Math.round(p.point[a]/20-.5))>EPS)))return .1;
  }
  return grid;
}
function planningInterfaceIssues(regions:AnimalBlueprintRegion[],stock:Record<string,number>):string[] {
  const origin=[0,1].map(a=>Math.min(...regions.map(r=>r.min[a]))),grid=interfaceGrid(stock);
  const joins:[AnimalBlueprintRole,AnimalBlueprintRole[]][]=[['muzzle',['head']],['nose',['muzzle']],['eye-left',['head']],['eye-right',['head']],
    ['ear-left',['head']],['ear-right',['head']],['neck',['head']],['neck',['chest','torso']],['tail',['hips','torso']]];
  const interval=(r:AnimalBlueprintRegion,a:number)=>[
    Math.ceil((r.min[a]-origin[a]-r.tolerance-EPS)/grid)*grid,
    Math.floor((r.max[a]-origin[a]+r.tolerance+EPS)/grid)*grid,
  ];
  const overlap=(a:AnimalBlueprintRegion,b:AnimalBlueprintRegion)=>[0,1].every(axis=>{
    const aa=interval(a,axis),bb=interval(b,axis);
    return Math.min(aa[1],bb[1])-Math.max(aa[0],bb[0])>=1-EPS;
  });
  return joins.flatMap(([role,targets])=>{
    const source=regions.find(r=>r.role===role);if(!source)return [];
    const availableTargets=targets.flatMap(target=>regions.filter(r=>r.role===target));
    if(!availableTargets.length||availableTargets.some(target=>overlap(source,target)))return [];
    return [`Required direct ${role} ↔ ${targets.join(' or ')} interface cannot fit a 1 × 1 stud XY landing on the ${grid}-stud grid after expanding tolerances. Include real carriers and overlapping structural envelopes; this is a necessary planning condition, not a proven connection.`];
  });
}
/** Individual necessary size check only: no placement, shared packing, port
 * reach, carrier graph or complete construction is established here. */
function reservationEnvelopeIssues(featureId:string,p:AnimalBlueprintReservation,r:AnimalBlueprintRegion):string[] {
  const capacity=[0,1,2].map(a=>r.max[a]-r.min[a]+2*r.tolerance);
  const sizes=[0,90].map(rot=>{const f=frame({partId:p.partId,x:0,y:0,z:0,rot});return [0,1,2].map(a=>(f.bounds.max[a]-f.bounds.min[a])/20);});
  const format=(v:number[])=>v.map(n=>Number(n.toFixed(4))).join(' × ');
  const issues:string[]=[];
  if(!sizes.some(size=>size.every((n,a)=>n<=capacity[a]+EPS)))issues.push(`${featureId}: reserved ${p.partId} in ${p.role} has upright sizes ${format(sizes[0])} or ${format(sizes[1])} studs; neither quarter orientation fits its tolerance-expanded ${format(capacity)} stud role envelope. Include every real feature piece and carrier inside its own role envelope; repair the plan, not the part.`);
  if(r.intent==='small'&&!sizes.some(size=>size.every(n=>n<=1.5+EPS)))issues.push(`${featureId}: reserved ${p.partId} in ${p.role} (${format(sizes[0])} studs) contradicts small intent: EVERY axis of the final role must be <=1.5 studs. Choose a truthful intent/part size; a flat 2-wide nose may use thin while all Fox proportion gates remain required.`);
  if(r.intent==='thin'&&!sizes.some(size=>Math.min(...size)<=1+EPS))issues.push(`${featureId}: reserved ${p.partId} in ${p.role} (${format(sizes[0])} studs) contradicts thin intent: at least ONE axis of the final role must be <=1 stud. Choose a truthful intent/part size; do not relabel a thick reserved mass as thin.`);
  // A rectangular carrier can belong to a later tapered/pointed composite;
  // requiring every individual piece to taper would not be a necessary check.
  return issues;
}

/** Select scale and reserve identity/features before any body allocation. This
 * verifies a planning ledger and intent only; it generates no geometry. */
export function validateAnimalBlueprint(input:unknown,stock:Record<string,number>):AnimalBlueprintValidation {
  const issues:string[]=[],available=stockOf(stock);
  if(!available)return {blueprint:null,issues:['Malformed stock counts or bounded stock input.']};
  if(!object(input)||input.version!==1||input.subject!=='Fox'||!label(input.id)||typeof input.description!=='string'||!input.description.trim()||input.description.length>800||!['standing','crouching'].includes(String(input.stance)))return {blueprint:null,issues:['Invalid canonical Fox blueprint identity, description or stance.']};
  if(!object(input.parts)||!Number.isSafeInteger(input.parts.min)||!Number.isSafeInteger(input.parts.max)||Number(input.parts.min)<20||Number(input.parts.max)>80||Number(input.parts.min)>Number(input.parts.max))issues.push('Blueprint piece budget must be 20–80.');
  if(!sizeRange(input.size))issues.push('Overall size ranges must be finite positive world studs, at most 24.');
  const palette=input.palette,proportions=input.proportions,regions=input.regions,empties=input.emptyRegions;
  if(!object(palette)||!colors(palette.coat)||!colors(palette.accent)||!colors(palette.dark)||!COATS.some(g=>(palette.coat as string[]).every(c=>g.includes(c)))||(palette.accent as string[]).some(c=>!ACCENTS.has(c))||(palette.dark as string[]).some(c=>!DARK.has(c)))issues.push('Palette must describe one coherent natural coat, credible accents and dark facial details.');
  const rangeLimits={bodyLengthToWidth:[1.3,5],headWidthToBody:[.35,1.3],muzzleProjection:[.5,6],tailProjection:[1,12],earRise:[.2,4]};
  if(!object(proportions)||Object.entries(rangeLimits).some(([key,[lo,hi]])=>{const v=proportions[key];return !Array.isArray(v)||v.length!==2||!v.every(n=>typeof n==='number'&&Number.isFinite(n))||v[0]<lo||v[1]>hi||v[1]<v[0];}))issues.push('Fox proportion ranges must be explicit, ordered and bounded.');
  if(!Array.isArray(regions)||regions.length<16||regions.length>17||regions.some(r=>!region(r)))issues.push('Each anatomy role needs a finite envelope and 0–1 stud tolerance.');
  else {
    const rr=regions as AnimalBlueprintRegion[];
    if(new Set(rr.map(r=>r.role)).size!==rr.length||REQUIRED.some(role=>!rr.some(r=>r.role===role)))issues.push('All sixteen anatomy envelopes must occur exactly once; frame is optional.');
    const span=[0,1,2].map(a=>Math.max(...rr.map(r=>r.max[a]))-Math.min(...rr.map(r=>r.min[a])));
    if(span.some(n=>n>24+EPS))issues.push('Anatomical envelopes span more than 24 studs.');
  }
  if(!Array.isArray(empties)||empties.length<1||empties.length>8||empties.some(r=>!object(r)||!label(r.id)||!box(r))||new Set(empties.map(r=>r?.id)).size!==empties.length)issues.push('Declare one to eight distinct deliberate empty regions.');
  if(!Array.isArray(input.features)||input.features.length<2||input.features.length>4)issues.push('Reserve two to four defining features.');
  // Continue independent semantic checks even when (for example) the palette
  // is incoherent. Only validated substructures are inspected below.
  const b=input as unknown as AnimalBlueprint,total:Record<string,number>={},left={...available};
  const allowed=new Set<string>(object(palette)?['coat','accent','dark'].flatMap(key=>Array.isArray(palette[key])?(palette[key] as unknown[]).filter((c):c is string=>typeof c==='string'&&Object.hasOwn(COLORS,c)):[]):[]);
  const safeRegions=Array.isArray(regions)&&regions.length<=17?regions.filter(region):[];
  const safeEmpties=Array.isArray(empties)&&empties.length<=8?empties.filter(box):[];
  const features=Array.isArray(input.features)&&input.features.length<=4?input.features:[];
  if(safeRegions.length&&new Set(safeRegions.map(r=>r.role)).size===safeRegions.length)issues.push(...planningInterfaceIssues(safeRegions,available));
  const rr=(role:AnimalBlueprintRole)=>safeRegions.find(r=>r.role===role);
  if(REQUIRED.every(role=>rr(role))) {
    const bellyMin=[Math.max(rr('leg-front-left')!.max[0],rr('leg-rear-left')!.max[0]),Math.max(rr('leg-front-left')!.max[1],rr('leg-front-right')!.max[1]),0];
    const bellyMax=[Math.min(rr('leg-front-right')!.min[0],rr('leg-rear-right')!.min[0]),Math.min(rr('leg-rear-left')!.min[1],rr('leg-rear-right')!.min[1]),Math.min(rr('chest')!.min[2],rr('torso')!.min[2],rr('hips')!.min[2])];
    if(!safeEmpties.some(e=>[.25,.5,.2].every((need,a)=>Math.min(e.max[a],bellyMax[a])-Math.max(e.min[a],bellyMin[a])>=need-EPS)))issues.push('Reserve an empty region with at least .25 × .5 × .2 studs of intersection with the central open belly corridor between the feet and below the body.');
  }
  const ids=new Set<string>(),sharedBindings=new Map<string,AnimalBlueprintReservation>();
  for(const raw of features) {
    const f=raw as AnimalBlueprintFeature;
    if(!object(f)||!label(f.id)||ids.has(f.id)||typeof f.description!=='string'||!f.description.trim()||f.description.length>400||!['pointed-ears','projecting-muzzle','separated-eyes-nose','contoured-body','sweeping-tail'].includes(f.intent)||!['none','same-shape','identical-id'].includes(f.pairing)||!Array.isArray(f.pieces)||!f.pieces.length||f.pieces.length>12||!Array.isArray(f.carriers)||!f.carriers.length||f.carriers.length>12){issues.push('Every defining feature needs unique identity, bounded exact pieces and explicit necessary carriers.');continue;}
    ids.add(f.id);
    if(Object.hasOwn(f,'supportMode')&&f.supportMode!=='reserved-only'&&f.supportMode!=='anatomy')issues.push(`${f.id}: supportMode must be reserved-only or anatomy when supplied.`);
    let valid=true;const featureTokens=new Set<string>();
    for(const [kind,p] of [...f.pieces.map(p=>['pieces',p] as const),...f.carriers.map(p=>['carriers',p] as const)]) {
      if(!object(p)||typeof p.partId!=='string'||p.partId.length>80||!known(p.partId)||!Number.isSafeInteger(p.count)||p.count<1||p.count>80||!ROLES.has(p.role)||!safeRegions.some(r=>r.role===p.role)){issues.push(`${f.id}: malformed, unsupported or unbound part reservation.`);valid=false;continue;}
      if(!allowed.has(parsePartId(p.partId)!.color))issues.push(`${f.id}: reserved color is outside the coherent palette.`);
      const envelopes=safeRegions.filter(r=>r.role===p.role);
      if(envelopes.length===1)issues.push(...reservationEnvelopeIssues(f.id,p,envelopes[0]));
      if(Object.hasOwn(p,'shared')) {
        if(kind==='pieces'||!label(p.shared)||p.count!==1){issues.push(`${f.id}: shared is allowed only for count1 carriers with a label of at most64 characters; feature pieces cannot be shared.`);valid=false;continue;}
        if(featureTokens.has(p.shared)){issues.push(`${f.id}: shared carrier token ${p.shared} occurs more than once in this feature.`);valid=false;continue;}
        featureTokens.add(p.shared);
        const prior=sharedBindings.get(p.shared);
        if(prior) {
          if(prior.partId!==p.partId||prior.role!==p.role||prior.count!==p.count){issues.push(`${f.id}: shared carrier token ${p.shared} has conflicting exact part ID, role or count.`);valid=false;}
          continue;
        }
        sharedBindings.set(p.shared,p);
      }
      total[p.partId]=(total[p.partId]??0)+p.count;left[p.partId]=(left[p.partId]??0)-p.count;
      if(left[p.partId]<0)issues.push(`${f.id}: ${p.partId} is double-spent or unavailable in the shared ledger.`);
    }
    if(!valid)continue;
    if(f.pairing!=='none') {
      if(f.pieces.reduce((n,p)=>n+p.count,0)!==2||new Set(f.pieces.map(p=>p.role)).size!==2||new Set(f.pieces.map(p=>f.pairing==='identical-id'?p.partId:shape(p.partId))).size!==1)issues.push(`${f.id}: pairing requires exactly two compatible pieces, count1 in each separate role. For mixed nose + eyes assemblies use pairing none, or reserve the two eyes as a separate feature.`);
    }
    if(f.intent==='pointed-ears'&&(!['ear-left','ear-right'].every(role=>f.pieces.some(p=>p.role===role))||f.pairing==='none'||f.pieces.some(p=>!['slope','cheese'].includes(parsePartId(p.partId)!.type))))issues.push(`${f.id}: reserve actual matched sloping/pointed ear profiles for both ears.`);
    for(const p of f.pieces) {
      const grips=definition(parsePartId(p.partId)!).ports.filter(port=>port.kind==='grip');
      if(!grips.length||!f.carriers.some(c=>definition(parsePartId(c.partId)!).ports.some(port=>port.kind==='stud')))issues.push(`${f.id}: necessary carrier has no real stud/grip capability for the feature.`);
    }
  }
  if(!features.some(f=>object(f)&&f.intent==='pointed-ears'))issues.push('A Fox plan must reserve its matched pointed ears before the body.');
  const reserved=Object.values(total).reduce((n,v)=>n+v,0),bodyAvailable=Object.entries(left).filter(([id,n])=>n>0&&allowed.has(parsePartId(id)!.color)&&definition(parsePartId(id)!).ports.some(p=>p.kind==='stud')).reduce((n,[,v])=>n+v,0);
  const minParts=object(input.parts)&&Number.isSafeInteger(input.parts.min)?Number(input.parts.min):20;
  const maxParts=object(input.parts)&&Number.isSafeInteger(input.parts.max)?Number(input.parts.max):80;
  if(reserved+Math.max(4,Math.ceil(minParts*.25))>maxParts||bodyAvailable<Math.max(4,Math.ceil(minParts*.25)))issues.push('Feature reservations leave insufficient studded body supply within the selected piece budget.');
  if(Object.values(available).reduce((n,v)=>n+v,0)<minParts)issues.push('Usable stock is below the selected whole-model minimum.');
  if(issues.length)return {blueprint:null,issues:[...new Set(issues)]};
  const blueprint:AnimalBlueprint={version:1,id:b.id,subject:'Fox',description:b.description.trim(),stance:b.stance,
    parts:{min:b.parts.min,max:b.parts.max},size:{min:[...b.size.min],max:[...b.size.max]},palette:{coat:[...b.palette.coat],accent:[...b.palette.accent],dark:[...b.palette.dark]},
    proportions:{bodyLengthToWidth:[...b.proportions.bodyLengthToWidth],headWidthToBody:[...b.proportions.headWidthToBody],muzzleProjection:[...b.proportions.muzzleProjection],tailProjection:[...b.proportions.tailProjection],earRise:[...b.proportions.earRise]},
    regions:b.regions.map(r=>({role:r.role,min:[...r.min],max:[...r.max],tolerance:r.tolerance,intent:r.intent,exterior:r.exterior})),emptyRegions:b.emptyRegions.map(r=>({id:r.id,min:[...r.min],max:[...r.max]})),
    features:b.features.map(f=>({id:f.id,description:f.description.trim(),intent:f.intent,pairing:f.pairing,...(f.supportMode!==undefined?{supportMode:f.supportMode}:{}),pieces:f.pieces.map(p=>({partId:p.partId,count:p.count,role:p.role})),carriers:f.carriers.map(p=>({partId:p.partId,count:p.count,role:p.role,...(p.shared!==undefined?{shared:p.shared}:{})}))}))};
  return {blueprint,issues:[],reservations:{features:blueprint.features.map(f=>({id:f.id,...(f.supportMode!==undefined?{supportMode:f.supportMode}:{}),pieces:f.pieces,carriers:f.carriers})),total,remaining:left,bodyAvailable}};
}

export function animalBlueprintText(stock:Record<string,number>):string {
  const available=stockOf(stock);
  return `Editable whole Fox design promises, not completed instructions. All bounds, extents, projections and tolerances use WORLD STUDS (not plate elevations). Front is -y. Select stance, full body scale, proportions, all 16 anatomy envelopes and deliberate openings before spending any body pieces. Frame is optional. Use 2–4 features with exact partId/count/role pieces AND necessary carriers, sharing ONE original ledger. Reserve matching sloped ears before the body.
Each palette array must contain 1–3 distinct colors. All coat colors must belong to ONE family: brown [reddish-brown,dark-brown,medium-nougat,nougat], orange [orange,dark-orange,bright-light-orange,medium-nougat], pale [white,light-gray,tan,dark-tan], or dark [black,dark-gray]. Do not mix brown and orange coats. Accents may be white,tan,dark-tan,medium-nougat,black,dark-gray,dark-brown. Dark facial colors may be black,dark-gray,dark-brown. Only choose colors supported by the actual stock.
Explicit pairing requires EXACTLY TWO pieces total in two separate roles, with count1 EACH. Tiny role-allocation example, only if that exact ID is available twice: pieces:[{partId:"slope-2x2-black",count:1,role:"ear-left"},{partId:"slope-2x2-black",count:1,role:"ear-right"}], pairing:"identical-id". This example does not supply carriers or a complete feature/model. Never put count2 in only ear-left or eye-left. A mixed nose + eyes feature uses pairing:"none", or split the eyes into their own paired feature. same-shape permits identical type/dimensions in compatible colors; it does not prove a mirrored pose is legal.
Feature supportMode is optional and defaults to "reserved-only": layered pieces may connect THROUGH other reserved pieces or carriers in that SAME feature, with no unreserved parts on the path. Explicit supportMode:"anatomy" also permits paths through REAL, stock-billed parts whose authoritative anatomy role matches ANY declared carrier role of that feature. For example, a head-role carrier permits actual head-role bridges chosen during construction; it does not require preauthoring an entire head. No other roles, imaginary parts or unbilled bridges are allowed. In either mode every selected feature piece must reach at least one selected reserved carrier by real mating contacts, and every selected carrier must belong to a component containing a selected feature piece. Traversal starts only from selected pieces/carriers; disconnected intermediate-only components do not count as feature failures or support evidence. Anatomy intermediates are support paths, not additional reserved copies or permission to alias indices. A physical carrier may serve multiple features ONLY when every reference explicitly uses the SAME shared token: carriers:[{partId,role,count:1,shared:"common-plate"}]. This is one exact physical part ID/role/index, billed ONCE across those features. Tokens use lowercase alphanumeric/underscore/hyphen labels of at most64 characters; count must be1; no token may repeat within one feature. Feature PIECES cannot have shared. Different tokens and unmarked carriers require DISTINCT copies, even with the same ID/role. No piece can reuse any carrier index. Sharing and exact bindings are immutable during plan revisions; an explicit revision may change supportMode as a support-path promise. Planning checks stock and port capability only; final construction must prove these paths using exact poses and real ports. Neither mode proves clutch strength or rendered craft quality.
Anatomy envelopes include REAL CARRIERS and overlapping one-stud landings, not disjoint artistic zones. Required direct anatomy interfaces are muzzle–head, nose–muzzle, each eye–head, each ear–head, neck–head, neck–chest OR torso, and tail–hips OR torso. Upright vertical joins need at least 1 × 1 stud of XY overlap inside the expanded envelopes, snapped to this pile's possible grid (${available?interfaceGrid(available):1} studs). Side horizontal grips are unsupported here. Frame may bridge chest/waist/hips; those three regions need no direct overlap with each other. General reserved features still use their own induced contact graph, not direct joins for every piece. Prefer 1-stud tolerance for structural adaptation on the integer grid and broad positive overall size ranges rather than prematurely tight height limits. This necessary interface check proves no stock-specific complete construction or craft quality.
Every reserved feature piece AND carrier must individually fit INSIDE its own tolerance-expanded role envelope using its actual upright footprint and height in at least one quarter-turn orientation. Let real feature/carrier sizes set the scale: an 8-stud plate cannot fit a 6.6-stud available span unless the other XY orientation actually fits. No carrier may be hidden outside its declared role envelope. Individual dimensional fit is necessary only; it does not prove all reserved parts can be packed, connected or composed together.
Exact final region intent semantics (measured from the COMPLETE role bounds, including carriers): small requires EVERY axis <=1.5 studs; thin requires at least ONE axis <=1 stud, not necessarily height. Thus a flat 2-wide nose can truthfully use thin, but cannot promise small; normal Fox nose/muzzle proportion gates still apply. Taper requires a slope/curve/invslope/cheese/cornerplate/wedgeleft/wedgeright profile in the role, or two actual pieces whose top heights differ by at least .39 stud AND width or depth differs by at least .49 stud. When exterior:true, the profile alternative must touch that role's bounding edge; this does not prove exposure in a rendered view. Mass, support and pointed have no additional per-region dimensional intent test; pointed Fox ears still need their reserved sloping profiles and separate actual anatomy gates. Ordinary rectangular carriers may participate in a tapered or pointed composite. Individual reserved parts conflicting with small/thin fail planning early; satisfying individual intents does not prove the assembled role satisfies them.
Declare an empty region with meaningful intersection with the central belly corridor (at least .25 × .5 × .2 studs); it may extend beyond that corridor if the ENTIRE declared box stays empty in the real model. Convex solids check straight slopes and the source-facet outer profiles of supported curves, including stepped undersides; rounds keep conservative nominal boxes, and unmodeled interior cavities remain occupied. Region intent/exterior are visual goals: nominal contour evidence is not measured exposed shape, craft or clutch strength. Do not invent a fixed chassis/head, joints, propellers, duplicate singletons or decorative filler. Different head/neck/color alone is not whole-body plan diversity; change major body, leg or tail envelopes. Role envelopes have explicit 0–1 stud tolerance. Blueprint x/y envelopes are compared after subtracting their common minimum x/y; ground remains z0. Whole structure and visual quality need separate final checks.\nUsable exact stock: ${JSON.stringify(available??{})}${available?'':'\nStock input is malformed.'}`;
}

function bounds(parts:Placed[]):AnimalBlueprintBox {
  if(!parts.length)throw Error('Missing anatomy.');const ff=parts.map(frame);
  return {min:[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20) as V3,max:[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20) as V3};
}
const extent=(b:AnimalBlueprintBox,a:number)=>b.max[a]-b.min[a];
function roleParts(c:AnimalBlueprintComposition):Record<AnimalBlueprintRole,Placed[]> {
  const all=c.build.steps.flatMap(s=>s.parts),out=Object.fromEntries(ANIMAL_BLUEPRINT_ROLES.map(r=>[r,[]])) as unknown as Record<AnimalBlueprintRole,Placed[]>;
  const owned=new Set<number>();
  const take=(role:string,index:number)=>{if(!ROLES.has(role)||!Number.isSafeInteger(index)||index<0||index>=all.length||owned.has(index))throw Error('Invalid final anatomy ownership.');owned.add(index);out[role as AnimalBlueprintRole].push(all[index]);};
  if(c.roleIndices)for(const [role,indices] of Object.entries(c.roleIndices)){if(!Array.isArray(indices))throw Error('Invalid final role indices.');indices.forEach(i=>take(role,i));}
  else for(const r of c.receipts) {
    const node=c.plan.nodes.find(n=>n.id===r.id);if(!node||node.option.program.operations.length!==r.indices.length)throw Error('Final recipe/receipt mismatch.');
    r.indices.forEach((index,i)=>{const op=node.option.program.operations[i] as typeof node.option.program.operations[number]&{role?:string};if(op.partId!==all[index]?.partId)throw Error('Final part identity mismatch.');take(op.role??r.role,index);});
  }
  if(owned.size!==all.length||REQUIRED.some(r=>!out[r].length))throw Error('Every real part needs exact full-anatomy ownership.');
  return out;
}

/** Same positive-volume SAT semantics as the physical validator, restricted to
 * a local empty box. Straight profiles and supported curved outer profiles use convex hulls;
 * rounds and unmodeled interior cavities retain conservative nominal solids. Boundary contact is empty. */
export function solidIntersectsEmpty(s:Solid,empty:AnimalBlueprintBox):boolean {
  if(![0,1,2].every(a=>Math.min(s.bounds.max[a],empty.max[a])-Math.max(s.bounds.min[a],empty.min[a])>EPS))return false;
  const basis:V3[]=[[1,0,0],[0,1,0],[0,0,1]],points=corners(empty);
  return [...s.axes,...basis,...s.edges.flatMap(edge=>basis.map(axis=>cross(edge,axis)))].every(axis=>{
    const length=Math.hypot(...axis);if(length<EPS)return true;
    const unit=axis.map(n=>n/length) as V3,a=s.points.map(p=>dot(p,unit)),b=points.map(p=>dot(p,unit));
    return Math.min(Math.max(...a),Math.max(...b))-Math.max(Math.min(...a),Math.min(...b))>EPS;
  });
}

/** Joint bounded assignment: identical copies are selected by actual contacts,
 * never receipt order. Only one explicit shared carrier token may reuse an
 * exact index across features; every other selected index has one owner.
 * A failed/exhausted search supplies no partial construction proof. */
function featureAllocationIssues(features:AnimalBlueprintFeature[],roles:Record<AnimalBlueprintRole,Placed[]>,parts:Placed[]):string[] {
  const index=new Map(parts.map((p,i)=>[p,i])),frames=parts.map(frame),links=parts.map(()=>new Set<number>());
  for(let a=0;a<parts.length;a++)for(let b=0;b<a;b++)if(connectionPairs(frames[a],frames[b]).length){links[a].add(b);links[b].add(a);}
  type Group={kind:'pieces'|'carriers';pool:number[];count:number;shared?:string};
  const problems:string[]=[],tasks=features.map(f=>{
    const grouped=new Map<string,{kind:Group['kind'];reservation:AnimalBlueprintReservation}>();
    for(const kind of ['pieces','carriers'] as const)for(const r of f[kind]) {
      const key=JSON.stringify([kind,r.role,r.partId,r.shared??null]),g=grouped.get(key);
      if(g)g.reservation.count+=r.count;else grouped.set(key,{kind,reservation:{...r}});
    }
    const groups=[...grouped.values()].map(({kind,reservation:r})=>{
      const pool=roles[r.role].filter(p=>p.partId===r.partId).map(p=>index.get(p)!);
      if(pool.length<r.count)problems.push(`${f.id}: actual ${r.role} cost does not contain its reserved ${r.partId}.`);
      return {kind,pool,count:r.count,...(r.shared!==undefined?{shared:r.shared}:{})};
    }).sort((a,b)=>(a.pool.length-a.count)-(b.pool.length-b.count));
    const intermediates=f.supportMode==='anatomy'?[...new Set(f.carriers.flatMap(r=>roles[r.role].map(p=>index.get(p)!)))]:[];
    return {id:f.id,groups,intermediates,slack:groups.reduce((n,g)=>n+g.pool.length-g.count,0)};
  }).sort((a,b)=>a.slack-b.slack);
  if(problems.length)return problems;
  const used=new Set<number>(),sharedIndices=new Map<string,number>();let attempts=0,exhausted=false;
  const tick=()=>{if(++attempts>60000){exhausted=true;return false;}return true;};
  const connected=(pieces:number[],carriers:number[],intermediates:number[])=>{
    const selected=new Set([...pieces,...carriers]),allowed=new Set([...selected,...intermediates]),seen=new Set<number>();
    // Intermediate-only components have no selected feature obligation. Real
    // role ownership and full stock/physical validation precede this search.
    for(const root of selected) {
      if(seen.has(root))continue;
      const component=new Set<number>([root]),queue=[root];seen.add(root);
      for(let at=0;at<queue.length;at++)for(const next of links[queue[at]])if(allowed.has(next)&&!seen.has(next)){seen.add(next);component.add(next);queue.push(next);}
      if(!pieces.some(i=>component.has(i))||!carriers.some(i=>component.has(i)))return false;
    }
    return true;
  };
  const assignFeature=(fi:number):boolean=>{
    if(!tick())return false;if(fi===tasks.length)return true;
    const task=tasks[fi],selected={pieces:[] as number[],carriers:[] as number[]};
    const assignGroup=(gi:number):boolean=>{
      if(!tick())return false;
      if(gi===task.groups.length)return connected(selected.pieces,selected.carriers,task.intermediates)&&assignFeature(fi+1);
      const g=task.groups[gi],bound=g.shared!==undefined?sharedIndices.get(g.shared):undefined;
      if(bound!==undefined) {
        if(g.kind!=='carriers'||g.count!==1||!g.pool.includes(bound))return false;
        selected.carriers.push(bound);
        if(assignGroup(gi+1))return true;
        selected.carriers.pop();return false;
      }
      const pool=g.pool.filter(i=>!used.has(i));
      if(pool.length<g.count)return false;
      const choose=(start:number,left:number):boolean=>{
        if(!tick())return false;if(!left)return assignGroup(gi+1);
        for(let p=start;p<=pool.length-left&&!exhausted;p++) {
          const i=pool[p];used.add(i);selected[g.kind].push(i);
          if(g.shared!==undefined)sharedIndices.set(g.shared,i);
          if(choose(p+1,left-1))return true;
          if(g.shared!==undefined)sharedIndices.delete(g.shared);
          selected[g.kind].pop();used.delete(i);
        }
        return false;
      };
      return choose(0,g.count);
    };
    return assignGroup(0);
  };
  return assignFeature(0)?[]:[exhausted?'Exact feature/carrier assignment exhausted its bounded search; no allocation was proven.':'No globally exclusive assignment connects every reserved feature piece to a participating carrier within its reserved contact graph and permitted anatomy support roles.'];
}

/** Target checks complement the unchanged physical validator. Passing these
 * checks is construction/intent evidence, never a rendered craft qualification. */
export function animalBlueprintIssues(c:AnimalBlueprintComposition,blueprint:AnimalBlueprint,stock:Record<string,number>):string[] {
  const parsed=validateAnimalBlueprint(blueprint,stock);if(!parsed.blueprint)return parsed.issues.map(i=>`Blueprint: ${i}`);
  const b=parsed.blueprint,issues:string[]=[];
  try {
    if(c.plan.name!=='Fox'||c.build.name!=='Fox')return ['Final subject must be canonical Fox.'];
    const stance=(c.plan as typeof c.plan&{wholeAnimal?:{stance?:string}}).wholeAnimal?.stance;
    if(stance&&stance!==b.stance)issues.push('Final supported stance differs from the selected blueprint.');
    const parts=c.build.steps.flatMap(s=>s.parts);if(parts.length<b.parts.min||parts.length>b.parts.max)return ['Final part count misses the selected blueprint budget.'];
    issues.push(...validateConnections(c.build,stock,24).map(i=>i.message));
    const roles=roleParts(c),whole=bounds(parts),origin=[0,1,2].map(a=>a===2?0:Math.min(...b.regions.map(r=>r.min[a])));
    for(let a=0;a<3;a++)if(extent(whole,a)<b.size.min[a]-EPS||extent(whole,a)>b.size.max[a]+EPS)issues.push('Final overall size misses the selected range.');
    for(const r of b.regions) {
      if(r.role==='frame'&&!roles.frame.length)continue;
      const actual=bounds(roles[r.role]);
      if([0,1,2].some(a=>actual.min[a]<r.min[a]-origin[a]-r.tolerance-EPS||actual.max[a]>r.max[a]-origin[a]+r.tolerance+EPS))issues.push(`${r.role}: actual anatomy exceeds its chosen envelope/tolerance.`);
      if(r.intent==='thin'&&Math.min(...[0,1,2].map(a=>extent(actual,a)))>1+EPS)issues.push(`${r.role}: selected thin region became a thick mass.`);
      if(r.intent==='small'&&[0,1,2].some(a=>extent(actual,a)>1.5+EPS))issues.push(`${r.role}: selected small detail became oversized.`);
      if(r.intent==='taper') {
        const contour=roles[r.role].some(p=>{const k=parsePartId(p.partId)!,part=bounds([p]);return ['slope','curve','invslope','cheese','cornerplate','wedgeleft','wedgeright'].includes(k.type)&&(!r.exterior||[0,1,2].some(a=>Math.abs(part.min[a]-actual.min[a])<EPS||Math.abs(part.max[a]-actual.max[a])<EPS));});
        const layers=roles[r.role].map(p=>bounds([p])),stepped=layers.some((x,i)=>layers.some((y,j)=>i!==j&&Math.abs(x.max[2]-y.max[2])>=.39&&(Math.abs(extent(x,0)-extent(y,0))>=.49||Math.abs(extent(x,1)-extent(y,1))>=.49)));
        if(!contour&&!stepped)issues.push(`${r.role}: no selected contour profile or stepped change expresses the promised taper.`);
      }
    }
    for(const empty of b.emptyRegions) {
      const min=empty.min.map((n,a)=>(n-origin[a])*20) as V3,max=empty.max.map((n,a)=>(n-origin[a])*20) as V3;
      if(parts.some(p=>frame(p).solids.some(s=>solidIntersectsEmpty(s,{min,max}))))issues.push(`${empty.id}: deliberate empty region contains a nominal physical solid.`);
    }
    const body=bounds([...roles.chest,...roles.hips,...roles.torso]),head=bounds(roles.head),muzzle=bounds(roles.muzzle),nose=bounds(roles.nose),eyes=[bounds(roles['eye-left']),bounds(roles['eye-right'])],tail=bounds(roles.tail),ears=[bounds(roles['ear-left']),bounds(roles['ear-right'])];
    const inRange=(value:number,range:[number,number])=>value>=range[0]-EPS&&value<=range[1]+EPS;
    if(!inRange(extent(body,1)/extent(body,0),b.proportions.bodyLengthToWidth)||!inRange(extent(head,0)/extent(body,0),b.proportions.headWidthToBody))issues.push('Actual full-body/head proportions miss the selected plan.');
    if(!inRange(Math.min(...eyes.map(e=>e.min[1]))-nose.min[1],b.proportions.muzzleProjection)||nose.min[1]>=muzzle.max[1]||nose.min[1]>=bounds(roles.neck).min[1])issues.push('Actual projecting muzzle/nose misses the selected plan.');
    if(!inRange(tail.max[1]-body.max[1],b.proportions.tailProjection)||tail.min[1]<bounds(roles.hips).min[1])issues.push('Actual substantial rear tail misses the selected plan.');
    if(ears.some(e=>!inRange(e.max[2]-head.max[2],b.proportions.earRise))||Math.abs(ears[0].min[1]-ears[1].min[1])>.5||Math.abs(ears[0].max[2]-ears[1].max[2])>.4)issues.push('Actual paired alert ears miss the selected plan.');
    const legs=['leg-front-left','leg-front-right','leg-rear-left','leg-rear-right'] as const,feet=legs.map(r=>bounds(roles[r]));
    if(feet.some(f=>Math.abs(f.min[2])>EPS)||feet[1].min[0]-feet[0].max[0]<.25||feet[2].min[1]-feet[0].max[1]<.5||feet[3].min[1]-feet[1].max[1]<.5)issues.push('Final stance needs four grounded separated feet and an open belly.');
    if(eyes[1].min[0]-eyes[0].max[0]<.25||[...roles['eye-left'],...roles['eye-right'],...roles.nose].some(p=>!b.palette.dark.includes(parsePartId(p.partId)!.color)))issues.push('Final eyes/nose need separated dark facial details.');
    const allowed=new Set([...b.palette.coat,...b.palette.accent,...b.palette.dark]);
    if(parts.some(p=>!allowed.has(parsePartId(p.partId)!.color)))issues.push('Actual exterior/body palette contains an unplanned color.');
    issues.push(...featureAllocationIssues(b.features,roles,parts));
  } catch {issues.push('Invalid, incomplete or unbound final blueprint geometry.');}
  return [...new Set(issues)];
}

/** Deliberate body/stance change, excluding head, neck, colors and text. This
 * pilot planning-diversity policy is not a visual similarity or craft score. */
export function animalBlueprintBodiesDiffer(a:AnimalBlueprint,b:AnimalBlueprint):boolean {
  const roles:AnimalBlueprintRole[]=['chest','hips','torso','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right','tail'];
  const boxFor=(p:AnimalBlueprint,r:AnimalBlueprintRole)=>p.regions.find(v=>v.role===r)!;
  const origin=(p:AnimalBlueprint)=>[0,1,2].map(i=>Math.min(...roles.map(r=>boxFor(p,r).min[i])));
  const aa=origin(a),bb=origin(b);
  return roles.some(role=>{const x=boxFor(a,role),y=boxFor(b,role);return [0,1,2].some(i=>Math.abs(extent(x,i)-extent(y,i))>=.75||Math.abs((x.min[i]+x.max[i])/2-aa[i]-((y.min[i]+y.max[i])/2-bb[i]))>=.75);});
}
