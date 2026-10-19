import { toJpeg } from './scan';

/** iPhone HEIC files may be renamed or lack a MIME type. */
async function isHeic(file: Blob) {
  const head = new TextDecoder('latin1').decode(await file.slice(0, 12).arrayBuffer());
  return head.slice(4, 8) === 'ftyp' && /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(head.slice(8, 12));
}
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file); } catch { /* use the HEIC decoder when needed */ }
  if (await isHeic(file)) {
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: file, type: 'bitmap' });
  }
  throw new Error(`Couldn't open ${file.name}. Try a JPEG or PNG photo.`);
}

/** Keep working pixels bounded; retain the File for lazy original-resolution crops.
 * Decoded bitmaps are released, including when drawing or serialization fails. */
export async function loadPhoto(file: File, max = 3072) {
  const img = await decodePhoto(file);
  try {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const full = document.createElement('canvas');
    full.width = Math.round(img.width * s); full.height = Math.round(img.height * s);
    full.getContext('2d')!.drawImage(img, 0, 0, full.width, full.height);
    return { full, url: toJpeg(full), detailSource: () => decodePhoto(file) };
  } finally { img.close(); }
}
