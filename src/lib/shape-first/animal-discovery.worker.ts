import { animalModulePlans, animalCompositionIssues } from '../assembly-composer/animals';
import { animalRelatedKinds, animalKindName } from '../assembly-composer/animal-subjects';
import { searchModuleCompositions } from '../assembly-composer/compose';
import type { AssemblySearchResult } from '../assembly-composer/types';

export interface AnimalDiscoveryRequest {
  stock: Record<string, number>;
  requestedName: string;
  minParts: number;
}

export interface AnimalDiscoveryResult {
  found: AssemblySearchResult;
  planCount: number;
}

export type AnimalDiscoveryResponse =
  | { ok: true; result: AnimalDiscoveryResult }
  | { ok: false; error: string };

/** Deterministic, synchronous discovery shared by the worker and Node fallback.
 * Each completed composition uses its own copy of the exact same stock ledger.
 * Preserve provider ordering within each species, then interleave related kinds
 * so one family cannot consume all 64 result slots before the others are tried. */
export function discoverAnimalCompositionsSync(
  stock: Record<string, number>, requestedName: string, minParts: number,
): AnimalDiscoveryResult {
  const plans = animalModulePlans(stock, requestedName);
  const families = animalRelatedKinds(requestedName).map(kind => plans.filter(p => p.name === animalKindName(kind)));
  const interleaved: typeof plans = [];
  for (let i = 0; i < Math.max(0, ...families.map(g => g.length)); i++) {
    for (const group of families) if (group[i]) interleaved.push(group[i]);
  }
  const found = searchModuleCompositions(interleaved, stock, {
    minParts, maxParts: 80, limit: 64, maxAttempts: 3000, maxMillis: 3000,
    validate: c => animalCompositionIssues(c, c.plan.name),
  });
  return { found, planCount: plans.length };
}

// This module is also imported for its pure core. Never replace a window's
// message handler or assume that a Node/SSR environment has a worker `self`.
if (typeof self !== 'undefined' && typeof document === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = ({ data }: MessageEvent<AnimalDiscoveryRequest>) => {
    let response: AnimalDiscoveryResponse;
    try {
      response = { ok: true, result: discoverAnimalCompositionsSync(data.stock, data.requestedName, data.minParts) };
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : 'Animal composition discovery failed.' };
    }
    self.postMessage(response);
  };
}
