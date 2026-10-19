import {useEffect,useId,useState} from 'react';
import type {CSSProperties} from 'react';
import type {Scan} from '../screens/Parts';
import {scanActivity,scanDuration} from '../lib/scan-progress';

const small:CSSProperties={fontSize:12,color:'var(--muted, #6b675f)',lineHeight:1.5};
const flex:CSSProperties={display:'flex',flexWrap:'wrap',alignItems:'baseline',justifyContent:'space-between',gap:'4px 16px'};

/** Callback evidence and a local elapsed clock. No estimated finish time or simulated model progress. */
export function ScanProgressPanel({scans,observed}:{scans:Scan[];observed:number}) {
 const active=scans.some(s=>s.status==='scanning');
 const [now,setNow]=useState(Date.now);
 const titleId=useId();
 useEffect(()=>{
  if(!active)return;
  setNow(Date.now());
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return ()=>clearInterval(timer);
 },[active]);
 if(!scans.length)return null;
 const done=scans.filter(s=>s.status==='done').length,failed=scans.filter(s=>s.status==='error').length;
 const seen=Number.isSafeInteger(observed)&&observed>=0?observed:0;
 const asOf=Math.max(now,Date.now());
 return <section className="scan-progress-panel" aria-labelledby={titleId} style={{border:'1px solid var(--rule, #d9d3c7)',borderRadius:10,padding:16,background:'var(--card, #fbf9f4)',color:'var(--ink, #1d1d1b)',margin:'16px 0'}}>
  <div style={flex}>
   <h3 id={titleId} style={{fontSize:18,lineHeight:1.3}}>Photo scan activity</h3>
   <span style={small}>{seen.toLocaleString()} pieces observed{active?' so far':''}</span>
  </div>
  <p style={{...small,margin:'6px 0 14px'}}>{done} of {scans.length} photo scans finished{active?` · ${scans.filter(s=>s.status==='scanning').length} active`:''}{failed?` · ${failed} failed`:''}. Observed pieces may still need review.</p>
  <div style={{display:'grid',gap:14}}>
   {scans.map((scan,index)=>{
    const a=scanActivity(scan,asOf),error=scan.status==='error',warning=a.waiting||a.sections.failed>0||a.timedOutChecks>0;
    const color=error?'var(--bad, #a3361f)':scan.status==='done'&&!warning?'var(--good, #2f6b3a)':'var(--ink, #1d1d1b)';
    const unit=a.counts?.unit;
    const countText=a.counts?`${a.counts.done} of ${a.counts.total} ${unit} processed`:scan.status==='done'?'Scan processing finished':error?'Stopped before completion':'Completed work total not reported yet';
    return <article key={scan.photo} className={`scan-progress-item scan-progress-${scan.status}`} style={{borderTop:'1px solid var(--rule, #d9d3c7)',paddingTop:12,minWidth:0}}>
     <div style={flex}>
      <strong style={{fontSize:14,color}}>Photo {index+1} · {scan.recovery?'Unfinished pieces · ':''}{a.label}</strong>
      <span style={small}>{a.elapsedMs===null?'Elapsed time not recorded':`${a.active?'Elapsed':'Last recorded elapsed'} ${scanDuration(a.elapsedMs)}`}</span>
     </div>
     <p className="scan-progress-counts" style={{fontSize:13,margin:'7px 0 5px'}} aria-live="polite" aria-atomic="true">{countText}</p>
     <progress className="scan-progress-work" max={a.counts?.total??1} value={a.counts?.done??(scan.status==='done'?1:a.active?undefined:0)} aria-label={`Photo ${index+1}: ${a.label}`} aria-valuetext={a.active&&!a.counts?'Activity indicator; completed work is unknown':countText} style={{display:'block',width:'100%',height:10,accentColor:color}}/>
     {a.active&&!a.counts&&<p style={{...small,margin:'4px 0'}}>Activity indicator only; it does not measure model progress.</p>}
     <div className="scan-progress-stages" role="progressbar" aria-label={`Photo ${index+1} scan stages`} aria-valuemin={0} aria-valuemax={a.stages} aria-valuenow={a.stage} aria-valuetext={`${a.label}. Stage marker, not a percentage of work or time.`} style={{display:'grid',gridTemplateColumns:`repeat(${a.stages}, minmax(0, 1fr))`,gap:4,marginTop:9}}>
      {Array.from({length:a.stages},(_,i)=><span key={i} aria-hidden="true" style={{height:3,borderRadius:2,background:i<a.stage?color:'var(--rule, #d9d3c7)'}}/>)}
     </div>
     <p style={{...small,margin:'4px 0'}}>{scan.recovery?'Checking existing outlines; completed pieces are kept':scan.phase==='cross'?'Angle check':scan.status==='done'?'Scan stages finished':'Survey → sections → close-ups → individual checks → recount, as needed'}{a.active?' · no finish-time estimate':''}</p>
     {a.active&&<p className="scan-progress-event" style={{...small,margin:'6px 0'}}>{a.lastProgressAgeMs===null?'Last progress event time not recorded':`Last progress event ${scanDuration(a.lastProgressAgeMs)} ago`}</p>}
     {a.waiting&&<p className="scan-progress-waiting" role="status" style={{fontSize:13,margin:'6px 0',color:'var(--ink, #1d1d1b)'}}>{a.lastProgressAgeMs===null?'Waiting for the next result; progress-event timing is unavailable.':`Waiting for a result. No new progress event for ${scanDuration(a.lastProgressAgeMs)}.`} The elapsed clock is not evidence of model progress.</p>}
     {a.sections.failed>0&&<p className="scan-progress-gap" style={{fontSize:13,margin:'6px 0',color:'var(--bad, #a3361f)'}}>{a.sections.failed} of {a.sections.total} photo sections failed. Those areas may be missing pieces.</p>}
     {a.timedOutChecks>0&&<p className="scan-progress-timeout" role="status" style={{fontSize:13,margin:'6px 0'}}>{a.timedOutChecks} {a.timedOutChecks===1?'check could':'checks could'} not finish within the time limit. {a.active?'Continuing':error?'Stopped':'Finished'} with the available results. Some pieces may still need review.</p>}
     {a.counts&&scan.phase!=='zoom'&&<p style={{...small,margin:'4px 0'}}>Processed batches can include failed checks. Review uncertain pieces afterward.</p>}
     {error&&<p role="status" className="scan-progress-error" style={{fontSize:13,margin:'6px 0',color:'var(--bad, #a3361f)',overflowWrap:'anywhere'}}>{scan.error||'No error details were reported.'} This scan did not finish; some readings may be missing.</p>}
    </article>;
   })}
  </div>
 </section>;
}
