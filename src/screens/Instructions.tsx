import { useEffect, useMemo, useRef, useState } from 'react';
import type { Build } from '../lib/bricks';
import { partCount } from '../lib/bricks';
import { BuildViewer, partIcon } from '../lib/render';
import { Arrow, Replay, Reset } from '../components/Icons';
import {PartsList} from '../components/PartsList';
import {planBuildInstructions} from '../lib/instruction-order';

/** Room the overlays take up, so the model is framed in the free space between them. */
function padFor(done: boolean) {
  const wide = window.matchMedia('(min-width: 900px)').matches;
  if (wide) return done ? { top: 30, right: 40, bottom: 20, left: 380 } : { top: 40, right: 260, bottom: 20, left: 200 };
  return done ? { top: 20, right: 0, bottom: 190, left: 0 } : { top: 150, right: 0, bottom: 40, left: 0 };
}

export function Instructions({ build:sourceBuild, bucketTotal, model, onBack, initialStep = 0, needs, backTo = 'builds',draft=false,bucket={},onEditInventory }: { build: Build; bucketTotal: number; model: string; onBack: () => void; initialStep?: number; needs?: Set<string>; backTo?: 'builds' | 'workbench';draft?:boolean;bucket?:Record<string,number>;onEditInventory?:()=>void }) {
  const plan=useMemo(()=>planBuildInstructions(sourceBuild),[sourceBuild]);
  const build=plan.build;
  const [sectionView,setSectionView]=useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<BuildViewer | null>(null);
  const n = build.steps.length;
  const [i, setI] = useState(() => Math.min(initialStep, build.steps.length));
  const [prepared,setPrepared]=useState(false);
  const done = i >= n;

  useEffect(() => {
    const v = new BuildViewer(canvas.current!, { interactive: true });
    v.pad = padFor(false);
    v.setBuild(build);
    viewer.current = v;
    return () => v.dispose();
  }, [build]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const section=!done&&sectionView&&build.steps[i].parts.length>1;
    v.setBuild(section?{...build,steps:[build.steps[i]],requiredContacts:undefined}:build);
    v.turntable = done;
    v.pad = padFor(done);
    v.resetView();
    v.showStep(section?0:done ? n : i, !done);
  }, [i, done, n,sectionView,build]);

  useEffect(() => {
    if(!prepared)return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI(x => Math.min(n, x + 1));
      if (e.key === 'ArrowLeft') setI(x => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [n,prepared]);

  const callout = useMemo(() => {
    if (done) return [];
    const c = new Map<string, number>();
    for (const p of build.steps[i].parts) c.set(p.partId, (c.get(p.partId) ?? 0) + 1);
    return [...c.entries()];
  }, [build, i, done]);

  const left = bucketTotal - partCount(build);

  return (
    <div className="manual">
      <header className="topbar">
        <button className="linkbtn" style={{ textDecoration: 'none', display: 'flex', gap: 6, alignItems: 'center' }} onClick={onBack}>
          <span style={{ width: 20, display: 'inline-flex' }}><Arrow back /></span> {backTo === 'workbench' ? 'Workbench' : 'Builds'}
        </button>
        <h1 style={{ fontSize: 20, marginLeft: 6 }}>{build.name}</h1>
        <span className="chip"><span className="wide-only">{draft||build.source ? 'from ' : 'designed by '}</span><i>{draft?'a generated draft':build.source?.kind === 'display' ? 'the display collection' : build.source?.kind === 'discovery' ? 'your saved library' : build.source?.kind === 'library' ? 'Spill library' : model}</i></span>
      </header>
      {!!plan.notices.length&&plan.subassemblies===0&&<p className="banner" role="note" style={{margin:'8px var(--gutter)'}}>Assembly order needs manual checking for this model. {plan.notices[0]}</p>}
      {draft&&<p className="banner" role="note" style={{margin:'8px var(--gutter)'}}>Draft instructions · subject and appearance are not approved. These steps show the generated model.</p>}

      <div className="stage">
        <canvas ref={canvas} aria-label={`Step ${Math.min(i + 1, n)} of ${build.name}`} />
        {!done && (
          <>
            <div className={`stepno${build.steps[i].parts.length>1?' subassembly':''}`} key={i}>
              <span className="n">{i + 1}</span><span className="of">/{n}</span>
              <div className="cap fade-in">{build.steps[i].caption}</div>
            </div>
            <div className="callout fade-in" key={`c${i}`} aria-label="Parts for this step" style={{ ['--cols' as string]: Math.min(callout.length, 4) }}>
              {callout.map(([id, k]) => (
                <div className={`it${needs?.has(id) ? ' need' : ''}`} key={id} title={needs?.has(id) ? 'A part you need to get' : undefined}><img src={partIcon(id)} alt={id} /><b>{k}x</b></div>
              ))}
            </div>
            <div className="view-tools">
              {build.steps[i].parts.length>1&&<button className="btn" aria-pressed={sectionView} onClick={()=>setSectionView(x=>!x)}>{sectionView?'Show attachment to model':'View pieces separately'}</button>}
              <button className="iconbtn" aria-label="Replay this step" onClick={() => viewer.current?.showStep(i)}><Replay /></button>
              <button className="iconbtn" aria-label="Reset view" onClick={() => viewer.current?.resetView()}><Reset /></button>
            </div>
          </>
        )}
        {done && (
          <div className="done-card">
            <div className="kicker">Built</div>
            <h3>{build.name}</h3>
            <p>{draft?'You reached the end of this draft. Its subject and appearance are still unapproved.':build.source?.kind === 'display' ? `${partCount(build)} parts in the complete model. Built from the display collection’s parts list.` : needs ? 'Built from the parts list: your bucket plus the parts marked “get”.' : left > 0 ? `${left} ${left === 1 ? 'part' : 'parts'} left over. Build something else?` : 'You used every part. Nice.'}</p>
            <button className="btn primary" onClick={onBack}>Back to {backTo === 'workbench' ? 'the workbench' : 'builds'}</button>
          </div>
        )}
      </div>

      <footer className="manual-foot">
        <div className="rail" role="progressbar" aria-valuemin={1} aria-valuemax={n} aria-valuenow={Math.min(i + 1, n)}>
          {build.steps.map((_, k) => <span key={k} className={k < i ? 'done' : k === i ? 'cur' : ''} onClick={() => setI(k)} />)}
        </div>
        <div className="nav">
          <button className="linkbtn" onClick={()=>setPrepared(false)}>Parts checklist</button>
          <span className="where">{done ? 'Finished' : `Step ${i + 1} of ${n}`} · drag to turn it</span>
          <button className="btn" disabled={i === 0} onClick={() => setI(x => Math.max(0, x - 1))}><Arrow back /> Back</button>
          {!done && <button className="btn primary" onClick={() => setI(x => Math.min(n, x + 1))}>{i === n - 1 ? 'Finish' : 'Next'} <Arrow /></button>}
        </div>
      </footer>
      {!prepared&&<PartsList build={build} bucket={bucket} preparation onClose={onBack} onMissing={onEditInventory??onBack} onStart={()=>setPrepared(true)}/>}
    </div>
  );
}
