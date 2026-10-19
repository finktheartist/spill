import { afterEach, expect, it, vi } from 'vitest';
import { SCAN_BATCH_TIMEOUT_MS, ScanTimeoutError, withScanDeadline } from './scan-deadline';

afterEach(() => vi.useRealTimers());

it('settles at the deadline and aborts a transport that never settles itself', async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  const work = vi.fn((signal: AbortSignal) => { requestSignal = signal; return new Promise<never>(() => {}); });
  const outcome = withScanDeadline(work).catch(error => error);
  await vi.advanceTimersByTimeAsync(SCAN_BATCH_TIMEOUT_MS);
  expect(await outcome).toBeInstanceOf(ScanTimeoutError);
  expect(requestSignal?.aborted).toBe(true);
  expect(work).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up successful batches without aborting or replaying them', async () => {
  vi.useFakeTimers();
  const parent = new AbortController(), remove = vi.spyOn(parent.signal, 'removeEventListener');
  let requestSignal: AbortSignal | undefined;
  expect(await withScanDeadline(async signal => { requestSignal = signal; return 7; }, parent.signal)).toBe(7);
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  parent.abort();
  expect(requestSignal?.aborted).toBe(false);
});

it('cancels promptly even if the transport ignores the parent abort', async () => {
  vi.useFakeTimers();
  const parent = new AbortController(), reason = new Error('User stopped this scan');
  let requestSignal: AbortSignal | undefined;
  const outcome = withScanDeadline(signal => { requestSignal = signal; return new Promise<never>(() => {}); }, parent.signal).catch(e => e);
  await Promise.resolve(); parent.abort(reason);
  expect(await outcome).toBe(reason);
  expect(requestSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('never starts work for an already cancelled scan', async () => {
  const parent = new AbortController(); parent.abort();
  const work = vi.fn(async () => 1);
  await expect(withScanDeadline(work, parent.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(work).not.toHaveBeenCalled();
});
