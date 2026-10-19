import {generate,type RankedIdea} from './pipeline';

export interface CriticalFeature {role:string;observation:string;blocking:boolean;fix:string}
export interface CriticalForm {observation:string;blocking:boolean;fix:string}
export interface WholeModelReview {features:CriticalFeature[];massing:CriticalForm;support:CriticalForm;pass:boolean;fixes:string[]}
const str={type:'STRING'};
const formSchema={type:'OBJECT',required:['observation','blocking','fix'],properties:{observation:str,blocking:{type:'BOOLEAN'},fix:str}};
export const criticalReviewSchema={type:'OBJECT',required:['features','massing','support'],properties:{
 features:{type:'ARRAY',minItems:2,maxItems:4,items:{type:'OBJECT',required:['role','observation','blocking','fix'],properties:{role:str,observation:str,blocking:{type:'BOOLEAN'},fix:str}}},
 massing:formSchema,support:formSchema,
}};
export function readCriticalReview(raw:unknown):WholeModelReview{
 if(!raw||typeof raw!=='object')throw Error('Critical-feature review is malformed.');
 const v=raw as Record<string,unknown>,validText=(s:unknown)=>typeof s==='string'&&s.trim().length>0&&s.length<=1600;
 const form=(raw:unknown):CriticalForm=>{
  if(!raw||typeof raw!=='object')throw Error('Critical massing/support review is malformed.');
  const f=raw as CriticalForm;if(!validText(f.observation)||!validText(f.fix)||typeof f.blocking!=='boolean')throw Error('Critical massing/support review needs observation, blocking and fix.');
  return {observation:f.observation,blocking:f.blocking,fix:f.fix};
 };
 if(!Array.isArray(v.features)||v.features.length<2||v.features.length>4)throw Error('Critical-feature review needs two to four visible features, massing and support observations.');
 const features=v.features.map(f=>{
  if(!f||typeof f!=='object'||![f.role,f.observation,f.fix].every(validText)||typeof f.blocking!=='boolean')throw Error('Critical-feature review returned an invalid feature.');
  return {role:f.role as string,observation:f.observation as string,blocking:f.blocking as boolean,fix:f.fix as string};
 });
 if(new Set(features.map(f=>f.role.trim().toLowerCase())).size!==features.length)throw Error('Critical-feature roles must be distinct.');
 const massing=form(v.massing),support=form(v.support),gates=[...features,{role:'Massing',...massing},{role:'Support presentation',...support}];
 return {features,massing,support,pass:gates.every(f=>!f.blocking),fixes:gates.filter(f=>f.blocking).map(f=>`${f.role}: ${f.fix}`)};
}

/** Independent, fresh image-only craft evidence plus intended subject. Never
 * sees stock, builder rationalizations, physics verdicts or a previous grade. */
export async function reviewWholeModel(idea:RankedIdea,images:string[],signal?:AbortSignal):Promise<WholeModelReview>{
 if(images.length!==4)throw Error('Critical-feature review requires quarter, front, side and rear renders.');
 const parts:Record<string,unknown>[]=[{text:`Critique the ACTUAL brick miniature in these four views. Intended subject: ${JSON.stringify(idea.name)} (${idea.pitch}). Views in order: quarter, front, side, rear. Judge visible shape, never the caption's promise.
Select two to four distinct critical feature roles, including the subject's most defining specialist features. Review overall massing and grounding/support presentation separately. For EVERY feature, massing and support give observation, blocking:boolean and fix. Mark blocking=true if it seriously compromises the subject or craft. Every blocking item needs a concrete geometry correction. A nonblocking item's fix may say "No critical correction needed".
Look closely at substitute shapes: roofs must look like roofs rather than chimneys or vertical fins; wings need a thin coherent span; anatomy must connect with convincing proportions. Check broad decks/backs for lonely stilts, random protrusions, abrupt necks, exposed carriers and awkward holes from the rear as well as front. Check whether slopes/curves actually shape the visible contour. Do not infer hidden supports, invent missing pieces, demand unprovided parts, or award quality for count, symmetry or neat colors alone. A generic decorated block should fail its massing gate. A convincing modest miniature may pass without ornamental complexity. Rendered appearance cannot prove clutch strength or real stability. Return JSON only.`}];
 for(const image of images){const m=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image);if(!m)throw Error('Invalid critical-review render.');parts.push({inlineData:{mimeType:m[1],data:m[2]}});}
 const r=await generate<unknown>([{role:'user',parts}],criticalReviewSchema,signal,'high');
 return readCriticalReview(r.json);
}
