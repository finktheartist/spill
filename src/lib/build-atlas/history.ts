import { inventoryKey } from '../shape-first/discovery';
import type { IdeaStorage } from '../shape-first/discovery';
const KEY='spill.atlas-history.v1',LIMIT=2500;
const memory=new Map<string,string>();
function storage():IdeaStorage|undefined {
  if(typeof window==='undefined')return undefined;
  return {getItem(k){try{return memory.get(k)??localStorage.getItem(k);}catch{return memory.get(k)??null;}},
    setItem(k,v){try{localStorage.setItem(k,v);memory.delete(k);}catch{memory.set(k,v);}}};
}
function read(store?:IdeaStorage):{key:string;ids:string[]}[] {
  try{const raw=store?.getItem(KEY);if(!raw||raw.length>6_000_000)return [];const d=JSON.parse(raw);
    return d.version===1&&Array.isArray(d.piles)?d.piles.slice(-12).filter((p:{key:string;ids:string[]})=>typeof p?.key==='string'&&Array.isArray(p.ids)).map((p:{key:string;ids:string[]})=>({key:p.key,ids:p.ids.filter(id=>typeof id==='string'&&id.length<160).slice(-LIMIT)})):[];
  }catch{return [];}
}
export function atlasSeenIds(mode:string,stock:Record<string,number>,store=storage()):Set<string> {
  return new Set(read(store).find(p=>p.key===inventoryKey(mode,stock))?.ids??[]);
}
export function rememberAtlasIds(mode:string,stock:Record<string,number>,ids:string[],store=storage()) {
  if(!store)return;
  const key=inventoryKey(mode,stock),piles=read(store),previous=piles.find(p=>p.key===key)?.ids??[];
  const next=[...new Set([...previous,...ids.filter(id=>typeof id==='string'&&id.length<160)])].slice(-LIMIT);
  try{store.setItem(KEY,JSON.stringify({version:1,piles:[...piles.filter(p=>p.key!==key),{key,ids:next}].slice(-12)}));}catch{/* browser quotas must not block building */}
}
