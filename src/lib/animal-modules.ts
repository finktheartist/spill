import { layer as s, part as p, studs } from './recipe-kit';
import { compileComponents, type Component, type ComponentPlan, type ComponentPort } from './component-kit';
import { buildCounts, matchContext, matchRecipe, type LibraryMatch } from './library';
import { partCount, type Build } from './bricks';

/** A small, authored kit. These modules are experimental until their assembled
 * stock-specific geometry has passed the independent appearance gate. */
const port = (contract: string, x: number, y: number, z: number, w: number, d: number, pads?: [number, number][]): ComponentPort => ({ ...studs(x,y,z,w,d),contract,pads });
const evidence = ['qa/modular-animals-20261009/RESULTS.md'];
const pads: [number,number][] = [0,1,6,7].flatMap(y=>[0,1,2,3].map(x=>[x,y] as [number,number]));
export type AnimalHead = 'hound' | 'terrier' | 'broad';
export type AnimalStance = 'low' | 'tall';
export type AnimalTail = 'swept' | 'upright';
export interface AnimalSelection { head: AnimalHead; stance: AnimalStance; tail: AnimalTail }
export interface AnimalModuleReceipt { id: string; label: string; build: Build; parts: Record<string,number>; preserves: string[]; placement: [number,number,number] }

export function animalLegSet(stance: AnimalStance): Component {
  const top=stance==='low'?4:7;
  return {id:`animal-legs-${stance}`,label:stance==='low'?'Short legs with projecting paws':'Long legs with projecting paws',evidence,
    preserves:['Four distinct feet','Daylight under belly','One connected underframe','Shared torso interface'],
    ports:{torso:port('animal-torso-4x8',1,4,top+2,4,8,pads)},steps:[
      s('Point the narrow front and rear paws forward.',...[1,4].flatMap(x=>[3,9].map(y=>p('plate-1x2',y===3?'base':'body',x,y,0,90)))),
      s('Raise the four narrow legs behind the toes.',...[1,4].flatMap(x=>(stance==='low'?[4,10]:[3,9]).map(y=>p(stance==='low'?'brick-1x2':'brick-1x3','body',x,y,1,90)))),
      ...(stance==='tall'?[s('Extend the legs to the tall stance.',...[1,4].flatMap(x=>[4,10].map(y=>p('brick-1x2','body',x,y,4,90))))]:[]),
      s('Bridge the legs with two narrow underside rails.',...([1,4].map(x=>p('plate-1x8','body',x,4,top,90)))),
      s('Cross both rails above the shoulders and hips.',p('plate-2x4','body',1,4,top+1),p('plate-2x4','body',1,10,top+1)),
      s('Close the horizontal seams beneath both flanks.',p('plate-1x4','body',1,6,top+1,90),p('plate-1x4','body',4,6,top+1,90)),
    ]};
}

export function animalTorso(): Component {
  return {id:'animal-torso-tapered',label:'Long torso with a raised narrow back',evidence,
    preserves:['Narrow back above broader flanks','Distinct chest','Separate head and tail mounts'],
    inlet:port('animal-torso-4x8',0,0,0,4,8),
    ports:{head:port('animal-neck-2x2',1,0,5,2,2),tail:port('animal-tail-1x2',1,6,5,1,2)},steps:[
      s('Join the shoulder and hip supports with the belly floor.',p('plate-2x4','body',0,0,0),p('plate-4x6','body',0,2,0,90)),
      s('Give the shoulders a broader span than the waist and rump.',p('brick-2x6','body',-1,1,1),p('brick-2x4','dark',1,3,1,90),p('brick-1x4','light',0,0,1),p('brick-1x4','body',0,7,1)),
      s('Close the flanks behind the broader shoulders.',...[0,3].flatMap(x=>[3,5].map(y=>p('brick-1x2','body',x,y,1,90)))),
      s('Step the back inward, leaving the neck and tail studs exposed.',p('plate-2x4','body',1,0,4,90),p('plate-2x4','body',1,4,4,90)),
    ]};
}

export function animalHead(kind: AnimalHead): Component {
  if(kind==='broad')return {id:'animal-head-broad',label:'Broad muzzle and low folded ears',evidence,
    preserves:['Wide solid face','Centered nose between two eyes','Short folded ears','Common neck grip'],inlet:port('animal-neck-2x2',2,2,0,2,2),steps:[
      s('Make a broad jaw with a supported neck grip.',p('plate-2x6','body',0,1,0),p('plate-1x6','body',0,3,0)),
      s('Project a broad pale muzzle ahead of the cheek line.',p('brick-2x4','light',1,0,1),p('brick-1x6','light',0,2,1),p('brick-1x6','body',0,3,1)),
      s('Separate the nose from the wider-set eyes.',p('plate-1x2','dark',2,0,4),p('tile-1x1','dark',0,2,4),p('tile-1x1','dark',5,2,4)),
      s('Bridge the cheeks and skull behind the eyes.',p('plate-2x4','body',1,2,4),p('plate-1x6','body',0,3,5)),
      s('Fold the ears outward from the crown.',p('tile-1x2','body',0,3,6),p('tile-1x2','body',4,3,6)),
    ]};
  const long=kind==='hound',eyeY=long?2:1;
  const steps=[
    s('Bridge the neck forward with a narrow jaw.',p('plate-2x4','light',1,0,0,90)),
    s('Cross the jaw behind the cheeks and support the muzzle.',p('plate-2x4','light',0,2,1),p('plate-2x2','light',1,0,1)),
    s('Fill the muzzle and skull, keeping the face solid.',...(long?[p('plate-2x2','light',1,0,1),p('brick-2x2','body',1,2,1)]:[p('brick-2x3','light',1,0,1,90),p('brick-1x4','body',0,3,1)]),p('brick-1x2','body',0,eyeY,1,90),p('brick-1x2','body',3,eyeY,1,90)),
    s('Set a contrasting nose below the eye line.',p('plate-1x2','dark',1,0,long?2:4),p('plate-1x4','light',0,eyeY,4)),
    s('Place two separated eyes at the front edge of the cheeks.',p('tile-1x1','dark',0,eyeY,5),p('tile-1x1','dark',3,eyeY,5)),
  ];
  if(long)steps.push(
    s('Close the crown behind the eyes.',p('plate-1x4','body',0,3,4),p('plate-1x4','body',0,3,5),p('plate-1x2','body',1,2,5)),
    s('Cap the two hanging brown ears.',p('tile-1x2','body',0,2,6,90),p('tile-1x2','body',3,2,6,90)),
  );
  else steps.push(
    s('Close the crown behind the eyes.',p('plate-2x4','body',0,2,4),p('plate-2x4','body',0,2,5)),
    s('Add the two pointed ears.',p('cheese-1x1','trim',0,2,6),p('cheese-1x1','trim',3,2,6)),
  );
  return {id:`animal-head-${kind}`,label:{hound:'Long muzzle and hanging ears',terrier:'Short muzzle and pointed ears'}[kind],evidence,
    preserves:['Two separate eyes','Filled cheek and muzzle volume','Common neck grip','Distinct face silhouette'],inlet:port('animal-neck-2x2',1,2,0,2,2),steps:steps.map((step,i)=>i<2?step:{...step,parts:step.parts.map(part=>({...part,z:part.z+1}))})};
}

export function animalTail(style: AnimalTail): Component {
  return {id:`animal-tail-${style}`,label:style==='swept'?'Swept tail with a pale tip':'Raised tail with a pale tip',evidence,
    preserves:['Attached behind the rump','Pale terminal accent','Common two-stud grip'],inlet:port('animal-tail-1x2',0,0,0,1,2),steps:style==='upright'?[
      s('Step the narrow tail upward and back.',p('brick-1x2','body',0,0,0,90),p('brick-1x2','body',0,1,3,90)),
      s('Cap the tail with a pale tip.',p('tile-1x2','light',0,1,6,90)),
    ]:[
      s('Sweep a narrow supported strip behind the rump.',p('plate-1x4','body',0,0,0,90)),
      s('Step the tail upward toward its pale tip.',p('plate-1x2','body',0,0,1,90),p('plate-1x2','light',0,2,1,90)),
    ]};
}

export const ANIMAL_MODULES: Component[]=[animalTorso(),...(['hound','terrier','broad'] as const).map(animalHead),...(['low','tall'] as const).map(animalLegSet),...(['swept','upright'] as const).map(animalTail)];
export function animalModulePlan(head: AnimalHead, stance: AnimalStance, tail: AnimalTail): ComponentPlan {
  return {id:`animal-kit-${head}-${stance}-${tail}`,name:`${stance==='low'?'Low':'Standing'} ${head==='broad'?'broad-muzzled dog':head==='hound'?'hound':'terrier'}`,family:'dog',category:'Animals',
    palette:{body:'reddish-brown',light:'white',dark:'black',trim:'medium-nougat',base:'light-gray'},
    allowedColors:{body:['reddish-brown'],light:['tan','white'],dark:['black'],trim:['medium-nougat'],base:['light-gray']},
    features:['Four separated paws','Raised narrow back',animalHead(head).label,animalTail(tail).label],
    mounts:[{key:'legs',component:animalLegSet(stance)},{key:'torso',component:animalTorso(),parent:'legs',socket:'torso'},{key:'head',component:animalHead(head),parent:'torso',socket:'head'},{key:'tail',component:animalTail(tail),parent:'torso',socket:'tail'}]};
}
/** All combinations share one stock search. No module is individually allocated and then double-counted. */
export function animalModuleCandidates(stock: Record<string,number>, maxParts=120): LibraryMatch[] {
  const context=matchContext(stock),out:LibraryMatch[]=[];
  for(const head of ['hound','terrier','broad'] as const)for(const stance of ['low','tall'] as const)for(const tail of ['swept','upright'] as const){
    const {recipe,summary}=compileComponents(animalModulePlan(head,stance,tail));
    const match=matchRecipe(recipe,stock,context);
    if(match&&partCount(match.build)>=20&&partCount(match.build)<=maxParts)out.push({...match,componentPlan:summary});
  }
  return out;
}

/** Concrete module receipts from the jointly allocated whole build. Standalone
 * previews are translated only; no pieces or display-only supports are added. */
export function animalModuleReceipts(match: LibraryMatch): AnimalModuleReceipt[] {
  const selection=/^components:animal-kit-(hound|terrier|broad)-(low|tall)-(swept|upright)$/.exec(match.recipeId);
  if(!selection)throw new Error('Not an animal kit assembly');
  const plan=animalModulePlan(selection[1] as AnimalHead,selection[2] as AnimalStance,selection[3] as AnimalTail);
  return allocatedModuleReceipts(plan,match);
}

/** Partition a jointly allocated component plan without allocating its pieces again. */
export function allocatedModuleReceipts(plan: ComponentPlan, match: LibraryMatch): AnimalModuleReceipt[] {
  const {recipe}=compileComponents(plan);
  if(recipe.id!==match.recipeId)throw new Error('The receipt plan does not match the assembly');
  if(recipe.steps.length!==match.build.steps.length)throw new Error('The assembly changed after allocation');
  return plan.mounts.map(mount=>{
    const steps=match.build.steps.filter((_,i)=>recipe.steps[i].feature?.name===mount.component.label);
    const parts=steps.flatMap(s=>s.parts);
    if(!parts.length)throw new Error('The assembly is missing a module');
    const minX=Math.min(...parts.map(p=>p.x)),minY=Math.min(...parts.map(p=>p.y)),minZ=Math.min(...parts.map(p=>p.z));
    const build:Build={name:mount.component.label,description:mount.component.preserves.join('; '),steps:steps.map(s=>({...s,parts:s.parts.map(p=>({...p,x:p.x-minX,y:p.y-minY,z:p.z-minZ}))}))};
    return {id:mount.component.id,label:mount.component.label,build,parts:buildCounts(build),preserves:mount.component.preserves,placement:[minX,minY,minZ]};
  });
}
