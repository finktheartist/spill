import { composeWholeAnimal, partialWholeAnimalAnatomyIssues, type WholeAnimalLayout } from '../assembly-composer/animal-whole';
import { searchAnimalAttachments, type AnimalAttachmentSearchResult } from '../assembly-composer/animal-attachment-search';
import type { AssemblyComposition } from '../assembly-composer/types';
import { animalBlueprintIssues, type AnimalBlueprint } from './animal-blueprint';
import { unmatedAnimalPortBrief, type WholeAnimalConnection, type WholeAnimalConnectionIntent } from './whole-animal-connections';
import { foxFeatureLandmarks } from './whole-animal-landmarks';
import { mutableWholeAnimalSketchIssues, wholeAnimalPartialPlanIssues } from './whole-animal-plan-fit';
import { wholeAnimalAttachmentRequests, wholeAnimalAttachmentScore } from './whole-animal-search';
import { advanceWholeAnimalStage, type WholeAnimalStage, type WholeAnimalStageState } from './whole-animal-stages';

export interface WholeAnimalStageSearchInput {
  stock: Record<string, number>;
  prefix: WholeAnimalConnectionIntent;
  operations: WholeAnimalConnection[];
  blueprint: AnimalBlueprint;
  stage: WholeAnimalStage;
  state?: WholeAnimalStageState;
  minParts: number;
  meta: Pick<WholeAnimalLayout, 'id' | 'description' | 'stance'>;
}
export interface WholeAnimalStageSearchOutput {
  search: AnimalAttachmentSearchResult;
  /** A complete canonical construction with editable sketch mismatches only.
   * Diagnostic/reconciliation evidence, never an accepted search candidate. */
  canonical?: { composition: AssemblyComposition; layout: WholeAnimalLayout; intent: WholeAnimalConnectionIntent; issues: string[]; rank: number };
}

/** Pure synchronous stage search, shared by the worker and Worker-less fallback.
 * Keeps the existing request policy, lower-is-better ranker and all stage gates.
 * Does not generate, commit a stage, revise a sketch or accept a whole animal.
 * The fallback can check abort cooperatively but cannot interrupt synchronous JS. */
export function searchWholeAnimalAttachmentsSync(input: WholeAnimalStageSearchInput, signal?: AbortSignal): WholeAnimalStageSearchOutput {
  const active = () => { if (signal?.aborted) throw new DOMException('Stopped', 'AbortError'); };
  active();
  const { stock, prefix, operations, blueprint, stage, state, minParts, meta } = input;
  const requests = wholeAnimalAttachmentRequests(prefix, operations), ranker = wholeAnimalAttachmentScore(blueprint, requests, prefix.operations.length);
  const captured: { best?: WholeAnimalStageSearchOutput['canonical'] } = {};
  const search = searchAnimalAttachments(stock, prefix, requests, {
    signal, maxChanges: 6, maxAttempts: 12000, maxMillis: 5000, beamWidth: 8, score: ranker,
    validate: (target, intent) => {
      const bounded = (() => {
        try {
          const actual = { ...target, id: meta.id, description: meta.description, stance: meta.stance };
          const fit = wholeAnimalPartialPlanIssues(actual, blueprint);
          if (fit.length) return fit;
          if (stage === 'legs') {
            const morphology = partialWholeAnimalAnatomyIssues(actual);
            if (morphology.length) return morphology;
          }
          const progress = advanceWholeAnimalStage(actual, intent, stock, state);
          if (stage === 'features') {
            const issues = foxFeatureLandmarks(actual).issues;
            if (issues.length) return issues;
            if (!unmatedAnimalPortBrief(actual, 'body').some(p => p.unmatedPorts.some(port => port.kind === 'grip' && port.normal[2] < -.9))) return ['Leave an actual free downward neck grip.'];
          }
          if (progress.complete) {
            const composition = composeWholeAnimal(stock, actual), issues = animalBlueprintIssues(composition, blueprint, stock);
            if (composition.build.steps.flatMap(s => s.parts).length >= minParts && mutableWholeAnimalSketchIssues(issues, blueprint)) {
              const rank = issues.length * 1e9 + ranker(actual, requests.length);
              if (!captured.best || rank < captured.best.rank) captured.best = { composition, layout: structuredClone(actual), intent: structuredClone(intent), issues: [...issues], rank };
            }
            return issues;
          }
          return [];
        } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
      })();
      return bounded.slice(0, 32).map(s => s.slice(0, 1000));
    },
  });
  active();
  return { search, ...(captured.best ? { canonical: captured.best } : {}) };
}
