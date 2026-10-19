import type { Build } from '../bricks';
import { partCount } from '../bricks';
import { constructionIssues } from '../construction';
import type { Verdict } from '../gemini';
import { libraryVerdictQualifies, safeSavedBuild } from '../library-discoveries';
import type { ShapeSlot } from '../shape-first/run';
import { atlasBrief } from './catalog';
import { reviewGeometryCurrent, reviewGeometryRevision } from '../review-geometry';

const DB='spill.atlas-builds.v1',DESIGNS='designs',SUMMARIES='summaries';
export const ATLAS_SAVED_EVENT='spill:atlas-saved';
export interface AtlasDesign {id:string;briefId:string;approachId:string;build:Build;verdict:Verdict;savedAt:number;geometryRevision?:string}
export interface AtlasDesignSummary {id:string;briefId:string;name:string;parts:number;savedAt:number}
/** Two stock-compatible variants may share a silhouette but need different actual parts. */
export function atlasConstructionKey(briefId:string,build:Build) {
  const parts=build.steps.flatMap(s=>s.parts).map(p=>JSON.stringify([p.partId,p.x,p.y,p.z,p.rot,p.orientation??null])).sort();
  return JSON.stringify({briefId,parts});
}
function openDatabase():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(Error('Browser storage is unavailable.'));return;}
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{
      const store=req.result.createObjectStore(DESIGNS,{keyPath:'id'});store.createIndex('briefId','briefId');
      req.result.createObjectStore(SUMMARIES,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('Close another atlas tab to upgrade saved-build storage.'));
  });
}
const stopped=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Stopped','AbortError');};
function getAll<T>(store:IDBObjectStore|IDBIndex,key?:IDBValidKey):Promise<T[]> {
  return new Promise((resolve,reject)=>{const req=store.getAll(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
export async function atlasDesignSummaries():Promise<AtlasDesignSummary[]> {
  const db=await openDatabase();try{return await getAll<AtlasDesignSummary>(db.transaction(SUMMARIES).objectStore(SUMMARIES));}finally{db.close();}
}
export async function savedAtlasDesigns(stock:Record<string,number>,briefIds:string[]):Promise<Map<string,AtlasDesign>> {
  const db=await openDatabase();
  try {
    const store=db.transaction(DESIGNS).objectStore(DESIGNS).index('briefId');
    const groups=await Promise.all([...new Set(briefIds)].map(id=>getAll<AtlasDesign>(store,id)));
    const matches=new Map<string,AtlasDesign>();
    for(const list of groups)for(const d of list.sort((a,b)=>b.savedAt-a.savedAt))
      if(!matches.has(d.briefId)&&safeSavedBuild(d.build)&&libraryVerdictQualifies(d.verdict)&&reviewGeometryCurrent(d.build,d.geometryRevision)&&!constructionIssues(d.build,stock,24).length)matches.set(d.briefId,d);
    return matches;
  }finally{db.close();}
}
export async function saveAtlasDesign(slot:ShapeSlot,stock:Record<string,number>,signal?:AbortSignal) {
  stopped(signal);const {build,verdict:v}=slot,atlas=slot.idea.atlas;
  if(!atlas||!atlasBrief(atlas.briefId)||!build||!v||!v.pass||slot.craftReview?.pass===false||slot.phase!=='ready')return {status:'rejected' as const};
  const verdict:Verdict={looksLike:v.looksLike,recognizable:v.recognizable,complete:v.complete,colors:v.colors,impressive:v.impressive,
    fixes:v.fixes,review:'blind-v1',subjectMatched:v.named,named:v.named};
  if(!libraryVerdictQualifies(verdict)||!safeSavedBuild(build)||constructionIssues(build,stock,24).length)return {status:'rejected' as const};
  try {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(atlasConstructionKey(atlas.briefId,build)));stopped(signal);
    const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join(''),db=await openDatabase();
    try {
      stopped(signal);
      const record:AtlasDesign={id,...atlas,build:structuredClone(build),verdict,savedAt:Date.now(),geometryRevision:reviewGeometryRevision(build)};
      const summary:AtlasDesignSummary={id,briefId:atlas.briefId,name:build.name,parts:partCount(build),savedAt:record.savedAt};
      const status=await new Promise<'saved'|'duplicate'>((resolve,reject)=>{
        const tx=db.transaction([DESIGNS,SUMMARIES],'readwrite'),store=tx.objectStore(DESIGNS),existing=store.get(id);
        let duplicate=false;
        const abort=()=>{try{tx.abort();}catch{/* transaction already completed */}};signal?.addEventListener('abort',abort,{once:true});
        existing.onsuccess=()=>{duplicate=!!existing.result&&reviewGeometryCurrent(existing.result.build,existing.result.geometryRevision);if(!duplicate){store.put(record);tx.objectStore(SUMMARIES).put(summary);}};
        tx.oncomplete=()=>{signal?.removeEventListener('abort',abort);resolve(duplicate?'duplicate':'saved');};
        tx.onerror=tx.onabort=()=>{signal?.removeEventListener('abort',abort);reject(signal?.aborted?new DOMException('Stopped','AbortError'):tx.error??Error('Could not save this design.'));};
      });
      stopped(signal);
      if(status==='saved'&&typeof window!=='undefined')window.dispatchEvent(new Event(ATLAS_SAVED_EVENT));
      return {status};
    }finally{db.close();}
  }catch(e){if(signal?.aborted)throw e;return {status:'unavailable' as const};}
}
