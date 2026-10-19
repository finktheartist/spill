import { useEffect, useRef, useState } from 'react';
import { spillHero } from '../lib/render';
import { Arrow, Camera } from '../components/Icons';

const HERO_PARTS = [
  'brick-2x4-red', 'brick-2x2-yellow', 'plate-2x4-blue', 'brick-1x4-white', 'slope-2x2-red', 'brick-2x4-blue',
  'brick-1x2-yellow', 'plate-2x2-green', 'brick-2x2-white', 'tile-1x2-black', 'brick-2x4-yellow', 'brick-1x1-red',
  'slope-1x2-white', 'brick-2x3-orange', 'plate-1x4-light-gray', 'brick-2x2-green', 'brick-1x2-black', 'brick-2x4-white',
  'plate-2x6-azure', 'brick-1x2-trans-clear', 'brick-2x2-blue', 'slope-2x2-blue', 'brick-1x4-red', 'plate-4x4-tan',
];

/** iPhone HEIC files often arrive with an empty type in desktop browsers, so check the name too. */
const isPhoto = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);
const ACCEPT = 'image/*,.heic,.heif';

/**
 * The first screen: one photo from straight above (it counts the parts) and, optionally, angled photos of the
 * same pile (they check it: plate or brick, pieces stuck together). Then "Scan my pile".
 */
export function Capture({ main, angles, loading, onPickMain, onPickAngles, onRemoveMain, onRemoveAngle, onScan, onSample, onExplore }: {
  main?: string; angles: string[]; loading: boolean;
  onPickMain: (f: File) => void; onPickAngles: (f: File[]) => void; onRemoveMain: () => void; onRemoveAngle: (i: number) => void;
  onScan: () => void; onSample: () => void; onExplore: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => (canvas.current ? spillHero(canvas.current, HERO_PARTS) : undefined), []);

  return (
    <main
      className={`capture${drag ? ' dropzone-active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false);
        // dropped photos fill the "from above" slot first, the rest are angled
        const files = [...e.dataTransfer.files].filter(isPhoto);
        if (!files.length) return;
        if (!main) { onPickMain(files[0]); if (files.length > 1) onPickAngles(files.slice(1)); } else onPickAngles(files);
      }}
    >
      <div className="hero"><canvas ref={canvas} aria-hidden /></div>
      <div className="copy fade-in">
        <h1>What's in the bucket?</h1>
        <p className="lede">Photograph your loose bricks. Find designs that fit your pieces, with instructions.</p>

        <div className="shots">
          <section className="shot-slot">
            <div className="slot-head"><b>1</b><span>From straight above</span><small className="meta">counts the parts</small></div>
            {main ? (
              <div className="slot-thumbs">
                <figure className="slot-thumb main-thumb">
                  <img src={main} alt="Your photo from above" />
                  <button className="thumb-x" aria-label="Remove this photo" onClick={onRemoveMain}>×</button>
                </figure>
              </div>
            ) : (
              <label className="btn primary big">
                <Camera /> Photo from above
                <input className="sr" type="file" accept={ACCEPT} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPickMain(f); }} />
              </label>
            )}
          </section>

          <section className="shot-slot">
            <div className="slot-head"><b>2</b><span>From an angle</span><small className="meta">optional · tells plates from bricks, spots stacked pieces</small></div>
            <div className="slot-thumbs">
              {angles.map((u, i) => (
                <figure key={i} className="slot-thumb">
                  <img src={u} alt={`Angled photo ${i + 1}`} />
                  <button className="thumb-x" aria-label="Remove this photo" onClick={() => onRemoveAngle(i)}>×</button>
                </figure>
              ))}
              <label className="btn">
                <Camera /> {angles.length ? 'Add more' : 'Add angled photos'}
                <input className="sr" type="file" multiple accept={ACCEPT} onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) onPickAngles(fs); }} />
              </label>
            </div>
          </section>
        </div>

        {loading && <p className="meta">Opening your photos…</p>}
        {main && !loading && (
          <button className="btn primary big scan-go" onClick={onScan}>
            Scan my pile{angles.length ? ` · ${angles.length} angled ${angles.length === 1 ? 'photo' : 'photos'} to check it` : ''} <Arrow />
          </button>
        )}
        <p className="tip">Spread them flat on a plain surface, one layer.</p>
        <button className="linkbtn" onClick={onSample}>Try a sample bucket</button>
        <div className="capture-explore"><b>Want to build something bigger?</b><span>Explore detailed models with any parts.</span><button className="btn" onClick={onExplore}>Browse detailed models <Arrow /></button></div>
      </div>
    </main>
  );
}
