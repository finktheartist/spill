import {parsePartId} from '../bricks';
import {isMade} from '../catalog';
import {definition,frame} from '../connections';
import {foxTechniqueChoices,foxTechniqueText} from './fox-techniques';

/** The complete pile is available: no chassis or prospective head is prepaid. */
export function wholeAnimalStock(stock:Record<string,number>):Record<string,number> {
 if(!stock||typeof stock!=='object'||Array.isArray(stock))throw Error('Provide an exact whole-model stock ledger.');
 const entries=Object.entries(stock);
 if(entries.length>1024||entries.some(([id,n])=>id.length>80||!Number.isSafeInteger(n)||n<0))throw Error('Malformed whole-model stock ledger.');
 return Object.fromEntries(entries.filter(([id,n])=>{
  if(!n||!isMade(id))return false;
  try{const k=parsePartId(id);return !!k&&definition(k).ports.length>0;}catch{return false;}
 }).sort(([a],[b])=>a.localeCompare(b)));
}

const FOX_COLORS=new Set(['reddish-brown','dark-brown','medium-nougat','nougat','orange','dark-orange','bright-light-orange','white','light-gray','tan','dark-tan','black','dark-gray']);
export function wholeAnimalDesignStock(stock:Record<string,number>){return Object.fromEntries(Object.entries(wholeAnimalStock(stock)).filter(([id])=>FOX_COLORS.has(parsePartId(id)!.color)));}

/** Compact catalog derived from actual definitions. Ordinary grids are compressed;
 * modified parts retain every real connector, so no catalog nickname sets axes. */
export function wholeAnimalCatalog(stock:Record<string,number>) {
 const groups=new Map<string,Record<string,unknown>&{ids:Record<string,number>}>();
 for(const [id,count]of Object.entries(wholeAnimalDesignStock(stock))){
  const k=parsePartId(id)!,key=`${k.type}-${k.w}x${k.d}`,existing=groups.get(key);
  if(existing){existing.ids[id]=count;continue;}
  const d=definition(k),f=frame({partId:id,x:0,y:0,z:0,rot:0}),sizeStuds=f.bounds.max.map((n,a)=>(n-f.bounds.min[a])/20);
  const grid=['plate','brick','tile'].includes(k.type)&&d.ports.every(p=>/^(stud|grip):\d+:\d+$/.test(p.id)&&Math.abs(p.normal[2])===1);
  groups.set(key,{shape:key,ids:{[id]:count},sizeStuds,
   ...(grid?{gridPorts:{columns:sizeStuds[0],rows:sizeStuds[1],grips:true,studs:k.type!=='tile',
    formula:'For col,row integers: grip:col:row at [col+.5,row+.5,0] normal[0,0,-1]; stud:col:row at [col+.5,row+.5,height] normal[0,0,1]. All STUDS.'}}:
    {ports:d.ports.map(p=>({id:p.id,kind:p.kind,pointStuds:p.point.map(n=>n/20),normal:p.normal}))}),
  });
 }
 return [...groups.values()];
}

export function wholeAnimalPrinciples(stock:Record<string,number>,requestedName:string,minParts:number):string {
 return `Design a general Fox from the ORIGINAL complete inventory for request ${JSON.stringify(requestedName)}. Breed-specific details are not promised. There is NO fixed body, head, leg or tail, and no complete authored model to select. Every component can change together.
${(stock['plate-1x2-black']??0)>0?`CENTERLINE AFFORDANCE FROM THIS PILE: ${stock['plate-1x2-black']} black1x2plate(s) are available for a centered thin TWO-wide nose (choose intent thin, because intent small caps EVERY axis at1.5studs) on an even-width skull. A single1x1round nose centers naturally on an ODD-width face; an even-width face would need a real half-stud carrier to center that singleton. Let these available signature features set scale before mandating an incompatible reservation. Do not invent an absent jumper or bracket.`:''}
Apply MOC principles as actual construction decisions:
1. Solve defining features and their real carriers FIRST. Reserve matched pointed ears, a narrow projecting pale muzzle with separate small dark nose/eyes, and a substantial tapering rear tail. Let feasible feature dimensions set the whole scale. Reservations share ONE stock ledger; all remaining parts fund the body, stance and connecting structure.
2. Plan complete shape/proportions before detail. Give the Fox a lean torso, shaped chest/hips, a short neck, separated grounded legs, and deliberate tail balance. Break up the silhouette through actual contours, not mismatched color stripes. Ordinary plates can step or narrow a section; use special pieces where their shape helps. Keep visible coat colors coherent and let face/tail accents be deliberate. Gray exposed carriers are not automatically eyes.
BODY CRAFT PRIORITY: Keep actual chest, waist, hips, head and paired feet centered around one longitudinal spine; a sideways shelf is not a waist. Avoid a paper-thin chest beneath a tall block rump and an empty dip in the back: develop a continuous shoulder–waist–rump profile with actual stepped sections or shaped pieces. Plan slender leg SHAFTS separately from short feet: a 1x2 rectangular column can satisfy a thin bounding box while remaining visibly blocky. Reserve attention and real pieces for a contoured-body feature as well as ears/tail; combine the muzzle, nose and eyes into one pairing:none facial feature when necessary to keep within four feature reservations. A single slope buried inside bulk does not shape the visible outline.
${(stock['roundbrick-1x1-tan']??0)>=4?`STOCK OPPORTUNITY: four tan1x1roundbricks are available for four narrow rounded leg shafts. Test their real body grips and coherent color placement with separate short feet; do not add thick rectangular surrounds that erase the rounded silhouette.`:''}
${(stock['invslope-1x2-reddish-brown']??0)>0?`STOCK OPPORTUNITY: a brown1x2inverse slope can shape a supported throat/shoulder underside if its actual ports fit. Allocate it deliberately instead of filling every body region with boxes.`:''}
${(stock['curve-1x2-black']??0)>=2?`SCARCE PAIR: the two black1x2curves can form paired cheeks or chest contours, or be allocated to the tail. Choose the role that most improves the subject outline; they have grip ports only, so any exposed eyes above them need a separate real studded support.`:''}
3. Protect negative space beneath the belly, between the legs and ear tips, and below the jaw where appropriate. A module's unused port is not proof that another part can reach it. Include each real support/carrier in the bill. There is no credit for unused special parts, filler, scenery or a high technique count.
4. This pilot supports standing/crouching with all four legs grounded; seated/jointed/tilted constructions are not supported here. All targets are upright quarter turns with real stud/grip connections. Do not invent side-stud bricks, brackets, hinges or jumpers absent from AVAILABLE. A proposed half-stud shift needs an actual supported offset part.
5. Every part must belong to a purposeful anatomy role. The compiler builds independent connected same-role subassemblies and then joins them through actual ports; it does not silently snap, omit pieces or change poses. Connected final geometry, exact shared stock, collision, grounding and Fox anatomy are mandatory. A visually poor legal build remains a draft.
6. Design order differs from human assembly order. You may solve the ears/muzzle first, but final instructions will start from real grounded/attached sections. Do not add unsupported claims of strength, moving joints or physical hand-assembly proof.
PART BUDGET: ${minParts}–80 purposeful pieces for the WHOLE model. Aim for the scale the defining parts genuinely support. No fixed 21-piece body or 24-piece head allocation applies.
WORLD COORDINATES: x left/right, low y forward, z bottom height, all STUDS. One plate=.4, brick=1.2; 1x2/2x2 curves=.8 and the 1x3 curve=1.2 studs. z lies on .4-stud layers. x/y are each part's MINIMUM footprint AFTER rot0/90/180/270. Nominal1xN plain bars run X at0 and Y at90; directional slopes/curves use their measured local axes. Use the actual size/ports table: curve underside sockets are stepped, so the back row is .4 studs above the lowest sockets. Tiles and curves have NO top studs; slopes/inverse slopes expose only listed rows. Touching faces do not make a connection. A complete graph must lead from the four grounded feet to body, head and tail. Keep all extents within24studs and at most32 anatomy subassemblies.
AVAILABLE NATURAL FOX PALETTE IDS/COUNTS, rot0 WORLD SIZES AND CONNECTORS (the original pile remains intact; unrelated saturated colors are omitted from this Fox catalog): ${JSON.stringify(wholeAnimalCatalog(stock))}
OPTIONAL SMALL CONSTRUCTIONS: ${foxTechniqueText(foxTechniqueChoices(wholeAnimalStock(stock)))}
The small constructions are examples of real topology, not full heads/bodies and not an additional reserved ledger. Any parts you adopt must be listed once in the complete target layout. Geometry—not a written claim—establishes use. Prefer a strong full silhouette over copying these small examples.`;
}
