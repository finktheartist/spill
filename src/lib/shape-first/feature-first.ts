/** Small inventories: reserve an executable feature before designing the rest of the object. */
import { parsePartId, type Build } from '../bricks';
import { definition, frame } from '../connections';
import { compileFeatureBody, featurePlanLimits, reserveFeature, seedGeometry, simplifyFeatureBody, type FeatureBody, type FeatureConstruction, type FeaturePlan, type ReservedFeature } from '../feature-first';
import { FEATURE_STUDIES, featureChoices, featureChoiceText, type FeatureChoice } from '../moc-features';
import { generate, rolePalette, type RankedIdea } from './pipeline';
import { appearanceIsBetter } from './appearance';
import type { ShapeVerdict } from './run';
import { constructionKnowledgeText } from '../build-atlas/guidance';

const num={type:'NUMBER'},str={type:'STRING'};
const PLAN_SCHEMA={type:'OBJECT',required:['choiceId','rotation','pose','traits','bodySize','colors'],properties:{choiceId:str,rotation:{type:'INTEGER'},pose:str,traits:{type:'ARRAY',items:str},bodySize:{type:'ARRAY',items:num},colors:{type:'ARRAY',items:str}}};
const planSchema=(choices:FeatureChoice[])=>({...PLAN_SCHEMA,properties:{...PLAN_SCHEMA.properties,choiceId:{type:'STRING',enum:choices.map(c=>c.id)}}});
export const BODY_SCHEMA={type:'OBJECT',required:['reasoning','parts'],properties:{reasoning:str,parts:{type:'ARRAY',items:{type:'OBJECT',required:['partId','x','y','z','rot','role'],properties:{partId:str,x:num,y:num,z:num,rot:{type:'INTEGER'},role:str}}}}};
export interface FeatureFirstOptions {
  signal?:AbortSignal; minParts:number; views:(b:Build)=>string[];
  judge:(b:Build,idea:RankedIdea,signal?:AbortSignal)=>Promise<ShapeVerdict>;
  onProgress?:(text:string)=>void; debug?:(label:string,data:unknown)=>void;
}
export interface FeatureFirstResult extends FeatureConstruction { plan:FeaturePlan; verdict:ShapeVerdict; revised:boolean }
const inline=(url:string)=>{const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url);if(!m)throw Error('Expected a rendered image.');return {inlineData:{mimeType:m[1],data:m[2]}};};

/** The same executable geometry can serve unrelated subjects; anatomy names are historical examples. */
const APPLICATIONS:Record<string,{name:string;terms:string[]}>={
  'open-working-bay':{name:'Supported open working bay',terms:['bay','dispensing','espresso','sewing','press','overhang','work']},
  'opposed-roof':{name:'Complete pitched roof',terms:['roof','pitched','gable','cottage','pavilion']},
  'mounted-wheels':{name:'Four supported side-facing wheels',terms:['wheel','wheels','wheelbase','wheeled']},
  'pointed-muzzle':{name:'Sloped leading edge',terms:['slope','sloped','wedge','roof','ramp','bow']},
  'rounded-muzzle':{name:'Rounded shell or housing',terms:['curve','curved','rounded','housing','hood','canopy','shell']},
  'short-beak':{name:'Small tapered tip',terms:['cheese','tip','point','chamfer']},
  'long-beak':{name:'Narrow projecting arm',terms:['spout','boom','arm','projection','lever']},
  'round-neck':{name:'Column and upper carrier',terms:['column','stem','post','pedestal','shaft','roundbrick']},
  'stepped-neck':{name:'Stepped projecting support',terms:['cantilever','offset','overhang']},
  'chin-transition':{name:'Tapered underside',terms:['undercut','invslope','underside','bow']},
  'side-face':{name:'Thin side panel',terms:['panel','fascia','screen','sign']},
  'offset-neck':{name:'Centered column',terms:['column','stem','centered','jumper']},
  'layered-wing':{name:'Layered stepped surface',terms:['layered','steps','stair','tier','awning','blade']},
  'folded-wing':{name:'Paired sloping surface',terms:['roof','slope','sail','fin']},
  'swept-wing':{name:'Angled panel with two anchors',terms:['diagonal','swept','wing','panel']},
  'vertical-fin':{name:'Thin upright panel',terms:['fin','rudder','partition','screen']},
  'tapered-wing':{name:'Wedge surface',terms:['wedge','wing','fin']},
  'paired-feet':{name:'Two columns with an open span',terms:['columns','frame','portal','opening','arch','legs']},
  'perch':{name:'Narrow post and crossbar',terms:['crossbar','mast','gantry','post','balance']},
  'turned-head':{name:'Angled upper carrier',terms:['angled','rotated','diagonal']},
  'seated-haunch':{name:'Sloping raised profile',terms:['backrest','seat','ramp']},
  'counter-tail':{name:'Low stepped taper',terms:['taper','tapered','counterweight']},
};
/** Favor relevant construction families and varied recipes before repeating a recipe's carrier colors. */
export function seedChoices(idea:RankedIdea,stock:Record<string,number>) {
  const words=`${idea.name} ${idea.pitch} ${idea.construction?.approach.profile??''} ${(idea.features??[]).map(f=>`${f.feature} ${f.part}`).join(' ')}`.toLowerCase(),palette=[...new Set(Object.values(rolePalette(idea,stock,'pile')).flat())];
  const tokens=new Set(words.split(/[^a-z0-9]+/)),has=(t:string)=>tokens.has(t);
  const matches=new Set(FEATURE_STUDIES.filter(s=>(s.group!=='transition'&&s.tags.some(has))||APPLICATIONS[s.id]?.terms.some(has)).map(s=>s.id));
  const nonAnimal=idea.discovery&&idea.discovery.family!=='animals';
  const choices=featureChoices(stock,words,palette,128).filter(c=>matches.has(c.studyId)&&!(nonAnimal&&c.variant?.includes('bird-head')))
    .map(c=>nonAnimal&&APPLICATIONS[c.studyId]?{...c,name:APPLICATIONS[c.studyId].name}:c);
  // Several bindings remain available, but sixteen copies of a carrier cannot bury a distinct construction.
  const counts=new Map<string,number>();
  return choices.filter(c=>{const key=`${c.studyId}:${c.variant??'standard'}`,n=counts.get(key)??0;counts.set(key,n+1);return n<3;}).slice(0,28);
}

function geometryTable(stock:Record<string,number>) {
  const seen=new Set<string>();
  return Object.entries(stock).filter(([,n])=>n>0).flatMap(([id])=>{
    const k=parsePartId(id);if(!k)return [];const shape=`${k.type}-${k.w}x${k.d}`;if(seen.has(shape))return [];seen.add(shape);
    const f=frame({partId:id,x:0,y:0,z:0,rot:0}),d=definition(k);
    const size=f.bounds.max.map((v,i)=>+(v/(i===2?8:20)).toFixed(3));
    return [`${shape}: bounding size [${size}] at rot 0; ${['brick','plate','tile'].includes(k.type)?(k.type==='tile'?'no top studs; underside grips on every stud center.':'top studs and bottom grips on every stud center.'):d.ports.map(p=>`${p.id}@${p.point.map((n,i)=>n/(i===2?8:20))}`).join('; ')}`];
  }).join('\n');
}

async function buildReservedFeature(idea:RankedIdea,stock:Record<string,number>,opts:FeatureFirstOptions,userSignal?:AbortSignal):Promise<FeatureFirstResult|null> {
  const active=()=>{if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');};active();
  const choices=seedChoices(idea,stock);if(!choices.length)return null;
  opts.onProgress?.('Choosing and reserving the defining feature…');
  const limits=choices.map(choice=>({choiceId:choice.id,...featurePlanLimits(choice)}));
  const planning:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[{text:`Design a compact LEGO ${idea.name}: ${idea.pitch} from a small fixed pile.
${constructionKnowledgeText(idea)}
Start by selecting ONE actual assembly below whose geometry establishes its identity. Choose a complete defining feature ahead of a decorative tip. These are reusable assemblies, not whole designs or a catalog of allowed subjects. Some studies have anatomy names; reinterpret their GEOMETRY as an appropriate functional feature of this subject. Use the feature's actual dimensions to decide the object's scale and arrangement. Choose a different arrangement if scarce parts cannot sustain a large upright body. Do not enlarge a box and add the feature afterward.
Return choiceId exactly, rotation (0/90/180/270 for the entire assembly), pose, two or three visible traits to preserve, bodySize [extent along world x, extent along world y, height] in STUDS, and colors (up to five BODY colors in coherent natural roles; the seed colors are already reserved separately). Every bodySize dimension must be between 1 and the chosen choiceId's EXACT ceiling in the table below. The size is the actual assembly extent; the ceiling is the compiler's body envelope bound, not a suggestion. Choose another offered assembly if its ceiling cannot support the intended proportions. The chosen feature is immutable and all its parts are deducted BEFORE body design. Nothing needs to use the whole pile; aim for 20–40 purposeful parts. Keep thin projections thin, distinct masses separate, and paired elements separated by air. A support is allowed only when it explains and carries the object or pose.
These choices are already compiled from exact stock; costs include carriers. Recipes describe their facing direction. Select the best natural colors for the subject, including any body support colors in your palette. A separately reserved hidden seed connector need not consume one of the five BODY colors.
${featureChoiceText(choices)}
EXACT PER-CHOICE BODY LIMITS (studs): ${JSON.stringify(limits)}
WHOLE PILE: ${JSON.stringify(stock)}`}]}];
  let reserved:ReservedFeature|undefined;
  for(let attempt=0;attempt<2;attempt++) {
    active();const selected=await generate<FeaturePlan>(planning,planSchema(choices),opts.signal);active();
    planning.push(selected.content);
    try {
      const choice=choices.find(c=>c.id===selected.json?.choiceId);if(!choice)throw Error('Select an offered choiceId exactly.');
      const plan=idea.construction?{...selected.json,traits:idea.construction.traits.slice(0,3)}:selected.json;
      reserved=reserveFeature(choice,plan,stock);break;
    }catch(e){
      const reason=(e as Error).message;opts.debug?.('featurePlanRejected',{attempt:attempt+1,reason});
      if(attempt===1)throw Error(`The assembly plan remained invalid after one repair: ${reason}`);
      opts.onProgress?.('Correcting the assembly plan before reserving pieces…');
      planning.push({role:'user',parts:[{text:`The plan was rejected before reserving any pieces. Original stock is unchanged. Repair this complete plan once. Exact reason: ${reason}. Use only the offered IDs, actual colors, quarter turns and the chosen choice's exact ceiling. Per-choice limits: ${JSON.stringify(limits)}. Do not silently assume a larger envelope.`}]});
    }
  }
  if(!reserved)throw Error('No valid assembly plan was produced.');
  const seed=reserved,choice=seed.choice;
  opts.debug?.('featureSeed',{plan:seed.plan,choice,parts:seed.parts,remaining:seed.remaining});
  opts.onProgress?.(`Reserved ${seed.parts.length} parts for ${choice.name.toLowerCase()}; building around its actual size…`);
  const available=Object.fromEntries(Object.entries(seed.remaining).filter(([id,n])=>{const k=parsePartId(id);return n>0&&k&&k.type!=='wheel'&&k.type!=='wheels'&&seed.plan.colors.includes(k.color);}));
  const history:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[...opts.views(seed.build).map(inline),{text:`Build the REST of this LEGO ${idea.name}: ${idea.pitch} around the reserved feature shown in these three images.
${constructionKnowledgeText(idea)}
LOCKED PLAN: ${JSON.stringify(seed.plan)}
LOCKED FEATURE: ${choice.name}. Actual extent ${seed.size.join(' × ')} STUDS. Its parts cannot move, change or be reused. Seed geometry below is authoritative.
COORDINATES: x and y in studs; z in PLATES (1 plate = 0.4 stud; 3 plates = 1 brick). Each part's x,y,z is the MINIMUM of its rotated bounding box. rot is DEGREES: exactly 0, 90, 180 or 270 (never 1, 2, 3); viewed counterclockwise from above. Body parts may have negative coordinates, especially negative z BELOW this fixed feature. The whole connected result will be translated onto the table; all relative positions are preserved. Do NOT add the seed parts again. Long ordinary plates/bricks run along x at rot 0; slopes/curves run along y at rot 0. Every stud/grip sits at a half-stud center (.5,.5), except explicitly listed jumper/side connectors. Two parts attach only when real stud/grip positions coincide on their surfaces. The seed's projecting elements and intentional gaps need clearance. Tiles/curves/cheese cannot support a part where they have no studs. There are no guessed brackets or sideways attachments.
Return reasoning (proportion, color and load path), parts (ONLY new body pieces), with exact partId,x,y,z,rot,role for each. Name roles by visible anatomy/function. Preserve the plan's 2–3 traits with distinct masses and negative space. Keep supporting mass subordinate to the defining feature; use curves/slopes on the silhouette and preserve openings and projections required by THIS subject. Body must fit the ${seed.plan.bodySize.join(' × ')} STUD envelope along world x, y, z respectively, regardless of the direction the seed faces. Complete model needs ${opts.minParts}–80 parts; aim 20–40, of which ${seed.parts.length} are already reserved. Do not pad the count with scenery or hidden piles of tiny parts. A coherent simpler subject is preferable to a fragmented multicolor sculpture. Use actual plate offsets and jumpers to shape small parts rather than enlarging everything to brick-sized voxels.
SEED GEOMETRY (x,y=studs; z=plates):
${seedGeometry(seed)}
REMAINING STOCK after reservation (body may use ONLY these IDs and counts): ${JSON.stringify(available)}
PART GEOMETRY (x,y=studs; z=plates; rotation changes x/y):
${geometryTable(available)}`}]}];
  let best:FeatureFirstResult|undefined;
  // Four construction attempts, then at most two attempts at a whole-body visual revision.
  try {
  for(let round=0;round<2;round++) {
    let candidate:FeatureConstruction|undefined;
    for(let attempt=0;attempt<(round?2:4);attempt++) {
      active();const r=await generate<FeatureBody>(history,BODY_SCHEMA,opts.signal);active();history.push(r.content);
      opts.debug?.('featureBody',{round,attempt,body:r.json});
      try{candidate=compileFeatureBody(seed,r.json,stock,idea.name,idea.pitch,opts.minParts);break;}
      catch(e){
        const reason=(e as Error).message;opts.debug?.('featureBodyRejected',{round,attempt,reason});
        const simpler=simplifyFeatureBody(seed,r.json,stock,idea.name,idea.pitch,opts.minParts);
        if(simpler){candidate=simpler.construction;opts.debug?.('featureBodySimplified',{round,attempt,removed:simpler.removed,body:simpler.body});opts.onProgress?.(`Omitted ${simpler.removed.length} pieces that did not fit; reviewing the simpler silhouette…`);history.push({role:'user',parts:[{text:`The compiler omitted ${simpler.removed.length} invalid extra pieces while preserving every other piece exactly. The valid actual body is ${JSON.stringify(simpler.body)}. It will now be visually reviewed; omitted features must not be claimed.`}]});break;}
        opts.onProgress?.('Correcting connections while preserving the defining feature…');history.push({role:'user',parts:[{text:`Nothing was committed. Correct the complete BODY proposal; the seed and original remaining stock are unchanged. Exact geometry/stock errors:\n${reason}\nIndices are zero-based, body N is entry N of your last parts array. Resolve ALL listed errors. Check each horizontal layer: parts may meet edge to edge, but cannot occupy the same volume. A supporting plate must be one plate below its supported piece; a supporting brick three plates below. Curves/tiles have no studs. Avoid ornaments resting on sloped low edges. A simple connected body with a few clean silhouette slopes is better than extra overlapping details. Count every repeated ID against REMAINING STOCK, including the root carriers already reserved. Return all replacement body parts, not a patch.`}]});
      }
    }
    if(!candidate){if(best)return best;throw Error('The body could not connect cleanly around the reserved feature.');}
    active();opts.onProgress?.('Reviewing the complete model without its label…');
    const verdict=await opts.judge(candidate.build,idea,opts.signal);active();
    opts.debug?.('featureFirstCandidate',{round,...candidate,verdict});
    const improved=best && appearanceIsBetter(best.verdict,verdict);
    if(!best || improved)best={...candidate,plan:seed.plan,verdict,revised:round>0};
    if(verdict.pass||round===1)break;
    history.push({role:'user',parts:[...opts.views(candidate.build).map(inline),{text:`These images show the ACTUAL assembled model. Independent blind reviewer described it as ${JSON.stringify(verdict.looksLike)} and scored recognition ${verdict.recognizable}/5, completeness ${verdict.complete}/5, color ${verdict.colors}/5, craft ${verdict.impressive}/5. Fixes: ${JSON.stringify(verdict.fixes)}. Redesign the WHOLE BODY around the SAME immutable seed and same palette/size. Preserve all ${seed.plan.traits.length} traits: ${seed.plan.traits.join('; ')}. Change large proportions and pose where needed, not just tiny decorations. Return a complete replacement body; stock resets to the original remaining stock for this alternative. Seed geometry stays exactly unchanged.`}]});
    opts.onProgress?.('Reworking body proportions while keeping the defining feature…');
  }
  return best!;
  } catch(e) {
    if(best&&!userSignal?.aborted){opts.debug?.('featureRevisionStopped',{reason:(e as Error).message});opts.onProgress?.('The revision could not finish; keeping the reviewed model.');return best;}
    throw e;
  }
}

export async function buildFeatureFirst(idea:RankedIdea,stock:Record<string,number>,opts:FeatureFirstOptions):Promise<FeatureFirstResult|null> {
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  const controller=new AbortController(),stop=()=>controller.abort();
  opts.signal?.addEventListener('abort',stop,{once:true});const timer=setTimeout(stop,360000);
  try {
    const result=await buildReservedFeature(idea,stock,{...opts,signal:controller.signal},opts.signal);
    if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');return result;
  }catch(e){if(controller.signal.aborted&&!opts.signal?.aborted)throw Error('The feature-first construction timed out.');throw e;}
  finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
}
