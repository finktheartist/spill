import {parsePartId,type Build} from '../bricks';
import {connectionPairs,frame} from '../connections';
import {wholeAnimalIssues} from '../assembly-composer/animal-whole';
import type {AssemblyComposition} from '../assembly-composer/types';

const purpose:Record<string,string>={
 chest:'This forms the front of the body.',hips:'This forms the rear of the body.',torso:'Keep the gap beneath the belly open.',
 'leg-front-left':'This is the front left leg.','leg-front-right':'This is the front right leg.',
 'leg-rear-left':'This is the rear left leg.','leg-rear-right':'This is the rear right leg.',
 neck:'This joins the head to the shoulders.',head:'This supports the face and ears.',
 muzzle:'This forms the narrow projecting snout.',nose:'Keep the dark nose at the end of the snout.',
 'eye-left':'Keep the left eye clear above the snout.','eye-right':'Match the height of the other eye.',
 'ear-left':'This forms the left ear peak.','ear-right':'Match the other ear peak.',
 tail:'This forms the tail that narrows toward its tip.',frame:'This connects the body sections.',
};
/** Caption-only copy. The authoritative composition, recipe, contacts and exact
 * poses stay untouched. Contact traversal is not an insertion-path or strength
 * simulation; the illustrated orientation remains necessary. */
export function wholeAnimalInstructions(c:AssemblyComposition):Build {
 const issues=wholeAnimalIssues(c,c.plan.name);if(issues.length)throw Error(`Cannot describe unchecked animal construction: ${issues.join('; ')}`);
 const original=c.build,parts=original.steps.flatMap(s=>s.parts),roles=new Map(c.receipts.flatMap(r=>r.indices.map(i=>[i,r.role] as const))),seen=new Set<string>();
 if(original.steps.some(s=>s.parts.length!==1))throw Error('Whole-animal instructions require one actual part per step.');
 const steps=original.steps.map((step,i)=>{
  const p=parts[i],k=parsePartId(p.partId)!,role=roles.get(i)!;
  const label=`${k.color.replaceAll('-',' ')} ${k.w} × ${k.d} ${k.type.replace('round','round ').replace('invslope','inverted slope')}`;
  let caption:string;
  if(!i)caption=`Place the ${label} on the table in the orientation shown.`;
  else {
   const candidates=(original.requiredContacts??[]).flatMap(contact=>contact.a===i&&contact.b<i?[{other:contact.b,own:contact.aPort,parent:contact.bPort}]:contact.b===i&&contact.a<i?[{other:contact.a,own:contact.bPort,parent:contact.aPort}]:[]).sort((a,b)=>b.other-a.other);
   const link=candidates.find(l=>connectionPairs(frame(parts[l.other]),frame(p)).some(([a,b])=>a===l.parent&&b===l.own));
   if(!link)throw Error(`Instruction step ${i+1} has no earlier verified attachment.`);
   const parent=frame(parts[link.other]).ports.find(port=>port.id===link.parent)!;
   caption=`${parent.normal[2]<-.9?'Turn the model over to reach the underside. ':''}Attach the ${label} to the piece from step ${link.other+1}. Match the position and orientation shown.${parent.normal[2]<-.9?' Return the model upright.':''}`;
  }
  if(!seen.has(role)){caption+=` ${purpose[role]??''}`;seen.add(role);}
  return {...step,caption,parts:step.parts.map(part=>({...part,...(part.orientation?{orientation:[...part.orientation] as typeof part.orientation}:{})}))};
 });
 return {...original,steps,requiredContacts:original.requiredContacts?.map(contact=>({...contact}))};
}
