import {mutableWholeAnimalSketchIssues} from './whole-animal-plan-fit';
export {mutableWholeAnimalSketchIssues} from './whole-animal-plan-fit';
import type {AssemblyComposition} from '../assembly-composer/types';
import {wholeAnimalIssues} from '../assembly-composer/animal-whole';
import {frame} from '../connections';
import {ANIMAL_BLUEPRINT_SCHEMA,animalBlueprintIssues,type AnimalBlueprint} from './animal-blueprint';
import {validateWholeAnimalPlanRevision,type WholeAnimalPlanRevisionResult} from './whole-animal-plan-revision';
import {inventoryKey} from './discovery';
import {generate} from './pipeline';

/** An explicit designer decision after complete construction, never a silent
 * relaxation or geometry repair. The actual whole animal must already pass
 * canonical anatomy. Every revised promise is then rebound to these same parts.
 * This does not review or improve rendered craft. */
export async function repairWholeAnimalSketch(stock:Record<string,number>,blueprint:AnimalBlueprint,c:AssemblyComposition,issues:string[],minParts:number,opts:{signal?:AbortSignal;views?:(build:AssemblyComposition['build'])=>string[]}={}):Promise<WholeAnimalPlanRevisionResult>{
 const key=inventoryKey('sketch-repair',stock),active=()=>{if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');if(inventoryKey('sketch-repair',stock)!==key)throw Error('The inventory changed during sketch revision.');};active();
 if(wholeAnimalIssues(c).length||!mutableWholeAnimalSketchIssues(issues,blueprint))return {blueprint:null,issues:['Only a complete canonical Fox with editable sketch mismatches can use this revision step.']};
 const cost=new Map<string,number>();for(const p of c.build.steps.flatMap(s=>s.parts))cost.set(p.partId,(cost.get(p.partId)??0)+1);
 if([...cost].some(([id,n])=>!Number.isSafeInteger(stock[id])||stock[id]<n))return {blueprint:null,issues:['The complete construction does not fit the actual current stock.']};
 const all=c.build.steps.flatMap(s=>s.parts),roleBounds=Object.fromEntries([...new Set(c.receipts.map(r=>r.role))].map(role=>{const ff=c.receipts.filter(r=>r.role===role).flatMap(r=>r.indices.map(i=>frame(all[i])));return [role,{min:[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20),max:[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20)}];}));
 const ownership=new Map(c.receipts.flatMap(r=>r.indices.map(i=>[i,r.role] as const))),actualParts=all.map((p,i)=>({index:i,partId:p.partId,role:ownership.get(i)})),actualContacts=c.build.requiredContacts??[];
 const images=(opts.views?.(c.build)??[]).map(url=>{const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url);if(!m)throw Error('Actual rendered views required.');return {inlineData:{mimeType:m[1],data:m[2]}};});active();
 const reply=await generate<{canRevise:boolean;reason:string;blueprint?:unknown}>([{role:'user',parts:[{text:`The complete generated Fox passed its exact stock, independent anatomical-module compilation, real contacts, grounding and canonical anatomy checks. It has NOT passed its sketch or visual quality review. Geometry and pieces are NOT editable in this call. Decide whether the working MOC sketch can truthfully adapt to the actual construction through MINIMUM explicit edits. A flat narrow muzzle can promise thin rather than an absent taper; never invent contour, strength or visual-quality evidence. Keep exact id, subject, stance, palette sets, parts.min and every feature id/intent/pairing/piece/carrier/shared-token binding unchanged. Feature supportMode may explicitly change to anatomy when actual same-carrier-role bridges connect its reserved pieces/carriers; every such bridge is already real, billed and physically checked. It cannot route through different roles or invent parts/contacts. Only spatial regions/region intents, feature supportMode, overall size/proportion intervals, void locations, parts.max and descriptions may otherwise revise within the original global Fox limits. Do not erase promises that already hold. If actual proportions cannot satisfy those global limits, return canRevise:false with the reason; the model must be rebuilt. Otherwise return canRevise:true, a specific reason <=600characters, and the COMPLETE revised blueprint. Every promise will be checked against the SAME actual build before acceptance.\nCURRENT SKETCH: ${JSON.stringify(blueprint)}\nACTUAL OVERALL STUD SIZE: ${JSON.stringify(c.size)}\nACTUAL ROLE BOUNDS IN STUDS: ${JSON.stringify(roleBounds)}\nACTUAL BILLED PART INDICES AND ANATOMY OWNERS: ${JSON.stringify(actualParts)}\nACTUAL VERIFIED CONTACT EDGES: ${JSON.stringify(actualContacts)}\nONLY FAILING SKETCH PROMISES: ${JSON.stringify(issues)}`},...images]}],{type:'OBJECT',required:['canRevise','reason'],properties:{canRevise:{type:'BOOLEAN'},reason:{type:'STRING'},blueprint:ANIMAL_BLUEPRINT_SCHEMA}},opts.signal,'low');active();
 if(reply.json?.canRevise!==true)return {blueprint:null,reason:typeof reply.json?.reason==='string'?reply.json.reason.slice(0,600):undefined,issues:['The designer declined to revise the sketch; actual geometry needs further work.']};
 const checked=validateWholeAnimalPlanRevision(blueprint,{reason:reply.json.reason,blueprint:reply.json.blueprint},stock,minParts);
 if(checked.blueprint){const remaining=animalBlueprintIssues(c,checked.blueprint,stock);if(remaining.length)return {blueprint:null,reason:checked.reason,issues:remaining};}
 return checked;
}
