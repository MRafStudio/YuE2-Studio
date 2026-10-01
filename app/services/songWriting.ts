export type LyricSection = { tag: string; body: string };
export const SECTION_PRESETS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Hook', 'Bridge', 'Refrain', 'Outro', 'Instrumental', 'Interlude'];
const SECTION_CYCLE = ['Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Intro'];
export const STYLE_LANGUAGES = ['English', 'Russian', 'Chinese', 'Mandarin', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Italian', 'Portuguese'];
const TEMPO = /^(?:(\d{2,3})\s*bpm|bpm\s*(\d{2,3}))$/i;
const VOICE = /\b(voices?|vocals?|vocalists?|singers?|choir|duet|rappers?)\b/i;
const LANGUAGE_WORD = new RegExp(`\\b(${STYLE_LANGUAGES.join('|')})\\b`, 'i');
function languageIn(text: string): string {
  const bare = STYLE_LANGUAGES.find(language => language.toLowerCase() === text.trim().toLowerCase());
  const embedded = VOICE.test(text) ? LANGUAGE_WORD.exec(text)?.[1] : undefined;
  return bare || STYLE_LANGUAGES.find(language => language.toLowerCase() === embedded?.toLowerCase()) || '';
}
export type StyleRole = 'language' | 'voice' | 'tempo';
function isStyleRole(text: string, role: StyleRole) {
  return role === 'language' ? Boolean(languageIn(text)) : role === 'voice' ? VOICE.test(text) : TEMPO.test(text.trim());
}
export function styleRole(text: string, role: StyleRole): string {
  const part = text.split(/[,\n]/).find(part => isStyleRole(part, role))?.trim() ?? '';
  if (role === 'language') return languageIn(part);
  if (role === 'voice') return part;
  const match = TEMPO.exec(part);
  return match ? String(Number(match[1] || match[2])) : '';
}
export function setStyleRole(text: string, role: StyleRole, value: string): string {
  const parts = text.split(/[,\n]/);
  const index = parts.findIndex(part => isStyleRole(part, role));
  let nextValue = value.trim();
  if (role === 'language') {
    let found = false;
    const changed = parts.map(part => {
      if (!languageIn(part)) return part;
      found = true;
      if (VOICE.test(part)) return part.replace(new RegExp(LANGUAGE_WORD.source, 'gi'), nextValue).replace(/ {2,}/g, ' ');
      return nextValue ? `${/^\s/.test(part) ? ' ' : ''}${nextValue}` : '';
    });
    if (!found && nextValue) changed.unshift(nextValue);
    return changed.filter(part => part.trim()).join(',');
  }
  if (role === 'tempo' && nextValue) {
    const number = Number(nextValue);
    if (!Number.isFinite(number)) return text;
    nextValue = `${Math.max(40, Math.min(200, Math.round(number)))} BPM`;
  }
  if (index >= 0) {
    if (nextValue) parts[index] = `${/^\s/.test(parts[index]) ? ' ' : ''}${nextValue}`;
    else parts.splice(index, 1);
  } else if (nextValue) {
    if (role === 'tempo') parts.push(` ${nextValue}`);
    else {
      const genre = parts.findIndex(part => part.trim() && !isStyleRole(part, 'language') && !isStyleRole(part, 'tempo'));
      parts.splice(genre < 0 ? 0 : genre + 1, 0, ` ${nextValue}`);
    }
  }
  return parts.filter(part => part.trim()).join(',');
}
export function cycleSection(tag: string): string {
  const match = /^(.*?)\s*(\d+)?\s*$/.exec(tag);
  const next = SECTION_CYCLE[(SECTION_CYCLE.indexOf(match?.[1] ?? tag) + 1) % SECTION_CYCLE.length];
  return match?.[2] ? `${next} ${match[2]}` : next;
}
export function toggleLetterCase(line: string, index: number): string {
  const letters = Array.from(line);
  const letter = letters[index];
  if (!letter) return line;
  const flipped = letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase();
  if (Array.from(flipped).length === 1) letters[index] = flipped;
  return letters.join('');
}
export type LineAction = 'up' | 'down' | 'duplicate' | 'delete' | 'duplicateStanza' | 'deleteStanza';
export function editLyricLine(sections: LyricSection[], section: number, index: number, action: LineAction): LyricSection[] {
  const next = sections.map(part => ({ ...part }));
  if (!next[section]) return next;
  const lines = next[section].body.split('\n');
  if (index < 0 || index >= lines.length) return next;
  if (action === 'duplicate') lines.splice(index + 1, 0, lines[index]);
  else if (action === 'delete') lines.splice(index, 1);
  else if (action === 'up' || action === 'down') {
    const step = action === 'up' ? -1 : 1;
    const target = index + step;
    if (target >= 0 && target < lines.length) [lines[index], lines[target]] = [lines[target], lines[index]];
    else if (next[section + step]) {
      const other = next[section + step].body.split('\n');
      const [line] = lines.splice(index, 1);
      if (step < 0) other.push(line); else other.unshift(line);
      next[section + step].body = other.join('\n');
    }
  } else if (lines[index]) {
    let first = index;
    let last = index;
    while (first > 0 && lines[first - 1]) first--;
    while (last + 1 < lines.length && lines[last + 1]) last++;
    if (action === 'duplicateStanza') lines.splice(last + 1, 0, '', ...lines.slice(first, last + 1));
    else {
      if (lines[last + 1] === '') last++;
      else if (lines[first - 1] === '') first--;
      lines.splice(first, last - first + 1);
    }
  }
  next[section].body = lines.join('\n');
  return next;
}

/** Keep arbitrary section names and untagged opening lines when switching views. */
export function lyricSections(text: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: { tag: string; lines: string[] } | undefined;
  const flush = (separator: boolean) => {
    if (!current) return;
    const lines = [...current.lines];
    if (separator && lines.at(-1) === '') lines.pop();
    sections.push({ tag: current.tag, body: lines.join('\n') });
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const tag = /^\[([^\]\n]+)\]\s*$/.exec(line);
    if (tag) {
      flush(true);
      current = { tag: tag[1], lines: [] };
    } else {
      if (!current) current = { tag: '', lines: [] };
      current.lines.push(line);
    }
  }
  flush(false);
  return sections;
}

export const sectionText = (sections: LyricSection[]) => sections.map(({ tag, body }) => `${tag.trim() ? `[${tag}]\n` : ''}${body}`).join('\n\n');

export function writerInstruction(idea: string, language: string, lines: string, extra: string): string {
  return [idea.trim(), language.trim() && `Write the sung lyrics in ${language.trim()} and name that vocal language first in the style.`,
    lines && `Write exactly ${lines} sung lines in total, excluding section tags. Repeat the chorus where the song repeats it.`, extra.trim()].filter(Boolean).join('\n\n');
}
