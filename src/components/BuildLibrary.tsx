import { useEffect, useRef, useState } from 'react';
import { COLORS, parsePartId, partCount, type Build } from '../lib/bricks';
import { compareNearFits, type LibraryEntry } from '../lib/library';
import { entryMatches, familyReadiness, relatedBuilds } from '../lib/library-planner';
import { FAMILY_STRATEGIES } from '../lib/construction-families';
import { BuildViewer } from '../lib/render';
import { PartsList } from './PartsList';
import { ANIMAL_BASES } from '../lib/animal-recipes';
import { Arrow } from './Icons';

export function LibraryCard({ entry, bucket, onOpen, onRemix }: {
  entry: LibraryEntry; bucket: Record<string, number>; onOpen: (build: Build) => void; onRemix: (build: Build) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [partsOpen, setPartsOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const options = entry.matches ?? (entry.match ? [entry.match] : []);
  const match = options.find(m => m.recipeId === selected) ?? options[0] ?? null;
  const near = !match ? entry.near : undefined;
  const build = match?.build ?? near?.match.build ?? entry.example;
  const bodyFamily = match?.animalBase ?? entry.animalBase;
  const allocation = match?.features ?? near?.features;
  const palette = [...new Set(build.steps.flatMap(s => s.parts).map(p => parsePartId(p.partId)!.color))];
  useEffect(() => {
    const viewer = new BuildViewer(canvas.current!);
    viewer.setBuild(build); viewer.showStep(Infinity, false);
    return () => viewer.dispose();
  }, [build]);
  return <article className="card library-card">
    <div className="card-art">
      <canvas ref={canvas} aria-label={`3D preview of ${entry.name}${match ? ' using your pieces' : near ? ', including the missing pieces' : ', example colors and pieces'}`} />
      <span className={`art-chip ${match ? 'done' : near ? 'near' : ''}`}>{match ? 'Fits your bucket' : near ? `Almost there · ${near.missingCount} missing` : 'Example build'}</span>
    </div>
    <div className="card-body">
      <h3>{entry.name}</h3>
      <p className="pitch">{build.description}</p>
      {bodyFamily && <p className="card-kicker">{ANIMAL_BASES.find(b => b.id === bodyFamily)?.label} body family</p>}
      {entry.saved && <p className="card-kicker">Saved discovery · passed its AI visual review</p>}
      {match?.colorMode === 'mixed' && <p className="card-kicker">Mixed-color version · your actual pieces</p>}
      {options.length > 1 && <label className="library-variant">{options.length} versions fit
        <select value={match!.recipeId} onChange={e => setSelected(e.target.value)} aria-label={`Version of ${entry.name}`}>
          {options.map(m => <option key={m.recipeId} value={m.recipeId}>{m.label ?? m.recipeId}</option>)}
        </select>
      </label>}
      <div className="card-meta">
        <span>{partCount(build)} parts</span><span>{build.steps.length} steps</span>
        <span className="palette" aria-label={`Colors: ${palette.join(', ')}`}>
          {palette.map(c => <i key={c} style={{ background: COLORS[c] }} title={c.replace(/-/g, ' ')} />)}
        </span>
      </div>
      <p className="card-note">{match
        ? match.colorMode === 'mixed' ? 'Uses several colors where needed, keeping the shape and contrasting details. Every piece is accounted for.'
          : match.substitutions ? 'Adapted to the sizes in your bucket. Every piece is accounted for.' : 'Your bucket has every piece for this version.'
        : near ? `${near.ownedCount} of ${near.ownedCount + near.missingCount} pieces are in your bucket. The preview includes ${near.missingCount} pieces you still need.`
        : 'No matching version found in your bucket. The preview shows the example parts.'}</p>
      {!!match?.layeredSubstitutions && <p className="card-note">Some ordinary bricks are replaced by three supported layers of plates, shown in the instructions.</p>}
      {allocation && <details className="library-allocation">
        <summary>{near ? 'Which features need pieces?' : 'What the pieces build'}</summary>
        <ul>{allocation.map((f, i) => {
          const missing = f.missing.reduce((n, p) => n + p.count, 0);
          return <li key={`${f.name}-${i}`}><span>{f.name}</span><strong className={missing ? 'needs-parts' : ''}>{missing ? `${missing} missing` : 'Covered'}</strong></li>;
        })}</ul>
      </details>}
      <div className="card-actions">
        <button className="btn" onClick={() => setPartsOpen(true)}>{match ? 'Parts list' : near ? 'Missing parts' : 'Example parts'}</button>
        {match && <button className="btn primary" onClick={() => onOpen(build)}>Build this <Arrow /></button>}
      </div>
      {match && build.engine!=='connections-v2' && <button className="linkbtn library-remix" onClick={() => onRemix(build)}>Remix on the workbench</button>}
    </div>
    {partsOpen && <PartsList build={build} bucket={bucket} onClose={() => setPartsOpen(false)} />}
  </article>;
}

export function BuildLibrary({ entries, bucket, onOpen, onRemix, loading = false, completed = 0, total = 0, error, notice }: {
  entries: LibraryEntry[]; bucket: Record<string, number>; onOpen: (build: Build) => void; onRemix: (build: Build) => void;
  loading?: boolean; completed?: number; total?: number; error?: string; notice?: string;
}) {
  const [mode, setMode] = useState<'ready' | 'near' | 'examples'>('ready');
  const [animalBase, setAnimalBase] = useState('All');
  const [family, setFamily] = useState('All'), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const ready = entries.filter(e => e.match), almost = entries.filter(e => !e.match && e.near), examples = entries.filter(e => !e.match && !e.near);
  const options = ready.reduce((n, e) => n + (e.matches?.length ?? 1), 0);
  const readiness = familyReadiness(entries);
  const source = mode === 'ready' ? ready : mode === 'near' ? [...almost].sort((a, b) => compareNearFits(a.near!, b.near!)) : examples;
  const filtered = source.filter(e => (family === 'All' || (family === 'Saved' ? e.saved : e.strategy === family)) && (family !== 'animals' || animalBase === 'All' || e.animalBase === animalBase) && entryMatches(e, query));
  const alternatives = relatedBuilds(entries, query);
  const pages = Math.max(1, Math.ceil(filtered.length / 6)), current = Math.min(page, pages - 1);
  return <section className="build-library" aria-labelledby="library-heading">
    <div className="section-title row"><h3 id="library-heading">Build library</h3><span className="grow" /><span>{ready.length} ready · {options} fitting versions</span></div>
    <p className="meta library-intro">Developed designs with at least 20 pieces, fitted to your bucket. More detailed versions appear first. Build one at a time, then reuse the pieces for another.</p>
    {loading && <p className="meta" role="status">Checking the catalog… {completed}{total ? ` of ${total} designs` : ''}. You can open a ready build now.</p>}
    {error && <p className="banner" role="alert">{error}</p>}
    {notice && <p className="meta" role="status">{notice}</p>}
    <div className="library-modes" role="group" aria-label="Build readiness">
      {(['ready', 'near', 'examples'] as const).map((m, i) => <button key={m} className="btn" aria-pressed={mode === m} onClick={() => { setMode(m); setPage(0); }}>{['Build now', 'Almost there', 'Examples'][i]} <span>{[ready.length, almost.length, examples.length][i]}</span></button>)}
    </div>
    <div className="library-filters">
      <label>Find a design<input type="search" placeholder="Fox, airplane, robot…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <label>Build family<select value={family} onChange={e => { setFamily(e.target.value); setPage(0); }}>
        <option value="All">All families</option>
        {FAMILY_STRATEGIES.map(f => {
          const count = readiness.find(r => r.id === f.id);
          return <option key={f.id} value={f.id}>{f.name}{count ? ` · ${count.ready} ready, ${count.near} near` : ''}</option>;
        })}
        {entries.some(e => e.saved) && <option value="Saved">Saved discoveries</option>}
      </select></label>
      {family === 'animals' && <label>Body family<select value={animalBase} onChange={e => { setAnimalBase(e.target.value); setPage(0); }}><option value="All">All body families</option>{ANIMAL_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>}
    </div>
    {family === 'animals' && <p className="meta">Six shared body families, with different heads, ears, tails, and shells. Each ready version fits your pieces.</p>}
    {mode === 'near' && <p className="meta">These complete designs are at least 80% covered and need up to six more pieces. Missing supports and signature features stay on the parts list.</p>}
    {mode === 'examples' && <p className="meta">These examples need different pieces. Their parts lists show what each design requires.</p>}
    {alternatives.length > 0 && <aside className="library-alternatives" aria-label="Related ready designs">
      <p>Other builds your pieces can finish</p>
      <div>{alternatives.map(e => <button key={e.id} className="btn" onClick={() => { setQuery(e.name); setFamily('All'); setAnimalBase('All'); setMode('ready'); setPage(0); }}>{e.name} <Arrow /></button>)}</div>
      <small>Each is a complete related design with its own defining features.</small>
    </aside>}
    {!loading && !ready.length && mode === 'ready' && <p className="banner">No library design matches this bucket yet. Check almost-there designs, browse examples, or ask for a new design below.</p>}
    {!filtered.length && (ready.length > 0 || mode !== 'ready') && <p className="meta">No {mode === 'ready' ? 'ready designs' : mode === 'near' ? 'almost-there designs' : 'examples'} match these filters.</p>}
    <div className="cards">{filtered.slice(current * 6, current * 6 + 6).map(e => <LibraryCard key={e.id} entry={e} bucket={bucket} onOpen={onOpen} onRemix={onRemix} />)}</div>
    {pages > 1 && <nav className="library-pagination" aria-label="Library pages">
      <button className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
      <span>Page {current + 1} of {pages} · {filtered.length} designs</span>
      <button className="btn" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Next</button>
    </nav>}
    <p className="meta library-footnote">{entries.length} designs checked. New AI builds that pass construction and visual checks are saved in this browser. Color-only duplicates are skipped.</p>
  </section>;
}
