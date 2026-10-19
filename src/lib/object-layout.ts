import { COLOR_NAMES, footprint, parsePartId, type Build, type ColorName, type PartType, type Placed } from './bricks';
import { isMade } from './catalog';
import { attachPart, attachmentTwist, compileConnections, connectionPairs, frame, type Box, type ConnectionOperation, type ConnectionProgram, type V3 } from './connections';
import { constructionIssues } from './construction';
import { packRegion, type PackingRegion } from './robot-module-layout';

/** Geometry is chosen before stock allocation. These are parameterized assembly
 * grammars, not finished builds. Allocation can replace a solid with smaller
 * bricks/plate laminations, but cannot move its boundary or invent a part. */
export type ObjectFamily='boat'|'robot-bust';
export type ObjectSpec=
 | {family:'boat';length:8|10|12;cabinLength:2|4;cabinPosition:'aft'|'center';roof:'flat'|'sloped'}
 | {family:'robot-bust';shoulderWidth:6|8;torsoHeight:6|9;neckHeight:1|3;face:'eyes'|'visor'};
type Material='shell'|'frame'|'glass'|'visor'|'eye';
interface Common {id:string;role:string;feature:string;material:Material;pair?:string;mirror?:boolean}
export type LayoutRegion=Common&(
 | {kind:'fill';x:number;y:number;z:number}&PackingRegion
 | {kind:'fixed';poses:Placed[];materials:Material[]}
);
export interface ObjectTarget {version:1;spec:ObjectSpec;regions:LayoutRegion[];links:[string,string][];sharedSupports:Record<string,string[]>;description:string}
export interface ObjectContract {target:ObjectTarget;assignment:string[];anchor:V3}
export interface ObjectCandidate {target:ObjectTarget;build:Build;program:ConnectionProgram;contract:ObjectContract;remaining:Record<string,number>;parts:number}
const EPS=.01;
export function objectFamily(name:string):ObjectFamily|null {
 if(/\b(robot|mech|android|droid)\b/i.test(name)&&/\bbust\b/i.test(name))return 'robot-bust';
 if(/\b(boat|ship|launch|tugboat|yacht)\b/i.test(name))return 'boat';
 return null;
}
export const objectPlanSchema=(family:ObjectFamily)=>({type:'OBJECT',required:family==='boat'?['length','cabinLength','cabinPosition','roof','reason']:['shoulderWidth','torsoHeight','neckHeight','face','reason'],properties:family==='boat'?{
 length:{type:'INTEGER'},cabinLength:{type:'INTEGER'},cabinPosition:{type:'STRING',enum:['aft','center']},roof:{type:'STRING',enum:['flat','sloped']},reason:{type:'STRING'},
 }:{shoulderWidth:{type:'INTEGER'},torsoHeight:{type:'INTEGER'},neckHeight:{type:'INTEGER'},face:{type:'STRING',enum:['eyes','visor']},reason:{type:'STRING'}}});
export function objectSpec(family:ObjectFamily,raw:unknown):ObjectSpec {
 if(!['boat','robot-bust'].includes(family))throw Error('Unsupported whole-object family.');
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Choose numeric whole-object dimensions.');
 const r=raw as Record<string,unknown>,options=family==='boat'?{length:[8,10,12],cabinLength:[2,4],cabinPosition:['aft','center'],roof:['flat','sloped']}:{shoulderWidth:[6,8],torsoHeight:[6,9],neckHeight:[1,3],face:['eyes','visor']};
 for(const [key,values] of Object.entries(options))if(!(values as unknown[]).includes(r[key]))throw Error(`Layout ${key} must be ${values.join(' or ')}.`);
 return {family,...Object.fromEntries(Object.keys(options).map(k=>[k,r[k]]))} as ObjectSpec;
}
export const OBJECT_LAYOUT_BRIEF=`Choose the WHOLE shape before bricks are allocated. Dimensions are studs in x/y and plates in z (one brick = 3 plates). The compiler freezes every subassembly boundary, symmetry, interface and surface seam. It then searches exact stock for equivalent constructions. It cannot slide parts to make a different shape fit. If allocation fails, explicitly choose a different plan.
Boat: length 8/10/12, cabinLength 2/4, cabinPosition aft/center, roof flat/sloped. Hull beam is 4 studs; the paired sideways bow slopes extend beyond its end. Cabin beam is 2 studs, centered across the hull, with a continuous glazed band. Hull sides are continuous two-stud panels; an open aft deck remains. Flat roofs need tiles; sloped roofs need additional 2x2 slopes. Longer boats need more shell panels and structural plates. The length runs along +x, bow at +x.
Robot bust: shoulderWidth 6/8, torsoHeight 6/9 plates, neckHeight 1/3 plates, face eyes/visor. Centered head and neck, paired outward-sloping shoulders and tapered chest, a narrower abdomen and a low display support. Eyes require two matching 1x1 round tiles on one dark plate-2x2 plus one dark tile-1x2 for the mouth. A visor requires one dark tile-2x2: a tile-1x2 cannot substitute. The compact head is fixed at 2 studs wide. Width 8 needs more shoulder structure. No arms or legs are requested.
These families currently require actual brackets and two-stud shell faces. Do not select a plan that assumes missing shaping parts. Twenty to sixty purposeful pieces, including every hidden support. A construction pass is still only a draft until the independent image review passes.`;

const union=(boxes:Box[]):Box=>({min:[0,1,2].map(a=>Math.min(...boxes.map(b=>b.min[a]))) as V3,max:[0,1,2].map(a=>Math.max(...boxes.map(b=>b.max[a]))) as V3});
const bounds=(r:LayoutRegion):Box=>r.kind==='fixed'?union(r.poses.map(p=>frame(p).bounds)):{min:[r.x*20,r.y*20,r.z*8],max:[(r.x+r.w)*20,(r.y+r.d)*20,(r.z+r.h)*8]};
const count=(parts:Placed[])=>{const used:Record<string,number>={};for(const p of parts)used[p.partId]=(used[p.partId]??0)+1;return used;};
const layoutKey=(parts:Placed[])=>parts.map(p=>JSON.stringify(p)).sort().join('|');

export function createObjectTarget(input:ObjectSpec):ObjectTarget {
 const s=objectSpec(input.family,input),regions:LayoutRegion[]=[],links:[string,string][]=[];
 const fill=(id:string,role:string,feature:string,x:number,y:number,z:number,w:number,d:number,h:number,material:Material,types:PartType[]=['brick','plate'],extra:Partial<PackingRegion&Common>={})=>regions.push({kind:'fill',id,role,feature,x,y,z,w,d,h,material,types,...extra});
 // Prototype frames describe geometry only; no prototype color is allocated.
 const surface=(id:string,role:string,feature:string,x:number,y:number,z:number,port:string,turn:number,type:'tile'|'plate'|'slope',faceTurn:number,material:Material,pair?:string)=>{
  const host:Placed={partId:'brick-2x2-white',x,y,z,rot:0};
  const mount=attachPart(host,port,'bracket-1x2-light-gray','grip:0:0',turn);
  const grip=faceTurn===90?'grip:0:1':faceTurn===-90?'grip:1:0':'grip:0:0';
  const face=attachPart(mount,'side:0',`${type}-2x2-white`,grip,faceTurn);
  regions.push({kind:'fixed',id,role,feature,poses:[mount,face],materials:['frame',material],material,pair});return face;
 };
 const edgeCap=(id:string,role:string,face:Placed,pair:string)=>regions.push({kind:'fixed',id,role,feature:'Smooth edge of tapered surface',poses:[attachPart(face,'stud:0:1','tile-1x2-white','grip:0:0',0)],materials:['shell'],material:'shell',pair});
 if(s.family==='boat'){
  const L=s.length,c=s.cabinLength,cx=s.cabinPosition==='aft'?2:Math.min(L-2-c,Math.floor((L-c)/2));
  fill('keel','hull','Interlocked hull foundation',0,0,0,L,4,1,'frame',['plate']);
  fill('hull','hull','Continuous hull core',0,0,1,L-2,4,3,'shell');
  fill('bow-core','bow','Connected bow backing',L-2,0,1,2,4,3,'shell');
  for(let x=0;x<L;x+=2){
   const role=x===L-2?'bow':'hull';
   surface(`port-${x}`,role,'Continuous port shell',x,0,1,'stud:0:0',0,'tile',0,'shell',`side-${x}`);
   surface(`starboard-${x}`,role,'Continuous starboard shell',x,2,1,'stud:1:1',180,'tile',0,'shell',`side-${x}`);
  }
  // Turn the bow mounts above the final side mounts, with a central plate
  // completing the support plane. Co-planar perpendicular brackets collide;
  // omitting the final side panels instead leaves a two-stud visual gap.
  fill('bow-support','bow','Shared support plane at the hull corner',L-2,1,4,2,2,1,'shell',['plate']);
  edgeCap('bow-cap-port','bow',surface('bow-port','bow','Port half of tapered bow',L-2,0,2,'stud:1:0',90,'slope',-90,'shell','bow'),'bow-caps');
  edgeCap('bow-cap-starboard','bow',surface('bow-starboard','bow','Starboard half of tapered bow',L-2,2,2,'stud:1:0',90,'slope',90,'shell','bow'),'bow-caps');
  fill('deck','hull','Continuous level deck',0,0,5,L-2,4,1,'shell',['plate']);
  fill('foredeck','bow','Closed foredeck behind bow',L-2,0,5,1,4,1,'shell',['tile']);
  fill('cabin-sill','cabin','Raised cabin window sill',cx,1,6,c,2,1,'shell',['plate']);
  fill('cabin','cabin','Centered glazed cabin',cx,1,7,c,2,3,'glass',['brick']);
  // The sill ties the glazed walls together, so the roof can finish directly
  // onto their studs without spending another scarce structural plate layer.
  fill('roof-finish','cabin','Finished roof profile',cx,1,10,c,2,s.roof==='flat'?1:3,'shell',s.roof==='flat'?['tile']:['slope'],{rotations:[90]});
  // The aft deck and foredeck remain readable open areas, not unused filler.
  fill('aft-deck','hull','Smooth open aft deck',0,0,6,2,4,1,'shell',['tile']);
  links.push(['hull','bow'],['hull','cabin']);
 }else{
  const W=s.shoulderWidth,x=(W-4)/2,h=s.torsoHeight,chest=4+h-3,top=4+h+1,neck=top+1,head=neck+s.neckHeight,hx=(W-2)/2;
  fill('stand','support','Low display base',x,0,0,4,2,1,'frame',['plate']);
  fill('plinth','support','Recessed display support',hx,0,1,2,2,3,'frame',['brick']);
  fill('abdomen','torso','Narrow abdomen',x,0,4,4,2,h-3,'shell');
  fill('chest','torso','Chest backing',x,0,chest,4,2,3,'shell');
  edgeCap('chest-cap-left','torso',surface('chest-left','torso','Left tapered breastplate',x,0,chest,'stud:0:0',0,'slope',-90,'shell','chest'),'chest-caps');
  edgeCap('chest-cap-right','torso',surface('chest-right','torso','Right tapered breastplate',x+2,0,chest,'stud:0:0',0,'slope',90,'shell','chest'),'chest-caps');
  surface('back-left','torso','Left finished back',x,0,chest,'stud:1:1',180,'tile',0,'shell','back');
  surface('back-right','torso','Right finished back',x+2,0,chest,'stud:1:1',180,'tile',0,'shell','back');
  fill('shoulder-tie','torso','Aligned shoulder beam',0,0,top,W,2,1,'shell',['plate']);
  fill('shoulder-left','torso','Outward sloping left shoulder',0,0,neck,2,2,3,'shell',['slope'],{rotations:[270],pair:'shoulders'});
  fill('shoulder-right','torso','Outward sloping right shoulder',W-2,0,neck,2,2,3,'shell',['slope'],{rotations:[90],pair:'shoulders',mirror:true});
  fill('neck','neck','Short centered neck',hx,0,neck,2,2,s.neckHeight,'visor',s.neckHeight===1?['plate']:['roundbrick','brick']);
  fill('head','head','Compact centered head',hx,0,head,2,2,3,'shell',['brick']);
  const face=surface('face','head',s.face==='eyes'?'Dark eye and mouth mounting face':'Recessed visor',hx,0,head,'stud:0:0',0,s.face==='eyes'?'plate':'tile',0,'visor');
  surface('head-back','head','Closed head casing',hx,0,head,'stud:1:1',180,'tile',0,'shell');
  fill('head-cap','head','Head roof tie',hx,0,head+4,2,2,1,'shell',['plate']);
  fill('crown','head','Smooth crown',hx,0,head+5,2,2,1,'shell',['tile']);
  if(s.face==='eyes'){
   for(const i of [0,1])regions.push({kind:'fixed',id:`eye-${i}`,role:'head',feature:'Paired readable eye',material:'eye',materials:['eye'],pair:'eyes',poses:[attachPart(face,`stud:${i}:1`,'roundtile-1x1-white','grip:0:0',0)]});
   regions.push({kind:'fixed',id:'mouth',role:'head',feature:'Inset mouth line',material:'visor',materials:['visor'],poses:[attachPart(face,'stud:0:0','tile-1x2-black','grip:0:0',0)]});
  }
  links.push(['support','torso'],['torso','neck'],['neck','head']);
 }
 return {version:1,spec:s,regions,links,sharedSupports:s.family==='boat'?{bow:['keel']}:{},description:s.family==='boat'?'A tapered launch with continuous hull sides, a centered glazed cabin and an open aft deck.':'A robot bust with a shaped breastplate, mirrored shoulders, short neck and centered expressive head.'};
}

const palettes:Record<Material,ColorName[]>={shell:['white','light-gray','tan','dark-gray','medium-blue',...COLOR_NAMES.filter(c=>!c.startsWith('trans-'))],frame:['black','dark-gray','light-gray','white',...COLOR_NAMES.filter(c=>!c.startsWith('trans-'))],glass:['trans-clear','trans-light-blue','trans-black','black','dark-blue'] as ColorName[],visor:['black','dark-blue','dark-gray'],eye:['white','yellow','trans-light-blue','trans-red'] as ColorName[]};
type Tagged=Placed&{region:string};
type Allocation={parts:Placed[];cost:number};
function allocations(r:LayoutRegion,stock:Record<string,number>,copies:number):Allocation[]{
 if(r.kind==='fill'){
  const choices=packRegion(r,stock,copies,[...new Set(palettes[r.material])],8);
  // Equivalent rectangular tilings need staggered seams. A large plate at the
  // opposite end can bridge a module joint that an equally valid packing misses.
  const canReflect=r.types.every(t=>['brick','plate','tile'].includes(t));
  const seen=new Set<string>();
  return choices.flatMap(p=>[{cost:p.cost,parts:p.parts},...(canReflect?[{cost:p.cost+.001,parts:p.parts.map(q=>({...q,x:r.w-q.x-footprint(parsePartId(q.partId)!,q.rot).fw}))}]:[])]).filter(a=>{const key=layoutKey(a.parts);if(seen.has(key))return false;seen.add(key);return true;});
 }
 let states:Allocation[]=[{parts:[],cost:0}];
 for(const [i,pose] of r.poses.entries()){
  const kind=parsePartId(pose.partId)!,palette=palettes[r.materials[i]];
  const ids=Object.keys(stock).filter(id=>{const k=parsePartId(id);return k&&k.type===kind.type&&k.w===kind.w&&k.d===kind.d&&stock[id]>=copies&&isMade(id)&&palette.includes(k.color);}).sort((a,b)=>palette.indexOf(parsePartId(a)!.color)-palette.indexOf(parsePartId(b)!.color));
  states=states.flatMap(s=>ids.map(id=>({parts:[...s.parts,{...pose,partId:id}],cost:s.cost+2+palette.indexOf(parsePartId(id)!.color)*.28}))).filter(s=>Object.entries(count(s.parts)).every(([id,n])=>stock[id]>=n*copies)).slice(0,12);
 }
 return states;
}
function place(r:LayoutRegion,a:Allocation):Tagged[]{
 if(r.kind==='fixed')return r.poses.map((p,i)=>({...p,partId:a.parts[i].partId,region:r.id}));
 return a.parts.map(p=>({...p,x:r.x+(r.mirror?r.w-p.x-footprint(parsePartId(p.partId)!,p.rot).fw:p.x),y:r.y+p.y,z:r.z+p.z,rot:r.mirror?(360-p.rot)%360:p.rot,region:r.id}));
}

/** Turn a completed geometric allocation into legal assembly order. Every named
 * interface must mate; no search is allowed to slide a module out of its target. */
function compileLayout(parts:Tagged[],target:ObjectTarget,stock:Record<string,number>):ObjectCandidate {
 const frames=parts.map(frame),root=parts.findIndex(p=>!p.orientation&&Math.abs(p.z)<EPS);
 if(root<0)throw Error('Layout has no upright grounded starting part.');
 const order=[root],seen=new Set(order),operations:ConnectionOperation[]=[{partId:parts[root].partId,parent:-1,parentPort:'',childPort:'',twist:0}];
 while(order.length<parts.length){let found=false;
  for(let j=0;j<parts.length&&!found;j++)if(!seen.has(j))for(let parent=0;parent<order.length&&!found;parent++){
   for(const [parentPort,childPort] of connectionPairs(frames[order[parent]],frames[j])){
    const twist=attachmentTwist(parts[order[parent]],parentPort,parts[j],childPort);if(twist===null)continue;
    operations.push({partId:parts[j].partId,parent,parentPort,childPort,twist});order.push(j);seen.add(j);found=true;break;
   }
  }
  if(!found)throw Error('No connected allocation across the planned seams: '+[...new Set(parts.filter((_,i)=>!seen.has(i)).map(p=>p.region))].join(', ')+'.');
 }
 const contacts=order.flatMap((j,b)=>order.slice(0,b).flatMap((k,a)=>connectionPairs(frames[k],frames[j]).map(([aPort,bPort])=>({a,b,aPort,bPort}))));
 // Preserve both bracket-face contacts. Other connections are revalidated from geometry.
 const requiredContacts=contacts.filter(c=>parsePartId(parts[order[c.a]].partId)!.type==='bracket'&&c.aPort.startsWith('side:')||parsePartId(parts[order[c.b]].partId)!.type==='bracket'&&c.bPort.startsWith('side:'));
 const program:ConnectionProgram={name:target.spec.family==='boat'?'Coastal launch':'Survey robot bust',description:target.description,rootRotation:parts[root].rot,operations,requiredContacts};
 const build=compileConnections(program,stock),assignment=order.map(i=>parts[i].region),anchor:V3=[parts[root].x*20,parts[root].y*20,parts[root].z*8];
 const contract={target,assignment,anchor},issues=objectLayoutIssues(build,contract);
 if(issues.length)throw Error(issues.join('; '));
 if(parts.length<20||parts.length>60)throw Error(`Layout needs ${parts.length} pieces; a finished subject needs 20–60.`);
 build.steps.forEach((step,i)=>{step.caption=`${target.regions.find(r=>r.id===assignment[i])!.feature}. ${step.caption}`;});
 const remaining={...stock};for(const [id,n]of Object.entries(count(parts)))remaining[id]-=n;
 return {target,build,program,contract,remaining,parts:parts.length};
}

/** All regions share one inventory. Scarce matched surfaces are reserved before
 * interchangeable structure. Beam states keep different seam patterns. */
export function solveObjectTarget(stock:Record<string,number>,target:ObjectTarget,diagnostics:string[]=[],limit=3):ObjectCandidate[]{
 if(JSON.stringify(createObjectTarget(target.spec))!==JSON.stringify(target))throw Error('The frozen whole-object target was altered.');
 stock=Object.fromEntries(Object.entries(stock).filter(([id,n])=>Number.isSafeInteger(n)&&n>0&&parsePartId(id)&&isMade(id)));
 const groups:LayoutRegion[][]=[];
 for(const r of target.regions){const group=r.pair&&groups.find(g=>g[0].pair===r.pair);if(group)group.push(r);else groups.push([r]);}
 const initial=new Map(groups.map(g=>[g,allocations(g[0],stock,g.length)]));
 for(const [g,a] of initial)if(!a.length){diagnostics.push(`Missing stock for ${g[0].feature}${g.length>1?' as a matching pair':''}.`);return [];}
 groups.sort((a,b)=>Number(b[0].kind==='fixed')-Number(a[0].kind==='fixed')||initial.get(a)!.length-initial.get(b)!.length);
 type State={parts:Tagged[];left:Record<string,number>;cost:number};let states:State[]=[{parts:[],left:{...stock},cost:0}];
 const cache=new Map<string,Allocation[]>(),deadline=performance.now()+12000;
 for(const group of groups){
  const next:State[]=[];
  for(const state of states){
   if(performance.now()>deadline){diagnostics.push('Whole-object allocation reached its 12-second budget.');return [];}
   const key=JSON.stringify([group[0].id,state.left]);let options=cache.get(key);if(!options){options=allocations(group[0],state.left,group.length);cache.set(key,options);}
   for(const option of options){const placed=group.flatMap(r=>place(r,option)),left={...state.left};for(const [id,n]of Object.entries(count(placed)))left[id]-=n;
    if(Object.values(left).some(n=>n<0)||state.parts.length+placed.length>60)continue;
    next.push({parts:[...state.parts,...placed],left,cost:state.cost+option.cost*group.length});
   }
  }
  if(!next.length){diagnostics.push(`Shared stock runs out at ${group[0].feature}. Choose a smaller layout or different profile.`);return [];}
  const seen=new Set<string>(),ranked=next.sort((a,b)=>a.cost-b.cost).filter(s=>{const key=layoutKey(s.parts);if(seen.has(key))return false;seen.add(key);return true;});
  // Preserve distinct foundation seams across later palette/packing choices.
  // Otherwise cheap variants can evict the one plate arrangement that bridges
  // the next module, before that module has even been allocated.
  const foundations=new Set<string>(),diverse:State[]=[],rest:State[]=[];
  for(const state of ranked){const key=layoutKey(state.parts.filter(p=>p.z===0));if(foundations.has(key))rest.push(state);else{foundations.add(key);diverse.push(state);}}
  states=[...diverse,...rest].slice(0,32);
 }
 const result:ObjectCandidate[]=[];
 for(const state of states){try{result.push(compileLayout(state.parts,target,stock));if(result.length>=limit)break;}catch(e){const m=(e as Error).message;if(!diagnostics.includes(m))diagnostics.push(m);}}
 return result;
}

/** Independent of program parent choices. Check frozen region occupancy, exact
 * surface poses, semantic interfaces and connected whole subassemblies. */
export function objectLayoutIssues(build:Build,contract:ObjectContract):string[]{
 const {target,assignment,anchor}=contract,parts=build.steps.flatMap(s=>s.parts),issues:string[]=[];
 if(!parts.length||parts.length!==assignment.length)return ['Whole-object assignment does not match the pieces.'];
 if(JSON.stringify(createObjectTarget(target.spec))!==JSON.stringify(target))return ['The frozen whole-object target was altered.'];
 const origin=frame(parts[0]).bounds.min,shift=origin.map((n,i)=>n-anchor[i]) as V3;
 const frames=parts.map(frame),byRegion=new Map<string,number[]>();
 parts.forEach((_,i)=>{const indexes=byRegion.get(assignment[i])??[];indexes.push(i);byRegion.set(assignment[i],indexes);});
 if(assignment.some(id=>!target.regions.some(r=>r.id===id)))return ['A piece has no planned subassembly region.'];
 for(const r of target.regions){
  const indexes=byRegion.get(r.id)??[],box=bounds(r);
  if(!indexes.length){issues.push(`${r.feature}: missing.`);continue;}
  for(const i of indexes){const b=frames[i].bounds;if([0,1,2].some(a=>b.min[a]-shift[a]<box.min[a]-EPS||b.max[a]-shift[a]>box.max[a]+EPS))issues.push(`${r.feature}: piece leaves its frozen space.`);}
  if(r.kind==='fixed'){
   const unmatched=[...indexes];
   for(const [j,p] of r.poses.entries()){const expected=frame(p),k=parsePartId(p.partId)!;
    const at=unmatched.findIndex(i=>{const actual=parsePartId(parts[i].partId)!;return actual.type===k.type&&actual.w===k.w&&actual.d===k.d&&[0,1,2].every(a=>Math.abs(frames[i].translation[a]-shift[a]-expected.translation[a])<EPS)&&frames[i].rotation.every((v,j)=>Math.abs(v-expected.rotation[j])<EPS);});
    if(at<0)issues.push(`${r.feature}: the required shaped face or seam changed.`);else{if(!palettes[r.materials[j]].includes(parsePartId(parts[unmatched[at]].partId)!.color))issues.push(`${r.feature}: material contrast changed.`);unmatched.splice(at,1);}
   }
   if(unmatched.length)issues.push(`${r.feature}: unplanned extra pieces.`);
  }else{
   let volume=0;
   for(const i of indexes){const k=parsePartId(parts[i].partId)!,b=frames[i].bounds;
    if(!r.types.includes(k.type))issues.push(`${r.feature}: required profile is missing.`);
    if(!palettes[r.material].includes(k.color))issues.push(`${r.feature}: material contrast changed.`);
    if(r.rotations&&!r.rotations.some(rot=>frame({...parts[i],orientation:undefined,rot}).rotation.every((v,j)=>Math.abs(v-frames[i].rotation[j])<EPS)))issues.push(`${r.feature}: profile points the wrong way.`);
    volume+=(b.max[0]-b.min[0])*(b.max[1]-b.min[1])*(b.max[2]-b.min[2]);
   }
   if(Math.abs(volume-r.w*r.d*r.h*20*20*8)>EPS)issues.push(`${r.feature}: gap or excess material in the planned region.`);
  }
 }
 for(const pair of new Set(target.regions.flatMap(r=>r.pair?[r.pair]:[]))){
  const groups=target.regions.filter(r=>r.pair===pair).map(r=>(byRegion.get(r.id)??[]).map(i=>parts[i].partId).sort().join(','));
  if(groups.some(g=>g!==groups[0]))issues.push(`${pair}: mirrored regions must keep their matched shapes and palette.`);
 }
 const roles=[...new Set(target.regions.map(r=>r.role))],members=(role:string)=>parts.flatMap((_,i)=>target.regions.find(r=>r.id===assignment[i])!.role===role?[i]:[]);
 for(const role of roles){
  // The bow shares the continuous keel with the hull. That named interface can
  // tie two smaller backing bricks together; it is charged exactly once.
  const support=parts.flatMap((_,i)=>(target.sharedSupports[role]??[]).includes(assignment[i])?[i]:[]);
  const owned=members(role),allowed=[...owned,...support],seen=new Set<number>();
  const visit=(i:number)=>{if(seen.has(i))return;seen.add(i);for(const j of allowed)if(!seen.has(j)&&connectionPairs(frames[i],frames[j]).length)visit(j);};
  if(owned.length)visit(owned[0]);
  if(owned.some(i=>!seen.has(i)))issues.push(`${role}: pieces must form a connected subassembly.`);
 }
 for(const [a,b]of target.links)if(!members(a).some(i=>members(b).some(j=>connectionPairs(frames[i],frames[j]).length)))issues.push(`${a} must connect directly to ${b} at its planned interface.`);
 // Nominal geometry validation handles overlaps/ports; stock remains the caller's
 // real inventory, never the counts reconstructed here.
 if(constructionIssues(build,count(parts),24).length)issues.push('Layout has invalid physical geometry.');
 return [...new Set(issues)];
}
