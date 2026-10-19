import { discoverAnimalCompositionsSync, type AnimalDiscoveryRequest, type AnimalDiscoveryResponse, type AnimalDiscoveryResult } from './animal-discovery.worker';

export { discoverAnimalCompositionsSync };
export type { AnimalDiscoveryRequest, AnimalDiscoveryResponse, AnimalDiscoveryResult };

const stopped = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
};

/** Run bounded planning/composition off the browser UI thread. Each call owns one
 * short-lived worker; success, failure, cancellation and timeout all terminate it
 * and remove handlers. The caller retains ownership of its original signal.
 * The Worker-less fallback is synchronous/cooperatively bounded, and therefore
 * cannot preempt geometry already executing; it checks cancellation before/after. */
export async function discoverAnimalCompositions(
  stock: Record<string, number>, requestedName: string, minParts: number, signal?: AbortSignal,
): Promise<AnimalDiscoveryResult> {
  stopped(signal);
  if (typeof Worker === 'undefined') {
    // Match postMessage's invocation-time snapshot despite the microtask yield.
    const snapshot = structuredClone(stock);
    // Let immediate caller cancellation land before entering the synchronous core.
    await Promise.resolve();
    stopped(signal);
    const result = discoverAnimalCompositionsSync(snapshot, requestedName, minParts);
    stopped(signal);
    return result;
  }
  return new Promise<AnimalDiscoveryResult>((resolve, reject) => {
    const worker = new Worker(new URL('./animal-discovery.worker.ts', import.meta.url), { type: 'module' });
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown, result?: AnimalDiscoveryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (signal?.aborted) reject(new DOMException('Stopped', 'AbortError'));
      else if (error !== undefined) reject(error);
      else if (result) resolve(result);
      else reject(new Error('Animal discovery returned no result.'));
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    worker.onmessage = ({ data }: MessageEvent<AnimalDiscoveryResponse>) => {
      if (data?.ok === true) finish(undefined, data.result);
      else finish(new Error(data?.ok === false ? data.error : 'Invalid animal discovery response.'));
    };
    worker.onerror = event => finish(new Error(event.message || 'Animal composition discovery failed.'));
    worker.onmessageerror = () => finish(new Error('Animal discovery result could not be read.'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('Animal composition discovery timed out.')), 30000);
    // Handle cancellation during worker construction/setup before sending stock.
    if (signal?.aborted) { abort(); return; }
    const request: AnimalDiscoveryRequest = { stock, requestedName, minParts };
    try { worker.postMessage(request); } catch (error) { finish(error); }
  });
}
