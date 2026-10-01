export type SongTokens = { available: boolean; cuts?: number[]; torn?: number[]; tokens?: number; spans?: { id: number; start: number; end: number }[]; problem?: string };
export async function songTokens(style: string, lyrics: string, cot: string, signal?: AbortSignal): Promise<SongTokens> {
  const response = await fetch(apiUrl('/v1/song/tokenize'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style, lyrics, cot }), signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  if (typeof body.available !== 'boolean') throw new Error('Invalid checkpoint tokenizer response');
  if (body.available) {
    const length = Array.from(lyrics).length;
    const offset = (at: unknown) => typeof at === 'number' && Number.isInteger(at) && at >= 0 && at <= length;
    if (!Array.isArray(body.cuts) || !Array.isArray(body.torn) || !Array.isArray(body.spans) || !Number.isInteger(body.tokens) || body.tokens !== body.spans.length || !body.cuts.every(offset) || !body.torn.every(offset)
      || !body.spans.every((span: Record<string, unknown>) => span && Number.isInteger(span.id) && offset(span.start) && offset(span.end) && Number(span.start) <= Number(span.end))) throw new Error('Invalid checkpoint token spans');
  }
  return body;
}
export function lyricLineOffsets(raw: string): number[][] {
  const groups: number[][] = [];
  let group = -1;
  let position = 0;
  for (const line of raw.split('\n')) {
    if (/^\[[^\]\n]+\]\s*$/.test(line)) { groups.push([]); group++; }
    else {
      if (group < 0) { groups.push([]); group = 0; }
      groups[group].push(position);
    }
    position += Array.from(line).length + 1;
  }
  return groups;
}
export function tokensOnLine(tokens: SongTokens | null, start: number | undefined, line: string) {
  if (!tokens?.available || start === undefined) return null;
  const end = start + Array.from(line).length;
  return { count: tokens.spans?.filter(span => span.start < end && span.end > start).length ?? 0,
    cuts: new Set(tokens.cuts?.filter(at => at >= start && at < end).map(at => at - start)),
    torn: new Set(tokens.torn?.filter(at => at >= start && at < end).map(at => at - start)) };
}
import { apiUrl } from './apiBase';
