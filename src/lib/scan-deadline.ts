/** One slow optional batch must not hold every later scan stage open. */
export const SCAN_BATCH_TIMEOUT_MS = 180_000;

export class ScanTimeoutError extends Error {
  constructor() { super('This photo check took too long'); this.name = 'TimeoutError'; }
}

/** Cancel transport and settle locally even if it ignores cancellation. Callers
 * apply results only after this promise resolves, so late results have no effects. */
export function withScanDeadline<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = SCAN_BATCH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ctl = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const stop = (reason: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      reject(reason); ctl.abort(reason);
    };
    const cancel = () => stop(signal?.reason ?? new DOMException('Stopped', 'AbortError'));
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => stop(new ScanTimeoutError()), Math.max(0, timeoutMs));
    Promise.resolve().then(() => { ctl.signal.throwIfAborted(); return work(ctl.signal); }).then(value => {
      if (settled) return;
      settled = true; cleanup(); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    });
  });
}
