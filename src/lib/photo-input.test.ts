import { afterEach, expect, it, vi } from 'vitest';
import { loadPhoto } from './photo-input';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('keeps bounded working pixels and decodes original pixels only on demand', async () => {
  const first = { width: 6000, height: 4000, close: vi.fn() }, detail = { width: 6000, height: 4000, close: vi.fn() };
  const decode = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(detail);
  const drawImage = vi.fn();
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/jpeg;base64,fixture' }) });
  const file = new File(['fixture'], 'photo.jpg');
  const loaded = await loadPhoto(file);
  expect(loaded.full.width).toBe(3072); expect(loaded.full.height).toBe(2048);
  expect(first.close).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce();
  expect(await loaded.detailSource()).toBe(detail); expect(decode).toHaveBeenLastCalledWith(file);
  expect(detail.close).not.toHaveBeenCalled(); // the scan owns the second bitmap
});
it('closes the first bitmap if drawing fails', async () => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 100, close }));
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: () => { throw Error('canvas failure'); } }) }) });
  await expect(loadPhoto(new File(['fixture'], 'photo.jpg'))).rejects.toThrow('canvas failure');
  expect(close).toHaveBeenCalledOnce();
});
