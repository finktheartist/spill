/** Complete anatomical alternatives: stock and species traits are checked before a visual selector chooses a model. */
import {heightOf,parsePartId,partCount,type Build} from '../bricks';
import {constructionIssues} from '../construction';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {inspectSpecialParts} from '../assembly-composer/special-parts';
import {animalCompositionIssues} from '../assembly-composer/animals';
import {animalSubjectKind,animalRelatedKinds,animalKindName,animalAdaptationReason,animalSubjectTraits} from '../assembly-composer/animal-subjects';
import type {AssemblyComposition} from '../assembly-composer/types';
import {discoverAnimalCompositions} from './animal-discovery';
import {synthesizeFoxHeads} from './animal-improviser';
import {synthesizeWholeAnimals,wholeAnimalBodyKey,type WholeAnimalDesign} from './whole-animal-synthesis';
import {wholeAnimalInstructions} from './animal-instructions';
import {inventoryKey} from './discovery';
import type {FeatureReceipt} from '../moc-feature-edit';
import {assemblyMenu} from './assembly-first';
import {appearanceIsBetter} from './appearance';
import {generate,type RankedIdea} from './pipeline';
import type {ShapeVerdict} from './run';

export interface AnimalFirstResult {
 build:Build;features:FeatureReceipt[];composition:AssemblyComposition;verdict:ShapeVerdict;
 design?:WholeAnimalDesign;
 idea:RankedIdea;requestedName:string;adaptation?:string;traits:string[];revised:boolean;reviewed:number;
}
interface Options {
 signal?:AbortSignal;minParts:number;
 /** Experimental whole-model Fox path; enabled explicitly until visually qualified. */
 wholeModel?:boolean;views:(build:Build)=>string[];
 judge:(build:Build,idea:RankedIdea,signal?:AbortSignal)=>Promise<ShapeVerdict>;
 onProgress?:(text:string)=>void;debug?:(label:string,data:unknown)=>void;
 /** Claims only a visual shape for diversity across alternatives; it never reserves the pile for another build. */
 claim?:(build:Build)=>boolean;release?:(build:Build)=>void;unavailable?:(build:Build)=>boolean;
}
const strong=(v:ShapeVerdict)=>v.named&&v.recognizable>=4&&v.complete>=4&&v.colors>=3&&v.impressive>=4;
const inline=(url:string)=>{const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url);if(!m)throw Error('Animal selection requires actual rendered views.');return {inlineData:{mimeType:m[1],data:m[2]}};};
function adaptation(requestedName:string,actualName:string):string|undefined {
 if(!animalAdaptationReason(requestedName,actualName))return undefined;
 const kind=animalSubjectKind(actualName),details=kind==='dog'?'a moderate muzzle, low ears and a narrow raised tail'
  :kind==='fox'?'a long projecting muzzle, alert ears and a sweeping tail':'a compact body, short muzzle, rounded ears and a stub tail';
 return animalSubjectKind(requestedName)==='quadruped'
  ?`For your “${requestedName}” request, the selected model is a general ${actualName.toLowerCase()} with ${details}.`
  :`Adapted “${requestedName}” to a general ${actualName}: the selected model has ${details}.`;
}

/** Keep morphology distinct and give the requested kind plus related supported kinds a fair place in the menu. */
export function animalMenu(candidates:AssemblyComposition[],requestedName:string,limit=4):AssemblyComposition[] {
 const allowed=animalRelatedKinds(requestedName),seen=new Set<string>();
 const unique=candidates.filter(c=>{const kind=animalSubjectKind(c.plan.name);if(!kind||kind==='quadruped'||c.plan.name!==animalKindName(kind)||!allowed.includes(kind))return false;const key=animalSilhouetteKey(c.build);if(seen.has(key))return false;seen.add(key);return true;});
 const groups=allowed.map(kind=>unique.filter(c=>animalSubjectKind(c.plan.name)===kind)).filter(g=>g.length);
 const menu:AssemblyComposition[]=[];
 const requestedKind=animalSubjectKind(requestedName);
 const crafted=unique.filter(c=>animalSubjectKind(c.plan.name)===requestedKind&&c.plan.id.startsWith('animal-craft:'));
 // A focused craft experiment needs room for different assemblies of the
 // requested animal, while preserving a related fallback when space remains.
 // These are unqualified design alternatives; the blind review still decides.
 if(crafted.length>=2&&limit>=2){
  menu.push(...assemblyMenu(crafted,Math.min(3,limit)));
  for(const group of groups)if(animalSubjectKind(group[0].plan.name)!==requestedKind&&menu.length<limit)menu.push(group[0]);
  for(const c of unique)if(menu.length<limit&&!menu.includes(c))menu.push(c);
  return menu;
 }
 // One per available species first; remaining positions explore proportions within those species.
 for(const group of groups)if(menu.length<limit)menu.push(group[0]);
 for(const group of groups){if(menu.length>=limit)break;const chosen=assemblyMenu(group,Math.min(group.length,limit-menu.length+1));for(const c of chosen.slice(1)){if(menu.length>=limit)break;menu.push(c);}}
 return menu;
}

function actualIdea(requested:RankedIdea,c:AssemblyComposition):RankedIdea {
 const colors=new Map<string,number>();
 for(const p of c.build.steps.flatMap(s=>s.parts)){const k=parsePartId(p.partId)!;colors.set(k.color,(colors.get(k.color)??0)+k.w*k.d*heightOf(k));}
 const {atlas:_atlas,construction:_construction,features:_features,discovery:_discovery,...base}=requested;
 return {...base,name:c.plan.name,pitch:c.plan.description,length:c.size[1],width:c.size[0],height:c.size[2],
  palette:[...colors].map(([color,cells])=>({role:'coat and details',color,cells})),
  discovery:{family:'animals',concept:c.plan.name.toLowerCase(),form:c.plan.description.slice(0,120)},
  why:adaptation(requested.name,c.plan.name)??requested.why};
}

export async function buildAnimalFirst(requested:RankedIdea,stock:Record<string,number>,opts:Options):Promise<AnimalFirstResult|null> {
 if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
 if(!animalSubjectKind(requested.name))return null;
 const stockKey=inventoryKey('animal-first',stock),fresh=()=>{if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');if(inventoryKey('animal-first',stock)!==stockKey)throw Error('The inventory changed during animal design.');};
 opts.onProgress?.('Matching animal bodies, heads, four legs and tails against your pieces…');
 let synthesis:Awaited<ReturnType<typeof synthesizeFoxHeads>>|undefined;
 let whole:Awaited<ReturnType<typeof synthesizeWholeAnimals>>|undefined;
 const wholeDesigns=new Map<AssemblyComposition,WholeAnimalDesign>(),rememberDesigns=(r:Awaited<ReturnType<typeof synthesizeWholeAnimals>>)=>{for(const c of r.candidates){const d=r.designs.find(d=>d.compositionId===c.plan.id);if(d)wholeDesigns.set(c,d);}};
 if(animalSubjectKind(requested.name)==='fox')try{
  if(opts.wholeModel===true)whole=await synthesizeWholeAnimals(stock,requested.name,{signal:opts.signal,minParts:opts.minParts,views:opts.views,onProgress:opts.onProgress,debug:opts.debug});
  else synthesis=await synthesizeFoxHeads(stock,requested.name,{signal:opts.signal,views:opts.views,onProgress:opts.onProgress,debug:opts.debug});
 }
 catch(e){if(opts.signal?.aborted)throw e;opts.debug?.('animalImprovisationStopped',{reason:String(e)});}
 fresh();if(whole)rememberDesigns(whole);
 const choices=animalMenu((whole?.candidates??synthesis?.candidates??[]).filter(c=>partCount(c.build)>=opts.minParts&&!opts.unavailable?.(c.build)),requested.name);
 if(!choices.length){
  if(whole)opts.onProgress?.('A fresh whole Fox did not pass its design and construction checks; trying existing animal layouts…');
  else if(synthesis?.context)opts.onProgress?.('A fresh Fox head did not pass construction checks; trying existing animal layouts…');
  const {found,planCount}=await discoverAnimalCompositions(stock,requested.name,opts.minParts,opts.signal);
  fresh();choices.push(...animalMenu(found.candidates.filter(c=>!opts.unavailable?.(c.build)),requested.name));
  opts.debug?.('animalAssemblyDiscovery',{requested:requested.name,plans:planCount,attempts:found.attempts,rejected:found.rejected,exhausted:found.exhausted,legal:found.candidates.length,distinct:choices.length,
   choices:choices.map(c=>({id:c.plan.id,name:c.plan.name,parts:partCount(c.build),size:c.size,roles:c.receipts.map(r=>r.role)})),improvised:false});
 }else opts.debug?.('animalAssemblyDiscovery',{requested:requested.name,improvised:true,legal:choices.length,choices:choices.map(c=>({id:c.plan.id,parts:partCount(c.build)}))});
 if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
 if(!choices.length)return null;
 const special=inspectSpecialParts(stock).filter(p=>p.status==='usable'&&p.count!>0);
 const specialIds=new Set(special.map(p=>p.id));
 const specialBrief=special.map(p=>({id:p.id,count:p.count,identicalPairs:p.pairedCount,potentialRoles:p.shapeRoles,
  constraints:p.connectorConstraints,guidance:p.allocationGuidance}));
 opts.debug?.('animalSpecialPartCapabilities',specialBrief);
 const ctl=new AbortController(),stop=()=>ctl.abort();opts.signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(stop,480000),active=()=>{fresh();if(ctl.signal.aborted||opts.signal?.aborted)throw new DOMException('Stopped','AbortError');};
 const tried=new Set<number>(),held=new Set<Build>();let best:AnimalFirstResult|undefined,reviewed=0,committed=false;
 const acquire=(build:Build)=>{if(opts.claim&&!opts.claim(build))return false;if(opts.claim)held.add(build);return true;};
 const release=(build:Build)=>{if(held.delete(build))opts.release?.(build);};
 try {
  for(let round=0;round<Math.min(3,choices.length);round++) {
   active();let available=choices.map((candidate,index)=>({candidate,index})).filter(c=>!tried.has(c.index)&&!opts.unavailable?.(c.candidate.build));
   if(!available.length)break;
   let chosen=available[0],claimed=false;
   const menu=()=>available.map(({candidate:c,index})=>({id:`animal-${index+1}`,name:c.plan.name,description:c.plan.description,traits:animalSubjectTraits(animalSubjectKind(c.plan.name) as 'dog'|'fox'|'bear'),parts:partCount(c.build),size:c.size,modules:c.receipts.map(r=>({role:r.role,cost:r.cost})),
    specialPartAllocation:c.receipts.map(r=>({role:r.role,parts:Object.fromEntries(Object.entries(r.cost).filter(([id])=>specialIds.has(id)))})).filter(r=>Object.keys(r.parts).length)}));
   if(available.length>1) {
    opts.onProgress?.(round?'Choosing a different animal anatomy from the visual review…':'Choosing the clearest animal anatomy and proportions…');
    const content:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[
     {text:`Choose the strongest complete LEGO animal from this fixed pile. The requested subject is ${JSON.stringify(requested.name)}. Each offered layout has an actual anatomical species name supported by its constructed muzzle, ears, body and tail. Favor the requested kind when it reads convincingly; choose a related kind when its actual construction is visibly stronger. Any change will be explicitly labelled. Do not rename a Dog to Fox or claim unsupported breed details, moving joints or missing parts. These are already compiled complete alternatives from one exact stock ledger EACH, with actual connectors and physical proportions checked. Select an offered layout ID; do not invent coordinates, change a part, add scenery or pad the count. Favor visible paired eyes, shaped muzzle and head, proportional chest/hips, open space under the belly, four aligned feet, a deliberate tail profile and coherent coat/detail color. Compare how the actual reserved slopes, curves and other special pieces shape exposed cheeks, muzzle, shoulders and tail in the rendered views. More special pieces is not a craft score. Potential roles and identical inventory pairs do not prove a legal placement, visual benefit or clutch strength; compiled recipes and blind review remain the authorities. Do not add an unused specialty part or invent side-stud/offset carriers. ${best?`The retained model's blind review: ${JSON.stringify(best.verdict)}. Try an UNREVIEWED arrangement that improves large proportions or silhouette.`:''}\nSPECIAL PART CAPABILITIES: ${JSON.stringify(specialBrief)}\nMENU: ${JSON.stringify(menu())}`},
     ...available.flatMap(({candidate:c,index})=>[{text:`ANIMAL ${index+1}: ${c.plan.name}`},...opts.views(c.build).map(inline)]),
    ]}];
    for(let attempt=0;attempt<2;attempt++) {
     active();available=available.filter(c=>!opts.unavailable?.(c.candidate.build));if(!available.length)break;
     const reply=await generate<{choiceId:string;reason:string}>(content,{type:'OBJECT',required:['choiceId','reason'],properties:{choiceId:{type:'STRING',enum:menu().map(m=>m.id)},reason:{type:'STRING'}}},ctl.signal);active();
     const selected=available.find(c=>`animal-${c.index+1}`===reply.json?.choiceId);
     if(selected&&typeof reply.json.reason==='string'&&reply.json.reason.trim()&&!opts.unavailable?.(selected.candidate.build)&&acquire(selected.candidate.build)){chosen=selected;claimed=true;opts.debug?.('animalAssemblySelection',{round,id:chosen.candidate.plan.id,name:chosen.candidate.plan.name,reason:reply.json.reason});break;}
     content.push(reply.content,{role:'user',parts:[{text:`Nothing changed. Select exactly one currently available ID and give a short reason. A shape already selected for another displayed option is unavailable. Current menu: ${JSON.stringify(menu().filter(m=>{const c=available.find(c=>`animal-${c.index+1}`===m.id)!;return !opts.unavailable?.(c.candidate.build);} ))}`}]});
    }
    if(!claimed)throw Error('No available complete animal layout was selected after one repair.');
   }else {
    if(opts.unavailable?.(chosen.candidate.build)||!acquire(chosen.candidate.build)){tried.add(chosen.index);continue;}claimed=true;
   }
   active();tried.add(chosen.index);const c=chosen.candidate,count=partCount(c.build),idea=actualIdea(requested,c);
   const issues=[...constructionIssues(c.build,stock,24).map(i=>i.message),...animalCompositionIssues(c,c.plan.name)];
   if(count<opts.minParts||count>80)issues.push(`Complete animal needs ${opts.minParts}–80 purposeful pieces.`);
   if(issues.length)throw Error(`The composed animal changed before review: ${issues.join('; ')}`);
   opts.onProgress?.(`Reviewing the complete ${idea.name.toLowerCase()} without its label…`);
   const beforeReview=JSON.stringify(c.build.steps);
   const verdict=await opts.judge(c.build,idea,ctl.signal);active();
   if(JSON.stringify(c.build.steps)!==beforeReview||constructionIssues(c.build,stock,24).length||animalCompositionIssues(c,c.plan.name).length)throw Error('The composed animal changed during review.');
   reviewed++;
   const instructions=c.plan.id.startsWith('animal-whole:')?wholeAnimalInstructions(c):c.build;
   const result:AnimalFirstResult={build:{...instructions,name:idea.name,description:idea.pitch,...(!c.plan.id.startsWith('animal-whole:')&&!c.plan.id.startsWith('animal-improv:')?{source:{kind:'library' as const,recipeId:c.plan.id}}:{})},idea,requestedName:requested.name,
    adaptation:adaptation(requested.name,idea.name),traits:animalSubjectTraits(animalSubjectKind(idea.name) as 'dog'|'fox'|'bear'),
    composition:c,design:wholeDesigns.get(c),verdict,features:c.receipts.map(r=>({id:r.id,studyId:`animal-assembly:${r.role}`,choiceId:r.optionId,cost:r.cost,indices:r.indices})),revised:round>0,reviewed};
   opts.debug?.('animalAssemblyCandidate',{round,...result});
   if(!best||appearanceIsBetter(best.verdict,verdict)){if(best)release(best.composition.build);best=result;}else release(c.build);
   if(strong(best.verdict))break;
   if(round===0&&whole&&best.composition.plan.id.startsWith('animal-whole:')&&!choices.some((c,i)=>!tried.has(i)&&!opts.unavailable?.(c.build))){
    opts.onProgress?.('Replanning the complete animal from its blind review…');
    const revision=await synthesizeWholeAnimals(stock,requested.name,{signal:ctl.signal,minParts:opts.minParts,views:opts.views,
     critique:{composition:best.composition,verdict:best.verdict},avoidBodyKeys:choices.filter(c=>c.plan.id.startsWith('animal-whole:')).map(wholeAnimalBodyKey),onProgress:opts.onProgress,debug:opts.debug});active();
    rememberDesigns(revision);
    choices.push(...revision.candidates.filter(c=>partCount(c.build)>=opts.minParts&&!opts.unavailable?.(c.build)));
   }
   // Rebuild this actual head/neck once from its rendered criticism. Reuse the
   // headless context: the replaced group's parts are available again, while
   // the body ledger remains charged. No authored-head ID counts as revision.
   if(round===0&&synthesis?.context&&best.composition.plan.id.startsWith('animal-improv:')){
    opts.onProgress?.('Reconstructing the head and neck from the blind review…');
    const revision=await synthesizeFoxHeads(stock,requested.name,{signal:ctl.signal,views:opts.views,context:synthesis.context,
     critique:{composition:best.composition,verdict:best.verdict},avoidKeys:choices.map(c=>animalSilhouetteKey(c.build)),onProgress:opts.onProgress,debug:opts.debug});active();
    choices.push(...revision.candidates.filter(c=>partCount(c.build)>=opts.minParts&&!opts.unavailable?.(c.build)));
   }
  }
  if(!best)throw Error('No unused complete animal was reviewed.');
  committed=true;return {...best,reviewed};
 }catch(e){
  fresh();if(opts.signal?.aborted)throw e;
  if(best){opts.debug?.('animalAssemblyRevisionStopped',{reason:(e as Error).message});opts.onProgress?.('Further animal arrangements could not finish; keeping the reviewed model.');committed=true;return {...best,reviewed};}
  if(ctl.signal.aborted)throw Error('Complete animal review timed out.');throw e;
 }finally{for(const build of held)if(!committed||build!==best?.composition.build)release(build);clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}

}
