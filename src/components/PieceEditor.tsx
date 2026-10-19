import {useEffect,useId,useRef,useState} from 'react';
import {COLORS,type ColorName,type PartKind} from '../lib/bricks';
import {isViablePiece} from '../lib/piece-gallery';
import {nativeKindForCatalog,partInfo,shapeName} from '../lib/catalog';
import type {Box,Photo,Resolution,CatalogMatch,ConfidenceRecord} from '../lib/inventory';
import {pieceConfidence} from '../lib/piece-confidence';
import type {PieceReviewEvidence} from '../lib/piece-review-evidence';
import type {PieceReviewRow} from '../lib/piece-review';
import type {PartTags,PartTagGroupId} from '../lib/part-tags';
import {recolorPieceChoice,pieceChoiceResolution,pieceChoiceCatalog,type PiecePickerChoice} from '../lib/piece-picker-choice';
import {initialPieceGuessState,editPieceGuessState,manualPieceTags} from '../lib/piece-guess-tags';
import {PieceCrop} from './PieceCrop';
import {CatalogImage,type CatalogImagePart} from './CatalogImage';
import {PartTagFilters,type PartTagFacets} from './PartTagFilters';
import {PiecePhotoEvidence} from './PiecePhotoEvidence';
import {unfinishedCloseUp} from '../lib/scan-unfinished';
export {PieceCrop} from './PieceCrop';

interface CatalogPart extends CatalogImagePart {name:string;category:string;pop:number;look:string|null;inColor:boolean;matchReasons?:string[];matchCautions?:string[]}
interface Matches {key:string;parts:CatalogPart[];count:number;total:number;offset:number;limit:number;hasMore:boolean;nextOffset:number|null;facets?:PartTagFacets;catalog?:{snapshotDate?:string|null};recommendation:{evidence:string[];needsMoreEvidence:boolean;method?:string}}
const label=(k:PartKind)=>partInfo(k.partId)?.name??shapeName(k);
const PAGE_SIZE=24;
const briefReason=(s:string)=>s.replace(/^(?:Selected |AI guessed )/,'').replace(/ (?:is supported by (?:the )?saved catalog (?:description|evidence)\.|matches saved catalog evidence; not confirmation\.)$/,'').replace(/^Exact queried mold number;.*$/,'Exact part number').replace(/^Exact saved element identifier.*$/,'Exact element number').replace(/^size: (.*)$/,'$1 footprint').replace(/^height: (.*)$/,'$1 plates high').replace(/^studs: (.*)$/,'$1 top studs');
const briefCaution=(s:string)=>s.replace(/^Catalog metadata does not establish (.*?);.*$/,'$1: not listed — check the photo');
const comparisonCaution=(p:CatalogPart)=>{
 const conflict=p.matchCautions?.find(c=>c.includes('conflicts with saved catalog evidence'));
 if(conflict)return conflict.replace(/^AI guessed ([^:]+):.*$/,'Check $1: differs from the scan guess.');
 return !p.inColor?'Reference color differs.':'';
};

/** One tag-driven, paginated full-catalog picker. Tags never confirm a reading;
 * only the existing parent-owned exact observation/group action changes stock. */
export function PieceEditor({photo,box,current,onApply,onClose,quantity=1,onSkip,reviewLabel,reviewError,onRefresh,copies,onReviewCopy}:{
 photo?:Photo;box?:Box;
 current:ConfidenceRecord&{kind?:PartKind;description:string;color:string;unknown?:boolean;catalog?:CatalogMatch;confidence?:number;confirmed?:boolean;reviewEvidence?:PieceReviewEvidence};
 onApply:(r:Resolution,selected?:PieceReviewRow[])=>void;onClose:()=>void;
 quantity?:number;onSkip?:()=>void;reviewLabel?:string;reviewError?:string;onRefresh?:()=>void;
 copies?:{row:PieceReviewRow;photo?:Photo}[];onReviewCopy?:(row:PieceReviewRow)=>void;
}){
 const ref=useRef<HTMLDialogElement>(null),matchHeading=useRef<HTMLHeadingElement>(null),titleId=useId();
 useEffect(()=>{ref.current?.showModal();},[]);
 const [tagState,setTagState]=useState(()=>initialPieceGuessState(current.color,current.confirmed?undefined:current.reviewEvidence)),[choice,setChoice]=useState<PiecePickerChoice|null>(()=>current.catalog?{catalog:current.catalog}:current.kind?{kind:current.kind}:null);
 const {tags,guesses}=tagState;
 const [expanded,setExpanded]=useState(false);
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[retry,setRetry]=useState(0),[results,setResults]=useState<Matches|null>(null),[facets,setFacets]=useState<PartTagFacets>(),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [selectedCopies,setSelectedCopies]=useState(()=>new Set(copies?.flatMap(({row},i)=>row.confirmedCount===0?[i]:[])??[])),[copyPage,setCopyPage]=useState(0);
 const selectedRows=copies?.filter((_,i)=>selectedCopies.has(i)).map(c=>c.row),selectedQuantity=selectedRows?.reduce((n,row)=>n+row.quantity,0)??quantity;
 const color=tags.color?.[0]??'',tagJSON=JSON.stringify(manualPieceTags(tagState)),guessJSON=JSON.stringify(guesses),requestKey=JSON.stringify([tagJSON,guessJSON,query,page,retry,expanded]);
 const matches=results?.key===requestKey?results:null;
 const estimate=pieceConfidence(current);
 useEffect(()=>{
  const ctl=new AbortController();let live=true;setLoading(true);setError('');
  const params=new URLSearchParams({recommend:'1',tags:tagJSON,guesses:guessJSON,q:expanded?query:'',offset:String(page*PAGE_SIZE),limit:String(PAGE_SIZE),color,shortlist:expanded?'0':'1'});
  const timer=setTimeout(()=>{
   fetch(`/api/parts?${params}`,{signal:ctl.signal}).then(async response=>{
    const data=await response.json();if(!response.ok)throw Error(data.error??'Could not load matching pieces.');
    if(!Array.isArray(data.parts)||data.parts.length>PAGE_SIZE||!Number.isSafeInteger(data.count)||data.count<0||data.offset!==page*PAGE_SIZE||data.limit!==PAGE_SIZE||typeof data.hasMore!=='boolean'||!data.recommendation||!Array.isArray(data.recommendation.evidence))throw Error('The matching-pieces response was incomplete.');
    return data as Omit<Matches,'key'>;
   }).then(data=>{if(live){setResults({...data,key:requestKey});if(data.facets)setFacets(data.facets);}})
   .catch(e=>{if(live&&!ctl.signal.aborted)setError((e as Error).message);})
   .finally(()=>{if(live)setLoading(false);});
  },180);
  return()=>{live=false;clearTimeout(timer);ctl.abort();};
 },[tagJSON,guessJSON,query,page,color,requestKey,expanded]);
 const changeTags=(next:PartTags,editedGroup:PartTagGroupId|null)=>{
  const withoutColor=(value:PartTags)=>JSON.stringify(Object.entries(value).filter(([key])=>key!=='color'));
  const colorOnly=withoutColor(next)===withoutColor(tags);
  setTagState(previous=>editPieceGuessState(previous,next,editedGroup));setChoice(previous=>colorOnly?recolorPieceChoice(previous,next.color?.[0]??''):null);setPage(0);
 };
 const goPage=(next:number)=>{setPage(next);matchHeading.current?.focus({preventScroll:true});matchHeading.current?.scrollIntoView({block:'start'});};
 const select=(p:CatalogPart)=>{
  setChoice({catalog:{num:p.num,name:p.name,color}});
 };
 const chosenKind=choice&&'kind'in choice?choice.kind:null;
 const chosenCatalogKind=choice&&'catalog'in choice?nativeKindForCatalog(choice.catalog.num,choice.catalog.color):null;
 const chosenNum=choice?pieceChoiceCatalog(choice)?.num:undefined;
 const chosenName=chosenKind?label(chosenKind):choice&&'catalog'in choice?choice.catalog.name:'';
 const exactColor=!!color&&Object.hasOwn(COLORS,color);
 const chosenColor=chosenKind?.color??(choice&&'catalog'in choice?choice.catalog.color:'');
 const resolution=pieceChoiceResolution(choice,color);
 const canApply=!reviewError&&selectedQuantity>0&&!!resolution;
 const apply=()=>{if(canApply&&resolution)onApply(resolution,selectedRows);};
 const supported=!!(chosenKind&&isViablePiece(chosenKind)||chosenCatalogKind&&isViablePiece(chosenCatalogKind));
 const showCatalog=()=>{setExpanded(true);setPage(0);};
 return <dialog ref={ref} className="sheet piece-editor pe-tag-editor" aria-labelledby={titleId} onClose={onClose}>
  <div className="pe-head">
   <div><div className="kicker">{reviewLabel??'Review piece'}</div><h3 id={titleId}>{current.kind?label(current.kind):'Find this piece'}</h3>
    {copies?<p className="meta">Check the matching copies below, then apply one exact match.</p>:<><p className={`confidence-badge confidence-${estimate.tone}`} title={estimate.detail}>{estimate.label}{estimate.score===null?'':` · ${Math.floor(estimate.score*100)}%`}</p>{estimate.confirmed&&<span className="confidence-checked">Checked by you</span>}</>}
    <p className="meta">Compare your piece with the choices below. Select its exact shape and color to confirm.</p>
    {unfinishedCloseUp(current.description)&&<p className="pe-review-reason">Its close-up check didn’t finish. Leave it unconfirmed to use “Retry unfinished pieces” on Your parts.</p>}
   </div>
  </div>
  {reviewError&&<div className="banner" role="alert"><span>{reviewError}</span>{onRefresh&&<button className="btn" onClick={onRefresh}>Review latest reading</button>}</div>}
      {copies&&<section className="pe-copy-review" aria-label="Choose matching copies">
        <h4>Apply one match to these pieces</h4>
        <p className="meta">{selectedQuantity} of {quantity} pieces selected. Uncheck anything that looks different, or open it separately. Previously checked copies start unselected. New scan arrivals are reviewed later.</p>
        <div className="row"><button className="btn" onClick={()=>setSelectedCopies(new Set(copies.map((_,i)=>i)))}>Select all {quantity} pieces</button><button className="btn" onClick={()=>setSelectedCopies(new Set())}>Clear selection</button></div>
        <div className="pe-copies">{copies.slice(copyPage*12,(copyPage+1)*12).map(({row,photo},j)=>{const i=copyPage*12+j;return <div key={row.key} className={`pe-copy confidence-${row.confidence.tone}`}>
          <label><input type="checkbox" checked={selectedCopies.has(i)} onChange={e=>setSelectedCopies(s=>{const next=new Set(s);if(e.target.checked)next.add(i);else next.delete(i);return next;})}/><span>{photo&&row.box?<PieceCrop url={photo.url} box={row.box} size={144}/>:<span className="meta">No individual photo · {row.quantity} {row.quantity===1?'piece':'copies'}</span>}<b>Piece {i+1}{row.quantity>1?` · ${row.quantity} copies`:''}</b><small className="meta">{row.confidence.score===null?'No scan score':`${Math.floor(row.confidence.score*100)}% scan confidence`}{row.confirmedCount?` · ${row.confirmedCount} already checked`:''}</small></span></label>
          {onReviewCopy&&<button className="linkbtn" onClick={()=>onReviewCopy(row)}>Review separately</button>}
        </div>;})}</div>
        {copies.length>12&&<nav className="row" aria-label="Matching copy pages"><button className="btn" disabled={!copyPage} onClick={()=>setCopyPage(p=>p-1)}>Previous copies</button><span className="meta">Page {copyPage+1} of {Math.ceil(copies.length/12)}</span><button className="btn" disabled={(copyPage+1)*12>=copies.length} onClick={()=>setCopyPage(p=>p+1)}>Next copies</button></nav>}
      </section>}
  <div className="pe-workspace pe-comparison">
  <aside className="pe-observation">
   {photo&&box?<PiecePhotoEvidence photo={photo} box={box}/>:<p className="meta">No individual photo saved. Compare with the physical piece.</p>}
   <label className="pe-label" htmlFor={`${titleId}-color`}>Observed color</label>
   <select id={`${titleId}-color`} value={color} onChange={e=>changeTags({...tags,color:e.target.value?[e.target.value]:[]},'color')}>
    <option value="">Not sure</option>{Object.keys(COLORS).map(c=><option key={c} value={c}>{c.replaceAll('-',' ')}</option>)}
   </select>
  </aside>
  <section className="pe-matches" aria-label="Matching catalog pieces">
   <div className="pe-section-heading"><h4 ref={matchHeading} tabIndex={-1}>{expanded?'Search the full catalog':'Compare likely matches'}</h4>{expanded&&<button type="button" className="linkbtn" onClick={()=>{setExpanded(false);setQuery('');setPage(0);}}>Back to five choices</button>}</div>
   {expanded?<>
    <label className="pe-label" htmlFor={`${titleId}-search`}>Part name or number <span className="meta">(optional)</span></label>
    <input id={`${titleId}-search`} className="pe-search" value={query} maxLength={256} onChange={e=>{setQuery(e.target.value);setChoice(null);setPage(0);}} placeholder="Search any part or element number…" autoComplete="off"/>
    <details className="pe-refine"><summary>Refine shape, size and other features</summary><p className="meta">AI guesses guide the first choices. Correct or remove any tag; your edits take priority. Picking a match won’t add tags.</p><PartTagFilters tags={tags} guesses={guesses} facets={facets} onChange={changeTags}/></details>
   </>:<p className="meta">Up to five shapes to compare. Similar printed versions are grouped out unless your scan suggests a print.</p>}
   <div className="pe-result-status" role="status" aria-live="polite">
    {loading||!matches&&!error?'Updating matches…':error?'':matches?.count?expanded?`${matches.offset+1}–${matches.offset+matches.parts.length} of ${matches.count.toLocaleString()} matches · page ${page+1} of ${Math.max(1,Math.ceil(matches.count/PAGE_SIZE))}`:`${matches.parts.length} possible matches · check against your photo`:'No matching catalog pieces.'}
   </div>
   {error&&<p className="pe-tag-error" role="alert">{error} <button className="linkbtn" onClick={()=>setRetry(n=>n+1)}>Retry matching pieces</button></p>}
   {!loading&&matches&&<>
    {matches.recommendation.needsMoreEvidence&&<p className="meta">There isn’t enough detail for a strong match. Search by size or a visible feature, or take a closer look at the piece.</p>}
    {!matches.count&&<p className="meta">Try clearing an uncertain tag. To find an exact number outside these tags, clear all tags and search again.</p>}
    <div className={`pe-grid pe-match-grid${expanded?'':' pe-shortlist'}`} aria-label="Ranked piece matches">
     {matches.parts.map(p=><button key={p.num} type="button" className={`pe-option${chosenNum===p.num?' on':''}`} aria-pressed={chosenNum===p.num} onClick={()=>select(p)}>
      <CatalogImage key={`${p.num}:${color}`} part={p} color={(color||'light-gray') as ColorName} size={expanded?84:160}/>
      <span><b>{p.name}</b><small className="meta">#{p.num} · {p.category}</small>{!!p.matchReasons?.length&&<small className="pe-match-reasons">{p.matchReasons.slice(0,3).map(briefReason).join(' · ')}</small>}{expanded?!!p.matchCautions?.filter(c=>!c.startsWith('Catalog candidate only;')).length&&<small className="meta">{p.matchCautions.filter(c=>!c.startsWith('Catalog candidate only;')).slice(0,2).map(briefCaution).join(' · ')}</small>:<small className="meta">{comparisonCaution(p)}</small>}</span>
     </button>)}
    </div>
    {expanded&&!!matches.count&&<nav className="row pe-pagination" aria-label="Matching piece pages"><button className="btn" disabled={page===0} onClick={()=>goPage(page-1)}>Previous matches</button><span className="meta">Page {page+1} of {Math.max(1,Math.ceil(matches.count/PAGE_SIZE))}</span><button className="btn" disabled={!matches.hasMore} onClick={()=>goPage(page+1)}>Next matches</button></nav>}
    {expanded&&<p className="pe-catalog-note meta">Searches {matches.total?.toLocaleString()} catalog records{matches.catalog?.snapshotDate?` · saved ${matches.catalog.snapshotDate}`:''}. Tags are catalog descriptions; an unlisted feature needs checking against the photo.</p>}
   </>}
   {!expanded&&<button type="button" className="btn pe-expand-search" onClick={showCatalog}>None of these? Search all pieces</button>}
  </section>
  </div>
  {choice?<div className="pe-selected" role="status"><b>Selected: {chosenName}{chosenNum?` · #${chosenNum}`:''}</b><span>{!exactColor?'Choose the observed color before confirming.':chosenColor!==color?'The selected match has a different color. Select the observed color again or choose another match before confirming.':supported?'Confirming this exact match makes the selected copies available to the builder.':'The exact catalog match will be saved. This mold/color stays out of builds until supported.'}</span></div>:<p className="pe-selection-hint meta">Select the matching shape, then confirm its color.</p>}
  <div className="row pe-actions">
   <button className="linkbtn" disabled={!!reviewError||selectedQuantity===0} onClick={()=>onApply({remove:true},selectedRows)}>{copies?`Remove ${selectedQuantity} selected pieces`:'Not a part'}</button><span className="grow"/>
   <button className="btn" onClick={()=>ref.current?.close()}>{onSkip?'Close review':'Leave unconfirmed'}</button>{onSkip&&<button className="btn" onClick={onSkip}>Skip for now</button>}
   <button className="btn primary" disabled={!canApply} onClick={apply}>{copies?`Apply match to ${selectedQuantity} pieces`:current.kind&&chosenKind?.partId===current.kind.partId?'Confirm this piece':'Use selected piece'}</button>
  </div>
 </dialog>;
}
