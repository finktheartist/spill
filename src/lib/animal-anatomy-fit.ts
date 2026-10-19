import { solveAnimalTarget, type AnimalTarget, type AnimalCandidate } from './animal-anatomy';
export interface AnimalAllocation {candidates:AnimalCandidate[];diagnostics:string[]}
/** One cancellable allocation per frozen shape. Search never blocks the UI. */
export async function allocateAnimalTarget(stock:Record<string,number>,target:AnimalTarget,signal:AbortSignal):Promise<AnimalAllocation>{
 if(signal.aborted)throw new DOMException('Stopped','AbortError');
 if(typeof Worker==='undefined'){const diagnostics:string[]=[];return {candidates:solveAnimalTarget(stock,target,diagnostics),diagnostics};}
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./animal-anatomy.worker.ts',import.meta.url),{type:'module'});let settled=false;
  const finish=(error?:Error,result?:AnimalAllocation)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!);};
  const abort=()=>finish(new DOMException('Stopped','AbortError'));
  const timer=setTimeout(()=>finish(Error('Animal allocation timed out. Choose a smaller anatomy.')),12000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data}:{data:AnimalAllocation&{error?:string}})=>finish(data.error?Error(data.error):undefined,data);
  worker.onerror=e=>finish(Error(e.message||'Animal allocation failed.'));
  try{worker.postMessage({stock,target});}catch(e){finish(e as Error);}
 });
}
