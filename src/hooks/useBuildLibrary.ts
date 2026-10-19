import { useEffect, useRef, useState } from 'react';
import type { LibraryEntry } from '../lib/library';
import type { Discovery } from '../lib/library-discoveries';

export interface LibraryState { entries: LibraryEntry[]; loading: boolean; completed: number; total: number; error?: string }
const EMPTY: LibraryState = { entries: [], loading: false, completed: 0, total: 0 };
export function useBuildLibrary(stock: Record<string, number>, enabled: boolean, saved: Discovery[]): LibraryState {
  const key = JSON.stringify(Object.entries(stock).sort(([a], [b]) => a.localeCompare(b)));
  const savedKey = saved.map(d => d.id).join('|');
  const requestKey = key + ':' + savedKey;
  const [state, setState] = useState<LibraryState & { key?: string }>(EMPTY);
  const cache = useRef<{ key: string; state: LibraryState } | null>(null);
  const inputs = useRef({ stock, saved }); inputs.current = { stock, saved };
  useEffect(() => {
    if (!enabled) return;
    if (cache.current?.key === requestKey) { setState({ ...cache.current.state, key: requestKey }); return; }
    let active = true;
    const entries: LibraryEntry[] = [];
    setState({ ...EMPTY, key: requestKey, loading: true });
    const worker = new Worker(new URL('../lib/library.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!active) return;
      if (data.error) { setState(s => ({ ...s, loading: false, error: data.error })); worker.terminate(); return; }
      if (data.done) {
        const result = { entries: [...entries], loading: false, completed: entries.length, total: entries.length };
        cache.current = { key: requestKey, state: result }; setState({ ...result, key: requestKey }); worker.terminate(); return;
      }
      if (data.entry) entries.push(data.entry);
      setState({ key: requestKey, entries: [...entries], loading: true, completed: data.completed, total: data.total });
    };
    worker.onerror = () => { if (active) setState(s => ({ ...s, loading: false, error: 'The library search could not finish. Reopen builds to retry.' })); worker.terminate(); };
    worker.postMessage(inputs.current);
    return () => { active = false; worker.terminate(); };
  }, [requestKey, enabled]);
  if (state.key !== requestKey) return { ...EMPTY, loading: enabled };
  return { entries: state.entries, loading: state.loading, completed: state.completed, total: state.total, error: state.error };
}
