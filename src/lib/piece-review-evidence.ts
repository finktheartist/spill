import type {Features} from './identify';
import {PART_TAG_GROUPS,readPartTags,type PartTags} from './part-tag-schema';

/** Recorded scan suggestions only. These fields do not establish a part identity,
 * human confirmation, a calibrated confidence or any usable stock. */
export interface PieceReviewEvidence {
 description?:string;
 size?:string;
 features?:Features;
 tags?:PartTags;
}

// Keep this data-only module independent of identify's runtime/brick imports.
const layouts=['grid','center','row','side','none','other'] as const satisfies readonly NonNullable<Features['studLayout']>[];
const tops=['flat','slope45','slope-shallow','slope-steep','curved','curved-inverted','dome','other'] as const satisfies readonly NonNullable<Features['topShape']>[];
const outlines=['rectangle','L','round','quarter-circle','wedge','capsule','other'] as const satisfies readonly NonNullable<Features['outline']>[];
const hands=['left','right','unknown'] as const satisfies readonly NonNullable<Features['handedness']>[];

function record(value:unknown):value is Record<string,unknown> {
 try{return !!value&&typeof value==='object'&&!Array.isArray(value);}catch{return false;}
}
function own(value:Record<string,unknown>,key:string):unknown {
 try{const field=Object.getOwnPropertyDescriptor(value,key);return field&&Object.hasOwn(field,'value')?field.value:undefined;}catch{return undefined;}
}
function member<T extends string>(value:unknown,values:readonly T[]):T|undefined {
 return typeof value==='string'&&values.includes(value as T)?value as T:undefined;
}
function integer(value:unknown,max:number):value is number {
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
}
function sizeText(value:unknown):string|undefined {
 if(typeof value!=='string')return undefined;
 const text=value.trim();if(!text||text.length>40)return undefined;
 const axes=text.split(/\s*[xX×]\s*/);
 if(axes.length<2||axes.length>3)return undefined;
 // Preserve the explicit text, including height fractions, rather than rounding
 // it into a native size or guessing dimensions from a descriptive sentence.
 if(!axes.every(axis=>{
  if(!/^(?:\d+(?:\.\d+)?|\d+\/[1-9]\d*)$/.test(axis))return false;
  const [a,b]=axis.split('/').map(Number),n=b===undefined?a:a/b;
  return Number.isFinite(n)&&n>0;
 }))return undefined;
 return text;
}
function features(value:unknown):Features|undefined {
 if(!record(value))return undefined;
 const out:Features={};
 const studs=own(value,'studsOnTop'),height=own(value,'heightPlates'),open=own(value,'openStuds');
 const layout=member(own(value,'studLayout'),layouts),top=member(own(value,'topShape'),tops);
 const outline=member(own(value,'outline'),outlines),hand=member(own(value,'handedness'),hands);
 if(integer(studs,256))out.studsOnTop=studs;
 if(integer(height,80))out.heightPlates=height;
 if(typeof open==='boolean')out.openStuds=open;
 if(layout!==undefined)out.studLayout=layout;
 if(top!==undefined)out.topShape=top;
 if(outline!==undefined)out.outline=outline;
 if(hand!==undefined)out.handedness=hand;
 return Object.keys(out).length?out:undefined;
}
function tags(value:unknown):PartTags|undefined {
 if(!record(value))return undefined;
 try{const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return undefined;}catch{return undefined;}
 const out:PartTags={};
 // Only bounded own-data groups enter the shared strict validator. A bad
 // group cannot erase independently valid features or other tag groups.
 for(const group of PART_TAG_GROUPS){
  const raw=own(value,group.id);if(raw===undefined)continue;
  try{Object.assign(out,readPartTags({[group.id]:raw}));}catch{/* Malformed group stays unknown. */}
 }
 // Conflicting independent top/count suggestions establish neither fact;
 // retain other groups without choosing one contradictory claim as truth.
 if(out.top&&out.studs){
  try{readPartTags({top:out.top,studs:out.studs});}catch{delete out.top;delete out.studs;}
 }
 try{const checked=readPartTags(out);return Object.keys(checked).length?checked:undefined;}catch{return undefined;}
}
function copy(value:Record<string,unknown>,featureValue:unknown,tagValue:unknown):PieceReviewEvidence|undefined {
 const out:PieceReviewEvidence={},description=own(value,'description');
 if(typeof description==='string'){
  const text=description.trim().slice(0,500);if(text)out.description=text;
 }
 const size=sizeText(own(value,'size')),checked=features(featureValue),checkedTags=tags(tagValue);
 if(size!==undefined)out.size=size;
 if(checked!==undefined)out.features=checked;
 if(checkedTags!==undefined)out.tags=checkedTags;
 return Object.keys(out).length?out:undefined;
}

/** Read a stored evidence object. Flat feature fields and identity/provenance
 * fields are intentionally ignored; there is no legacy identity-derived fill. */
export function readPieceReviewEvidence(value:unknown):PieceReviewEvidence|undefined {
 return record(value)?copy(value,own(value,'features'),own(value,'tags')):undefined;
}

/** Copy the existing scanner's flat RawPart features into stored evidence.
 * Invalid fields are independently discarded, never coerced into a guess. */
export function scanPieceReviewEvidence(raw:unknown):PieceReviewEvidence|undefined {
 return record(raw)?copy(raw,raw,own(raw,'featureTags')):undefined;
}
