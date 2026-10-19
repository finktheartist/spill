import type {SpecialMold,SpecialMoldPoint,SpecialMoldPort,SpecialMoldXY} from './special-mold-geometry';

/** Exact rectangular plate/tile molds studied from the official LDraw parts
 * 26603,69729,11212,78329,4282,91988,92438,3456 (CC BY 4.0).
 * Nominal exteriors and standard grid sockets only: cosmetic grooves, underside
 * cavities and friction are not simulated. Source pins/attribution are in the
 * tests and docs/expanded-mold-support.md. No scaled or nearest-mold aliases.
 */
export const EXPANDED_PLAIN_MOLD_SPECS=Object.freeze([
  {type:'tile',w:2,d:3,num:'26603'}, {type:'tile',w:2,d:6,num:'69729'},
  {type:'plate',w:3,d:3,num:'11212'}, {type:'plate',w:1,d:5,num:'78329'},
  {type:'plate',w:2,d:16,num:'4282'}, {type:'plate',w:2,d:14,num:'91988'},
  {type:'plate',w:8,d:16,num:'92438'}, {type:'plate',w:6,d:14,num:'3456'},
].map(s=>Object.freeze(s)));
const point=(x:number,y:number,z:number):SpecialMoldPoint=>Object.freeze([x,y,z] as const);
const ports=(kind:'stud'|'grip',w:number,d:number,z:number):readonly SpecialMoldPort[]=>Object.freeze(
  Array.from({length:d},(_,x)=>Array.from({length:w},(_,y)=>Object.freeze({id:`${kind}:${x}:${y}`,point:point(x*20+10,y*20+10,z)}))).flat());
const molds=new Map<string,SpecialMold>(EXPANDED_PLAIN_MOLD_SPECS.map(s=>{
  const W=s.d*20,D=s.w*20,outline=Object.freeze([[0,0],[W,0],[W,D],[0,D]].map(p=>Object.freeze(p) as SpecialMoldXY));
  return [`${s.type}-${s.w}x${s.d}`,Object.freeze({num:s.num,widthLdu:W,depthLdu:D,heightPlates:1,
    studs:s.type==='plate'?ports('stud',s.w,s.d,8):Object.freeze([]),grips:ports('grip',s.w,s.d,0),
    outline,sections:Object.freeze([outline])})];
}));
export function expandedPlainMold(k:{type:string;w:number;d:number}):SpecialMold|undefined {
  if(!k||typeof k.type!=='string'||!Number.isSafeInteger(k.w)||!Number.isSafeInteger(k.d))return undefined;
  return molds.get(`${k.type}-${k.w}x${k.d}`);
}
