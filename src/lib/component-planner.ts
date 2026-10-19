import { partCount } from './bricks';
import { compileComponents } from './component-kit';
import { componentPlans } from './build-components';
import { matchContext, matchRecipe, type LibraryMatch } from './library';

/** Joint allocation is essential: independently fitted heads and bodies can spend the same brick twice. */
export function componentCandidates(subject: string, stock: Record<string, number>, maxParts: number): LibraryMatch[] {
  const context = matchContext(stock), matches: LibraryMatch[] = [];
  for (const plan of componentPlans(subject)) {
    const { recipe, summary } = compileComponents(plan);
    if (recipe.steps.reduce((n, s) => n + s.parts.length, 0) > maxParts) continue;
    const m = matchRecipe(recipe, stock, context);
    if (m && partCount(m.build) >= 20 && partCount(m.build) <= maxParts) matches.push({ ...m, componentPlan: summary });
  }
  // Prefer coherent color allocation, fewer changed slots, then a different construction.
  return matches.sort((a, b) => Number(a.colorMode === 'mixed') - Number(b.colorMode === 'mixed') || a.substitutions - b.substitutions).slice(0, 3);
}
