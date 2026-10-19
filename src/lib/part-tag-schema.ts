/** Bounded search-tag vocabulary and validation only. Missing values remain
 * unknown. This module imports data only, never native geometry or connectors. */
import catalogData from '../data/rebrickable.json';
const COLORS=catalogData.colors;

export type PartTagGroupId='family'|'size'|'height'|'shape'|'profile'|'top'|'studs'|'connections'|'decoration'|'color'|'category'|'details';
export type PartTags=Partial<Record<PartTagGroupId,string[]>>;
type Option={value:string;label:string};
const options=(values:readonly string[]):readonly Option[]=>Object.freeze(values.map(value=>Object.freeze({value,label:value==='upright'?'Upright / not inverted':value.replace(/-/g,' ').replace(/^./,s=>s.toUpperCase())})));
const group=(id:PartTagGroupId,label:string,multiple:boolean,values:readonly string[],advanced=false)=>Object.freeze({id,label,multiple,...(advanced?{advanced:true}:{}),options:options(values)});
export const PART_TAG_GROUPS:readonly {id:PartTagGroupId;label:string;multiple:boolean;advanced?:boolean;options:readonly Option[]}[]=Object.freeze([
 group('family','Family',false,['brick','plate','tile','slope','technic','minifig','minidoll','body-part','headwear','accessory','animal','vegetation','vehicle','windscreen','wheel','tire','panel','bracket','hinge','clip','window','door','frame','bar','fence','ladder','baseplate','turntable','gear','axle','pin','connector','hose','pneumatic','container','support','rock','flag','string','electronics','magnet','projectile','sticker','large-figure','duplo','modulex','znap','clikits','non-system','other']),
 group('size','Size',false,['1x1','1x2','1x3','1x4','1x6','1x8','2x2','2x3','2x4','2x6','3x3','4x4','1x2-1x2','1x2-2x2']),
 group('height','Height in plates',false,['1','2','2.5','3','5','6','9'],true),
 group('shape','Outline / form',false,['rectangle','square','round','oval','capsule','half-circle','quarter-circle','macaroni','triangle','wedge','l-shape','arch','ring','dome','cylinder','cone','irregular']),
 group('profile','Profile',true,['flat','curved','angled','inverted','upright','stepped','tapered','beveled','left','right','bent','ribbed','grooved','rounded']),
 group('top','Top features',true,['flat','smooth','studded','open-studs','solid-studs','grid-studs','center-stud','offset-studs','end-studs','edge-studs','row-studs'],true),
 group('studs','Top stud count',false,['0','1','2','3','4','6','8','12','16'],true),
 group('connections','Connections',true,['stud','anti-stud','side-stud','clip','ball','socket','pin','pin-hole','axle','axle-hole','hole','bar','hinge','handle','thread','magnet']),
 group('decoration','Decoration',true,['printed','stickered','marbled','metallic','glow-in-dark'],true),
 Object.freeze({id:'color' as const,label:'Color',multiple:false,options:Object.freeze(Object.keys(COLORS).map(value=>Object.freeze({value,label:value.replace(/-/g,' ').replace(/^./,s=>s.toUpperCase())})))}),
 group('category','Catalog category',false,[],true),
 group('details','Additional catalog details',true,[],true),
]);
const groups=new Map(PART_TAG_GROUPS.map(g=>[g.id,g]));
const dynamicText=(s:string)=>s.length<=96&&/^[a-z0-9][a-z0-9 .,'&+()/:\-]*$/.test(s);
const scalar='(?:0|[1-9]\\d{0,3})(?:\\.\\d{1,6})?';
const sizePattern=new RegExp(`^${scalar}x${scalar}(?:-${scalar}x${scalar}){0,2}$`);
const canonicalNumber=(n:number)=>String(Math.round(n*1e6)/1e6);
function ownEntries(raw:unknown):[string,unknown][] {
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||(Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null))throw 0;
  const keys=Object.keys(raw);if(keys.length>PART_TAG_GROUPS.length)throw 0;
  return keys.map(key=>{const field=Object.getOwnPropertyDescriptor(raw,key);if(!field||!Object.hasOwn(field,'value'))throw 0;return [key,field.value];});
 }catch{throw new RangeError('tags must be a bounded own-data object');}
}
function ownList(raw:unknown,max:number):unknown[] {
 try{
  if(!Array.isArray(raw))throw 0;
  const length=Object.getOwnPropertyDescriptor(raw,'length');
  if(!length||!Object.hasOwn(length,'value')||!Number.isSafeInteger(length.value)||length.value<0||length.value>max)throw 0;
  const out:unknown[]=[];
  for(let i=0;i<length.value;i++){
   const field=Object.getOwnPropertyDescriptor(raw,String(i));if(!field||!Object.hasOwn(field,'value'))throw 0;out.push(field.value);
  }
  return out;
 }catch{throw new RangeError('tags must contain bounded own-data arrays');}
}
/** Strict, bounded API validation. {} is valid. Numeric strings are already
 * canonical: height is plates, studs is top count. Size preserves the catalog's
 * nominal dimensions (native system sizes use studs; wheel titles may use mm).
 * Category and
 * details admit normalized catalog text beyond the suggested static options. */
export function readPartTags(raw:unknown):PartTags {
 const out:PartTags={};let total=0;
 for(const [key,value]of ownEntries(raw)){
  const g=groups.get(key as PartTagGroupId);if(!g)throw new RangeError(`Unknown tag group ${key}`);
  const values=ownList(value,g.multiple?24:1);
  const seen=new Set<string>();
  for(const v of values){
   if(typeof v!=='string'||v.length>96||seen.has(v))throw new RangeError(`Invalid or duplicate ${key} tag`);
   let valid=g.options.some(o=>o.value===v);
   if(key==='category'||key==='details')valid=dynamicText(v);
   if(key==='size')valid=sizePattern.test(v)&&v.split(/x|-/).every(n=>Number(n)>0&&Number(n)<=1024&&canonicalNumber(Number(n))===n);
   if(key==='height')valid=new RegExp(`^${scalar}$`).test(v)&&Number(v)>0&&Number(v)<=1024&&canonicalNumber(Number(v))===v;
   if(key==='studs')valid=/^(?:0|[1-9]\d{0,3})$/.test(v)&&Number(v)<=4096;
   if(!valid)throw new RangeError(`Unsupported ${key} tag value`);
   total+=v.length;if(total>4096)throw new RangeError('tags are too large');seen.add(v);
  }
  if(values.length)out[key as PartTagGroupId]=[...seen];
 }
 const has=(key:PartTagGroupId,v:string)=>out[key]?.includes(v);
 if(has('profile','left')&&has('profile','right')||has('profile','upright')&&has('profile','inverted')||has('top','open-studs')&&has('top','solid-studs')||has('top','smooth')&&has('top','studded'))throw new RangeError('Contradictory feature tags');
 if(out.studs?.[0]==='0'&&has('top','studded')||Number(out.studs?.[0])>0&&has('top','smooth'))throw new RangeError('Top stud count conflicts with top features');
 return out;
}
