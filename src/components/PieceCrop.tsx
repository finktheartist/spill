import {useEffect,useRef,useState} from 'react';
import type {Box,Photo} from '../lib/inventory';
import {photoCrop} from '../lib/photo-crop';
import {partIcon} from '../lib/render';

/** This is evidence from the observed piece, never an illustration of a catalog candidate. */
export function PieceCrop({url,box,size=320}:{url:string;box:Box;size?:number}) {
 const ref=useRef<HTMLCanvasElement>(null),[state,setState]=useState<'loading'|'ready'|'failed'>('loading');
 const coords=box.join(',');
 useEffect(()=>{
  let live=true;const img=new Image();setState('loading');
  img.onload=()=>{
   if(!live)return;
   const canvas=ref.current,g=canvas?.getContext('2d'),crop=photoCrop(img.naturalWidth,img.naturalHeight,box,size);
   if(!canvas||!g||!crop){setState('failed');return;}
   try{
    g.fillStyle='#e6e0d4';g.fillRect(0,0,size,size);
    g.drawImage(img,...crop.source,...crop.destination);
    g.strokeStyle='#b92c86';g.lineWidth=Math.max(1.5,size/120);g.strokeRect(...crop.outline);setState('ready');
   }catch{setState('failed');}
  };
  img.onerror=()=>{if(live)setState('failed');};img.src=url;
  return()=>{live=false;img.onload=null;img.onerror=null;};
 },[url,coords,size]);
 return <span className={`piece-photo-crop ${state}`}>
  <canvas ref={ref} className="piece-crop" width={size} height={size} role="img" aria-label="Close-up of the outlined piece from your photo" hidden={state!=='ready'}/>
  {state!=='ready'&&<span className="piece-photo-placeholder">{state==='failed'?'Photo unavailable':'Loading photo…'}</span>}
 </span>;
}

export function PieceThumbnail({partId,photo,box,number}:{partId?:string;photo?:Photo;box?:Box;number?:string}) {
 const [failed,setFailed]=useState<string|null>(null);
 // The scanner's native guess must never hide the photographed evidence.
 if(photo&&box)return <span className="piece-photo-thumb"><PieceCrop url={photo.url} box={box} size={144}/><small>Your photo</small></span>;
 if(partId&&failed!==partId)return <span className="piece-catalog-thumb"><img src={partIcon(partId)} alt="" onError={()=>setFailed(partId)}/><small>Catalog image</small></span>;
 return <span className="catalog-number" title="No source photo is saved for this observation">{number?`#${number}`:'?'}<small>No photo</small></span>;
}
