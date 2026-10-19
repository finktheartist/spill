import {readPartTags,type PartTags,type PartTagGroupId} from './part-tags';
const studFeatures=new Set(['studded','open-studs','solid-studs','grid-studs','center-stud','offset-studs','end-studs','edge-studs','row-studs']);

/** Add only the explicitly edited values. Direct contradictions may be removed,
 * but an unknown field is never filled from another clue. This only edits
 * search tags; it cannot confirm an identity or change inventory. */
export function editPartTag(tags:PartTags,key:PartTagGroupId,values:string[]):PartTags {
 const next={...tags};if(values.length)next[key]=[...values];else delete next[key];
 // Catalog category is a classification of the old family, not a second
 // independent physical observation. Do not leave it blocking a family edit.
 if(key==='family'&&JSON.stringify(values)!==JSON.stringify(tags.family??[]))delete next.category;
 const addedTop=key==='top'?values.filter(v=>!tags.top?.includes(v)):[];
 const smooth=key==='studs'&&values[0]==='0'||addedTop.includes('smooth');
 const studded=key==='studs'&&Number(values[0])>0||addedTop.some(v=>studFeatures.has(v))||key==='connections'&&values.includes('stud')&&!tags.connections?.includes('stud');
 if(smooth&&studded)throw new RangeError('Contradictory feature tags');
 if(smooth){
  if(next.top)next.top=next.top.filter(v=>!studFeatures.has(v));
  if(Number(next.studs?.[0])>0)delete next.studs;
  if(next.connections)next.connections=next.connections.filter(v=>v!=='stud');
 }else if(studded){
  if(next.top)next.top=next.top.filter(v=>v!=='smooth');
  if(next.studs?.[0]==='0')delete next.studs;
 }
 for(const [group,a,b]of [['top','open-studs','solid-studs'],['profile','left','right'],['profile','upright','inverted']] as const){
  if(key!==group)continue;
  const added=values.filter(v=>(v===a||v===b)&&!tags[group]?.includes(v));
  if(added.length===1)next[group]=next[group]?.filter(v=>v!==(added[0]===a?b:a));
 }
 if(key==='profile'){
  const removed=new Set(tags.profile?.filter(v=>!next.profile?.includes(v)));
  if(removed.size&&next.details)next.details=next.details.filter(v=>!removed.has(v));
 }
 return readPartTags(next);
}
