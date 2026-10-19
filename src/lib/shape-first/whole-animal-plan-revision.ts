import {COLORS} from '../bricks';
import {ANIMAL_BLUEPRINT_ROLES,validateAnimalBlueprint,type AnimalBlueprint} from './animal-blueprint';

export interface WholeAnimalPlanRevisionResult {blueprint:AnimalBlueprint|null;reason?:string;issues:string[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const label=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
const roles=new Set<string>(ANIMAL_BLUEPRINT_ROLES);

function paletteKey(v:unknown):string|null {
 if(!object(v))return null;
 const values:string[][]=[];
 for(const key of ['coat','accent','dark']) {
  const colors=v[key];
  if(!Array.isArray(colors)||colors.length<1||colors.length>3||colors.some(c=>typeof c!=='string'||!Object.hasOwn(COLORS,c))||new Set(colors).size!==colors.length)return null;
  values.push([...colors].sort());
 }
 return JSON.stringify(values);
}
/** Physical multiset of exact IDs/counts/roles, separately for pieces/carriers.
 * Entry order and equivalent row grouping do not change the reservation. */
function reservationKey(v:unknown,carrier=false):string|null {
 if(!Array.isArray(v)||v.length<1||v.length>12)return null;
 const cost=new Map<string,number>();
 for(const p of v) {
  if(!object(p)||typeof p.partId!=='string'||!p.partId||p.partId.length>80||typeof p.role!=='string'||!roles.has(p.role)||!Number.isSafeInteger(p.count)||Number(p.count)<1||Number(p.count)>80)return null;
  if(Object.hasOwn(p,'shared')&&(!carrier||!label(p.shared)||p.count!==1))return null;
  const key=JSON.stringify([p.partId,p.role,p.shared??null]);cost.set(key,(cost.get(key)??0)+Number(p.count));
 }
 return JSON.stringify([...cost].sort(([a],[b])=>a.localeCompare(b)));
}
function featuresKey(v:unknown):string|null {
 if(!Array.isArray(v)||v.length<2||v.length>4)return null;
 const ids=new Set<string>(),features:unknown[][]=[];
 for(const f of v) {
  if(!object(f)||!label(f.id)||ids.has(f.id)||typeof f.intent!=='string'||!['pointed-ears','projecting-muzzle','separated-eyes-nose','contoured-body','sweeping-tail'].includes(f.intent)||typeof f.pairing!=='string'||!['none','same-shape','identical-id'].includes(f.pairing))return null;
  const pieces=reservationKey(f.pieces),carriers=reservationKey(f.carriers,true);if(pieces===null||carriers===null)return null;
  // supportMode is an editable support-path promise, not an exact binding.
  // The complete proposed blueprint validates its enum independently.
  ids.add(f.id);features.push([f.id,f.intent,f.pairing,pieces,carriers]);
 }
 return JSON.stringify(features.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}

/** Pure explicit sketch revision policy, not construction acceptance. The
 * original geometry may be overconstrained: only its protected contract is
 * checked here, so a truthful revision can repair an invalid small/envelope
 * promise. The NEW complete blueprint must pass the unchanged global validator.
 * Revision limits, prepaid-prefix fit and before/after records belong to caller.
 */
export function validateWholeAnimalPlanRevision(original:AnimalBlueprint,input:unknown,stock:Record<string,number>,minParts:number):WholeAnimalPlanRevisionResult {
 const issues:string[]=[];
 if(!Number.isSafeInteger(minParts)||minParts<0||minParts>80)issues.push('Requested minimum must be a nonnegative safe integer within 80 parts.');
 if(!object(original)||original.version!==1||!label(original.id)||original.subject!=='Fox'||!['standing','crouching'].includes(original.stance)||!object(original.parts)||!Number.isSafeInteger(original.parts.min)||original.parts.min<20||original.parts.min>80)return {blueprint:null,issues:[...issues,'Original blueprint has an invalid protected identity, stance or minimum.']};
 const palette=paletteKey(original.palette),features=featuresKey(original.features);
 if(palette===null||features===null)return {blueprint:null,issues:[...issues,'Original blueprint has malformed protected palette or exact feature reservations.']};
 if(!object(input))return {blueprint:null,issues:[...issues,'Provide an explicit revision reason and complete blueprint.']};
 const reason=typeof input.reason==='string'&&input.reason.length<=600&&input.reason.trim()?input.reason.trim():undefined;
 if(!reason)issues.push('Revision reason must be nonempty text of at most 600 characters.');
 const proposed=input.blueprint;
 if(object(proposed)) {
  if(proposed.id!==original.id||proposed.subject!==original.subject)issues.push('Revision must preserve the exact original id and canonical subject.');
  if(proposed.stance!==original.stance)issues.push('Revision must preserve the original stance.');
  if(!object(proposed.parts)||proposed.parts.min!==original.parts.min)issues.push('Revision must preserve the exact original parts.min.');
  if(paletteKey(proposed.palette)!==palette)issues.push('Revision must preserve the original coat, accent and dark palette sets.');
  if(featuresKey(proposed.features)!==features)issues.push('Revision must preserve every feature id, intent, pairing and exact piece/carrier reservation multiset, including roles and shared bindings.');
 }
 if(Number.isSafeInteger(minParts)&&original.parts.min<minParts)issues.push(`Original parts.min ${original.parts.min} is below the requested minimum ${minParts}; a revision cannot change it.`);
 const validated=validateAnimalBlueprint(proposed,stock);issues.push(...validated.issues);
 if(issues.length||!validated.blueprint)return {blueprint:null,...(reason?{reason}:{}),issues:[...new Set(issues)]};
 return {blueprint:validated.blueprint,reason,issues:[]};
}
