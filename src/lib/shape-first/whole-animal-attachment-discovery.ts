import { searchWholeAnimalAttachmentsSync, type WholeAnimalStageSearchInput, type WholeAnimalStageSearchOutput } from './whole-animal-attachment-core';
import type { WholeAnimalAttachmentResponse } from './whole-animal-attachment.worker';

export { searchWholeAnimalAttachmentsSync };
export type { WholeAnimalStageSearchInput, WholeAnimalStageSearchOutput };

const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Stopped', 'AbortError'); };

/** One invocation-time snapshot and one short-lived worker per call. Every exit
 * removes handlers/listeners and terminates the worker. The caller owns signal.
 * Node/SSR uses the same bounded synchronous core after a cancellation yield. */
export async function discoverWholeAnimalAttachments(input: WholeAnimalStageSearchInput, signal?: AbortSignal): Promise<WholeAnimalStageSearchOutput> {
  stopped(signal);
  const snapshot = structuredClone(input);
  stopped(signal);
  if (typeof Worker === 'undefined') {
    await Promise.resolve();
    stopped(signal);
    const result = searchWholeAnimalAttachmentsSync(snapshot, signal);
    stopped(signal);
    const output = structuredClone(result);
    stopped(signal);
    return output;
  }
  return new Promise<WholeAnimalStageSearchOutput>((resolve, reject) => {
    const worker = new Worker(new URL('./whole-animal-attachment.worker.ts', import.meta.url), { type: 'module' });
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown, result?: WholeAnimalStageSearchOutput) => {
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
      else if (result) {
        try { const output = structuredClone(result); stopped(signal); resolve(output); } catch (cloneError) { reject(cloneError); }
      } else reject(new Error('Whole-animal attachment discovery returned no result.'));
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    worker.onmessage = ({ data }: MessageEvent<WholeAnimalAttachmentResponse>) => {
      if (settled) return;
      if (data?.ok === true && data.result && typeof data.result === 'object' && data.result.search && typeof data.result.search === 'object') finish(undefined, data.result);
      else finish(new Error(data?.ok === false ? data.error : 'Invalid whole-animal attachment response.'));
    };
    worker.onerror = event => finish(new Error(event.message || 'Whole-animal attachment discovery failed.'));
    worker.onmessageerror = () => finish(new Error('Whole-animal attachment result could not be read.'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('Whole-animal attachment discovery timed out.')), 30000);
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(snapshot); } catch (error) { finish(error); }
  });
}
