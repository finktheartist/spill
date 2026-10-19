import {afterEach,expect,it,vi} from 'vitest';
import {fitTechniqueProgram} from './technique-fit';
import type {ConnectionProgram} from './connections';
const program:ConnectionProgram={name:'Pending search',description:'',operations:[]};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('terminates an in-progress geometry worker immediately when the user stops',async()=>{
 let worker:any;
 vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const controller=new AbortController();const pending=fitTechniqueProgram(program,{},new Set([1,2,3]),controller.signal);
 expect(worker.postMessage).toHaveBeenCalledWith({program,stock:{},locked:[1,2,3]});
 controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(worker.terminate).toHaveBeenCalledOnce();
});
it('propagates construction rejection and releases its worker',async()=>{
 let worker:any;vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const pending=fitTechniqueProgram(program,{},new Set(),new AbortController().signal);
 worker.onmessage({data:{error:'Required connection missing'}});
 await expect(pending).rejects.toThrow('Required connection');expect(worker.terminate).toHaveBeenCalledOnce();
});
it('enforces a deadline even if the worker does not respond',async()=>{
 vi.useFakeTimers();let worker:any;vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const pending=fitTechniqueProgram(program,{},new Set(),new AbortController().signal);
 const rejected=expect(pending).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(30001);await rejected;expect(worker.terminate).toHaveBeenCalledOnce();
});
it('never starts a worker for an already-cancelled request',async()=>{
 const worker=vi.fn();vi.stubGlobal('Worker',worker);const controller=new AbortController();controller.abort();
 await expect(fitTechniqueProgram(program,{},new Set(),controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(worker).not.toHaveBeenCalled();
});
