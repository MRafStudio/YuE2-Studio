import { afterEach, describe, expect, it, vi } from 'vitest';
import { lyricLineOffsets, songTokens, tokensOnLine } from './songTokens';
afterEach(() => vi.unstubAllGlobals());
describe('checkpoint token marks', () => {
  it('maps lines by Unicode letters, preserving tag and newline context', () => {
    expect(lyricLineOffsets('[Verse]\nа😀б\n\n[Chorus]\nLast')).toEqual([[8, 12], [22]]);
  });
  it('counts real token spans even when two tokens divide the same emoji', () => {
    const result = tokensOnLine({ available: true, cuts: [9, 10], torn: [9], spans: [{ id: 1, start: 8, end: 9 }, { id: 2, start: 9, end: 10 }, { id: 3, start: 9, end: 10 }, { id: 4, start: 10, end: 11 }] }, 8, 'а😀б');
    expect(result?.count).toBe(4); expect(result?.cuts).toEqual(new Set([1, 2])); expect(result?.torn).toEqual(new Set([1]));
    expect(tokensOnLine({ available: false }, 0, 'words')).toBeNull();
  });
  it('reports unavailable capability and API errors without making up counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false, problem: 'Engine not installed' }))));
    expect(await songTokens('', 'words', 'full')).toEqual({ available: false, problem: 'Engine not installed' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'checkpoint failed' }), { status: 502 })));
    await expect(songTokens('', 'words', 'full')).rejects.toThrow('checkpoint failed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: true, tokens: 2, cuts: [], torn: [], spans: [] }))));
    await expect(songTokens('', 'words', 'full')).rejects.toThrow('Invalid checkpoint token spans');
  });
});
