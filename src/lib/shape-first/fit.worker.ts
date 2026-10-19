// Lays a shape program's bricks off the main thread: 'pile' searches sizes using only the pile (a small pile's small
// models from MIN_SMALL_PARTS); 'shopping' builds at full size, pile first, and lists the parts to get.
import { fitPile, fitShopping } from './pipeline';
import type { ShapeProgram } from './program';

self.onmessage = (event: MessageEvent<{ kind: 'pile' | 'shopping'; program: ShapeProgram; stock: Record<string, number>; minParts?: number }>) => {
  try {
    const { kind, program, stock, minParts } = event.data;
    if (kind === 'pile') {
      const r = fitPile(program, stock, minParts);
      self.postMessage({ ok: true, best: r.best, tries: r.tries, full: r.full });
    } else {
      const r = fitShopping(program, stock);
      self.postMessage({ ok: true, build: r.build, s: r.s, bought: r.bought, toGet: r.toGet, fromPile: r.fromPile });
    }
  } catch (e) { self.postMessage({ ok: false, error: (e as Error).message || 'The bricks could not be laid.' }); }
};
