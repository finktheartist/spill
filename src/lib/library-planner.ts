import { compareNearFits, type LibraryEntry } from './library';
import { FAMILY_STRATEGIES, strategiesFor, subjectWords, type ConstructionFamily } from './construction-families';
import { ANIMAL_BASES } from './animal-recipes';

export function entryMatches(entry: LibraryEntry, query: string): boolean {
  if (!query.trim()) return true;
  const terms = new Set(subjectWords(`${entry.id} ${entry.name} ${entry.pitch} ${(entry.terms ?? []).join(' ')}`));
  return subjectWords(query).every(w => terms.has(w));
}

/** Alternatives are complete checked models, never an unfinished root or a renamed species. */
export function relatedBuilds(entries: LibraryEntry[], requested: string, limit = 3): LibraryEntry[] {
  if (!requested.trim()) return [];
  const direct = entries.filter(e => entryMatches(e, requested));
  const strategies = new Set([...direct.flatMap(e => e.strategy ? [e.strategy] : []), ...strategiesFor(requested).map(f => f.id)]);
  const words = new Set(subjectWords(requested));
  const animalBases = new Set([...direct.flatMap(e => e.animalBase ? [e.animalBase] : []), ...ANIMAL_BASES.filter(b => b.relatives.some(r => words.has(r))).map(b => b.id)]);
  if (/\b(?:four[ -]legged|4[ -]legged|quadruped)\b/i.test(requested)) {
    strategies.add('animals');
    animalBases.add('quadruped');
  }
  return entries.filter(e => e.match && !direct.includes(e) && e.strategy && strategies.has(e.strategy) &&
    (e.strategy !== 'animals' || !animalBases.size || (e.animalBase && animalBases.has(e.animalBase))))
    .sort((a, b) => a.match!.substitutions - b.match!.substitutions || a.name.localeCompare(b.name)).slice(0, limit);
}

export function familyReadiness(entries: LibraryEntry[]) {
  return FAMILY_STRATEGIES.flatMap(f => {
    const candidates = entries.filter(e => e.strategy === f.id);
    const ready = candidates.filter(e => e.match).length, near = candidates.filter(e => !e.match && e.near).length;
    return ready || near ? [{ ...f, ready, near }] : [];
  });
}

export function planForSubject(entries: LibraryEntry[], requested: string, family?: ConstructionFamily) {
  const candidates = entries.filter(e => (!family || e.strategy === family) && entryMatches(e, requested));
  return {
    ready: candidates.filter(e => e.match),
    almost: candidates.filter(e => !e.match && e.near).sort((a, b) => compareNearFits(a.near!, b.near!)),
    examples: candidates.filter(e => !e.match && !e.near),
    alternatives: relatedBuilds(entries, requested),
  };
}
