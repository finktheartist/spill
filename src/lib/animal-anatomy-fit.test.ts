import {afterEach,expect,it,vi} from 'vitest';
import {allocateAnimalTarget} from './animal-anatomy-fit';
import {createAnimalTarget} from './animal-anatomy';
const target=createAnimalTarget({bodyLength:6,legHeight:4,neckHeight:1,body:'full',muzzle:1,head:'narrow',face:'sloped',ears:'drop',legs:'solid',tail:'stub',color:'reddish-brown',accent:'tan'});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('terminates an in-flight anatomy search on cancellation',async()=>{
 let worker:any;vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const controller=new AbortController(),pending=allocateAnimalTarget({},target,controller.signal);controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(worker.terminate).toHaveBeenCalledOnce();
});
it('times out and releases an unresponsive anatomy worker',async()=>{
 vi.useFakeTimers();let worker:any;vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const pending=allocateAnimalTarget({},target,new AbortController().signal),rejected=expect(pending).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(12001);await rejected;expect(worker.terminate).toHaveBeenCalledOnce();
});
