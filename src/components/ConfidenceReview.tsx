import {useState} from 'react';
import {PieceThumbnail} from './PieceCrop';
import {partIcon} from '../lib/render';
import {confirmedCatalogKind,type Photo} from '../lib/inventory';
import {nativeKindForCatalog} from '../lib/catalog';
import type {PieceReviewRow} from '../lib/piece-review';
import {pieceReviewGroups,type PieceReviewGroup} from '../lib/piece-review-groups';
import {PIECE_CONFIDENCE_LEGEND,type PieceConfidenceResult} from '../lib/piece-confidence';
export function ConfidenceBadge({value}:{value:PieceConfidenceResult}){return <span className={`confidence-badge confidence-${value.tone}`} title={value.detail}>{value.score===null?'No scan score':`${Math.floor(value.score*100)}% · ${value.tone} confidence`}</span>;}
export function ConfidenceReview({rows,onReview,onReviewGroup,onReviewAll,scanning=false,photos=[]}:{rows:PieceReviewRow[];onReview:(r:PieceReviewRow)=>void;onReviewGroup?:(group:PieceReviewGroup)=>void;onReviewAll:()=>void;scanning?:boolean;photos?:Photo[]}){
 const [filter,setFilter]=useState('all'),[page,setPage]=useState(0);
 const total=rows.reduce((n,r)=>n+r.quantity,0),matched=rows.filter(r=>r.matched).reduce((n,r)=>n+r.quantity,0),checked=rows.reduce((n,r)=>n+r.confirmedCount,0);
 const filters=[['all','All pieces'],['high','High · 85–100%'],['medium','Medium · 60–84%'],['low','Low · below 60%'],['unknown','No score'],['unmatched','Needs catalog match'],['checked','Checked by you']];
 const accepts=(r:PieceReviewRow,key:string)=>key==='all'||(key==='unmatched'?!r.matched:key==='checked'?r.confirmedCount>0:r.confidence.tone===key);
 const visible=pieceReviewGroups(rows.filter(r=>accepts(r,filter))),last=Math.max(0,Math.ceil(visible.length/24)-1),current=Math.min(page,last);
 return <section className="confidence-review" aria-label="Piece confidence review">
  <div className="confidence-heading"><div><h3>Piece confidence review</h3><p className="meta">{total} observed · {matched} matched to a catalog piece · {checked} checked by you</p></div><button className="btn" disabled={!rows.length} onClick={onReviewAll}>{scanning?'Review detected so far':'Review every piece'}</button></div>
  <p className="meta">{PIECE_CONFIDENCE_LEGEND} You can correct any reading, including a confident one. Gray means the original score was not recorded.</p>
  <p className="meta">Matching predictions are grouped by piece and color. Review their photos and apply one choice to the selected copies. Unidentified pieces stay separate.</p>
  {scanning&&<p className="live-review-note" role="status">Pieces appear as they are found. You can review them now; your saved corrections are protected from later scan results.</p>}
  <div className="confidence-filters" role="group" aria-label="Filter by confidence">{filters.map(([key,label])=><button key={key} className={`confidence-filter confidence-${key}`} aria-pressed={filter===key} onClick={()=>{setFilter(key);setPage(0);}}>{label}<b>{rows.filter(r=>accepts(r,key)).reduce((n,r)=>n+r.quantity,0)}</b></button>)}</div>
  {total>matched&&<p className="banner" role="status">{total-matched} {total-matched===1?'observation still needs':'observations still need'} an exact catalog match. These pieces stay out of builds; you can continue with the usable pieces and review the rest later. If an outline is not a piece, remove it.</p>}
  <div className="confidence-grid">{visible.slice(current*24,(current+1)*24).map(group=>{
   const r=group.rows[0],mixed=group.rows.some(row=>row.confidence.tone!==r.confidence.tone),differentScores=group.rows.some(row=>row.confidence.score!==r.confidence.score);
   const photo=photos.find(p=>p.id===r.photo),hasCrop=!!photo&&!!r.box;
   const displayKind=r.kind??(r.other?.catalog?nativeKindForCatalog(r.other.catalog.num,r.other.color):null);
   const catalogAvailable=group.rows.filter(row=>row.other&&confirmedCatalogKind(row.other)).reduce((n,row)=>n+row.quantity,0);
   return <article className={`confidence-card confidence-${mixed?'unknown':r.confidence.tone}`} key={group.key}>
    <div className="confidence-piece"><PieceThumbnail partId={displayKind?.partId} photo={photo} box={r.box} number={r.other?.catalog?.num}/><div>{r.box&&<small className="confidence-match-label">{group.confirmedCount===group.quantity?'Checked match':r.matched?'Proposed match':'Scanner description'}</small>}<b>{group.quantity>1?`${group.quantity}× `:''}{r.label}</b><span className="meta">{r.color.replaceAll('-',' ')}{r.other?.catalog?` · #${r.other.catalog.num}`:''}</span></div></div>
    {group.rows.length>1&&<div className="confidence-group-photos" aria-label="Photos of matching predictions">{group.rows.slice(1,4).map(row=><PieceThumbnail key={row.key} partId={row.partId} photo={photos.find(p=>p.id===row.photo)} box={row.box} number={row.other?.catalog?.num}/>)}{group.rows.length>4&&<span className="meta">+{group.rows.length-4} more</span>}</div>}
    {r.kind&&hasCrop&&<div className="confidence-catalog-reference"><img src={partIcon(r.kind.partId)} alt=""/><span>Catalog image of {r.confirmedCount?'checked':'proposed'} match</span></div>}
    {r.box&&!photo&&<p className="meta">Original photo unavailable for this observation.</p>}
    <div className="confidence-status">{differentScores?(['high','medium','low','unknown'] as const).map(tone=>{const n=group.rows.filter(row=>row.confidence.tone===tone).reduce((n,row)=>n+row.quantity,0);return n?<span key={tone} className={`confidence-badge confidence-${tone}`}>{n} {tone==='unknown'?'without a score':`${tone} confidence`}</span>:null;}):<ConfidenceBadge value={r.confidence}/>} {group.confirmedCount>0&&<span className="confidence-checked">{group.confirmedCount===group.quantity?'Checked by you':`${group.confirmedCount} checked by you`}</span>}</div>
    {group.quantity>1&&<p className="meta">{group.quantity-group.confirmedCount} to review · choose matching copies together or review one separately.</p>}
    {group.rows.some(row=>row.quantity>1&&!row.box)&&<p className="meta">Shared reading for this group; check each copy and its count.</p>}
    {!r.matched?<p className="meta">Exact catalog match needed</p>:r.other?<p className="meta">{catalogAvailable?catalogAvailable===group.quantity?'Available in builds':`${catalogAvailable} of ${group.quantity} available in builds`:displayKind?'Builder supported · confirm the exact match':'Identified · not yet supported in builds'}</p>:null}
    <button className="linkbtn" onClick={()=>onReviewGroup?onReviewGroup(group):onReview(r)} aria-label={`Review ${r.label} ${r.color}`}>{group.quantity>1?`Review ${group.quantity} matching pieces`:'Review or correct'}</button>
   </article>;
  })}</div>
  {!visible.length&&<p className="meta">No pieces in this group.</p>}
  {visible.length>24&&<nav className="row" aria-label="Piece review pages"><button className="btn" disabled={!current} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous pieces</button><span className="meta">Page {current+1} of {last+1}</span><button className="btn" disabled={current===last} onClick={()=>setPage(current+1)}>Next pieces</button></nav>}
 </section>;
}
