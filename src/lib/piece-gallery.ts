import {CATALOG,COLOR_NAMES,parsePartId,partId,type PartKind} from './bricks';
import {isMade,partInfo} from './catalog';
import {definition} from './connections';

export function isViablePiece(k:PartKind):boolean {if(!isMade(k.partId))return false;try{return !!definition(k);}catch{return false;}}

/** Exact manufactured, implemented shapes only. Gallery selection never aliases
 * an unsupported mold or substitutes a color. */
export function viablePieceGallery({query='',type='',color='',offset=0,limit=24}:{query?:string;type?:string;color?:string;offset?:number;limit?:number}={}) {
 const words=query.toLowerCase().replace(/(\d)\s*[x×]\s*(\d)/g,'$1x$2').trim().split(/\s+/).filter(Boolean),all:PartKind[]=[];
 for(const [family,sizes]of Object.entries(CATALOG)){
  if(type&&family!==type)continue;
  for(const size of sizes){
   const [w,d]=size.split('x').map(Number);
   for(const c of color?[color]:COLOR_NAMES){
    const k=parsePartId(partId(family as PartKind['type'],w,d,c as PartKind['color']));if(!k||!isViablePiece(k))continue;
    const info=partInfo(k.partId),hay=[k.partId,info?.name,info?.number].join(' ').toLowerCase();
    if(words.every(word=>hay.includes(word)))all.push(k);
   }
  }
 }
 const start=Math.max(0,(Number.isFinite(offset)?Math.floor(offset):0)),size=Math.max(1,Math.min(48,(Number.isFinite(limit)?Math.floor(limit):24)));
 return {parts:all.slice(start,start+size),total:all.length};
}
