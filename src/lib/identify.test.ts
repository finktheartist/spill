import { describe, expect, it } from 'vitest';
import { checkFeatures, type Features } from './identify';

const flat = (studsOnTop: number, heightPlates: number, more: Partial<Features> = {}): Features =>
  ({ outline: 'rectangle', topShape: 'flat', studsOnTop, studLayout: studsOnTop ? 'grid' : 'none', heightPlates, ...more });
const isOther = (v: ReturnType<typeof checkFeatures>) => 'other' in v;

describe('feature check', () => {
  it('keeps parts that match their shape', () => {
    expect(checkFeatures('plate', 2, 4, flat(8, 1))).toEqual({ type: 'plate', w: 2, d: 4 });
    expect(checkFeatures('plate', 1, 1, flat(1, 1, { studLayout: 'center' }))).toEqual({ type: 'plate', w: 1, d: 1 });
    expect(checkFeatures('plate', 6, 8, flat(40, 1))).toEqual({ type: 'plate', w: 6, d: 8 }); // big grids needn't be counted exactly
    expect(checkFeatures('slope', 2, 2, { outline: 'rectangle', topShape: 'slope45', studsOnTop: 2, studLayout: 'row', heightPlates: 3 })).toEqual({ type: 'slope', w: 2, d: 2 });
    expect(checkFeatures('cornerplate', 2, 2, { outline: 'L', topShape: 'flat', studsOnTop: 3, studLayout: 'grid', heightPlates: 1 })).toEqual({ type: 'cornerplate', w: 2, d: 2 });
    expect(checkFeatures('roundplate', 1, 1, { outline: 'round', topShape: 'flat', studsOnTop: 1, studLayout: 'center', heightPlates: 1 })).toEqual({ type: 'roundplate', w: 1, d: 1 });
  });
  it('turns near misses into "other" instead of the wrong piece', () => {
    expect(isOther(checkFeatures('plate', 1, 2, flat(1, 1, { studLayout: 'center' })))).toBe(true); // jumper
    expect(isOther(checkFeatures('slope', 2, 2, { outline: 'rectangle', topShape: 'slope-steep', studsOnTop: 2, studLayout: 'row', heightPlates: 3 }))).toBe(true);
    expect(isOther(checkFeatures('curve', 1, 4, { outline: 'rectangle', topShape: 'curved', studsOnTop: 0, heightPlates: 2 }))).toBe(true); // a size we don't model
    expect(isOther(checkFeatures('tile', 2, 2, { outline: 'quarter-circle', topShape: 'flat', studsOnTop: 0, heightPlates: 1 }))).toBe(true); // macaroni
    expect(isOther(checkFeatures('plate', 2, 4, { outline: 'wedge', topShape: 'flat', studsOnTop: 6, studLayout: 'grid', heightPlates: 1 }))).toBe(true);
    expect(isOther(checkFeatures('brick', 1, 2, flat(2, 5, { studLayout: 'side' })))).toBe(true); // 1x2x1⅔ with side studs: too tall
    expect(isOther(checkFeatures('curve', 2, 2, { outline: 'rectangle', topShape: 'curved-inverted', studsOnTop: 0, heightPlates: 2 }))).toBe(true);
  });
  it('fixes the obvious mix-ups within a family', () => {
    expect(checkFeatures('plate', 2, 4, flat(0, 1))).toMatchObject({ type: 'tile', w: 2, d: 4 });
    expect(checkFeatures('plate', 2, 2, flat(4, 3))).toMatchObject({ type: 'brick', w: 2, d: 2 });
    expect(checkFeatures('slope', 2, 2, { outline: 'rectangle', topShape: 'curved', studsOnTop: 0, heightPlates: 2 })).toMatchObject({ type: 'curve', w: 2, d: 2 });
  });
  it('keeps parts with studs on a side face (brackets) out of the counted parts', () => {
    expect(isOther(checkFeatures('brick', 1, 2, flat(2, 3, { studLayout: 'side' })))).toBe(true);
  });
  it('trusts the name when there is no description (whole-photo readings)', () => {
    expect(checkFeatures('plate', 1, 2, {})).toEqual({ type: 'plate', w: 1, d: 2 });
  });
});
