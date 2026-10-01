import type { Sheet, SheetEdit } from './scoreRoll';

type Failure = { ok: false; error: string };

/** What a score route answers: a problem with the score is `ok: false` and the reason, to show as it is. */
type Answer<T> = ({ ok: true } & T) | Failure;

function failed<T>(answer: Answer<T>): answer is Failure {
  return !answer.ok;
}

async function post<T>(path: string, body: unknown): Promise<Answer<T>> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as Answer<T> | null;
  if (payload && typeof payload === 'object' && 'ok' in payload) return payload;
  return { ok: false, error: `HTTP ${response.status}` };
}

export const readScore = (abc: string) => post<{ sheet: Sheet; words: string | null; keep: boolean }>('/v1/score/read', { abc });

export const writeScore = (abc: string, sheet: SheetEdit) => post<{ abc: string; bars: number[]; sheet: Sheet }>('/v1/score/write', { abc, sheet });

/** A score made longer by `bars` empty bars, or a blank one of that many bars when `abc` is empty. */
export const lengthenScore = (abc: string, bars: number, bpm?: number) => post<{ abc: string }>('/v1/score/length', { abc, bars, ...(bpm ? { bpm } : {}) });

export const transposeScore = (abc: string, semitones: number) => post<{ abc: string; sheet: Sheet; before: string; after: string }>('/v1/score/transpose', { abc, semitones });

/** The score as a MIDI file: voice, instrument and chords on tracks of their own, with the tempo, meters, keys and sections. */
export async function scoreMidi(abc: string): Promise<Answer<{ bytes: Uint8Array }>> {
  const answer = await post<{ data: string }>('/v1/score/midi', { abc });
  if (failed(answer)) return answer;
  const raw = atob(answer.data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { ok: true, bytes };
}
