import {useId, useRef, useState} from 'react';
import type {Box, Photo} from '../lib/inventory';
import {PieceCrop} from './PieceCrop';

/** Always show the observed pixels, separately from catalog illustrations. */
export function PiecePhotoEvidence({photo, box}: {photo: Photo; box: Box}) {
  const [pile, setPile] = useState(false), zoom = useRef<HTMLDialogElement>(null), id = useId();
  return <figure className="pe-evidence">
    <figcaption>Your piece</figcaption>
    {pile ? <div className="pe-pile-location">
      <img src={photo.url} alt="Your pile with this piece outlined"/>
      <span aria-hidden="true" style={{left: `${box[1]/10}%`, top: `${box[0]/10}%`, width: `${(box[3]-box[1])/10}%`, height: `${(box[2]-box[0])/10}%`}}/>
    </div> : <PieceCrop url={photo.url} box={box} size={768}/>}
    <div className="pe-photo-tools">
      <button type="button" className="linkbtn" onClick={()=>setPile(!pile)}>{pile?'Show close-up':'Show in pile'}</button>
      <button type="button" className="linkbtn" onClick={()=>zoom.current?.showModal()}>Enlarge photo</button>
    </div>
    <p className="meta">Compare the outline, studs and height. Reference colors may differ.</p>
    <dialog ref={zoom} className="pe-photo-zoom" aria-labelledby={id} onClose={e=>e.stopPropagation()}>
      <div className="row"><h3 id={id}>Your piece · enlarged</h3><span className="grow"/><button type="button" className="btn" onClick={()=>zoom.current?.close()}>Close photo</button></div>
      <PieceCrop url={photo.url} box={box} size={1024}/>
    </dialog>
  </figure>;
}
