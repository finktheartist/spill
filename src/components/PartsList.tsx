import { useEffect, useRef, useState } from 'react';
import { parsePartId, type Build } from '../lib/bricks';
import { CATALOG_SOURCE, isMade, listText, partInfo, shoppingList, type ListLine } from '../lib/catalog';
import { partIcon } from '../lib/render';

/** The booklet's parts page for an accurate build: what the bucket covers, and what to get. */
export function PartsList({ build, bucket, onClose, full = false,preparation=false,onStart,onMissing }: { build: Build; bucket: Record<string, number>; onClose: () => void; full?: boolean;preparation?:boolean;onStart?:()=>void;onMissing?:()=>void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [gathered,setGathered]=useState<Set<string>>(new Set());
  useEffect(() => { ref.current?.showModal(); }, []);
  const list = shoppingList(build, full||preparation ? {} : bucket);
  const gatheredCount=list.get.reduce((n,l)=>n+(gathered.has(l.partId)?l.count:0),0);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${build.name}: ${full||preparation ? 'complete parts list' : 'parts to get'}\n${listText(list.get)}`); setCopied(true); } catch { /* clipboard blocked */ }
  };
  const group = (title: string, lines: ListLine[], n: number, note: string) => lines.length > 0 && (
    <section>
      <div className="list-head"><h4 className="display">{title}</h4><span className="meta">{n} parts · {note}</span></div>
      <div className="list-grid">
        {lines.map(l => {
          const i = partInfo(l.partId);
          const k = parsePartId(l.partId);
          return (
            <div className="list-item" key={l.partId}>
              <img src={partIcon(l.partId)} alt="" />
              <b className="display">{l.count}x</b>
              <span className="list-name">
                {i?.name ?? l.partId}
                <span className="list-sub">
                  <span className="meta">{k?.color.replace('-', ' ')}</span>
                  {i && <a className="list-no" href={i.url} target="_blank" rel="noreferrer">{i.number}</a>}
                </span>
                {preparation&&<label className="gather-check"><input type="checkbox" aria-label={`Set aside ${l.count} ${i?.name??l.partId} in ${k?.color.replaceAll('-',' ')}`} checked={gathered.has(l.partId)} onChange={e=>setGathered(s=>{const next=new Set(s);e.target.checked?next.add(l.partId):next.delete(l.partId);return next;})}/> Set aside {l.count}</label>}
                {i?.extra && <span className="list-extra meta">{i.extra}</span>}
                {!isMade(l.partId) && <span className="list-extra meta">Not made in this color: swap for another</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
  return (
    <dialog ref={ref} className="sheet parts-list" onClose={onClose}>
      <div className="list-top">
        <div>
          <div className="kicker">{preparation?'Before you build':'Parts list'}</div>
          <h3>{build.name}</h3>
          <p className="meta">{preparation?`Gather all ${list.getCount} pieces in ${list.get.length} types. Separate these from your pile before starting.`:full ? `${list.getCount} parts · complete model inventory, independent of your bucket.` : `${list.haveCount + list.getCount} parts: ${list.haveCount} from your bucket, ${list.getCount} to get.`}</p>
          {preparation&&<p className="meta" role="status">{gatheredCount} of {list.getCount} pieces set aside. Check off each type as you gather it.</p>}
        </div>
        <button className="iconbtn" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
      </div>
      {group(preparation?'Pieces to gather':full ? 'All parts' : 'To get', list.get, list.getCount, preparation?'exact shape, color and quantity':'part numbers link to BrickLink')}
      {group('From your bucket', list.have, list.haveCount, 'already yours')}
      <p className="meta list-credit">
        Colors checked against the <a href={CATALOG_SOURCE.url} target="_blank" rel="noreferrer">{CATALOG_SOURCE.name}</a> LEGO catalog ({CATALOG_SOURCE.updated}): {full ? 'every listed part' : 'every part to get'} was really made in its color.
      </p>
      <div className="row">
        {list.getCount > 0 && <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy the list'}</button>}
        {preparation?<><button className="btn" onClick={onMissing??onClose}>Some pieces are missing</button><button className="btn primary" onClick={onStart}>I have these pieces · Start instructions</button></>:<button className="btn primary" onClick={() => ref.current?.close()}>Done</button>}
      </div>
    </dialog>
  );
}
