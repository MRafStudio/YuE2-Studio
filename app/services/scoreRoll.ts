/**
 * The piano roll's model of a score: notes of the two voices, chord symbols
 * and section marks, and every edit made to them. Ported from
 * pytraveler/YuE2-ComfyUI (web/js/yue2_roll.js, Apache-2.0); the server reads
 * a score into a `Sheet` and writes an edited one back (`/v1/score/*`).
 */

export type Part = 'Vocal' | 'Ins';
export const PARTS: Part[] = ['Vocal', 'Ins'];

export interface SheetNote {
  start: number;
  length: number;
  pitch: number;
}

export interface SheetChord {
  start: number;
  name: string;
}

export interface SheetSection {
  name: string;
  bar: number;
  bars: number;
}

export interface SheetBar {
  start: number;
  length: number;
  meter: string;
  key: string;
  section: string;
  editable: boolean;
}

/** A score as the server reads it: times and lengths in whole L: units from the start. */
export interface Sheet {
  unit: number;
  per_quarter: number;
  bpm: number;
  seconds: number;
  total: number;
  bars: SheetBar[];
  sections: SheetSection[];
  notes: Record<Part, SheetNote[]>;
  chords: SheetChord[];
  signatures: Record<string, number>;
  /** The score ended where the model ran out of room; it is drawn up to its last whole group. */
  cut?: boolean;
}

export interface RollNote extends SheetNote {
  id: number;
}

export interface Section {
  bar: number;
  name: string;
}

export interface Model {
  notes: Record<Part, RollNote[]>;
  chords: SheetChord[];
  next: number;
  bpm: number;
  unit: number;
  sections: Section[];
}

/** What the roll sends back to be written: the model without its note ids. */
export interface SheetEdit {
  notes: Record<Part, SheetNote[]>;
  chords: SheetChord[];
  bpm: number;
  unit: number;
  sections: Section[];
}

export const QUALITIES = ['', 'm', 'dim', 'aug', '7', 'maj7', 'm7', 'dim7', 'm7b5', 'sus4', 'sus2', '6', 'm6', '7sus4', 'm(maj7)'];

export const CHORD_TONES: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], sus4: [0, 5, 7], sus2: [0, 2, 7], '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9], '7sus4': [0, 5, 7, 10], 'm(maj7)': [0, 3, 7, 11],
};

/** Grid steps in quarter notes, finest last; the label is the translation key. */
export const SNAPS = [
  { label: 'scoreSnapQuarter', quarters: 1 },
  { label: 'scoreSnapEighth', quarters: 0.5 },
  { label: 'scoreSnapSixteenth', quarters: 0.25 },
  { label: 'scoreSnapThirtySecond', quarters: 0.125 },
] as const;

export const SECTION_NAMES = [
  'intro', 'verse', 'pre-chorus', 'chorus', 'post-chorus', 'bridge', 'interlude',
  'instrumental', 'solo', 'rap', 'theme', 'variation', 'development', 'loop',
  'intro and verse', 'verse and pre-chorus', 'pre-chorus and chorus',
  'pre-outro', 'outro', 'fade-out', 'preshot', 'irregular', 'silence',
];

export const SECTION_LONGEST = 40;
export const FINEST = 32;
export const LOWEST = 21;
export const HIGHEST = 108;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MAJOR_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MINOR_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHIFT: Record<string, number> = { '': 0, '#': 1, '##': 2, b: -1, bb: -2 };
const PITCH_NAME = '([A-G])(bb|##|b|#)?';
const ESCAPED = QUALITIES.map(quality => quality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const CHORD_RE = new RegExp('^' + PITCH_NAME + '(' + ESCAPED.join('|') + ')(?:/' + PITCH_NAME + ')?$');
const FULL_REST_RE = /^\s*Z([2-4])?\s*$/;
const KEY_NAME_RE = /^([A-G])(#|b)?(m?)$/;

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function isChord(name: unknown): boolean {
  return CHORD_RE.test(String(name ?? '').trim());
}

export function chordPitches(name: string): number[] {
  const match = CHORD_RE.exec(String(name ?? '').trim());
  if (!match) return [];
  const root = 48 + mod12(NATURAL[match[1]] + SHIFT[match[2] || '']);
  const tones = CHORD_TONES[match[3]].map(step => root + step);
  if (match[4]) tones.unshift(36 + mod12(NATURAL[match[4]] + SHIFT[match[5] || '']));
  return tones;
}

export function movedChord(name: string, semitones: number): string | null {
  const match = CHORD_RE.exec(String(name ?? '').trim());
  if (!match || !Number.isInteger(semitones)) return null;
  if (semitones % 12 === 0) return match[0];
  const quality = match[3];
  const minor = (quality.startsWith('m') && !quality.startsWith('maj')) || quality.startsWith('dim');
  const spell = (letter: string, shift: string | undefined, names: string[]) => names[mod12(NATURAL[letter] + SHIFT[shift || ''] + semitones)];
  const root = spell(match[1], match[2], minor ? MINOR_ROOTS : MAJOR_ROOTS);
  return root + quality + (match[4] ? '/' + spell(match[4], match[5], MAJOR_ROOTS) : '');
}

const GUESSED: Record<number, string> = { 3: 'm', 4: '', 6: 'dim', 7: '', 10: '7', 11: 'maj7' };

export function chordGuess(one: number, other: number, flats = false): string {
  const low = Math.min(one, other);
  const step = mod12(Math.max(one, other) - low);
  if (!(step in GUESSED)) return '';
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(low)] + GUESSED[step];
}

export function noteName(pitch: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pitch)] + (Math.floor(pitch / 12) - 1);
}

export function isBlack(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(mod12(pitch));
}

export function flatsIn(sheet: Sheet | null | undefined, key: string): boolean {
  return (sheet?.signatures?.[key] ?? 0) < 0;
}

export function snapChoices(perQuarter: number) {
  return SNAPS.map(snap => ({ label: snap.label, ticks: snap.quarters * perQuarter })).filter(snap => Number.isInteger(snap.ticks) && snap.ticks >= 1);
}

export function snapTo(tick: number, step: number): number {
  return Math.round(tick / step) * step;
}

export function snapDown(tick: number, step: number): number {
  return Math.floor(tick / step) * step;
}

export function modifiersOf(event: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; getModifierState?: (key: string) => boolean }) {
  const alt = Boolean(event.altKey || event.getModifierState?.('AltGraph'));
  return { alt, ctrl: Boolean(event.ctrlKey || event.metaKey) && !alt, shift: Boolean(event.shiftKey) };
}

export const DOUBLE_CLICK_MS = 400;
export const DOUBLE_CLICK_PX = 5;

export function isDoubleClick(last: { at: number; px: number; py: number } | null, at: number, px: number, py: number): boolean {
  if (!last) return false;
  return at - last.at <= DOUBLE_CLICK_MS && Math.abs(px - last.px) <= DOUBLE_CLICK_PX && Math.abs(py - last.py) <= DOUBLE_CLICK_PX;
}

export const TEMPO_LOW = 40;
export const TEMPO_HIGH = 200;

export function tempoRange(bpm: number) {
  const own = Math.round(Number(bpm)) || TEMPO_LOW;
  return { low: Math.min(TEMPO_LOW, own), high: Math.max(TEMPO_HIGH, own) };
}

export function tempoOf(value: unknown, own: number): number | null {
  const asked = Math.round(Number(value));
  if (!Number.isFinite(asked)) return null;
  const range = tempoRange(own);
  return Math.min(range.high, Math.max(range.low, asked));
}

export function secondsAt(sheet: Sheet, tick: number): number {
  return (tick * 60) / (sheet.bpm * sheet.per_quarter);
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

export const AUTO_BASE_SECONDS = 12;
export const AUTO_SECONDS_PER_LINE = 12;
export const AUTO_MIN_SECONDS = 40;
export const AUTO_INSTRUMENTAL_SECONDS = 180;
export const MAX_SECONDS = 360;
export const AUTO_WORDS_PER_LINE = 8;

const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c-\x1e\x85  ]/;
const DIRECTION = /\[[^\]]*\]/g;
const LETTER = /[\p{L}\p{N}]/u;

export function sungLines(lyrics: string): number {
  let count = 0;
  for (const piece of String(lyrics ?? '').split(LINE_BREAKS)) {
    const words = piece.replace(DIRECTION, ' ').split(/\s+/).filter(Boolean);
    if (!words.some(word => LETTER.test(word))) continue;
    count += Math.max(1, Math.floor((words.length + Math.floor(AUTO_WORDS_PER_LINE / 2)) / AUTO_WORDS_PER_LINE));
  }
  return count;
}

export function autoSeconds(lyrics: string): number {
  const lines = sungLines(lyrics);
  if (lines === 0) return AUTO_INSTRUMENTAL_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(AUTO_MIN_SECONDS, AUTO_BASE_SECONDS + AUTO_SECONDS_PER_LINE * lines));
}

export function lengthLimit(maxSeconds: number | null | undefined, lyrics: string | null | undefined, reported?: number | null) {
  if (maxSeconds === null || maxSeconds === undefined) return null;
  const requested = Number(maxSeconds) || 0;
  if (requested > 0) return { seconds: requested, auto: false };
  if (typeof lyrics === 'string') return { seconds: autoSeconds(lyrics), auto: true };
  const known = Number(reported);
  return known > 0 ? { seconds: known, auto: true } : null;
}

export function limitTick(sheet: Sheet, seconds: number): number {
  return (seconds * sheet.bpm * sheet.per_quarter) / 60;
}

export function barsAfter(sheet: Sheet, seconds: number): number[] {
  const edge = limitTick(sheet, seconds) - 1e-6;
  const after: number[] = [];
  sheet.bars.forEach((bar, index) => {
    if (bar.start >= edge) after.push(index);
  });
  return after;
}

export function barAt(sheet: Sheet, tick: number): number {
  const bars = sheet.bars;
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (bars[middle].start <= tick) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function sectionAt(sheet: Sheet, bar: number): SheetSection | null {
  return sheet.sections.find(section => bar >= section.bar && bar < section.bar + section.bars) || null;
}

export function modelOf(sheet: Sheet): Model {
  let next = 1;
  const notes = {} as Record<Part, RollNote[]>;
  for (const part of PARTS) {
    notes[part] = (sheet.notes[part] || [])
      .map(note => ({ id: next++, start: note.start, length: note.length, pitch: note.pitch }))
      .sort((a, b) => a.start - b.start);
  }
  const chords = (sheet.chords || []).map(chord => ({ start: chord.start, name: chord.name })).sort((a, b) => a.start - b.start);
  return { notes, chords, next, bpm: sheet.bpm, unit: sheet.unit, sections: sectionsOf(sheet) };
}

export function sectionsOf(sheet: Sheet): Section[] {
  return (sheet.sections || [])
    .filter(section => section.name)
    .map(section => ({ bar: section.bar, name: section.name }))
    .sort((a, b) => a.bar - b.bar);
}

export function sectionName(name: unknown): string {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  return clean.length && clean.length <= SECTION_LONGEST ? clean : '';
}

export function setSection(model: Model, bar: number, name: string): Model | null {
  const clean = sectionName(name);
  if (!clean || !Number.isInteger(bar) || bar < 0) return null;
  const sections = model.sections.filter(section => section.bar !== bar);
  sections.push({ bar, name: clean });
  sections.sort((a, b) => a.bar - b.bar);
  return { ...model, sections };
}

export function removeSection(model: Model, bar: number): Model | null {
  if (!model.sections.some(section => section.bar === bar)) return null;
  return { ...model, sections: model.sections.filter(section => section.bar !== bar) };
}

export function moveSection(model: Model, from: number, to: number): Model | null {
  const found = model.sections.find(section => section.bar === from);
  if (!found || !Number.isInteger(to) || to < 0) return null;
  if (to === from) return model;
  if (model.sections.some(section => section.bar === to)) return null;
  const without = removeSection(model, from);
  return without && setSection(without, to, found.name);
}

export function scaledModel(model: Model, factor: number, unit: number): Model {
  const notes = {} as Record<Part, RollNote[]>;
  for (const part of PARTS) {
    notes[part] = model.notes[part].map(note => ({ ...note, start: note.start * factor, length: note.length * factor }));
  }
  const chords = model.chords.map(chord => ({ ...chord, start: chord.start * factor }));
  return { ...model, notes, chords, unit };
}

export function sectionStarting(model: Model, bar: number): Section | null {
  return model.sections.find(section => section.bar === bar) || null;
}

export function sectionSpans(model: Pick<Model, 'sections'>, bars: number): SheetSection[] {
  const spans: SheetSection[] = [];
  for (const [index, section] of model.sections.entries()) {
    const next = model.sections[index + 1];
    spans.push({ name: section.name, bar: section.bar, bars: (next ? next.bar : bars) - section.bar });
  }
  return spans;
}

export function sheetOf(model: Model): SheetEdit {
  const notes = {} as Record<Part, SheetNote[]>;
  for (const part of PARTS) {
    notes[part] = model.notes[part]
      .map(note => ({ start: note.start, length: note.length, pitch: note.pitch }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
  const chords = model.chords.map(chord => ({ start: chord.start, name: chord.name })).sort((a, b) => a.start - b.start);
  return { notes, chords, bpm: model.bpm, unit: model.unit, sections: model.sections.map(section => ({ bar: section.bar, name: section.name })) };
}

function withPart(model: Model, part: Part, notes: RollNote[]): Model {
  return { ...model, notes: { ...model.notes, [part]: notes.slice().sort((a, b) => a.start - b.start) } };
}

export function fits(notes: RollNote[], candidate: RollNote, ignore: Set<number>, total: number): boolean {
  if (!Number.isInteger(candidate.start) || !Number.isInteger(candidate.length)) return false;
  if (candidate.start < 0 || candidate.length < 1 || candidate.start + candidate.length > total) return false;
  if (candidate.pitch < 0 || candidate.pitch > 127) return false;
  const end = candidate.start + candidate.length;
  return !notes.some(note => !ignore.has(note.id) && note.start < end && note.start + note.length > candidate.start);
}

export function addNote(model: Model, part: Part, start: number, length: number, pitch: number, total: number) {
  const note = { id: model.next, start, length, pitch };
  if (!fits(model.notes[part], note, new Set(), total)) return null;
  const changed = withPart(model, part, [...model.notes[part], note]);
  changed.next = model.next + 1;
  return { model: changed, id: note.id };
}

export function roomAt(model: Model, part: Part, tick: number, total: number): number {
  if (!Number.isInteger(tick) || tick < 0 || tick >= total) return 0;
  let end = total;
  for (const note of model.notes[part]) {
    if (note.start <= tick && tick < note.start + note.length) return 0;
    if (note.start > tick) end = Math.min(end, note.start);
  }
  return end - tick;
}

export function moveNotes(model: Model, part: Part, ids: number[], ticks: number, semitones: number, total: number): Model | null {
  const moving = new Set(ids);
  const moved = model.notes[part].map(note => (moving.has(note.id) ? { ...note, start: note.start + ticks, pitch: note.pitch + semitones } : note));
  for (const note of moved) {
    if (!moving.has(note.id)) continue;
    if (!fits(moved, note, moving, total)) return null;
  }
  return withPart(model, part, moved);
}

export function stretchNote(model: Model, part: Part, id: number, length: number, total: number): Model | null {
  const notes = model.notes[part];
  const note = notes.find(candidate => candidate.id === id);
  if (!note || !Number.isInteger(length)) return null;
  const next = notes.find(candidate => candidate.start > note.start) || null;
  const farthest = next ? next.start + next.length - 1 : total;
  const end = Math.max(note.start + 1, Math.min(note.start + length, farthest, total));
  if (end === note.start + note.length) return model;
  return withPart(model, part, notes.map(candidate => {
    if (candidate.id === id) return { ...candidate, length: end - candidate.start };
    if (next && candidate.id === next.id && end > candidate.start) return { ...candidate, start: end, length: candidate.start + candidate.length - end };
    return candidate;
  }));
}

export function deleteNotes(model: Model, part: Part, ids: number[]): Model {
  const gone = new Set(ids);
  return withPart(model, part, model.notes[part].filter(note => !gone.has(note.id)));
}

export function noteAt(model: Model, part: Part, tick: number, pitch: number): RollNote | null {
  return model.notes[part].find(note => note.pitch === pitch && note.start <= tick && tick < note.start + note.length) || null;
}

export function notesIn(model: Model, part: Part, fromTick: number, toTick: number, lowPitch: number, highPitch: number): number[] {
  const [t0, t1] = [Math.min(fromTick, toTick), Math.max(fromTick, toTick)];
  const [p0, p1] = [Math.min(lowPitch, highPitch), Math.max(lowPitch, highPitch)];
  return model.notes[part].filter(note => note.start < t1 && note.start + note.length > t0 && note.pitch >= p0 && note.pitch <= p1).map(note => note.id);
}

export function chordsIn(model: Model, fromTick: number, toTick: number): number[] {
  const [t0, t1] = [Math.min(fromTick, toTick), Math.max(fromTick, toTick)];
  const starts = model.chords.map(chord => chord.start).sort((a, b) => a - b);
  return starts.filter((start, index) => start < t1 && (index + 1 < starts.length ? starts[index + 1] : Infinity) > t0);
}

export function partOf(model: Model, id: number): Part | null {
  return PARTS.find(part => model.notes[part].some(note => note.id === id)) || null;
}

export function moveTogether(model: Model, ids: number[], starts: number[], ticks: number, semitones: number, total: number): Model | null {
  if (!ticks && !semitones) return model;
  const moving = new Set(ids);
  let changed: Model | null = model;
  for (const part of PARTS) {
    const mine = model.notes[part].filter(note => moving.has(note.id)).map(note => note.id);
    if (!mine.length) continue;
    changed = changed && moveNotes(changed, part, mine, ticks, semitones, total);
    if (!changed) return null;
  }
  const chosen = new Set(starts);
  const kept = model.chords.filter(chord => !chosen.has(chord.start));
  if (kept.length === model.chords.length) return changed;
  const taken = new Set(kept.map(chord => chord.start));
  const moved: SheetChord[] = [];
  for (const chord of model.chords) {
    if (!chosen.has(chord.start)) continue;
    const start = chord.start + ticks;
    const name = movedChord(chord.name, semitones);
    if (!name || !Number.isInteger(start) || start < 0 || start >= total || taken.has(start)) return null;
    moved.push({ start, name });
  }
  return { ...(changed as Model), chords: [...kept, ...moved].sort((a, b) => a.start - b.start) };
}

export function deleteTogether(model: Model, ids: number[], starts: number[]): Model {
  const gone = new Set(ids);
  const dropped = new Set(starts);
  const notes = {} as Record<Part, RollNote[]>;
  for (const part of PARTS) notes[part] = model.notes[part].filter(note => !gone.has(note.id));
  return { ...model, notes, chords: model.chords.filter(chord => !dropped.has(chord.start)) };
}

export function setChord(model: Model, start: number, name: string): Model | null {
  const clean = String(name ?? '').trim();
  if (!isChord(clean)) return null;
  const chords = model.chords.filter(chord => chord.start !== start);
  chords.push({ start, name: clean });
  chords.sort((a, b) => a.start - b.start);
  return { ...model, chords };
}

export function removeChord(model: Model, start: number): Model {
  return { ...model, chords: model.chords.filter(chord => chord.start !== start) };
}

const LETTERS = 'CDEFGAB';
const LETTER_STEPS = [0, 2, 4, 5, 7, 9, 11];
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5];
const FIFTH_TONES: Record<string, number[]> = {
  '': [0, 4, 1], m: [0, -3, 1], dim: [0, -3, -6], aug: [0, 4, 8],
  maj7: [0, 4, 1, 5], m7: [0, -3, 1, -2], '7': [0, 4, 1, -2], m7b5: [0, -3, -6, -2],
  dim7: [0, -3, -6, -9], 'm(maj7)': [0, -3, 1, 5], sus2: [0, 2, 1], sus4: [0, -1, 1],
  '7sus4': [0, -1, 1, -2], '6': [0, 4, 1, 3], m6: [0, -3, 1, 3],
};
const DEGREES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
const TONE_DEGREES: Record<string, Record<number, string>> = { dim: { 6: 'b5' }, m7b5: { 6: 'b5' }, dim7: { 6: 'b5', 9: 'bb7' }, aug: { 8: '#5' } };
const DEGREE_RE = /^(#{0,2}|b{0,2})([1-9]|1[0-3])$/;
const ACCIDENTALS: Record<string, string> = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
export const CHORD_ROOT = 48;

export function keySharps(key: string): number | null {
  const found = KEY_NAME_RE.exec(String(key ?? '').trim());
  if (!found) return null;
  const tonic = NATURAL[found[1]] + SHIFT[found[2] || ''] + (found[3] ? 3 : 0);
  const sharps = mod12(7 * tonic);
  return sharps > 6 ? sharps - 12 : sharps;
}

export function chordParts(name: string) {
  const match = CHORD_RE.exec(String(name ?? '').trim());
  if (!match) return null;
  return {
    root: mod12(NATURAL[match[1]] + SHIFT[match[2] || '']),
    quality: match[3],
    bass: match[4] ? mod12(NATURAL[match[4]] + SHIFT[match[5] || '']) : null,
  };
}

function spelledRoot(root: number, quality: string, sharps: number): string {
  const centre = sharps + 2;
  let best: { cost: number; letter: number; alteration: number } | null = null;
  for (let letter = 0; letter < 7; letter++) {
    const alteration = mod12(root - LETTER_STEPS[letter] + 6) - 6;
    const place = LETTER_FIFTHS[letter] + 7 * alteration;
    const places = FIFTH_TONES[quality].map(step => place + step);
    const cost = [...places, places[0]].reduce((sum, at) => sum + Math.max(0, Math.abs(at - centre) - 3), 0);
    if (!best || cost < best.cost) best = { cost, letter, alteration };
  }
  const chosen = best as { letter: number; alteration: number };
  return LETTERS[chosen.letter] + (chosen.alteration > 0 ? '#'.repeat(chosen.alteration) : 'b'.repeat(-chosen.alteration));
}

function bassName(root: string, degreeText: string): string {
  const found = DEGREE_RE.exec(degreeText) as RegExpExecArray;
  const rootLetter = LETTERS.indexOf(root[0]);
  const rootShift = [...root.slice(1)].reduce((sum, sign) => sum + (sign === '#' ? 1 : -1), 0);
  const degree = Number(found[2]);
  const accidental = found[1];
  const interval = LETTER_STEPS[(degree - 1) % 7] + 12 * Math.floor((degree - 1) / 7) + [...accidental].reduce((sum, sign) => sum + (sign === '#' ? 1 : -1), 0);
  const target = mod12(LETTER_STEPS[rootLetter] + rootShift + interval);
  const letter = (rootLetter + degree - 1) % 7;
  const difference = mod12(target - LETTER_STEPS[letter] + 6) - 6;
  if (Math.abs(difference) <= 2) return LETTERS[letter] + ACCIDENTALS[String(difference)];
  return ((root + accidental).includes('#') ? SHARP_NAMES : FLAT_NAMES)[target];
}

export function spellChord(root: number, quality: string, bass: number | null | undefined, key: string): string {
  const sharps = keySharps(key) ?? 0;
  const name = spelledRoot(mod12(root), quality, sharps);
  if (bass === null || bass === undefined || mod12(bass - root) === 0) return name + quality;
  const step = mod12(bass - root);
  return name + quality + '/' + bassName(name, TONE_DEGREES[quality]?.[step] ?? DEGREES[step]);
}

function shapeOf(classes: Set<number>, prefer: number[]) {
  const found: { root: number; quality: string }[] = [];
  for (const quality of QUALITIES) {
    for (let root = 0; root < 12; root++) {
      const tones = new Set(CHORD_TONES[quality].map(step => (root + step) % 12));
      if (tones.size === classes.size && [...tones].every(tone => classes.has(tone))) found.push({ root, quality });
    }
  }
  for (const root of prefer) {
    const hit = found.find(shape => shape.root === root);
    if (hit) return hit;
  }
  return found[0] || null;
}

export function namedChord(pitches: number[], key: string): string | null {
  const sorted = [...new Set(pitches.map(Number))].sort((a, b) => a - b);
  const classes = new Set(sorted.map(mod12));
  if (classes.size < 3) return null;
  const [bass, ...upper] = sorted;
  const above = new Set(upper.map(mod12));
  const tries: [Set<number>, number[]][] = [];
  if (bass < CHORD_ROOT && CHORD_ROOT <= upper[0]) tries.push([above, [mod12(upper[0]), mod12(bass)]]);
  tries.push([classes, [mod12(bass), mod12(upper[0])]]);
  if (!above.has(mod12(bass))) tries.push([above, [mod12(upper[0])]]);
  for (const [wanted, prefer] of tries) {
    const found = shapeOf(wanted, prefer);
    if (found) return spellChord(found.root, found.quality, mod12(bass), key);
  }
  return null;
}

export function transposedChord(name: string, semitones: number, key: string): string | null {
  const parts = chordParts(name);
  if (!parts || !Number.isInteger(semitones)) return null;
  if (mod12(semitones) === 0) return String(name).trim();
  return spellChord(parts.root + semitones, parts.quality, parts.bass === null ? null : parts.bass + semitones, key);
}

export function chordByDegree(pitch: number, key: string): string {
  const tonic = mod12(7 * (keySharps(key) ?? 0));
  const scale = LETTER_STEPS.map(step => mod12(tonic + step));
  const root = mod12(pitch);
  const at = scale.indexOf(root);
  if (at < 0) return spellChord(root, '', null, key);
  const third = mod12(scale[(at + 2) % 7] - root);
  const fifth = mod12(scale[(at + 4) % 7] - root);
  const quality = fifth === 6 ? 'dim' : third === 3 ? 'm' : '';
  return spellChord(root, quality, null, key);
}

export function rootPitch(name: string): number | null {
  const parts = chordParts(name);
  return parts ? CHORD_ROOT + parts.root : null;
}

export function keyAt(sheet: Sheet, tick: number): string {
  return sheet.bars[barAt(sheet, Math.max(0, Math.floor(tick)))]?.key || '';
}

export function chordSpans(model: Pick<Model, 'chords'>, total: number) {
  const sorted = model.chords.slice().sort((a, b) => a.start - b.start);
  return sorted.map((chord, index) => ({ start: chord.start, name: chord.name, end: index + 1 < sorted.length ? sorted[index + 1].start : total }));
}

export function chordRoom(model: Model, start: number, total: number) {
  const starts = model.chords.map(chord => chord.start).sort((a, b) => a - b);
  const at = starts.indexOf(start);
  if (at < 0) return null;
  return { low: at > 0 ? starts[at - 1] + 1 : 0, high: at + 1 < starts.length ? starts[at + 1] - 1 : total - 1 };
}

export function moveChord(model: Model, sheet: Sheet, start: number, ticks: number, semitones: number): Model | null {
  const chord = model.chords.find(candidate => candidate.start === start);
  const room = chordRoom(model, start, sheet.total);
  if (!chord || !room || !Number.isInteger(ticks) || !Number.isInteger(semitones)) return null;
  const to = start + ticks;
  if (to < room.low || to > room.high) return null;
  if (!ticks && mod12(semitones) === 0) return model;
  const name = transposedChord(chord.name, semitones, keyAt(sheet, to));
  if (!name) return null;
  const chords = model.chords.map(candidate => (candidate.start === start ? { start: to, name } : candidate));
  return { ...model, chords: chords.sort((a, b) => a.start - b.start) };
}

export function moveChords(model: Model, sheet: Sheet, starts: number[], ticks: number, semitones: number): Model | null {
  if (!ticks && mod12(semitones) === 0) return model;
  const chosen = new Set(starts);
  const kept = model.chords.filter(chord => !chosen.has(chord.start));
  const taken = new Set(kept.map(chord => chord.start));
  const moved: SheetChord[] = [];
  for (const chord of model.chords) {
    if (!chosen.has(chord.start)) continue;
    const start = chord.start + ticks;
    const name = transposedChord(chord.name, semitones, keyAt(sheet, start));
    if (!name || !Number.isInteger(start) || start < 0 || start >= sheet.total || taken.has(start)) return null;
    taken.add(start);
    moved.push({ start, name });
  }
  return { ...model, chords: [...kept, ...moved].sort((a, b) => a.start - b.start) };
}

export function sectionKind(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*\d+$/, '');
}

type Pattern = [number, string | null][];

function carriedAt(chords: SheetChord[], tick: number): string | null {
  let name: string | null = null;
  for (const chord of chords) if (chord.start < tick) name = chord.name;
  return name;
}

function soundingAt(chords: SheetChord[], tick: number): string | null {
  let name: string | null = null;
  for (const chord of chords) if (chord.start <= tick) name = chord.name;
  return name;
}

function patternIn(chords: SheetChord[], from: number, to: number): Pattern {
  const sorted = chords.slice().sort((a, b) => a.start - b.start);
  const inside: Pattern = sorted.filter(chord => chord.start >= from && chord.start < to).map(chord => [chord.start - from, chord.name]);
  if (!inside.length || inside[0][0] !== 0) inside.unshift([0, carriedAt(sorted, from)]);
  return inside;
}

function samePattern(one: Pattern, other: Pattern): boolean {
  return one.length === other.length && one.every(([at, name], index) => other[index][0] === at && other[index][1] === name);
}

function writePattern(chords: SheetChord[], from: number, to: number, pattern: Pattern, total: number): SheetChord[] | null {
  const sorted = chords.slice().sort((a, b) => a.start - b.start);
  const had = sorted.some(chord => chord.start === from);
  const heldOn = to < total && !sorted.some(chord => chord.start === to) ? soundingAt(sorted, to) : undefined;
  const out = sorted.filter(chord => chord.start < from || chord.start >= to);
  for (const [at, name] of pattern) {
    if (at > 0) {
      out.push({ start: from + at, name: name as string });
      continue;
    }
    if (name === null) {
      if (carriedAt(out, from) !== null) return null;
      continue;
    }
    if (had || carriedAt(out, from) !== name) out.push({ start: from, name });
  }
  out.sort((a, b) => a.start - b.start);
  if (heldOn !== undefined && soundingAt(out, to) !== heldOn) {
    if (heldOn === null) return null;
    out.push({ start: to, name: heldOn });
    out.sort((a, b) => a.start - b.start);
  }
  return out;
}

/** Chords edited in one section, copied to the other sections of its kind whose chords were the same before. */
export function mirrorChords(sheet: Sheet, before: Model, after: Model) {
  const bars = sheet.bars;
  const spans = sectionSpans(after, bars.length);
  const range = (bar: number, count: number): [number, number] => [bars[bar].start, bar + count < bars.length ? bars[bar + count].start : sheet.total];
  const edited = spans.filter(span => {
    const [from, to] = range(span.bar, span.bars);
    return !samePattern(patternIn(before.chords, from, to), patternIn(after.chords, from, to));
  });
  const touched = new Set(edited.map(span => span.bar));
  const done: SheetSection[] = [];
  const skipped: SheetSection[] = [];
  let chords = after.chords;
  for (const span of edited) {
    for (const other of spans) {
      if (touched.has(other.bar) || sectionKind(other.name) !== sectionKind(span.name)) continue;
      const count = Math.min(span.bars, other.bars);
      const [from, to] = range(span.bar, count);
      const was = patternIn(before.chords, from, to);
      const now = patternIn(after.chords, from, to);
      if (samePattern(was, now)) continue;
      const [start, end] = range(other.bar, count);
      const alike = bars.slice(other.bar, other.bar + count).every((bar, index) => bar.editable !== false && bar.length === bars[span.bar + index].length);
      const written = alike && samePattern(patternIn(chords, start, end), was) ? writePattern(chords, start, end, now, sheet.total) : null;
      if (!written) {
        if (!skipped.some(one => one.bar === other.bar)) skipped.push(other);
        continue;
      }
      chords = written;
      touched.add(other.bar);
      done.push(other);
    }
  }
  const kept = skipped.filter(span => !touched.has(span.bar));
  const brief = (list: SheetSection[]) => list.map(span => ({ bar: span.bar, bars: span.bars, name: span.name })).sort((a, b) => a.bar - b.bar);
  return { model: done.length ? { ...after, chords } : after, done: brief(done), skipped: brief(kept) };
}

export interface Clip {
  origin: number;
  span: number;
  notes: Record<Part, { at: number; length: number; pitch: number }[]>;
  chords: { at: number; name: string; end: number }[];
}

export function clipOf(model: Model, sheet: Sheet, ids: number[], starts: number[]): Clip | null {
  const chosen = new Set(ids);
  const total = sheet.total;
  const notes = {} as Record<Part, RollNote[]>;
  let first = Infinity;
  let last = -Infinity;
  for (const part of PARTS) {
    notes[part] = model.notes[part].filter(note => chosen.has(note.id));
    for (const note of notes[part]) {
      first = Math.min(first, note.start);
      last = Math.max(last, note.start + note.length);
    }
  }
  const picked = new Set(starts);
  const spans = chordSpans(model, total).filter(chord => picked.has(chord.start));
  const bare = first === Infinity;
  for (const chord of bare ? spans : []) {
    first = Math.min(first, chord.start);
    last = Math.max(last, chord.end);
  }
  if (first === Infinity) return null;
  const origin = sheet.bars[barAt(sheet, first)].start;
  const endBar = barAt(sheet, Math.max(first, last - 1));
  const after = endBar + 1 < sheet.bars.length ? sheet.bars[endBar + 1].start : total;
  const chords = spans
    .map(chord => ({ at: Math.max(chord.start, bare ? chord.start : origin) - origin, name: chord.name, end: Math.min(chord.end, bare ? chord.end : after) - origin }))
    .filter(chord => chord.at < chord.end);
  const clipped = {} as Clip['notes'];
  for (const part of PARTS) clipped[part] = notes[part].map(note => ({ at: note.start - origin, length: note.length, pitch: note.pitch }));
  return { origin, span: after - origin, notes: clipped, chords };
}

export function clipReach(clip: Clip, routes: [Part, Part][], withChords: boolean) {
  const pieces = routes.flatMap(([from]) => clip.notes[from].map(note => [note.at, note.at + note.length] as [number, number]));
  if (withChords) pieces.push(...clip.chords.map(chord => [chord.at, chord.end] as [number, number]));
  if (!pieces.length) return null;
  return { from: Math.min(...pieces.map(piece => piece[0])), to: Math.max(...pieces.map(piece => piece[1])) };
}

export function pasteClip(model: Model, sheet: Sheet, clip: Clip, at: number, routes: [Part, Part][], withChords: boolean) {
  const total = sheet.total;
  let changed = model;
  let next = model.next;
  const ids: number[] = [];
  for (const [from, to] of routes) {
    const placed = clip.notes[from].map(note => ({ start: at + note.at, length: note.length, pitch: note.pitch }));
    if (!placed.length) continue;
    const low = Math.min(...placed.map(note => note.start));
    const high = Math.max(...placed.map(note => note.start + note.length));
    if (low < 0 || high > total) return null;
    const kept: RollNote[] = [];
    for (const note of changed.notes[to]) {
      if (note.start + note.length <= low || note.start >= high) kept.push(note);
      else if (note.start < low) kept.push({ ...note, length: low - note.start });
    }
    for (const note of placed) {
      kept.push({ id: next, ...note });
      ids.push(next);
      next += 1;
    }
    changed = { ...withPart(changed, to, kept), next };
  }
  let starts: number[] = [];
  if (withChords && clip.chords.length) {
    const from = at + clip.chords[0].at;
    const to = at + Math.max(...clip.chords.map(chord => chord.end));
    if (from < 0 || to > total) return null;
    const pattern: Pattern = clip.chords.map(chord => [chord.at - clip.chords[0].at, chord.name]);
    const chords = writePattern(changed.chords, from, to, pattern, total);
    if (!chords) return null;
    changed = { ...changed, chords };
    starts = clip.chords.map(chord => at + chord.at);
  }
  if (!ids.length && !starts.length) return null;
  return { model: changed, ids, starts };
}

export function shortcutLetter(event: { key?: string; code?: string }): string {
  const key = String(event.key || '').toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  const code = String(event.code || '');
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : key;
}

function barSignature(notes: SheetNote[], chords: SheetChord[], start: number, end: number): string {
  const inside = notes.filter(note => note.start < end && note.start + note.length > start).map(note => note.start + ':' + note.length + ':' + note.pitch).sort();
  const named = chords.filter(chord => chord.start >= start && chord.start < end).map(chord => chord.start + ':' + chord.name);
  return inside.join(',') + '|' + named.join(',');
}

/** The bars an edit changed, the only ones written back into the score. */
export function changedBars(sheet: Sheet, model: Model): number[] {
  const original = modelOf(sheet);
  const changed: number[] = [];
  sheet.bars.forEach((bar, index) => {
    const end = bar.start + bar.length;
    for (const part of PARTS) {
      const before = barSignature(original.notes[part], part === 'Vocal' ? original.chords : [], bar.start, end);
      const after = barSignature(model.notes[part], part === 'Vocal' ? model.chords : [], bar.start, end);
      if (before !== after) {
        changed.push(index);
        return;
      }
    }
  });
  return changed;
}

export const VOICE_WINDOW = [60, 82];

export function voiceMiddle(model: Model): number | null {
  const pitches = model.notes.Vocal.map(note => note.pitch).sort((a, b) => a - b);
  if (!pitches.length) return null;
  return (pitches[Math.floor((pitches.length - 1) / 2)] + pitches[Math.floor(pitches.length / 2)]) / 2;
}

/** The keys a score can move to, each the shift that keeps the voice nearest its comfortable range. */
export function keyChoices(key: string, middle: number | null = null) {
  const found = KEY_NAME_RE.exec(String(key ?? '').trim());
  if (!found) return [];
  const minor = found[3] === 'm';
  const tonic = NATURAL[found[1]] + SHIFT[found[2] || ''];
  const roots = minor ? MINOR_ROOTS : MAJOR_ROOTS;
  const [low, high] = VOICE_WINDOW;
  const centre = (low + high) / 2;
  const known = typeof middle === 'number' && Number.isFinite(middle);
  const inside = (shift: number) => !known || ((middle as number) + shift >= low && (middle as number) + shift <= high);
  const choices: { name: string; shift: number }[] = [];
  for (let step = -5; step <= 6; step++) {
    let shift = step;
    if (step === 6 && known && Math.abs((middle as number) - 6 - centre) < Math.abs((middle as number) + 6 - centre)) shift = -6;
    const other = shift > 0 ? shift - 12 : shift + 12;
    if (shift !== 0 && !inside(shift) && inside(other)) shift = other;
    const name = step ? roots[mod12(tonic + step)] + (minor ? 'm' : '') : found[0];
    choices.push({ name, shift });
  }
  return choices;
}

export function keyMove(shift: number): string {
  if (!shift) return '';
  return (shift > 0 ? '+' : '−') + Math.abs(shift);
}

export function pitchSpan(model: Model) {
  let low = Infinity;
  let high = -Infinity;
  for (const part of PARTS) {
    for (const note of model.notes[part]) {
      low = Math.min(low, note.pitch);
      high = Math.max(high, note.pitch);
    }
  }
  if (low === Infinity) return { low: 55, high: 79 };
  return { low: Math.max(LOWEST, low - 5), high: Math.min(HIGHEST, high + 5) };
}

export type SoundPart = Part | 'chords';

export interface SoundEvent {
  at: number;
  length: number;
  pitch: number;
  part: SoundPart;
}

/** What the player sounds from `fromTick` on, in seconds from there. */
export function events(sheet: Sheet, model: Model, fromTick: number, parts: Record<SoundPart, boolean> = { Vocal: true, Ins: true, chords: true }): SoundEvent[] {
  const tick = 60 / (sheet.bpm * sheet.per_quarter);
  const out: SoundEvent[] = [];
  for (const part of PARTS) {
    if (!parts[part]) continue;
    for (const note of model.notes[part]) {
      const end = note.start + note.length;
      if (end <= fromTick) continue;
      const begin = Math.max(note.start, fromTick);
      out.push({ at: (begin - fromTick) * tick, length: (end - begin) * tick, pitch: note.pitch, part });
    }
  }
  if (parts.chords) {
    model.chords.forEach((chord, index) => {
      const end = index + 1 < model.chords.length ? model.chords[index + 1].start : sheet.total;
      if (end <= fromTick) return;
      const begin = Math.max(chord.start, fromTick);
      for (const pitch of chordPitches(chord.name)) out.push({ at: (begin - fromTick) * tick, length: (end - begin) * tick, pitch, part: 'chords' });
    });
  }
  return out.sort((a, b) => a.at - b.at || a.pitch - b.pitch);
}

function isMusicLine(line: string): boolean {
  const body = line.trim();
  return body.endsWith('|') && !/^(%|[A-Za-z]:)/.test(body);
}

/** The score with Z2-Z4 spelled as single-bar rests, which abcjs draws one per bar. */
export function forNotation(abc: string): string {
  return String(abc ?? '').split(/\r?\n/).map(line => {
    if (!isMusicLine(line)) return line;
    const pieces = line.trim().slice(0, -1).split('|').flatMap(piece => {
      const rest = FULL_REST_RE.exec(piece);
      return rest ? Array(Number(rest[1] || 1)).fill('Z') : [piece];
    });
    return pieces.join('|') + '|';
  }).join('\n');
}

export function headerFacts(abc: string) {
  const lines = String(abc ?? '').trim().split(/\r?\n/);
  const field = (name: string) => {
    const line = lines.slice(0, 8).find(candidate => candidate.startsWith(name + ':'));
    return line ? line.slice(name.length + 1).trim() : '';
  };
  let bars = 0;
  let vocal = false;
  for (const line of lines.slice(8)) {
    if (line.startsWith('V:')) vocal = line.slice(2).trim() === 'Vocal';
    else if (vocal && isMusicLine(line)) bars += forNotation(line).trim().slice(0, -1).split('|').length;
  }
  const tempo = /=(\d+)/.exec(field('Q'));
  return { key: field('K'), meter: field('M'), bpm: tempo ? Number(tempo[1]) : null, bars };
}

/** Undo and redo of whole states, bounded. */
export class History<T> {
  done: T[] = [];
  undone: T[] = [];

  constructor(readonly limit = 200) {}

  push(state: T): T[] {
    this.done.push(state);
    if (this.done.length > this.limit) this.done.shift();
    const dropped = this.undone;
    this.undone = [];
    return dropped;
  }

  undo(current: T): T | null {
    if (!this.done.length) return null;
    this.undone.push(current);
    return this.done.pop() as T;
  }

  redo(current: T): T | null {
    if (!this.undone.length) return null;
    this.done.push(current);
    return this.undone.pop() as T;
  }

  take(undone: T[] | null = null): T | null {
    if (!this.done.length) return null;
    if (undone) this.undone = undone;
    return this.done.pop() as T;
  }

  get lastDone(): T | null {
    return this.done.length ? this.done[this.done.length - 1] : null;
  }

  get lastUndone(): T | null {
    return this.undone.length ? this.undone[this.undone.length - 1] : null;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }
}

export const MIDI_EXTENSIONS = ['.mid', '.midi', '.kar', '.rmi'];

export function isMidiFile(name: string): boolean {
  const lower = String(name ?? '').toLowerCase();
  return MIDI_EXTENSIONS.some(ending => lower.endsWith(ending));
}

export function midiFileName(title: string): string {
  const clean = String(title ?? '').replace(/[^\p{L}\p{N} _().-]+/gu, '_').replace(/\s+/g, ' ').trim().replace(/^[._ ]+|[._ ]+$/g, '').slice(0, 80);
  return (clean || 'YuE2 score') + '.mid';
}
