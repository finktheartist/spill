import {useState} from 'react';
import {parsePartId,type ColorName} from '../lib/bricks';
import {isViablePiece} from '../lib/piece-gallery';
import {partIcon} from '../lib/render';

export interface CatalogImagePart {num:string;shape?:string;img:string;images?:{url:string;label:string}[]}
type ImageMemo={at:number;failed:Set<string>;success?:string};
const memo=new Map<string,ImageMemo>(),ttl=10*60*1000;
function imageMemo(key:string):ImageMemo {
 const existing=memo.get(key);if(existing&&Date.now()-existing.at<ttl)return existing;
 const value={at:Date.now(),failed:new Set<string>()};
 memo.delete(key);if(memo.size>=256)memo.delete(memo.keys().next().value!);memo.set(key,value);return value;
}

/** Exact mold references only. A procedural preview is explicitly labelled and
 * is available only for the catalog's exact implemented native shape. */
export function CatalogImage({part,color,size=84}:{part:CatalogImagePart;color:ColorName;size?:number}) {
 const images=part.images??[{url:part.img,label:'Catalog reference · color may differ'}];
 const key=JSON.stringify([part.num,images]);
 const [state,setState]=useState(()=>({key,memory:imageMemo(key),failedPreview:false}));
 if(state.key!==key){setState({key,memory:imageMemo(key),failedPreview:false});return null;}
 const offline=typeof location!=='undefined'&&new URLSearchParams(location.search).get('catalogImages')==='off';
 if(offline)return <span className="pe-noicon" title="Catalog preview disabled for offline QA">#{part.num}</span>;
 const {memory}=state;
 const image=images.find(i=>i.url===memory.success&&!memory.failed.has(i.url))??images.find(i=>!memory.failed.has(i.url));
 if(image)return <span className="pe-preview"><img key={image.url} className="pe-photo" src={image.url} width={size} height={size} alt="" loading="lazy" onLoad={()=>{memory.success=image.url;}} onError={()=>{memory.failed.add(image.url);if(memory.success===image.url)memory.success=undefined;setState(s=>({...s}));}}/><small>{image.label}</small></span>;
 const kind=part.shape?parsePartId(`${part.shape}-${color}`):null;
 if(kind&&isViablePiece(kind)&&!state.failedPreview)return <span className="pe-preview"><img className="pe-photo" src={partIcon(kind.partId)} width={size} height={size} alt="" loading="lazy" onError={()=>setState(s=>({...s,failedPreview:true}))}/><small>3D preview · exact supported shape</small></span>;
 return <span className="pe-noicon" title="No preview available for this exact part">#{part.num}<small>No catalog preview</small></span>;
}
