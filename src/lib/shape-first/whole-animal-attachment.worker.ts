import { searchWholeAnimalAttachmentsSync, type WholeAnimalStageSearchInput, type WholeAnimalStageSearchOutput } from './whole-animal-attachment-core';

export type WholeAnimalAttachmentResponse = { ok: true; result: WholeAnimalStageSearchOutput } | { ok: false; error: string };

// The worker depends only on the pure core. No synthesis, pipeline or provider
// import, and no handlers are installed in a window or Node environment.
if (typeof self !== 'undefined' && typeof document === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = ({ data }: MessageEvent<WholeAnimalStageSearchInput>) => {
    let response: WholeAnimalAttachmentResponse;
    try { response = { ok: true, result: searchWholeAnimalAttachmentsSync(data) }; }
    catch (error) { response = { ok: false, error: error instanceof Error ? error.message.slice(0, 1500) : 'Whole-animal attachment discovery failed.' }; }
    try { self.postMessage(response); }
    catch { self.postMessage({ ok: false, error: 'Whole-animal attachment result could not be cloned.' } satisfies WholeAnimalAttachmentResponse); }
  };
}
