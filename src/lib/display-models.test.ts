import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DISPLAY_MODELS } from './display-models';
import { CATALOG, parsePartId, partCount } from './bricks';
import { constructionIssues } from './construction';
import { buildCounts } from './library';
import { isMade, partInfo, shoppingList } from './catalog';
import DisplayLibrary from '../components/DisplayLibrary';
import { PartsList } from '../components/PartsList';

// Parts-list wording can be checked in Node; WebGL thumbnails are inspected in the browser.
vi.mock('./render', async importOriginal => ({ ...await importOriginal<typeof import('./render')>(), partIcon: () => 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }));

describe('inventory-independent display collection', () => {
  it.each(DISPLAY_MODELS.map(m => [m.id, m] as const))('%s is a connected, catalogued model with a supported assembly sequence', (_id, model) => {
    const build = model.build, counts = buildCounts(build);
    expect(partCount(build)).toBeGreaterThanOrEqual(70);
    expect(build.source).toEqual({ kind: 'display', recipeId: model.id });
    expect(constructionIssues(build, counts, 32)).toEqual([]);
    for (const id of Object.keys(counts)) {
      const part = parsePartId(id)!;
      expect(isMade(id), id).toBe(true);
      expect(partInfo(id), id).not.toBeNull();
      expect(part.type).not.toBe('wheels');
      if (part.type !== 'wheels') expect(CATALOG[part.type], id).toContain(`${part.w}x${part.d}`);
    }
    for (let i = 1; i <= build.steps.length; i++) {
      expect(constructionIssues({ ...build, steps: build.steps.slice(0, i) }, counts, 32).filter(x => x.kind !== 'loose')).toEqual([]);
    }
    const list = shoppingList(build, {});
    expect(list.getCount).toBe(partCount(build));
    expect(list.haveCount).toBe(0);
    expect(Object.fromEntries(list.get.map(p => [p.partId, p.count]))).toEqual(counts);
  });
  it('exposes a separate ready-to-browse collection without requiring an inventory', () => {
    const html = renderToStaticMarkup(createElement(DisplayLibrary, { onOpen: () => {} }));
    expect(html).toContain('No bucket required');
    expect(html.match(/View instructions/g)).toHaveLength(4);
    expect(html.match(/Complete parts list/g)).toHaveLength(4);
    expect(html).not.toContain('Fits your bucket');
    expect(new Set(DISPLAY_MODELS.map(m => m.id)).size).toBe(DISPLAY_MODELS.length);
  });
  it('keeps a complete parts list independent of owned inventory', () => {
    const build = DISPLAY_MODELS[0].build;
    const html = renderToStaticMarkup(createElement(PartsList, { build, bucket: buildCounts(build), full: true, onClose: () => {} }));
    expect(html).toContain('complete model inventory, independent of your bucket');
    expect(html).toContain('All parts');
    expect(html).not.toContain('already yours');
    expect(html).not.toContain('Not made in this color');
  });
});
