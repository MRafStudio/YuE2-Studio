/**
 * The score editor's piano roll: a canvas the notes, chords and sections of a
 * score are drawn and edited on, with the player, the undo history and the
 * writing of every edit back into the score. Ported from the ScoreEditor of
 * pytraveler/YuE2-ComfyUI (web/js/yue2_score.js, Apache-2.0); the window
 * around it is React's, and reads what to show from `view()`.
 */

import * as roll from './scoreRoll';
import type { Clip, Model, Part, Sheet, SoundPart } from './scoreRoll';
import { CHOICES, DRUMS, drumName, known, loadPiano, rememberedSounds, rememberSounds, ScorePlayer } from './scoreSounds';
import { failed, lengthenScore, readScore, scoreMidi, transposeScore, writeScore } from './scoreApi';

export type Say = (key: string, values?: Record<string, string | number>) => string;
export type Count = (base: string, count: number) => string;
export type Tab = 'roll' | 'notes' | 'abc';
export type PartChoice = Part | 'chords' | 'both';

export interface Limit {
  seconds: number;
  auto: boolean;
}

export interface Status {
  text: string;
  bad: boolean;
  action?: { label: string; run: () => void };
}

export interface Ask {
  title: string;
  message: string;
  ok: string;
  cancel: string;
}

export interface EngineHost {
  say: Say;
  count: Count;
  confirm: (ask: Ask) => Promise<boolean>;
  changed: () => void;
}

export interface EngineView {
  tab: Tab;
  drawn: boolean;
  empty: 'none' | 'loading' | 'empty' | 'unreadable';
  part: PartChoice;
  repeats: boolean;
  snap: number;
  snapChoices: { label: string; ticks: number }[];
  finer: boolean;
  tempo: number | null;
  tempoLow: number;
  tempoHigh: number;
  keyChoices: { name: string; shift: number }[];
  keyBusy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  picked: boolean;
  canPaste: boolean;
  playing: boolean;
  hear: Record<SoundPart, boolean>;
  sounds: Record<SoundPart, string>;
  status: Status;
  facts: { key: string; meter: string; bpm: number; bars: number; seconds: number; sungUpTo: number | null; auto: boolean } | null;
  edited: boolean;
  changed: number[];
  current: string;
  busy: boolean;
}

const KEYS_W = 58;
const SECTION_H = 16;
const BAR_H = 30;
const RULER_H = SECTION_H + BAR_H;
const CHORD_H = 24;
const ROW_H = 14;
const EDGE_PX = 7;
const CHORD_BOX_W = 150;
const NOTE_RADIUS = 2;
const WRITE_DELAY = 250;
const READ_DELAY = 450;
export const NEW_BARS = 16;
export const NEW_BPM = 120;
export const ADD_BARS = [1, 2, 4, 8, 16, 32];
const PREFERRED_SNAP = 'scoreSnapEighth';

const DARK = {
  back: '#243035', rowWhite: '#34434A', rowBlack: '#2D3A40', octave: '#222C31', snap: '#303E45', beat: '#28343A', bar: '#1A2226',
  changed: 'rgba(240, 176, 88, 0.12)', locked: 'rgba(255, 255, 255, 0.05)',
  note: '#A3F5B5', noteEdge: '#173D22', noteText: '#08200F', insNote: '#9FD0F7', insEdge: '#123650', insText: '#061B2B',
  chordNote: '#D9C2F5', chordRoot: '#B990EC', chordEdge: '#3A1F57', chordText: '#1D0B2E',
  refused: 'rgba(236, 226, 240, 0.55)', refusedEdge: '#E08A8A', picked: '#FF9A91', pickedEdge: '#5E1B16', pickedText: '#2B0805',
  shine: 'rgba(255, 255, 255, 0.55)', ghost: 'rgba(196, 220, 230, 0.20)', ghostEdge: 'rgba(196, 220, 230, 0.34)', box: 'rgba(255, 255, 255, 0.75)',
  ruler: '#1C2529', rulerText: '#AFC3CC', rulerTick: '#3B4A51', lane: '#212B30', laneText: '#8FA3AC',
  chip: '#33444C', chipEdge: '#526973', chipText: '#E4EEF2', playhead: '#F5A623',
  limit: '#F2D15C', limitShade: 'rgba(8, 12, 14, 0.45)', limitChip: '#4A4119', limitText: '#FFF1B8',
  keyWhite: '#E3E6E8', keyEdge: '#9EA6AA', keyBlack: '#1B1E20', keyBlackTop: '#3B4146', keyText: '#4A555B', keyTextC: '#1A2226',
  keyUnder: '#B7D2E4', keyBlackUnder: '#2F4553', keyBlackText: '#E4EEF2', keysEdge: '#11171A', sectionEdge: '#F0F4F6',
};

type Skin = typeof DARK;

const LIGHT: Skin = {
  back: '#F4F4F5', rowWhite: '#FFFFFF', rowBlack: '#F0F1F3', octave: '#D4D4D8', snap: '#ECECEF', beat: '#E0E0E5', bar: '#A1A1AA',
  changed: 'rgba(245, 158, 11, 0.13)', locked: 'rgba(0, 0, 0, 0.045)',
  note: '#4ADE80', noteEdge: '#15803D', noteText: '#052E16', insNote: '#7DB9F7', insEdge: '#1D4ED8', insText: '#0B2545',
  chordNote: '#D8C8FB', chordRoot: '#B39BF5', chordEdge: '#6D28D9', chordText: '#2E1065',
  refused: 'rgba(120, 113, 108, 0.22)', refusedEdge: '#DC2626', picked: '#FB7185', pickedEdge: '#9F1239', pickedText: '#4C0519',
  shine: 'rgba(255, 255, 255, 0.6)', ghost: 'rgba(100, 116, 139, 0.16)', ghostEdge: 'rgba(100, 116, 139, 0.36)', box: 'rgba(24, 24, 27, 0.7)',
  ruler: '#E4E4E7', rulerText: '#3F3F46', rulerTick: '#A1A1AA', lane: '#EDEDF0', laneText: '#71717A',
  chip: '#FFFFFF', chipEdge: '#A1A1AA', chipText: '#27272A', playhead: '#EA580C',
  limit: '#CA8A04', limitShade: 'rgba(24, 24, 27, 0.09)', limitChip: '#FEF9C3', limitText: '#713F12',
  keyWhite: '#FFFFFF', keyEdge: '#A1A1AA', keyBlack: '#27272A', keyBlackTop: '#52525B', keyText: '#71717A', keyTextC: '#18181B',
  keyUnder: '#BFDBFE', keyBlackUnder: '#1E3A5F', keyBlackText: '#F4F4F5', keysEdge: '#D4D4D8', sectionEdge: '#18181B',
};

const SECTION_COLORS: [string, string][] = [
  ['pre', '#9B7FD1'], ['intro', '#8C96A3'], ['verse', '#4E98C4'], ['chorus', '#D19A3F'], ['hook', '#D9774B'],
  ['bridge', '#4FA37A'], ['outro', '#7C8FA6'], ['solo', '#C98B5B'], ['inter', '#5FA3A3'], ['inst', '#5FA3A3'],
];

export const COMMON_CHORDS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].flatMap(root => ['', 'm', '7', 'maj7', 'm7', 'sus4', 'dim', 'aug'].map(quality => root + quality));

const INPUT_CLASS = 'absolute z-10 h-[22px] rounded-md border border-zinc-300 bg-white px-1.5 text-[12px] text-zinc-900 shadow-lg outline-none focus:border-pink-500 dark:border-white/20 dark:bg-zinc-800 dark:text-zinc-100';
const INPUT_BAD = '!border-red-500';

let shared: Clip | null = null;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function now(): number {
  return performance.now();
}

function sectionColor(name: string): string {
  const text = String(name || '').toLowerCase();
  return SECTION_COLORS.find(([key]) => text.includes(key))?.[1] ?? '#6B7D88';
}

type Drag =
  | { mode: 'move'; ids: number[]; chords: number[]; from: Model; base: Model; tick: number; pitch: number; sounded: number; ticks: number; drawn?: boolean }
  | { mode: 'resize'; id: number; from: Model; start: number; length: number }
  | { mode: 'box'; tick: number; pitch: number; toTick: number; toPitch: number; kept: Set<number>; keptChords: Set<number> }
  | { mode: 'section'; from: number; base: Model; bar?: number }
  | { mode: 'chord'; from: Model; base: Model; start: number; starts: number[]; tick: number; pitch: number; ticks: number; semitones: number; drawn?: boolean }
  | { mode: 'edge'; from: Model; start: number; to: number }
  | { mode: 'tone'; from: Model; start: number; name: string; index: number; pitch: number; toPitch: number; pitches: number[]; named: string | null };

type Snapshot = { keyed: true; model: Model; base: string; current: string; sheet: Sheet; good: Model | null; changed: number[]; moved: Moved | null };
type Entry = Model | Snapshot;
type Moved = { from: string; shift: number };

interface Field {
  input: HTMLInputElement;
  done: boolean;
  finish: (keep: boolean) => boolean;
}

export class ScoreEngine {
  private host: EngineHost;
  private box: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private themeWatch: MutationObserver | null = null;
  private player = new ScorePlayer();
  private sounds = rememberedSounds();
  private hear: Record<SoundPart, boolean> = { Vocal: true, Ins: true, chords: false };
  private sequence = 0;
  private writeSequence = 0;
  private closed = false;
  private tab: Tab = 'roll';
  private part: Part = 'Vocal';
  private both = false;
  private chordPart = false;
  private repeats = false;
  private snap = 1;
  private lastLength = 0;
  private selection = new Set<number>();
  private chordPicks = new Set<number>();
  private drag: Drag | null = null;
  private working: Model | null = null;
  private hoverPitch: number | null = null;
  private sheetTempo: number | null = null;
  private tempoFrom: Model | null = null;
  private moved: Moved | null = null;
  private keyBusy = false;
  private playhead = 0;
  private playTick: number | null = null;
  private playFrom = 0;
  private pianoWait = false;
  private chordInput: Field | null = null;
  private sectionInput: Field | null = null;
  private sectionBoxes: { bar: number; name: string; from: number; to: number }[] = [];
  private notice: string | null = null;
  private status: Status = { text: '', bad: false };
  private changed: number[] = [];
  private localChanged: number[] = [];
  private sheet: Sheet | null = null;
  private model: Model | null = null;
  private good: Model | null = null;
  private history = new roll.History<Entry>();
  private dropped: Entry[] = [];
  private drawn: { at: number; redo: Entry[] } | null = null;
  private lastDown: { at: number; px: number; py: number } | null = null;
  private tick0 = 0;
  private pxPerTick = 4;
  private pitchTop = 79;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private writeTimer = 0;
  private readTimer = 0;
  private writePending = false;
  private writing = false;
  private reading = false;
  private typedProblem: string | null = null;
  private emptyKind: 'empty' | 'unreadable' = 'empty';
  private opened = '';
  private base = '';
  private current = '';
  private limit: Limit | null = null;
  private listeners = new Set<() => void>();
  private shown: EngineView | null = null;
  private previous: EngineView | null = null;
  private signature = '';
  private scroller: HTMLInputElement | null = null;
  private frame = 0;

  constructor(host: EngineHost) {
    this.host = host;
    this.player.sounds = this.sounds;
    loadPiano().catch(() => undefined);
  }

  // ---- the React side ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  view = (): EngineView => {
    if (this.shown) return this.shown;
    const fresh = this.fresh();
    const signature = JSON.stringify({ ...fresh, status: [fresh.status.text, fresh.status.bad, fresh.status.action?.label ?? ''] });
    if (this.previous && signature === this.signature) {
      this.previous.status = fresh.status;
      this.shown = this.previous;
      return this.previous;
    }
    this.signature = signature;
    this.previous = fresh;
    this.shown = fresh;
    return fresh;
  };

  private fresh(): EngineView {
    const sheet = this.sheet;
    const picked = this.selection.size > 0 || (this.chordsPickable() && this.chordPicks.size > 0);
    const key = sheet?.bars[0]?.key || '';
    const tempi = sheet ? roll.tempoRange(sheet.bpm) : { low: roll.TEMPO_LOW, high: roll.TEMPO_HIGH };
    const cut = this.cutTick();
    return {
      tab: this.tab,
      drawn: Boolean(sheet),
      empty: sheet ? 'none' : this.reading ? 'loading' : this.emptyKind,
      part: this.both ? 'both' : this.chordPart ? 'chords' : this.part,
      repeats: this.repeats,
      snap: this.snap,
      snapChoices: sheet ? roll.snapChoices(sheet.per_quarter) : [],
      finer: Boolean(sheet && sheet.unit < roll.FINEST),
      tempo: this.model ? this.model.bpm : null,
      tempoLow: tempi.low,
      tempoHigh: tempi.high,
      keyChoices: sheet && this.model ? roll.keyChoices(key, roll.voiceMiddle(this.model)) : [],
      keyBusy: this.keyBusy,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      picked,
      canPaste: Boolean(shared && sheet),
      playing: this.player.playing,
      hear: { ...this.hear },
      sounds: { ...this.sounds },
      status: this.status,
      facts: sheet
        ? { key, meter: sheet.bars[0]?.meter || '', bpm: sheet.bpm, bars: sheet.bars.length, seconds: sheet.seconds, sungUpTo: cut === null || !this.limit ? null : this.limit.seconds, auto: Boolean(this.limit?.auto) }
        : null,
      edited: this.edited(),
      changed: this.changed,
      current: this.current,
      busy: this.reading || this.keyBusy,
    };
  }

  private emit(): void {
    this.shown = null;
    for (const listener of this.listeners) listener();
  }

  attach(box: HTMLDivElement): void {
    this.closed = false;
    this.box = box;
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full touch-none';
    canvas.title = this.say('scoreRollHint');
    box.appendChild(canvas);
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    canvas.addEventListener('pointermove', event => this.pointerMove(event));
    canvas.addEventListener('pointerleave', () => this.hover(null));
    canvas.addEventListener('pointerup', event => this.pointerUp(event));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('mousedown', event => event.preventDefault());
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => this.wheel(event), { passive: false });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(box);
    this.themeWatch = new MutationObserver(() => this.draw());
    this.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    this.resize();
  }

  destroy(): void {
    this.closed = true;
    this.stopPlaying();
    window.clearTimeout(this.writeTimer);
    window.clearTimeout(this.readTimer);
    window.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.themeWatch?.disconnect();
    this.canvas?.remove();
    this.canvas = null;
    this.box = null;
    this.width = 0;
  }

  focus(): void {
    this.box?.focus();
  }

  setLimit(limit: Limit | null): void {
    this.limit = limit;
    this.showDescription();
    this.draw();
  }

  private say(key: string, values?: Record<string, string | number>): string {
    return this.host.say(key, values);
  }

  private setStatus(text: string, bad = false, action?: Status['action']): void {
    this.status = { text, bad, action };
    this.emit();
  }

  edited(): boolean {
    return this.writePending || this.writing || this.readTimer !== 0 || (this.current || '').trim() !== (this.opened || '').trim();
  }

  hasCopy(): boolean {
    return Boolean(shared);
  }

  // ---- loading ----

  async open(text: string): Promise<void> {
    this.opened = String(text || '').trim();
    await this.load(this.opened);
  }

  async load(text: string, pending?: { text: string; bad: boolean }): Promise<void> {
    this.stopPlaying();
    const clean = String(text || '').trim();
    this.base = clean;
    this.current = clean;
    this.changed = [];
    this.localChanged = [];
    this.sheet = null;
    this.model = null;
    this.good = null;
    this.history = new roll.History<Entry>();
    this.selection = new Set();
    this.chordPicks = new Set();
    this.notice = null;
    this.moved = null;
    this.typedProblem = null;
    if (!clean) {
      this.emptyKind = 'empty';
      this.status = pending ? { text: pending.text, bad: pending.bad } : { text: '', bad: false };
      if (this.tab === 'notes') this.tab = 'roll';
      this.emit();
      return;
    }
    const sequence = ++this.sequence;
    this.reading = true;
    this.setStatus(this.say('scoreReading'));
    const answer = await readScore(clean);
    this.reading = false;
    if (this.closed || sequence !== this.sequence) return;
    if (failed(answer)) {
      this.emptyKind = 'unreadable';
      this.tab = 'abc';
      this.setStatus(answer.error || this.say('scoreUnreadable'), true);
      return;
    }
    this.adopt(answer.sheet);
    if (pending) this.setStatus(pending.text, pending.bad);
  }

  private adopt(sheet: Sheet, fit = true, prefer = PREFERRED_SNAP): void {
    this.sheet = sheet;
    this.model = roll.modelOf(sheet);
    this.good = this.model;
    this.localChanged = [];
    this.sheetTempo = sheet.bpm;
    this.tempoFrom = null;
    const choices = roll.snapChoices(sheet.per_quarter);
    this.snap = (choices.find(choice => choice.label === prefer) || choices[0])?.ticks ?? 1;
    this.playhead = 0;
    if (fit) this.fitView();
    if (sheet.cut) this.notice = this.say('scoreCutNotice');
    this.showDescription();
    this.draw();
    if (this.tab === 'roll') requestAnimationFrame(() => this.resize());
  }

  // ---- what the window shows ----

  private cutTick(): number | null {
    if (!this.sheet || !this.limit) return null;
    const tick = roll.limitTick(this.sheet, this.limit.seconds);
    return tick < this.sheet.total ? tick : null;
  }

  private lateBars(bars: number[]): number[] {
    if (this.cutTick() === null || !this.sheet || !this.limit) return [];
    const late = new Set(roll.barsAfter(this.sheet, this.limit.seconds));
    return bars.filter(bar => late.has(bar));
  }

  private barList(numbers: number[]): string {
    const runs: [number, number][] = [];
    for (const number of [...numbers].sort((a, b) => a - b)) {
      const last = runs[runs.length - 1];
      if (last && number <= last[1] + 1) last[1] = Math.max(last[1], number);
      else runs.push([number, number]);
    }
    const words = runs.map(([low, high]) => (low === high ? String(low + 1) : low + 1 + '–' + (high + 1)));
    if (words.length <= 1) return words.join('');
    return words.slice(0, -1).join(', ') + this.say('scoreAnd') + words[words.length - 1];
  }

  private shiftWords(shift: number): string {
    return this.host.count(shift > 0 ? 'scoreUp' : 'scoreDown', Math.abs(shift));
  }

  private reason(): string {
    return this.say(this.limit?.auto ? 'scoreReasonAuto' : 'scoreReasonSet');
  }

  private describe(): string {
    const sheet = this.sheet;
    if (!sheet) return '';
    const parts: string[] = [];
    if (this.model && this.sheetTempo !== null && this.model.bpm !== this.sheetTempo) {
      parts.push(this.say('scoreRetimed', { bpm: this.model.bpm, was: this.sheetTempo, way: this.say(this.model.bpm > this.sheetTempo ? 'scoreFaster' : 'scoreSlower') }));
    }
    if (this.moved) {
      const keys = new Set(sheet.bars.map(bar => bar.key));
      parts.push(this.say('scoreKeyed', { shift: this.shiftWords(this.moved.shift), from: this.moved.from, to: sheet.bars[0]?.key || '', keys: keys.size > 1 ? this.say('scoreKeyedKeys') : '' }));
    }
    const before = parts.join(' ');
    const time = this.limit ? roll.clock(this.limit.seconds) : '';
    if (!this.changed.length) {
      const head = before ? before + ' ' + this.say('scoreNothingElse') : this.say('scoreNoChanges');
      return this.cutTick() === null ? head : head + ' ' + this.say('scoreOnlyFirst', { time, reason: this.reason() });
    }
    const one = this.changed.length === 1;
    const bars = this.barList(this.changed);
    const main = this.moved ? this.say(one ? 'scoreChangedOnTopBar' : 'scoreChangedOnTopBars', { bars }) : this.say(one ? 'scoreChangedBar' : 'scoreChangedBars', { bars });
    const late = this.lateBars(this.changed);
    const tail = late.length ? ' ' + this.say('scoreLate', { bars: this.barList(late), time, reason: this.reason() }) : '';
    return (before ? before + ' ' : '') + main + tail;
  }

  private showDescription(): void {
    if (!this.sheet) return;
    const text = this.describe() + (this.sheet.cut && this.edited() ? ' ' + this.say('scoreCutNotWritten') : '');
    this.setStatus(this.notice ? this.notice + ' ' + text : text, this.lateBars(this.changed).length > 0);
  }

  // ---- tabs, parts, grid, tempo, key ----

  showTab(tab: Tab): void {
    this.tab = tab;
    this.emit();
    if (tab === 'roll') {
      requestAnimationFrame(() => {
        this.resize();
        this.box?.focus();
      });
    }
  }

  private soundOf(part: SoundPart): string {
    return known(part, this.sounds[part]);
  }

  private drumRows(): boolean {
    return !this.both && !this.chordPart && this.part === 'Ins' && this.soundOf('Ins') === DRUMS;
  }

  pickPart(choice: PartChoice): void {
    const both = choice === 'both';
    const chords = choice === 'chords';
    if (!both && !chords) this.part = choice;
    const wasChords = this.chordPart;
    this.both = both;
    this.chordPart = chords;
    const kept = new Set(this.model ? this.editedParts().flatMap(part => this.model?.notes[part].map(note => note.id) ?? []) : []);
    this.selection = new Set([...this.selection].filter(id => kept.has(id)));
    if (!both && !chords) this.chordPicks.clear();
    if (this.sheet) {
      this.notice = both ? this.say('scoreBothNotice') : chords ? this.say('scoreChordsNotice') : null;
      this.showDescription();
      if (chords && !wasChords) this.showChordRows();
    }
    this.draw();
    this.box?.focus();
  }

  setRepeats(on: boolean): void {
    this.repeats = on;
    this.emit();
    this.box?.focus();
  }

  setHear(part: SoundPart, on: boolean): void {
    this.hear = { ...this.hear, [part]: on };
    this.emit();
  }

  setSound(part: SoundPart, kind: string): void {
    this.sounds = { ...this.sounds, [part]: known(part, kind) };
    this.player.sounds = this.sounds;
    rememberSounds(this.sounds);
    this.stopPlaying();
    this.draw();
  }

  soundChoices(part: SoundPart): string[] {
    return CHOICES[part];
  }

  private editedParts(): Part[] {
    if (this.chordPart) return [];
    return this.both ? [this.part, this.part === 'Vocal' ? 'Ins' : 'Vocal'] : [this.part];
  }

  private clearPicks(): void {
    this.selection.clear();
    this.chordPicks.clear();
  }

  private chordsPickable(): boolean {
    return this.both || this.chordPart;
  }

  private pickedChords(): number[] {
    if (!this.model || !this.chordsPickable()) return [];
    return this.model.chords.map(chord => chord.start).filter(start => this.chordPicks.has(start));
  }

  private showChordRows(): void {
    if (!this.model) return;
    const pitches = this.model.chords.flatMap(chord => roll.chordPitches(chord.name));
    const low = pitches.length ? Math.min(...pitches) : roll.CHORD_ROOT;
    const high = pitches.length ? Math.max(...pitches) : roll.CHORD_ROOT + 16;
    const rows = this.visibleRows();
    if (low >= this.pitchTop - rows + 1 && high <= this.pitchTop) return;
    this.pitchTop = Math.round((low + high) / 2) + Math.floor(rows / 2);
    this.clampView();
  }

  private noteById(model: Model, id: number) {
    const part = roll.partOf(model, id);
    const note = part ? model.notes[part].find(candidate => candidate.id === id) : undefined;
    return part && note ? { note, part } : null;
  }

  setSnap(value: number | 'finer'): void {
    if (value === 'finer') {
      void this.finerGrid();
      return;
    }
    this.snap = value;
    this.draw();
  }

  previewTempo(value: number): void {
    if (!this.model || !this.sheet || this.sheetTempo === null) return;
    const bpm = roll.tempoOf(value, this.sheetTempo);
    if (bpm === null || bpm === this.model.bpm) return;
    if (!this.tempoFrom) this.tempoFrom = this.model;
    this.model = { ...this.model, bpm };
    this.retimeSheet();
    this.draw();
  }

  setTempo(value: number): void {
    if (!this.model || !this.sheet || this.sheetTempo === null) return;
    const bpm = roll.tempoOf(value, this.sheetTempo);
    const from = this.tempoFrom || this.model;
    this.tempoFrom = null;
    this.model = from;
    this.retimeSheet();
    if (bpm === null || bpm === from.bpm) {
      this.draw();
      return;
    }
    this.commit({ ...from, bpm }, from);
  }

  private retimeSheet(): void {
    if (!this.sheet || !this.model || this.sheet.bpm === this.model.bpm) return;
    this.sheet = { ...this.sheet, bpm: this.model.bpm };
    this.sheet.seconds = roll.secondsAt(this.sheet, this.sheet.total);
  }

  async changeKey(shift: number): Promise<void> {
    if (!this.sheet || this.keyBusy || !shift) return;
    this.chordInput?.finish(true);
    this.sectionInput?.finish(true);
    if (this.writePending) await this.write();
    if (this.closed || !this.sheet) return;
    this.keyBusy = true;
    this.setStatus(this.say('scoreMoving', { shift: this.shiftWords(shift) }));
    const sequence = ++this.writeSequence;
    const answer = await transposeScore(this.current, shift);
    this.keyBusy = false;
    if (this.closed) return;
    if (sequence !== this.writeSequence) {
      this.setStatus(this.say('scoreKeyStayed'), true);
      return;
    }
    if (failed(answer)) {
      this.setStatus(answer.error || this.say('scoreKeyFailed'), true);
      return;
    }
    this.stopPlaying();
    this.dropped = this.history.push(this.snapshot());
    this.drawn = null;
    const total = (this.moved?.shift || 0) + shift;
    this.moved = total ? { from: this.moved?.from || answer.before, shift: total } : null;
    this.base = answer.abc;
    this.current = answer.abc;
    this.sheet = answer.sheet;
    this.sheetTempo = answer.sheet.bpm;
    this.model = roll.modelOf(answer.sheet);
    this.good = this.model;
    this.changed = [];
    this.localChanged = [];
    this.clearPicks();
    this.notice = this.voiceWarning() || null;
    this.showDescription();
    this.draw();
  }

  private snapshot(): Snapshot {
    return { keyed: true, model: this.model as Model, base: this.base, current: this.current, sheet: this.sheet as Sheet, good: this.good, changed: this.changed, moved: this.moved };
  }

  private restore(entry: Entry): void {
    if (!('keyed' in entry)) {
      this.model = entry;
      return;
    }
    this.base = entry.base;
    this.current = entry.current;
    this.sheet = entry.sheet;
    this.sheetTempo = entry.sheet.bpm;
    this.good = entry.good;
    this.changed = entry.changed;
    this.moved = entry.moved;
    this.model = entry.model;
  }

  async addBars(count: number): Promise<void> {
    if (!this.sheet) return;
    if (this.writePending) await this.write();
    if (this.closed || !this.sheet) return;
    await this.relength(this.current, this.sheet.bars.length + count, this.say('scoreBarsAdded', { bars: this.host.count('scoreBars', count) }));
  }

  async newScore(): Promise<void> {
    await this.relength('', NEW_BARS, this.say('scoreNewScore', { bars: this.host.count('scoreBars', NEW_BARS), bpm: NEW_BPM }));
  }

  private async relength(abc: string, bars: number, note: string): Promise<void> {
    const sequence = ++this.writeSequence;
    const moved = abc ? this.moved : null;
    this.setStatus(this.say('scoreWriting'));
    const answer = await lengthenScore(abc, bars, NEW_BPM);
    if (this.closed || sequence !== this.writeSequence) return;
    if (failed(answer)) {
      this.setStatus(answer.error || this.say('scoreWriteFailed'), true);
      return;
    }
    await this.load(answer.abc, { text: note, bad: false });
    if (!this.closed && this.sheet) this.moved = moved;
  }

  private async finerGrid(): Promise<void> {
    if (!this.sheet || !this.model || this.sheet.unit >= roll.FINEST) return;
    const factor = roll.FINEST / this.sheet.unit;
    const zoom = this.pxPerTick / factor;
    const at = this.tick0 * factor;
    this.setStatus(this.say('scoreFinerWriting'));
    const asked = roll.scaledModel(this.model, factor, roll.FINEST);
    const sequence = ++this.writeSequence;
    const answer = await writeScore(this.base, roll.sheetOf(asked));
    if (this.closed || sequence !== this.writeSequence) return;
    if (failed(answer)) {
      this.setStatus(answer.error || this.say('scoreFinerFailed'), true);
      this.emit();
      return;
    }
    this.base = answer.abc;
    this.current = answer.abc;
    this.changed = [];
    this.history = new roll.History<Entry>();
    this.adopt(answer.sheet, false, 'scoreSnapThirtySecond');
    this.pxPerTick = zoom;
    this.tick0 = at;
    this.clampView();
    this.notice = this.say('scoreFinerNotice');
    this.showDescription();
    this.draw();
  }

  // ---- the view ----

  fitView(): void {
    if (!this.sheet || !this.model) return;
    const span = roll.pitchSpan(this.model);
    const rows = Math.max(8, Math.floor(((this.height || 520) - RULER_H - CHORD_H) / ROW_H));
    const middle = Math.round((span.low + span.high) / 2);
    this.pitchTop = clamp(Math.max(span.high, middle + Math.floor(rows / 2)), roll.LOWEST + rows - 1, roll.HIGHEST);
    const shown = Math.min(this.sheet.bars.length, 8);
    const last = this.sheet.bars[Math.max(0, shown - 1)];
    const ticks = last ? last.start + last.length : this.sheet.total;
    this.pxPerTick = Math.max(0.05, ((this.width || 1100) - KEYS_W) / Math.max(1, ticks));
    this.tick0 = 0;
    this.clampView();
  }

  fitSong(): void {
    if (!this.sheet) return;
    this.pxPerTick = Math.max(0.05, (this.width - KEYS_W) / Math.max(1, this.sheet.total));
    this.tick0 = 0;
    this.clampView();
    this.draw();
  }

  toStart(): void {
    this.stopPlaying();
    this.playhead = 0;
    this.tick0 = 0;
    this.clampView();
    this.draw();
  }

  /** Where the horizontal scroller stands: the first tick shown, and how far it can go. */
  scroll(): { at: number; room: number } {
    if (!this.sheet) return { at: 0, room: 0 };
    return { at: this.tick0, room: Math.max(0, this.sheet.total - this.visibleTicks()) };
  }

  scrollTo(tick: number): void {
    this.tick0 = tick;
    this.clampView();
    this.draw();
  }

  private visibleTicks(): number {
    return Math.max(1, (this.width - KEYS_W) / this.pxPerTick);
  }

  private visibleRows(): number {
    return Math.max(1, Math.floor((this.height - RULER_H - CHORD_H) / ROW_H));
  }

  private clampView(): void {
    if (!this.sheet) return;
    const room = Math.max(0, this.sheet.total - this.visibleTicks());
    this.tick0 = clamp(this.tick0, 0, room);
    this.pitchTop = clamp(this.pitchTop, roll.LOWEST + this.visibleRows() - 1, roll.HIGHEST);
    if (this.scroller) {
      this.scroller.max = String(Math.ceil(room));
      this.scroller.value = String(Math.round(this.tick0));
      this.scroller.disabled = room <= 0;
    }
  }

  attachScroller(input: HTMLInputElement): void {
    if (this.scroller === input) return;
    this.scroller = input;
    input.addEventListener('input', () => {
      this.tick0 = Number(input.value);
      this.draw();
    });
    this.clampView();
  }

  resize(): void {
    const box = this.box;
    const canvas = this.canvas;
    if (!box || !canvas || this.tab !== 'roll') return;
    const width = box.clientWidth;
    const height = box.clientHeight;
    if (!width || !height) return;
    const first = !this.width;
    this.ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * this.ratio);
    canvas.height = Math.floor(height * this.ratio);
    this.width = canvas.width / this.ratio;
    this.height = canvas.height / this.ratio;
    if (first && this.sheet) this.fitView();
    this.clampView();
    this.draw();
  }

  zoom(factor: number, anchorPx?: number): void {
    if (!this.sheet) return;
    const px = anchorPx ?? KEYS_W + (this.width - KEYS_W) / 2;
    const anchor = this.tickAt(px);
    this.pxPerTick = clamp(this.pxPerTick * factor, 0.05, 60);
    this.tick0 = anchor - (px - KEYS_W) / this.pxPerTick;
    this.clampView();
    this.draw();
  }

  private x(tick: number): number {
    return KEYS_W + (tick - this.tick0) * this.pxPerTick;
  }

  private tickAt(px: number): number {
    return this.tick0 + (px - KEYS_W) / this.pxPerTick;
  }

  private y(pitch: number): number {
    return RULER_H + CHORD_H + (this.pitchTop - pitch) * ROW_H;
  }

  private pitchAt(py: number): number {
    return this.pitchTop - Math.floor((py - RULER_H - CHORD_H) / ROW_H);
  }

  private shownModel(): Model | null {
    return this.working || this.model;
  }

  private skin(): Skin {
    return document.documentElement.classList.contains('dark') ? DARK : LIGHT;
  }

  draw(): void {
    this.emit();
    const canvas = this.canvas;
    const sheet = this.sheet;
    const model = this.shownModel();
    if (!canvas || !sheet || !model || this.tab !== 'roll' || !this.width) return;
    const skin = this.skin();
    const c = canvas.getContext('2d');
    if (!c) return;
    const W = this.width;
    const H = this.height;
    const top = RULER_H + CHORD_H;
    const px = this.pxPerTick;
    const first = this.tick0;
    const lastTick = this.tickAt(W);
    c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    c.font = '10px system-ui, sans-serif';
    c.textBaseline = 'alphabetic';
    c.fillStyle = skin.back;
    c.fillRect(0, 0, W, H);

    c.save();
    c.beginPath();
    c.rect(KEYS_W, top, W - KEYS_W, H - top);
    c.clip();
    const rows = Math.ceil((H - top) / ROW_H) + 1;
    for (let r = 0; r < rows; r++) {
      const pitch = this.pitchTop - r;
      const rowY = top + r * ROW_H;
      c.fillStyle = roll.isBlack(pitch) ? skin.rowBlack : skin.rowWhite;
      c.fillRect(KEYS_W, rowY, W - KEYS_W, ROW_H);
      if (((pitch % 12) + 12) % 12 === 0) {
        c.fillStyle = skin.octave;
        c.fillRect(KEYS_W, rowY + ROW_H - 1, W - KEYS_W, 1);
      }
    }
    const marked = new Set(this.changed.length ? this.changed : this.localChanged);
    const localMarked = new Set(this.localChanged);
    for (let index = roll.barAt(sheet, Math.max(0, Math.floor(first))); index < sheet.bars.length; index++) {
      const bar = sheet.bars[index];
      if (bar.start > lastTick) break;
      const barX = this.x(bar.start);
      const barW = bar.length * px;
      if (marked.has(index) || localMarked.has(index)) {
        c.fillStyle = skin.changed;
        c.fillRect(barX, top, barW, H - top);
      }
      if (!bar.editable) {
        c.fillStyle = skin.locked;
        for (let stripe = -H; stripe < barW; stripe += 12) c.fillRect(barX + stripe + (H - top) / 2, top, 3, H - top);
      }
      const den = Number(bar.meter.split('/')[1]) || 4;
      const beat = (sheet.per_quarter * 4) / den;
      if (this.snap * px >= 7) {
        c.fillStyle = skin.snap;
        for (let t = bar.start + this.snap; t < bar.start + bar.length; t += this.snap) c.fillRect(Math.round(this.x(t)), top, 1, H - top);
      }
      c.fillStyle = skin.beat;
      for (let t = bar.start + beat; t < bar.start + bar.length; t += beat) c.fillRect(Math.round(this.x(t)), top, 1, H - top);
      c.fillStyle = skin.bar;
      c.fillRect(Math.round(barX), top, 2, H - top);
    }
    if (this.chordPart) {
      this.drawPart(c, skin, model, 'Ins', true, first, lastTick);
      this.drawPart(c, skin, model, 'Vocal', true, first, lastTick);
      this.drawChords(c, skin, model, first, lastTick);
    } else {
      this.drawPart(c, skin, model, this.part === 'Vocal' ? 'Ins' : 'Vocal', !this.both, first, lastTick);
      this.drawPart(c, skin, model, this.part, false, first, lastTick);
    }
    const cut = this.cutTick();
    const cutX = cut === null ? null : this.x(cut);
    if (cutX !== null && cutX < W) {
      const shadeFrom = Math.max(KEYS_W, cutX);
      c.fillStyle = skin.limitShade;
      c.fillRect(shadeFrom, top, W - shadeFrom, H - top);
      if (cutX >= KEYS_W) this.dashedLine(c, skin, cutX, top, H);
    }
    const marker = this.playTick ?? this.playhead;
    const markerX = Math.round(this.x(marker)) + 0.5;
    const markerShown = markerX >= KEYS_W && markerX <= W;
    if (markerShown) {
      c.strokeStyle = skin.playhead;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(markerX, top);
      c.lineTo(markerX, H);
      c.stroke();
    }
    const drag = this.drag;
    if (drag?.mode === 'box') {
      const x0 = this.x(drag.tick);
      const x1 = this.x(drag.toTick);
      const y0 = this.y(Math.max(drag.pitch, drag.toPitch));
      const y1 = this.y(Math.min(drag.pitch, drag.toPitch)) + ROW_H;
      c.strokeStyle = skin.box;
      c.lineWidth = 1;
      c.setLineDash([4, 3]);
      c.strokeRect(Math.min(x0, x1), y0, Math.abs(x1 - x0), y1 - y0);
      c.setLineDash([]);
    }
    c.restore();

    c.fillStyle = skin.ruler;
    c.fillRect(0, 0, W, RULER_H);
    c.fillStyle = skin.lane;
    c.fillRect(0, RULER_H, W, CHORD_H);
    c.save();
    c.beginPath();
    c.rect(KEYS_W, 0, W - KEYS_W, top);
    c.clip();
    const labels: [number, number][] = [];
    this.sectionBoxes = [];
    for (const section of roll.sectionSpans(model, sheet.bars.length)) {
      const startBar = sheet.bars[section.bar];
      const endBar = sheet.bars[section.bar + section.bars - 1];
      if (!startBar || !endBar) continue;
      const left = this.x(startBar.start);
      const right = this.x(endBar.start + endBar.length);
      if (right < KEYS_W || left > W) continue;
      c.fillStyle = sectionColor(section.name);
      c.globalAlpha = 0.85;
      c.fillRect(left + 1, 1, right - left - 2, SECTION_H - 2);
      c.globalAlpha = 1;
      if (left >= KEYS_W) {
        const held = drag?.mode === 'section' && (drag.bar ?? drag.from) === section.bar;
        c.fillStyle = held ? skin.playhead : skin.sectionEdge;
        c.fillRect(Math.round(left), 0, 2, SECTION_H);
      }
      c.fillStyle = '#fff';
      const labelX = Math.max(left, KEYS_W) + 6;
      c.fillText(section.name, labelX, 12);
      const labelW = c.measureText(section.name).width + 4;
      labels.push([labelX, labelX + labelW]);
      this.sectionBoxes.push({ bar: section.bar, name: section.name, from: labelX - 2, to: labelX + labelW });
    }
    const every = 28 / (px * (sheet.bars[0]?.length || 1)) > 1 ? 4 : 1;
    for (let index = roll.barAt(sheet, Math.max(0, Math.floor(first))); index < sheet.bars.length; index++) {
      const bar = sheet.bars[index];
      if (bar.start > lastTick) break;
      c.fillStyle = skin.rulerTick;
      c.fillRect(Math.round(this.x(bar.start)), SECTION_H + 1, 1, RULER_H - SECTION_H - 1);
      if (index % every === 0) {
        c.fillStyle = skin.rulerText;
        c.fillText(String(index + 1), this.x(bar.start) + 4, RULER_H - 6);
      }
    }
    c.font = '11px system-ui, sans-serif';
    c.lineWidth = 1;
    const picks = this.shownPicks();
    for (const chip of this.chordChips(c, model)) {
      const chord = chip.chord;
      if (chip.left > W || chip.left + chip.width < KEYS_W) continue;
      const picked = this.chordsPickable() && picks.has(chord.start);
      const chipX = Math.round(chip.left) + 0.5;
      this.box2(c, chipX, RULER_H + 4.5, chip.width, CHORD_H - 9, picked ? skin.picked : skin.chip, picked ? skin.pickedEdge : skin.chipEdge);
      if (chip.width < 12) continue;
      c.save();
      c.beginPath();
      c.rect(chipX, RULER_H, chip.width - 2, CHORD_H);
      c.clip();
      c.fillStyle = picked ? skin.pickedText : skin.chipText;
      c.fillText(chord.name, chip.left + 5, RULER_H + CHORD_H - 8);
      c.restore();
    }
    c.font = '10px system-ui, sans-serif';
    if (cutX !== null && cutX >= KEYS_W && cutX <= W && this.limit) {
      this.dashedLine(c, skin, cutX, 0, top);
      const chip = this.say(this.limit.auto ? 'scoreLimitChipAuto' : 'scoreLimitChip', { time: roll.clock(this.limit.seconds) });
      const chipW = c.measureText(chip).width + 10;
      const onRight = Math.round(cutX + 3) + 0.5;
      const onLeft = Math.round(cutX - 3 - chipW) + 0.5;
      const covers = (from: number) => labels.some(([a, b]) => a < from + chipW && b > from);
      const chipX = onRight + chipW > W || (covers(onRight) && !covers(onLeft) && onLeft >= KEYS_W) ? onLeft : onRight;
      this.box2(c, chipX, 1.5, chipW, 14, skin.limitChip, skin.limit);
      c.fillStyle = skin.limitText;
      c.fillText(chip, chipX + 5, 12);
    }
    if (markerShown) {
      const head = SECTION_H + 1;
      c.fillStyle = skin.playhead;
      c.beginPath();
      c.moveTo(markerX - 5, head);
      c.lineTo(markerX + 5, head);
      c.lineTo(markerX, head + 7);
      c.closePath();
      c.fill();
      c.fillRect(markerX - 0.5, head + 7, 1, top - head - 7);
    }
    c.restore();

    c.fillStyle = skin.ruler;
    c.fillRect(0, 0, KEYS_W, top);
    c.fillStyle = skin.laneText;
    c.fillText(this.say('scoreLaneSection'), 6, 12);
    c.fillText(this.say('scoreLaneBar'), 6, RULER_H - 6);
    c.fillText(this.say('scoreLaneChord'), 6, RULER_H + CHORD_H - 8);
    c.save();
    c.beginPath();
    c.rect(0, top, KEYS_W, H - top);
    c.clip();
    this.drawKeys(c, skin, top, rows);
    c.restore();
    c.fillStyle = skin.keysEdge;
    c.fillRect(KEYS_W - 1, 0, 1, H);
  }

  private drawKeys(c: CanvasRenderingContext2D, skin: Skin, top: number, rows: number): void {
    if (this.drumRows()) {
      c.fillStyle = skin.keyWhite;
      c.fillRect(0, top, KEYS_W, rows * ROW_H);
      c.font = '9px system-ui, sans-serif';
      for (let r = 0; r < rows; r++) {
        const pitch = this.pitchTop - r;
        const rowY = top + r * ROW_H;
        if (pitch === this.hoverPitch) {
          c.fillStyle = skin.keyUnder;
          c.fillRect(0, rowY + 1, KEYS_W, ROW_H - 2);
        }
        c.fillStyle = skin.keyEdge;
        c.fillRect(0, rowY + ROW_H - 1, KEYS_W, 1);
        c.fillStyle = ((pitch % 12) + 12) % 12 === 0 ? skin.keyTextC : skin.keyText;
        c.fillText(drumName(pitch), 4, rowY + ROW_H - 3);
      }
      return;
    }
    const blackW = Math.round(KEYS_W * 0.6);
    c.fillStyle = skin.keyWhite;
    c.fillRect(0, top, KEYS_W, rows * ROW_H);
    for (let r = 0; r < rows; r++) {
      const pitch = this.pitchTop - r;
      const rowY = top + r * ROW_H;
      const tone = ((pitch % 12) + 12) % 12;
      const black = roll.isBlack(pitch);
      const under = pitch === this.hoverPitch;
      if (black) {
        c.fillStyle = skin.keyEdge;
        c.fillRect(blackW, rowY + ROW_H / 2, KEYS_W - blackW, 1);
        c.fillStyle = under ? skin.keyBlackUnder : skin.keyBlack;
        c.fillRect(0, rowY + 1, blackW, ROW_H - 2);
        c.fillStyle = skin.keyBlackTop;
        c.fillRect(blackW - 4, rowY + 3, 2, ROW_H - 6);
      } else {
        if (under) {
          c.fillStyle = skin.keyUnder;
          c.fillRect(0, rowY + 1, KEYS_W, ROW_H - 2);
        }
        if (tone === 0 || tone === 5) {
          c.fillStyle = skin.keyEdge;
          c.fillRect(0, rowY + ROW_H - 1, KEYS_W, 1);
        }
      }
      if (tone !== 0 && !under) continue;
      c.font = (tone === 0 ? '600 ' : '') + '10px system-ui, sans-serif';
      c.fillStyle = black ? skin.keyBlackText : tone === 0 ? skin.keyTextC : skin.keyText;
      c.fillText(roll.noteName(pitch), black ? 5 : KEYS_W - 24, rowY + ROW_H - 3);
    }
  }

  private drawPart(c: CanvasRenderingContext2D, skin: Skin, model: Model, part: Part, ghost: boolean, first: number, lastTick: number): void {
    const sheet = this.sheet as Sheet;
    const px = this.pxPerTick;
    const top = RULER_H + CHORD_H;
    const blue = this.both && part === 'Ins';
    const fill = blue ? skin.insNote : skin.note;
    const edge = blue ? skin.insEdge : skin.noteEdge;
    const text = blue ? skin.insText : skin.noteText;
    c.save();
    c.font = '600 9px system-ui, sans-serif';
    c.lineWidth = 1;
    for (const note of model.notes[part]) {
      if (note.start + note.length < first || note.start > lastTick) continue;
      const noteY = this.y(note.pitch);
      if (noteY + ROW_H < top || noteY > this.height) continue;
      const noteX = Math.round(this.x(note.start)) + 0.5;
      const width = Math.max(3, Math.round(note.length * px) - 1);
      if (ghost) {
        this.box2(c, noteX, noteY + 1.5, width, ROW_H - 3, skin.ghost, skin.ghostEdge);
        continue;
      }
      const picked = this.selection.has(note.id);
      this.box2(c, noteX, noteY + 1.5, width, ROW_H - 3, picked ? skin.picked : fill, picked ? skin.pickedEdge : edge);
      if (width > 5) {
        c.fillStyle = skin.shine;
        c.fillRect(noteX + 1.5, noteY + 2, width - 4, 1);
      }
      const bar = sheet.bars[roll.barAt(sheet, note.start)];
      const label = part === 'Ins' && this.soundOf('Ins') === DRUMS ? drumName(note.pitch) : roll.noteName(note.pitch, roll.flatsIn(sheet, bar.key));
      if (c.measureText(label).width + 6 <= width) {
        c.fillStyle = picked ? skin.pickedText : text;
        c.fillText(label, noteX + 3, noteY + ROW_H - 4);
      }
    }
    c.restore();
  }

  private chordChips(c: CanvasRenderingContext2D, model: Model) {
    c.font = '11px system-ui, sans-serif';
    return roll.chordSpans(model, (this.sheet as Sheet).total).map(span => {
      const left = this.x(span.start);
      const room = this.x(span.end) - left - 2;
      const width = Math.max(4, Math.min(c.measureText(span.name).width + 10, room));
      return { chord: span, left, width };
    });
  }

  private drawChords(c: CanvasRenderingContext2D, skin: Skin, model: Model, first: number, lastTick: number): void {
    const sheet = this.sheet as Sheet;
    const top = RULER_H + CHORD_H;
    const drag = this.drag;
    const picks = this.shownPicks();
    c.save();
    c.font = '600 9px system-ui, sans-serif';
    c.lineWidth = 1;
    for (const span of roll.chordSpans(model, sheet.total)) {
      if (span.end < first || span.start > lastTick) continue;
      const toned = drag?.mode === 'tone' && drag.start === span.start ? drag : null;
      const pitches = toned ? toned.pitches : roll.chordPitches(span.name);
      const root = toned ? null : roll.rootPitch(span.name);
      const picked = picks.has(span.start);
      const refused = Boolean(toned && !toned.named);
      const noteX = Math.round(this.x(span.start)) + 0.5;
      const width = Math.max(3, Math.round((span.end - span.start) * this.pxPerTick) - 1);
      const bar = sheet.bars[roll.barAt(sheet, span.start)];
      for (const pitch of pitches) {
        const noteY = this.y(pitch);
        if (noteY + ROW_H < top || noteY > this.height) continue;
        const fill = refused ? skin.refused : picked ? skin.picked : pitch === root ? skin.chordRoot : skin.chordNote;
        const edge = refused ? skin.refusedEdge : picked ? skin.pickedEdge : skin.chordEdge;
        this.box2(c, noteX, noteY + 1.5, width, ROW_H - 3, fill, edge);
        const label = pitch === root ? span.name : toned && pitch === toned.toPitch ? toned.named || '?' : roll.noteName(pitch, roll.flatsIn(sheet, bar.key));
        if (c.measureText(label).width + 6 <= width) {
          c.fillStyle = picked ? skin.pickedText : skin.chordText;
          c.fillText(label, noteX + 3, noteY + ROW_H - 4);
        }
      }
    }
    c.restore();
  }

  private box2(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, edge: string): void {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, NOTE_RADIUS);
    else c.rect(x, y, w, h);
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = edge;
    c.stroke();
  }

  private dashedLine(c: CanvasRenderingContext2D, skin: Skin, x: number, from: number, to: number): void {
    c.save();
    c.strokeStyle = skin.limit;
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    c.beginPath();
    c.moveTo(Math.round(x), from);
    c.lineTo(Math.round(x), to);
    c.stroke();
    c.restore();
  }

  // ---- the pointer ----

  private local(event: { clientX: number; clientY: number }) {
    const rect = (this.canvas as HTMLCanvasElement).getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top };
  }

  private hitNote(px: number, py: number) {
    const model = this.model as Model;
    const pitch = this.pitchAt(py);
    const tick = this.tickAt(px);
    for (const part of this.editedParts()) {
      const found = model.notes[part].find(note => note.pitch === pitch && note.start <= tick && tick < note.start + note.length + EDGE_PX / this.pxPerTick);
      if (found) return found;
    }
    return null;
  }

  private barLocked(tick: number): boolean {
    const sheet = this.sheet as Sheet;
    const index = roll.barAt(sheet, Math.max(0, Math.floor(tick)));
    const bar = sheet.bars[index];
    if (bar && !bar.editable) {
      this.setStatus(this.say('scoreBarLocked', { bar: index + 1 }), true);
      return true;
    }
    return false;
  }

  private blip(pitch: number, part: SoundPart = this.part): void {
    try {
      this.player.blip(pitch, part);
    } catch (error) {
      this.setStatus(this.say('scoreNoSound', { error: error instanceof Error ? error.message : String(error) }), true);
    }
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.sheet || !this.model || !this.canvas) return;
    this.box?.focus();
    const keys = roll.modifiersOf(event);
    const { px, py } = this.local(event);
    const top = RULER_H + CHORD_H;
    const tick = this.tickAt(px);
    const at = now();
    const again = event.button === 0 && !keys.alt && !keys.ctrl && !keys.shift && roll.isDoubleClick(this.lastDown, at, px, py);
    this.lastDown = { at, px, py };
    if (px < KEYS_W) {
      if (py >= top) this.blip(this.pitchAt(py));
      return;
    }
    if (py < SECTION_H) {
      this.sectionDown(event, px, tick);
      return;
    }
    if (py < RULER_H) {
      if (again) this.togglePlay();
      else this.movePlayhead(tick);
      return;
    }
    if (py < top) {
      if (event.button === 2) this.dropChord(px);
      else if (this.both) this.pickChord(px, keys);
      else this.chordAt(tick, px);
      return;
    }
    if (this.chordPart) {
      this.chordDown(event, px, py, tick, keys, again);
      return;
    }
    if (again) {
      this.takeBackDraw();
      this.togglePlay();
      return;
    }
    const pitch = this.pitchAt(py);
    const hit = this.hitNote(px, py);
    if (hit) {
      if (event.button === 2) {
        const all = this.selection.has(hit.id);
        const ids = all ? [...this.selection] : [hit.id];
        const starts = all && this.both ? [...this.chordPicks] : [];
        this.clearPicks();
        this.commit(this.both ? roll.deleteTogether(this.model, ids, starts) : roll.deleteNotes(this.model, this.part, ids));
        return;
      }
      const edge = !this.both && this.x(hit.start + hit.length) - px <= EDGE_PX;
      if ((keys.shift || keys.ctrl) && !edge) {
        if (this.selection.has(hit.id)) this.selection.delete(hit.id);
        else this.selection.add(hit.id);
        this.draw();
        return;
      }
      if (this.barLocked(hit.start)) return;
      if (!this.selection.has(hit.id)) {
        this.selection = new Set([hit.id]);
        this.chordPicks.clear();
      }
      this.canvas.setPointerCapture(event.pointerId);
      this.blip(hit.pitch, roll.partOf(this.model, hit.id) || this.part);
      this.drag = edge
        ? { mode: 'resize', id: hit.id, from: this.model, start: hit.start, length: hit.length }
        : { mode: 'move', ids: [...this.selection], chords: this.pickedChords(), from: this.model, base: this.model, tick, pitch, sounded: hit.pitch, ticks: 0 };
      this.draw();
      return;
    }
    if (event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    if (keys.shift || keys.ctrl || this.both) {
      if (!keys.shift && !keys.ctrl) this.clearPicks();
      this.drag = { mode: 'box', tick, pitch, toTick: tick, toPitch: pitch, kept: new Set(this.selection), keptChords: new Set(this.chordPicks) };
      this.draw();
      return;
    }
    if (this.barLocked(tick)) return;
    const start = keys.alt ? Math.floor(tick) : roll.snapDown(tick, this.snap);
    const under = this.model.notes[this.part].find(note => note.start <= start && start < note.start + note.length);
    if (under) {
      this.offerChord(under, start, pitch);
      return;
    }
    const room = roll.roomAt(this.model, this.part, start, this.sheet.total);
    const placed = room ? roll.addNote(this.model, this.part, start, Math.min(this.lastLength || this.snap, room), pitch, this.sheet.total) : null;
    if (!placed) {
      this.setStatus(this.say('scoreSongEnds'), true);
      return;
    }
    this.selection = new Set([placed.id]);
    this.blip(pitch);
    this.working = placed.model;
    this.drag = { mode: 'move', drawn: true, ids: [placed.id], chords: [], from: this.model, base: placed.model, tick: start, pitch, sounded: pitch, ticks: 0 };
    this.draw();
  }

  private takeBackDraw(): void {
    if (!this.drawn || now() - this.drawn.at > roll.DOUBLE_CLICK_MS || !this.sheet) return;
    const redo = this.drawn.redo;
    this.drawn = null;
    const before = this.history.take(redo);
    if (!before || 'keyed' in before) return;
    this.notice = null;
    this.model = before;
    this.clearPicks();
    this.localChanged = roll.changedBars(this.sheet, this.model);
    this.draw();
    this.scheduleWrite();
  }

  private hitChord(px: number, py: number) {
    const model = this.model as Model;
    const pitch = this.pitchAt(py);
    const tick = this.tickAt(px);
    const total = (this.sheet as Sheet).total;
    const reach = EDGE_PX / this.pxPerTick;
    for (const span of roll.chordSpans(model, total)) {
      if (tick < span.start || tick >= span.end + (span.end < total ? reach : 0)) continue;
      const pitches = roll.chordPitches(span.name);
      if (!pitches.includes(pitch)) continue;
      const edge = span.end < total && Math.abs(this.x(span.end) - px) <= EDGE_PX;
      return { span, pitch, pitches, root: pitch === roll.rootPitch(span.name), edge };
    }
    return null;
  }

  private blipChord(pitches: number[]): void {
    for (const pitch of pitches) this.blip(pitch, 'chords');
  }

  private shownPicks(): Set<number> {
    const drag = this.drag;
    if (!drag || !this.working || (drag.mode !== 'move' && drag.mode !== 'chord')) return this.chordPicks;
    const starts = drag.mode === 'chord' ? drag.starts : [...this.chordPicks];
    return new Set(starts.map(start => start + (drag.ticks || 0)));
  }

  private chordDown(event: PointerEvent, px: number, py: number, tick: number, keys: { alt: boolean; ctrl: boolean; shift: boolean }, again: boolean): void {
    const sheet = this.sheet as Sheet;
    const model = this.model as Model;
    const canvas = this.canvas as HTMLCanvasElement;
    const hit = this.hitChord(px, py);
    if (event.button === 2) {
      if (hit) this.removeChordAt(hit.span);
      else this.setStatus(this.say('scoreRightClickChord'));
      return;
    }
    if (again) {
      if (this.drawn && now() - this.drawn.at <= roll.DOUBLE_CLICK_MS) {
        this.takeBackDraw();
        this.togglePlay();
      } else if (hit) {
        this.openChordInput(hit.span.start, hit.span.name);
      } else {
        this.togglePlay();
      }
      return;
    }
    if (event.button !== 0) return;
    const pitch = this.pitchAt(py);
    if (keys.ctrl && !keys.shift) {
      this.toggleTone(tick, pitch);
      return;
    }
    if (keys.shift || keys.ctrl) {
      if (hit) {
        if (this.chordPicks.has(hit.span.start)) this.chordPicks.delete(hit.span.start);
        else this.chordPicks.add(hit.span.start);
        this.draw();
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      this.drag = { mode: 'box', tick, pitch, toTick: tick, toPitch: pitch, kept: new Set(), keptChords: new Set(this.chordPicks) };
      this.draw();
      return;
    }
    if (hit) {
      if (this.barLocked(hit.span.start)) return;
      const many = hit.root && !hit.edge && this.chordPicks.has(hit.span.start) && this.chordPicks.size > 1;
      if (!many) this.chordPicks = new Set([hit.span.start]);
      canvas.setPointerCapture(event.pointerId);
      this.blipChord(hit.pitches);
      if (hit.edge) {
        this.drag = { mode: 'edge', from: model, start: hit.span.end, to: hit.span.end };
      } else if (hit.root) {
        this.drag = { mode: 'chord', from: model, base: model, start: hit.span.start, starts: many ? this.pickedChords() : [hit.span.start], tick, pitch, ticks: 0, semitones: 0 };
      } else {
        this.drag = { mode: 'tone', from: model, start: hit.span.start, name: hit.span.name, index: hit.pitches.indexOf(hit.pitch), pitch: hit.pitch, toPitch: hit.pitch, pitches: hit.pitches, named: hit.span.name };
      }
      this.draw();
      return;
    }
    const start = keys.alt ? Math.floor(tick) : roll.snapDown(tick, this.snap);
    if (start < 0 || start >= sheet.total) {
      this.setStatus(this.say('scoreSongEnds'), true);
      return;
    }
    if (this.barLocked(start)) return;
    const name = roll.chordByDegree(pitch, roll.keyAt(sheet, start));
    const placed = roll.setChord(model, start, name);
    if (!placed) return;
    this.chordPicks = new Set([start]);
    this.blipChord(roll.chordPitches(name));
    canvas.setPointerCapture(event.pointerId);
    this.working = placed;
    this.drag = { mode: 'chord', drawn: true, from: model, base: placed, start, starts: [start], tick: start, pitch, ticks: 0, semitones: 0 };
    this.draw();
  }

  private chordDragged(event: PointerEvent, tick: number, pitch: number): void {
    const drag = this.drag;
    const sheet = this.sheet as Sheet;
    const total = sheet.total;
    const alt = roll.modifiersOf(event).alt;
    const step = alt ? 1 : this.snap;
    if (drag?.mode === 'chord') {
      let ticks = alt ? Math.round(tick - drag.tick) : roll.snapTo(tick - drag.tick, this.snap);
      const semitones = pitch - drag.pitch;
      let moved: Model | null;
      if (drag.starts.length > 1) {
        moved = roll.moveChords(drag.base, sheet, drag.starts, ticks, semitones);
      } else {
        const room = roll.chordRoom(drag.base, drag.start, total);
        if (!room) return;
        const low = drag.start - Math.floor((drag.start - room.low) / step) * step;
        const high = drag.start + Math.floor((room.high - drag.start) / step) * step;
        ticks = clamp(drag.start + ticks, low, high) - drag.start;
        moved = drag.drawn
          ? roll.setChord(drag.from, drag.start + ticks, roll.chordByDegree(pitch, roll.keyAt(sheet, drag.start + ticks)))
          : roll.moveChord(drag.base, sheet, drag.start, ticks, semitones);
      }
      if (!moved) return;
      this.working = moved;
      drag.ticks = ticks;
      if (semitones !== drag.semitones) {
        drag.semitones = semitones;
        const lead = moved.chords.find(chord => chord.start === drag.start + ticks);
        if (lead) this.blipChord(roll.chordPitches(lead.name));
      }
    } else if (drag?.mode === 'edge') {
      const room = roll.chordRoom(drag.from, drag.start, total);
      if (!room) return;
      const low = Math.ceil(room.low / step) * step;
      const high = Math.floor(room.high / step) * step;
      const at = alt ? Math.round(tick) : roll.snapTo(tick, this.snap);
      const to = low <= high ? clamp(at, low, high) : clamp(Math.round(tick), room.low, room.high);
      const moved = roll.moveChord(drag.from, sheet, drag.start, to - drag.start, 0);
      if (!moved) return;
      this.working = moved;
      drag.to = to;
    } else if (drag?.mode === 'tone') {
      if (pitch === drag.toPitch || pitch < roll.LOWEST || pitch > roll.HIGHEST) return;
      const pitches = drag.pitches.slice();
      pitches[drag.index] = pitch;
      drag.pitches = pitches;
      drag.toPitch = pitch;
      drag.named = roll.namedChord(pitches, roll.keyAt(sheet, drag.start));
      this.working = drag.named ? roll.setChord(drag.from, drag.start, drag.named) : drag.from;
      this.blipChord(pitches);
    }
  }

  private chordReleased(drag: Drag, result: Model | null): void {
    if (drag.mode === 'tone') {
      if (drag.toPitch === drag.pitch) {
        this.draw();
      } else if (!drag.named) {
        this.setStatus(this.refusal(drag.pitches, drag.name), true);
        this.draw();
      } else if (drag.named === drag.name) {
        this.setStatus(this.say('scoreStillChord', { notes: this.toneNames(drag.pitches), name: drag.name }));
        this.draw();
      } else {
        this.commitChords(result, drag.from, this.say('scoreMadeOf', { notes: this.toneNames(drag.pitches), name: drag.named }));
      }
      return;
    }
    if (drag.mode !== 'chord' && drag.mode !== 'edge') return;
    if (!result || result === drag.from) {
      this.draw();
      return;
    }
    const kept = this.commitChords(result, drag.from);
    if (kept && drag.mode === 'chord' && drag.drawn) this.drawn = { at: now(), redo: this.dropped };
    if (kept && drag.mode === 'chord') {
      this.chordPicks = new Set(drag.starts.map(start => start + (drag.ticks || 0)));
      this.draw();
    }
  }

  private toneNames(pitches: number[]): string {
    const sheet = this.sheet as Sheet;
    const flats = roll.flatsIn(sheet, sheet.bars[0]?.key);
    const names = [...new Set(pitches)].sort((a, b) => a - b).map(pitch => roll.noteName(pitch, flats));
    return names.length > 1 ? names.slice(0, -1).join(', ') + this.say('scoreAnd') + names[names.length - 1] : names.join('');
  }

  private refusal(pitches: number[], name: string): string {
    return this.say('scoreNoChordName', { notes: this.toneNames(pitches), name }) + ' ' + this.say('scoreKindsHelp');
  }

  private toggleTone(tick: number, pitch: number): void {
    const sheet = this.sheet as Sheet;
    const model = this.model as Model;
    const span = roll.chordSpans(model, sheet.total).find(one => one.start <= tick && tick < one.end);
    if (!span) {
      this.setStatus(this.say('scoreNoChordHere'), true);
      return;
    }
    if (this.barLocked(span.start)) return;
    const layout = roll.chordPitches(span.name);
    const pitches = layout.includes(pitch) ? layout.filter(one => one !== pitch) : [...layout, pitch];
    const named = roll.namedChord(pitches, roll.keyAt(sheet, span.start));
    this.chordPicks = new Set([span.start]);
    if (!named) {
      this.setStatus(this.refusal(pitches, span.name), true);
      this.draw();
      return;
    }
    this.blipChord(pitches);
    if (named === span.name) {
      this.setStatus(this.say('scoreStillChord', { notes: this.toneNames(pitches), name: span.name }));
      this.draw();
      return;
    }
    this.commitChords(roll.setChord(model, span.start, named), model, this.say('scoreMadeOf', { notes: this.toneNames(pitches), name: named }));
  }

  private removeChordAt(span: { start: number; name: string }): void {
    if (this.barLocked(span.start) || !this.model || !this.sheet) return;
    this.chordPicks.delete(span.start);
    this.closeField(this.chordInput);
    this.commitChords(roll.removeChord(this.model, span.start), this.model, this.say('scoreChordGone', { name: span.name, bar: roll.barAt(this.sheet, span.start) + 1 }));
  }

  private shiftChords(starts: number[], ticks: number, semitones: number): void {
    const sheet = this.sheet as Sheet;
    if (!ticks && semitones % 12 === 0) {
      this.setStatus(this.say('scoreNoOctave'));
      return;
    }
    const moved = roll.moveChords(this.model as Model, sheet, starts, ticks, semitones);
    if (!moved) {
      this.setStatus(this.say('scoreChordsDoNotFit'), true);
      return;
    }
    if (!this.commitChords(moved)) return;
    this.chordPicks = new Set(starts.map(start => start + ticks));
    this.draw();
    const lead = moved.chords.find(chord => chord.start === starts[0] + ticks);
    if (lead && semitones) this.blipChord(roll.chordPitches(lead.name));
  }

  private commitChords(next: Model | null, previous: Model | null = this.model, said = ''): boolean {
    let mirrored: ReturnType<typeof roll.mirrorChords> | null = null;
    if (next && previous && next !== previous && this.chordPart && this.repeats && this.sheet) {
      mirrored = roll.mirrorChords(this.sheet, previous, next);
      next = mirrored.model;
    }
    const kept = this.commit(next, previous);
    const told = [said, kept && mirrored ? this.mirrorWords(mirrored) : ''].filter(Boolean).join(' ');
    if (kept && told) {
      this.notice = told;
      this.showDescription();
    }
    return kept;
  }

  private mirrorWords(mirrored: ReturnType<typeof roll.mirrorChords>): string {
    const where = (list: { bar: number; bars: number; name: string }[]) =>
      list.map(span => this.barList(Array.from({ length: span.bars }, (_, index) => span.bar + index)) + ' (' + span.name + ')').join(', ');
    const pieces: string[] = [];
    if (mirrored.done.length) pieces.push(this.say('scoreMirroredDone', { places: where(mirrored.done) }));
    if (mirrored.skipped.length) pieces.push(this.say('scoreMirroredSkipped', { places: where(mirrored.skipped) }));
    return pieces.join(' ');
  }

  private movePlayhead(tick: number): void {
    const sheet = this.sheet as Sheet;
    const at = clamp(roll.snapDown(tick, this.snap), 0, sheet.total);
    const wasPlaying = this.player.playing;
    this.stopPlaying();
    this.playhead = at;
    if (wasPlaying) this.startPlaying();
    this.draw();
  }

  private sectionEdgeAt(px: number) {
    const sheet = this.sheet as Sheet;
    return (this.model as Model).sections.find(section => {
      const bar = sheet.bars[section.bar];
      const left = bar ? this.x(bar.start) : null;
      return left !== null && left >= KEYS_W && Math.abs(left - px) <= EDGE_PX;
    }) || null;
  }

  private sectionDown(event: PointerEvent, px: number, tick: number): void {
    if (event.button === 2) {
      this.movePlayhead(tick);
      return;
    }
    if (event.button !== 0) return;
    const sheet = this.sheet as Sheet;
    const edge = this.sectionEdgeAt(px);
    if (edge) {
      this.canvas?.setPointerCapture(event.pointerId);
      this.drag = { mode: 'section', from: edge.bar, base: this.model as Model };
      this.draw();
      return;
    }
    const named = this.sectionBoxes.find(box => px >= box.from && px <= box.to);
    if (named) {
      this.openSectionInput(named.bar, named.name);
      return;
    }
    const bar = roll.barAt(sheet, clamp(Math.floor(tick), 0, sheet.total - 1));
    const here = roll.sectionStarting(this.model as Model, bar);
    this.openSectionInput(bar, here ? here.name : '');
  }

  private field(value: string, placeholder: string, list: string, left: number, top: number, check: (text: string) => boolean, finish: (text: string) => boolean): Field {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = INPUT_CLASS;
    input.style.width = CHORD_BOX_W + 'px';
    input.style.left = clamp(left, KEYS_W, Math.max(KEYS_W, this.width - CHORD_BOX_W - 10)) + 'px';
    input.style.top = top + 'px';
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.setAttribute('list', list);
    const entry: Field = {
      input,
      done: false,
      finish: keep => {
        if (entry.done) return true;
        if (keep && !check(input.value.trim())) {
          input.classList.add(INPUT_BAD);
          return false;
        }
        this.closeField(entry);
        if (keep) finish(input.value.trim());
        this.showDescription();
        return true;
      },
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeField(entry);
        this.showDescription();
        this.box?.focus();
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (entry.finish(true)) this.box?.focus();
    });
    input.addEventListener('input', () => input.classList.toggle(INPUT_BAD, Boolean(input.value.trim()) && !check(input.value.trim())));
    input.addEventListener('blur', () => {
      if (!entry.finish(true)) this.closeField(entry);
    });
    this.box?.appendChild(input);
    input.focus();
    input.select();
    return entry;
  }

  private closeField(entry: Field | null): void {
    if (!entry) return;
    entry.done = true;
    if (this.chordInput === entry) this.chordInput = null;
    if (this.sectionInput === entry) this.sectionInput = null;
    entry.input.remove();
  }

  private openSectionInput(bar: number, name: string): void {
    this.closeField(this.chordInput);
    this.closeField(this.sectionInput);
    const sheet = this.sheet as Sheet;
    const at = sheet.bars[bar];
    const check = (text: string) => {
      const ok = !text || Boolean(roll.sectionName(text));
      if (!ok) this.setStatus(this.say('scoreSectionHelp', { longest: roll.SECTION_LONGEST }), true);
      return ok;
    };
    this.sectionInput = this.field(name, this.say(name ? 'scoreSectionPlaceholderRename' : 'scoreSectionPlaceholderNew'), 'score-sections', at ? this.x(at.start) : KEYS_W, 1, check, text => {
      const clean = roll.sectionName(text);
      if (!clean && name) this.commit(roll.removeSection(this.model as Model, bar));
      else if (clean && clean !== name) this.commit(roll.setSection(this.model as Model, bar, clean));
      return true;
    });
    this.setStatus(name ? this.say('scoreSectionRename') : this.say('scoreSectionNew', { bar: bar + 1 }));
  }

  private openChordInput(start: number, name: string): void {
    this.chordInput?.finish(true);
    this.closeField(this.chordInput);
    const check = (text: string) => {
      const ok = !text || text === name || roll.isChord(text);
      if (!ok) this.setStatus(this.say('scoreChordHelp'), true);
      return ok;
    };
    this.chordInput = this.field(name, this.say('scoreChordPlaceholder'), 'score-chords', this.x(start), RULER_H + 1, check, text => {
      if (!text && name) this.commitChords(roll.removeChord(this.model as Model, start));
      else if (text && text !== name) this.commitChords(roll.setChord(this.model as Model, start, text));
      return true;
    });
    this.setStatus(this.say('scoreChordInput'));
  }

  private hover(pitch: number | null): void {
    if (this.hoverPitch === pitch) return;
    this.hoverPitch = pitch;
    if (!this.drag) this.draw();
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.sheet || !this.model || !this.canvas) return;
    const { px, py } = this.local(event);
    this.hover(py > RULER_H + CHORD_H ? this.pitchAt(py) : null);
    const drag = this.drag;
    if (!drag) {
      const grid = py > RULER_H + CHORD_H && px > KEYS_W;
      const hit = grid && !this.chordPart ? this.hitNote(px, py) : null;
      const chord = grid && this.chordPart ? this.hitChord(px, py) : null;
      let cursor = 'crosshair';
      if (py < SECTION_H && px > KEYS_W) cursor = this.sectionEdgeAt(px) ? 'ew-resize' : 'pointer';
      else if (py <= RULER_H + CHORD_H) cursor = 'pointer';
      else if (chord) cursor = chord.edge ? 'ew-resize' : chord.root ? 'move' : 'ns-resize';
      else if (hit) cursor = !this.both && this.x(hit.start + hit.length) - px <= EDGE_PX ? 'ew-resize' : 'move';
      this.canvas.style.cursor = cursor;
      return;
    }
    const tick = this.tickAt(px);
    const pitch = this.pitchAt(py);
    const total = this.sheet.total;
    if (drag.mode === 'section') {
      const bar = roll.barAt(this.sheet, clamp(Math.floor(tick), 0, total - 1));
      const moved = roll.moveSection(drag.base, drag.from, bar);
      if (moved) {
        this.working = moved;
        drag.bar = bar;
      }
    } else if (drag.mode === 'box') {
      drag.toTick = tick;
      drag.toPitch = pitch;
      const inside = this.editedParts().flatMap(part => roll.notesIn(this.model as Model, part, drag.tick, tick, drag.pitch, pitch));
      this.selection = new Set([...drag.kept, ...inside]);
      if (this.chordsPickable()) this.chordPicks = new Set([...drag.keptChords, ...roll.chordsIn(this.model, drag.tick, tick)]);
    } else if (drag.mode === 'chord' || drag.mode === 'edge' || drag.mode === 'tone') {
      this.chordDragged(event, tick, pitch);
    } else if (drag.mode === 'move') {
      const ticks = roll.modifiersOf(event).alt ? Math.round(tick - drag.tick) : roll.snapTo(tick - drag.tick, this.snap);
      const semitones = pitch - drag.pitch;
      const moved = this.both
        ? roll.moveTogether(drag.base, drag.ids, drag.chords, ticks, semitones, total)
        : roll.moveNotes(drag.base, this.part, drag.ids, ticks, semitones, total);
      if (moved) {
        this.working = moved;
        drag.ticks = ticks;
        const lead = this.noteById(moved, drag.ids[0]);
        if (lead && lead.note.pitch !== drag.sounded) {
          drag.sounded = lead.note.pitch;
          this.blip(lead.note.pitch, lead.part);
        }
      }
    } else if (drag.mode === 'resize') {
      const end = roll.modifiersOf(event).alt ? Math.round(tick) : roll.snapTo(tick, this.snap);
      const stretched = roll.stretchNote(drag.from, this.part, drag.id, Math.max(1, end - drag.start), total);
      if (stretched) {
        this.working = stretched;
        this.lastLength = stretched.notes[this.part].find(note => note.id === drag.id)?.length || this.lastLength;
      }
    }
    this.draw();
  }

  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    try {
      this.canvas?.releasePointerCapture(event.pointerId);
    } catch {
      // the pointer was never captured
    }
    const result = this.working;
    this.drag = null;
    this.working = null;
    if (drag.mode === 'section') {
      if (result && result !== drag.base) {
        this.commit(result, drag.base);
        const moved = result.sections.find(section => section.bar === drag.bar);
        this.notice = moved ? this.say('scoreSectionMoved', { name: moved.name, bar: moved.bar + 1 }) : null;
        this.showDescription();
        return;
      }
      this.draw();
      return;
    }
    if (drag.mode === 'chord' || drag.mode === 'edge' || drag.mode === 'tone') {
      this.chordReleased(drag, result);
      return;
    }
    if ((drag.mode === 'move' || drag.mode === 'resize') && result && result !== drag.from) {
      if (drag.mode === 'move') {
        const lead = this.noteById(result, drag.ids[0]);
        if (lead && !this.lastLength) this.lastLength = lead.note.length;
      }
      const kept = this.commit(result, drag.from);
      if (kept && drag.mode === 'move' && drag.drawn) this.drawn = { at: now(), redo: this.dropped };
      if (kept && drag.mode === 'move' && drag.chords.length) {
        this.chordPicks = new Set(drag.chords.map(start => start + drag.ticks));
        this.draw();
      }
      if (kept && drag.mode === 'move' && drag.sounded !== drag.pitch) this.warnVoice();
      return;
    }
    this.draw();
  }

  private cancelDrag(): void {
    this.drag = null;
    this.working = null;
    this.draw();
  }

  private wheel(event: WheelEvent): void {
    if (!this.sheet) return;
    event.preventDefault();
    const { px } = this.local(event);
    if (roll.modifiersOf(event).ctrl) {
      this.zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, px);
      return;
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) this.tick0 += (event.deltaX || event.deltaY) / this.pxPerTick;
    else this.pitchTop += event.deltaY > 0 ? -2 : 2;
    this.clampView();
    this.draw();
  }

  // ---- the keyboard ----

  /** A key pressed in the window; true when the roll took it. */
  key(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return false;
    const ctrl = roll.modifiersOf(event).ctrl;
    const letter = roll.shortcutLetter(event);
    if (ctrl && letter === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (ctrl && letter === 'y') {
      event.preventDefault();
      this.redo();
      return true;
    }
    if (event.code === 'Space' && tag !== 'BUTTON') {
      event.preventDefault();
      this.togglePlay();
      return true;
    }
    if (event.key === 'Home' && tag !== 'BUTTON') {
      event.preventDefault();
      this.toStart();
      return true;
    }
    if (this.tab !== 'roll' || !this.sheet || !this.model) return false;
    if (ctrl && letter === 'a') {
      event.preventDefault();
      this.selection = new Set(this.editedParts().flatMap(part => (this.model as Model).notes[part].map(note => note.id)));
      if (this.chordsPickable()) this.chordPicks = new Set(this.model.chords.map(chord => chord.start));
      this.draw();
      return true;
    }
    const clip: Record<string, 'copy' | 'cut' | 'paste' | 'duplicate'> = { c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', b: 'duplicate' };
    if (ctrl && !event.altKey && clip[letter]) {
      event.preventDefault();
      void this.clipAction(clip[letter]);
      return true;
    }
    const chords = this.pickedChords();
    if (!this.selection.size && !chords.length) return false;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const ids = [...this.selection];
      this.clearPicks();
      const next = this.chordsPickable() ? roll.deleteTogether(this.model, ids, chords) : roll.deleteNotes(this.model, this.part, ids);
      if (this.chordPart) this.commitChords(next);
      else this.commit(next);
      return true;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, event.shiftKey || ctrl ? 12 : 1], ArrowDown: [0, event.shiftKey || ctrl ? -12 : -1],
      ArrowLeft: [-this.snap, 0], ArrowRight: [this.snap, 0],
    };
    if (moves[event.key]) {
      event.preventDefault();
      this.shiftPicked(...moves[event.key]);
      return true;
    }
    return false;
  }

  /** Escape, from the inside out: a field, a drag, the selection; false when there was nothing left to close. */
  escapeInside(): boolean {
    if (this.chordInput || this.sectionInput) {
      this.closeField(this.chordInput);
      this.closeField(this.sectionInput);
      this.showDescription();
      this.box?.focus();
      return true;
    }
    if (this.drag) {
      this.cancelDrag();
      return true;
    }
    if ((this.selection.size || this.chordPicks.size) && this.tab === 'roll') {
      this.clearPicks();
      this.draw();
      return true;
    }
    return false;
  }

  // ---- copy and paste ----

  async clipAction(id: 'copy' | 'cut' | 'paste' | 'duplicate'): Promise<void> {
    if (!this.sheet || !this.model || this.keyBusy) return;
    if (id === 'paste') await this.pasteCopy();
    else if (id === 'duplicate') await this.duplicatePicked();
    else this.copyPicked(id === 'cut');
    this.box?.focus();
  }

  private pickedClip(): Clip | null {
    const model = this.model as Model;
    const ids = this.chordPart ? [] : this.both ? [...this.selection] : [...this.selection].filter(id => roll.partOf(model, id) === this.part);
    const clip = roll.clipOf(model, this.sheet as Sheet, ids, this.pickedChords());
    if (!clip) this.setStatus(this.say(this.chordPart ? 'scoreSelectChords' : 'scoreSelectNotes'), true);
    return clip;
  }

  private clipWords(notes: number, chords: number): string {
    const words: string[] = [];
    if (notes) words.push(this.host.count('scoreNotes', notes));
    if (chords) words.push(this.host.count('scoreChords', chords));
    return words.join(this.say('scoreAnd'));
  }

  private copyPicked(cut: boolean): void {
    const clip = this.pickedClip();
    if (!clip) return;
    shared = clip;
    const sheet = this.sheet as Sheet;
    const first = roll.barAt(sheet, clip.origin);
    const last = roll.barAt(sheet, clip.origin + clip.span - 1);
    const notes = Object.values(clip.notes).reduce((sum, list) => sum + list.length, 0);
    const said = this.say(cut ? 'scoreCutDone' : 'scoreCopied', { what: this.clipWords(notes, clip.chords.length), bars: this.barList(Array.from({ length: last - first + 1 }, (_, index) => first + index)) });
    if (!cut) {
      this.setStatus(said);
      this.draw();
      return;
    }
    const model = this.model as Model;
    const ids = [...this.selection];
    const chords = this.pickedChords();
    this.clearPicks();
    const next = this.chordsPickable() ? roll.deleteTogether(model, ids, chords) : roll.deleteNotes(model, this.part, ids);
    if (this.chordPart) {
      this.commitChords(next, model, said);
    } else if (this.commit(next)) {
      this.notice = said;
      this.showDescription();
    }
  }

  private async pasteCopy(): Promise<void> {
    if (!shared) {
      this.setStatus(this.say('scoreNothingCopied'), true);
      return;
    }
    const sheet = this.sheet as Sheet;
    const at = this.playhead >= sheet.total ? sheet.total : sheet.bars[roll.barAt(sheet, this.playhead)].start;
    await this.placeClip(shared, at, 'scorePasted');
  }

  private async duplicatePicked(): Promise<void> {
    const clip = this.pickedClip();
    if (clip) await this.placeClip(clip, clip.origin + clip.span, 'scoreDuplicated');
  }

  private clipRoutes(clip: Clip): { routes: [Part, Part][]; withChords: boolean } {
    if (this.chordPart) return { routes: [], withChords: true };
    if (this.both) return { routes: roll.PARTS.map(part => [part, part] as [Part, Part]), withChords: true };
    const source = clip.notes[this.part].length ? this.part : roll.PARTS.find(part => clip.notes[part].length);
    return { routes: source ? [[source, this.part]] : [], withChords: false };
  }

  private async placeClip(clip: Clip, at: number, verb: string): Promise<void> {
    const { routes, withChords } = this.clipRoutes(clip);
    const reach = roll.clipReach(clip, routes, withChords);
    if (!reach) {
      this.setStatus(this.say(this.chordPart ? 'scoreCopyNoChords' : 'scoreCopyOnlyChords'), true);
      return;
    }
    let added = 0;
    const need = at + reach.to;
    if (need > (this.sheet as Sheet).total) {
      const sheet = this.sheet as Sheet;
      const last = sheet.bars[sheet.bars.length - 1];
      const count = Math.ceil((need - sheet.total) / Math.max(1, last.length));
      const perQuarter = sheet.per_quarter;
      await this.addBars(count);
      if (this.closed || !this.sheet) return;
      if (this.sheet.total < need || this.sheet.per_quarter !== perQuarter) {
        this.setStatus(this.say('scoreBarsNotAdded'), true);
        return;
      }
      added = count;
    }
    const sheet = this.sheet as Sheet;
    const model = this.model as Model;
    const first = roll.barAt(sheet, at + reach.from);
    const last = roll.barAt(sheet, at + reach.to - 1);
    const locked = sheet.bars.slice(first, last + 1).findIndex(bar => bar.editable === false);
    if (locked >= 0) {
      this.setStatus(this.say('scoreCopyLocked', { bar: first + locked + 1 }), true);
      return;
    }
    const pasted = roll.pasteClip(model, sheet, clip, at, routes, withChords);
    if (!pasted) {
      this.setStatus(this.say('scoreCopyDoesNotFit'), true);
      return;
    }
    const said = this.say(verb, { what: this.clipWords(pasted.ids.length, pasted.starts.length), bars: this.barList(Array.from({ length: last - first + 1 }, (_, index) => first + index)) })
      + (added ? ' ' + this.say('scoreBarsAddedForCopy', { bars: this.host.count('scoreBars', added) }) : '');
    const kept = this.chordPart ? this.commitChords(pasted.model, model, said) : this.commit(pasted.model);
    if (!kept) return;
    if (!this.chordPart) {
      this.notice = said;
      this.showDescription();
    }
    this.selection = new Set(pasted.ids);
    this.chordPicks = new Set(this.chordsPickable() ? pasted.starts : []);
    this.reveal(at + reach.from, at + reach.to);
    this.draw();
  }

  private reveal(from: number, to: number): void {
    const shown = this.visibleTicks();
    if (from >= this.tick0 && to <= this.tick0 + shown) return;
    this.tick0 = Math.max(0, from - shown * 0.1);
    this.clampView();
  }

  shiftPicked(ticks: number, semitones: number): void {
    const chords = this.pickedChords();
    if (!this.sheet || !this.model || (!this.selection.size && !chords.length)) return;
    if (this.chordPart) {
      this.shiftChords(chords, ticks, semitones);
      this.box?.focus();
      return;
    }
    const moved = this.both
      ? roll.moveTogether(this.model, [...this.selection], chords, ticks, semitones, this.sheet.total)
      : roll.moveNotes(this.model, this.part, [...this.selection], ticks, semitones, this.sheet.total);
    if (!moved) {
      this.setStatus(this.say(this.both ? 'scoreMoveDoesNotFitBoth' : 'scoreMoveDoesNotFit'), true);
      return;
    }
    this.commit(moved);
    if (chords.length) {
      this.chordPicks = new Set(chords.map(start => start + ticks));
      this.draw();
    }
    const lead = this.noteById(moved, [...this.selection][0]);
    if (lead && semitones) this.blip(lead.note.pitch, lead.part);
    if (semitones) this.warnVoice();
    this.box?.focus();
  }

  private voiceWarning(): string {
    const middle = roll.voiceMiddle(this.model as Model);
    const [low, high] = roll.VOICE_WINDOW;
    if (middle === null || (middle >= low && middle <= high)) return '';
    return this.say('scoreVoiceWarning', { note: roll.noteName(Math.round(middle)), where: this.say(middle > high ? 'scoreAbove' : 'scoreBelow'), low: roll.noteName(low), high: roll.noteName(high) });
  }

  private warnVoice(): void {
    if (!this.both && this.part !== 'Vocal') return;
    const warning = this.voiceWarning();
    if (!warning) return;
    this.notice = warning;
    this.showDescription();
  }

  private offerChord(under: { pitch: number }, start: number, pitch: number): void {
    const sheet = this.sheet as Sheet;
    const model = this.model as Model;
    const bar = roll.barAt(sheet, start);
    const guess = roll.chordGuess(under.pitch, pitch, roll.flatsIn(sheet, sheet.bars[bar].key));
    const existing = model.chords.find(chord => chord.start === start)?.name || '';
    const why = this.say('scoreOneNote');
    if (guess && guess === existing) {
      this.setStatus(why + ' ' + this.say('scoreChordThere', { name: guess }), true);
      return;
    }
    const label = !guess
      ? this.say('scoreAddAChordAt', { bar: bar + 1 })
      : existing
        ? this.say('scoreChangeChordAt', { from: existing, to: guess, bar: bar + 1 })
        : this.say('scoreAddChordAt', { name: guess, bar: bar + 1 });
    this.setStatus(why, true, { label, run: () => (guess ? this.placeChord(start, guess) : this.openChordInput(start, existing)) });
  }

  private placeChord(start: number, name: string): void {
    if (this.barLocked(start) || !this.commit(roll.setChord(this.model as Model, start, name))) return;
    this.notice = this.say('scoreChordPlaced', { name, bar: roll.barAt(this.sheet as Sheet, start) + 1 });
    this.setStatus(this.notice);
    this.box?.focus();
  }

  private chordUnder(px: number): { start: number; name: string } | null {
    const c = this.canvas?.getContext('2d');
    if (!c) return null;
    c.save();
    const chip = this.chordChips(c, this.model as Model).find(one => px >= one.left && px <= one.left + one.width);
    c.restore();
    return chip ? { start: chip.chord.start, name: chip.chord.name } : null;
  }

  private chordAt(tick: number, px: number): void {
    if (this.barLocked(tick)) return;
    const found = this.chordUnder(px);
    const start = found ? found.start : clamp(roll.snapDown(tick, this.snap), 0, (this.sheet as Sheet).total - 1);
    this.openChordInput(start, found ? found.name : '');
  }

  private pickChord(px: number, keys: { ctrl: boolean; shift: boolean }): void {
    const found = this.chordUnder(px);
    if (!found) {
      this.setStatus(this.say('scoreBothChords'));
      return;
    }
    if (keys.shift || keys.ctrl) {
      if (this.chordPicks.has(found.start)) this.chordPicks.delete(found.start);
      else this.chordPicks.add(found.start);
    } else {
      this.selection.clear();
      this.chordPicks = new Set([found.start]);
    }
    this.draw();
  }

  private dropChord(px: number): void {
    const found = this.chordUnder(px);
    if (!found) {
      this.setStatus(this.say(this.both ? 'scoreBothChords' : 'scoreRightClickLane'));
      return;
    }
    if (this.barLocked(found.start)) return;
    this.removeChordAt(found);
  }

  // ---- edits ----

  private commit(next: Model | null, previous: Model | null = this.model): boolean {
    this.notice = null;
    this.drawn = null;
    if (!next) {
      this.setStatus(this.say('scoreDoesNotFit'), true);
      this.draw();
      return false;
    }
    if (next === previous || !previous || !this.sheet) return false;
    this.dropped = this.history.push(previous);
    this.model = next;
    this.localChanged = roll.changedBars(this.sheet, this.model);
    this.draw();
    this.scheduleWrite();
    return true;
  }

  undo(): void {
    if (!this.model || this.keyBusy) return;
    const previous = this.history.undo(this.history.lastDone && 'keyed' in this.history.lastDone ? this.snapshot() : this.model);
    if (!previous) return;
    this.drawn = null;
    this.stepped(previous);
  }

  redo(): void {
    if (!this.model || this.keyBusy) return;
    const next = this.history.redo(this.history.lastUndone && 'keyed' in this.history.lastUndone ? this.snapshot() : this.model);
    if (!next) return;
    this.drawn = null;
    this.stepped(next);
  }

  private stepped(entry: Entry): void {
    this.notice = null;
    if ('keyed' in entry) this.stopPlaying();
    this.restore(entry);
    this.clearPicks();
    if (this.sheet && this.model) this.localChanged = roll.changedBars(this.sheet, this.model);
    this.draw();
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    this.writePending = true;
    window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => void this.write(), WRITE_DELAY);
  }

  private async write(): Promise<void> {
    window.clearTimeout(this.writeTimer);
    this.writePending = false;
    if (!this.sheet || !this.model) return;
    const sequence = ++this.writeSequence;
    const sent = this.model;
    this.writing = true;
    const answer = await writeScore(this.base, roll.sheetOf(sent)).finally(() => {
      if (sequence === this.writeSequence) this.writing = false;
    });
    if (this.closed || sequence !== this.writeSequence) return;
    if (!failed(answer)) {
      this.current = answer.abc;
      this.changed = answer.bars;
      this.good = sent;
      this.showDescription();
    } else {
      this.setStatus(answer.error || this.say('scoreWriteFailed'), true);
      if (this.good && this.good !== this.model && this.sheet) {
        this.model = this.good;
        this.localChanged = roll.changedBars(this.sheet, this.model);
      }
    }
    this.draw();
  }

  /** ABC typed or pasted into its tab, read after a pause; an empty box leaves the score to the model. */
  typed(text: string): void {
    window.clearTimeout(this.readTimer);
    this.readTimer = window.setTimeout(() => void this.readTyped(text), READ_DELAY);
  }

  private async readTyped(text: string): Promise<boolean> {
    window.clearTimeout(this.readTimer);
    this.readTimer = 0;
    const clean = String(text || '').trim();
    if (clean === (this.current || '').trim()) return true;
    if (!clean) {
      this.base = '';
      this.current = '';
      this.sheet = null;
      this.model = null;
      this.changed = [];
      this.emptyKind = 'empty';
      this.setStatus(this.say('scoreBoxEmpty'));
      return true;
    }
    const sequence = ++this.sequence;
    const answer = await readScore(clean);
    if (this.closed || sequence !== this.sequence) return false;
    this.typedProblem = null;
    if (failed(answer)) {
      this.typedProblem = answer.error || this.say('scoreTypedProblem');
      this.setStatus(this.typedProblem, true);
      return false;
    }
    this.base = clean;
    this.current = clean;
    this.changed = [];
    this.history = new roll.History<Entry>();
    this.moved = null;
    this.adopt(answer.sheet);
    this.setStatus(this.say('scoreReadAs', { bars: this.host.count('scoreBars', answer.sheet.bars.length) }));
    return true;
  }

  // ---- sound ----

  togglePlay(): void {
    if (this.player.playing) this.stopPlaying();
    else this.startPlaying();
    this.emit();
  }

  private startPlaying(): void {
    if (!this.sheet || this.pianoWait) return;
    if (!this.player.needsPiano()) {
      this.playNow();
      return;
    }
    this.pianoWait = true;
    this.setStatus(this.say('scoreLoadingPiano'));
    loadPiano()
      .then(() => {
        this.pianoWait = false;
        if (this.closed) return;
        this.showDescription();
        this.playNow();
      })
      .catch(error => {
        this.pianoWait = false;
        if (this.closed) return;
        this.setStatus(this.say('scorePianoFailed', { error: error instanceof Error ? error.message : String(error) }), true);
        this.playNow();
      });
  }

  private playNow(): void {
    const sheet = this.sheet;
    const model = this.model;
    if (!sheet || !model) return;
    const from = this.playhead >= sheet.total ? 0 : this.playhead;
    const list = roll.events(sheet, model, from, this.hear);
    try {
      this.player.play(list);
    } catch (error) {
      this.setStatus(this.say('scoreNoSound', { error: error instanceof Error ? error.message : String(error) }), true);
      return;
    }
    this.playFrom = from;
    this.emit();
    const perTick = roll.secondsAt(sheet, 1);
    const step = () => {
      if (this.closed || !this.player.playing || !this.sheet) return;
      const tick = this.playFrom + this.player.elapsed() / perTick;
      if (tick >= this.sheet.total) {
        this.stopPlaying();
        this.playhead = 0;
        this.draw();
        return;
      }
      this.playTick = tick;
      if (this.tab === 'roll' && this.width) {
        const shown = this.visibleTicks();
        if (tick > this.tick0 + shown * 0.92 || tick < this.tick0) {
          this.tick0 = tick - shown * 0.08;
          this.clampView();
        }
        this.draw();
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stopPlaying(): void {
    if (this.player.playing) {
      if (this.playTick !== null) this.playhead = Math.floor(this.playTick);
      this.player.stop();
    }
    this.playTick = null;
    window.cancelAnimationFrame(this.frame);
    this.emit();
  }

  // ---- leaving ----

  async revert(): Promise<void> {
    if (this.edited() && !(await this.host.confirm({ title: this.say('scoreResetTitle'), message: this.say('scoreResetMessage'), ok: this.say('scoreResetOk'), cancel: this.say('scoreKeepEdits') }))) return;
    await this.load(this.opened);
  }

  /** The score as it stands once every pending edit is written, and whether the ABC tab holds text that does not read. */
  async settled(): Promise<{ text: string; typed: string | null; problem: string | null }> {
    this.chordInput?.finish(true);
    this.sectionInput?.finish(true);
    if (this.writePending) await this.write();
    return { text: (this.current || '').trim(), typed: null, problem: this.typedProblem };
  }

  async readNow(text: string): Promise<void> {
    if (this.readTimer) await this.readTyped(text);
  }

  async midi(): Promise<Uint8Array | null> {
    const { text } = await this.settled();
    if (this.closed || !text) return null;
    const answer = await scoreMidi(text);
    if (this.closed) return null;
    if (failed(answer)) {
      this.setStatus(answer.error || this.say('scoreMidiFailed'), true);
      return null;
    }
    return answer.bytes;
  }

  tell(text: string, bad = false): void {
    this.setStatus(text, bad);
  }
}
