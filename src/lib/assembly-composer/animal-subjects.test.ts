import { describe, expect, it } from 'vitest';
import {
  animalAdaptationReason, animalKindName, animalRelatedKinds, animalSubjectKind, animalSubjectTraits,
  type AnimalKind,
} from './animal-subjects';

describe('bounded whole-subject animal policy', () => {
  it('routes the supported generic aliases without guessing from substrings', () => {
    for (const name of ['Dog', 'dog', 'DOG', 'hound', 'hound dog', 'puppy', 'pup', 'domestic dog']) expect(animalSubjectKind(name)).toBe('dog');
    for (const name of ['Fox', 'fox', 'red fox', 'arctic fox', 'fennec fox', 'grey fox', 'fox cub', 'fox kit']) expect(animalSubjectKind(name)).toBe('fox');
    for (const name of ['Bear', 'bear', 'bear cub', 'brown bear', 'polar bear', 'grizzly bear', 'panda bear']) expect(animalSubjectKind(name)).toBe('bear');
    for (const name of ['animal', 'quadruped', 'quadruped animal', 'four-legged animal', 'four legged creature', 'cub']) expect(animalSubjectKind(name)).toBe('quadruped');
  });

  it('accepts bounded generic wrappers and normalizes case, spaces and word separators', () => {
    const aliases: [string, AnimalKind | 'quadruped'][] = [
      ['  A simple LEGO dog model  ', 'dog'], ['The small fox figurine', 'fox'],
      ['Compact bear', 'bear'], ['a generic quadruped sculpture', 'quadruped'],
      ['A four\u2011legged animal', 'quadruped'], ['GOLDEN-RETRIEVER', 'dog'],
      ['A   little   hound build', 'dog'], ['LEGO bear', 'bear'],
    ];
    for (const [name, kind] of aliases) expect(animalSubjectKind(name)).toBe(kind);
  });

  it('routes common known breeds to Dog while preserving the original request in its adaptation', () => {
    for (const breed of [
      'Beagle', 'Dachshund', 'Basset hound', 'Golden retriever', 'Labrador retriever', 'German shepherd',
      'Border collie', 'Corgi', 'Poodle', 'Pug', 'Dalmatian', 'Siberian husky', 'Shiba Inu',
      'Boxer dog', 'Great Dane', 'Jack Russell terrier', 'Bernese mountain dog',
    ]) {
      expect(animalSubjectKind(breed)).toBe('dog');
      expect(animalKindName(animalSubjectKind(breed) as AnimalKind)).toBe('Dog');
      const reason = animalAdaptationReason(breed, 'Dog');
      expect(reason).toContain(breed);
      expect(reason).toContain('general Dog');
      expect(reason).toMatch(/breed.*not claimed/);
    }
  });

  it('fails closed on misleading compounds, unrelated objects, species mixtures and unsupported classes', () => {
    for (const name of [
      'foxglove', 'foxglove flower', 'bearchair', 'bear chair', 'seafox', 'sea fox', 'dogfish', 'dog fish',
      'dogwood', 'hot dog', 'corn dog', 'dog house', 'dog-shaped chair', 'fox-shaped plane', 'bear trap',
      'bird', 'owl', 'penguin', 'dinosaur', 'T rex', 'rabbit', 'bunny', 'giraffe', 'long-necked giraffe',
      'cat', 'wolf', 'horse', 'elephant', 'lion', 'lion cub', 'red panda', 'teddy bear', 'teddy', 'Boxer',
      'dog and fox', 'dog or bear', 'fox-bear hybrid', 'bird dog', 'bear dog', 'dogfish puppy',
      'generic bird', 'small rabbit', 'a dog with wings', 'two dogs', 'animal chair', 'dog-like dinosaur',
    ]) {
      expect(animalSubjectKind(name), name).toBeNull();
      expect(animalRelatedKinds(name), name).toEqual([]);
      expect(animalAdaptationReason(name, 'Dog'), name).toBeUndefined();
    }
  });

  it('fails closed for invalid, blank, oversized, control-character and hidden-content names', () => {
    const invalid = [undefined, null, 5, {}, [], true, '', '    ', 'dog\0', 'dog\n', 'dog\t',
      'dog\u200b', '<dog>', 'Dog 🐕', 'dog/fox', 'dog;fox', 'dog_fox', `${' '.repeat(78)}dog`, 'dog'.repeat(10000)];
    for (const value of invalid) {
      const name = value as string;
      expect(animalSubjectKind(name)).toBeNull();
      expect(animalRelatedKinds(name)).toEqual([]);
      expect(animalAdaptationReason(name, 'Dog')).toBeUndefined();
      expect(animalAdaptationReason('Dog', name)).toBeUndefined();
    }
    expect(animalSubjectKind(`${' '.repeat(77)}dog`)).toBe('dog'); // exactly 80 characters
  });
});

describe('honest actual labels and alternative ordering', () => {
  it('uses canonical species labels and rejects an invalid actual kind', () => {
    expect(['dog', 'fox', 'bear'].map(k => animalKindName(k as AnimalKind))).toEqual(['Dog', 'Fox', 'Bear']);
    for (const kind of ['quadruped', 'rabbit', 'toString', '__proto__', undefined, null]) {
      expect(() => animalKindName(kind as AnimalKind)).toThrow(/Unsupported animal kind/);
      expect(() => animalSubjectTraits(kind as AnimalKind)).toThrow(/Unsupported animal kind/);
    }
  });

  it('keeps requested species first, dog/fox close together and bear explicitly distinct', () => {
    expect(animalRelatedKinds('Dog')).toEqual(['dog', 'fox', 'bear']);
    expect(animalRelatedKinds('Golden retriever')).toEqual(['dog', 'fox', 'bear']);
    expect(animalRelatedKinds('Fox')).toEqual(['fox', 'dog', 'bear']);
    expect(animalRelatedKinds('Bear cub')).toEqual(['bear', 'dog', 'fox']);
    expect(animalRelatedKinds('Animal')).toEqual(['dog', 'fox', 'bear']);
    for (const requested of ['Dog', 'Fox', 'Bear']) {
      for (const actual of animalRelatedKinds(requested)) if (animalKindName(actual) !== requested) {
        const reason = animalAdaptationReason(requested, animalKindName(actual));
        expect(reason).toContain('different animal');
        expect(reason).toContain(`must be labelled ${animalKindName(actual)}`);
      }
    }
    expect(animalAdaptationReason('Dog', 'Bear')).toContain('compact broad chest');
    expect(animalAdaptationReason('Fox', 'Compact bear')).toContain('must be labelled Bear');
    const kinds = animalRelatedKinds('Dog'); kinds.reverse();
    expect(animalRelatedKinds('Dog')).toEqual(['dog', 'fox', 'bear']);
  });

  it('provides no adaptation reason for an unchanged general species', () => {
    for (const [requested, actual] of [['Dog', 'Dog'], [' fox ', 'FOX'], ['BEAR', 'Bear'], ['A simple LEGO dog model', 'Dog']]) {
      expect(animalAdaptationReason(requested, actual)).toBeUndefined();
    }
  });

  it('labels broad quadruped requests with an explicit chosen species', () => {
    for (const requested of ['Animal', 'Quadruped', 'Four-legged animal']) {
      for (const actual of ['Dog', 'Fox', 'Bear']) {
        expect(animalAdaptationReason(requested, actual)).toContain('leaves the species open');
        expect(animalAdaptationReason(requested, actual)).toContain(`labelled ${actual}`);
      }
    }
  });

  it('accepts an ambiguous Cub without inventing a requested species or verified juvenile proportions', () => {
    expect(animalSubjectKind('Cub')).toBe('quadruped');
    expect(animalRelatedKinds('Cub')).toEqual(['dog', 'fox', 'bear']);
    for (const actual of ['Dog', 'Fox', 'Bear']) {
      const reason = animalAdaptationReason('A small cub model', actual)!;
      expect(reason).toContain('leaves the species open');
      expect(reason).toContain(`labelled ${actual}`);
      expect(reason).toContain('No age-specific details are claimed');
      expect(reason).not.toContain('different animal');
    }
    expect(animalSubjectKind('Bear cub')).toBe('bear');
    expect(animalSubjectKind('Fox cub')).toBe('fox');
    expect(animalSubjectKind('Lion cub')).toBeNull();
  });

  it('does not claim breed, subtype, age, special coloring or unavailable stock details', () => {
    for (const requested of ['puppy', 'hound', 'Polar bear', 'Arctic fox', 'Fox cub', 'Small dog', 'Panda bear']) {
      const kind = animalSubjectKind(requested) as AnimalKind, actual = animalKindName(kind);
      const reason = animalAdaptationReason(requested, actual)!;
      expect(reason).toContain(requested);
      expect(reason).toContain(`labelled it ${actual}`);
      expect(reason).toContain('not claimed');
      expect(reason).not.toMatch(/missing|scarce|insufficient|not enough|lack|could not|unavailable|closest|best fit|stock forces/i);
    }
    for (const actual of ['Dachshund', 'Polar bear', 'Arctic fox', 'Rabbit', 'Foxglove', 'Animal']) {
      expect(animalAdaptationReason('Dog', actual)).toBeUndefined();
    }
  });

  it('returns concrete distinct anatomy as fresh arrays without making color or mechanism claims', () => {
    const dog = animalSubjectTraits('dog'), fox = animalSubjectTraits('fox'), bear = animalSubjectTraits('bear');
    expect(dog.join(' ')).toMatch(/moderate.*muzzle.*low or drop ears.*narrow raised tail/);
    expect(fox.join(' ')).toMatch(/long narrow.*muzzle.*alert ears.*thicker and longer/);
    expect(bear.join(' ')).toMatch(/compact broad.*short broad.*rounded ears.*stub tail/);
    for (const traits of [dog, fox, bear]) {
      expect(traits).toHaveLength(4);
      expect(traits.join(' ')).toContain('Four separated legs');
      expect(traits.join(' ')).toContain('two separated eyes');
      expect(traits.join(' ')).not.toMatch(/orange|white coat|polar|arctic|breed|working|articulated|realistic|guaranteed/i);
    }
    dog[0] = 'mutated'; fox.length = 0; bear.push('mutated');
    expect(animalSubjectTraits('dog')[0]).not.toBe('mutated');
    expect(animalSubjectTraits('fox')).toHaveLength(4);
    expect(animalSubjectTraits('bear')).toHaveLength(4);
  });
});
