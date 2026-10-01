import { describe, expect, it } from 'vitest';
import { parseRequestFile, requestFileTitle, serializeRequest, toEngineRequest } from './requestFile';

describe('prompt files', () => {
  const request = {
    style: 'folk rock, male voice',
    lyrics: '[Verse]\nline',
    duration_seconds: 120,
    steps: 32,
    abc_sampling: { temperature: 0.7 },
    semantic_sampling: {},
    title: 'North wind',
    cover_prompt: 'a lake at dawn',
    output_format: 'mp3' as const,
  };

  it('uses the engine field names and drops what the engine does not read', () => {
    const engine = toEngineRequest(request);
    expect(engine.duration).toBe(120);
    expect(engine).not.toHaveProperty('duration_seconds');
    expect(engine).not.toHaveProperty('cover_prompt');
    expect(engine).not.toHaveProperty('semantic_sampling');
    expect(engine.title).toBe('North wind');
  });

  it('round-trips through JSON and YAML', () => {
    for (const [name, format] of [['a.json', 'json'], ['a.yaml', 'yaml']] as const) {
      const back = parseRequestFile(name, serializeRequest(request, format));
      expect(back.style).toBe(request.style);
      expect(back.lyrics).toBe(request.lyrics);
      expect(back.duration).toBe(120);
      expect(back.abc_sampling).toEqual({ temperature: 0.7 });
    }
  });

  it('keeps studio processing controls and signed adapter strengths in prompt files', () => {
    const settings = { ...request, transpose: -12, vocals_only: true, adapters: [{ id: 'voice', scales: { ar: -10, nar: 10 } }] };
    const back = parseRequestFile('voice.json', serializeRequest(settings, 'json'));
    expect(back.transpose).toBe(-12);
    expect(back.vocals_only).toBe(true);
    expect(back.adapters).toEqual(settings.adapters);
  });

  it('names the song from the title, else from the file', () => {
    expect(requestFileTitle('song.yml', { title: ' Named ' })).toBe('Named');
    expect(requestFileTitle('song.yml', {})).toBe('song');
  });

  it('rejects a file that is not a request object', () => {
    expect(() => parseRequestFile('a.yaml', '- one\n- two\n')).toThrow();
  });
});
