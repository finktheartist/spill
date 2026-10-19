import { CATALOG, bottomCells, footprint, heightOf, parsePartId, studCells, voxels, type Build, type Issue, type PartKind, type Placed } from './bricks';
import { curvedPart } from './curved-parts';
import { specialMold } from './special-mold-geometry';
import {connectorMold} from './connector-mold-geometry';
import {popularMold,popularType} from './popular-molds';
import {moldUseText,MOLD_USE_BOUNDARY} from './mold-use-guidance';
import type {MoldPrism,MoldHull} from './popular-mold-types';

/** World axes: x right, y back, z up. One stud = 20 LDU; one plate = 8 LDU.
 * Matrices are row-major, right-handed rigid rotations. Placement coordinates remain
 * the body AABB minimum, in legacy stud/plate units. Stud protrusions mate into sockets.
 */
export type V3 = [number,number,number];
export type Rotation = [number,number,number,number,number,number,number,number,number];
export const IDENTITY:Rotation=[1,0,0,0,1,0,0,0,1];
export const CONNECTION_TYPES=['headlight','invertedbracket','offsetplate','roundjumper','sidebrick','sidebricktall','sidebrickadjacent','sidebrickall','jumper','bracket'] as const;
export const connectionOnly=(k:PartKind)=>popularType(k.type)||CONNECTION_TYPES.some(t=>t===k.type);
export const spatial=(b:Build)=>b.engine==='connections-v2';
export const add=(a:V3,b:V3):V3=>a.map((n,i)=>n+b[i]) as V3;
export const sub=(a:V3,b:V3):V3=>a.map((n,i)=>n-b[i]) as V3;
export const scale=(a:V3,n:number):V3=>a.map(v=>v*n) as V3;
export const dot=(a:V3,b:V3)=>a.reduce((n,v,i)=>n+v*b[i],0);
export const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(a:V3):V3=>scale(a,1/Math.hypot(...a));
export const apply=(r:Rotation,v:V3):V3=>[dot(r.slice(0,3) as V3,v),dot(r.slice(3,6) as V3,v),dot(r.slice(6,9) as V3,v)];
export function multiply(a:Rotation,b:Rotation):Rotation{return Array.from({length:9},(_,i)=>[0,1,2].reduce((v,k)=>v+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0)) as Rotation;}
const clean=(n:number)=>Math.abs(n)<1e-9?0:Math.abs(n-Math.round(n))<1e-9?Math.round(n):n;
export function axisAngle(axis:V3,degrees:number):Rotation {
 const [x,y,z]=norm(axis),a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),t=1-c;
 return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c].map(clean) as Rotation;
}
export function validRotation(r:unknown):r is Rotation {
 if(!Array.isArray(r)||r.length!==9||!r.every(Number.isFinite))return false;
 const rows=[r.slice(0,3),r.slice(3,6),r.slice(6,9)] as V3[];
 return rows.every((v,i)=>Math.abs(dot(v,v)-1)<1e-6&&rows.slice(i+1).every(w=>Math.abs(dot(v,w))<1e-6))&&Math.abs(dot(rows[0],cross(rows[1],rows[2]))-1)<1e-6;
}
export interface Connector {id:string;kind:'stud'|'grip';point:V3;normal:V3}
export interface Box {min:V3;max:V3}
export interface Convex {points:V3[];normals:V3[];edges:V3[]}
export interface Definition {boxes:Box[];ports:Connector[];convex?:Convex[]}
const box=(x:number,y:number,z:number,w:number,d:number,h:number):Box=>({min:[x,y,z],max:[x+w,y+d,z+h]});
const port=(id:string,kind:Connector['kind'],point:V3,normal:V3):Connector=>({id,kind,point,normal});
const cache=new Map<string,Definition>();
/** Nominal outer solids, not clutch/strength simulation. Verified curved molds
 * share source-facet profiles and stepped sockets with rendering. Interior
 * cavities remain conservative; round parts retain their nominal boxes. */
export function definition(k:PartKind):Definition {
 if(k.type==='wheel'||k.type==='wheels'||!CATALOG[k.type]?.includes(`${k.w}x${k.d}`))throw Error('Part shape is outside the connection catalog');
 const key=`${k.type}-${k.w}x${k.d}`;if(cache.has(key))return cache.get(key)!;
 const {fw,fd}=footprint(k,0),W=fw*20,D=fd*20,H=heightOf(k)*8;
 const curve=curvedPart(k);
 const mold=specialMold(k);
 const connector=connectorMold(k);
 const popular=popularMold(k);
 let boxes:Box[]=[box(0,0,0,W,D,H)],ports:Connector[]=[];
 if(popular){
  ports=popular.ports.map(p=>({id:p.id,kind:p.kind,point:[...p.point] as V3,normal:[...p.normal] as V3}));
 }else if(connector){
  boxes=connector.boxes.map(b=>({min:[...b.min] as V3,max:[...b.max] as V3}));
  ports=connector.ports.map(p=>({...p,point:[...p.point] as V3,normal:[...p.normal] as V3}));
 }else if(mold){
  ports=[...mold.studs.map(g=>port(g.id,'stud',[...g.point] as V3,[0,0,1])),...mold.grips.map(g=>port(g.id,'grip',[...g.point] as V3,[0,0,-1]))];
 }else if(curve){
  ports=curve.grips.map(g=>port(g.id,'grip',[...g.point] as V3,[0,0,-1]));
 }else if(k.type==='bracket'){
  // 99781: body from LDraw x[-20,20], y[0,20], z[-14,10].
  boxes=[box(0,0,0,40,4,20),box(0,4,12,40,20,8)];
  for(const x of [10,30]){
   ports.push(port(`stud:${x===10?0:1}:0`,'stud',[x,14,20],[0,0,1]),port(`grip:${x===10?0:1}:0`,'grip',[x,14,12],[0,0,-1]),port(`side:${x===10?0:1}`,'stud',[x,0,10],[0,-1,0]));
  }
 }else if(k.type==='jumper'){
  ports=[port('stud:center','stud',[W/2,D/2,8],[0,0,1])];
  for(let x=0;x<fw;x++)for(let y=0;y<fd;y++)ports.push(port(`grip:${x}:${y}`,'grip',[20*x+10,20*y+10,0],[0,0,-1]));
 }else{
  const p={partId:k.partId,x:0,y:0,z:0,rot:0};
  const baseKind=k; // Side-stud variants retain their own footprint and height.
  ports=[...studCells(baseKind,p).map(([x,y])=>port(`stud:${x}:${y}`,'stud',[20*x+10,20*y+10,H],[0,0,1])),...bottomCells(baseKind,p).map(([x,y])=>port(`grip:${x}:${y}`,'grip',[20*x+10,20*y+10,0],[0,0,-1]))];
  if(k.type==='sidebrick')for(let x=0;x<fw;x++)ports.push(port(`side:${x}`,'stud',[20*x+10,0,14],[0,-1,0]));
  if(k.type==='sidebricktall')for(let row=0;row<2;row++)for(let x=0;x<2;x++)ports.push(port(`side:${row*2+x}`,'stud',[20*x+10,0,10+row*20],[0,-1,0]));
  if(k.type==='sidebrickadjacent'||k.type==='sidebrickall'){
   ports.push(port('side:0','stud',[10,0,14],[0,-1,0]),port('side:1','stud',[20,10,14],[1,0,0]));
   if(k.type==='sidebrickall')ports.push(port('side:2','stud',[10,20,14],[0,1,0]),port('side:3','stud',[0,10,14],[-1,0,0]));
  }
  if(['cornerplate','cornerbrick','cornertile','wedgeleft','wedgeright','quarterplate'].includes(k.type))boxes=voxels(k,p).map(([x,y,z])=>box(x*20,y*20,z*8,20,20,8));
 }
 const profile=straightProfile(k);
 const convex=popular?[...popular.solids.map(moldPrism),...(popular.hulls??[]).map(moldHull)]:mold?mold.sections.map(section=>xyPrism(H,section)):curve?curve.sections.map(section=>profilePrism(W,section)):profile?[profilePrism(W,profile)]:undefined;
 const result={boxes,ports,...(convex?{convex}:{})};cache.set(key,result);return result;
}
export const corners=(b:Box):V3[]=>Array.from({length:8},(_,i)=>[i&1?b.max[0]:b.min[0],i&2?b.max[1]:b.min[1],i&4?b.max[2]:b.min[2]]);
/** Extrude a source-qualified convex section without filling its empty corners. */
function moldPrism(p:MoldPrism):Convex {
 const basis=p.axis==='x'?[[1,0,0],[0,1,0],[0,0,1]]:p.axis==='y'?[[0,1,0],[1,0,0],[0,0,1]]:[[0,0,1],[1,0,0],[0,1,0]];
 const [axis,a,b]=basis as [V3,V3,V3];
 const edges=p.polygon.map(([x,y],i)=>{const next=p.polygon[(i+1)%p.polygon.length];return add(scale(a,next[0]-x),scale(b,next[1]-y));});
 return {points:[p.min,p.max].flatMap(t=>p.polygon.map(([x,y])=>add(scale(axis,t),add(scale(a,x),scale(b,y))))),normals:[axis,...edges.map(e=>cross(axis,e))],edges:[axis,...edges]};
}
function moldHull(h:MoldHull):Convex {
 const points=h.points.map(p=>[...p] as V3);
 const edges=h.faces.flatMap(f=>f.map((v,i)=>sub(points[f[(i+1)%f.length]],points[v])));
 const normals=h.faces.map(f=>cross(sub(points[f[1]],points[f[0]]),sub(points[f[2]],points[f[0]])));
 return {points,edges,normals};
}
const bounds=(points:V3[]):Box=>({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))) as V3,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))) as V3});
/** y,z outline in the canonical z-up frame. High/studded row is +y.
 * Outer dimensions checked against locally studied LDraw 3039, 3660a and
 * 54200 (CC BY 4.0; attribution in docs/surface-modules.md). Slopes use a
 * 4-LDU lip. Cheese uses a conservative straight envelope over its rounded
 * corners. Underside cavities are still solid except at mating grips.
 * The renderer consumes the same contour, with no hidden box fill. */
export function straightProfile(k:PartKind):[number,number][]|undefined {
 const D=k.d*20,H=heightOf(k)*8;
 if(k.type==='slope')return [[0,0],[D,0],[D,H],[D-20,H],[0,4]];
 if(k.type==='invslope')return [[0,H-4],[D-20,0],[D,0],[D,H],[0,H]];
 if(k.type==='cheese')return [[0,0],[D,0],[D,H],[0,4]];
}
function profilePrism(width:number,profile:readonly(readonly[number,number])[]):Convex {
 const edges:V3[]=profile.map(([y,z],i)=>{const next=profile[(i+1)%profile.length];return [0,next[0]-y,next[1]-z];});
 return {points:[0,width].flatMap(x=>profile.map(([y,z]):V3=>[x,y,z])),
  normals:[[1,0,0],...edges.map(e=>cross([1,0,0],e))],edges:[[1,0,0],...edges]};
}
function xyPrism(height:number,outline:readonly(readonly[number,number])[]):Convex {
 const edges:V3[]=outline.map(([x,y],i)=>{const next=outline[(i+1)%outline.length];return [next[0]-x,next[1]-y,0];});
 return {points:[0,height].flatMap(z=>outline.map(([x,y]):V3=>[x,y,z])),normals:[[0,0,1],...edges.map(e=>cross([0,0,1],e))],edges:[[0,0,1],...edges]};
}
const boxConvex=(b:Box):Convex=>({points:corners(b),normals:[[1,0,0],[0,1,0],[0,0,1]],edges:[[1,0,0],[0,1,0],[0,0,1]]});
export interface Solid {points:V3[];axes:V3[];edges:V3[];bounds:Box}
/** Convex face planes, rather than an outer box, determine occupied space in sloped parts. */
export function solidContains(s:Solid,p:V3) {
 return s.axes.every(axis=>{const value=dot(p,axis),values=s.points.map(v=>dot(v,axis));return value>=Math.min(...values)-1e-6&&value<=Math.max(...values)+1e-6;});
}
export interface Frame {rotation:Rotation;translation:V3;bounds:Box;ports:Connector[];solids:Solid[];studs:{id:string;solid:Solid}[]}
export function frame(p:Placed):Frame {
 const k=parsePartId(p.partId);if(!k)throw Error('Unknown part '+p.partId);
 if(p.orientation!==undefined&&!validRotation(p.orientation))throw Error('Orientation must be a proper rigid rotation');
 if(!p.orientation&&![0,90,180,270].includes(p.rot))throw Error('Use an orientation matrix for non-quarter turns');
 if(p.orientation&&p.rot!==0)throw Error('Use orientation or rot, never both');
 if(![p.x,p.y,p.z,p.rot].every(Number.isFinite))throw Error('Placement coordinates must be finite');
 const d=definition(k),r=p.orientation??axisAngle([0,0,1],p.rot);
 // Placement remains the nominal body AABB minimum, independent of its hull.
 const extent=bounds(d.boxes.flatMap(b=>corners(b).map(v=>apply(r,v))));
 const t=sub([p.x*20,p.y*20,p.z*8],extent.min);
 const solid=(shape:Convex):Solid=>{const points=shape.points.map(v=>add(apply(r,v),t));return {points,axes:shape.normals.map(v=>apply(r,v)),edges:shape.edges.map(v=>apply(r,v)),bounds:bounds(points)};};
 const studs=d.ports.filter(p=>p.kind==='stud').map(p=>{
  const center=add(p.point,scale(p.normal,1.7)),radius=p.normal.map(n=>Math.abs(n)?1.7:6);
  const b:Box={min:center.map((v,i)=>v-radius[i]) as V3,max:center.map((v,i)=>v+radius[i]) as V3};
  return {id:p.id,solid:solid(boxConvex(b))};
 });
 const solids=(d.convex??d.boxes.map(boxConvex)).map(solid);
 return {rotation:r,translation:t,bounds:bounds(solids.flatMap(s=>s.points)),solids,studs,ports:d.ports.map(c=>({...c,point:add(apply(r,c.point),t),normal:apply(r,c.normal)}))};
}
const EPS=1e-5;
const intersectAabb=(a:Box,b:Box)=>[0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>EPS);
function intersects(a:Frame['solids'][number],b:Frame['solids'][number]){
 if(!intersectAabb(a.bounds,b.bounds))return false;
 const axes=[...a.axes,...b.axes,...a.edges.flatMap(x=>b.edges.map(y=>cross(x,y)))];
 return axes.every(axis=>{
  if(Math.hypot(...axis)<EPS)return true;
  const n=norm(axis),aa=a.points.map(p=>dot(p,n)),bb=b.points.map(p=>dot(p,n));
  return Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))>EPS;
 });
}
export const mating=(a:Connector,b:Connector)=>a.kind!==b.kind&&Math.hypot(...sub(a.point,b.point))<EPS&&dot(a.normal,b.normal)<-1+EPS;
export function connectionPairs(a:Frame,b:Frame){return a.ports.flatMap(x=>b.ports.filter(y=>mating(x,y)).map(y=>[x.id,y.id] as [string,string]));}
/** Additional closure edges required by a construction, beyond its first parent. */
export interface RequiredContact {a:number;b:number;aPort:string;bPort:string}
export function requiredContactIssues(parts:Placed[],contacts:unknown,complete=true):string[]{
 if(contacts===undefined)return [];
 if(!Array.isArray(contacts)||contacts.length>160)return ['Invalid required connection contract.'];
 const issues:string[]=[];
 for(const c of contacts){
  if(!c||!Number.isSafeInteger(c.a)||!Number.isSafeInteger(c.b)||c.a<0||c.b<0||c.a===c.b||c.a>=160||c.b>=160||typeof c.aPort!=='string'||typeof c.bPort!=='string')return ['Invalid required connection contract.'];
  if(c.a>=parts.length||c.b>=parts.length){if(complete)issues.push('A required connection refers to a missing piece.');continue;}
  try{if(!connectionPairs(frame(parts[c.a]),frame(parts[c.b])).some(([a,b])=>a===c.aPort&&b===c.bPort))issues.push(`Required connection between parts ${c.a+1} (${c.aPort}) and ${c.b+1} (${c.bPort}) is missing.`);}
  catch{issues.push('A required connection has an invalid part frame.');}
 }
 return issues;
}
export function validateConnections(build:Build,have:Record<string,number>,width=Infinity):Issue[]{
 const parts=build.steps.flatMap(s=>s.parts),issues:Issue[]=[],frames:(Frame|null)[]=[],used:Record<string,number>={};
 if(parts.length>160)return [{kind:'invalid',message:'Connection builds are limited to 160 parts.',parts:[]}];
 for(const p of parts){
  try{
   const k=parsePartId(p.partId);if(!k||k.type==='wheel'||k.type==='wheels'||!Number.isFinite(p.rot)||Math.abs(p.rot)>360)throw Error('Unsupported connection part or rotation');
   if(![p.x,p.y,p.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000))throw Error('Coordinates outside supported range');
   const f=frame(p);frames.push(f);used[p.partId]=(used[p.partId]??0)+1;
   if(f.bounds.min[2]<-EPS)issues.push({kind:'invalid',message:'Part extends below the ground.',parts:[p]});
   if([0,1].some(i=>f.bounds.min[i]<-EPS||f.bounds.max[i]>width*20+EPS))issues.push({kind:'invalid',message:`Part extends outside the ${width} stud build area.`,parts:[p]});
  }catch(e){frames.push(null);issues.push({kind:'invalid',message:(e as Error).message,parts:[p]});}
 }
 const links=parts.map(()=>new Set<number>()),usedPorts=new Map<string,number>();
 for(let i=0;i<parts.length;i++)for(let j=0;j<i;j++){
  const a=frames[i],b=frames[j];if(!a||!b)continue;
  if(intersectAabb(a.bounds,b.bounds)&&a.solids.some(x=>b.solids.some(y=>intersects(x,y))))issues.push({kind:'overlap',message:`Parts ${j+1} and ${i+1} overlap in 3D.`,parts:[parts[j],parts[i]]});
  const pairs=connectionPairs(a,b);
  // A protruding stud may enter only its matching grip, not a blank face or an offset socket.
  for(const [from,to,index,other,side] of [[a,b,i,j,0],[b,a,j,i,1]] as [Frame,Frame,number,number,number][]){
   for(const stud of from.studs)if(!pairs.some(p=>p[side]===stud.id)&&to.solids.some(s=>intersects(stud.solid,s)))issues.push({kind:'overlap',message:`An unmatched stud on part ${index+1} intersects part ${other+1}.`,parts:[parts[index],parts[other]]});
  }
  if(a.studs.some(x=>b.studs.some(y=>intersects(x.solid,y.solid))))issues.push({kind:'overlap',message:`Studs on parts ${j+1} and ${i+1} intersect.`,parts:[parts[j],parts[i]]});
  for(const [x,y] of pairs){
   links[i].add(j);links[j].add(i);
   for(const [index,id,other] of [[i,x,j],[j,y,i]] as [number,string,number][]){const key=`${index}/${id}`;if(usedPorts.has(key)&&usedPorts.get(key)!==other)issues.push({kind:'invalid',message:'A connector cannot be occupied by two parts.',parts:[parts[index]]});usedPorts.set(key,other);}
  }
 }
 for(const [id,n] of Object.entries(used))if(!Number.isSafeInteger(have[id])||have[id]<n)issues.push({kind:'inventory',message:`Uses ${n} × ${id}, but the bucket has ${have[id]??0}.`,parts:parts.filter(p=>p.partId===id)});
 const ground=frames.flatMap((f,i)=>f&&Math.abs(f.bounds.min[2])<EPS?[i]:[]);
 if(parts.length&&!ground.length)issues.push({kind:'floating',message:'The assembly has no part on the ground.',parts});
 for(let i=0;i<parts.length;i++)if(frames[i]&&!ground.includes(i)&&![...links[i]].some(j=>j<i))issues.push({kind:'floating',message:`Part ${i+1} has no mating connector on an earlier piece.`,parts:[parts[i]]});
 if(parts.length){const reached=new Set<number>(),visit=(i:number)=>{if(reached.has(i))return;reached.add(i);links[i].forEach(visit);};visit(ground[0]??0);const loose=parts.filter((_,i)=>!reached.has(i));if(loose.length)issues.push({kind:'loose',message:'All parts must belong to one connector graph.',parts:loose});}
 issues.push(...requiredContactIssues(parts,build.requiredContacts).map(message=>({kind:'invalid' as const,message,parts:[]})));
 return issues;
}
/** Snap exact connector frames; no nearest-grid rounding and no guessed supports. */
export function attachPart(parent:Placed,parentPort:string,partId:string,childPort:string,twist=0):Placed {
 const pf=frame(parent),a=pf.ports.find(p=>p.id===parentPort),local=definition(parsePartId(parent.partId)!).ports.find(p=>p.id===parentPort),kind=parsePartId(partId),b=kind&&definition(kind).ports.find(p=>p.id===childPort);
 if(!a||!b||a.kind===b.kind)throw Error('Choose compatible existing stud and grip connectors');
 if(!Number.isFinite(twist)||Math.abs(twist)>180)throw Error('Twist must be within -180 to 180 degrees');
 const target=scale(local!.normal,-1),cos=dot(b.normal,target),axis=cross(b.normal,target);
 const align:Rotation=cos>1-EPS?IDENTITY:cos<-1+EPS?axisAngle(Math.abs(b.normal[0])<.9?cross(b.normal,[1,0,0]):cross(b.normal,[0,1,0]),180):axisAngle(axis,Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI);
 const r=multiply(pf.rotation,multiply(axisAngle(local!.normal,twist),align)),t=sub(a.point,apply(r,b.point));
 const extent=bounds(definition(kind!).boxes.flatMap(b=>corners(b).map(v=>add(apply(r,v),t))));
 return {partId,x:clean(extent.min[0]/20),y:clean(extent.min[1]/20),z:clean(extent.min[2]/8),rot:0,orientation:r.map(clean) as Rotation};
}
/** Recover the twist of an already placed rigid module from its mating frames.
 * No rounding to quarter turns: allocation and compilation retain the same pose. */
export function attachmentTwist(parent:Placed,parentPort:string,child:Placed,childPort:string):number|null {
 const pf=frame(parent),cf=frame(child),axis=pf.ports.find(p=>p.id===parentPort)?.normal;
 if(!axis||!connectionPairs(pf,cf).some(([a,b])=>a===parentPort&&b===childPort))return null;
 const zero=frame(attachPart(parent,parentPort,child.partId,childPort,0));
 const basis:V3[]= [[1,0,0],[0,1,0],[0,0,1]];
 const v=basis.find(v=>Math.abs(dot(apply(zero.rotation,v),axis))<.9)!;
 const project=(r:Rotation)=>{const q=apply(r,v);return norm(sub(q,scale(axis,dot(q,axis))));};
 const from=project(zero.rotation),to=project(cf.rotation);
 const twist=clean(Math.atan2(dot(axis,cross(from,to)),dot(from,to))*180/Math.PI);
 const actual=frame(attachPart(parent,parentPort,child.partId,childPort,twist));
 return actual.rotation.every((n,i)=>Math.abs(n-cf.rotation[i])<1e-6)&&actual.translation.every((n,i)=>Math.abs(n-cf.translation[i])<1e-5)?twist:null;
}
export interface ConnectionOperation {partId:string;parent:number;parentPort:string;childPort:string;twist:number}
export interface ConnectionProgram {name:string;description:string;rootRotation?:number;operations:ConnectionOperation[];requiredContacts?:RequiredContact[]}
export function compileConnections(program:ConnectionProgram,have:Record<string,number>):Build {
 if(!program||!Array.isArray(program.operations)||!program.operations.length||program.operations.length>80)throw Error('Provide 1–80 connection operations');
 if(typeof program.name!=='string'||program.name.length>80||typeof program.description!=='string'||program.description.length>1000)throw Error('Provide a short name and description');
 if(![0,90,180,270].includes(program.rootRotation??0))throw Error('Root rotation must be a quarter turn');
 const parts:Placed[]=[],steps:Build['steps']=[];
 program.operations.forEach((op,i)=>{
  if(!op||!parsePartId(op.partId)||!Number.isSafeInteger(have[op.partId])||have[op.partId]<1)throw Error('Every part must be in the actual stock');
  let p:Placed;
  if(!i){if(op.parent!==-1||op.twist!==0)throw Error('Start with one upright root');p={partId:op.partId,x:0,y:0,z:0,rot:program.rootRotation??0};}
  else{if(!Number.isSafeInteger(op.parent)||op.parent<0||op.parent>=i)throw Error('Parent must name an earlier step');p=attachPart(parts[op.parent],op.parentPort,op.partId,op.childPort,op.twist);}
  parts.push(p);steps.push({caption:!i?'Place the first piece flat on the table.':`Attach this piece to the ${op.parentPort.startsWith('side')?'side':'chosen'} connector of the piece from step ${op.parent+1}${op.twist?`, turning it ${op.twist}° around that connection`:''}. Match the orientation in the view.`,parts:[p]});
 });
 const minX=Math.min(...parts.map(p=>p.x)),minY=Math.min(...parts.map(p=>p.y));
 parts.forEach(p=>{p.x=clean(p.x-minX);p.y=clean(p.y-minY);});
 const build:Build={name:program.name,description:program.description,engine:'connections-v2',steps,...(program.requiredContacts!==undefined?{requiredContacts:structuredClone(program.requiredContacts)}:{})};
 const issues=validateConnections(build,have,24);if(issues.length)throw Error(issues.map(i=>i.message).join('\n'));
 return build;
}
export function connectorText(have:Record<string,number>){return Object.entries(have).filter(([id,n])=>n>0&&parsePartId(id)&&!id.startsWith('wheel')).map(([id,n])=>{
 const k=parsePartId(id)!,d=definition(k),extent=bounds(d.boxes.flatMap(corners));
 return `${id} × ${n}: body ${extent.max.join('×')} LDU; ${d.ports.map(p=>`${p.id} (${p.kind}, at ${p.point.join(',')}, normal ${p.normal.join(',')})`).join('; ')}${moldUseText(k)?`; ${moldUseText(k)}`:''}`;
}).join('\n');}

/** Identical colors share geometry. Keep every exact stock ID/count, describe ports once per shape. */
export function connectorShapeText(have:Record<string,number>):string {
 const shapes=new Map<string,ReturnType<typeof parsePartId>>();
 const available=Object.entries(have).filter(([id,n])=>n>0&&parsePartId(id)&&!id.startsWith('wheel'));
 for(const [id]of available){const k=parsePartId(id)!;shapes.set(`${k.type}-${k.w}x${k.d}`,k);}
 const descriptions=[...shapes].map(([shape,k])=>{const d=definition(k!),extent=bounds(d.boxes.flatMap(corners));return `${shape} (all stocked colors): body ${extent.max.join('×')} LDU; ${d.ports.map(p=>`${p.id} (${p.kind}, at ${p.point.join(',')}, normal ${p.normal.join(',')})`).join('; ')}${moldUseText(k!)?`; ${moldUseText(k!)}`:''}`;});
 return `EXACT STOCK (IDs and quantities): ${available.map(([id,n])=>`${id} × ${n}`).join(', ')}\nSHAPE CONNECTORS (same IDs and geometry for every listed color; unlisted colors remain unavailable):\n${descriptions.join('\n')}${[...shapes.values()].some(k=>moldUseText(k!))?`\n${MOLD_USE_BOUNDARY}`:''}`;
}
