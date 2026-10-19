import type { PartKind, PartType, Placed } from './bricks';

/** Plan outlines and stud locations checked against LDraw 41770a/41769a and 30565.
 * Parametric geometry, not imported meshes. See docs/construction-vocabulary.md.
 * Collision cells conservatively include any positive-area intersection; grips use
 * only the verified stud-grid locations, never the smooth tapered margin.
 */
export const OUTLINE_PARTS: PartType[] = ['wedgeleft', 'wedgeright', 'quarterplate'];
export const isOutlinePart = (type: PartType) => OUTLINE_PARTS.includes(type);
type Point = [number, number];
export function outlinePolygon(k: PartKind): Point[] {
  if (k.type === 'wedgeleft') return [[0,0],[1,0],[2,4],[0,4]];
  if (k.type === 'wedgeright') return [[0,4],[1,0],[2,0],[2,4]];
  if (k.type === 'quarterplate') return [[0,4], ...Array.from({length:49},(_,i):Point => {
    const angle=-Math.PI/2+i*Math.PI/96; return [4*Math.cos(angle),4+4*Math.sin(angle)];
  })];
  return [];
}
function turn([x,y]:Point,k:PartKind,rot:number):Point {
  if(rot===90)return [k.d-y,x];
  if(rot===180)return [k.w-x,k.d-y];
  if(rot===270)return [y,k.w-x];
  return [x,y];
}
export function outlineStudCells(k:PartKind,p:Placed):Point[] {
  const centers:Point[]=k.type==='quarterplate'
    ? [...Array.from({length:9},(_,i):Point=>[i%3+.5,Math.floor(i/3)+1.5]),[.5,.5],[3.5,3.5]]
    : Array.from({length:4},(_,i):Point=>[k.type==='wedgeleft'?.5:1.5,i+.5]);
  return centers.map(c=>{const [x,y]=turn(c,k,p.rot);return [p.x+Math.floor(x),p.y+Math.floor(y)];});
}
function clip(poly:Point[],axis:0|1,edge:number,keepGreater:boolean):Point[] {
  const out:Point[]=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const ai=keepGreater?a[axis]>=edge:a[axis]<=edge,bi=keepGreater?b[axis]>=edge:b[axis]<=edge;
    if(ai)out.push(a);
    if(ai!==bi){const t=(edge-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }
  return out;
}
export function outlineCells(k:PartKind,p:Placed):Point[] {
  const polygon=outlinePolygon(k).map(c=>turn(c,k,p.rot));
  const w=p.rot%180?k.d:k.w,d=p.rot%180?k.w:k.d,out:Point[]=[];
  for(let x=0;x<w;x++)for(let y=0;y<d;y++){
    let poly=clip(clip(polygon,0,x,true),0,x+1,false);
    poly=clip(clip(poly,1,y,true),1,y+1,false);
    const area=Math.abs(poly.reduce((a,c,i)=>a+c[0]*poly[(i+1)%poly.length][1]-c[1]*poly[(i+1)%poly.length][0],0))/2;
    if(area>1e-8)out.push([p.x+x,p.y+y]);
  }
  return out;
}
