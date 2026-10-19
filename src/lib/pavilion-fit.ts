import { pavilionCandidates, type PavilionAllocation } from './pavilion-modules';

export async function allocatePavilions(stock: Record<string, number>, signal: AbortSignal): Promise<PavilionAllocation> {
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  if (typeof Worker === 'undefined') return pavilionCandidates(stock);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pavilion.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, result?: PavilionAllocation) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(() => finish(Error('The pavilion search timed out.')), 16000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: { data: PavilionAllocation & { error?: string } }) => finish(data.error ? Error(data.error) : undefined, data);
    worker.onerror = e => finish(Error(e.message || 'Pavilion allocation failed.'));
    try { worker.postMessage(stock); } catch (e) { finish(e as Error); }
  });
}
