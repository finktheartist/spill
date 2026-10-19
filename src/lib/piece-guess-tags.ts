import {PART_TAG_GROUPS,readPartTags,type PartTags,type PartTagGroupId} from './part-tag-schema';
import {readPieceReviewEvidence} from './piece-review-evidence';

const guessGroups=PART_TAG_GROUPS.filter(g=>g.id!=='color'&&g.id!=='category');
/** Extra visual clues are requested in the existing scan call, never a second
 * paid pass. Empty/omitted groups mean unknown; color stays in its own field. */
export const SCAN_FEATURE_TAG_SCHEMA={
 type:'OBJECT',
 properties:Object.fromEntries(guessGroups.map(g=>[g.id,{type:'ARRAY',maxItems:g.multiple?6:1,items:{type:'STRING',...(g.options.length&&!['size','height','studs'].includes(g.id)?{enum:g.options.map(o=>o.value)}:{})}}])),
};
export const SCAN_FEATURE_TAG_PROMPT=`For EVERY visible piece, include featureTags: your best visual guesses using the feature-tag vocabulary in the response schema. Include family, footprint size in studs, height in plates, outline/form, profile (such as curved, angled or inverted), top features, top-stud count, and visible connections or decoration when you can judge them. Use arrays, for example {"family":["plate"],"size":["1x2"],"height":["1"],"shape":["rectangle"],"top":["studded"],"studs":["2"]}. Omit any group you cannot judge; an empty object is allowed for a hidden or unidentifiable piece. Do not copy features from a catalog name or the shape key, infer hidden underside connections, or describe printed artwork as a physical feature. These are editable search guesses, not an exact identity or human confirmation. Keep these tags consistent with your other visual observations. Sizes use "1x2" and heights/counts use numeric strings. Details may name another visible structural feature in a few words. Do not supply color or catalog-category tags.`;

const has=(tags:PartTags,key:PartTagGroupId,value:string)=>tags[key]?.includes(value)??false;
const studded=new Set(['studded','open-studs','solid-studs','grid-studs','center-stud','offset-studs','end-studs','edge-studs','row-studs']);
const canonical=(n:number)=>String(Math.round(n*1e6)/1e6);
const numeric=(s:string)=>{const [a,b]=s.split('/').map(Number);return b===undefined?a:a/b;};

/** Adapt recorded observations only. A proposed native/catalog identity is not
 * an input, so an incorrect match cannot manufacture its own search evidence. */
export function pieceGuessTags(raw:unknown):PartTags {
 const evidence=readPieceReviewEvidence(raw);if(!evidence)return {};
 const tags:PartTags={},f=evidence.features;
 const size=evidence.size?.split(/\s*[xX×]\s*/).slice(0,2).map(numeric);
 if(size?.length===2&&size.every(n=>n>0&&n<=1024))tags.size=[size.map(canonical).join('x')];
 if(f){
  if(f.heightPlates!==undefined&&f.heightPlates>0)tags.height=[String(f.heightPlates)];
  if(f.studsOnTop!==undefined)tags.studs=[String(f.studsOnTop)];
  const outline:Record<string,string>={rectangle:size?.[0]===size?.[1]&&size?.length===2?'square':'rectangle',L:'l-shape',round:'round','quarter-circle':'quarter-circle',wedge:'wedge',capsule:'capsule'};
  if(f.outline&&outline[f.outline])tags.shape=[outline[f.outline]];
  const profile=f.topShape==='flat'?['flat']:f.topShape?.startsWith('slope')?['angled']:f.topShape==='curved'?['curved']:f.topShape==='curved-inverted'?['curved','inverted']:[];
  if(f.handedness==='left'||f.handedness==='right')profile.push(f.handedness);
  if(profile.length)tags.profile=profile;
  if(f.topShape==='dome')tags.shape=['dome'];
  const top:string[]=[];
  if(f.studsOnTop===0||f.studLayout==='none')top.push('smooth');
  if(f.studsOnTop!==undefined&&f.studsOnTop>0)top.push('studded');
  const layouts:Record<string,string>={grid:'grid-studs',center:'center-stud',row:'row-studs'};
  if(f.studLayout&&layouts[f.studLayout])top.push(layouts[f.studLayout]);
  if(f.openStuds!==undefined&&f.studsOnTop!==0&&f.studLayout!=='none'&&(f.openStuds||Number(f.studsOnTop)>0||!!f.studLayout&&['grid','center','row'].includes(f.studLayout)))top.push(f.openStuds?'open-studs':'solid-studs');
  if(top.length)tags.top=top;
  if(f.studLayout==='side')tags.connections=['side-stud'];
 }
 // Dedicated visual tags can express more than the older scan feature enums.
 for(const g of guessGroups)if(evidence.tags?.[g.id]?.length)tags[g.id]=[...evidence.tags[g.id]!];
 // Conflicting model observations stay unknown rather than arbitrarily
 // promoting one of the conflicting guesses into an authoritative filter.
 if(tags.top?.includes('smooth')&&tags.top.some(v=>studded.has(v))||has(tags,'top','smooth')&&Number(tags.studs?.[0])>0||tags.studs?.[0]==='0'&&tags.top?.some(v=>studded.has(v))){delete tags.top;delete tags.studs;}
 const checked:PartTags={};
 for(const g of guessGroups){try{Object.assign(checked,readPartTags({[g.id]:tags[g.id]??[]}));}catch{/* One malformed guess cannot discard the other clues. */}}
 return checked;
}

export interface PieceGuessState {tags:PartTags;guesses:PartTags}
export function initialPieceGuessState(color:string,evidence?:unknown):PieceGuessState {
 const guesses=pieceGuessTags(evidence);let manual:PartTags={};
 try{manual=readPartTags({color:[color]});}catch{/* Unknown color stays unset. */}
 return {tags:{...structuredClone(guesses),...manual},guesses};
}

/** Changes promote only the edited groups into user-controlled filters. Removed
 * guesses are never re-derived on query/page/candidate/late-scan changes. */
export function editPieceGuessState(previous:PieceGuessState,rawNext:PartTags,editedGroup:PartTagGroupId|null):PieceGuessState {
 const tags=readPartTags(rawNext),guesses:PartTags={};
 if(editedGroup!==null)for(const g of guessGroups){
  if(g.id===editedGroup)continue;
  const remaining=previous.guesses[g.id]?.filter(v=>tags[g.id]?.includes(v));
  if(remaining?.length)guesses[g.id]=remaining;
 }
 return {tags,guesses};
}
export function manualPieceTags(state:PieceGuessState):PartTags {
 return Object.fromEntries(Object.entries(state.tags).filter(([key])=>!state.guesses[key as PartTagGroupId]?.length));
}
