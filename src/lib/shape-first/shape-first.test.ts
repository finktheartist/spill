import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cells, footprint, heightOf, parsePartId, studsOnTop, validate, voxels } from '../bricks';
import kingfisherFixture from '../fixtures/kingfisher-small-program.json';
import photo from '../fixtures/large-pile-stock.json';
import photo2 from '../fixtures/photo-pile-20261013-stock.json';
import smallPhoto from '../fixtures/small-pile-stock.json';
import { layBricksExposed, summary, voxelize } from './bricklayer';
import { MIN_PILE_PARTS, MIN_SMALL_CELLS, MIN_SMALL_PARTS, designPromptFor, fitPile, fitShopping, ideasPrompt, pileReach, rankIdeas, rolePalette, smallPile, trueColor, withTrueColors, type RankedIdea, type ShapeIdea } from './pipeline';
import { toSubject, type ShapeProgram } from './program';
import { runShapeTab, type ShapeVerdict } from './run';

const pile = (photo as { stock: Record<string, number> }).stock;
const colors = new Set(Object.keys(pile).map(id => parsePartId(id)!.color));
const piece = (name: string, shape: ShapeProgram['pieces'][number]['shape'], a: number[], b: number[], role: string, extra: Partial<ShapeProgram['pieces'][number]> = {}) =>
  ({ name, shape, a, b, r: 0, round: 0, role, mirror: false, cut: false, ...extra });
const house: ShapeProgram = {
  name: 'Test house', pitch: 'A small house.', thinking: '', length: 10, width: 8, height: 9,
  palette: [{ role: 'wall', colors: ['white', 'light-gray'] }, { role: 'roof', colors: ['reddish-brown', 'dark-brown'] }],
  pieces: [piece('walls', 'box', [5, 0, 2.4], [4, 3, 2.4], 'wall'), piece('roof', 'gable', [5, 0, 4.8], [4.8, 3.8, 3.6], 'roof')],
  paint: [],
};

describe('shape language', () => {
  it('a gable roof narrows as it rises', () => {
    const { subject } = toSubject(house, colors);
    const v = voxelize(subject);
    const width = (k: number) => [...v.keys()].filter(key => { const [x, , z] = key.split(',').map(Number); return x === 5 && z === k; }).length;
    expect(width(12)).toBeGreaterThan(width(15));
    expect(width(15)).toBeGreaterThan(width(18));
  });

  it('small details paint the surface instead of adding bumps', () => {
    const body: ShapeProgram = { ...house, pieces: [piece('head', 'ellipsoid', [5, 0, 4], [3, 3, 3], 'wall')] };
    const withEye: ShapeProgram = { ...body, palette: [...body.palette, { role: 'eye', colors: ['black'] }], pieces: [...body.pieces, piece('eye', 'ellipsoid', [7.8, 1.2, 4.6], [0.5, 0.5, 0.5], 'eye', { mirror: true })] };
    const a = voxelize(toSubject(body, colors).subject), b = voxelize(toSubject(withEye, colors).subject);
    expect(b.size).toBe(a.size);
    expect([...b.values()].filter(r => r === 'eye').length).toBeGreaterThan(0);
  });
});

describe('palettes and ideas', () => {
  const idea: ShapeIdea = { name: 'Snowman', pitch: '', why: '', length: 6, width: 6, height: 10, palette: [{ role: 'body', color: 'white', cells: 200 }, { role: 'nose', color: 'orange', cells: 6 }] };
  it('only your pile: stand-ins stay in the same natural color family and must be in the pile', () => {
    const roles = rolePalette(idea, pile, 'pile');
    expect(roles.body).toEqual(['white', 'light-gray']);
    expect(roles.body).not.toContain('bright-pink');
    expect(rolePalette(idea, pile, 'shopping').body).toEqual(['white']);
  });
  it('ranks ideas that fit the pile with slack ahead of bigger ones that do not', () => {
    const fits: ShapeIdea = { ...idea, name: 'fits', palette: [{ role: 'coat', color: 'reddish-brown', cells: 120 }] };
    const big: ShapeIdea = { ...idea, name: 'too big', palette: [{ role: 'coat', color: 'black', cells: 400 }] };
    expect(rankIdeas([big, fits], pile, 'pile').map(i => i.name)).toEqual(['fits', 'too big']);
  });
});

describe('fitting bricks', () => {
  it('only your pile: a valid, mirrored build from the pile', () => {
    const r = fitPile(house, pile);
    expect(r.best.s.issues).toEqual([]);
    expect(validate(r.best.build, pile)).toEqual([]);
    expect(r.best.s.parts).toBeGreaterThan(40);
    expect(r.best.s.colorSymmetry).toBeGreaterThan(0.85);
  });
  it('with a shopping list: buys only what the pile lacks, in the palette colors', () => {
    const r = fitShopping(house, pile);
    expect(r.s.issues).toEqual([]);
    expect(r.fromPile + r.toGet).toBe(r.s.parts);
    for (const id of Object.keys(r.bought)) expect(['white', 'light-gray', 'reddish-brown', 'dark-brown']).toContain(parsePartId(id)!.color);
    const used: Record<string, number> = {};
    for (const p of r.build.steps.flatMap(st => st.parts)) used[p.partId] = (used[p.partId] ?? 0) + 1;
    expect(r.toGet).toBe(Object.entries(used).reduce((n, [id, k]) => n + Math.max(0, k - (pile[id] ?? 0)), 0));
    const empty = fitShopping(house, {});
    expect(empty.toGet).toBe(empty.s.parts);
  });
  it('only your pile: a build under the part floor is never clean', () => {
    const tiny: ShapeProgram = { ...house, length: 4, width: 3, height: 4, pieces: [piece('walls', 'box', [2, 0, 1.2], [1.6, 1.2, 1.2], 'wall'), piece('roof', 'gable', [2, 0, 2.4], [1.8, 1.5, 1.4], 'roof')] };
    const r = fitPile(tiny, pile);
    expect(r.best.s.parts).toBeLessThan(MIN_PILE_PARTS);
    expect(r.best.clean).toBe(false);
  });
});

describe('special parts', () => {
  // White bricks for the walls; no roof-colored bricks, so the roof comes from plates and the special parts.
  const mixed: Record<string, number> = {
    'brick-1x2-white': 60, 'brick-1x4-white': 30, 'brick-2x2-white': 20, 'plate-1x2-white': 40, 'plate-2x2-white': 20,
    'plate-1x4-reddish-brown': 40, 'plate-2x2-reddish-brown': 30, 'plate-1x2-reddish-brown': 40, 'cornerplate-2x2-reddish-brown': 8,
    'slope-2x2-reddish-brown': 12, 'curve-1x2-reddish-brown': 16, 'cheese-1x1-reddish-brown': 10, 'tile-2x2-reddish-brown': 10, 'tile-1x2-reddish-brown': 10,
  };
  const r = layBricksExposed(toSubject(house, colors).subject, mixed);
  const parts = r.build.steps.flatMap(s => s.parts);
  it('lays them into a valid, complete build', () => {
    expect(validate(r.build, mixed)).toEqual([]);
    const used = new Set(parts.map(p => parsePartId(p.partId)!.type));
    expect(['tile', 'curve', 'slope', 'cheese', 'cornerplate'].filter(t => used.has(t as never)).length).toBeGreaterThanOrEqual(2);
    expect(summary(r).visibleHoles).toBeLessThanOrEqual(0.02);
    expect(summary(r).colorSymmetry).toBeGreaterThan(0.85);
  });
  it('puts nothing on parts without studs, and turns sloped parts to face open air', () => {
    const filled = new Set(parts.flatMap(p => voxels(parsePartId(p.partId)!, p).map(v => v.join(','))));
    for (const p of parts) {
      const k = parsePartId(p.partId)!, h = heightOf(k);
      if (!studsOnTop(k.type)) for (const [x, y] of cells(k, p)) expect(filled.has(`${x},${y},${p.z + h}`)).toBe(false);
      if (!['slope', 'curve', 'cheese'].includes(k.type)) continue;
      const { fw, fd } = footprint(k, p.rot);
      const face = Array.from({ length: p.rot % 180 === 0 ? fw : fd }, (_, t) => p.rot === 0 ? [p.x + t, p.y - 1] : p.rot === 90 ? [p.x + fw, p.y + t] : p.rot === 180 ? [p.x + t, p.y + fd] : [p.x - 1, p.y + t]);
      for (const [x, y] of face) for (let dz = 0; dz < h; dz++) expect(filled.has(`${x},${y},${p.z + dz}`)).toBe(false);
    }
  });
});

describe('small piles and true colors', () => {
  const newPile = (photo2 as { stock: Record<string, number> }).stock;
  const small = (smallPhoto as { stock: Record<string, number> }).stock;
  it('only your pile: a big pile gets sculptures, a small one small models, and a tiny one is told up front without model calls', async () => {
    expect(smallPile(pileReach(pile))).toBe(false); // 408 parts
    expect(smallPile(pileReach(newPile))).toBe(true); // 152 parts in 23 colors
    expect(pileReach(newPile).cells).toBeGreaterThanOrEqual(MIN_SMALL_CELLS);
    expect(pileReach(small).cells).toBeGreaterThanOrEqual(MIN_SMALL_CELLS); // 96 parts: small models are tried
    const tiny = Object.fromEntries(Object.entries(small).map(([id, n]) => [id, Math.floor(n / 2)]));
    expect(pileReach(tiny).cells).toBeLessThan(MIN_SMALL_CELLS);
    const fetched = vi.spyOn(globalThis, 'fetch');
    const run = await runShapeTab('pile', tiny, () => {});
    expect(run.slots).toEqual([]);
    expect(run.small?.parts).toBe(24);
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });
  it('with a shopping list: each area keeps its real color, and the pile is used where it is that color', () => {
    const has = new Set(['bright-light-orange', 'azure', 'dark-azure', 'white']);
    expect(trueColor('#E8762B', has)).toBe('orange'); // orange, not the pile's yellow-orange (35 ΔE away)
    expect(trueColor('#F5B041', has)).toBe('bright-light-orange');
    expect(trueColor('#1E73BE', has)).toBe('dark-azure'); // medium blue is nearest by 2 ΔE: the pile's blue is used
    expect(trueColor('#1E73BE', new Set())).toBe('medium-blue');
    expect(trueColor('azure', has)).toBe('azure');
    expect(trueColor('sky blue', has)).toBeNull();
    const [idea] = withTrueColors([{ name: 'Bird', pitch: '', why: '', length: 8, width: 6, height: 9, palette: [{ role: 'breast', color: '', real: '#E8762B', cells: 90 }, { role: 'back', color: '', real: '#1E73BE', cells: 120 }] }], newPile, 'shopping');
    expect(idea.palette.map(p => p.color)).toEqual(['orange', 'medium-blue']); // this pile has medium blue, the nearest
  });
});

describe('small piles: small models behind the blind review', () => {
  const newPile = (photo2 as { stock: Record<string, number> }).stock;
  const kingfisher = (kingfisherFixture as unknown as { program: ShapeProgram }).program;
  // Piece plans are test-only discovery inputs; the returned kingfisher is still
  // independently fitted/reviewed rather than inferred from these declarations.
  const idea = (name: string): ShapeIdea => ({ name, pitch: '', why: '', length: 7, width: 4, height: 6, palette: [{ role: 'wings', color: 'azure', cells: 30 }], features: [{ feature: 'beak', part: 'cheese', color: 'bright-light-orange',pieces:[{partId:'cheese-1x1-bright-light-orange',count:1}],carriers:[] },{feature:'wings',part:'plate',color:'azure',pieces:[{partId:'plate-1x2-azure',count:2}],carriers:[]}] });

  it('ideas start from the pile’s special parts, and designs name the part each feature is built from', () => {
    const p = ideasPrompt('pile', newPile, 6, [], true);
    expect(p).toContain('SMALL models');
    expect(p).toContain('- cheese (1x1, 2 plates tall');
    expect(p).toContain('1x1 bright-light-orange ×4');
    const d = designPromptFor(idea('Kingfisher'), 'pile', newPile);
    expect(d).toContain('- beak: cheese in bright-light-orange (the pile has 4 × cheese-1x1)');
    expect(d).not.toContain('never design it smaller');
    expect(designPromptFor({ ...idea('Kingfisher'), features: undefined }, 'pile', newPile)).toContain('Keep it small');
    expect(designPromptFor(idea('Kingfisher'),'pile',pile)).toContain('never design it smaller');
  });

  it('a kingfisher this pile can make cleanly as a small model, but not as a sculpture', () => {
    const r = fitPile(kingfisher, newPile, MIN_SMALL_PARTS);
    expect(r.best.clean).toBe(true);
    expect(r.best.s.parts).toBeGreaterThanOrEqual(MIN_SMALL_PARTS);
    expect(r.best.s.parts).toBeLessThan(MIN_PILE_PARTS);
    expect(validate(r.best.build, newPile)).toEqual([]);
    expect(fitPile(kingfisher, newPile).best.clean).toBe(false);
  });

  // The fit runs on the page here instead of a worker; every design comes back as the kingfisher.
  class FitWorker {
    onmessage?: (e: { data: unknown }) => void;
    onerror = null;
    postMessage(m: { program: ShapeProgram; stock: Record<string, number>; minParts?: number }) { const r = fitPile(m.program, m.stock, m.minParts); setTimeout(() => this.onmessage?.({ data: { ok: true, ...r } })); }
    terminate() {}
  }
  const reply = (json: unknown) => new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }));
  const prompts: string[] = [];
  beforeEach(() => {
    prompts.length = 0;
    vi.stubGlobal('Worker', FitWorker);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const text = JSON.parse(init.body).contents.at(-1).parts[0].text as string;
      prompts.push(text);
      return reply(text.includes('Propose') ? { ideas: ['Kingfisher', 'Tugboat', 'Fox', 'Cottage', 'Car', 'Clownfish'].map(idea) } : kingfisher);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
  const judge = (named: string[]) => async (_b: unknown, i: RankedIdea): Promise<ShapeVerdict> => ({
    looksLike: named.includes(i.name) ? 'small blue bird with yellow beak' : 'unidentifiable block assembly', recognizable: 2, complete: 2, colors: 2, impressive: 2, fixes: [], pass: false, named: named.includes(i.name),
  });

  it('shows a small model only when the reviewer names it; another idea steps in for one it can’t', async () => {
    const run = await runShapeTab('pile', newPile, () => {}, { judge: judge(['Kingfisher']) });
    expect(prompts[0]).toContain('SMALL models');
    const ready = run.slots.filter(s => s.phase === 'ready');
    expect(ready.map(s => s.idea.name)).toEqual(['Kingfisher']);
    expect(ready[0].build && ready[0].smallModel && ready[0].stats!.parts < MIN_PILE_PARTS).toBe(true);
    const failed = run.slots.filter(s => s.phase === 'failed');
    expect(failed.map(s => [s.replaced, s.idea.name])).toEqual([['Tugboat', 'Cottage'], ['Fox', 'Car']]);
    expect(failed.every(s => s.unrecognized && !s.build)).toBe(true);
    expect(run.small).toBeUndefined();
  });

  it('keeps recognition failures separate from a pile that cannot meet the part budget', async () => {
    const run = await runShapeTab('pile', newPile, () => {}, { judge: judge([]) });
    expect(run.slots.every(s => s.phase === 'failed' && s.unrecognized && !s.build)).toBe(true);
    expect(run.small).toBeUndefined();
  });
});
