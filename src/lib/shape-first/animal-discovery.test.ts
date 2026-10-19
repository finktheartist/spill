import {afterEach,describe,expect,it,vi} from 'vitest';
import {discoverAnimalCompositions,type AnimalDiscoveryResult} from './animal-discovery';
const result:AnimalDiscoveryResult={planCount:0,found:{candidates:[],attempts:0,rejected:0,exhausted:false}};
class FakeWorker {
 static instances:FakeWorker[]=[];
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{message:string})=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();
 constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
describe('animal search worker lifecycle',()=>{
 it('terminates the worker and removes its handlers after success',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const promise=discoverAnimalCompositions({},'Dog',20),worker=FakeWorker.instances[0];
  worker.onmessage!({data:{ok:true,result}});expect(await promise).toEqual(result);expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();expect(worker.onerror).toBeNull();expect(worker.onmessageerror).toBeNull();
 });
 it('rejects cancellation and ignores a response queued before termination',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const ctl=new AbortController(),promise=discoverAnimalCompositions({},'Dog',20,ctl.signal),worker=FakeWorker.instances[0],late=worker.onmessage!;
  const assertion=expect(promise).rejects.toMatchObject({name:'AbortError'});ctl.abort();late({data:{ok:true,result}});await assertion;expect(worker.terminate).toHaveBeenCalledOnce();
 });
 it('cleans up a worker error and rejects instead of accepting an incomplete result',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const promise=discoverAnimalCompositions({},'Dog',20),worker=FakeWorker.instances[0];worker.onerror!({message:'Load failure'});
  await expect(promise).rejects.toThrow('Load failure');expect(worker.terminate).toHaveBeenCalledOnce();
 });
 it('bounds a stalled worker with its watchdog',async()=>{
  vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);const promise=discoverAnimalCompositions({},'Dog',20),worker=FakeWorker.instances[0],assertion=expect(promise).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30000);await assertion;expect(worker.terminate).toHaveBeenCalledOnce();
 });
 it('honors immediate cancellation before entering the worker-less synchronous core',async()=>{
  vi.stubGlobal('Worker',undefined);const ctl=new AbortController(),promise=discoverAnimalCompositions({},'Dog',20,ctl.signal);ctl.abort();await expect(promise).rejects.toMatchObject({name:'AbortError'});
 });
});
