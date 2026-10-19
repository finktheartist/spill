/** Shared offline catalog search. Pure browser-safe data/query operations only;
 * loading, native crosswalk assignment and image fetching remain caller-owned.
 */
import {recommendPartsCatalog,recommendPartsCatalogByTags,type PartRecommendationContext} from './part-recommendations';
import {readPartTags} from '../src/lib/part-tags';
export interface CatalogPart { num: string; name: string; category: string; pop: number; shape?: string; look: string|null; words: string; colors: number[]; elements: string[]; identifiers: string[] }
export interface CatalogMetadata {
  totalParts:number; searchableParts:number; nativeParts:number;
  snapshotDate:string|null; snapshotDateSource:'local-downloaded-label'|'unknown';
  freshness:'local-snapshot-not-live-verified'; excludes:string[];
  nativeMapping:'exact-rebrickable-part-number';
}
export interface PartsCatalog {parts:CatalogPart[];catalog:CatalogMetadata;colorIds:Record<string,number>}
export interface CatalogImageOption {url:string;label:string}

const validColorId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function actualColors(value:unknown):number[]|null {
  return Array.isArray(value)?[...new Set(value.filter(validColorId))]:null;
}
function selectedColor(colors:number[],requestedColor?:number):number {
  return validColorId(requestedColor)&&colors.includes(requestedColor)?requestedColor:colors[0]??71;
}

/** Exact-mold candidates only; availability is not asserted and no images are
 * fetched here. Saved element IDs belong to this record; they are never inferred
 * from a mold stem, category, neighboring variant or element-number pattern.
 */
export function catalogImageOptions(part:Pick<CatalogPart,'num'|'colors'|'elements'>,requestedColor?:number):CatalogImageOption[] {
  if(typeof part.num!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part.num))return [];
  const colors=actualColors(part.colors);if(colors===null)return [];
  const selected=selectedColor(colors,requestedColor),images:CatalogImageOption[]=[],seen=new Set<string>();
  const add=(url:string,label:string)=>{if(images.length<8&&!seen.has(url)){seen.add(url);images.push({url,label});}};
  const requestedSaved=validColorId(requestedColor)&&colors.includes(requestedColor);
  const firstLabel=!colors.length?'Render — fallback color 71 (no saved color recorded)':requestedSaved?`Render — requested color ${selected}`:`Render — saved color ${selected}${validColorId(requestedColor)?' (requested color unavailable)':''}`;
  add(`https://cdn.rebrickable.com/media/parts/ldraw/${selected}/${encodeURIComponent(part.num)}.png`,firstLabel);
  for(const color of colors.filter(c=>c!==selected).slice(0,3))add(`https://cdn.rebrickable.com/media/parts/ldraw/${color}/${encodeURIComponent(part.num)}.png`,`Render — other saved color ${color}`);
  for(const id of Array.isArray(part.elements)?part.elements:[]){
    if(images.length===8)break;
    if(typeof id==='string'&&/^\d{1,20}$/.test(id))add(`https://cdn.rebrickable.com/media/parts/elements/${id}.jpg`,`Element ${id} photo — color may differ`);
  }
  return images;
}

/** "1x2", "1 x 2" and "1 × 2" read the same; everything lower-case. */
export const normalizeCatalogQuery = (s: string) => s.toLowerCase().replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1 x ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function searchPartsCatalog(data:PartsCatalog,params:URLSearchParams){
  const rawQuery=params.get('q')??'';
  if(rawQuery.length>256)throw new RangeError('q must be at most 256 characters');
  const integer=(key:string,fallback:number)=>{
    const raw=params.get(key);if(raw===null)return fallback;
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new RangeError(`${key} must be a nonnegative integer`);
    return Number(raw);
  };
  const offset=integer('offset',0),requestedLimit=integer('limit',params.get('recommend')==='1'&&(params.has('tags')||params.has('guesses'))?24:40);
  if(offset>1000000)throw new RangeError('offset must be at most 1000000');
  if(requestedLimit<1)throw new RangeError('limit must be positive');
  const limit=Math.min(80,requestedLimit),q=normalizeCatalogQuery(rawQuery);
  let want=data.colorIds[params.get('color')??''];
  const resultPart=({words:_words,identifiers:_ids,colors,elements:_elements,...p}:CatalogPart)=>{
    const c=selectedColor(actualColors(colors)??[],want);
    return {...p,img:`/api/part-image/${encodeURIComponent(p.num)}?c=${c}`,inColor:c===want,images:catalogImageOptions({num:p.num,colors,elements:_elements},want)};
  };
  if(params.has('recommend')&&!['0','1'].includes(params.get('recommend')!))throw new RangeError('recommend must be 0 or 1');
  if(params.has('shortlist')&&!['0','1'].includes(params.get('shortlist')!))throw new RangeError('shortlist must be 0 or 1');
  if(params.get('recommend')==='1'){
    if(params.has('tags')||params.has('guesses')){
      const raw=params.get('tags')??'{}';if(raw.length>8192)throw new RangeError('tags must be at most 8192 characters');
      let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new RangeError('tags must be a JSON object');}
      const tags=readPartTags(parsed),color=tags.color?.[0]??params.get('color')??'';
      let guesses:unknown;
      if(params.has('guesses')){
        const rawGuesses=params.get('guesses')!;if(rawGuesses.length>8192)throw new RangeError('guesses must be at most 8192 characters');
        try{guesses=JSON.parse(rawGuesses);}catch{throw new RangeError('guesses must be a JSON object');}
        guesses=readPartTags(guesses);
      }
      want=data.colorIds[color];
      const result=recommendPartsCatalogByTags(data,tags,{query:rawQuery,color,offset,limit,guesses,shortlist:params.get('shortlist')==='1'});
      return {count:result.count,total:result.total,parts:result.parts.map(p=>({...resultPart(p),matchReasons:p.matchReasons,matchCautions:p.matchCautions})),offset,limit,hasMore:result.hasMore,nextOffset:result.nextOffset,catalog:data.catalog,facets:result.facets,
        recommendation:{evidence:result.evidence,needsMoreEvidence:result.needsMoreEvidence,method:'catalog-feature-tags'}};
    }
    const bounded=(key:string,max:number)=>{const value=params.get(key)??'';if(value.length>max)throw new RangeError(`${key} is too long`);return value;};
    const context:PartRecommendationContext={description:bounded('description',500),num:bounded('num',80),shape:bounded('shape',80),size:bounded('size',40),family:bounded('family',40),color:params.get('color')??''};
    const raw=bounded('features',800);
    if(raw){try{context.features=JSON.parse(raw);}catch{throw new RangeError('features must be a JSON object');}if(!context.features||typeof context.features!=='object'||Array.isArray(context.features))throw new RangeError('features must be a JSON object');}
    const result=recommendPartsCatalog(data,context,Math.min(limit,12));
    return {count:result.parts.length,total:data.parts.length,parts:result.parts.map(p=>({...resultPart(p),matchReasons:p.matchReasons,matchCautions:p.matchCautions})),offset:0,limit:Math.min(limit,12),hasMore:false,nextOffset:null,catalog:data.catalog,
      recommendation:{evidence:result.evidence,needsMoreEvidence:result.needsMoreEvidence,method:'catalog-clue-ranking'}};
  }
  const sizes=[...q.matchAll(/\b(\d+) x (\d+)\b/g)].map(m=>[`${m[1]} x ${m[2]}`,`${m[2]} x ${m[1]}`]);
  const words=q.replace(/\b\d+ x \d+\b/g,' ').split(' ').filter(Boolean);
  const has=(text:string,phrase:string)=>new RegExp(`(^| )${phrase}( |$)`).test(text);
  const hits=sizes.length||words.length?data.parts.filter(p=>sizes.every(pair=>pair.some(z=>has(p.words,z)))&&words.every(t=>p.words.includes(t))):data.parts;
  const exact=hits.filter(p=>q!==''&&normalizeCatalogQuery(p.num)===q);
  const elements=hits.filter(p=>!exact.includes(p)&&q!==''&&p.identifiers.slice(1).some(id=>normalizeCatalogQuery(id)===q));
  const ranked=[...exact,...elements,...hits.filter(p=>!exact.includes(p)&&!elements.includes(p))];
  const parts=ranked.slice(offset,offset+limit).map(resultPart);
  const nextOffset=offset+parts.length<hits.length?offset+parts.length:null;
  return {count:hits.length,total:data.parts.length,parts,offset,limit,hasMore:nextOffset!==null,nextOffset,catalog:data.catalog};
}
