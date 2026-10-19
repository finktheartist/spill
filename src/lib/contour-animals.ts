import { part as p, layer as s } from './recipe-kit';
import { footprint, parsePartId, partCount, type ColorName } from './bricks';
import type { Recipe, RecipePart, Role } from './library-recipes';
import { matchContext, matchRecipe, type LibraryMatch } from './library';

export type ContourProfile = 'shell' | 'upright' | 'long';
export interface ContourPlan {
 profile: ContourProfile; subject: string; silhouette: string; landmarks: string[];
 recipe: Recipe;
}
/** Reflection is an operation on placements, not a second hand-authored animal. */
export function mirrored(shape:string,role:Role,x:number,y:number,z:number,centerX:number,rot=0):RecipePart[] {
 const k=parsePartId(`${shape}-white`)!;
 const w=footprint(k,rot).fw;
 const directional=['cheese','curve','slope','invslope'].includes(k.type);
 return [p(shape,role,x,y,z,rot),p(shape,role,2*centerX-x-w,y,z,directional?(rot===90?270:rot===270?90:rot):rot)];
}
/** A supported, narrowing three-layer tail. Length changes the outline before allocation. */
export function sweptTail(x:number,y:number,z:number,length:8|10,role:Role='body') {
 return [s('Anchor the long tail under its shorter upper layers.',p(`plate-1x${length}`,role,x,y,z,90)),
  s('Taper the tail toward its tip.',p(`plate-1x${length-2}`,role,x,y,z+1,90)),
  s('Keep the tail root thicker than the tip.',p('plate-1x4',role,x,y,z+2,90))];
}
const recipe=(id:string,name:string,steps:Recipe['steps'],palette:Partial<Record<Role,ColorName>>):Recipe=>({
 id:`contour:${id}`,family:id,name,pitch:'A silhouette-first construction trial using the saved inventory.',category:'Animals',features:[],
 palette,allowedColors:Object.fromEntries(Object.entries(palette).map(([role,color])=>[role,[color]])),contrast:[],steps:[...steps].sort((a,b)=>Math.min(...a.parts.map(p=>p.z))-Math.min(...b.parts.map(p=>p.z))),
});

export function contourPlan(profile:ContourProfile, tailLength:8|10=10):ContourPlan {
 if(profile==='upright')return {profile,subject:'Duck',silhouette:'Compact horizontal body, wide flat bill, narrow round neck, raised head and two separate feet.',landmarks:['Flat bill projects below the eyes','Neck narrower than the head','Thin wings wider than the body','Low curved tail'],recipe:recipe('duck','Flat-billed duck',[
  s('Separate the two yellow feet.',...mirrored('plate-1x2','light',2,0,0,3.5,90)),
  s('Set short legs toward the back of the feet.',...mirrored('brick-1x3','body',2,1,1,3.5,90)),
  s('Join the legs under a compact belly.',p('plate-4x4','body',1,2,4)),
  s('Build the breast and rear body.',p('brick-2x4','body',1,2,5),p('brick-2x4','body',1,4,5)),
  s('Leave a narrow neck mount and thin wings.',p('plate-1x4','body',1,2,8),p('plate-2x6','body',0,4,8)),
  s('Raise the round neck and support a low tail.',p('roundbrick-2x2','body',2,2,9),p('plate-4x4','body',1,4,9)),
  s('Curve the tail down toward its tip.',p('curve-1x3','body',2,5,10,180)),
  s('Flare the head forward from its neck.',p('invslope-2x2','body',2,1,12)),
  s('Project a flat orange bill below a solid head.',p('plate-1x2','accent',2,1,15),p('brick-2x4','body',1,2,15)),
  s('Separate the eyes and support the brow between them.',...mirrored('tile-1x1','dark',1,2,18,3),p('plate-1x2','body',2,2,18),p('plate-1x3','body',2,3,18)),
  s('Cover the eyes with a supported brow.',p('plate-2x4','body',1,2,19)),
  s('Step the crown inward.',p('plate-2x2','body',2,2,20)),
  s('Smooth the front of the crown.',p('tile-1x2','body',2,2,21)),
 ],{body:'white',dark:'black',accent:'bright-light-orange',light:'yellow'})};
 if(profile==='shell')return {profile,subject:'Tortoise',silhouette:'Wide low shell with successively narrower terraces, four projecting flippers, and a small extended head.',landmarks:['Shell much wider than the head','Four feet visible outside the rim','Dome narrows at every level','Short pointed tail'],recipe:recipe('tortoise','Terraced tortoise',[
  s('Spread four feet and a short tail around the shell.',...mirrored('plate-2x3','light',1,3,0,6),...mirrored('plate-2x3','light',1,7,0,6),p('plate-1x4','light',5,8,0,90)),
  s('Join the feet with two shell halves.',p('plate-4x6','body',2,3,1,90),p('plate-4x6','body',6,3,1,90)),
  s('Project the head, bridge the shell seam, and lift the rear shell.',p('brick-2x4','foliage',4,2,2),p('brick-2x6','body',3,4,2),p('brick-2x2','body',4,6,2),p('brick-2x2','body',6,6,2)),
  s('Step the shell inward and place two eyes on the small head.',p('plate-2x6','body',3,4,5),p('plate-2x4','body',4,6,5),...mirrored('tile-1x1','dark',4,2,5,6),p('tile-1x2','light',5,3,5)),
  s('Taper both shell shoulders toward the central crown.',p('plate-2x4','body',4,4,6),...mirrored('cheese-1x1','accent',3,4,6,6,270)),
  s('Reduce the crown to a smaller pale panel.',p('plate-2x4','light',4,4,7)),
  s('Smooth the shell crown.',p('tile-2x3','light',4,4,8)),
 ],{body:'reddish-brown',light:'tan',dark:'black',foliage:'green',accent:'medium-nougat'})};
 return {profile,subject:'Otter',silhouette:'Long low torso with four separated paws, a pale lifted face, narrow back and an extended tapered tail.',landmarks:['Body longer than it is tall','Paws remain visible outside the torso','Tail tapers over three layers','Pale muzzle below separate dark eyes'],recipe:recipe(`otter-${tailLength}`,'Long-tailed otter',[
  s('Set four broad paws apart.',...mirrored('plate-2x3','light',0,3,0,3),...mirrored('plate-2x3','light',0,8,0,3)),
  s('Raise four short legs.',...mirrored('brick-1x2','body',1,3,1,3,90),...mirrored('brick-1x2','body',1,8,1,3,90)),
  s('Bridge the paws with a long narrow belly.',p('plate-2x4','body',1,2,4),p('plate-4x6','body',1,4,4,90)),
  s('Fill the narrow core, leaving the paws outside it.',p('brick-2x4','body',2,5,5,90),...mirrored('brick-1x3','body',1,4,5,3,90),...mirrored('brick-1x3','body',1,7,5,3,90),p('brick-2x2','body',2,9,5),...mirrored('brick-1x3','trim',2,2,5,3,90)),
  s('Narrow the back and carry the pale jaw forward.',p('plate-2x4','body',2,4,8,90),p('plate-2x3','body',2,8,8,90),p('plate-2x4','trim',1,1,8)),
  s('Shape the muzzle under a compact skull.',p('invslope-2x2','trim',2,0,9),p('brick-2x2','body',2,2,9),...mirrored('brick-1x2','body',1,1,9,3,90)),
  ...sweptTail(2,9,1,tailLength),
  ...sweptTail(3,9,1,tailLength),
  s('Make a separate nose and a face wider than the muzzle.',p('plate-1x2','dark',2,0,12),p('plate-1x4','body',1,1,12),p('plate-2x4','body',1,2,12)),
  s('Separate the eyes with a brown bridge.',...mirrored('tile-1x1','dark',1,1,13,3),p('plate-1x2','body',2,1,13),...mirrored('cheese-1x1','accent',1,2,13,3,270)),
  s('Finish the brow above the eyes.',p('tile-1x4','body',1,1,14)),
 ],{body:'reddish-brown',light:'tan',trim:'white',dark:'black',accent:'medium-nougat'})};
}

/** Experimental vocabulary. Allocation may split rectangles, but never flatten a required shaped part. */
export function contourCandidates(stock:Record<string,number>,maxParts=120):LibraryMatch[] {
 const context=matchContext(stock),out:LibraryMatch[]=[];
 for(const profile of ['shell','upright','long'] as const){
  const plan=contourPlan(profile),match=matchRecipe(plan.recipe,stock,context);
  if(match&&partCount(match.build)>=20&&partCount(match.build)<=maxParts)out.push({...match,silhouettePlan:{profile,outline:plan.silhouette,landmarks:plan.landmarks}});
 }
 return out;
}
