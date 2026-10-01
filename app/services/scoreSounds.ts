/**
 * What the score editor plays, for the ear only: YuE2 is given the score and
 * the style line, never an instrument. A sampled grand piano (Salamander
 * Grand Piano V3, CC-BY 3.0, one recording every three semitones, so no note
 * is stretched by more than one) and a few voices the browser makes itself.
 * Ported from pytraveler/YuE2-ComfyUI (web/js/yue2_sounds.js and the score
 * window's player, Apache-2.0).
 */

import type { SoundEvent, SoundPart } from './scoreRoll';

export const DRUMS = 'drums';

export const KIT = ['Kick', 'Stick', 'Snare', 'Clap', 'Tom low', 'Tom mid', 'Hat', 'Tom high', 'Hat open', 'Crash', 'Ride', 'Shaker'];

export const CHOICES: Record<SoundPart, string[]> = {
  Vocal: ['piano', 'synth', 'pluck'],
  Ins: ['piano', 'bass', 'pluck', DRUMS],
  chords: ['piano', 'strings', 'pad', 'pluck'],
};

export const DEFAULTS: Record<SoundPart, string> = { Vocal: 'piano', Ins: 'piano', chords: 'strings' };

/** The pitches the piano is sampled at. */
export const PIANO_PITCHES = [21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108];

const PIANO_LEVEL: Record<SoundPart, number> = { Vocal: 0.32, Ins: 0.14, chords: 0.09 };
const WAVE_LEVEL: Record<SoundPart, number> = { Vocal: 0.16, Ins: 0.07, chords: 0.03 };
const RELEASE = 0.09;
const ENSEMBLE: [number, number][] = [[-11, -0.35], [0, 0], [9, 0.35]];
const STRINGS_LEVEL = 0.7;
const FLOOR = 0.0005;
const SOUND_KEY = 'yue2.score.sounds';

type Voice = AudioScheduledSourceNode;

export function drumName(pitch: number): string {
  return KIT[((Math.round(pitch) % 12) + 12) % 12];
}

export function known(part: SoundPart, kind: string | undefined): string {
  return kind && CHOICES[part].includes(kind) ? kind : DEFAULTS[part];
}

export function rememberedSounds(): Record<SoundPart, string> {
  const kept = { ...DEFAULTS };
  try {
    const stored = JSON.parse(window.localStorage.getItem(SOUND_KEY) || '{}') as Record<string, string>;
    for (const part of Object.keys(kept) as SoundPart[]) kept[part] = known(part, stored[part]);
  } catch {
    return kept;
  }
  return kept;
}

export function rememberSounds(chosen: Record<SoundPart, string>): void {
  try {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify(chosen));
  } catch {
    // the choice lives only for this window
  }
}

export function hertz(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

let context: AudioContext | null = null;

function audio(): AudioContext {
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

const noises = new WeakMap<AudioContext, AudioBuffer>();

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = noises.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    noises.set(ctx, buffer);
  }
  return buffer;
}

function hiss(ctx: AudioContext, master: AudioNode, start: number, seconds: number, level: number, type: BiquadFilterType, frequency: number, q = 1): Voice {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(level, FLOOR), start);
  gain.gain.exponentialRampToValueAtTime(FLOOR, start + seconds);
  source.connect(filter).connect(gain).connect(master);
  source.start(start);
  source.stop(start + seconds + 0.02);
  return source;
}

function boom(ctx: AudioContext, master: AudioNode, start: number, seconds: number, level: number, from: number, to: number): Voice {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(level, FLOOR), start);
  gain.gain.exponentialRampToValueAtTime(FLOOR, start + seconds);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
  return osc;
}

function sustained(ctx: AudioContext, master: AudioNode, start: number, length: number, level: number, type: OscillatorType, frequency: number, attack: number, release: number, detune = 0): Voice {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  if (detune) osc.detune.value = detune;
  const gain = ctx.createGain();
  const stop = start + Math.max(0.06, length);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + attack);
  gain.gain.setValueAtTime(level, Math.max(start + attack, stop - release));
  gain.gain.linearRampToValueAtTime(0, stop + release);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(stop + release + 0.02);
  return osc;
}

function plucked(ctx: AudioContext, master: AudioNode, start: number, length: number, level: number, frequency: number): Voice {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = frequency;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(9000, frequency * 9), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(180, frequency * 1.4), start + 0.3);
  const gain = ctx.createGain();
  const stop = start + Math.min(Math.max(0.14, length), 1.4);
  gain.gain.setValueAtTime(Math.max(level, FLOOR), start);
  gain.gain.exponentialRampToValueAtTime(FLOOR, stop);
  osc.connect(filter).connect(gain).connect(master);
  osc.start(start);
  osc.stop(stop + 0.02);
  return osc;
}

/** A string section holding a chord: three detuned voices across the stereo, a slow attack, vibrato after half a second. */
function bowed(ctx: AudioContext, master: AudioNode, start: number, length: number, level: number, frequency: number): Voice[] {
  const stop = start + Math.max(0.12, length);
  const attack = Math.min(0.26, Math.max(0.06, length * 0.4));
  const release = 0.35;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(Math.min(9000, frequency * 2.5), start);
  filter.frequency.linearRampToValueAtTime(Math.min(9000, frequency * 5 + 600), start + attack);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(Math.max(level, FLOOR), start + attack);
  gain.gain.setValueAtTime(Math.max(level, FLOOR), Math.max(start + attack, stop));
  gain.gain.linearRampToValueAtTime(0, stop + release);
  filter.connect(gain).connect(master);
  const vibrato = ctx.createOscillator();
  vibrato.type = 'sine';
  vibrato.frequency.value = 5.3;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, start);
  depth.gain.linearRampToValueAtTime(7, start + 0.5);
  vibrato.connect(depth);
  const made: Voice[] = [vibrato];
  for (const [cents, side] of ENSEMBLE) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;
    osc.detune.value = cents;
    depth.connect(osc.detune);
    const place = ctx.createStereoPanner();
    place.pan.value = side;
    osc.connect(place).connect(filter);
    made.push(osc);
  }
  for (const voice of made) {
    voice.start(start);
    voice.stop(stop + release + 0.02);
  }
  return made;
}

const PIECES: ((ctx: AudioContext, master: AudioNode, start: number) => Voice[])[] = [
  (ctx, master, start) => [boom(ctx, master, start, 0.3, 0.3, 125, 45)],
  (ctx, master, start) => [hiss(ctx, master, start, 0.05, 0.1, 'bandpass', 1900, 6)],
  (ctx, master, start) => [hiss(ctx, master, start, 0.18, 0.13, 'highpass', 1500), boom(ctx, master, start, 0.12, 0.1, 220, 140)],
  (ctx, master, start) => [
    hiss(ctx, master, start, 0.09, 0.09, 'bandpass', 1300, 1.5),
    hiss(ctx, master, start + 0.014, 0.09, 0.08, 'bandpass', 1300, 1.5),
    hiss(ctx, master, start + 0.03, 0.12, 0.08, 'bandpass', 1300, 1.5),
  ],
  (ctx, master, start) => [boom(ctx, master, start, 0.32, 0.2, 165, 85)],
  (ctx, master, start) => [boom(ctx, master, start, 0.28, 0.19, 235, 120)],
  (ctx, master, start) => [hiss(ctx, master, start, 0.045, 0.07, 'highpass', 6500)],
  (ctx, master, start) => [boom(ctx, master, start, 0.24, 0.18, 320, 170)],
  (ctx, master, start) => [hiss(ctx, master, start, 0.32, 0.06, 'highpass', 6000)],
  (ctx, master, start) => [hiss(ctx, master, start, 1.0, 0.07, 'highpass', 4200)],
  (ctx, master, start) => [hiss(ctx, master, start, 0.5, 0.05, 'bandpass', 5400, 0.7)],
  (ctx, master, start) => [hiss(ctx, master, start, 0.06, 0.05, 'highpass', 7500)],
];

function synthesized(ctx: AudioContext, master: AudioNode, start: number, length: number, pitch: number, kind: string, level: number): Voice[] {
  if (kind === DRUMS) return PIECES[((Math.round(pitch) % 12) + 12) % 12](ctx, master, start);
  const frequency = hertz(pitch);
  if (kind === 'bass') return [sustained(ctx, master, start, length, level * 1.2, 'sine', frequency, 0.014, 0.05)];
  if (kind === 'pluck') return [plucked(ctx, master, start, length, level, frequency)];
  if (kind === 'strings') return bowed(ctx, master, start, length, level * STRINGS_LEVEL, frequency);
  if (kind === 'pad') {
    return [
      sustained(ctx, master, start, length, level * 0.9, 'triangle', frequency, 0.16, 0.2),
      sustained(ctx, master, start, length, level * 0.55, 'sine', frequency, 0.2, 0.2, 8),
    ];
  }
  return [sustained(ctx, master, start, length, level, 'triangle', frequency, 0.014, 0.05)];
}

const piano = new Map<number, AudioBuffer>();
let pianoLoading: Promise<void> | null = null;

/** The piano's thirty samples, fetched once; a failure says which file and is tried again next time. */
export function loadPiano(): Promise<void> {
  if (!pianoLoading) {
    const ctx = audio();
    pianoLoading = Promise.all(
      PIANO_PITCHES.map(async pitch => {
        const url = `/piano/${pitch}.ogg`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        piano.set(pitch, await ctx.decodeAudioData(await response.arrayBuffer()));
      }),
    ).then(() => undefined).catch(error => {
      pianoLoading = null;
      throw error;
    });
  }
  return pianoLoading;
}

function nearestSampled(pitch: number): number {
  let best = PIANO_PITCHES[0];
  for (const have of PIANO_PITCHES) if (Math.abs(have - pitch) < Math.abs(best - pitch)) best = have;
  return best;
}

function struck(ctx: AudioContext, master: AudioNode, start: number, length: number, pitch: number, part: SoundPart): Voice {
  const take = nearestSampled(pitch);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const level = PIANO_LEVEL[part];
  source.buffer = piano.get(take) ?? null;
  source.playbackRate.value = Math.pow(2, (pitch - take) / 12);
  const stop = start + Math.max(0.06, length);
  gain.gain.setValueAtTime(level, start);
  gain.gain.setValueAtTime(level, stop);
  gain.gain.linearRampToValueAtTime(0, stop + RELEASE);
  source.connect(gain).connect(master);
  source.start(start);
  source.stop(stop + RELEASE + 0.02);
  return source;
}

/** Plays a list of sound events; the piano must be loaded before a part set to piano is played. */
export class ScorePlayer {
  private voices: Voice[] = [];
  private master: GainNode | null = null;
  private started = 0;
  playing = false;
  sounds: Record<SoundPart, string> = { ...DEFAULTS };

  needsPiano(): boolean {
    return (Object.keys(this.sounds) as SoundPart[]).some(part => this.soundOf(part) === 'piano');
  }

  soundOf(part: SoundPart): string {
    return known(part, this.sounds[part]);
  }

  private tone(ctx: AudioContext, master: AudioNode, start: number, length: number, pitch: number, part: SoundPart): Voice[] {
    const kind = this.soundOf(part);
    if (kind === 'piano' && piano.size === PIANO_PITCHES.length) return [struck(ctx, master, start, length, pitch, part)];
    return synthesized(ctx, master, start, length, pitch, kind === 'piano' ? 'synth' : kind, WAVE_LEVEL[part]);
  }

  play(list: SoundEvent[]): void {
    this.stop();
    const ctx = audio();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    this.master = master;
    const origin = ctx.currentTime + 0.06;
    this.started = origin;
    for (const item of list) this.voices.push(...this.tone(ctx, master, origin + item.at, item.length, item.pitch, item.part));
    this.playing = true;
  }

  blip(pitch: number, part: SoundPart): void {
    const ctx = audio();
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    gain.connect(ctx.destination);
    this.tone(ctx, gain, ctx.currentTime + 0.01, 0.22, pitch, part);
  }

  elapsed(): number {
    return this.playing ? Math.max(0, audio().currentTime - this.started) : 0;
  }

  stop(): void {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        // already stopped on its own
      }
    }
    this.voices = [];
    this.master?.disconnect();
    this.master = null;
    this.playing = false;
  }
}
