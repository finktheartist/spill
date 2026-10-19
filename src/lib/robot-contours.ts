import {parsePartId,heightOf,type PartShape,type Placed} from './bricks';
import {add,apply,axisAngle,corners,frame,type Box,type Rotation,type V3} from './connections';
import {zoneBox,type RobotZone} from './robot-module-shapes';
import {curvedPart} from './curved-parts';

const bounds=(ps:V3[]):Box=>({min:[0,1,2].map(i=>Math.min(...ps.map(p=>p[i]))) as V3,max:[0,1,2].map(i=>Math.max(...ps.map(p=>p[i]))) as V3});
const transformed=(b:Box,r:Rotation,t:V3):Box=>bounds(corners(b).map(p=>add(apply(r,p),t)));
/** Stud-free profile samples in LDU, ignoring tiny cosmetic render seams. */
type Profile='slope'|'cheese'|'curve'|'invslope';
const profiled=(type:string):type is Profile=>['slope','cheese','curve','invslope'].includes(type);
function curveAt(y:number,d:number,h:number){
 let lo=0,hi=1;for(let i=0;i<24;i++){const t=(lo+hi)/2;if(2*(1-t)*t+d*t*t<y)lo=t;else hi=t;}
 const t=(lo+hi)/2;return 1.6*(1-t)*(1-t)+h*(2*t-t*t);
}
function profile(w:number,d:number,h:number,type:Profile):Box[]{
 const boxes:Box[]=[];
 for(let y=0;y<d;y+=2){const end=Math.min(d,y+2),u=(y+end)/2,lip=type==='slope'||type==='invslope'?7.2:1.6,run=type==='slope'||type==='invslope'?d-20:d;
  const bottom=type==='invslope'?(h-lip)*Math.max(0,1-u/run):0;
  const top=type==='invslope'?h:type==='curve'?curveAt(u,d,h):lip+(h-lip)*Math.min(1,u/run);
  boxes.push({min:[0,y,bottom],max:[w,end,top]});}
 return boxes;
}
/** Abstract target profiles may be freely sized. Supported curved mold targets
 * below use source facets; the quadratic is only a fallback for abstract zones. */
function vertices(w:number,d:number,h:number,type:Profile):V3[]{
 let yz:number[][];
 if(type==='invslope')yz=[[0,h-7.2],[d-20,0],[d,0],[d,h],[0,h]];
 else if(type==='curve')yz=[[0,0],[d,0],...Array.from({length:33},(_,i)=>{const t=1-i/32;return [2*(1-t)*t+d*t*t,1.6*(1-t)*(1-t)+h*(2*t-t*t)];})];
 else yz=[[0,0],[d,0],[d,h],...(type==='slope'?[[d-20,h]]:[]),[0,type==='slope'?7.2:1.6]];
 return [0,w].flatMap(x=>yz.map(([y,z])=>[x,y,z] as V3));
}
/** Presentation slices use the same real outline as the physical definition.
 * Slice midpoints approximate its projection; they never decide collision. */
function curveSlices(k:PartShape):Box[]{
 const curve=curvedPart(k);if(!curve)return [];
 const out:Box[]=[],polygon=curve.profile;
 for(let y=0;y<k.d*20;y+=2){
  const end=Math.min(k.d*20,y+2),mid=(y+end)/2,z:number[]=[];
  polygon.forEach(([a,b],i)=>{const [c,d]=polygon[(i+1)%polygon.length];if(a!==c&&mid>=Math.min(a,c)&&mid<Math.max(a,c))z.push(b+(d-b)*(mid-a)/(c-a));});
  if(z.length>=2)out.push({min:[0,y,Math.min(...z)],max:[k.w*20,end,Math.max(...z)]});
 }
 return out;
}
const zoneType=(z:RobotZone)=>z.profile?({ramp:'slope',undercut:'invslope',curve:'curve',chamfer:'cheese'} as const)[z.profile]:z.types.length===1?z.types[0]:undefined;
function zoneFrame(z:RobotZone){
 const b=zoneBox(z),angle=z.rotations?.[0]??0,r=axisAngle([0,0,1],angle),turn=angle===90||angle===270,w=(turn?z.d:z.w)*20,d=(turn?z.w:z.d)*20,h=z.h*8;
 const rotated=transformed({min:[0,0,0],max:[w,d,h]},r,[0,0,0]),t=b.min.map((v,i)=>v-rotated.min[i]) as V3;
 return {w,d,h,r,t};
}
export function targetZoneContours(z:RobotZone):Box[]{
 const type=zoneType(z);if(!type||!profiled(type))return [zoneBox(z)];
 const {w,d,h,r,t}=zoneFrame(z);
 const mold={type:'curve' as const,w:w/20,d:d/20};
 if(type==='curve'&&curvedPart(mold)&&Math.abs(heightOf(mold)*8-h)<1e-6)return curveSlices(mold).map(p=>transformed(p,r,t));
 return profile(w,d,h,type).map(p=>transformed(p,r,t));
}
export function partContours(p:Placed):Box[]{
 const k=parsePartId(p.partId)!,f=frame(p);if(!profiled(k.type))return f.solids.map(s=>s.bounds);
 if(k.type==='curve')return curveSlices(k).map(b=>transformed(b,f.rotation,f.translation));
 return profile(k.w*20,k.d*20,heightOf(k)*8,k.type).map(b=>transformed(b,f.rotation,f.translation));
}
export function targetZoneSurface(z:RobotZone):V3[]{
 const type=zoneType(z);if(!type||!profiled(type))return corners(zoneBox(z));
 const {w,d,h,r,t}=zoneFrame(z),mold={type:'curve' as const,w:w/20,d:d/20},curve=type==='curve'?curvedPart(mold):undefined;
 if(curve&&Math.abs(curve.heightPlates*8-h)<1e-6)return [0,w].flatMap(x=>curve.profile.map(([y,z])=>add(apply(r,[x,y,z]),t)));
 return vertices(w,d,h,type).map(p=>add(apply(r,p),t));
}
export function partSurfaces(p:Placed):V3[][]{
 const k=parsePartId(p.partId)!,f=frame(p),curve=curvedPart(k);
 if(curve)return curve.sections.map(section=>[0,k.w*20].flatMap(x=>section.map(([y,z])=>add(apply(f.rotation,[x,y,z]),f.translation))));
 return profiled(k.type)?[vertices(k.w*20,k.d*20,heightOf(k)*8,k.type).map(v=>add(apply(f.rotation,v),f.translation))]:f.solids.map(s=>s.points);
}
