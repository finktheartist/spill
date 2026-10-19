import type { Build } from './bricks';
import { corners, frame, type V3 } from './connections';
import { unionBounds, type RobotTarget } from './robot-silhouette';
import {partContours,targetZoneContours,partSurfaces,targetZoneSurface} from './robot-contours';

function hull(points:number[][]):number[][]{
 const ps=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=(xs:number[][])=>{const out:number[][]=[];for(const p of xs){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,p)<=0)out.pop();out.push(p);}return out.slice(0,-1);};
 return [...half(ps),...half(ps.slice().reverse())];
}

/** Shape-only orthographic drawings. Called with the target before any Build exists. */
export function renderRobotTarget(target:RobotTarget,build?:Build):string[]{
 const expected=target.version===2?target.zones!.flatMap(targetZoneContours):Object.values(target.volumes).flat();
 const parts=build?.steps.flatMap(s=>s.parts)??[],dx=(parts[0]?.x??0)*20,dy=(parts[0]?.y??0)*20;
 const actual=parts.flatMap(p=>(target.version===2?partContours(p):frame(p).solids.map(s=>s.bounds)).map(b=>({min:[b.min[0]-dx,b.min[1]-dy,b.min[2]] as V3,max:[b.max[0]-dx,b.max[1]-dy,b.max[2]] as V3})));
 const bounds=unionBounds([...expected,...actual]);
 const desiredSurfaces=target.version===2?target.zones!.map(targetZoneSurface):Object.values(target.volumes).flat().map(corners);
 const builtSurfaces=parts.flatMap(p=>target.version===2?partSurfaces(p):frame(p).solids.map(s=>s.points)).map(ps=>ps.map(p=>[p[0]-dx,p[1]-dy,p[2]] as V3));
 return ([0,1] as const).map(axis=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#f3efe6';ctx.fillRect(0,0,640,640);
  const scale=Math.min(520/(bounds.max[axis]-bounds.min[axis]),520/bounds.max[2]);
  const x0=320-(bounds.max[axis]+bounds.min[axis])*scale/2,z0=588;
  const draw=(surfaces:V3[][],color:string)=>{ctx.fillStyle=color;ctx.beginPath();for(const ps of surfaces){const polygon=hull(ps.map(p=>[p[axis],p[2]]));polygon.forEach(([x,z],i)=>{const px=x0+x*scale,pz=z0-z*scale;if(!i)ctx.moveTo(px,pz);else ctx.lineTo(px,pz);});ctx.closePath();}ctx.fill();};
  draw(desiredSurfaces,build?'#accdbd':'#23372e');if(build)draw(builtSurfaces,'#25382ed9');
  ctx.fillStyle='#23372e';ctx.font='22px system-ui';ctx.fillText(axis===0?'Front silhouette':'Side silhouette',32,36);
  ctx.font='14px system-ui';ctx.fillText(build?'Pale green: target · dark: assembled body volumes':'Shape target · no bricks allocated',32,62);
  return canvas.toDataURL('image/png');
 });
}
