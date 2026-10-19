import { useEffect, useMemo, useRef, useState } from 'react';
import type { Build } from '../lib/bricks';
import { BUILD_ATLAS, ATLAS_GROUPS } from '../lib/build-atlas/catalog';
import { assessAtlas, ideaFromAssessment, searchAssessments } from '../lib/build-atlas/matching';
import { atlasSeenIds } from '../lib/build-atlas/history';
import { ATLAS_SAVED_EVENT, atlasDesignSummaries, savedAtlasDesigns, type AtlasDesign, type AtlasDesignSummary } from '../lib/build-atlas/cache';
import { IDEA_FAMILIES, type IdeaFamily } from '../lib/shape-first/discovery';
import type { ShapeIdea, ShapeMode } from '../lib/shape-first/pipeline';
import type { AtlasAssessment } from '../lib/build-atlas/types';
import {recommendationStockKey,type StockEvidence} from '../lib/shape-first/stock-evidence';
import { Arrow } from './Icons';
import './idea-atlas.css';

const LABELS:Record<IdeaFamily,string>={objects:'Everyday objects',architecture:'Buildings',machines:'Machines',watercraft:'Boats & ships',aircraft:'Aircraft & space',vehicles:'Ground transport',nature:'Nature',animals:'Animals',characters:'Characters',scenes:'Scenes'};
const PAGE=12;
const params=()=>new URLSearchParams(typeof location==='undefined'?'':location.search);

export function IdeaAtlas({stock,evidence,mode='pile',busy=false,onChoose,onOpen}:{stock:Record<string,number>;evidence?:StockEvidence;mode?:ShapeMode;busy?:boolean;onChoose:(idea:ShapeIdea)=>void;onOpen:(build:Build)=>void}) {
  const [query,setQuery]=useState(()=>params().get('atlasQ')??''),[family,setFamily]=useState<IdeaFamily|''>(()=>{const f=params().get('atlasFamily');return f&&Object.hasOwn(IDEA_FAMILIES,f)?f as IdeaFamily:'';}),
    [category,setCategory]=useState(''),[fit,setFit]=useState<'all'|'promising'|'adapt'|'needs-parts'|'saved'>('all'),
    [page,setPage]=useState(()=>Math.max(0,Math.min(1000,(Number(params().get('atlasPage'))||1)-1))),[related,setRelated]=useState('');
  const [approaches,setApproaches]=useState<Record<string,string>>({}),[version,setVersion]=useState(0),[chosen,setChosen]=useState<Set<string>>(new Set());
  const stockKey=mode+recommendationStockKey(stock,evidence);
  const previousStock=useRef(stockKey);
  const [summaries,setSummaries]=useState<AtlasDesignSummary[]>([]);
  useEffect(()=>{let active=true;atlasDesignSummaries().then(s=>{if(active)setSummaries(s);}).catch(()=>{if(active)setSummaries([]);});return()=>{active=false;};},[version]);
  useEffect(()=>{if(previousStock.current!==stockKey){previousStock.current=stockKey;setChosen(new Set());setPage(0);}},[stockKey]);
  const assessments=useMemo(()=>assessAtlas(stock,undefined,{confidence:evidence?.confidenceById}),[stock,evidence]);
  const ordered=useMemo(()=>searchAssessments(fit==='saved'?assessments.filter(a=>summaries.some(s=>s.briefId===a.brief.id)):assessments,
    {query,family:family||undefined,category:category||undefined,fit:fit==='saved'?'all':fit,relatedTo:related||undefined,limit:assessments.length}),[assessments,query,family,category,fit,related,summaries]);
  const result={...ordered,matches:ordered.matches.slice(page*PAGE,(page+1)*PAGE)};
  const pages=Math.max(1,Math.ceil(result.total/PAGE)),current=Math.min(page,pages-1);
  useEffect(()=>{if(page>=pages)setPage(pages-1);},[page,pages]);
  const key=stockKey+':'+result.matches.map(a=>a.brief.id).join('|');
  const [cache,setCache]=useState<{key:string;designs:Map<string,AtlasDesign>}>({key:'',designs:new Map()});
  useEffect(()=>{
    let active=true;savedAtlasDesigns(stock,result.matches.map(a=>a.brief.id)).then(designs=>{if(active)setCache({key,designs});}).catch(()=>{if(active)setCache({key,designs:new Map()});});
    return ()=>{active=false;};
  },[key,version]);
  useEffect(()=>{const changed=()=>setVersion(v=>v+1);window.addEventListener(ATLAS_SAVED_EVENT,changed);return()=>window.removeEventListener(ATLAS_SAVED_EVENT,changed);},[]);
  useEffect(()=>{const url=new URL(location.href);query?url.searchParams.set('atlasQ',query):url.searchParams.delete('atlasQ');family?url.searchParams.set('atlasFamily',family):url.searchParams.delete('atlasFamily');page?url.searchParams.set('atlasPage',String(page+1)):url.searchParams.delete('atlasPage');history.replaceState(null,'',url);},[query,family,page]);
  const seen=useMemo(()=>atlasSeenIds(mode,stock),[stockKey,version]);
  const matching=assessments.filter(a=>a.status!=='needs-parts').length,relatedBrief=BUILD_ATLAS.find(b=>b.id===related);
  const choose=(a:AtlasAssessment)=>{setChosen(s=>new Set([...s,a.brief.id]));onChoose(ideaFromAssessment(a,stock,approaches[a.brief.id]??a.brief.approaches[0].id,mode));};
  const enoughParts=Object.values(stock).reduce((n,k)=>n+k,0)>=20;
  const movePage=(next:number)=>{setPage(next);document.getElementById('atlas-heading')?.scrollIntoView({block:'start'});};
  return <section className="idea-atlas" aria-labelledby="atlas-heading">
    <div className="atlas-heading">
      <div><p className="card-kicker">The idea catalog</p><h3 id="atlas-heading">Choose what you want to build.</h3></div>
      <p className="meta">{BUILD_ATLAS.length.toLocaleString()} ideas · {ATLAS_GROUPS.length} categories{mode==='pile'&&Object.keys(stock).length?` · ${matching.toLocaleString()} with useful feature pieces`:''}</p>
    </div>
    <p className="atlas-intro">Search the whole catalog, then ask for a design around your pieces. Each idea includes the shape and features that make it recognizable.</p>
    <div className="atlas-filters">
      <label>Search ideas<input type="search" placeholder="Coffee maker, dragonfly, crane…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} /></label>
      <label>Family<select value={family} onChange={e=>{setFamily(e.target.value as IdeaFamily|'');setCategory('');setPage(0);}}><option value="">All families</option>{Object.keys(LABELS).map(f=><option key={f} value={f}>{LABELS[f as IdeaFamily]}</option>)}</select></label>
      <label>Category<select value={category} onChange={e=>{setCategory(e.target.value);setPage(0);}}><option value="">All categories</option>{ATLAS_GROUPS.filter(g=>!family||g.family===family).map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
      <label>Pieces<select value={fit} onChange={e=>{setFit(e.target.value as typeof fit);setPage(0);}}><option value="all">All ideas</option><option value="promising">Useful feature pieces</option><option value="adapt">Uses alternate shapes</option><option value="needs-parts">Has feature gaps</option><option value="saved">Saved designs</option></select></label>
    </div>
    {relatedBrief&&<div className="atlas-related"><span>Related to {relatedBrief.name}</span><button className="linkbtn" onClick={()=>{setRelated('');setPage(0);}}>Clear</button></div>}
    <p className="meta atlas-count" role="status">{result.total.toLocaleString()} {result.total===1?'idea':'ideas'}{query?` matching “${query}”`:''} · page {current+1} of {pages}</p>
    {!result.total&&<div className="atlas-empty"><p>No ideas match these filters.</p><button className="btn" onClick={()=>{setQuery('');setFamily('');setCategory('');setFit('all');setRelated('');setPage(0);}}>Show all ideas</button></div>}
    <div className="atlas-grid">
      {result.matches.map(a=>{
        const b=a.brief,saved=cache.key===key?cache.designs.get(b.id):undefined,explored=seen.has(b.id)||chosen.has(b.id);
        return <article key={b.id} className="atlas-card" data-brief-id={b.id}>
          <div className="atlas-card-top"><span>{LABELS[b.family]} · {b.category}</span>{explored&&<span>Explored</span>}</div>
          <h4>{b.name}</h4>
          <ul className="atlas-traits">{b.traits.map(t=><li key={t}>{t}</li>)}</ul>
          <div className="atlas-card-meta"><span>{b.parts[0]}–{b.parts[1]} piece target</span><span className={'atlas-fit '+a.status}>{saved?'Saved design · fits this pile':a.status==='promising'?'Useful feature pieces':a.status==='adapt'?'Alternate shapes needed':'Feature gaps'}</span></div>
          <details className="atlas-details"><summary>Shape, pieces & approaches</summary>
            <p>{b.silhouette}</p>
            {!!a.opportunity&&<><p>{a.reasons.slice(0,2).join(' ')}</p><p>Feature pieces and body material are reserved separately. Their arrangement and the finished subject still need a build check.</p>{a.opportunity.confidence.cautionPieces>0&&<p>Some reserved pieces have low scan confidence. Check those piece identifications before relying on this idea.</p>}</>}
            <ul>{b.features.map(f=><li key={f.name}><strong>{f.name}</strong> · {f.count} useful {f.types.join(' / ')} {f.required?'pieces':'details'}<br/><span>{f.substitution}</span></li>)}</ul>
            {!!a.missing.length&&<div className="atlas-gaps"><p>What needs attention</p><ul>{a.missing.map(m=><li key={m.name}>{m.name}: {m.available} of {m.count} useful pieces. {m.substitution}</li>)}</ul></div>}
            <label>Construction approach<select aria-label={`Approach for ${b.name}`} value={approaches[b.id]??b.approaches[0].id} onChange={e=>setApproaches(s=>({...s,[b.id]:e.target.value}))}>{b.approaches.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <p>{b.approaches.find(p=>p.id===(approaches[b.id]??b.approaches[0].id))?.plan}</p>
          </details>
          <div className="atlas-actions"><button className="linkbtn" onClick={()=>{setRelated(b.id);setQuery('');setFamily('');setCategory('');setFit('all');setPage(0);}}>More like this</button>
            {saved?<button className="btn primary" onClick={()=>onOpen(saved.build)}>Open instructions <Arrow /></button>:<button className="btn primary" disabled={busy||(mode==='pile'&&(!enoughParts||!a.palette.length))} onClick={()=>choose(a)}>Design this <Arrow /></button>}
          </div>
        </article>;
      })}
    </div>
    {result.total>PAGE&&<nav className="atlas-pagination" aria-label="Idea catalog pages"><button className="btn" disabled={current===0} onClick={()=>movePage(current-1)}>Previous</button><span>Page {current+1} of {pages}</span><button className="btn" disabled={current>=pages-1} onClick={()=>movePage(current+1)}>Next</button></nav>}
    <p className="meta atlas-footnote">Piece matches are estimates. “Design this” creates instructions and checks actual pieces, connections, and appearance. Successful designs are saved for another build.</p>
  </section>;
}
