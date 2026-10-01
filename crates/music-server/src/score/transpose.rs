//! Moving a score to another key before it is sung.
//!
//! YuE2 has no key control of its own, and the K: field alone does not move a
//! song: the dialect reads every note relative to it. Moved as a whole -- every
//! note, chord symbol and key field by the same number of semitones -- the
//! model sings it that far from the original. The moved text is read back and
//! compared note by note before it is handed on.

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;

use super::abc::{self, Score, VOICES};

/// How far a move reaches either way, in semitones: one octave.
pub const TRANSPOSE_LIMIT: i32 = 12;

const LETTERS: [char; 7] = abc::LETTERS;

fn spelling(alteration: i32) -> &'static str {
    match alteration {
        -2 => "bb",
        -1 => "b",
        0 => "",
        1 => "#",
        _ => "##",
    }
}

fn name_shift(accidental: &str) -> i32 {
    match accidental {
        "#" => 1,
        "##" => 2,
        "b" => -1,
        "bb" => -2,
        _ => 0,
    }
}

fn mark_shift(mark: &str) -> i32 {
    match mark {
        "_" => -1,
        "__" => -2,
        "^" => 1,
        "^^" => 2,
        _ => 0,
    }
}

fn mark(alteration: i32) -> &'static str {
    match alteration {
        -2 => "__",
        -1 => "_",
        0 => "=",
        1 => "^",
        _ => "^^",
    }
}

fn key_name() -> &'static Regex {
    static KEY_NAME: OnceLock<Regex> = OnceLock::new();
    KEY_NAME.get_or_init(|| Regex::new(r"^([A-G])(#|b)?(m?)$").expect("key name pattern"))
}

fn chord_name() -> &'static Regex {
    static CHORD_NAME: OnceLock<Regex> = OnceLock::new();
    CHORD_NAME.get_or_init(|| Regex::new(r"^([A-G])(bb|##|b|#)?(.*?)(?:/([A-G])(bb|##|b|#)?)?$").expect("chord name pattern"))
}

fn token() -> &'static Regex {
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    TOKEN.get_or_init(|| {
        Regex::new(r#"^(?:"(?P<chord>[^"\n]*)"|\[K:(?P<key>[^\]\n]+)\]|(?P<acc>\^\^|__|\^|_|=)?(?P<note>[A-Ga-gz])(?P<oct>[,']*)(?P<duration>[0-9]*)(?P<tie>-?))"#).expect("token pattern")
    })
}

fn full_rest(bar: &str) -> bool {
    static FULL_REST: OnceLock<Regex> = OnceLock::new();
    FULL_REST.get_or_init(|| Regex::new(r"^\s*Z[2-4]?\s*$").expect("full rest pattern")).is_match(bar)
}

/// A moved score, with the key it started in and the key it ended in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Moved {
    pub text: String,
    pub before: String,
    pub after: String,
}

/// "up 2 semitones", "down 1 semitone" or "nowhere".
pub fn describe(semitones: i32) -> String {
    if semitones == 0 {
        return "nowhere".into();
    }
    format!("{} {} semitone{}", if semitones > 0 { "up" } else { "down" }, semitones.abs(), if semitones.abs() == 1 { "" } else { "s" })
}

fn pitch_class(letter: char, accidental: &str) -> i32 {
    (abc::natural(letter) + name_shift(accidental)).rem_euclid(12)
}

/// `(letter, alteration, mode)` of a key such as C#m; the mode is "" or "m".
fn key_parts(name: &str) -> Result<(char, i32, String), String> {
    let name = name.trim();
    let Some(found) = key_name().captures(name) else {
        return Err(format!("'{name}' is not a plain major or minor key"));
    };
    let letter = found[1].chars().next().expect("a letter");
    Ok((letter, name_shift(found.get(2).map_or("", |m| m.as_str())), found[3].to_string()))
}

fn note_text(letter: char, written: i32) -> String {
    let octave = (written - abc::natural(letter)).div_euclid(12);
    if octave >= 6 {
        format!("{}{}", letter.to_ascii_lowercase(), "'".repeat((octave - 6) as usize))
    } else {
        format!("{letter}{}", ",".repeat((5 - octave) as usize))
    }
}

/// `semitones` up, spelled `steps` letter names up: moving the names with the
/// sound keeps a score readable, C major up a tone is D major with F-sharp.
#[derive(Clone, Copy, Debug)]
struct Interval {
    semitones: i32,
    steps: i32,
}

impl Interval {
    /// A pitch-class name moved; a neighbouring letter only when the planned
    /// one would need more than a double accidental.
    fn name(&self, letter: char, alteration: i32) -> Result<(char, i32), String> {
        let index = abc::letter_index(letter) as i32 + self.steps;
        let target = (abc::natural(letter) + alteration + self.semitones).rem_euclid(12);
        for offset in [0, -1, 1] {
            let new_letter = LETTERS[(index + offset).rem_euclid(7) as usize];
            let new_alteration = (target - abc::natural(new_letter) + 6).rem_euclid(12) - 6;
            if new_alteration.abs() <= 2 {
                return Ok((new_letter, new_alteration));
            }
        }
        Err(format!("pitch class {target} has no spelling"))
    }

    /// A sounding note moved, as `(letter, natural MIDI pitch, alteration)`.
    fn note(&self, letter: char, written: i32, pitch: i32) -> Result<(char, i32, i32), String> {
        let octave = (written - abc::natural(letter)).div_euclid(12);
        let degree = abc::letter_index(letter) as i32 + 7 * octave + self.steps;
        let target = pitch + self.semitones;
        for offset in [0, -1, 1] {
            let moved = degree + offset;
            let new_letter = LETTERS[moved.rem_euclid(7) as usize];
            let new_written = 12 * moved.div_euclid(7) + abc::natural(new_letter);
            if (target - new_written).abs() <= 2 {
                return Ok((new_letter, new_written, target - new_written));
            }
        }
        Err(format!("MIDI pitch {target} has no spelling"))
    }

    /// A key field moved; a key the dialect has no name for is refused.
    fn key(&self, name: &str) -> Result<String, String> {
        let (letter, alteration, mode) = key_parts(name)?;
        let (new_letter, new_alteration) = self.name(letter, alteration)?;
        let moved = format!("{new_letter}{}{mode}", spelling(new_alteration));
        if abc::key_fifths(&moved).is_none() {
            return Err(format!("the key {} would become {moved}, which the score format has no name for", name.trim()));
        }
        Ok(moved)
    }

    /// A chord symbol moved: the root and any slash bass, the quality untouched.
    fn chord(&self, text: &str) -> Result<String, String> {
        let Some(found) = chord_name().captures(text) else {
            return Err(format!("'{text}' is not a chord symbol the score format knows"));
        };
        let root_letter = found[1].chars().next().expect("a root");
        let root = self.name(root_letter, name_shift(found.get(2).map_or("", |m| m.as_str())))?;
        let mut moved = format!("{}{}{}", root.0, spelling(root.1), &found[3]);
        if let Some(bass_letter) = found.get(4) {
            let bass = self.name(bass_letter.as_str().chars().next().expect("a bass"), name_shift(found.get(5).map_or("", |m| m.as_str())))?;
            moved.push('/');
            moved.push(bass.0);
            moved.push_str(spelling(bass.1));
        }
        Ok(moved)
    }
}

/// The move from `key` into whichever spelling of the new key reads easiest:
/// fewer accidentals, sharps on a tie, and letter names moved by as many
/// steps as fit the size of the move.
fn interval(key: &str, semitones: i32) -> Result<Interval, String> {
    if semitones.rem_euclid(12) == 0 {
        return Ok(Interval { semitones, steps: 7 * semitones.div_euclid(12) });
    }
    let (letter, alteration, mode) = key_parts(key)?;
    let tonic = (abc::natural(letter) + alteration + semitones).rem_euclid(12);
    let mut candidates = Vec::new();
    for (name, accidentals) in abc::keys() {
        let (c_letter, c_alteration, c_mode) = key_parts(name)?;
        if c_mode == mode && (abc::natural(c_letter) + c_alteration).rem_euclid(12) == tonic {
            candidates.push((accidentals.abs(), -accidentals, c_letter));
        }
    }
    let best = candidates.iter().min().ok_or_else(|| format!("no key is {} from {key}", describe(semitones)))?;
    let distance = (abc::letter_index(best.2) as i32 - abc::letter_index(letter) as i32).rem_euclid(7);
    let ideal = semitones as f64 * 7.0 / 12.0;
    let mut steps = distance - 7;
    for option in [distance, distance + 7] {
        if (option as f64 - ideal).abs() < (steps as f64 - ideal).abs() {
            steps = option;
        }
    }
    Ok(Interval { semitones, steps })
}

struct State {
    key: String,
    tie: Option<(i32, i32, i32)>,
}

fn interval_for(chosen: &mut HashMap<String, Interval>, key: &str, semitones: i32) -> Result<Interval, String> {
    if let Some(found) = chosen.get(key) {
        return Ok(*found);
    }
    let found = interval(key, semitones)?;
    chosen.insert(key.to_string(), found);
    Ok(found)
}

/// One measure of one voice, moved. An accidental is written only where the
/// new signature and the marks already written would give the wrong pitch,
/// so a move by 0 gives the score back character for character.
fn bar(text: &str, state: &mut State, chosen: &mut HashMap<String, Interval>, semitones: i32) -> Result<String, String> {
    if full_rest(text) {
        return Ok(text.to_string());
    }
    let mut source_key = state.key.clone();
    let mut interval = interval_for(chosen, &source_key, semitones)?;
    let mut target_key = interval.key(&source_key)?;
    let mut source_marks: HashMap<char, i32> = HashMap::new();
    let mut target_marks: HashMap<char, i32> = HashMap::new();
    let mut out = String::new();
    let mut cursor = 0;
    while cursor < text.len() {
        let rest = &text[cursor..];
        let first = rest.chars().next().expect("text left");
        if first.is_whitespace() {
            out.push(first);
            cursor += first.len_utf8();
            continue;
        }
        let Some(found) = token().captures(rest) else {
            let shown: String = rest.chars().take(24).collect();
            return Err(format!("unsupported notation at {}", abc::repr(&shown)));
        };
        let whole = found.get(0).expect("the whole match").as_str();
        cursor += whole.len();
        if let Some(chord) = found.name("chord") {
            out.push('"');
            out.push_str(&interval.chord(chord.as_str())?);
            out.push('"');
            continue;
        }
        if let Some(key) = found.name("key") {
            source_key = key.as_str().to_string();
            state.key = source_key.clone();
            interval = interval_for(chosen, &source_key, semitones)?;
            target_key = interval.key(&source_key)?;
            source_marks.clear();
            target_marks.clear();
            out.push_str("[K:");
            out.push_str(&target_key);
            out.push(']');
            continue;
        }
        let note = found.name("note").expect("a note or a rest").as_str().chars().next().expect("one letter");
        if note == 'z' {
            out.push_str(whole);
            continue;
        }
        let sign = found.name("acc").map_or("", |m| m.as_str());
        let octave = found.name("oct").map_or("", |m| m.as_str());
        let duration = found.name("duration").map_or("", |m| m.as_str());
        let tie = found.name("tie").map_or("", |m| m.as_str());
        let letter = note.to_ascii_uppercase();
        let mut written = 60 + abc::natural(letter) + if note.is_ascii_lowercase() { 12 } else { 0 };
        written += 12 * (octave.matches('\'').count() as i32 - octave.matches(',').count() as i32);
        let mut alteration = match source_marks.get(&letter) {
            Some(value) => *value,
            None => abc::key_accidentals(&source_key)?[abc::letter_index(letter)],
        };
        if !sign.is_empty() {
            alteration = mark_shift(sign);
            source_marks.insert(letter, alteration);
        }
        let mut pitch = written + alteration;
        let waiting = state.tie;
        if let Some((held, held_written, _)) = waiting {
            if sign.is_empty() && written == held_written {
                pitch = held;
            }
        }
        let (new_letter, new_written, new_alteration) = interval.note(letter, written, pitch)?;
        let signature = abc::key_accidentals(&target_key)?;
        let in_force = *target_marks.get(&new_letter).unwrap_or(&signature[abc::letter_index(new_letter)]);
        let new_mark = if waiting.is_some_and(|(_, _, held_new)| held_new == new_written) || in_force == new_alteration {
            ""
        } else {
            target_marks.insert(new_letter, new_alteration);
            mark(new_alteration)
        };
        out.push_str(new_mark);
        out.push_str(&note_text(new_letter, new_written));
        out.push_str(duration);
        out.push_str(tie);
        state.tie = if tie.is_empty() { None } else { Some((pitch, written, new_written)) };
    }
    Ok(out)
}

/// True when `after` is `before` with root and bass `semitones` higher.
fn chord_moved(before: &str, after: &str, semitones: i32) -> bool {
    let (Some(old), Some(new)) = (chord_name().captures(before), chord_name().captures(after)) else { return false };
    if old[3] != new[3] {
        return false;
    }
    let class = |found: &regex::Captures, letter: usize, accidental: usize| pitch_class(found[letter].chars().next().expect("a letter"), found.get(accidental).map_or("", |m| m.as_str()));
    if class(&new, 1, 2) != (class(&old, 1, 2) + semitones).rem_euclid(12) {
        return false;
    }
    if old.get(4).is_some() != new.get(4).is_some() {
        return false;
    }
    old.get(4).is_none() || class(&new, 4, 5) == (class(&old, 4, 5) + semitones).rem_euclid(12)
}

fn key_moved(before: &str, after: &str, semitones: i32) -> bool {
    match (key_parts(before), key_parts(after)) {
        (Ok((old_letter, old_alteration, old_mode)), Ok((new_letter, new_alteration, new_mode))) => {
            old_mode == new_mode && (abc::natural(new_letter) + new_alteration).rem_euclid(12) == (abc::natural(old_letter) + old_alteration + semitones).rem_euclid(12)
        }
        _ => false,
    }
}

/// The moved score against the original: only pitches may differ, all by `semitones`.
fn check(source: &Score, result: &Score, semitones: i32) -> Result<(), String> {
    if source.bpm != result.bpm || source.unit != result.unit {
        return Err("the tempo or the note length changed".into());
    }
    for (voice, name) in VOICES.iter().enumerate() {
        let (before, after) = (&source.voices[voice], &result.voices[voice]);
        if before.bars != after.bars {
            return Err(format!("the bars of the {name} part moved"));
        }
        if before.notes.len() != after.notes.len() || before.notes.iter().zip(&after.notes).any(|(old, new)| old.start != new.start || old.duration != new.duration || old.pitch + semitones != new.pitch) {
            return Err(format!("a note of the {name} part did not move by exactly {semitones}"));
        }
        if before.chords.len() != after.chords.len() || before.chords.iter().zip(&after.chords).any(|(old, new)| old.0 != new.0 || !chord_moved(&old.1, &new.1, semitones)) {
            return Err(format!("a chord of the {name} part did not move with its notes"));
        }
        if before.keys.len() != after.keys.len() || before.keys.iter().zip(&after.keys).any(|(old, new)| old.0 != new.0 || !key_moved(&old.1, &new.1, semitones)) {
            return Err(format!("a key change of the {name} part did not move"));
        }
    }
    Ok(())
}

/// `text` moved by `semitones`, or why it cannot be.
pub fn transpose(text: &str, semitones: i32) -> Result<Moved, String> {
    if semitones.abs() > TRANSPOSE_LIMIT {
        return Err(format!("A move of {semitones} semitones is outside -{TRANSPOSE_LIMIT} to {TRANSPOSE_LIMIT}."));
    }
    let source_text = text.trim();
    if source_text.is_empty() {
        return Err("There is no score to move.".into());
    }
    let mut chosen: HashMap<String, Interval> = HashMap::new();
    let inner = |chosen: &mut HashMap<String, Interval>| -> Result<(String, String), String> {
        let source = abc::parse(source_text)?;
        let lines = abc::split_keep(source_text);
        let header = lines[7].trim_end_matches(['\r', '\n'])[2..].to_string();
        let mut states = [State { key: header.clone(), tie: None }, State { key: header.clone(), tie: None }];
        let mut voice: Option<usize> = None;
        let mut output = String::new();
        for (index, raw) in lines.iter().enumerate() {
            let body = raw.trim_end_matches(['\r', '\n']);
            let ending = &raw[body.len()..];
            if index == 7 {
                output.push_str(&format!("K:{}{ending}", interval_for(chosen, &header, semitones)?.key(&header)?));
            } else if index < 8 {
                output.push_str(raw);
            } else if let Some(name) = body.strip_prefix("V: ") {
                voice = VOICES.iter().position(|each| *each == name.trim());
                output.push_str(raw);
            } else if let Some(key) = body.strip_prefix("K:") {
                let which = voice.ok_or_else(|| "a key field with no V: line above it".to_string())?;
                states[which].key = key.to_string();
                output.push_str(&format!("K:{}{ending}", interval_for(chosen, key, semitones)?.key(key)?));
            } else if let Some(&which) = source.music_lines.get(&index) {
                let mut moved = Vec::new();
                for piece in body[..body.len() - 1].split('|') {
                    moved.push(bar(piece, &mut states[which], chosen, semitones)?);
                }
                output.push_str(&format!("{}|{ending}", moved.join("|")));
            } else {
                output.push_str(raw);
            }
        }
        check(&source, &abc::parse(&output)?, semitones)?;
        Ok((output, header))
    };
    let (moved, header) = inner(&mut chosen).map_err(|reason| format!("This score cannot be moved {}: {reason}.\n\nThe key list only moves a score it can read note by note, so that the key is the one thing that changes.", describe(semitones)))?;
    let after = interval_for(&mut chosen, &header, semitones)?.key(&header)?;
    Ok(Moved { text: moved, before: header.trim().to_string(), after })
}
