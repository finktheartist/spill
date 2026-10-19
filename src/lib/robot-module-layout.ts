import { footprint, heightOf, parsePartId, type ColorName, type Placed } from './bricks';
import { connectionPairs, frame } from './connections';
import type { RobotRole } from './robot-body-plan';
import type { RobotMaterial, RobotZone } from './robot-module-shapes';

export type ModulePlaced=Placed&{role:RobotRole;zone:string};
export interface Packing {parts:Placed[];used:Record<string,number>;cost:number}
export type PackingRegion=Pick<RobotZone,'w'|'d'|'h'|'types'|'rotations'|'connected'>;
const colors:Record<RobotMaterial,ColorName[]>={
 shell:['white','light-gray','dark-gray','tan','reddish-brown','medium-blue','dark-blue'],
 frame:['reddish-brown','dark-gray','light-gray','white','black','tan','dark-blue'],
 joint:['dark-gray','black','light-gray','dark-blue','reddish-brown','tan','white','medium-blue'],
 accent:['medium-blue','dark-blue','white','light-gray','tan','medium-nougat','reddish-brown','dark-gray','bright-light-orange','bright-pink'],
 visor:['black','dark-blue','trans-clear','dark-gray'],
};
/** Alternate exact constructions of one region: whole bricks, interlocked smaller
 * bricks, or plate laminations. Stock is shared across every region, never fabricated. */
export function packRegion(zone:PackingRegion,stock:Record<string,number>,copies:number,palette:ColorName[],limit=6):Packing[]{
 const options=Object.entries(stock).flatMap(([id,n])=>{
  const k=parsePartId(id);if(!k||n<copies||!zone.types.includes(k.type)||!palette.includes(k.color))return [];
  const h=heightOf(k);if(h>zone.h)return [];
  return (zone.rotations??[0,90]).flatMap(rot=>{const {fw:w,fd:d}=footprint(k,rot);return !(rot===90&&w===d&&!zone.rotations)&&w<=zone.w&&d<=zone.d&&Number.isInteger(w)&&Number.isInteger(d)?[{id,rot,w,d,h,cost:2+palette.indexOf(k.color)*.28}]:[];});
 }).sort((a,b)=>a.cost/(a.w*a.d*a.h)-b.cost/(b.w*b.d*b.h)||a.cost-b.cost||a.id.localeCompare(b.id));
 const occupied=new Set<number>(),used:Record<string,number>={},parts:Placed[]=[],result:Packing[]=[],seen=new Set<string>();let visits=0;
 const volume=zone.w*zone.d*zone.h;
 function fill(cost:number){
  if(++visits>1600||result.length>=limit)return;
  let cell=0;while(occupied.has(cell))cell++;if(cell===volume){if(zone.connected&&!moduleConnected(parts))return;const key=JSON.stringify(parts);if(!seen.has(key)){seen.add(key);result.push({parts:parts.map(p=>({...p})),used:{...used},cost});}return;}
  const x=cell%zone.w,y=Math.floor(cell/zone.w)%zone.d,z=Math.floor(cell/(zone.w*zone.d));
  for(const o of options){
   if((used[o.id]??0)+copies>stock[o.id]||x+o.w>zone.w||y+o.d>zone.d||z+o.h>zone.h)continue;
   const cells=Array.from({length:o.w*o.d*o.h},(_,i)=>x+i%o.w+zone.w*(y+Math.floor(i/o.w)%o.d)+zone.w*zone.d*(z+Math.floor(i/(o.w*o.d))));if(cells.some(c=>occupied.has(c)))continue;
   used[o.id]=(used[o.id]??0)+copies;cells.forEach(c=>occupied.add(c));parts.push({partId:o.id,x,y,z,rot:o.rot});fill(cost+copies*o.cost);parts.pop();cells.forEach(c=>occupied.delete(c));used[o.id]-=copies;if(!used[o.id])delete used[o.id];
   if(result.length>=limit)break;
  }
 }
 fill(0);return result.sort((a,b)=>a.cost-b.cost);
}
const pack=(zone:RobotZone,stock:Record<string,number>,copies:number)=>packRegion(zone,stock,copies,colors[zone.material]);
export function moduleConnected(parts:Placed[]):boolean{
 const frames=parts.map(frame),seen=new Set<number>();
 function visit(i:number){if(seen.has(i))return;seen.add(i);for(let j=0;j<frames.length;j++)if(!seen.has(j)&&connectionPairs(frames[i],frames[j]).length)visit(j);}
 if(frames.length)visit(0);return seen.size===frames.length;
}
export function allocateRobotModules(stock:Record<string,number>,zones:RobotZone[],diagnostics:string[]):ModulePlaced[][]{
 const groups:RobotZone[][]=[];
 for(const z of zones){const group=z.pair&&groups.find(g=>g[0].pair===z.pair);if(group)group.push(z);else groups.push([z]);}
 // Protect scarce paired shapes and the visor before flexible structural fillers.
 const initial=new Map(groups.map(g=>[g,pack(g[0],stock,g.length)]));
 for(const [g,p]of initial)if(!p.length){diagnostics.push(`Missing a construction for ${g[0].feature} (${g[0].w}×${g[0].d}×${g[0].h}, ${g.length} matching copies).`);return [];}
 groups.sort((a,b)=>initial.get(a)!.length-initial.get(b)!.length||Number(b.length>1)-Number(a.length>1)||Number(b[0].types.length===1)-Number(a[0].types.length===1));
 type State={left:Record<string,number>;parts:ModulePlaced[];cost:number};let states:State[]=[{left:{...stock},parts:[],cost:0}];
 const completed=new Set<string>();const cache=new Map<string,Packing[]>();
 for(const group of groups){
  group.forEach(z=>completed.add(z.id));
  const closed=[...new Set(group.map(z=>z.role))].filter(role=>zones.filter(z=>z.role===role).every(z=>completed.has(z.id)));
  const next:State[]=[];
  for(const state of states){
   const key=JSON.stringify([group[0].id,state.left]);let choices=cache.get(key);if(!choices){choices=pack(group[0],state.left,group.length);cache.set(key,choices);}
   for(const choice of choices){
    const left={...state.left};for(const [id,n]of Object.entries(choice.used))left[id]-=n;
    const parts=[...state.parts,...group.flatMap(zone=>choice.parts.map(p=>{
     const w=footprint(parsePartId(p.partId)!,p.rot).fw;
     return {...p,rot:zone.mirror?(360-p.rot)%360:p.rot,x:zone.x+(zone.mirror?zone.w-p.x-w:p.x),y:zone.y+p.y,z:zone.z+p.z,role:zone.role,zone:zone.id};
    }))];
    if(parts.length>60||closed.some(role=>!moduleConnected(parts.filter(p=>p.role===role))))continue;
    next.push({left,parts,cost:state.cost+choice.cost});
   }
  }
  if(!next.length){diagnostics.push(`No connected stock allocation remains at ${group[0].feature}. Other module choices or more parts are needed.`);return [];}
  // Keep materially different reservations; identical part counts can conceal
  // different seam placements, so geometry is part of the deduplication key.
  const seen=new Set<string>();states=next.sort((a,b)=>a.cost-b.cost).filter(s=>{const k=JSON.stringify(s.parts);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,40);
 }
 return states.map(s=>s.parts);
}
