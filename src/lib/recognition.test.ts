import { afterEach, describe, expect, it, vi } from 'vitest';
import { judgeBuild, passes } from './gemini';
const reply = (json: unknown) => (new Response(JSON.stringify({modelVersion:'gemini-test-model', candidates: [{finishReason:'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 }));
const v = { looksLike: 'a fireplace', recognizable: 5, complete: 4, colors: 4, impressive: 4, fixes: ['Improve the outline'] };
const idea = { name: 'Retro Boombox', pitch: 'Two speakers and a handle', estimatedParts: 30, difficulty: 1, keyParts: [] };
afterEach(() => vi.unstubAllGlobals());
describe('recognition without the answer', () => {
  it('keeps the subject and inventory out of the image review, and the images out of the subject match', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(v)).mockResolvedValueOnce(reply({ matchesSubject: false }));
    vi.stubGlobal('fetch', fetch);
    const verdict = await judgeBuild(idea, ['data:image/jpeg;base64,AA=='], 30, 104, undefined, 'secret inventory detail');
    const first = JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts;
    expect(first.some((p: { inlineData?: unknown }) => p.inlineData)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('Boombox');
    expect(JSON.stringify(first)).not.toContain('speakers');
    expect(JSON.stringify(first)).not.toContain('secret inventory detail');
    const second = JSON.parse(fetch.mock.calls[1][1].body).contents[0].parts;
    expect(second.every((p: { text?: string }) => typeof p.text === 'string')).toBe(true);
    expect(JSON.stringify(second)).toContain('a fireplace');
    expect(JSON.stringify(second)).toContain('Retro Boombox');
    expect(verdict.recognizable).toBe(2);
    expect(passes(verdict)).toBe(false);
    expect(verdict.fixes.join(' ')).toContain('Retro Boombox');
    expect(verdict.fixes).not.toContain('Improve the outline');
  });
  it('retains the blind scores when the object is recognized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(v)).mockResolvedValueOnce(reply({ matchesSubject: true })));
    expect(await judgeBuild(idea, [], 30, 104)).toEqual({ ...v, review: 'blind-v1', subjectMatched: true, named: true });
  });
  it('does not forward instructions for an uncertain guessed object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({ ...v, recognizable: 2, looksLike: 'helicopter or whale', fixes: ['Add rotor blades'] })).mockResolvedValueOnce(reply({ matchesSubject: true })));
    const result = await judgeBuild(idea, [], 30, 104);
    expect(result.subjectMatched).toBe(false);
    expect(result.named).toBe(true); // the match alone, for small models (see shape-first recognized)
    expect(result.fixes.join(' ')).not.toContain('Add rotor blades');
    expect(result.fixes.join(' ')).toContain('Retro Boombox');
  });
  it('does not treat a missing or string match as approval', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(v)).mockResolvedValueOnce(reply({ matchesSubject: 'true' })));
    await expect(judgeBuild(idea, [], 30, 104)).rejects.toThrow('invalid match');
  });
});
