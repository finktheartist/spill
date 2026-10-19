import { CATALOG, footprint, parsePartId, partCount, type Build, type ColorName, type PartType, type Placed } from './bricks';
import { isMade } from './catalog';
import { add, apply, axisAngle, corners, definition, multiply, sub, attachmentTwist, compileConnections, connectionPairs, frame, type Box, type ConnectionProgram, type V3 } from './connections';
import { constructionIssues } from './construction';
import { packRegion, type PackingRegion } from './robot-module-layout';

/** Anatomical dimensions, not a recipe ID or a list of placed bricks. All plans
 * use one stock ledger; the finished-build judge remains independent. */
export interface AnimalSpec {
 bodyLength:6|8|10; legHeight:1|3|4|7; neckHeight:0|1|3; body:'lean'|'full';
 muzzle:1|2; head:'narrow'|'broad'; face:'sloped'|'stepped'; ears:'drop'|'alert'|'curved';
 legs:'slender'|'solid'; tail:'low'|'raised'|'stub';
 back?:'flat'|'sloped'; feet?:'plate'|'round'; frame?:'narrow'|'wide'|'deep'; palette?:'exact'|'family';
 color:'reddish-brown'|'white'|'dark-azure'; accent:'tan'|'white'|'medium-nougat';
}
type Material='body'|'accent'|'dark'|'eye'|'ear';
export interface AnimalRegion extends PackingRegion {
 id:string; feature:string; x:number;y:number;z:number; material:Material;pair?:string;
}
export interface AnimalTarget {version:1;spec:AnimalSpec;regions:AnimalRegion[];interfaces:[string,string][];description:string}
export interface AnimalContract {target:AnimalTarget;assignment:string[];anchor:V3;heading:90}
export interface AnimalCandidate {target:AnimalTarget;build:Build;program:ConnectionProgram;contract:AnimalContract;remaining:Record<string,number>}
const optional={back:['flat','sloped'],feet:['plate','round'],frame:['narrow','wide','deep'],palette:['exact','family']} as const;
const options={bodyLength:[6,8,10],legHeight:[1,3,4,7],neckHeight:[0,1,3],body:['lean','full'],muzzle:[1,2],head:['narrow','broad'],face:['sloped','stepped'],ears:['drop','alert','curved'],legs:['slender','solid'],tail:['low','raised','stub'],color:['reddish-brown','white','dark-azure'],accent:['tan','white','medium-nougat']} as const;
export const ANIMAL_SPEC_SCHEMA={type:'OBJECT',required:Object.keys(options),properties:Object.fromEntries(Object.entries({...options,...optional}).map(([k,v])=>[k,typeof v[0]==='number'?{type:'INTEGER',minimum:Math.min(...v as readonly number[]),maximum:Math.max(...v as readonly number[])}:{type:'STRING',enum:v}]))};
export function animalSpec(raw:unknown):AnimalSpec {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Provide anatomical dimensions.');
 const r=raw as Record<string,unknown>;
 for(const[k,v]of Object.entries(optional))if(r[k]!==undefined&&!(v as readonly unknown[]).includes(r[k]))throw Error(`Unsupported animal ${k}.`);
 if(r.feet==='round'&&r.legHeight!==3)throw Error('Round feet use a three-plate leg height.');
 if(r.legHeight===3&&r.feet!=='round')throw Error('Three-plate legs require round feet.');
 for(const[k,v]of Object.entries(options))if(!(v as readonly unknown[]).includes(r[k]))throw Error(`Animal ${k} must be ${v.join(' / ')}.`);
 if(r.head==='broad'&&(r.face!=='sloped'||r.ears==='drop'))throw Error('A broad face needs a sloped rump and curved or alert ears.');
 if(r.color===r.accent)throw Error('The muzzle must contrast with the coat.');
 return Object.fromEntries([...Object.keys(options),...Object.keys(optional).filter(k=>r[k]!==undefined)].map(k=>[k,r[k]])) as unknown as AnimalSpec;
}
export const animalRequest=(name:string)=>/\b(animal|quadruped|dog|hound|dachshund|terrier|puppy|bear|cub|fox|wolf|cat)\b/i.test(name);
export const ANIMAL_ANATOMY_BRIEF=`Design 3–5 DIFFERENT animal anatomies before allocating pieces. Return dimensions, never bricks or a candidate ID. This is a bounded standing/crouching quadruped grammar, not arbitrary species or articulated poses.
bodyLength 6/8/10 studs; legHeight 1/3/4/7 plates including paws (1 = crouching); neckHeight 0/1/3 plates (0 seats the head directly on the shoulders); body lean/full (lean keeps raised shoulders and hips around a lower, thinner waist); muzzle projects 1/2 studs. Body is 2 studs wide, four feet span 4 studs, head is compact. Low long bodies suggest hounds; shorter, taller bodies and a short muzzle suggest cubs or compact dogs. Choose meaningful proportion differences, not only new colors or names.
head narrow keeps a two-stud face. head broad creates a four-stud face with separated eyes OUTSIDE the projecting muzzle, rounded ears and a shorter chin; it requires face sloped (the reserved slope moves to the rump) and curved/alert ears. Prefer this for a readable compact dog face.
face sloped reserves one coat-colored 2x2 slope for a rising forehead with exposed eyes; stepped uses ordinary bricks and reserves the slope for the rump. ears curved reserve TWO black 1x2 curves for thin rounded ears, with their lower socket rows on the ear bridge and raised rear rows overhanging behind it; these compete with a curved tail so choose stub when only two exist. ears drop hang beside the rear of the skull; alert stand above the crown and need two small warm-colored bricks. legs slender reserve four tan 1x1 round bricks when elevated; solid use coat-colored bricks. tail low/raised uses one black 1x2 curve; stub is a short coat-colored finish. Coat color reddish-brown/white/dark-azure, accent tan/white/medium-nougat. All regions must fit exact shared stock. No missing slopes, connectors or hinges may be assumed. No sideways connector is required by this grammar.
For small mixed piles choose palette family: related blue shades may share a blue coat, hidden structural supports may use neutral colors, eyes/nose may use dark green or dark blue, and curves may match the coat. feet round uses four 1x1 round bricks directly on the ground with legHeight 3, avoiding four separate paw plates. frame wide uses 2x4 plate shoulder/hip supports; frame deep uses 2x4 brick supports. back sloped reserves a second pair of slopes for tapered hips rather than a flat rump plate. These alternatives preserve four separate feet and an open belly. The ear bridge can also use a brick in the deep frame. Front and rear pairs may use different pieces. Choose exact/narrow/plate for the original strict construction; changing frame or feet changes the target explicitly.
Reserve eyes, nose, forehead/rump, ears, tail and matching legs BEFORE flexible body packing. The allocator may use smaller bricks or plate laminations inside a region, but cannot change your silhouette. Failed plans need explicit new proportions. A valid assembly is still a draft until anonymous visual review passes. Prefer readable eyes, a low projecting muzzle, an open belly and an intentional transition between neck, shoulders and back. No display base or filler.`;

export function createAnimalTarget(input:AnimalSpec):AnimalTarget {
 const s=animalSpec(input),regions:AnimalRegion[]=[],interfaces:[string,string][]=[];
 const add=(id:string,feature:string,x:number,y:number,z:number,w:number,d:number,h:number,material:Material,types:PartType[]=['brick','plate'],extra:Partial<AnimalRegion>={})=>regions.push({id,feature,x,y,z,w,d,h,material,types:s.palette==='family'&&types.includes('plate')?[...new Set([...types,'roundendplate' as const])]:types,...extra});
 const L=s.bodyLength,tieH=s.frame==='deep'?3:1,tieW=s.frame&&s.frame!=='narrow'?2:1,round=s.feet==='round',B=s.legHeight+tieH,H=B+4+s.neckHeight,headLength=s.head==='broad'?2:s.face==='sloped'?3:2;
 for(const[x,name]of [[0,'front'],[L-2,'rear']] as const)for(const[y,side]of [[0,'near'],[3,'far']] as const){
  const id=`${name}-${side}`;
  add(`paw-${id}`,'Four separate grounded paws',round?(name==='front'?x+1:x):x,y,0,round?1:2,1,round?3:1,round?'accent':'body',round?['roundbrick']:['plate','roundendplate'],{pair:s.palette==='family'?`paws-${name}`:'paws'});
  if(s.legHeight>1&&!round){
   if(s.legs==='slender'){
    if(s.legHeight===7)add(`lower-${id}`,'Paired lower leg shafts',x,y,1,2,1,3,'body',['brick','plate'],{pair:'lower-legs'});
    add(`leg-${id}`,'Narrow upper legs under the body',name==='front'?x+1:x,y,s.legHeight-3,1,1,3,'accent',['roundbrick'],{pair:s.palette==='family'?`legs-${name}`:'legs'});
   }else add(`leg-${id}`,'Matched supporting legs',x,y,1,2,1,s.legHeight-1,'body',['brick','plate'],{pair:s.palette==='family'?`legs-${name}`:'legs'});
   interfaces.push([`paw-${id}`,s.legHeight===7&&s.legs==='slender'?`lower-${id}`:`leg-${id}`]);
   if(s.legHeight===7&&s.legs==='slender')interfaces.push([`lower-${id}`,`leg-${id}`]);
  }
  interfaces.push([s.legHeight>1&&!round?`leg-${id}`:`paw-${id}`,`tie-${name}`]);
 }
 for(const[x,name]of [[1,'front'],[L-2,'rear']] as const){
  add(`tie-${name}`,'Shoulder and hip cross ties',name==='front'?2-tieW:x,0,s.legHeight,tieW,4,tieH,'body',tieH===3?['brick','plate']:['plate'],s.palette==='family'?{}:{pair:'ties'});
  interfaces.push([`tie-${name}`,'belly']);
 }
 add('belly','Continuous narrow belly bridge',0,1,B,L,2,1,'body',['plate']);
 if(s.body==='full')add('torso','Body proportions and open belly',0,1,B+1,L,2,3,'body');
 else {add('chest','Raised shoulders ahead of a narrow waist',0,1,B+1,2,2,3,'body');add('waist','Lower slender waist between shoulders and hips',2,1,B+1,L-4,2,1,'body',['plate']);add('hips','Raised haunches behind the waist',L-2,1,B+1,2,2,3,'body');}
 if(s.neckHeight)add('neck','Short raised neck above the chest',0,1,B+4,2,2,s.neckHeight,'body');
 const saddleStart=s.neckHeight===0&&s.body==='full'?headLength:2;
 add('saddle','Finished back behind the shoulders',saddleStart,1,B+(s.body==='lean'?2:4),L-2-saddleStart,2,1,'accent',s.palette==='family'?['tile','plate']:['tile']);
 if((s.face==='stepped'||s.head==='broad'||s.back==='sloped'))add('rump','Sloping rump beyond the saddle',L-2,1,B+4,2,2,3,'body',['slope'],{rotations:[90]});
 else add('rump','Low finished rump',L-2,1,B+4,2,2,1,'body',['plate']);
 if(s.head==='broad'){
  add('jaw','Wide cheek carrier centered above the shoulders',0,0,H,2,4,1,'body',['plate']);
  add('muzzle','Narrow projecting muzzle and connected upper jaw',-s.muzzle,1,H+1,s.muzzle+1,2,1,'accent',['plate']);
  add('nose','Dark nose at the tip of a narrow muzzle',-s.muzzle,1,H+2,1,2,1,'dark',['plate']);
  if(s.muzzle===2)add('muzzle-finish','Pale muzzle behind the nose',-1,1,H+2,1,2,1,'accent',s.palette==='family'?['tile','plate']:['tile']);
  add('brow-support','Brow rising behind the projecting muzzle',0,1,H+2,1,2,1,'body',['plate']);
  for(const y of [0,3]){add(`cheek-${y}`,'Cheeks flanking the narrow muzzle',0,y,H+1,2,1,3,'body');add(`eye-${y===0?1:2}`,'Separated dark eyes outside the muzzle',0,y,H+4,1,1,1,'eye',['plate'],{pair:'eyes'});}
  add('skull-back','Skull backing behind the muzzle',1,1,H+1,1,2,3,'body');
  add('forehead','Recessed brow above the short muzzle',0,1,H+3,1,2,1,'body',['plate']);
  add('ear-tie','Ear bridge behind the visible eyes',1,0,H+4,1,4,1,'body',['plate']);
  add('crown','Compact crown between the eyes',0,1,H+4,1,2,1,'body',['tile','plate']);
  for(const y of [0,3])add(`ear-${y}`,'Ears behind the forward eyes',1,y,H+5,s.ears==='curved'?2:1,1,s.ears==='curved'?2:3,s.ears==='curved'?'dark':'ear',s.ears==='curved'?['curve']:['brick','plate'],{pair:'ears',...(s.ears==='curved'?{rotations:[270]}:{})});
 }else{
 add('jaw','Pale jaw projecting ahead of the neck',-s.muzzle,1,H,s.muzzle+headLength,2,1,'accent',['plate']);
 add('muzzle','Low projecting muzzle below the eyes',-s.muzzle,1,H+1,s.muzzle,2,1,'accent',['plate']);
 add('nose','Dark nose at the muzzle tip',-s.muzzle,1,H+2,1,2,1,'dark',['plate']);
 if(s.muzzle===2)add('muzzle-finish','Smooth muzzle behind the nose',-1,1,H+2,1,2,1,'accent',s.palette==='family'?['tile','plate']:['tile']);
 add('forehead','Forehead rising behind the muzzle',0,1,H+1,2,2,3,'body',s.face==='sloped'?['slope']:['brick','plate'],{rotations:s.face==='sloped'?[270]:[0,90]});
 const eyeX=s.face==='sloped'?1:0,rear=headLength-1;
 if(s.face==='sloped')add('skull-back','Skull backing behind the rising forehead',2,1,H+1,1,2,3,'body');
 for(const y of [1,2])add(`eye-${y}`,'Exposed paired eyes ahead of the ear roots',eyeX,y,H+4,1,1,1,'eye',['plate'],{pair:'eyes'});
 add('ear-tie','Narrow ear bridge behind the eyes',rear,0,H+4,1,4,tieH,'body',tieH===3?['brick','plate']:['plate']);
 add('crown','Small smooth crown behind the eyes',rear,1,H+4+tieH,1,2,1,'body',['tile','plate']);
 // At 270 degrees the lower socket sits on the narrow bridge; the raised
 // socket overhangs behind it. At 90 only the raised socket was above the tie.
 for(const y of [0,3])add(`ear-${y}`,s.ears==='drop'?'Ears hanging behind the face':s.ears==='curved'?'Thin curved ears behind the eyes':'Upright ear tips above the crown',rear,y,H+(s.ears==='drop'?1:4+tieH),s.ears==='alert'?1:2,1,s.ears==='curved'?2:3,s.ears==='drop'?'body':s.ears==='curved'?'dark':'ear',s.ears==='curved'?['curve']:['brick','plate'],{pair:'ears',...(s.ears==='curved'?{rotations:[270]}:{})});
 }
 const T=B+((s.face==='stepped'||s.head==='broad'||s.back==='sloped')?7:5),tailX=L-((s.face==='stepped'||s.head==='broad'||s.back==='sloped')?2:1);
 if(s.tail==='stub')add('tail','Short rump tail',L-2,1,T,1,2,1,'body',['tile','plate']);
 else {
  add('tail-root','Narrow tail projecting beyond the rump',tailX,1,T,2,1,1,'body',['plate']);
  if(s.tail==='raised')add('tail-rise','Raised tail profile',tailX,1,T+1,2,1,3,'body');
  add('tail','Curved taper at the tail tip',tailX,1,T+(s.tail==='raised'?4:1),2,1,2,'dark',['curve'],{rotations:[90]});
 }
 const chest=s.body==='full'?'torso':'chest',hips=s.body==='full'?'torso':'hips';
 for(const id of s.body==='full'?['torso']:['chest','waist','hips'])interfaces.push(['belly',id]);
 interfaces.push([s.body==='full'?'torso':'waist','saddle'],[hips,'rump'],[s.neckHeight?'neck':chest,'jaw']);
 if(s.neckHeight)interfaces.push([chest,'neck']);
 if(s.head==='broad'){
  interfaces.push(['jaw','muzzle'],['muzzle','nose'],['muzzle','brow-support'],['brow-support','forehead'],['forehead','crown'],['jaw','skull-back'],['skull-back','ear-tie'],['ear-tie','ear-0'],['ear-tie','ear-3']);
  for(const y of [0,3])interfaces.push(['jaw',`cheek-${y}`],[`cheek-${y}`,`eye-${y===0?1:2}`],[`cheek-${y}`,'ear-tie']);
 }else{
  interfaces.push(['jaw','forehead'],['jaw','muzzle'],['muzzle','nose'],['forehead','eye-1'],['forehead','eye-2'],[s.face==='sloped'?'skull-back':'forehead','ear-tie'],['ear-tie','crown'],['ear-tie','ear-0'],['ear-tie','ear-3']);
  if(s.face==='sloped')interfaces.push(['jaw','skull-back']);
 }
 interfaces.push(['rump',s.tail==='stub'?'tail':'tail-root']);
 if(s.muzzle===2)interfaces.push(['muzzle','muzzle-finish']);
 if(s.tail!=='stub')interfaces.push(['tail-root',s.tail==='raised'?'tail-rise':'tail']);
 if(s.tail==='raised')interfaces.push(['tail-rise','tail']);
 return {version:1,spec:s,regions,interfaces,description:`A ${L}-stud quadruped with a ${s.body} body, ${s.legHeight}-plate legs, a ${s.neckHeight}-plate neck, ${s.muzzle}-stud muzzle, ${s.face} forehead, ${s.ears} ears and ${s.tail} tail.`};
}
const supported=(id:string)=>{const k=parsePartId(id);return k&&k.type!=='wheels'&&CATALOG[k.type]?.includes(`${k.w}x${k.d}`);};
const coatFamily=(color:AnimalSpec['color']):ColorName[]=>color==='dark-azure'?['dark-azure','azure','dark-blue','medium-blue','blue']:color==='white'?['white','light-gray']:['reddish-brown','dark-brown','medium-nougat','dark-tan'];
const palette=(s:AnimalSpec,r:AnimalRegion):ColorName[]=>{
 if(s.palette!=='family')return r.material==='body'?[s.color]:r.material==='accent'?[s.accent]:r.material==='dark'?['black']:r.material==='eye'?['dark-gray','black']:['medium-nougat','tan'];
 if(r.id.startsWith('paw-')&&s.feet==='round')return ['tan','white','light-gray','black'];
 const coat=coatFamily(s.color),hidden=['belly','torso','chest','hips','waist','skull-back','ear-tie','tie-front','tie-rear'].includes(r.id);
 if(r.material==='body')return [...new Set([...coat,...(hidden?['black','dark-gray','light-gray','white'] as ColorName[]:[])])];
 if(r.material==='accent')return [...new Set([s.accent,'white','tan','reddish-brown',...(['saddle','jaw'].includes(r.id)?coat:[])] as ColorName[])];
 if(r.material==='eye')return ['black','dark-gray','dark-blue','dark-green'];
 if(r.material==='dark')return r.id==='nose'?['black','dark-blue','dark-gray','dark-green','reddish-brown']:['black',...coat];
 return [s.accent,...coat];
};
const cost=(parts:Placed[])=>{const used:Record<string,number>={};for(const p of parts)used[p.partId]=(used[p.partId]??0)+1;return used;};
export const animalShapeKey=(s:AnimalSpec)=>JSON.stringify(createAnimalTarget(s).regions.map(({id,x,y,z,w,d,h,types,rotations})=>({id,x,y,z,w,d,h,types,rotations})));
const normalize=(parts:Placed[])=>{const min=[Math.min(...parts.map(p=>p.x)),Math.min(...parts.map(p=>p.y)),0];return parts.map(p=>({...p,x:p.x-min[0],y:p.y-min[1]}));};

/** Stock substitutions preserve exact anatomical envelopes and paired shapes. */
export function solveAnimalTarget(stock:Record<string,number>,target:AnimalTarget,diagnostics:string[]=[],limit=1,budgetMs=10000):AnimalCandidate[]{
 if(JSON.stringify(createAnimalTarget(target.spec))!==JSON.stringify(target))throw Error('The frozen animal target was altered.');
 const start=performance.now(),active=()=>{if(performance.now()-start>budgetMs)throw Error('Animal allocation timed out; choose a smaller plan.');};
 stock=Object.fromEntries(Object.entries(stock).filter(([id,n])=>Number.isSafeInteger(n)&&n>0&&supported(id)&&isMade(id)));
 const groups:AnimalRegion[][]=[];
 for(const r of target.regions){const group=r.pair&&groups.find(g=>g[0].pair===r.pair);if(group)group.push(r);else groups.push([r]);}
 const choices=(g:AnimalRegion[],left:Record<string,number>)=>{
  const r=g[0],out=packRegion(r,left,g.length,palette(target.spec,r),['jaw','belly'].includes(r.id)?16:5);
  // Vary dominant structural pieces as well as seams: a greedy long plate can
  // otherwise exhaust small plates needed by later regions. This only explores
  // alternate allocations; every returned part still comes from the real ledger.
  if(['jaw','belly'].includes(r.id)&&out.length)for(const id of Object.keys(out[0].used).slice(0,2))out.push(...packRegion(r,{...left,[id]:0},g.length,palette(target.spec,r),4));
  const reflect=r.types.every(t=>['brick','plate','tile'].includes(t));
  return out.flatMap(a=>[a,...(reflect?[{...a,cost:a.cost+.01,parts:a.parts.map(p=>({...p,x:r.w-p.x-footprint(parsePartId(p.partId)!,p.rot).fw}))}]:[])]);
 };
 // Identity-bearing parts and four matching legs consume stock before fillers.
 const priority=(r:AnimalRegion)=>['eye','dark','ear'].includes(r.material)||r.types.some(t=>['slope','roundbrick'].includes(t))?0:r.pair?1:['jaw','belly','saddle'].includes(r.id)?2:3;
 const initial=new Map(groups.map(g=>[g,choices(g,stock)]));
 for(const[g,a]of initial)if(!a.length){diagnostics.push(`No stock construction for ${g[0].id}: ${g[0].w}×${g[0].d}×${g[0].h}, ${g.length} matching copies in ${palette(target.spec,g[0]).join('/')}.`);return [];}
 groups.sort((a,b)=>priority(a[0])-priority(b[0])||initial.get(a)!.length-initial.get(b)!.length);
 type Tagged=Placed&{region:string};type State={parts:Tagged[];left:Record<string,number>;score:number};
 let states:State[]=[{parts:[],left:{...stock},score:0}];
 for(const group of groups){active();const next:State[]=[],cache=new Map<string,ReturnType<typeof choices>>();
  for(const state of states){active();const key=JSON.stringify(state.left);let allocations=cache.get(key);if(!allocations){allocations=choices(group,state.left);cache.set(key,allocations);}
   for(const a of allocations){const parts=group.flatMap(r=>a.parts.map(p=>({...p,x:p.x+r.x,y:p.y+r.y,z:p.z+r.z,region:r.id}))),left={...state.left};for(const[id,n]of Object.entries(cost(parts)))left[id]-=n;
    if(Object.values(left).some(n=>n<0)||state.parts.length+parts.length>60)continue;
    next.push({parts:[...state.parts,...parts],left,score:state.score+a.cost});
   }
  }
  if(!next.length){diagnostics.push(`Shared stock exhausted at ${group[0].id}; reserve a smaller body or different features.`);return [];}
  const seen=new Set<string>(),ranked=next.sort((a,b)=>a.score-b.score).filter(a=>{const key=JSON.stringify(a.parts);if(seen.has(key))return false;seen.add(key);return true;});
  const seams=new Set<string>(),first:State[]=[],rest:State[]=[];
  for(const a of ranked){const seam=JSON.stringify(a.parts.filter(p=>['jaw','belly'].includes(p.region)));if(seams.has(seam))rest.push(a);else{seams.add(seam);first.push(a);}}
  states=[...first,...rest].slice(0,40);
 }
 const result:AnimalCandidate[]=[];
 for(const state of states){active();try{
  const parts=normalize(state.parts),frames=parts.map(frame),root=state.parts.findIndex(p=>p.region==='paw-front-near'),order=[root],seen=new Set(order);
  const operations:ConnectionProgram['operations']=[{partId:parts[root].partId,parent:-1,parentPort:'',childPort:'',twist:0}];
  while(order.length<parts.length){let found=false;
   for(let j=0;j<parts.length&&!found;j++)if(!seen.has(j))for(let parent=0;parent<order.length&&!found;parent++)for(const[a,b]of connectionPairs(frames[order[parent]],frames[j])){
    const twist=attachmentTwist(parts[order[parent]],a,parts[j],b);if(twist===null)continue;
    operations.push({partId:parts[j].partId,parent,parentPort:a,childPort:b,twist});order.push(j);seen.add(j);found=true;break;
   }
   if(!found)throw Error('Disconnected planned seams: '+[...new Set(state.parts.filter((_,i)=>!seen.has(i)).map(p=>p.region))].join(', '));
  }
  const program:ConnectionProgram={name:'Planned quadruped',description:target.description,rootRotation:(parts[root].rot+90)%360,operations};
  const build=compileConnections(program,stock),assignment=order.map(i=>state.parts[i].region),anchor:V3=[state.parts[root].x*20,state.parts[root].y*20,state.parts[root].z*8];
  const contract:AnimalContract={target,assignment,anchor,heading:90},issues=animalAnatomyIssues(build,contract);
  if(issues.length)throw Error(issues.join('; '));
  build.steps.forEach((step,i)=>step.caption=`${target.regions.find(r=>r.id===assignment[i])!.feature}. ${step.caption}`);
  result.push({target,build,program,contract,remaining:state.left});if(result.length>=limit)break;
 }catch(e){const m=(e as Error).message;if(!diagnostics.includes(m)&&diagnostics.length<8)diagnostics.push(m);}}
 return result;
}

/** Rechecks geometry against the canonical spec, not mutable allocator receipts. */
export function animalAnatomyIssues(build:Build,contract:AnimalContract):string[]{
 const {target,assignment,anchor}=contract,issues:string[]=[],actual=build.steps.flatMap(s=>s.parts);
 if(contract.heading!==90||!actual.length)return ['Animal heading must face the normal front camera.'];
 const turn=axisAngle([0,0,1],90),inverse=axisAngle([0,0,1],-90),offset=sub(frame(actual[0]).translation,apply(turn,anchor));
 const parts=actual.map(p=>{const f=frame(p),points=corners(f.bounds).map(v=>apply(inverse,sub(v,offset))),min=[0,1,2].map(a=>Math.min(...points.map(v=>v[a])));return {...p,x:min[0]/20,y:min[1]/20,z:min[2]/8,rot:0,orientation:multiply(inverse,f.rotation)};});
 if(JSON.stringify(createAnimalTarget(target.spec))!==JSON.stringify(target))return ['The frozen animal target was altered.'];
 if(parts.length!==assignment.length||partCount(build)<20||partCount(build)>60)return ['An animal must contain 20–60 assigned parts.'];
 const frames=parts.map(frame),shift=[0,0,0];
 const members=(id:string)=>parts.flatMap((_,i)=>assignment[i]===id?[i]:[]);
 if(assignment.some(id=>!target.regions.some(r=>r.id===id)))return ['An unplanned animal region was added.'];
 for(const r of target.regions){const indexes=members(r.id),packed:Box[]=[];let volume=0;if(!indexes.length){issues.push(`${r.id}: missing anatomy.`);continue;}
  for(const i of indexes){const k=parsePartId(parts[i].partId)!,f=frames[i],b=f.bounds;
   if(!r.types.includes(k.type)||!palette(target.spec,r).includes(k.color))issues.push(`${r.id}: required profile or color changed.`);
   const lo=[r.x*20,r.y*20,r.z*8],hi=[(r.x+r.w)*20,(r.y+r.d)*20,(r.z+r.h)*8];
   if([0,1,2].some(a=>b.min[a]-shift[a]<lo[a]-.01||b.max[a]-shift[a]>hi[a]+.01))issues.push(`${r.id}: anatomy left its planned envelope.`);
   if(!(r.rotations??[0,90]).some(rot=>frame({...parts[i],orientation:undefined,rot}).rotation.every((v,j)=>Math.abs(v-f.rotation[j])<.01)))issues.push(`${r.id}: anatomical profile faces the wrong direction.`);
   // Region packing charges the nominal part envelope, independently of source
   // facet rounding, underside cutouts or the number of convex sections.
   const points=definition(k).boxes.flatMap(box=>corners(box).map(v=>add(apply(f.rotation,v),f.translation)));
   const nominal:Box={min:[0,1,2].map(a=>Math.min(...points.map(v=>v[a]))) as V3,max:[0,1,2].map(a=>Math.max(...points.map(v=>v[a]))) as V3};
   if([0,1,2].some(a=>nominal.min[a]<lo[a]-.01||nominal.max[a]>hi[a]+.01))issues.push(`${r.id}: nominal part envelope left its planned anatomy.`);
   volume+=[0,1,2].reduce((v,a)=>v*(nominal.max[a]-nominal.min[a]),1);packed.push(nominal);
  }
  if(packed.some((b,i)=>packed.slice(i+1).some(c=>[0,1,2].every(a=>Math.min(b.max[a],c.max[a])-Math.max(b.min[a],c.min[a])>.01))))issues.push(`${r.id}: nominal part envelopes overlap instead of tiling the anatomy.`);
  if(Math.abs(volume-r.w*r.d*r.h*3200)>.01)issues.push(`${r.id}: a gap or excess in the planned anatomy.`);
 }
 for(const pair of new Set(target.regions.flatMap(r=>r.pair?[r.pair]:[]))){
  const signatures=target.regions.filter(r=>r.pair===pair).map(r=>members(r.id).map(i=>{const p=parts[i],f=frames[i];return JSON.stringify([p.partId,...f.bounds.min.map((n,a)=>Math.round((n-shift[a]-[r.x*20,r.y*20,r.z*8][a])*100)/100),f.rotation]);}).sort().join('|'));
  if(signatures.some(s=>s!==signatures[0]))issues.push(`${pair}: matching anatomical regions diverged.`);
 }
 for(const[a,b]of target.interfaces)if(!members(a).some(i=>members(b).some(j=>connectionPairs(frames[i],frames[j]).length)))issues.push(`${a} must connect directly to ${b}.`);
 for(const r of target.regions.filter(r=>r.id.startsWith('paw-')))if(!members(r.id).some(i=>Math.abs(frames[i].bounds.min[2])<.01))issues.push(`${r.id}: paw no longer grounded.`);
 if(constructionIssues(build,cost(parts),24).length)issues.push('Invalid physical animal assembly.');
 return [...new Set(issues)];
}

/** Necessary small-module feasibility, not a claim that a whole animal fits. */
export function animalCoatColors(stock:Record<string,number>):AnimalSpec['color'][] {
 const safe=Object.fromEntries(Object.entries(stock).filter(([id,n])=>Number.isSafeInteger(n)&&n>0&&supported(id)&&isMade(id)));
 return options.color.filter(color=>{
  const colors=coatFamily(color);
  const paws=packRegion({w:2,d:1,h:1,types:['plate','roundendplate']},safe,2,colors,1).length>0||['tan','white','light-gray','black'].reduce((n,c)=>n+(safe[`roundbrick-1x1-${c}`]??0),0)>=4;
  const ties=[{w:1,d:4,h:1,types:['plate']},{w:2,d:4,h:1,types:['plate']},{w:2,d:4,h:3,types:['brick','plate']}].some(r=>packRegion(r as PackingRegion,safe,1,colors,1).length>0);
  return paws&&ties&&packRegion({w:2,d:2,h:3,types:['slope'],rotations:[90]},safe,1,colors,1).length>0;
 });
}
export function animalStockGuidance(stock:Record<string,number>):string {
 const coats=animalCoatColors(stock);
 const frames=coats.map(color=>{
  const colors=[...coatFamily(color),'white','light-gray','dark-gray','black'] as ColorName[];
  const supported=[['narrow',1,1],['wide',2,1],['deep',2,3]].filter(([,w,h])=>packRegion({w:w as number,d:4,h:h as number,types:h===3?['brick','plate']:['plate']},stock,1,colors,1).length).map(([name])=>name);
  return `${color}: ${supported.join('/')||'none'}`;
 });
 const roundFeet=['tan','white','light-gray','black'].reduce((n,c)=>n+(stock[`roundbrick-1x1-${c}`]??0),0);
 const hints=`Family-frame candidates: ${frames.join('; ')}. Round-foot supply: ${roundFeet}; when >=4, feet round + legHeight 3 avoids paw plates. The family jaw carrier can use coat-colored plates while the muzzle remains an accent. If flat rump plates are scarce, back sloped can use another two matching 1x2 slopes. Each final plan still needs a joint allocation.`;
 const slender=options.accent.filter(color=>(stock[`roundbrick-1x1-${color}`]??0)>=4);
 return `${hints} Necessary module checks: coat families with potential paw/round-foot, narrow/wide/deep support and shaped slope constructions: ${coats.join(', ')||'NONE'}. Use palette family to combine related coat shades and different front/rear supports. These are permissive prechecks, not an allocation guarantee. These tests are independent, so shared stock can still reject a full plan. Slender elevated legs require accent ${slender.join('/')||'UNAVAILABLE'} (four matching round bricks). Exact-palette black ear/tail curves: ${stock['curve-1x2-black']??0}; curved ears use two, low/raised tail one. Family palette can use coat-colored curves. Prefer a stub tail with curved ears. The two eye plates are scarce and reserved. Full-body and lean-body plans can require different structural plate packings. A failed 10-stud plan should explicitly try 8 or 6 studs. Do not choose unsupported coat colors for variety; vary anatomy.`;
}

/** Propose new targets, never alter an allocated target. Bounded neighbors let
 * local stock evidence guide the next planning round instead of another guess. */
export function animalReplanSpecs(spec:AnimalSpec,reason:string):AnimalSpec[]{
 const changes:Partial<AnimalSpec>[]=[];
 if(/cheek|jaw|skull/.test(reason))changes.push({head:'narrow',muzzle:1});
 if(/neck/.test(reason))changes.push({neckHeight:0});
 if(/paw|leg/.test(reason))changes.push({feet:'round',legHeight:3,palette:'family'});
 if(/ear|tail/.test(reason))changes.push({ears:'curved',tail:'stub'},{ears:'alert',tail:'stub'});
 if(/rump/.test(reason))changes.push({back:'sloped'});
 if(/saddle|waist|torso|belly/.test(reason))changes.push({body:'full'},{bodyLength:6},{bodyLength:8});
 changes.push({neckHeight:0},{muzzle:1},{frame:'deep',palette:'family'});
 const seen=new Set([animalShapeKey(spec)]),out:AnimalSpec[]=[];
 for(const change of changes){try{const next=animalSpec({...spec,...change}),key=animalShapeKey(next);if(!seen.has(key)){seen.add(key);out.push(next);}}catch{/* Not every neighbor is compatible with a broad head or round foot. */}if(out.length===3)break;}
 return out;
}
