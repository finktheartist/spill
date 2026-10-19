import { fitConnectionProgram } from './connection-fit';
import type { ConnectionProgram } from './connections';
import type { TechniqueFitRequest } from './technique-fit.worker';
type Fit=ReturnType<typeof fitConnectionProgram>;
/** Keep the larger whole-model search off the UI thread. Cancellation terminates
 * the worker, including synchronous geometry checks already in progress. */
export async function fitTechniqueProgram(program:ConnectionProgram,stock:Record<string,number>,locked:ReadonlySet<number>,signal:AbortSignal):Promise<Fit>{
  if(signal.aborted)throw new DOMException('Stopped','AbortError');
  if(typeof Worker==='undefined')return fitConnectionProgram(program,stock,{lockedOperations:locked,maxChecks:2500,maxMillis:25000});
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./technique-fit.worker.ts',import.meta.url),{type:'module'});
    let timer:ReturnType<typeof setTimeout>,settled=false;
    const finish=(error:unknown,result?:Fit)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result!);};
    const abort=()=>finish(new DOMException('Stopped','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data}:{data:{result?:Fit;error?:string}})=>finish(data.error?Error(data.error):undefined,data.result);
    worker.onerror=event=>finish(Error(event.message||'Construction worker failed.'));
    timer=setTimeout(()=>finish(Error('Construction fitting timed out. Simplify the crowded arrangement.')),30000);
    const request:TechniqueFitRequest={program,stock,locked:[...locked]};
    try{worker.postMessage(request);}catch(error){finish(error);}
  });
}
