import {afterEach,expect,it,vi} from 'vitest';
import {allocateObjectTarget} from './object-layout-fit';
import {createObjectTarget} from './object-layout';
const target=createObjectTarget({family:'robot-bust',shoulderWidth:6,torsoHeight:6,neckHeight:1,face:'eyes'});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('terminates stock search promptly on cancellation',async()=>{
 let worker:any;vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const controller=new AbortController(),pending=allocateObjectTarget({},target,controller.signal);expect(worker.postMessage).toHaveBeenCalledWith({stock:{},target});
 controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(worker.terminate).toHaveBeenCalledOnce();
});
it('times out and releases an unresponsive worker',async()=>{
 vi.useFakeTimers();let worker:any;vi.stubGlobal('Worker',class{terminate=vi.fn();postMessage=vi.fn();constructor(){worker=this;}});
 const pending=allocateObjectTarget({},target,new AbortController().signal),rejected=expect(pending).rejects.toThrow('timed out');
 await vi.advanceTimersByTimeAsync(16001);await rejected;expect(worker.terminate).toHaveBeenCalledOnce();
});
