import {ALL_MOLDS as POPULAR_MOLDS} from '../lib/popular-molds';
import { specialtyReviewNote, outlineOptions } from '../lib/specialty-review';
import {isMade, partInfo } from '../lib/catalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, COLORS, COLOR_NAMES, parsePartId, partId, type ColorName, type PartKind, type PartType } from '../lib/bricks';
import { observationNeedsReview, confirmedCatalogKind, colorCount, sortedEntries, totalParts, usableParts,needsReviewCount,pendingReviewCount, type Box,type InvEntry,type PartObservation, type Inventory, type OtherEntry, type Photo, type Resolution } from '../lib/inventory';
import { partIcon } from '../lib/render';
import {definition} from '../lib/connections';
import {ScanProgressPanel} from '../components/ScanProgress';
import {ConfidenceReview,ConfidenceBadge} from '../components/ConfidenceReview';
import {pieceReviewRows,observationConfidence,sameReviewObservation,type PieceReviewRow} from '../lib/piece-review';
import {pieceReviewGroups,pieceReviewGroupKey,type PieceReviewGroup} from '../lib/piece-review-groups';
import {pieceConfidence} from '../lib/piece-confidence';
import { Arrow, Camera, Plus } from '../components/Icons';
import { RequestBar } from '../components/RequestBar';
import { PieceCrop, PieceEditor } from '../components/PieceEditor';
import type { ScanProgress, Tile } from '../lib/scan';
import {unfinishedScanObservations} from '../lib/scan-unfinished';

export interface Scan {
  photo: number; status: 'scanning' | 'done' | 'error'; startedAt: number; lastProgressAt?:number; error?: string;
  phase: ScanProgress['phase']; tiles: Tile[]; estimate: number; sheets?: ScanProgress['sheets']; timedOutChecks?: number;
  recovery?: boolean;
}

const TYPE_LABEL: Record<PartType, string> = {
  ...Object.fromEntries(POPULAR_MOLDS.map(m=>[m.type,m.name])),
  halftile:'Half-round tiles',quarterroundtile:'Rounded corner tiles',offsetplate:'Offset-stud plates',roundjumper:'Round jumper plates',triangletile:'Triangular tiles',headlight:'Headlight bricks',invertedbracket:'Inverted brackets',
  endstudplate: 'End-stud plates', edgeplate: 'Edge-stud plates', quartertile: 'Macaroni tiles',
  sidebrick: 'Side-stud bricks', sidebricktall: 'Tall side-stud bricks', sidebrickadjacent: 'Adjacent side-stud bricks', sidebrickall: 'Four-side stud bricks', roundendplate: 'Round-ended plates', jumper: 'Jumper plates', bracket: 'Down brackets',
  wedgeleft: 'Left wedge plates', wedgeright: 'Right wedge plates', quarterplate: 'Rounded corner plates',
  brick: 'Bricks', plate: 'Plates', tile: 'Tiles', slope: 'Slopes', wheel: 'Wheels', wheels: 'Wheel pairs',
  curve: 'Curved slopes', invslope: 'Inverted slopes', cheese: 'Cheese slopes', roundbrick: 'Round bricks',
  roundplate: 'Round plates', roundtile: 'Round tiles', cone: 'Cones', arch: 'Arches',
  cornerplate: 'Corner plates', cornertile: 'Corner tiles', cornerbrick: 'Corner bricks',
};
const roundish = (n: number) => (n >= 1000 ? `${(Math.round(n / 100) * 100).toLocaleString()}` : n >= 100 ? `${Math.round(n / 10) * 10}` : `${n}`);
const ONE: Partial<Record<PartType, string>> = {
  sidebrick: 'side-stud brick', sidebricktall: 'tall side-stud brick', sidebrickadjacent: 'adjacent side-stud brick', sidebrickall: 'four-side stud brick', roundendplate: 'round-ended plate', jumper: 'jumper plate', bracket: 'down bracket',
  wedgeleft: 'left wedge plate', wedgeright: 'right wedge plate', quarterplate: 'rounded corner plate',
  slope: 'slope', curve: 'curved slope', invslope: 'inverted slope', cheese: 'cheese slope', roundbrick: 'round brick',
  roundplate: 'round plate', roundtile: 'round tile', cone: 'cone', arch: 'arch',
  cornerplate: 'corner plate', cornertile: 'corner tile', cornerbrick: 'corner brick',
};
const sizeLabel = (k: PartKind) => (k.type === 'wheel' ? 'wheel' : `${k.w}×${k.d}${ONE[k.type] ? ` ${ONE[k.type]}` : ''}`);

function useTicker(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set(n => n + 1), 1000); return () => clearInterval(t); }, [on]);
}

/** The "other" parts grouped by name, most common first. */
const otherNames = (others: { description: string }[]) => {
  const n = new Map<string, number>();
  for (const o of others) { const d = o.description.toLowerCase(); n.set(d, (n.get(d) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]);
};

export function Parts(props: {
  inv: Inventory; scans: Scan[];
  onCount: (id: string, n: number) => void; onAddPart: (k: PartKind) => void;
  onPhoto: (f: File) => void; onRetry: (photo: number) => void; onNext: () => void; onRequest: (text: string) => void;
  onRetryUnfinished?: () => void; recovering?: boolean; onStopRecovery?: () => void;
  /** Build by hand on the workbench, with the builder suggesting moves. */
  onBench: () => void;
  /** An angled photo of the pile, used only to cross-check the straight-down scan. */
  onAnglePhoto: (f: File) => void;
  /** The person says what an outlined extra piece is. */
  onResolve: (photo: number, box: Box, r: Resolution,expectedId?:string,onlyUncertain?:boolean,expectedObservation?:PartObservation) => boolean|void;
  onConfirmOutline: (observation: OtherEntry, partId: string) => void;
  onReviewType:(id:string,r:Resolution,onlyUncertain?:boolean,unboxedOnly?:boolean,quantity?:number,expectedEntry?:InvEntry)=>boolean|void;
  onReviewOther:(other:OtherEntry,r:Resolution)=>boolean|void;
  onReviewGroup?:(rows:PieceReviewRow[],r:Resolution)=>boolean|void;
}) {
  const { inv, scans } = props;
  const [hot, setHot] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // the one piece being changed, opened by tapping it on the photo
  const [edit, setEdit] = useState<{ photo?: Photo; box?: Box;entry?:InvEntry;id?:string;quantity?:number;group?:PieceReviewGroup;onlyUncertain?:boolean;unboxedOnly?:boolean;observationId?:string;photoId?:number;other?:OtherEntry;observation?:PartObservation;current: Parameters<typeof PieceEditor>[0]['current'] } | null>(null);
  const [reviewing,setReviewing]=useState(false);
  const [reviewError,setReviewError]=useState(''),[editVersion,setEditVersion]=useState(0);
  const rows=useMemo(()=>pieceReviewRows(inv),[inv]);
  const unfinished=useMemo(()=>[...unfinishedScanObservations(inv).values()].reduce((n,ds)=>n+ds.length,0),[inv]);
  const [allReview,setAllReview]=useState<{rows:PieceReviewRow[];index:number}|null>(null);
  const openSingleReviewRow=(r:PieceReviewRow,onlyUncertain=false)=>{
   setReviewError('');
   setEditVersion(v=>v+1);
   const photo=inv.photos.find(p=>p.id===r.photo),entry=r.partId?inv.parts[r.partId]:undefined,found=r.observation??(r.box&&entry?.boxes.find(b=>b.photo===r.photo&&b.box.every((v,i)=>v===r.box![i])));
   setEdit({entry,photo,photoId:r.photo,box:r.box,observation:r.observation,onlyUncertain,unboxedOnly:r.key.endsWith('@count'),id:r.box?undefined:r.partId,observationId:r.partId,other:r.other,quantity:r.quantity,current:{kind:r.kind,description:r.label,color:r.color,catalog:r.other?.catalog,unknown:r.other?.unknown,...(found?{...entry,...found}:r.other??entry),confirmed:r.confirmedCount===r.quantity,modelConfidence:r.confidence.score}});
  };
  const openReviewGroup=(group:PieceReviewGroup)=>{
   openSingleReviewRow(group.rows[0]);
   if(group.quantity>1&&props.onReviewGroup)setEdit(e=>e?{...e,group,quantity:group.quantity}:e);
  };
  const openReviewRow=(r:PieceReviewRow,onlyUncertain=false)=>{
   const group=pieceReviewGroups(rows).find(g=>g.key===pieceReviewGroupKey(r));
   if(group&&group.quantity>1&&!r.confirmedCount&&props.onReviewGroup)openReviewGroup(onlyUncertain?pieceReviewGroups(group.rows.filter(row=>!row.confirmedCount&&(row.entry?(row.observation?observationNeedsReview(row.entry,row.observation):needsReviewCount(row.entry)>0):row.confidence.score!==null&&row.confidence.score<.6)))[0]??group:group);
   else openSingleReviewRow(r,onlyUncertain);
  };
  const advanceReview=()=>{
   const completed=edit?.group?.rows??[];
   setReviewError('');setEdit(null);
   setAllReview(q=>q?{rows:q.rows.filter((row,i)=>i<=q.index||!completed.some(done=>sameReviewObservation(row,done))),index:q.index+1}:q);
  };
  useEffect(()=>{
   if(!allReview||edit)return;
   const index=allReview.rows.findIndex((queued,i)=>i>=allReview.index&&rows.some(r=>sameReviewObservation(r,queued)));
   if(index<0){setAllReview(null);return;}
   if(index!==allReview.index){setAllReview({...allReview,index});return;}
   openReviewRow(rows.find(r=>sameReviewObservation(r,allReview.rows[index]))!);
  },[allReview,edit,rows]);
  const editPart = (photo: Photo, box: Box, kind: PartKind,onlyUncertain=false,observation?:PartObservation) => {
   const row=rows.find(r=>r.partId===kind.partId&&(!observation||r.observation===observation)&&r.photo===photo.id&&r.box?.every((v,i)=>v===box[i])&&(!onlyUncertain||r.observation&&observationNeedsReview(inv.parts[kind.partId],r.observation)));
   if(row)openReviewRow(row,onlyUncertain);else setEdit({photo,photoId:photo.id,box,onlyUncertain,observationId:kind.partId,current:{kind,description:kind.partId,color:kind.color}});
  };
  const editOther = (_photo: Photo, _box: Box, o: OtherEntry) => {const row=rows.find(r=>r.other===o);if(row)openReviewRow(row);};
  const named = inv.others.filter(o => !o.unknown&&!confirmedCatalogKind(o));
  const supportedCatalogCount=inv.others.filter(o=>!!confirmedCatalogKind(o)).length;
  const unknown = inv.others.filter(o => o.unknown).length;
  const scanning = scans.some(s => s.status === 'scanning');
  const estimate = scans.reduce((n, s) => n + s.estimate, 0);
  useTicker(scanning);
  const entries = sortedEntries(inv);
  const types = (Object.keys(TYPE_LABEL) as PartType[]).filter(t => entries.some(e => e.kind.type === t));
  const total = totalParts(inv)+inv.others.length;
  const usable = usableParts(inv);
  const excluded=Math.max(0,total-usable);
  const pending=pendingReviewCount(inv);
  const seen = useRef(new Set<string>());
  const reviewNext=()=>{
    const entry=entries.find(e=>needsReviewCount(e)>0);
    if(entry){
      const box=entry.boxes.find(b=>observationNeedsReview(entry,b)),photo=box&&inv.photos.find(p=>p.id===box.photo);
      if(box&&photo)editPart(photo,box.box,entry.kind,true,box);
      else setEdit({entry,id:entry.kind.partId,quantity:needsReviewCount(entry),onlyUncertain:true,current:{kind:entry.kind,description:entry.kind.partId,color:entry.kind.color}});
      return true;
    }
    const other=rows.find(r=>!r.matched&&r.other);if(other){openReviewRow(other);return true;}
    return false;
  };
  useEffect(()=>{if(reviewing&&!edit&&!reviewNext())setReviewing(false);},[reviewing,edit,scanning,inv]);

  return (
    <main className="parts">
      {inv.photos.length > 0 && (
        <section className="photos">
          {inv.photos.map(ph => {
            const scan = scans.find(s => s.photo === ph.id);
            if (ph.ref) return (
              <div key={ph.id}>
                <figure className="photo angle-photo">
                  <img src={ph.url} alt="An angled photo of the same pile" />
                  {scan?.status === 'scanning' && (
                    <div className="scanning">Checking heights from this angle · {scan.sheets?.done ?? 0} of {scan.sheets?.total || '…'} {Math.round((Date.now() - scan.startedAt) / 1000)}s</div>
                  )}
                  {!scan && <div className="scanning waiting">Waiting for the count to finish</div>}
                </figure>
                <p className="meta angle-note">{scan?.status === 'error' ? `Couldn't check from this angle: ${scan.error}` : 'Angled photo: not counted, only used to check heights and spot stacked pieces.'}</p>
              </div>
            );
            return (
              <div key={ph.id}>
                <figure className="photo">
                  <img src={ph.url} alt="Your pile of bricks" />
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className={entries.reduce((n, e) => n + e.boxes.length, 0) > 120 ? 'dense' : ''}>
                    {scan?.status === 'scanning' && scan.tiles.map((t, i) => (
                      <rect key={`t${i}`} className={`tile-zone ${t.state}`} x={t.core[0]} y={t.core[1]} width={t.core[2]} height={t.core[3]} />
                    ))}
                    {/* every piece on its own, biggest first, so a small piece lying on a big plate is drawn on top and can be tapped */}
                    {[
                      ...entries.flatMap(e => e.boxes.filter(b => b.photo === ph.id).map(b => ({ box:b.box,e,observation:b,confidence:observationConfidence(e,b),o:undefined as OtherEntry|undefined }))),
                      ...inv.others.flatMap(o => o.boxes.filter(b => b.photo === ph.id).map(b => ({ box:b.box,observation:undefined,confidence:pieceConfidence(o),e:undefined as (typeof entries)[number]|undefined,o }))),
                    ].sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1])).map(({box,e,o,confidence,observation},i) => {
                      const [y0, x0, y1, x1] = box;
                      const outline = <>
                        <rect className="bx halo" x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="6" />
                        <rect className="bx line" x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="6" />
                      </>;
                      if (o) return (
                        <g key={`x${i}`} className={`extra confidence-${confidence.tone}${o.unknown ? ' unknown' : ''}${hot ? ' dim' : ''}`} onClick={() => editOther(ph, box, o)}>
                          <title>{o.unknown ? 'Not identified yet: tap to say what it is' : `${o.description}: not used in builds yet, tap to change`}</title>
                          {outline}
                        </g>
                      );
                      const k = `${ph.id}:${e!.kind.partId}`;
                      const enter = !seen.current.has(k);
                      seen.current.add(k);
                      return (
                        <g key={`p${i}`} className={`piece confidence-${confidence.tone} ${hot && hot !== e!.kind.partId ? 'dim' : ''} ${hot === e!.kind.partId ? 'hot' : ''} ${enter ? 'enter' : ''}`}
                          onClick={() => { setHot(e!.kind.partId); editPart(ph, box, e!.kind,false,observation); }}>
                          <title>{`${confidence.label}${confidence.score===null?'':` ${Math.floor(confidence.score*100)}%`} · ${sizeLabel(e!.kind)} ${e!.kind.color.replace(/-/g, ' ')}: tap to change`}</title>
                          {outline}
                        </g>
                      );
                    })}
                  </svg>
                  {inv.others.filter(o => o.unknown).flatMap(o => o.boxes.filter(b => b.photo === ph.id).map(b => ({ o, b }))).map(({ o, b }, i) => (
                    <button key={`p${i}`} className="unknown-pin" style={{ left: `${(b.box[1] + b.box[3]) / 20}%`, top: `${(b.box[0] + b.box[2]) / 20}%` }}
                      aria-label="Unidentified piece: say what it is" onClick={() => editOther(ph, b.box, o)}>?</button>
                  ))}
                  {scan?.status === 'scanning' && <>
                    {scan.phase === 'survey' && <div className="scanline" />}
                    <div className="scanning">
                      {scan.phase === 'zoom'
                        ? `Looking closer · ${scan.tiles.filter(t => t.state === 'done' || t.state === 'failed').length} of ${scan.tiles.length} sections`
                        : scan.phase === 'check'
                          ? `Checking each part up close · ${scan.sheets?.done ?? 0} of ${scan.sheets?.total ?? 0}`
                          : scan.phase === 'detail'
                          ? `Taking a closer look · ${scan.sheets?.done ?? 0} of ${scan.sheets?.total ?? 0} pieces`
                          : scan.phase === 'count'
                          ? `Counting studs on the big plates · ${scan.sheets?.done ?? 0} of ${scan.sheets?.total ?? 0}`
                          : 'Looking for bricks…'} {Math.round((Date.now() - scan.startedAt) / 1000)}s
                    </div>
                  </>}
                </figure>
                {scan?.status === 'done' && <p className="meta photo-hint">Tap any piece on the photo to change what it is.</p>}
                {scan?.status === 'error' && (
                  <p className="photo-error">{scan.recovery?'Unfinished-piece check: ':"Couldn't read this photo: "}{scan.error} {!scan.recovery&&<button className="linkbtn" onClick={() => props.onRetry(ph.id)}>Try again</button>}</p>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="inventory" style={inv.photos.length ? undefined : { gridColumn: '1 / -1', borderLeft: 0 }}>
        <ScanProgressPanel scans={scans} observed={total}/>
        {(unfinished>0||props.recovering)&&props.onRetryUnfinished&&<div className="banner scan-recovery" role="status">
          <span><b>{props.recovering?'Checking unfinished pieces…':`${unfinished} pieces have unfinished close-up checks.`}</b> Completed results and your corrections are kept.</span>
          {props.recovering?<button className="btn" onClick={props.onStopRecovery}>Stop retry</button>:<button className="btn" disabled={scanning} onClick={props.onRetryUnfinished}>Retry unfinished pieces</button>}
        </div>}
        <div className="inv-head">
          <h2>Your parts</h2>
          <span className="meta">{scanning && !total ? 'Counting…' : `${total} parts observed${estimate > total * 1.25 ? ` · about ${roundish(estimate)} in the photo` : ''} · ${colorCount(inv)} colors${usable !== total ? ` · ${usable} available in builds` : ''}`}</span>
        </div>
        {(pending>0||unknown>0)&&<div className="banner" role="status"><span><b>Optional review: {pending+unknown} uncertain {pending+unknown===1?'piece':'pieces'}.</b> These readings stay out of builds until confirmed. You can use the available pieces without reviewing the whole pile.</span><button className="btn" onClick={()=>{setAllReview(null);setReviewing(true);reviewNext();}}>Review uncertain pieces</button></div>}
        <ConfidenceReview rows={rows} photos={inv.photos} scanning={scanning} onReview={r=>{setReviewing(false);setAllReview(null);openReviewRow(r);}} onReviewGroup={props.onReviewGroup?group=>{setReviewing(false);setAllReview(null);openReviewGroup(group);}:undefined} onReviewAll={()=>{setReviewing(false);setAllReview({rows:rows.some(r=>r.confirmedCount<r.quantity)?rows.filter(r=>r.confirmedCount<r.quantity):[...rows],index:0});}}/>
        {usable >= 20 && !scanning && <RequestBar onSubmit={props.onRequest} />}
        {scanning && !total && (
          <div className="tiles" aria-hidden>{[0, 1, 2, 3, 4, 5].map(k => <div key={k} className="tile skeleton" />)}</div>
        )}
        <details className="inventory-counts"><summary>Counts by type · adjust quantities</summary>
        {types.map(t => (
          <div key={t}>
            <div className="group-title">{TYPE_LABEL[t]}</div>
            <div className="tiles">
              {entries.filter(e => e.kind.type === t).map(e => (
                <div key={e.kind.partId}
                  className={`tile fade-in${hot === e.kind.partId ? ' hot' : ''}${needsReviewCount(e)>0 ? ' unsure' : ''}${e.count === 0 ? ' zero' : ''}`}
                  onClick={() => setHot(h => (h === e.kind.partId ? null : e.kind.partId))}
                  title={e.confidence < 0.6 ? 'Not sure about this one. Check the count.' : undefined}>
                  <span className="count">{e.count}x</span>
                  <img src={partIcon(e.kind.partId)} alt="" />
                  <span className="name">{sizeLabel(e.kind)} {e.kind.color.replace('-', ' ')}</span><ConfidenceBadge value={pieceConfidence({...e,confirmed:e.confirmedCount===e.count})}/>
                  {needsReviewCount(e)>0&&<span className="meta">{needsReviewCount(e)} need review · excluded from builds</span>}
                  {e.aka && Object.keys(e.aka).length ? (
                    <span className="aka" title={`Counted as a ${sizeLabel(e.kind)}: it builds the same way`}>
                      incl. {Object.entries(e.aka).map(([name, k]) => `${k} ${name}`).join(', ')}
                    </span>
                  ) : null}
                  <div className="stepper" onClick={ev => ev.stopPropagation()}>
                    <button aria-label="One fewer" onClick={() => props.onCount(e.kind.partId, Math.max(0,e.count - 1))}>−</button>
                    <button aria-label="One more" onClick={() => props.onCount(e.kind.partId, Math.min(2000,e.count + 1))}>+</button>
                  </div>
                  <button className="linkbtn" onClick={ev=>{ev.stopPropagation();setReviewError('');setEdit({entry:e,id:e.kind.partId,quantity:e.count,current:{kind:e.kind,description:e.kind.partId,color:e.kind.color}});}}>Check piece and count</button>
                  <label className="meta" onClick={ev=>ev.stopPropagation()}>Count <input aria-label={`Count of ${e.kind.partId}`} type="number" min="0" max="2000" step="1" value={e.count} onChange={ev=>{const n=Number(ev.target.value);if(Number.isSafeInteger(n)&&n>=0&&n<=2000)props.onCount(e.kind.partId,n);}} style={{width:72}}/></label>
                </div>
              ))}
            </div>
          </div>
        ))}
        </details>
        {entries.some(e => e.kind.type === 'wheel' && e.count > 0) && (
          <p className="others">Loose wheels need a holder. If you have the complete assembly, add “Wheel pair with holder” below.</p>
        )}
        {unknown > 0 && !scanning && (
          <p className="others unknown-note">
            <b>{unknown} {unknown === 1 ? 'piece' : 'pieces'} couldn't be identified.</b> These stay out of builds. You can identify them later and build with the usable pieces now.
          </p>
        )}
        {supportedCatalogCount>0&&<p className="others">{supportedCatalogCount} confirmed catalog {supportedCatalogCount===1?'piece is':'pieces are'} now supported and included in the available build stock. Your saved matches are preserved.</p>}
        {named.length > 0 && (
          <p className="others">
            Also spotted {named.length} special {named.length === 1 ? 'part' : 'parts'}, to identify or check in the confidence review above. Only confirmed exact matches with supported connections enter builds:{' '}
            {otherNames(named).slice(0, 10).map(([d, n], i) => <b key={d}>{i ? ', ' : ''}{d}{n > 1 ? ` ×${n}` : ''}</b>)}
            {otherNames(named).length > 10 ? ' and more.' : '.'}
          </p>
        )}
        {inv.others.some(o => outlineOptions(o).length > 0 || specialtyReviewNote(o)) && <details className="others outline-review">
          <summary>Review shaping and connection pieces</summary>
          <p>Compare your piece with these shapes before confirming. Wedges are shown with the narrow end forward; the straight studded edge determines left or right. Only confirm an exact match. Each confirmation adds one piece.</p>
          {inv.others.map((o,index) => { const options=outlineOptions(o),box=o.boxes[0],photo=box&&inv.photos.find(p=>p.id===box.photo); return options.length || specialtyReviewNote(o) ? <div key={index} className="outline-observation">
            <b>{o.description} · {o.color.replaceAll('-', ' ')}</b>
            {specialtyReviewNote(o) && <p>{specialtyReviewNote(o)}</p>}
            {photo && <PieceCrop url={photo.url} box={box.box} size={180} />}
            <div className="row">{options.map(k => <button key={k.partId} className="btn" onClick={() => props.onConfirmOutline(o,k.partId)}>
              <img src={partIcon(k.partId)} width={64} height={64} alt={partInfo(k.partId)?.name} />
              <span>Confirm {partInfo(k.partId)?.name} ({partInfo(k.partId)?.number})</span>
            </button>)}</div>
          </div> : null; })}
        </details>}
        {!(scanning && !total) && <button className="btn add-part" onClick={() => setAdding(true)}><Plus /> Add a part</button>}
      </section>

      <div className="actionbar">
        <span className="grow meta">{scanning?'Finish scanning before starting a build.':usable<20?`${usable} usable pieces · at least 20 needed to find builds.`:excluded?`${usable} usable pieces · ${excluded} uncertain or unsupported pieces stay out.`:'Check the parts list before assembling.'}</span>
        {inv.photos.some(p => !p.ref) && (
          <label className={`btn${scanning ? ' disabled' : ''}`} title="An angled photo of the same pile, to check heights">
            <Camera /> <span className="wide-only">Add an angled photo</span><span className="narrow-only">Angle</span>
            <input className="sr" type="file" data-role="angle" disabled={scanning} accept="image/*,.heic,.heif" capture="environment" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) props.onAnglePhoto(f); }} />
          </label>
        )}
        <label className="btn">
          <Camera /> <span className="wide-only">Add another handful</span><span className="narrow-only">Add more</span>
          <input className="sr" type="file" accept="image/*,.heic,.heif" capture="environment" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) props.onPhoto(f); }} />
        </label>
        <button className="btn" disabled={scanning || usable < 1} onClick={props.onBench}>Build it yourself</button>
        <button className="btn primary" disabled={scanning || usable < 20} onClick={props.onNext}>Build with available pieces <Arrow /></button>
      </div>

      {adding && <AddPart onClose={() => setAdding(false)} onAdd={k => { props.onAddPart(k); setAdding(false); }} />}
      {edit && (
        <PieceEditor key={editVersion} reviewError={reviewError} onRefresh={()=>{
          if(edit.group){const group=pieceReviewGroups(rows).find(g=>g.key===edit.group!.key);if(group){openReviewGroup(group);return;}setReviewError('This group no longer exists. Close this review and choose pieces from the current list.');return;}
          if(edit.id&&!edit.unboxedOnly){const entry=inv.parts[edit.id];if(entry){setReviewError('');setEditVersion(v=>v+1);setEdit({...edit,entry,quantity:edit.onlyUncertain?needsReviewCount(entry):entry.count,current:{...entry,kind:entry.kind,description:entry.kind.partId,color:entry.kind.color}});return;}}
          const latest=rows.filter(row=>edit.box?row.photo===edit.photoId&&row.box?.every((v,i)=>v===edit.box![i]):row.partId===edit.id&&row.key.endsWith('@count'));
          if(latest.length===1){setEditVersion(v=>v+1);openReviewRow(latest[0]);}
          else setReviewError(latest.length?'Several pieces now share this outline. Close this review and choose a piece from the list.':'This observation is no longer in the scan. Close this review to continue with the current list.');
        }} photo={edit.photo} box={edit.box} current={edit.current} quantity={edit.quantity} copies={edit.group?.rows.map(row=>({row,photo:inv.photos.find(p=>p.id===row.photo)}))} onReviewCopy={row=>{setAllReview(null);setReviewing(false);openSingleReviewRow(row);}} reviewLabel={allReview?`Review ${allReview.index+1} of ${allReview.rows.length}${scanning?' detected so far':''}`:undefined} onSkip={allReview?advanceReview:undefined} onClose={() => {setReviewError('');setAllReview(null);setReviewing(false);setEdit(null); setHot(null); }}
          onApply={(r,selected) => {
            const applied=edit.group?props.onReviewGroup?.(selected??[],r)??false:edit.other?props.onReviewOther(edit.other,r):edit.id?props.onReviewType(edit.id,r,edit.onlyUncertain,edit.unboxedOnly,edit.quantity,edit.entry):edit.photoId!==undefined&&edit.box?props.onResolve(edit.photoId,edit.box,r,edit.observationId,edit.onlyUncertain,edit.observation):false;
            if(applied===false){setReviewError('The scan updated this reading while it was open. Nothing was changed. Review the latest reading before applying your choice.');return;}
            setReviewError('');if(allReview)advanceReview();else setEdit(null);setHot(null);
          }} />
      )}
    </main>
  );
}

/**
 * Add a part by hand, or (with `piece`) say what an outlined extra piece in a photo is: one of the parts the
 * builder knows, a name for something else, or not a part at all.
 */
const ADD_CATALOG = { ...CATALOG, wheels: ['4x2'] };
function AddPart({ onClose, onAdd, piece, onName, onRemove }: {
  onClose: () => void; onAdd: (k: PartKind) => void;
  piece?: { photo: Photo; other: OtherEntry; box: Box }; onName?: (name: string) => void; onRemove?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<keyof typeof ADD_CATALOG>('brick');
  const [size, setSize] = useState('2x4');
  const [color, setColor] = useState<ColorName>(piece && piece.other.color in COLORS ? piece.other.color as ColorName : 'red');
  const [name, setName] = useState(piece && !piece.other.unknown ? piece.other.description : '');
  useEffect(() => { ref.current?.showModal(); }, []);
  const sizes = ADD_CATALOG[type];
  const kind = useMemo(() => {
    const [w, d] = (sizes.includes(size) ? size : sizes[0]).split('x').map(Number);
    return parsePartId(partId(type, w, d, color))!;
  }, [type, size, color, sizes]);
  let viable=false;try{viable=!!kind&&isMade(kind.partId)&&!!definition(kind);}catch{/* unsupported mold */}
  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <h3>{piece ? (piece.other.unknown ? 'What is this piece?' : 'Correct this piece') : 'Add a part'}</h3>
      {piece && (
        <div className="piece-head">
          <PieceCrop url={piece.photo.url} box={piece.box} />
          <p className="meta">{piece.other.unknown
            ? `The scanner couldn't tell${piece.other.description ? ` (it saw: ${piece.other.description})` : ''}. If it's one of the shapes below, pick it and it joins your parts.`
            : `The scanner says: ${piece.other.description}. If it's really one of the shapes below, pick it and it joins your parts.`}</p>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <img src={partIcon(kind.partId)} alt="" width={96} height={96} />
        <div style={{ flex: 1 }}>
          <label>Type</label>
          <select value={type} onChange={e => setType(e.target.value as keyof typeof ADD_CATALOG)}>
            {Object.keys(ADD_CATALOG).map(t => <option key={t} value={t}>{t === 'wheels' ? 'Wheel pair with holder' : ONE[t as PartType] ?? t}</option>)}
          </select>
          <label>Size</label>
          <select value={sizes.includes(size) ? size : sizes[0]} onChange={e => setSize(e.target.value)}>
            {sizes.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {type === 'wheels' && <p className="meta">One complete assembly: a 2×2 axle holder with two matching wheels and tires attached. This confirms all of those parts are present.</p>}
      <label>Color</label>
      <div className="swatches">
        {COLOR_NAMES.map(c => (
          <button key={c} className={`swatch${c === color ? ' on' : ''}`} style={{ background: COLORS[c] }} title={c} aria-label={c} onClick={() => setColor(c)} />
        ))}
      </div>
      {!viable&&<p className="meta" role="status">Choose a supported shape and a color this part was made in.</p>}
      <div className="row">
        <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
        <button className="btn primary" disabled={!viable} onClick={() => onAdd(kind)}>{piece ? 'It’s this' : 'Add 1'}</button>
      </div>
      {piece && onName && onRemove && (
        <div className="piece-other">
          <label htmlFor="piece-name">Something the builder doesn't know yet</label>
          <div className="row tight">
            <input id="piece-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. window 1x2x2" maxLength={60} />
            <button className="btn" disabled={!name.trim()} onClick={() => onName(name.trim())}>Name it</button>
          </div>
          <button className="linkbtn" onClick={onRemove}>Not a part</button>
        </div>
      )}
    </dialog>
  );
}
