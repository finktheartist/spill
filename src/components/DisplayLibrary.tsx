import { useEffect, useRef, useState } from 'react';
import { DISPLAY_MODELS, type DisplayModel } from '../lib/display-models';
import { partCount, type Build } from '../lib/bricks';
import { BuildViewer } from '../lib/render';
import { PartsList } from './PartsList';
import { Arrow } from './Icons';

const NO_BUCKET: Record<string, number> = {};
function DisplayCard({ model, onOpen }: { model: DisplayModel; onOpen: (build: Build) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [partsOpen, setPartsOpen] = useState(false);
  useEffect(() => {
    const viewer = new BuildViewer(canvas.current!, { interactive: true });
    viewer.setBuild(model.build); viewer.showStep(Infinity, false);
    return () => viewer.dispose();
  }, [model.build]);
  return <article className="card display-card">
    <div className="card-art">
      <canvas ref={canvas} aria-label={`3D model of ${model.build.name}; drag to rotate`} />
      <span className="art-chip">{model.category}</span>
      <span className="display-drag">Drag to explore</span>
    </div>
    <div className="card-body">
      <h3>{model.build.name}</h3>
      <p className="pitch">{model.build.description}</p>
      <div className="card-meta"><span>{partCount(model.build)} parts</span><span>{model.build.steps.length} steps</span><span>Any parts</span></div>
      <ul className="display-details">{model.details.map(d => <li key={d}>{d}</li>)}</ul>
      <div className="card-actions">
        <button className="btn" onClick={() => setPartsOpen(true)}>Complete parts list</button>
        <button className="btn primary" onClick={() => onOpen(model.build)}>View instructions <Arrow /></button>
      </div>
    </div>
    {partsOpen && <PartsList build={model.build} bucket={NO_BUCKET} full onClose={() => setPartsOpen(false)} />}
  </article>;
}

export default function DisplayLibrary({ onOpen }: { onOpen: (build: Build) => void }) {
  const [category, setCategory] = useState('All'), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const searchText = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const filtered = DISPLAY_MODELS.filter(m => (category === 'All' || m.category === category) && searchText(`${m.build.name} ${m.build.description}`).includes(searchText(query)));
  const pages = Math.max(1, Math.ceil(filtered.length / 4)), current = Math.min(page, pages - 1);
  return <section aria-labelledby="display-heading" className="display-library">
    <div className="display-intro"><h3 id="display-heading">8 models to explore</h3><p>Original designs with complete parts lists and step-by-step guides. No bucket required.</p></div>
    <div className="library-filters">
      <label>Find a detailed model<input type="search" placeholder="Café, typewriter, spacecraft…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <label>Collection<select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>{['All', 'Architecture', 'Space', 'Objects'].map(c => <option key={c}>{c}</option>)}</select></label>
    </div>
    <div className="display-grid">{filtered.slice(current * 4, current * 4 + 4).map(m => <DisplayCard key={m.id} model={m} onOpen={onOpen} />)}</div>
    {!filtered.length && <p className="meta">No models match these filters.</p>}
    {pages > 1 && <nav className="library-pagination" aria-label="Detailed model pages"><button className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current + 1} of {pages} · {filtered.length} models</span><button className="btn" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Next</button></nav>}
    <p className="meta display-footnote">Original Spill designs. All listed parts and colors are catalogued, and the digital assemblies are checked. Physical builds and moving mechanisms have not been tested.</p>
  </section>;
}
