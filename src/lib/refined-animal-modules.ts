import { layer as s, part as p, studs } from './recipe-kit';
import { compileComponents, type Component, type ComponentPort } from './component-kit';
import { animalModulePlan, allocatedModuleReceipts, type AnimalStance, type AnimalTail } from './animal-modules';
import { matchContext, matchRecipe, type LibraryMatch } from './library';
import { partCount, type Build } from './bricks';
import { constructionKey } from './construction';
import { moduleStock, type ModuleRefinementScope } from './module-refinement';

const port = (contract:string,x:number,y:number,z:number,w:number,d:number):ComponentPort=>({...studs(x,y,z,w,d),contract});
const evidence=['qa/animal-refinement-20261009/RESULTS.md'];

export function refinedTorso(): Component {
 return {id:'animal-torso-neck',label:'Tapered back and raised chest',evidence,
 preserves:['Shoulders remain within the leg width','Narrow raised neck','Separate lower back and rump'],
 inlet:port('animal-torso-4x8',0,0,0,4,8),
 ports:{head:port('animal-neck-2x2',1,0,8,2,2),tail:port('animal-tail-1x2',1,6,5,1,2)},steps:[
  s('Bridge the shoulder and hip supports.',p('plate-2x4','body',0,0,0),p('plate-4x6','body',0,2,0,90)),
  s('Shape a solid central core and compact rump.',p('brick-2x6','body',1,0,1,90),p('brick-2x2','body',1,6,1)),
  s('Close the flanks without widening the shoulders.',p('brick-1x6','body',0,1,1,90),p('brick-1x6','body',3,1,1,90)),
  s('Lift the pale chest into a narrow neck.',p('brick-1x3','light',1,0,4,90),p('brick-1x3','light',2,0,4,90)),
  s('Step the back inward behind the raised neck.',p('plate-1x4','body',0,3,4),p('plate-2x4','body',1,4,4,90)),
  s('Cap the neck with a common four-stud mount.',p('plate-2x3','body',1,0,7,90)),
 ]};
}

export function refinedHound(): Component {
 return {id:'animal-head-hound',label:'Narrow muzzle with low hanging ears',evidence,
 preserves:['Separate dark eyes without a horizontal stripe','Narrow projecting muzzle','Low ears outside the cheeks','Raised crown'],
 inlet:port('animal-neck-2x2',2,2,0,2,2),steps:[
  s('Bridge the neck forward with a narrow pale jaw.',p('plate-2x4','light',1,1,0)),
  s('Span the cheeks and low ear roots behind the muzzle.',p('plate-1x6','body',0,2,1),p('plate-1x2','light',2,1,1)),
  s('Fill the projecting muzzle beneath the nose.',p('invslope-2x2','light',2,0,2),p('brick-2x2','body',2,2,2)),
  s('Build brown cheeks around a solid skull.',p('brick-1x2','body',1,1,2,90),p('brick-1x2','body',4,1,2,90)),
  s('Hang the ears outside the cheeks.',p('brick-1x2','body',0,2,2,90),p('brick-1x2','body',5,2,2,90)),
  s('Place the nose lower and forward of the eyes.',p('plate-1x2','dark',2,0,5)),
  s('Raise the face beneath two forward-facing eye slits.',p('plate-1x4','body',1,1,5)),
  s('Bridge the forehead behind the eyes.',p('plate-2x4','body',1,2,5),p('plate-1x4','body',1,2,6)),
  s('Separate the eyes with a brown bridge.',p('tile-1x1','dark',1,1,6),p('tile-1x1','dark',4,1,6),p('plate-1x2','body',2,1,6)),
  s('Cap the brow from its central studs, covering the eye tops.',p('tile-1x4','body',1,1,7)),
  s('Finish the low ears behind the cheeks.',p('tile-1x2','body',0,2,5,90),p('tile-1x2','body',5,2,5,90)),
 ]};
}

export function refinedPlan(stance:AnimalStance='low',tail:AnimalTail='swept'){
 const plan=animalModulePlan('hound',stance,tail);
 plan.id=`refined-hound-${stance}-${tail}`;
 for(const step of plan.mounts[0].component.steps){
   for(const part of step.parts)if(part.z===0)part.role='body';
   for(const part of step.parts)if(part.shape==='plate-1x4')part.role='base';
 }
 plan.palette.base='tan';plan.palette.trim='tan';
 plan.allowedColors={...plan.allowedColors,light:['white'],base:['tan'],trim:['tan']};
 for(const step of plan.mounts[3].component.steps)for(const p of step.parts)if(p.role==='light')p.role='trim';
 plan.mounts[1].component=refinedTorso();
 plan.mounts[2].component=refinedHound();
 plan.features=['Narrow raised chest','Separate eyes and nose','Low hanging ears','Stepped crown and back'];
 return plan;
}

/** These are local prototype candidates, never auto-admitted to the finished library. */
export function refinedAnimalCandidates(stock: Record<string,number>, maxParts=120): LibraryMatch[] {
 const context=matchContext(stock),out:LibraryMatch[]=[];
 for(const stance of ['low','tall'] as const)for(const tail of ['swept','upright'] as const){
  const {recipe,summary}=compileComponents(refinedPlan(stance,tail));
  const match=matchRecipe(recipe,stock,context);
  if(match&&partCount(match.build)>=20&&partCount(match.build)<=maxParts)out.push({...match,componentPlan:summary});
 }
 return out;
}

export function refinedAnimalReceipts(match: LibraryMatch){
 const selection=/^components:refined-hound-(low|tall)-(swept|upright)$/.exec(match.recipeId);
 if(!selection)throw new Error('Not a refined hound assembly');
 return allocatedModuleReceipts(refinedPlan(selection[1] as AnimalStance,selection[2] as AnimalTail),match);
}

/** A receipt for a small replaceable region, not a label-based guess about arbitrary dogs. */
export function refinedMuzzleScope(match: LibraryMatch, stock: Record<string, number>): ModuleRefinementScope | undefined {
 if (!match.recipeId.startsWith('components:refined-hound-')) return undefined;
 const receipt = refinedAnimalReceipts(match).find(r => r.id === 'animal-head-hound')!;
 const [ox, oy, oz] = receipt.placement;
 const parts = match.build.steps.flatMap(s => s.parts);
 const expected = [
  ['plate-2x4-white',1,1,0], ['plate-1x2-white',2,1,1],
  ['invslope-2x2-white',2,0,2], ['plate-1x2-black',2,0,5],
 ] as const;
 const indices = expected.map(([id,x,y,z]) => parts.findIndex(p => p.partId === id && p.x === x+ox && p.y === y+oy && p.z === z+oz && p.rot === 0));
 // Allocator substitutions need their own receipt; never guess which pieces belong to this region.
 if (indices.some(i => i < 0)) return undefined;
 return { id:'hound-muzzle', label:'hound muzzle and lower jaw',
  objective:'Reduce the wide white shelf beneath the chin and make the muzzle profile more deliberate. Keep a pale projecting muzzle and a distinct dark nose below the eyes. Preserve the ears, eyes, skull, neck and body exactly.',
  originalKey:constructionKey(match.build), indices,
  min:[ox+1,oy-1,oz], max:[ox+5,oy+3,oz+6], maxParts:6,
  ports:[{face:'bottom',cells:[[ox+2,oy+2,oz],[ox+3,oy+2,oz]]},
   {face:'top',cells:[[ox+2,oy+2,oz+1],[ox+3,oy+2,oz+1]]}],
  stock:moduleStock(match.build,indices,stock,['white','black','reddish-brown'],6),
 };
}

/** Rebuild the next receipt from the current draft; previous module edits may reorder its parts. */
export function refinedBackScope(seed: LibraryMatch, current: Build, stock: Record<string, number>): ModuleRefinementScope | undefined {
 const head=refinedAnimalReceipts(seed).find(r=>r.id==='animal-head-hound')!;
 const [ox,oy,oz]=head.placement, x=ox+1,y=oy+5,z=oz-4;
 const index=current.steps.flatMap(s=>s.parts).findIndex(p=>p.partId==='plate-1x4-reddish-brown'&&p.x===x&&p.y===y&&p.z===z&&p.rot===0);
 if(index<0)return undefined;
 return {id:'hound-shoulder-contour',label:'shoulder contour',
  objective:'Soften the horizontal shelf behind the neck with a symmetric supported taper. Brown, tan or paired warm accents can shape the shoulder. Keep the rest of the back, neck, tail and legs fixed. Leave unchanged if available pieces only add clutter.',
  originalKey:constructionKey(current),indices:[index],min:[x,y,z],max:[x+4,y+1,z+4],maxParts:5,
  ports:[{face:'bottom',cells:[[x+1,y,z],[x+2,y,z]]}],
  stock:moduleStock(current,[index],stock,['reddish-brown','tan','medium-nougat'],5)};
}

export const REFINED_ANIMAL_MODULES: Component[]=[...new Map(
 (['low','tall'] as const).flatMap(stance=>(['swept','upright'] as const).flatMap(tail=>refinedPlan(stance,tail).mounts.map(m=>[m.component.id,m.component] as const)))
).values()];
