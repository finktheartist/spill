import { solveObjectTarget, type ObjectTarget, type ObjectCandidate } from './object-layout';
export interface ObjectAllocation {candidates:ObjectCandidate[];diagnostics:string[]}
/** Geometry search runs off the UI thread and can be cancelled during packing. */
export async function allocateObjectTarget(stock:Record<string,number>,target:ObjectTarget,signal:AbortSignal):Promise<ObjectAllocation>{
 if(signal.aborted)throw new DOMException('Stopped','AbortError');
 if(typeof Worker==='undefined'){const diagnostics:string[]=[];return {candidates:solveObjectTarget(stock,target,diagnostics,1),diagnostics};}
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./object-layout.worker.ts',import.meta.url),{type:'module'});let settled=false;
  const finish=(error?:Error,result?:ObjectAllocation)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!);};
  const abort=()=>finish(new DOMException('Stopped','AbortError'));
  const timer=setTimeout(()=>finish(Error('Whole-object allocation timed out. Choose a simpler layout.')),16000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data}:{data:ObjectAllocation&{error?:string}})=>finish(data.error?Error(data.error):undefined,data);
  worker.onerror=e=>finish(Error(e.message||'Whole-object allocation failed.'));
  try{worker.postMessage({stock,target});}catch(e){finish(e as Error);}
 });
}
