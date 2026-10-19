/** Subject routing only: these helpers prove neither stock feasibility nor visual
 * resemblance. The caller must validate both before selecting an adaptation. */
export type AnimalKind = 'dog' | 'fox' | 'bear';
type SubjectKind = AnimalKind | 'quadruped';
type Subject = { kind: SubjectKind; normalized: string; alias: string; detailed: boolean };

const NAMES: Record<AnimalKind, string> = { dog: 'Dog', fox: 'Fox', bear: 'Bear' };
const TRAITS: Record<AnimalKind, readonly string[]> = {
  dog: [
    'Four separated legs under an elongated torso with an open belly.',
    'A moderate projecting muzzle ahead of two separated eyes and a dark nose at its tip.',
    'Paired low or drop ears beside the head.',
    'A narrow raised tail attached at the rump.',
  ],
  fox: [
    'Four separated legs under a lean elongated torso with an open belly.',
    'A long narrow projecting muzzle ahead of two separated eyes and a dark nose at its tip.',
    'Paired alert ears rising above the skull.',
    'A substantial sweeping rear tail, thicker and longer than the dog recipe tail.',
  ],
  bear: [
    'Four separated legs supporting a compact broad chest and head.',
    'A short broad projecting muzzle ahead of two separated eyes and a dark nose at its tip.',
    'Paired rounded ears on the head.',
    'A short stub tail at the rump instead of an extended canine tail.',
  ],
};

// Whole-name aliases, never substring species guesses. Breeds and named subtypes
// route to a general morphology; they are not evidence of breed-specific detailing.
const ALIASES = new Map<string, SubjectKind>();
const add = (kind: SubjectKind, names: readonly string[]) => names.forEach(name => ALIASES.set(name, kind));
add('dog', [
  'dog', 'domestic dog', 'hound', 'hound dog', 'puppy', 'pup', 'retriever', 'terrier',
  'beagle', 'dachshund', 'basset hound', 'bloodhound', 'greyhound', 'whippet', 'poodle',
  'labrador', 'labrador retriever', 'golden retriever', 'german shepherd', 'german shepherd dog',
  'collie', 'border collie', 'corgi', 'welsh corgi', 'pembroke welsh corgi', 'cardigan welsh corgi',
  'dalmatian', 'husky', 'siberian husky', 'samoyed', 'shiba inu', 'akita', 'akita inu',
  // Bare "Boxer" is the atlas sports character; require the animal qualifier.
  'bulldog', 'french bulldog', 'english bulldog', 'boxer dog', 'pug', 'chihuahua', 'rottweiler',
  'doberman', 'doberman pinscher', 'great dane', 'newfoundland', 'saint bernard', 'st bernard',
  'jack russell', 'jack russell terrier', 'yorkshire terrier', 'boston terrier', 'scottish terrier',
  'cocker spaniel', 'spaniel', 'springer spaniel', 'bichon frise', 'shih tzu', 'maltese',
  'pomeranian', 'australian shepherd', 'bernese mountain dog', 'irish setter', 'weimaraner',
]);
add('fox', ['fox', 'red fox', 'arctic fox', 'fennec fox', 'gray fox', 'grey fox', 'fox cub', 'fox kit']);
add('bear', ['bear', 'bear cub', 'brown bear', 'black bear', 'polar bear', 'grizzly', 'grizzly bear', 'panda', 'panda bear', 'giant panda']);
// "Cub" names an age, not a species. Keep it supported without asserting Bear.
add('quadruped', ['animal', 'quadruped', 'quadruped animal', 'four legged animal', 'four legged creature', 'cub']);

const PREFIXES = new Set(['a', 'an', 'the', 'generic', 'simple', 'small', 'little', 'compact', 'blocky', 'stylized', 'lego']);
const SUFFIXES = new Set(['model', 'sculpture', 'figurine', 'build']);
const DETAIL_PREFIXES = new Set(['small', 'little', 'compact']);

function subject(name: string): Subject | null {
  if (typeof name !== 'string' || !name.length || name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return null;
  const normalized = name.trim().toLowerCase().replace(/[-\u2010\u2011]/g, ' ').replace(/\s+/g, ' ');
  if (!/^[a-z]+(?: [a-z]+)*$/.test(normalized)) return null;
  const words = normalized.split(' ');
  let qualified = false;
  while (words.length > 1 && PREFIXES.has(words[0])) {
    qualified ||= DETAIL_PREFIXES.has(words[0]);
    words.shift();
  }
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  const alias = words.join(' '), kind = ALIASES.get(alias);
  if (!kind) return null;
  return { kind, normalized, alias, detailed: qualified || (kind !== 'quadruped' && alias !== kind) };
}

/** Supported whole subjects only. Unknown classes, mixed species, misleading
 * compounds, malformed input and names over 80 characters fail closed. */
export function animalSubjectKind(name: string): AnimalKind | 'quadruped' | null {
  return subject(name)?.kind ?? null;
}

/** Always label the actual morphology with its canonical species name. */
export function animalKindName(kind: AnimalKind): string {
  if (!Object.hasOwn(NAMES, kind)) throw new TypeError('Unsupported animal kind.');
  return NAMES[kind];
}

/** Requested morphology first. Dog and fox are close recipe alternatives; the
 * compact bear is a distinct fallback and must be labelled Bear, with an explicit
 * adaptation reason. This ordering alone never authorizes a silent substitution. */
export function animalRelatedKinds(requested: string): AnimalKind[] {
  switch (animalSubjectKind(requested)) {
    case 'dog': return ['dog', 'fox', 'bear'];
    case 'fox': return ['fox', 'dog', 'bear'];
    case 'bear': return ['bear', 'dog', 'fox'];
    case 'quadruped': return ['dog', 'fox', 'bear'];
    default: return [];
  }
}

/** Intended distinguishing anatomy, not a claim that an unreviewed build has it.
 * Return a fresh array so one consumer cannot rewrite the policy for another. */
export function animalSubjectTraits(kind: AnimalKind): string[] {
  animalKindName(kind);
  return [...TRAITS[kind]];
}

/** Explain the actual subject change without inventing inventory evidence.
 * Only supported requests and canonical actual labels are eligible. Specific
 * breeds/subtypes retain their original request in the explanation, while the
 * model is labelled with its general Dog/Fox/Bear morphology. */
export function animalAdaptationReason(requestedName: string, actualName: string): string | undefined {
  const requested = subject(requestedName), actual = subject(actualName);
  if (!requested || !actual || actual.kind === 'quadruped') return undefined;
  // A builder must not pass a breed/subtype as its actual label and obtain an
  // explanation that implies unsupported identifying details have been verified.
  if (!['dog', 'fox', 'bear', 'compact bear'].includes(actual.normalized)) return undefined;
  const label = animalKindName(actual.kind);
  const request = requestedName.trim();
  if (requested.kind === 'quadruped') {
    const age = requested.alias === 'cub' ? ' No age-specific details are claimed.' : '';
    return `The request “${request}” leaves the species open; this candidate uses the ${label} recipe and is labelled ${label}.${age} Stock feasibility and final proportions are checked separately.`;
  }
  if (requested.kind !== actual.kind) {
    const proportions = actual.kind === 'bear' ? 'compact broad chest and head, short broad muzzle, rounded ears and stub tail'
      : actual.kind === 'fox' ? 'long narrow muzzle, alert ears and substantial sweeping tail'
      : 'moderate muzzle, low or drop ears and narrow raised tail';
    return `Adapted “${request}” to ${label}: the ${label} recipe calls for a ${proportions}. This is a different animal and must be labelled ${label}. Stock feasibility and final proportions are checked separately.`;
  }
  if (requested.detailed) {
    return `Adapted “${request}” to a general ${label} recipe and labelled it ${label}. The requested breed, subtype, age or finer proportion details are not claimed; stock feasibility and final proportions are checked separately.`;
  }
  return undefined;
}
