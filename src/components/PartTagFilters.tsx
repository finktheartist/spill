import {useId,useMemo,useState} from 'react';
import {COLORS,type ColorName} from '../lib/bricks';
import {editPartTag} from '../lib/part-tag-edit';
import {PART_TAG_GROUPS,type PartTags,type PartTagGroupId} from '../lib/part-tags';

export type PartTagFacets=Partial<Record<PartTagGroupId,{value:string;label:string;count?:number}[]>>;
const COMMON=new Set<PartTagGroupId>(['family','size','shape','profile','color','connections']);
const CUSTOM=new Set<PartTagGroupId>(['size','height','studs','details']);
const OPTIONS_PER_PAGE=48;
export const tagValueLabel=(value:string)=>value.replace(/-/g,' ').replace(/x(?=\d)/g,' × ');

/** AI clues are labelled; opening/searching a group never selects a new tag. */
export function PartTagFilters({tags,guesses={},facets,onChange}:{tags:PartTags;guesses?:PartTags;facets?:PartTagFacets;onChange:(next:PartTags,editedGroup:PartTagGroupId|null)=>void}){
 const id=useId(),[open,setOpen]=useState<PartTagGroupId|null>(null),[more,setMore]=useState(false),[query,setQuery]=useState(''),[optionPage,setOptionPage]=useState(0),[custom,setCustom]=useState(''),[error,setError]=useState('');
 const group=PART_TAG_GROUPS.find(g=>g.id===open);
 const selectedCount=Object.values(tags).reduce((n,v)=>n+(v?.length??0),0);
 const options=useMemo(()=>{
  if(!group)return [];
  const all=new Map<string,{value:string;label:string;count?:number}>();
  for(const o of [...facets?.[group.id]??[],...group.options])all.set(o.value,{...all.get(o.value),...o,label:o.label===o.value?tagValueLabel(o.value):o.label});
  for(const value of tags[group.id]??[])if(!all.has(value))all.set(value,{value,label:tagValueLabel(value)});
  const normalize=(s:string)=>s.toLowerCase().replace(/\s*[x×]\s*/g,'x');
  const q=normalize(query.trim());
  return [...all.values()].filter(o=>!q||normalize(`${o.label} ${o.value}`).includes(q)).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
 },[group,facets,tags,query]);
 const tagPage=Math.min(optionPage,Math.max(0,Math.ceil(options.length/OPTIONS_PER_PAGE)-1));
 const update=(key:PartTagGroupId,values:string[])=>{
  try{onChange(editPartTag(tags,key,values),key);setError('');return true;}
  catch(e){setError((e as Error).message);return false;}
 };
 const choose=(value:string)=>{
  if(!group)return;
  const previous=tags[group.id]??[];
  update(group.id,group.multiple?(previous.includes(value)?previous.filter(v=>v!==value):[...previous,value]):previous.includes(value)?[]:[value]);
 };
 const panel=(key:PartTagGroupId)=>{setOpen(open===key?null:key);setQuery('');setOptionPage(0);setCustom('');setError('');};
 const renderPanel=()=>group&&<fieldset id={`${id}-${group.id}-options`} className="pe-tag-panel">
   <legend className="sr-only">{group.label} options</legend>
   <div className="pe-section-heading"><p className="meta">{group.multiple?'Choose every feature you can see.':'Choose a value, or leave it uncertain.'}</p><button type="button" className="linkbtn" onClick={()=>{setOpen(null);document.getElementById(`${id}-${group.id}-toggle`)?.focus();}}>Done</button></div>
   <label className="sr-only" htmlFor={`${id}-find`}>Find {group.label.toLowerCase()} tags</label>
   <input id={`${id}-find`} className="pe-search" value={query} onChange={e=>{setQuery(e.target.value);setOptionPage(0);}} placeholder={`Find ${group.label.toLowerCase()}…`} autoComplete="off" />
   <div className="pe-tag-options">
    <label className="pe-tag-option"><input type="checkbox" checked={!tags[group.id]?.length} onChange={()=>update(group.id,[])} /><span>Not sure / any</span></label>
    {options.slice(tagPage*OPTIONS_PER_PAGE,(tagPage+1)*OPTIONS_PER_PAGE).map(o=><label key={o.value} className="pe-tag-option"><input type="checkbox" checked={tags[group.id]?.includes(o.value)??false} onChange={()=>choose(o.value)} />{group.id==='color'&&o.value in COLORS&&<span aria-hidden="true" className="pe-tag-swatch" style={{background:COLORS[o.value as ColorName]}}/>}<span>{o.label}</span></label>)}
   </div>
   {options.length>OPTIONS_PER_PAGE&&<nav className="row pe-pagination" aria-label={`${group.label} tag pages`}><button type="button" className="btn" disabled={!tagPage} onClick={()=>setOptionPage(tagPage-1)}>Previous tags</button><span className="meta">{options.length.toLocaleString()} tags · {tagPage+1}/{Math.ceil(options.length/OPTIONS_PER_PAGE)}</span><button type="button" className="btn" disabled={(tagPage+1)*OPTIONS_PER_PAGE>=options.length} onClick={()=>setOptionPage(tagPage+1)}>Next tags</button></nav>}
   {!options.length&&<p className="meta">No listed tags match this search.</p>}
   {CUSTOM.has(group.id)&&<form className="pe-custom-tag" onSubmit={e=>{e.preventDefault();const value=custom.trim().toLowerCase().replace(/\s*[x×]\s*/g,'x');if(!value)return;const previous=tags[group.id]??[];if(update(group.id,group.multiple?[...new Set([...previous,value])]:[value]))setCustom('');}}>
    <label htmlFor={`${id}-custom`}>{group.id==='size'?'Another nominal size':group.id==='height'?'Another measured height (plates)':group.id==='studs'?'Another top-stud count':'Another visible feature'}</label>
    {group.id==='size'&&<p className="meta">Standard footprints use studs; wheel catalog dimensions may use millimeters.</p>}
    <div className="row"><input id={`${id}-custom`} className="pe-search" value={custom} maxLength={80} onChange={e=>setCustom(e.target.value)} placeholder={group.id==='size'?'e.g. 1x5…':group.id==='height'?'e.g. 2.5…':group.id==='studs'?'e.g. 12…':'e.g. grille…'} autoComplete="off"/><button className="btn" disabled={!custom.trim()}>Add tag</button></div>
   </form>}
   {error&&<p role="alert" className="pe-tag-error">{error}</p>}
  </fieldset>;
 const pill=(g:typeof PART_TAG_GROUPS[number])=>{
  const values=tags[g.id]??[],labels=values.map(v=>{const name=g.options.find(o=>o.value===v)?.label??facets?.[g.id]?.find(o=>o.value===v)?.label??v;return name===v?tagValueLabel(v):name;});
  return <div className={`pe-tag-group${open===g.id?' is-open':''}`} key={g.id}><button id={`${id}-${g.id}-toggle`} type="button" className={`pe-tag${values.length?' has-value':''}${open===g.id?' editing':''}`} aria-expanded={open===g.id} aria-controls={`${id}-${g.id}-panel`} onClick={()=>panel(g.id)}>
   <span>{g.label}</span><b>{labels.length?labels.join(' · '):'Not sure'}</b><span className="pe-tag-chevron" aria-hidden="true">{open===g.id?'−':'+'}</span>
  </button><div id={`${id}-${g.id}-panel`} role="region" aria-labelledby={`${id}-${g.id}-toggle`} hidden={open!==g.id}>{open===g.id&&renderPanel()}</div></div>;
 };
 return <section className="pe-tags" aria-label="Piece feature tags">
  <div className="pe-section-heading"><h4>Describe your piece</h4><button type="button" className="linkbtn" disabled={!Object.values(tags).some(v=>v?.length)} onClick={()=>{onChange({},null);setError('');}}>Clear all</button></div>
  <p className="meta">AI guesses help order the choices. Change a feature to filter by your observation, or remove it to broaden the choices.</p>
  <div className="pe-filter-summary">
   <p className="meta" role="status">{selectedCount} {selectedCount===1?'feature':'features'} selected{Object.values(guesses).some(v=>v?.length)?` · ${Object.values(guesses).reduce((n,v)=>n+(v?.length??0),0)} AI guesses`:''}</p>
   <ul className="pe-filter-chips" aria-label="Selected feature filters">{PART_TAG_GROUPS.flatMap(g=>(tags[g.id]??[]).map(value=>{
    const label=g.options.find(o=>o.value===value)?.label??facets?.[g.id]?.find(o=>o.value===value)?.label??tagValueLabel(value);
    return <li key={`${g.id}:${value}`}><button type="button" className="pe-filter-chip" aria-label={`Remove ${g.label.toLowerCase()}: ${label}`} onClick={()=>update(g.id,(tags[g.id]??[]).filter(v=>v!==value))}>
     {g.id==='color'&&Object.hasOwn(COLORS,value)&&<span aria-hidden="true" className="pe-tag-swatch" style={{background:COLORS[value as ColorName]}}/>}<span><small>{guesses[g.id]?.includes(value)?'AI guess · ':''}{g.label}:</small> {label}</span><span aria-hidden="true">×</span>
    </button></li>;
   }))}</ul>
  </div>
  <div className="pe-tag-grid">{PART_TAG_GROUPS.filter(g=>COMMON.has(g.id)).map(pill)}</div>
  <button type="button" className="pe-more-tags linkbtn" aria-expanded={more} aria-controls={`${id}-more`} onClick={()=>{setMore(!more);if(more&&open&&!COMMON.has(open))setOpen(null);}}>{more?'Fewer feature tags':'More feature tags'} <span aria-hidden="true">{more?'−':'+'}</span></button>
  <div id={`${id}-more`} hidden={!more} className="pe-tag-grid pe-advanced-tags">{PART_TAG_GROUPS.filter(g=>!COMMON.has(g.id)).map(pill)}</div>

 </section>;
}
