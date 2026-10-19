import { describe, expect, it } from 'vitest';
import { isMade, isRealSize, listText, madeColor, madeIn, neverMadeText, partInfo, shoppingList, unlimitedInventory } from './catalog';
import { CATALOG, validate, type Build } from './bricks';

describe('catalog', () => {
  it('maps parts to verified part numbers (slopes are named run x width)', () => {
    expect(partInfo('brick-2x4-red')).toMatchObject({ number: '3001', name: 'Brick 2 × 4' });
    expect(partInfo('slope-1x2-white')).toMatchObject({ number: '3040', name: 'Slope 45° 2 × 1' });
    expect(partInfo('slope-4x2-blue')?.number).toBe('3037');
    expect(partInfo('plate-8x8-green')?.url).toBe('https://www.bricklink.com/v2/catalog/catalogitem.page?P=41539');
    expect(partInfo('wheels-4x2-black')).toMatchObject({ number: '4600' });
  });
  it('every catalog shape has a part number', () => {
    const missing = Object.entries(CATALOG).filter(([t]) => t !== 'wheel')
      .flatMap(([t, sizes]) => sizes.map(s => `${t}-${s}-red`)).filter(id => !partInfo(id));
    expect(missing).toEqual([]);
    expect(partInfo('curve-1x3-red')).toMatchObject({ number: '50950', name: 'Curved slope 3 × 1' });
    expect(partInfo('invslope-1x2-red')).toMatchObject({ number: '3665', name: 'Inverted slope 2 × 1' });
    expect(partInfo('arch-1x4-red')).toMatchObject({ number: '3659', name: 'Arch 1 × 4' });
  });
  it('the open catalog has every shape in every color', () => {
    const u = unlimitedInventory({ 'brick-2x4-red': 3 });
    expect(u['plate-6x8-tan']).toBeGreaterThan(100);
    expect(u['brick-2x4-red']).toBeGreaterThan(100);
    expect(u['wheel-1x1-black']).toBeUndefined();
  });
  it('splits a build into what the bucket covers and what to get', () => {
    const b: Build = { name: 'x', description: '', steps: [{ caption: '', parts: [
      { partId: 'brick-2x4-red', x: 0, y: 0, z: 0, rot: 0 }, { partId: 'brick-2x4-red', x: 4, y: 0, z: 0, rot: 0 },
      { partId: 'brick-2x4-red', x: 8, y: 0, z: 0, rot: 0 }, { partId: 'tile-1x2-tan', x: 0, y: 0, z: 3, rot: 0 },
    ] }] };
    const l = shoppingList(b, { 'brick-2x4-red': 2 });
    expect(l.have).toEqual([{ partId: 'brick-2x4-red', count: 2 }]);
    expect(l.get).toEqual([{ partId: 'brick-2x4-red', count: 1 }, { partId: 'tile-1x2-tan', count: 1 }]);
    expect(listText(l.get).split('\n')[1]).toBe('3069  Tile 1 × 2 · tan × 1');
  });

  it('knows which colors every catalog shape was really made in (Rebrickable)', () => {
    const uncovered = Object.entries(CATALOG).filter(([t]) => t !== 'wheel')
      .flatMap(([t, sizes]) => sizes.map(sz => `${t}-${sz}`)).filter(shape => !madeIn(shape)?.length);
    expect(uncovered).toEqual([]);
    expect(isMade('plate-8x8-blue')).toBe(false);
    expect(isMade('plate-8x8-tan')).toBe(true);
    expect(isMade('curve-2x2-reddish-brown')).toBe(true);
    expect(isMade('wheels-4x2-black')).toBe(true);
    expect(neverMadeText()).toMatch(/- plate-8x8: (not|ONLY) /);
  });
  it('the open catalog leaves out never-made parts, but never parts you own', () => {
    const u = unlimitedInventory({ 'plate-8x8-orange': 1 });
    expect(u['plate-8x8-blue']).toBeUndefined();
    expect(u['plate-8x8-orange']).toBeGreaterThan(100);
    const b: Build = { name: 'x', description: '', steps: [{ caption: '', parts: [{ partId: 'plate-8x8-blue', x: 0, y: 0, z: 0, rot: 0 }] }] };
    expect(validate(b, u).map(i => i.message).join()).toContain('never made in that color');
    expect(validate(b, { 'plate-8x8-tan': 2 }).map(i => i.message).join()).toContain('the bucket only has 0');
  });

  it('knows real sizes and snaps never-made colors to the closest real one', () => {
    expect(isRealSize('plate', 6, 12)).toBe(true);
    expect(isRealSize('plate', 5, 10)).toBe(false);
    expect(isRealSize('curve', 9, 9)).toBe(true); // only plain bricks, plates and tiles are checked
    expect(madeColor('plate', 8, 8, 'nougat')).toBe('medium-nougat');
    expect(madeColor('plate', 8, 8, 'tan')).toBe('tan');
    expect(madeColor('roundplate', 1, 1, 'trans-red')).toBe('trans-red');
  });
});
