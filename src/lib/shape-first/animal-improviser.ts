/** Runtime construction synthesis. No complete authored head recipe is loaded. */
import {definition,frame} from '../connections';
import {parsePartId} from '../bricks';
import {animalSubjectKind} from '../assembly-composer/animal-subjects';
import {animalSilhouetteKey} from '../assembly-composer/animal-silhouette';
import {createFoxImprovContext,composeFoxImprovisation,type FoxImprovContext} from '../assembly-composer/animal-improv';
import type {AssemblyComposition} from '../assembly-composer/types';
import type {ShapeVerdict} from './run';
import {generate} from './pipeline';
import {inventoryKey} from './discovery';
import {foxLayoutProposal,foxLayoutDiagnostics,type FoxHeadLayout} from './fox-head-layout';
import {foxTechniqueChoices,foxTechniqueText,type FoxTechniqueChoice} from './fox-techniques';
import {expandFoxTechniqueLayout,type FoxTechniqueLayout,type FoxTechniqueUse} from './fox-technique-layout';

const ROLES=['neck','head','muzzle','nose','eye-left','eye-right','ear-left','ear-right'];
const STR={type:'STRING'},NUM={type:'NUMBER'},INT={type:'INTEGER'};
export function foxSynthesisSchema(context:FoxImprovContext,choices:readonly FoxTechniqueChoice[]=[]){
 const ids=Object.keys(context.available).filter(id=>{const k=parsePartId(id)!;return k.w<=5&&k.d<=5;});
 return {type:'OBJECT',required:['reasoning','layouts'],properties:{reasoning:STR,layouts:{type:'ARRAY',items:{
  type:'OBJECT',required:['id','description','parts'],properties:{id:STR,description:STR,
   parts:{type:'ARRAY',items:{type:'OBJECT',required:['partId','role','x','y','z','rot'],properties:{partId:{type:'STRING',enum:ids},role:{type:'STRING',enum:ROLES},x:NUM,y:NUM,z:NUM,rot:INT}}},
   ...(choices.length?{techniques:{type:'ARRAY',items:{type:'OBJECT',required:['choiceId','x','y','z','rot','roles'],properties:{choiceId:{type:'STRING',enum:choices.map(c=>c.id)},x:NUM,y:NUM,z:NUM,rot:INT,roles:{type:'ARRAY',items:{type:'STRING',enum:ROLES}}}}}}:{}),
  },
 }}}};
}

function geometryTable(context:FoxImprovContext){
 const byShape=new Map<string,{ids:Record<string,number>;sizeStuds:number[];ports:{id:string;kind:string;pointStuds:number[];normal:number[]}[]}>();
 for(const [id,count]of Object.entries(context.available)){
  const k=parsePartId(id)!;if(k.w>5||k.d>5)continue;
  const key=`${k.type}-${k.w}x${k.d}`,existing=byShape.get(key);
  if(existing){existing.ids[id]=count;continue;}
  const f=frame({partId:id,x:0,y:0,z:0,rot:0}),d=definition(k);
  byShape.set(key,{ids:{[id]:count},sizeStuds:f.bounds.max.map((v,a)=>(v-f.bounds.min[a])/20),
   ports:d.ports.map(p=>({id:p.id,kind:p.kind,pointStuds:p.point.map(n=>n/20),normal:p.normal}))});
 }
 return [...byShape].map(([shape,data])=>({shape,...data}));
}

export function foxSynthesisPrompt(context:FoxImprovContext,requestedName:string,choices:readonly FoxTechniqueChoice[]=[]):string {
 const fixed=context.chassis.build.steps.flatMap(s=>s.parts);
 return `Design ONE genuinely NEW Fox head/neck layout from the actual remaining pieces. Request ${JSON.stringify(requestedName)} means a general Fox, without unbuilt breed details. The body, four legs and white-tipped tail stay fixed. There is no authored head to select or copy.
Return exact part placements in WORLD STUDS: x=left/right, low y=forward, z=bottom height. One plate is .4 STUD, one brick 1.2 STUD. Use .4-stud z layers. x,y are the MINIMUM world footprint corner AFTER rotation. rot is 0/90/180/270 degrees. IMPORTANT: nominal 1xN pieces run along X at rot0, along Y at90. The actual sizeStuds table is authoritative; size [4,1,.4] occupies four studs across X and one along Y at0. Rot90 exchanges width and depth. Never confuse part-name dimensions with world axes.
Every layout contains 19–24 PURPOSEFUL head/neck pieces, making 40–45 total with the 21-piece body. No filler or extra scenery. All eight semantic roles must appear: neck, head, muzzle, nose, eye-left, eye-right, ear-left, ear-right. Carriers below eyes are head; dark eye parts have separate roles, as does the dark nose tip. Each role may contain several real pieces.
Design a centered skull with a narrow projecting pale muzzle and small dark nose at the forward tip; separated small dark eyes above/behind the nose and ahead of the ears; two matched tapered ear peaks above the skull; a short neck transitioning into shoulders. An ear is its WHOLE role assembly: its upper cross-section must shrink from its base, with the two tips mirrored and separated. Capping a tapered base with a broad curve can undo that taper; taller stacks are not automatically pointed ears. A long deer-like neck, eye band, rectangular oversized snout or flat ear posts fails. Use coherent warm coat/pale face colors and small dark details. Do not invent patches or consume bright colors just because they are present.
Solve geometry AND actual mounting together. At least one lowest neck part must mate to an exposed shoulder stud at z=3.6. Every other piece needs a real stud/grip path to that neck, without overlap or occupied sockets. Plates/tiles are .4 stud; 1x2/2x2 curves .8, 1x3 curves 1.2; bricks/slopes 1.2. Curves have stepped undersides: the back socket row is .4 stud above the lower rows. Tiles and curves have NO top studs. Slopes have studs only on their high row; inverse slopes have no grips under the projecting lip. Parts beside one another do not attach merely by touching. Real studded crosswise carriers can support cheeks, muzzle or eyes. Shared mounting plates consume real stock and must be placed too.
The solver derives all actual connector operations, rejects disconnected parts, overlaps, stock violations and broken Fox relationships, and returns concrete failures for ONE reconstruction. No target coordinates are trusted or silently snapped. Count each exact ID across the whole new group; the fixed body has already been deducted. Alternatives have independent ledgers. A new contour must differ in cheek/skull/muzzle/ear geometry, not just color or segmentation.
GOAL RELATIONSHIPS (studs): ${JSON.stringify(context.goals)}
EXPOSED SHOULDER STUDS: ${JSON.stringify(context.shoulderPorts.map(p=>({pointStuds:p.pointLDU.map(n=>n/20),normal:p.normal})))}
FIXED BODY OBSTACLES: ${JSON.stringify(fixed.map(p=>{const f=frame(p);return {id:p.partId,minStuds:f.bounds.min.map(n=>n/20),maxStuds:f.bounds.max.map(n=>n/20)};}))}
AVAILABLE SHAPES (rot0 WORLD size), exact IDs/counts and local connector points in STUDS: ${JSON.stringify(geometryTable(context))}
Before returning, count the exact copies of EVERY ID against AVAILABLE; the same tan plate may exist only once. Check each listed footprint and supporting carrier, then verify eyes' bottom Z is at least the nose's top Z (within .08 stud). A nose may be lowered or eyes supported on real carriers. Do not change the goal to accept a tall muzzle.
${choices.length?`SMALL CONSTRUCTION TECHNIQUES from the existing study library, compiled against AVAILABLE after the fixed body was paid for. These are alternatives, not reserved stock or complete heads. Use a technique when it improves the face/neck; otherwise use free parts. Invent the combined head around its real ports and keep all Fox relationships.\n${foxTechniqueText([...choices])}\nA technique placement is {choiceId,x,y,z,rot,roles:[one anatomy role for EACH listed local part in exactly that order]}. Its x/y are the minimum footprint corner AFTER the placement yaw; z is its bottom height, all WORLD STUDS. The compiler rigidly expands every piece and preserves its internal relative geometry. Never also list its pieces in free parts. Up to three placements; free parts PLUS all expanded technique pieces must total 19–24, not 19 free parts plus techniques. Each copy consumes its exact cost, shared with every other technique and free piece. Exposed ports still require real mounting to the rest of the head; keep its clearance envelope unoccupied.\n`:''}Return reasoning explaining the outline, mounting carriers and an exact usage tally, then layouts:[{id,description,parts:[{partId,role,x,y,z,rot}]${choices.length?',techniques:[{choiceId,x,y,z,rot,roles}]':''}}]. IDs use lowercase alphanumeric, hyphens or underscores, max64 characters. Descriptions max1000. Return ONE carefully solved layout, not several unfinished drafts.`;
}

export interface FoxSynthesisOptions {
 signal?:AbortSignal;views?:(build:AssemblyComposition['build'])=>string[];
 context?:FoxImprovContext;avoidKeys?:Iterable<string>;
 /** Disable only for controlled comparisons with the prior synthesis path. */
 techniques?:boolean;
 critique?:{composition:AssemblyComposition;verdict:ShapeVerdict};
 onProgress?:(text:string)=>void;debug?:(label:string,data:unknown)=>void;
}
export interface FoxSynthesisResult {
 context:FoxImprovContext|null;candidates:AssemblyComposition[];
 attempts:number;rejected:{id:string;reason:string}[];
 /** Only accepted constructions have receipts; target indices precede connector reordering. */
 techniqueUses?:{compositionId:string;uses:FoxTechniqueUse[]}[];
}
const inline=(url:string)=>{const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url);if(!m)throw Error('Synthesis requires actual rendered views.');return {inlineData:{mimeType:m[1],data:m[2]}};};
const stop=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Stopped','AbortError');};

/** One initial layout and up to five bounded repairs. The caller owns visual qualification
 * and can invoke this again with rendered criticism to reconstruct this group. */
export async function synthesizeFoxHeads(stock:Record<string,number>,requestedName:string,opts:FoxSynthesisOptions={}):Promise<FoxSynthesisResult>{
 stop(opts.signal);
 if(animalSubjectKind(requestedName)!=='fox')return {context:null,candidates:[],attempts:0,rejected:[]};
 const originalStockKey=inventoryKey('fox-synthesis',stock);
 const context=opts.context??createFoxImprovContext(stock);
 if(!context)return {context:null,candidates:[],attempts:0,rejected:[]};
 if(inventoryKey('fox-synthesis',context.stock)!==originalStockKey)throw Error('The head synthesis context belongs to a different inventory.');
 const controller=new AbortController(),cancel=()=>controller.abort();
 opts.signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(cancel,240000),signal=controller.signal;
 const active=()=>{stop(opts.signal);stop(signal);if(inventoryKey('fox-synthesis',stock)!==originalStockKey)throw Error('The inventory changed during head synthesis.');};
 try{
 const candidates:AssemblyComposition[]=[],rejected:FoxSynthesisResult['rejected']=[],seen=new Set(opts.avoidKeys??[]),acceptedIds=new Set<string>();
 const choices=opts.techniques===false?[]:foxTechniqueChoices(context.available);
 const techniqueUses:NonNullable<FoxSynthesisResult['techniqueUses']>=[];
 const content:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[
  {text:foxSynthesisPrompt(context,requestedName,choices)},
  ...(opts.views?[{text:'The fixed headless chassis, shown only for layout context:'},...opts.views(context.chassis.build).map(inline)]:[]),
 ]}];
 if(opts.critique){
  content[0].parts.push({text:`Reconstruct the head-neck group from this retained candidate's visual criticism: ${JSON.stringify(opts.critique.verdict)}. The original subject remains Fox. Correct the offending geometry within this group; body/tail criticism is recorded but those parts remain fixed in this pilot. Return a complete replacement layout, not additions. Their original head parts are available because AVAILABLE deducts only the fixed chassis.`},
   ...(opts.views?opts.views(opts.critique.composition.build).map(inline):[]));
 }
 let attempts=0;
 for(;attempts<6;attempts++){
  active();opts.onProgress?.(opts.critique?'Rebuilding the head and neck from the visual review…':attempts?'Reconstructing the head to satisfy real parts and connections…':'Inventing head and neck constructions from your remaining pieces…');
  const response=await generate<{reasoning:string;layouts:FoxTechniqueLayout[]}>(content,foxSynthesisSchema(context,choices),signal);active();
  const raw=response.json,proposals=raw&&Array.isArray(raw.layouts)&&raw.layouts.length<=3?raw.layouts:[];
  const failures:{id:string;reason:string;diagnostics?:unknown}[]=[];
  for(const [i,proposal]of proposals.entries()){
   let layout:FoxHeadLayout|undefined;
   try{
    const expanded=expandFoxTechniqueLayout(proposal,choices);layout=expanded.layout;
    const c=composeFoxImprovisation(context,foxLayoutProposal(context,layout)),key=animalSilhouetteKey(c.build);
    if(acceptedIds.has(c.plan.id))throw Error('A different accepted layout already uses this ID; use distinct IDs so construction receipts remain unambiguous.');
    if(seen.has(key))throw Error('This occupied contour was already proposed; change geometry rather than paint or part segmentation.');
    seen.add(key);acceptedIds.add(c.plan.id);candidates.push(c);techniqueUses.push({compositionId:c.plan.id,uses:expanded.uses});
   }catch(e){const failure={id:typeof proposal?.id==='string'?proposal.id.slice(0,80):`proposal-${i+1}`,reason:(e instanceof Error?e.message:String(e)).slice(0,2000),...(layout?{diagnostics:foxLayoutDiagnostics(context,layout)}:{})};failures.push(failure);rejected.push(failure);}
  }
  if(!proposals.length){const failure={id:'batch',reason:'Return a nonempty layouts array with complete exact part placements.'};failures.push(failure);rejected.push(failure);}
  opts.debug?.('foxImprovisationSynthesis',{attempt:attempts,critique:!!opts.critique,offeredTechniques:choices.map(c=>({id:c.id,studyId:c.studyId,kind:c.kind,cost:c.cost})),techniqueUses,reasoning:typeof raw?.reasoning==='string'?raw.reasoning.slice(0,2000):'',proposals,accepted:candidates.map(c=>({id:c.plan.id,parts:c.build.steps.flatMap(s=>s.parts).length,size:c.size})),rejected:failures});
  if(candidates.length)break;
  content.push(response.content,{role:'user',parts:[{text:`No construction was accepted. Keep the same chassis, stock and Fox goals. Correct the concrete compiler/geometry failures below and return one fresh complete layout. Check world footprint sizes, bottom height layers and actual mounting carriers. Do not reuse an occupied area or attach through a studless surface. ${JSON.stringify(failures)}`} ]});
 }
 active();return {context,candidates,attempts:Math.min(6,attempts+1),rejected,techniqueUses};
 }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',cancel);}
}
