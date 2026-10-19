import { pavilionCandidates } from './pavilion-modules';
self.onmessage = ({ data }: { data: Record<string, number> }) => {
  try { self.postMessage(pavilionCandidates(data)); }
  catch (e) { self.postMessage({ error: (e as Error).message }); }
};
