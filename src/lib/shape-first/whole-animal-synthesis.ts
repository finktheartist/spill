import {parsePartId,type Placed} from '../bricks';
import {frame,validateConnections} from '../connections';
import {animalSubjectKind} from '../assembly-composer/animal-subjects';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {composeWholeAnimal,partialWholeAnimalAnatomyIssues,wholeAnimalDiagnostics,type WholeAnimalLayout,type WholeAnimalRole} from '../assembly-composer/animal-whole';
import type {AssemblyComposition} from '../assembly-composer/types';
import {expandFoxTechnique,foxTechniqueChoices} from './fox-techniques';
import {ANIMAL_BLUEPRINT_SCHEMA,uniqueAnimalReservations,animalBlueprintText,validateAnimalBlueprint,animalBlueprintIssues,animalBlueprintBodiesDiffer,type AnimalBlueprint} from './animal-blueprint';
import {wholeAnimalPrinciples,wholeAnimalStock,wholeAnimalDesignStock,wholeAnimalCatalog} from './whole-animal-prompt';
import {inventoryKey} from './discovery';
import {connectedAnimalLayout,unmatedAnimalPortBrief as unmatedPortBrief,type WholeAnimalConnectionIntent} from './whole-animal-connections';
import {advanceWholeAnimalStage,type WholeAnimalStageState,type WholeAnimalStage} from './whole-animal-stages';
import {generate} from './pipeline';
import {repairWholeAnimalSketch} from './whole-animal-sketch-repair';
import {validateWholeAnimalPlanRevision} from './whole-animal-plan-revision';
import {wholeAnimalPartialPlanIssues} from './whole-animal-plan-fit';
import {foxFeatureLandmarks} from './whole-animal-landmarks';
import {discoverWholeAnimalAttachments} from './whole-animal-attachment-discovery';
import {earSeedForBlueprint,earSeedUsage,type WholeAnimalMotifUse} from './whole-animal-seed';
import {wholeAnimalEarAffordances} from './whole-animal-affordances';
import type {ShapeVerdict} from './run';

const ROLES:WholeAnimalRole[]=['frame','chest','hips','torso','tail','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right','neck','head','muzzle','nose','eye-left','eye-right','ear-left','ear-right'];
const BODY=new Set<WholeAnimalRole>(['frame','chest','hips','torso','tail','leg-front-left','leg-front-right','leg-rear-left','leg-rear-right']);
type Placement={choiceId:string;x:number;y:number;z:number;rot:0|90|180|270;roles:WholeAnimalRole[]};
export interface WholeAnimalProposal extends WholeAnimalLayout {blueprintId:string;techniques?:Placement[];connections?:(WholeAnimalConnectionIntent&{mode?:'append'|'search'})}
export interface WholeTechniqueUse {choiceId:string;studyId:string;cost:Record<string,number>;targetParts:WholeAnimalLayout['parts']}
export interface WholeAnimalDesign {compositionId:string;blueprint:AnimalBlueprint;uses:WholeTechniqueUse[];inputMode?:'staged-connections'|'connections'|'coordinates';motifs?:WholeAnimalMotifUse[];planRevisions?:{reason:string;before:AnimalBlueprint;after:AnimalBlueprint}[];attachmentSearches?:{stage:WholeAnimalStage;attempts:number;changes:unknown[];acceptedAfterSketchRevision?:boolean}[]}
export interface WholeAnimalSynthesisResult {
 candidates:AssemblyComposition[];blueprints:AnimalBlueprint[];designs:WholeAnimalDesign[];
 planningAttempts:number;attempts:number;rejected:{phase:'plan'|'layout';id:string;reason:string;diagnostics?:unknown;rejectedSearch?:{accepted:false;intent:WholeAnimalConnectionIntent;issues:string[]}}[];
}
export interface WholeAnimalSynthesisOptions {
 signal?:AbortSignal;minParts?:number;maxCandidates?:number;
 /** false keeps complete-target QA comparisons; normal generation is staged. */
 staged?:boolean;
 /** Small actual-stock construction motifs; never a whole-head/body template. */
 motifs?:boolean;
 views?:(build:AssemblyComposition['build'])=>string[];
 critique?:{composition:AssemblyComposition;verdict:ShapeVerdict};
 avoidBodyKeys?:Iterable<string>;onProgress?:(text:string)=>void;debug?:(label:string,data:unknown)=>void;
}
const stop=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Stopped','AbortError');};
const inline=(url:string)=>{const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url);if(!m)throw Error('Whole-model review requires actual rendered views.');return {inlineData:{mimeType:m[1],data:m[2]}};};
const reason=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,2400);

/** Head paint/part splitting/neck tweaks cannot establish whole-body diversity.
 * A subset key is contour evidence only, never independent physics acceptance. */
export function wholeAnimalBodyKey(c:AssemblyComposition):string {
 const parts=c.build.steps.flatMap(s=>s.parts),indices=c.receipts.filter(r=>BODY.has(r.role as WholeAnimalRole)).flatMap(r=>r.indices);
 if(!indices.length)throw Error('No actual body anatomy was compiled.');
 return animalSilhouetteKey({...c.build,requiredContacts:undefined,steps:indices.map(i=>({caption:'Body contour only',parts:[parts[i]]}))});
}

/** Keep target numbering explicit and avoid burying actionable failures under
 * every successful port pair. This changes feedback only, never acceptance. */
function repairDiagnostic(stock:Record<string,number>,layout:WholeAnimalLayout,blueprint:AnimalBlueprint){
 const d=wholeAnimalDiagnostics(stock,layout) as {count?:number;issues?:string[];partIssues?:unknown[];shortages?:unknown[];roleBounds?:Record<string,{min:number[];max:number[]}>;contactEdges?:{a:number;b:number}[];moduleCount?:number;boundsStuds?:{min:number[]}};
 const raw:Placed[]=layout.parts.map(p=>({...p,z:p.z/.4}));
 const counts=raw.map(p=>{try{return frame(p).ports.length;}catch{return 0;}});let work=0;for(let i=0;i<counts.length;i++)for(let j=0;j<i;j++)work+=counts[i]*counts[j];
 const partIssues=work>8_000_000?[{problem:'Diagnostic connector-work limit reached; no partial inspection was accepted.',targetIndices:[] as number[]}]:validateConnections({name:'Rejected target diagnostic',description:'Unaccepted geometry only',engine:'connections-v2',steps:raw.map(p=>({caption:'Diagnostic',parts:[p]}))},stock,24).filter(i=>i.kind!=='floating').slice(0,20).map(i=>({problem:i.message,targetIndices:i.parts.map(p=>raw.indexOf(p))}));
 const affected=[...new Set(partIssues.flatMap(i=>i.targetIndices))].filter(i=>i>=0).slice(0,12),affectedTargetPoses=affected.map(i=>{
  try{const ports=frame(raw[i]).ports,shown=ports.length<=24?ports:[...ports.filter(p=>p.kind==='stud').slice(0,12),...ports.filter(p=>p.kind==='grip').slice(0,12)];return {targetIndex:i,...layout.parts[i],portsTotal:ports.length,worldPorts:shown.map(p=>({id:p.id,kind:p.kind,pointStuds:p.point.map(n=>n/20),normal:p.normal}))};}
  catch{return {targetIndex:i,...layout.parts[i],invalidFrame:true};}
 });
 const neighbors=Array.from({length:d.count??0},()=>[] as number[]);for(const e of d.contactEdges??[]){neighbors[e.a]?.push(e.b);neighbors[e.b]?.push(e.a);}
 const left=new Set(neighbors.map((_,i)=>i)),components:number[][]=[];for(const start of left){const order=[start];left.delete(start);for(let n=0;n<order.length;n++)for(const next of neighbors[order[n]])if(left.delete(next))order.push(next);components.push(order);}
 const origin=[0,1,2].map(a=>a===2?0:Math.min(...blueprint.regions.map(r=>r.min[a]))),envelopeIssues=blueprint.regions.flatMap(r=>{const raw=d.roleBounds?.[r.role],a=raw?{min:raw.min.map((n,i)=>n-(d.boundsStuds?.min[i]??0)),max:raw.max.map((n,i)=>n-(d.boundsStuds?.min[i]??0))}:undefined;return a&&[0,1,2].some(i=>a.min[i]<r.min[i]-origin[i]-r.tolerance-1e-5||a.max[i]>r.max[i]-origin[i]+r.tolerance+1e-5)?[{role:r.role,actual:a,planned:{min:r.min.map((n,i)=>n-origin[i]),max:r.max.map((n,i)=>n-origin[i]),tolerance:r.tolerance}}]:[];});
 let features:ReturnType<typeof foxFeatureLandmarks>|undefined;try{features=foxFeatureLandmarks(layout);}catch{/* No incomplete feature claim. */}
 return {targetPoses:layout.parts.length<=28?layout.parts.map((p,i)=>({targetIndex:i,...p})):undefined,features,envelopeIssues,blueprintOriginStuds:origin,numbering:'partIndices and connectedTargetComponents use ZERO-BASED indices in your returned expanded target parts; compiler error part numbers can be module-local or reordered ground-traversal indices; trust targetIndices here.',issues:d.issues,partIssues,affectedTargetPoses,shortages:d.shortages,roleBounds:d.roleBounds,connectedTargetComponents:components,moduleCount:d.moduleCount};
}


export function expandWholeAnimalProposal(input:WholeAnimalProposal,stock:Record<string,number>):{layout:WholeAnimalLayout;uses:WholeTechniqueUse[]} {
 if(!input||!Array.isArray(input.parts)||input.parts.length>80||input.techniques!==undefined&&(!Array.isArray(input.techniques)||input.techniques.length>6))throw Error('Provide at most80 free parts and six small technique placements.');
 if(input.connections){if(input.parts.length||(input.techniques?.length??0))throw Error('Use either connector intent OR free-coordinate parts/techniques, never both.');return {layout:connectedAnimalLayout(stock,input,input.connections),uses:[]};}
 const parts=input.parts.map(p=>({...p})),uses:WholeTechniqueUse[]=[],choices=foxTechniqueChoices(wholeAnimalStock(stock));
 for(const placement of input.techniques??[]){
  const choice=choices.find(c=>c.id===placement?.choiceId);
  if(!choice||!Array.isArray(placement.roles)||placement.roles.length!==choice.parts.length||placement.roles.some(r=>!ROLES.includes(r)))throw Error('Use an offered technique and one valid anatomy role per local part.');
  // The tiny topology is independent of its new anatomical assignment. Validate
  // geometry in the existing expander, then pass roles to the whole-body gate.
  const expanded=expandFoxTechnique(choice,{...placement,roles:choice.parts.map(()=> 'head')})
   .map((p,i)=>({...p,role:placement.roles[i],rot:p.rot as WholeAnimalLayout['parts'][number]['rot']}));
  if(parts.length+expanded.length>80)throw Error('Free parts and expanded techniques exceed80 total whole-model parts.');
  parts.push(...expanded);uses.push({choiceId:choice.id,studyId:choice.studyId,cost:{...choice.cost},targetParts:expanded.map(p=>({...p}))});
 }
 return {layout:{id:input.id,description:input.description,stance:input.stance,parts},uses};
}

function stageRoles(stage:WholeAnimalStage,seeded=false):WholeAnimalRole[]{
 return stage==='body'?['chest','hips','torso','frame']:stage==='legs'?['leg-front-left','leg-front-right','leg-rear-left','leg-rear-right']:stage==='tail'?['tail']:seeded?['neck','head','muzzle','nose','eye-left','eye-right']:['neck','head','muzzle','nose','eye-left','eye-right','ear-left','ear-right'];
}

/** A choice ledger, not a second bill: preserve exact future reservations while
 * exposing only parts the current anatomy can spend. Final charging still uses
 * the original stock once through the composer. */
function stageChoiceStock(stock:Record<string,number>,blueprint:AnimalBlueprint,stage:WholeAnimalStage,prefix?:WholeAnimalConnectionIntent){
 const out=wholeAnimalDesignStock(stock),present=new Set(prefix?.operations.map(o=>o.role)??[]),allowed=new Set(stageRoles(stage));
 for(const op of prefix?.operations??[])out[op.partId]=(out[op.partId]??0)-1;
 for(const r of uniqueAnimalReservations(blueprint))if(!present.has(r.role)&&!allowed.has(r.role))out[r.partId]=(out[r.partId]??0)-r.count;
 const palette=new Set([...blueprint.palette.coat,...blueprint.palette.accent,...blueprint.palette.dark]);
 return Object.fromEntries(Object.entries(out).filter(([id,n])=>n>0&&palette.has(parsePartId(id)!.color)));
}

export function wholeAnimalLayoutSchema(stock:Record<string,number>,blueprintId:string,staged=false,stage:WholeAnimalStage='features',seeded=false,allowRevision=true){
 const str={type:'STRING'},num={type:'NUMBER'},rot={type:'INTEGER'},role={type:'STRING',enum:staged?stageRoles(stage,seeded):ROLES};
 const choices=foxTechniqueChoices(wholeAnimalStock(stock));
 return {type:'OBJECT',required:['reasoning','layouts'],properties:{reasoning:str,...(staged&&allowRevision?{blueprintRevision:{type:'OBJECT',required:['reason','blueprint'],properties:{reason:str,blueprint:ANIMAL_BLUEPRINT_SCHEMA}}}:{}),layouts:{type:'ARRAY',items:{type:'OBJECT',required:['id','description','blueprintId','stance','parts',...(staged?['connections']:[])],properties:{
  id:str,description:str,blueprintId:{type:'STRING',enum:[blueprintId]},stance:{type:'STRING',enum:['standing','crouching']},
  parts:{type:'ARRAY',items:{type:'OBJECT',required:['partId','role','x','y','z','rot'],properties:{partId:{type:'STRING',enum:Object.keys(wholeAnimalDesignStock(stock))},role,x:num,y:num,z:num,rot}}},
  connections:{type:'OBJECT',required:['rootRotation','operations',...(staged?['mode']:[])],properties:{...(staged?{mode:{type:'STRING',enum:['search','append']}}:{}),rootRotation:{type:'INTEGER'},operations:{type:'ARRAY',items:{type:'OBJECT',required:['partId','role','parent','parentPort','childPort','twist'],properties:{partId:{type:'STRING',enum:Object.keys(wholeAnimalDesignStock(stock))},role,parent:{type:'INTEGER'},parentPort:str,childPort:str,twist:{type:'INTEGER'}}}}}},
  ...(!staged&&choices.length?{techniques:{type:'ARRAY',items:{type:'OBJECT',required:['choiceId','x','y','z','rot','roles'],properties:{choiceId:{type:'STRING',enum:choices.map(c=>c.id)},x:num,y:num,z:num,rot,roles:{type:'ARRAY',items:role}}}}}:{}),
 }}}}};
}

/** Planning precedes all allocation. Every completed target is independently
 * compiled and checked against the selected plan; no chassis is held fixed. */
export async function synthesizeWholeAnimals(stock:Record<string,number>,requestedName:string,opts:WholeAnimalSynthesisOptions={}):Promise<WholeAnimalSynthesisResult> {
 stop(opts.signal);
 const result:WholeAnimalSynthesisResult={candidates:[],blueprints:[],designs:[],planningAttempts:0,attempts:0,rejected:[]};
 if(animalSubjectKind(requestedName)!=='fox')return result;
 const minParts=opts.minParts??40,limit=opts.maxCandidates??2,staged=opts.staged!==false;
 if(!Number.isSafeInteger(minParts)||minParts<20||minParts>80||!Number.isSafeInteger(limit)||limit<1||limit>3)throw Error('Whole-model bounds require20–80 parts and1–3 candidates.');
 const available=wholeAnimalDesignStock(stock);if(Object.values(available).reduce((n,c)=>n+c,0)<minParts)return result;
 const originalKey=inventoryKey('whole-animal',stock),controller=new AbortController(),cancel=()=>controller.abort();
 opts.signal?.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,480000),signal=controller.signal;
 const active=()=>{stop(opts.signal);stop(signal);if(inventoryKey('whole-animal',stock)!==originalKey)throw Error('The inventory changed during whole-model design.');};
 const context=wholeAnimalPrinciples(stock,requestedName,minParts),seenBody=new Set(opts.avoidBodyKeys??[]),acceptedIds=new Set<string>();
 type Content={role:'user'|'model';parts:Record<string,unknown>[]};
 try{
 const earAffordances=wholeAnimalEarAffordances(stock).map(({spec,cost,sizeStuds,roleBounds,availability})=>({spec,cost,sizeStuds,roleBounds,availability}));
 const physicalScale=`PRECOMPILED THREE-PIECE EAR OPTIONS, BEFORE CHOOSING SCALE: ${JSON.stringify(earAffordances)}. Each is only two ear profiles plus one real carrier, NOT a whole head/body. Bounds include actual overhangs: a three-wide carrier may need FIVE total width. If using an option, whole size.max must fit its actual dimensions and the corresponding head/ear regions must fit its actual relative bounds. Its cost is not deducted until your exact feature reservations include it. Choose a compatible available carrier/feature scale before planning body envelopes; do not invent a smaller bounding box for these pieces.`;
 const critique:Record<string,unknown>[] = opts.critique?[{text:`The retained complete model was reviewed: ${JSON.stringify(opts.critique.verdict)}. Replan ANY weak section, including torso/hips/legs/tail. All original stock is available again; do not retain a fixed chassis. The actual previous model follows for criticism, not as a template.`},...(opts.views?opts.views(opts.critique.composition.build).map(inline):[])]:[];
  const planning:Content[]=[{role:'user',parts:[{text:`${context}\n${physicalScale}\n${animalBlueprintText(wholeAnimalDesignStock(stock))}\nSet parts.min to the requested minimum ${minParts} rather than inventing a higher minimum that requires filler; parts.max may allow genuine construction detail up to80. Return THREE materially different WHOLE-ANIMAL blueprints, before any part placement. Change major body proportions, waist/chest/hips, stance or tail contour together, not just head/neck/paint. Each proposal independently uses the original complete pile. Palette arrays each have at most THREE colors. Coat colors must all belong to ONE family: brown [reddish-brown,dark-brown,medium-nougat,nougat], orange [orange,dark-orange,bright-light-orange,medium-nougat], pale [white,light-gray,tan,dark-tan], or dark [black,dark-gray]. Do not mix brown and orange coats. Accent colors: white,tan,dark-tan,medium-nougat,black,dark-gray,dark-brown. Dark facial colors: black,dark-gray,dark-brown. For paired ears or eyes, reserve TWO separate role entries with count1 EACH (ear-left + ear-right or eye-left + eye-right); count2 in only the left role is invalid. Features and carriers must have truthful exact reservations. For improvisation prefer feature supportMode:"anatomy": the exact reserved pieces/carriers may connect through REAL stock-billed parts of the declared carrier roles (head carriers can use actual head bridges chosen during construction). Other anatomical roles cannot become hidden bridges. Use reserved-only when all path intermediates are themselves reserved, and explicitly mark any shared carrier with the SAME shared token in every referring feature (same ID/role, count1). That means ONE physical copy billed once and proven to participate in BOTH real feature graphs. Unmarked references remain distinct copies; feature pieces cannot share. Do not invent duplicate stock. Widely separated eyes need a support spanning BOTH eye positions or separate supports with an actually reserved common link; a lone two-stud bar cannot carry eyes separated by three stud centers. Use actual available carrier dimensions to set feature spacing before the body scale. Avoid over-reserving decorative faces that would leave no coherent stock for the body. All proportion fields are TWO-number permitted intervals with these limits: bodyLengthToWidth within[1.3,5], headWidthToBody within[.35,1.3], muzzleProjection within[.5,6], tailProjection within[1,12], earRise within[.2,4]. Choose ranges consistent with actual parts; do not use zero or lower out-of-bound endpoints. IMPORTANT size.min and size.max are positive overall DIMENSION ranges [width,length,height], never origin/bounding-corner coordinates. Regions and emptyRegions instead use actual min/max CORNERS. Bounds and voids are WORLD STUDS in the final model coordinates, with whole-model x/y minimum0 and groundz0. A planned envelope is a construction target, not proof. Do not provide a preauthored complete model. Keep reasoning at most1200characters and each description one short sentence. Return {reasoning,blueprints:[...]} with distinct lowercase IDs max64.`},...critique]}];
  for(let attempt=0;attempt<2&&result.blueprints.length<Math.min(2,limit);attempt++){
   active();opts.onProgress?.('Planning the defining features, whole-body proportions and available pieces…');result.planningAttempts++;opts.debug?.('wholeAnimalPlanningRequest',{attempt});
   const response=await generate<{reasoning:string;blueprints:unknown[]}>(planning,{type:'OBJECT',required:['reasoning','blueprints'],properties:{reasoning:{type:'STRING'},blueprints:{type:'ARRAY',items:ANIMAL_BLUEPRINT_SCHEMA}}},signal);active();
   const raw=response.json,proposals=Array.isArray(raw?.blueprints)&&raw.blueprints.length<=3?raw.blueprints:[],failures=[];
   for(const [i,input]of proposals.entries()){
    const checked=validateAnimalBlueprint(input,stock);
    if(checked.blueprint&&checked.blueprint.parts.max<minParts){checked.issues.push(`The planned budget cannot meet the required whole-model minimum of ${minParts}.`);checked.blueprint=null;}
    if(checked.blueprint&&!result.blueprints.some(p=>p.id===checked.blueprint!.id)&&result.blueprints.every(p=>animalBlueprintBodiesDiffer(p,checked.blueprint!)))result.blueprints.push(checked.blueprint);
    else {const failure={phase:'plan' as const,id:`plan-${i+1}`,reason:checked.issues.join('; ')||'Blueprint IDs and major body/stance/tail envelopes must be distinct; head-only changes do not count.'};result.rejected.push(failure);failures.push(failure);}
   }
   if(!proposals.length){const failure={phase:'plan' as const,id:'plans',reason:'Return one to three complete stock-bound blueprints.'};result.rejected.push(failure);failures.push(failure);}
   opts.debug?.('wholeAnimalBlueprints',structuredClone({attempt,proposals,accepted:result.blueprints,failures}));
   if(result.blueprints.length<Math.min(2,limit))planning.push(response.content,{role:'user',parts:[{text:`Keep accepted plans distinct and correct the exact planning failures. Return fresh complete blueprints with materially different body or tail envelopes. ${JSON.stringify(failures)}`}]});
  }
  const seeds=new Map(result.blueprints.map(b=>[b.id,staged&&opts.motifs!==false?earSeedForBlueprint(stock,b):undefined]));
  const stages=new Map<string,WholeAnimalStageState>(),stageFailures=new Map<string,number>(),stageRestarts=new Map<string,number>();
  const sketchRepairAttempts=new Map<string,number>();
  const revisions=new Map<string,NonNullable<WholeAnimalDesign['planRevisions']>>();
  const searches=new Map<string,NonNullable<WholeAnimalDesign['attachmentSearches']>>();
  const histories=new Map<string,Content[]>(),acceptedPlans=new Set<string>(),abandonedPlans=new Set<string>(),planAttempts=new Map<string,number>();
  for(let attempt=0;result.attempts<(staged?18:6)&&result.blueprints.length&&result.candidates.length<limit;attempt++){
   active();const pending=result.blueprints.filter(p=>!acceptedPlans.has(p.id)&&!abandonedPlans.has(p.id)).slice(0,staged?2:result.blueprints.length);if(!pending.length)break;
   const progress=(id:string)=>stages.get(id)?.stage==='tail'?3:stages.get(id)?.stage==='legs'?2:stages.get(id)?.stage==='body'?1:0;
   let blueprint=pending.sort((a,b)=>(staged?progress(b.id)-progress(a.id):0)||(planAttempts.get(a.id)??0)-(planAttempts.get(b.id)??0))[0];
   planAttempts.set(blueprint.id,(planAttempts.get(blueprint.id)??0)+1);
   let history=histories.get(blueprint.id);
   if(!history){
    const seed=seeds.get(blueprint.id);
    const featureRoles=new Set(['head','neck','muzzle','nose','eye-left','eye-right','ear-left','ear-right']),palette=new Set([...blueprint.palette.coat,...blueprint.palette.accent,...blueprint.palette.dark]);
    const choiceCatalog=wholeAnimalCatalog(wholeAnimalDesignStock(stock)).filter(entry=>{const size=entry.sizeStuds as number[];return blueprint.regions.some(r=>featureRoles.has(r.role)&&((size[0]<=r.max[0]-r.min[0]+2*r.tolerance&&size[1]<=r.max[1]-r.min[1]+2*r.tolerance)||(size[1]<=r.max[0]-r.min[0]+2*r.tolerance&&size[0]<=r.max[1]-r.min[1]+2*r.tolerance))&&size[2]<=r.max[2]-r.min[2]+2*r.tolerance);}).map(entry=>({...entry,ids:Object.fromEntries(Object.entries(entry.ids).filter(([id])=>palette.has(parsePartId(id)!.color)))})).filter(entry=>Object.keys(entry.ids).length);
    const spendable=stageChoiceStock(stock,blueprint,'features',seed?{rootRotation:seed.rootRotation,operations:seed.operations}:undefined),featureStock=Object.fromEntries(Object.entries(Object.assign({},...choiceCatalog.map(e=>e.ids)) as Record<string,number>).map(([id])=>[id,spendable[id]??0]).filter(([,n])=>Number(n)>0)) as Record<string,number>;
    const constructionContext=staged?wholeAnimalPrinciples(featureStock,requestedName,minParts).replace('from the ORIGINAL complete inventory','using a palette/size-compatible FEATURE CHOICE SUBSET of the original inventory')+'\nThis first-stage catalog is a filtered choice vocabulary, not a depleted pile or a fixed body. Exact ORIGINAL stock still funds the entire design. The body and tail stages receive their real remaining catalog.':context;
    const seedText=seed?`\nVERIFIED THREE-PIECE EAR MOTIF already compiled from this plan's exact reserved profiles/carrier (not a whole head). Fixed initial program: ${JSON.stringify({rootRotation:seed.rootRotation,operations:seed.operations})}. Actual initial target (allSTUDS): ${JSON.stringify(seed.parts)}. The engine prepends these THREE pieces automatically and bills them ONCE. Do not repeat them. The first NEW operation index is3, with an earlier parent among0,1,2; do NOT emit another root. Keep rootRotation:${seed.rootRotation}. Ear profiles already have a high air gap. Build the rest of the face and neck BELOW/FORWARD from genuine unoccupied carrier connectors; protect the ear tips. Actual UNMATED carrier interfaces (not insertion-access/strength proof): ${JSON.stringify(unmatedPortBrief({id:'seed',description:'Internal three-part motif',parts:seed.parts},'features'))}.`:'';
    history=[{role:'user',parts:[{text:`${constructionContext}\nSELECTED WHOLE-MODEL BLUEPRINT: ${JSON.stringify(blueprint)}\n${staged?`Build the FEATURES stage FIRST, not the entire animal in one response. Use REQUIRED connector intent: parts:[] and connections:{mode:'search',rootRotation:${seed?.rootRotation??0},operations:[{partId,role,parent,parentPort,childPort,twist}]}. Include ONLY these eight anatomy roles: neck,head,muzzle,nose,eye-left,eye-right,ear-left,ear-right. All eight must be present in one physically connected feature assembly with at most28 actual parts; a stage may have fewer than20. DO NOT add chest, hips, torso, frame, legs or tail yet. Match the selected feature reservations, stock and planned proportions. Build paired sloping ear peaks with a real air gap high between them; adjacent same-facing slopes form a roof, not two ears. Keep the projecting snout thin and the separated dark eyes visible above it. FRONT is world -y: the snout/nose must lie at SMALLER computed y than the eyes by at least .75stud, never behind the head. Center the COMPLETE muzzle bbox on the actual head center x; a four-wide skull generally needs a two-wide complete muzzle (one-wide rails can be paired), unless a real offset carrier exists. Leave a real unmated downward neck grip for the body. Judge attachment results, not merely rotation labels. Include every real carrier.
${seed?'The engine already supplies the root and ear prefix below. Every NEW operation must attach to an earlier global operation; do not emit any parent:-1 operation.':'First operation: parent:-1, parentPort:"", childPort:"", twist:0.'} Later parent is the ZERO-BASED index of an earlier operation. parentPort/childPort are exact LOCAL connector IDs from the catalog. Every operation is one real piece. The engine derives all positions from the joins; no free coordinates or technique-placement arrays. Twists0/90/180/-90/-180 (270 aliases are accepted); all resulting parts must be upright quarter turns. Local port axes rotate with their parent. Do not reuse an occupied stud/socket or overlap pieces. The complete prefix is normalized by ONE global translation; adding lower body pieces later can move its world origin, while all earlier RELATIVE poses stay fixed. ${seed?'The useful head/ear carrier is already provided; extend it, do not repeat it.':'Start from a useful head/skull carrier, not a body.'} Design order differs from final human assembly order.
Use mode:'search' to explicitly request bounded real-port placement: your part IDs and roles stay fixed, while parent/port/twist fields are preferences. The engine may change up to6 operation bindings among compatible earlier anatomical carriers, ranks actual poses against this blueprint, and checks the entire batch physically before returning a resolved exact program. This is a construction tool, not animal acceptance. Use mode:'append' only when you want your bindings executed exactly without repair. Prefer SEARCH for geometry uncertainty. If actual construction exposes an impossible sketch, optionally return top-level blueprintRevision:{reason,blueprint:COMPLETE_REVISED_BLUEPRINT} alongside layouts. Up to TWO revisions per plan share the SAME overall call/time budget. Keep exact id, subject, stance, palette sets, parts.min and every feature id/intent/pairing/piece/carrier reservation unchanged. You may explicitly revise spatial regions, region intents, feature supportMode when the real same-role support graph proves it, overall dimensions/proportion intervals, void locations, parts.max and descriptions within the original global Fox limits. Explain what the real parts taught you, not an arbitrary relaxation. Any checked prefix must still fit the revised sketch under one common translation. This revises DESIGN INTENT, never the actual parts, earlier connections or final anatomy/physics/visual gates. On every call return ONLY NEW operations, never repeat any existing prefix. Parent indices use the FINAL COMBINED global operation order. ${seed?'The three-piece ear prefix below is already present: output only new operations from index3 onward, with no new root.':'Initially the prefix is empty so the first new operation creates the root.'}${seedText} The next call will extend the ACTUAL checked feature prefix with fresh body/legs, and a later call adds the tail. No partial assembly is an accepted model. Final whole model still needs${minParts}–80 purposeful parts and ALL selected whole-plan envelopes/openings, stock, anatomy and independent-module checks. Return one layout with id,description,blueprintId:${JSON.stringify(blueprint.id)},stance,parts:[],connections. Keep reasoning at most600characters. Return layouts:[ONE].`:`Construct the ENTIRE animal to this plan, including all16 anatomical roles (frame optional). No body region is fixed. PREFER CONNECTOR INTENT to avoid guessing heights or positions: return parts:[] and connections:{rootRotation:0,operations:[{partId,role,parent,parentPort,childPort,twist}]}. First operation has parent:-1, empty ports, twist:0. Every later parent is the zero-based index of an earlier operation; parentPort and childPort are exact LOCAL port IDs from the catalog. The engine uses those real joins to compute all positions; there is no fixed skeleton. Quarter twists only (0,90,180,270 or negatives), all final parts upright. Start from any useful real piece; ONE whole-origin translation grounds the completed model. This is DESIGN order; human assembly order is derived separately. Count each operation as one actual part. Do not also list the same pieces in parts or techniques. Shared stock, no reused connectors, no collisions, independent anatomy modules, all selected envelopes/features/openings remain required. Alternatively, use complete free-coordinate parts (without connections). Place parts in the plan coordinate system; whole-model minimum x/y0, groundz0. Count every exact ID across the entire model including carriers. Return ONE complete layout: {id,description,blueprintId:${JSON.stringify(blueprint.id)},stance,parts:[{partId,role,x,y,z,rot}],techniques?:[{choiceId,x,y,z,rot,roles}]}. Optional technique roles correspond to its listed local parts; its x/y are GROUP footprint minimum after yaw, z bottom, all STUDS. List its expanded pieces only through techniques, not also free parts. Free plus expanded pieces total${minParts}–80. Every piece must be connected in the final real graph, without overlap or unsupported/fake offsets. The whole compiler derives connections without moving targets. Both model and each actual anatomy component must compile. Return concise reasoning (at most1200characters) with exact usage tally and why the whole contour realizes the plan, then layouts:[ONE]. In connector mode the required parts array is EMPTY and all20–80 pieces are in connections.operations.`}`},...critique]}];histories.set(blueprint.id,history);}
   const thinkingLevel=staged&&(stageFailures.get(blueprint.id)??0)===0?'low':'medium';
   opts.onProgress?.(staged?(stages.get(blueprint.id)?.stage==='body'?'Constructing the chest, waist and hips around the checked features…':stages.get(blueprint.id)?.stage==='legs'?'Placing four separated grounded legs…':stages.get(blueprint.id)?.stage==='tail'?'Shaping the tail and checking the complete animal…':'Constructing the face, ears and their actual supports…'):(attempt?'Refining the complete animal to fit its plan and real connections…':'Constructing the chest, hips, legs, head and tail together…'));result.attempts++;opts.debug?.('wholeAnimalLayoutRequest',{attempt,blueprintId:blueprint.id,stage:staged?(stages.get(blueprint.id)?.stage??'features'):'complete',thinkingLevel});
   const currentStage=stages.get(blueprint.id)?.stage??'features',currentSeed=seeds.get(blueprint.id),choiceStock=staged?stageChoiceStock(stock,blueprint,currentStage,stages.get(blueprint.id)?.prefix??(currentSeed?{rootRotation:currentSeed.rootRotation,operations:currentSeed.operations}:undefined)):stock;
   const response=await generate<{reasoning:string;layouts:WholeAnimalProposal[];blueprintRevision?:unknown}>(history,wholeAnimalLayoutSchema(choiceStock,blueprint.id,staged,currentStage,!!currentSeed,(revisions.get(blueprint.id)?.length??0)<2),signal,thinkingLevel);active();
   let proposals=Array.isArray(response.json?.layouts)&&response.json.layouts.length<=3?response.json.layouts:[];
   const failures:WholeAnimalSynthesisResult['rejected']=[];let progressed=false;let rejectedTarget:WholeAnimalLayout|undefined;
   if(staged&&response.json?.blueprintRevision!==undefined){
    const prior=revisions.get(blueprint.id)??[],checked=validateWholeAnimalPlanRevision(blueprint,response.json.blueprintRevision,stock,minParts);
    if(prior.length>=2)checked.issues.push('At most TWO explicit sketch revisions per plan; continue construction against the latest retained plan.');
    if(checked.blueprint&&result.blueprints.some(p=>p.id!==blueprint.id&&!animalBlueprintBodiesDiffer(p,checked.blueprint!)))checked.issues.push('Revised whole body/stance/tail must remain materially different from the other selected plans.');
    const seed=seeds.get(blueprint.id),prefix=stages.get(blueprint.id)?.prefix,actual=prefix?connectedAnimalLayout(stock,{id:'retained-prefix',description:'Checked prepaid geometry',stance:blueprint.stance},prefix):seed?{id:'ear-motif',description:'Three-part vocabulary only',stance:blueprint.stance,parts:seed.parts}:undefined;
    if(checked.blueprint&&actual)checked.issues.push(...wholeAnimalPartialPlanIssues(actual,checked.blueprint));
    if(checked.blueprint&&!checked.issues.length){
     const before=structuredClone(blueprint),after=checked.blueprint,entry={reason:checked.reason!,before,after:structuredClone(after)};
     prior.push(entry);revisions.set(blueprint.id,prior);result.blueprints[result.blueprints.findIndex(p=>p.id===blueprint.id)]=after;blueprint=after;
     for(const part of history[0].parts)if(typeof part.text==='string')part.text=part.text.replace(`SELECTED WHOLE-MODEL BLUEPRINT: ${JSON.stringify(before)}`,`SELECTED WHOLE-MODEL BLUEPRINT: ${JSON.stringify(after)}`);
     opts.onProgress?.('Adapting the whole-model sketch to the actual supports…');opts.debug?.('wholeAnimalBlueprintRevision',structuredClone(entry));
    }else{const failure={phase:'plan' as const,id:blueprint.id,reason:`Explicit sketch revision rejected: ${checked.issues.join('; ')}`};result.rejected.push(failure);failures.push(failure);proposals=[];}
   }
   for(const [i,input]of proposals.entries()){
    let layout:WholeAnimalLayout|undefined,rejectedBindings:WholeAnimalConnectionIntent|undefined,rejectedSearchIssues:string[]|undefined,searchReceipt:NonNullable<WholeAnimalDesign['attachmentSearches']>[number]|undefined;
    const commitSearch=()=>{if(searchReceipt){const log=searches.get(blueprint.id)??[];log.push(searchReceipt);searches.set(blueprint.id,log);}};
    try{
     if(input?.blueprintId!==blueprint.id)throw Error('The layout must use the selected whole-model blueprint.');
     if(input.stance!==blueprint.stance)throw Error('The constructed stance must match the selected whole-model blueprint.');
     if(staged&&!input.connections)throw Error('Staged construction requires connector intent with parts:[]; coordinate-only complete responses belong to the explicit nonstaged comparison mode.');
     let proposal=input;
     if(staged){
      const stage=stages.get(blueprint.id)?.stage??'features',allowed=stageRoles(stage,!!seeds.get(blueprint.id));
      if(!Array.isArray(input.connections?.operations)||input.connections.operations.length<1||input.connections.operations.length>80)throw Error('Append1–80 bounded connector operations for this stage.');
      if(input.connections?.operations?.some(op=>!allowed.includes(op.role)))throw Error(`This stage may append ONLY ${allowed.join(', ')}. Do not repeat/edit the checked prefix or jump to later anatomy.`);
      if(!input.connections||!['append','search'].includes(input.connections.mode??''))throw Error('Choose explicit search or exact append mode. Return ONLY NEW operations; the engine keeps the checked prefix.');
      const seed=seeds.get(blueprint.id),prefix=stages.get(blueprint.id)?.prefix??(seed?{rootRotation:seed.rootRotation,operations:seed.operations}:{rootRotation:input.connections.rootRotation,operations:[]});
      if(input.connections.rootRotation!==prefix.rootRotation)throw Error('Keep the established rootRotation.');if(prefix.operations.length+input.connections.operations.length>(stage==='features'?28:80))throw Error('The combined prefix exceeds this stage’s bounded part capacity.');
      const combined=[...prefix.operations,...input.connections.operations],present=new Set(combined.map(o=>o.role)),missing=stageRoles(stage).filter(r=>r!=='frame'&&!present.has(r));
      if(missing.length)throw Error(`The selected pieces do not cover this complete ${stage} stage: missing ${missing.join(', ')}. Attachment search cannot add pieces or roles.`);
      const selected=new Map<string,number>();for(const op of input.connections.operations)selected.set(op.partId,(selected.get(op.partId)??0)+1);
      for(const [id,n]of selected)if(!Object.hasOwn(choiceStock,id)||n>choiceStock[id])throw Error(`Current-stage allocation exceeds unreserved stock for ${id}: requested${n}, spendable${choiceStock[id]??0}. Keep later feature/carrier reservations protected.`);
      const actual=new Map<string,number>(),promised=new Map<string,number>();for(const op of combined){const key=`${op.role}/${op.partId}`;actual.set(key,(actual.get(key)??0)+1);}
      for(const r of uniqueAnimalReservations(blueprint))if(present.has(r.role)){const key=`${r.role}/${r.partId}`;promised.set(key,(promised.get(key)??0)+r.count);}
      for(const [key,n]of promised)if((actual.get(key)??0)<n)throw Error(`Selected ${stage} pieces omit the exact feature/carrier reservation ${key}: needs${n}, selected${actual.get(key)??0}. Search keeps part IDs fixed; include all real promised supports.`);
      if(input.connections.mode==='search'){
       const {search:searched,canonical:held}=await discoverWholeAnimalAttachments({stock,prefix,operations:input.connections.operations,blueprint,stage,state:stages.get(blueprint.id),minParts,meta:{id:input.id,description:input.description,stance:input.stance}},signal);active();
       opts.debug?.('wholeAnimalAttachmentSearch',structuredClone({blueprintId:blueprint.id,stage,attempts:searched.attempts,exhausted:searched.exhausted,reason:searched.reason,changes:searched.changes,resolved:searched.intent,rejectedComplete:searched.rejectedComplete}));
       active();let resolved=searched.intent,changes:unknown[]=searched.changes??[],acceptedAfterSketchRevision=false;
       if(!resolved&&held&&result.attempts<18&&(revisions.get(blueprint.id)?.length??0)<2&&(sketchRepairAttempts.get(blueprint.id)??0)<1){
        sketchRepairAttempts.set(blueprint.id,1);result.attempts++;
        opts.onProgress?.('Reconciling the working sketch with the complete checked construction…');opts.debug?.('wholeAnimalSketchRepairRequest',structuredClone({blueprintId:blueprint.id,issues:held.issues,layout:held.layout,intent:held.intent,composition:held.composition}));active();
        const repaired=await repairWholeAnimalSketch(stock,blueprint,held.composition,held.issues,minParts,{signal,views:opts.views});active();
        if(repaired.blueprint&&result.blueprints.some(p=>p.id!==blueprint.id&&!animalBlueprintBodiesDiffer(p,repaired.blueprint!))){repaired.issues.push('Revised whole body/stance/tail duplicates another selected plan.');repaired.blueprint=null;}
        if(repaired.blueprint){
         const before=structuredClone(blueprint),entry={reason:repaired.reason!,before,after:structuredClone(repaired.blueprint)},prior=revisions.get(blueprint.id)??[];prior.push(entry);revisions.set(blueprint.id,prior);blueprint=repaired.blueprint;result.blueprints[result.blueprints.findIndex(p=>p.id===blueprint.id)]=blueprint;
         for(const part of history[0].parts)if(typeof part.text==='string')part.text=part.text.replace(`SELECTED WHOLE-MODEL BLUEPRINT: ${JSON.stringify(before)}`,`SELECTED WHOLE-MODEL BLUEPRINT: ${JSON.stringify(blueprint)}`);
         resolved=held.intent;acceptedAfterSketchRevision=true;
         const turn=(n:number)=>((n%360)+360)%360;
         changes=resolved.operations.flatMap((op,index)=>{const old=combined[index];return index>=prefix.operations.length&&(op.parent!==old.parent||op.parentPort!==old.parentPort||op.childPort!==old.childPort||turn(op.twist)!==turn(old.twist))?[{index,requested:{...old},resolved:{...op}}]:[];});
         opts.debug?.('wholeAnimalSketchReconciled',structuredClone({...entry,layout:held.layout,resolved,changes}));
        }else opts.debug?.('wholeAnimalSketchRepairRejected',structuredClone({blueprintId:blueprint.id,reason:repaired.reason,issues:repaired.issues}));
       }
       if(!resolved){
        if(held){layout=held.layout;rejectedBindings=held.intent;rejectedSearchIssues=held.issues;}
        else if(searched.rejectedComplete){layout={...searched.rejectedComplete.layout,id:input.id,description:input.description,stance:input.stance};rejectedBindings=searched.rejectedComplete.intent;rejectedSearchIssues=searched.rejectedComplete.issues;}
        throw Error(`Attachment search STOP reason (${searched.attempts} attempts; may describe the last checked hypothesis, not the displayed best rejection): ${searched.reason??'bounded search exhausted'}`);
       }
       searchReceipt={stage,attempts:searched.attempts,changes,...(acceptedAfterSketchRevision?{acceptedAfterSketchRevision:true}:{})};
       proposal={...input,description:acceptedAfterSketchRevision?blueprint.description:input.description,connections:resolved};
      }else proposal={...input,connections:{rootRotation:prefix.rootRotation,operations:[...prefix.operations,...input.connections.operations]}};
     }
     const expanded=expandWholeAnimalProposal(proposal,stock);layout=expanded.layout;
     const palette=new Set([...blueprint.palette.coat,...blueprint.palette.accent,...blueprint.palette.dark]);if(layout.parts.some(p=>!palette.has(parsePartId(p.partId)!.color)))throw Error('Actual parts use colors outside the selected coherent coat/accent/dark palette.');
     if(staged){
      const fit=wholeAnimalPartialPlanIssues(layout,blueprint);if(fit.length)throw Error(fit.join('; '));if((stages.get(blueprint.id)?.stage??'features')==='legs'){const morphology=partialWholeAnimalAnatomyIssues(layout);if(morphology.length)throw Error(morphology.join('; '));}
      const progress=advanceWholeAnimalStage(layout,proposal.connections,stock,stages.get(blueprint.id));
      if((stages.get(blueprint.id)?.stage??'features')==='features'){const face=foxFeatureLandmarks(layout);if(face.issues.length)throw Error(`Fix the actual face BEFORE freezing it: ${face.issues.join('; ')}`);const neck=unmatedPortBrief(layout,'body');if(!neck.some(p=>p.unmatedPorts.some(port=>port.kind==='grip'&&port.normal[2]<-.9)))throw Error('Leave a REAL unmated downward neck socket for the later body; do not consume every neck connector in the face assembly.');}
      if(!progress.complete){
       const present=new Set(layout.parts.map(p=>p.role)),actual=new Map<string,number>(),future:Record<string,number>={},promised=new Map<string,number>();
       for(const p of layout.parts){const key=`${p.role}/${p.partId}`;actual.set(key,(actual.get(key)??0)+1);}
       for(const r of uniqueAnimalReservations(blueprint))if(present.has(r.role)){const key=`${r.role}/${r.partId}`;promised.set(key,(promised.get(key)??0)+r.count);}else future[r.partId]=(future[r.partId]??0)+r.count;
       for(const [key,n]of promised)if((actual.get(key)??0)<n)throw Error(`The checked stage must actually contain its selected feature/carrier reservation ${key}: needs${n}, has${actual.get(key)??0}.`);
       for(const [id,n]of Object.entries(future))if((progress.remaining[id]??0)<n)throw Error(`This stage consumes stock reserved for later anatomy: ${id} still needs${n}, remaining${progress.remaining[id]??0}.`);
       const images=opts.views?opts.views({name:'Unchecked partial Fox',description:'Internal construction stage, not a finished model or visual qualification.',engine:'connections-v2',steps:layout.parts.map(p=>({caption:'Internal partial construction',parts:[{...p,z:p.z/.4}]}))}).map(inline):[];
       const stageHint=progress.state!.stage==='body'?'Construct only chest, hips, torso and optional frame now. Keep actual chest/waist/hip centers beneath the actual head/neck centerline. Develop shoulder mass and a continuous back profile rather than a one-plate chest, dipped waist and tall box rump. Use stepped or available shaped parts where their contour remains exposed. Leave four UNMATED downward grips for the next stage, separated left/right by at least2stud centers and front/rear by at least3stud centers for longer feet. Different front/rear attachment heights are allowed when actual leg lengths bring all four bottoms to one ground plane. A narrow waist may need wider crosswise shoulder/hip carriers. Do not spend every underside port or hide the future belly gap.':progress.state!.stage==='legs'?'Add four coherent slender leg shafts and short feet to genuine downward body sockets. Match each leg length to its ACTUAL socket height so all four bottoms end on one ground plane; front/rear lengths may differ. Use actual unmated port positions for symmetric left/right and separated front/rear feet. Prefer available round1x1 shafts where they improve the outline; do not replace them with tall 1x2 box columns merely because those boxes count as thin. Long feet face forward(-y). Do not attach a leg to an eye/ear.':'Attach the substantial tail to actual hips/torso at the rear(+y); keep it connected and taper toward its rear tip. Ordinary slopes descend toward local front atrot0, so a tip descending towardworld+y generally usesrot180; use actual local ports. No blank curve-top stud claims.';
       history.splice(1,history.length-1,response.content,{role:'user',parts:[{text:`A partial stage passed its exact stock/connectivity/collision checks ONLY. It is not a finished/qualified Fox. ${progress.feedback} ${stageHint} Return ONLY NEW appended operations in connections.operations with mode:search (or exact append). The engine prepends the checked prefix automatically; DO NOT repeat it or emit another root. Parent indices reference the FINAL combined array; the next new operation index is ${progress.state!.prefix.operations.length}. The earlier prefix remains unchanged. Checked prefix (read-only): ${JSON.stringify(progress.state!.prefix)}. Keep id/blueprintId/stance valid and parts:[]; no coordinate parts. Next stage: ${progress.state!.stage}. New operations may refer to any earlier global parent index but may not edit prior operations. The final20–80piece whole animal must still match the original selected blueprint. Actual UNMATED interfaces for the next anatomy (parent indices are global; not insertion-access/strength proof): ${JSON.stringify(unmatedPortBrief(layout,progress.state!.stage))}. Actual current partial target (allSTUDS, normalized partial origin): ${JSON.stringify(layout.parts)}. Actual remaining ledger after charging this prefix ONCE: ${JSON.stringify(wholeAnimalDesignStock(progress.remaining))}. CURRENT-STAGE CHOICE LEDGER after protecting later feature/carrier reservations (not a second charge): ${JSON.stringify(stageChoiceStock(stock,blueprint,progress.state!.stage,progress.state!.prefix))}. Parts you may allocate NOW, with actual rot0sizes/connectors: ${JSON.stringify(wholeAnimalCatalog(stageChoiceStock(stock,blueprint,progress.state!.stage,progress.state!.prefix)))}. Images show this checked partial only, not a finished model.`},...images]});
       commitSearch();stages.set(blueprint.id,progress.state!);stageFailures.set(blueprint.id,0);progressed=true;
       opts.debug?.('wholeAnimalStageProgress',structuredClone({attempt,blueprintId:blueprint.id,stage:progress.state!.stage,layout,remaining:progress.remaining}));
       break;
      }
     }
     const c=composeWholeAnimal(stock,layout),issues=animalBlueprintIssues(c,blueprint,stock),count=c.build.steps.flatMap(s=>s.parts).length;
     if(count<minParts||count>80)issues.push(`Use${minParts}–80 purposeful whole-model parts.`);
     if(issues.length)throw Error(issues.join('; '));
     const key=wholeAnimalBodyKey(c);
     if(seenBody.has(key))throw Error('This body/legs/tail contour was already offered. Rebuild major body geometry; another head, paint or part segmentation does not establish whole-model diversity.');
     if(acceptedIds.has(c.plan.id))throw Error('Accepted whole-model IDs must be distinct.');
     commitSearch();seenBody.add(key);acceptedIds.add(c.plan.id);acceptedPlans.add(blueprint.id);result.candidates.push(c);result.designs.push({compositionId:c.plan.id,blueprint,uses:expanded.uses,inputMode:stages.has(blueprint.id)?'staged-connections':input.connections?'connections':'coordinates',motifs:seeds.get(blueprint.id)?[earSeedUsage(c,seeds.get(blueprint.id)!)]:[],attachmentSearches:searches.get(blueprint.id),planRevisions:revisions.get(blueprint.id)});opts.debug?.('wholeAnimalAccepted',structuredClone({composition:c,blueprint,uses:expanded.uses}));
     break;
    }catch(e){if(layout)rejectedTarget=layout;const failure={phase:'layout' as const,id:typeof input?.id==='string'?input.id.slice(0,80):`layout-${i+1}`,reason:reason(e),...(layout?{diagnostics:repairDiagnostic(stock,layout,blueprint)}:{}),...(rejectedBindings?{rejectedSearch:{accepted:false as const,intent:rejectedBindings,issues:rejectedSearchIssues??[]}}:{})};result.rejected.push(failure);failures.push(failure);}
   }
   if(!proposals.length&&!failures.length){const failure={phase:'layout' as const,id:blueprint.id,reason:'Return one complete layout for the selected blueprint.'};result.rejected.push(failure);failures.push(failure);}
   opts.debug?.('wholeAnimalSynthesis',structuredClone({attempt,blueprint,reasoning:response.json?.reasoning,proposals,accepted:result.candidates.map(c=>({id:c.plan.id,size:c.size,parts:c.build.steps.flatMap(s=>s.parts).length})),designs:result.designs,failures}));
   if(!acceptedPlans.has(blueprint.id)&&!progressed){
    let diagnosticImages:Record<string,unknown>[]=[];if(rejectedTarget&&opts.views)try{diagnosticImages=opts.views({name:'REJECTED partial target',description:'Diagnostic only: NOT accepted construction or quality.',engine:'connections-v2',steps:rejectedTarget.parts.map(p=>({caption:'Unaccepted target',parts:[{...p,z:p.z/.4}]}))}).map(inline);}catch{/* Diagnostic rendering cannot authorize a candidate. */}

    const failuresSoFar=(stageFailures.get(blueprint.id)??0)+1;stageFailures.set(blueprint.id,failuresSoFar);
    if(staged&&stages.has(blueprint.id)&&failuresSoFar>=2&&(stageRestarts.get(blueprint.id)??0)<1){
     stages.delete(blueprint.id);searches.delete(blueprint.id);stageFailures.set(blueprint.id,0);stageRestarts.set(blueprint.id,1);
     history.splice(1,history.length-1,response.content,{role:'user',parts:[{text:`BOUNDED RESTART: discard the ENTIRE earlier partial assembly and every frozen prefix for this blueprint. None was accepted as a complete model. Refund ALL its pieces: the ORIGINAL complete stock from the first prompt is available again. The selected whole blueprint still applies. Begin a NEW FEATURES stage with only neck/head/muzzle/nose/eye-left/eye-right/ear-left/ear-right, at most28 operations, parts:[], connections required. Prior agent-created operations are no longer locked (the same verified three-piece ear motif, when offered, is still engine-prepended): return ONLY NEW operations with mode:search (or exact append); rebuild any responsible feature/carrier, scale or attachment so a future body/legs/tail can meet the selected plan. No partial model is offered. One restart maximum for this blueprint; all calls still share the18-call/8-minute run cap. Actual failures: ${JSON.stringify(failures)}. Any following images are the REJECTED target only, not an accepted model.`},...diagnosticImages]});
     opts.debug?.('wholeAnimalStageRestart',structuredClone({attempt,blueprintId:blueprint.id,failures}));
    }else if(staged&&((stages.has(blueprint.id)&&failuresSoFar>=2&&(stageRestarts.get(blueprint.id)??0)>=1)||(!stages.has(blueprint.id)&&failuresSoFar>=3))){abandonedPlans.add(blueprint.id);opts.debug?.('wholeAnimalPlanExhausted',{blueprintId:blueprint.id,reason:'No complete construction passed after bounded stage repairs.'});}
    else history.push(response.content,{role:'user',parts:[{text:`No new acceptable whole construction or stage was selected. ${stages.has(blueprint.id)?'Preserve the earlier checked connector prefix and correct the NEW appended operations. Two failed extensions can trigger one explicit whole-prefix restart.':'Rebuild any responsible anatomy with the SAME original stock and blueprint constraints.'} Correct these actual failures; exact append was not repaired; explicit search changes are reported. Prioritize exact target-index overlap/stock problems, then connect each real graph component, then match the selected envelopes. Plain brick/plate long dimensions and rotation must match the catalog. Avoid adding intersecting filler merely to reach the count. ${JSON.stringify(failures)}. Any following images show the REJECTED diagnostic target only. When rejectedSearch is present, its OWN issues and resolved intent describe that displayed hypothesis; the separate overall search STOP reason may describe a different last-checked branch. Use the zero-based targetIndices and actual worldPorts to correct attachment choices; do not guess locations from ground-traversal part numbers.`},...diagnosticImages]});
   }
   // The latest checked prefix is the construction state. Keep that evidence
   // and the newest repair rather than accumulating superseded failed programs.
   if(staged&&history.length>5)history.splice(3,history.length-5);
  }
  active();return result;
 }catch(error){
  // A run's own time budget can stop further exploration after a complete
  // checked model exists. User cancellation and a changed pile invalidate it.
  stop(opts.signal);if(inventoryKey('whole-animal',stock)!==originalKey)throw Error('The inventory changed during whole-model design.');
  if(result.candidates.length){
   const failure={phase:'layout' as const,id:'request-stopped',reason:reason(error)};result.rejected.push(failure);opts.debug?.('wholeAnimalPartialResult',structuredClone(failure));return result;
  }
  throw error;
 }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',cancel);}
}
