/** The extensions a MIDI file comes with, karaoke and RIFF-wrapped ones too. */
export const MIDI_EXTENSIONS = ['.mid', '.midi', '.kar', '.rmi'];

export function isMidiFile(name: string): boolean {
  const lower = String(name ?? '').toLowerCase();
  return MIDI_EXTENSIONS.some(ending => lower.endsWith(ending));
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI pitch as a note name with its octave, middle C being C4. */
export function noteName(pitch: number): string {
  return SHARP_NAMES[((pitch % 12) + 12) % 12] + (Math.floor(pitch / 12) - 1);
}
