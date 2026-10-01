//! Chord symbols from what a MIDI file's parts play, for a score with chords:
//! read from a chords track, or guessed.
//!
//! A track named Chords, the one "Save as MIDI" writes, is read chord by
//! chord: a chord starts wherever a note of the track starts and is the notes
//! struck there with the ones carried over that sound for at least half of it.
//! Those notes are named only when they are exactly one of the fifteen chords
//! the score format knows, with a bass under it; the layout that track has, the
//! root from C3 with the chord above and a slash bass below C3, decides the
//! sets that are two chords at once. A set that is no chord of the format gets
//! the chord the guess gives it, and its bars are named.
//!
//! Without such a track the harmony is guessed per half bar (or per bar where
//! the meter has no even number of beats from four up): the pitch classes
//! sounding are weighed by how long they sound, the voice at half weight, the
//! lowest note gets a bonus, and seven chord shapes on every root are compared,
//! a shape all in the key needing a little less evidence. A piece where no two
//! pitch classes ever sound at once is no chord. Roots are named with sharps;
//! the score names them from its key afterwards. Ported from YuE2-ComfyUI's
//! `midi/chords.py`.

use std::collections::BTreeSet;

use super::super::{export, rebuild, Q};

const DEGREES: [&str; 12] = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];

/// Each chord shape: its quality, its steps above the root, and what it costs against a plain triad.
const SHAPES: [(&str, &[i32], f64); 7] = [
    ("maj", &[0, 4, 7], 0.0),
    ("min", &[0, 3, 7], 0.0),
    ("7", &[0, 4, 7, 10], 0.03),
    ("maj7", &[0, 4, 7, 11], 0.03),
    ("min7", &[0, 3, 7, 10], 0.03),
    ("dim", &[0, 3, 6], 0.03),
    ("sus4", &[0, 5, 7], 0.05),
];

/// The lowest note's bonus weight, as a share of all the weight in the piece.
const BASS_SHARE: f64 = 0.35;
const ROOT_BONUS: f64 = 0.05;
const IN_KEY_BONUS: f64 = 0.02;
pub const VOICE_WEIGHT: f64 = 0.5;
/// A pitch class with less than this share of a piece's weight does not count towards it being a chord.
const QUIET_SHARE: f64 = 0.1;

/// The steps above the root of every quality the score format knows, under the labels the writer reads.
fn steps() -> impl Iterator<Item = (&'static str, &'static [i32])> {
    rebuild::QUALITY_TEXT.iter().map(|(label, text)| {
        let steps = export::QUALITY_STEPS.iter().find(|(name, _)| name == text).map(|(_, steps)| *steps).expect("every quality has its steps");
        (*label, steps)
    })
}

/// A bass named as its degree above the root, chord tones as the chord spells them.
fn tone_degree(quality: &str, step: i32) -> Option<&'static str> {
    match (quality, step) {
        ("dim" | "hdim7" | "dim7", 6) => Some("b5"),
        ("dim7", 9) => Some("bb7"),
        ("aug", 8) => Some("#5"),
        _ => None,
    }
}

/// `(start, end)` of each piece of harmony, from bars given as `(start, end, numerator)`.
pub fn spans(bars: &[(Q, Q, i64)]) -> Vec<(Q, Q)> {
    let mut found = Vec::new();
    for &(start, end, numerator) in bars {
        if numerator >= 4 && numerator % 2 == 0 {
            let middle = start + (end - start) / Q::int(2);
            found.extend([(start, middle), (middle, end)]);
        } else {
            found.push((start, end));
        }
    }
    found
}

/// The chord, `C:min7` or `N` for none, that best fits twelve pitch-class weights and a bass pitch class.
pub fn label(weights: &[f64; 12], bass: usize, flats: bool, scale: Option<&BTreeSet<i32>>) -> String {
    let total: f64 = weights.iter().sum();
    if total <= 0.0 || weights.iter().filter(|weight| **weight >= QUIET_SHARE * total).count() < 2 {
        return "N".into();
    }
    let mut weights = *weights;
    weights[bass] += BASS_SHARE * total;
    let norm = weights.iter().map(|weight| weight * weight).sum::<f64>().sqrt();
    let names = if flats { rebuild::FLAT_NAMES } else { rebuild::SHARP_NAMES };
    let (mut best, mut best_score) = ("N".to_string(), f64::NEG_INFINITY);
    for root in 0..12 {
        for (quality, shape, cost) in SHAPES {
            let tones = || shape.iter().map(|step| ((root + step) % 12) as usize);
            let mut score = tones().map(|tone| weights[tone]).sum::<f64>() / (norm * (shape.len() as f64).sqrt()) - cost;
            if root as usize == bass {
                score += ROOT_BONUS;
            }
            if scale.is_some_and(|scale| tones().all(|tone| scale.contains(&(tone as i32)))) {
                score += IN_KEY_BONUS;
            }
            if score > best_score {
                best = format!("{}:{quality}", names[root as usize]);
                best_score = score;
            }
        }
    }
    best
}

/// Whether two different pitch classes ever sound at once among `(start, end, pitch class)`.
fn together(sounding: &[(Q, Q, i32)]) -> bool {
    let mut ordered = sounding.to_vec();
    ordered.sort();
    for (index, (_, end, pitch_class)) in ordered.iter().enumerate() {
        for (other_start, _, other_class) in &ordered[index + 1..] {
            if other_start >= end {
                break;
            }
            if other_class != pitch_class {
                return true;
            }
        }
    }
    false
}

/// `(start, end, chord)` for the pieces, from notes `(start, end, pitch, weight)`; equal neighbours merged.
pub fn guess(notes: &[(Q, Q, i32, f64)], pieces: &[(Q, Q)], flats: bool, scale: Option<&BTreeSet<i32>>) -> Vec<(Q, Q, String)> {
    let mut ordered = notes.to_vec();
    ordered.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)).then(a.3.total_cmp(&b.3)));
    let mut rows: Vec<(Q, Q, String)> = Vec::new();
    for &(start, end) in pieces {
        let mut weights = [0.0; 12];
        let mut sounding = Vec::new();
        let mut lowest: Option<i32> = None;
        for &(note_start, note_end, pitch, weight) in &ordered {
            if note_start >= end {
                break;
            }
            let overlap = end.min(note_end) - start.max(note_start);
            if overlap <= Q::ZERO {
                continue;
            }
            weights[pitch.rem_euclid(12) as usize] += overlap.to_f64() * weight;
            sounding.push((start.max(note_start), end.min(note_end), pitch.rem_euclid(12)));
            lowest = Some(lowest.map_or(pitch, |low| low.min(pitch)));
        }
        let chord = match lowest {
            Some(lowest) if together(&sounding) => label(&weights, lowest.rem_euclid(12) as usize, flats, scale),
            _ => "N".to_string(),
        };
        match rows.last_mut() {
            Some(last) if last.2 == chord && last.1 == start => last.1 = end,
            _ => rows.push((start, end, chord)),
        }
    }
    rows
}

/// `(root, quality)` of the chord made of exactly these pitch classes, a preferred root first.
fn shape(classes: &BTreeSet<i32>, prefer: &[i32]) -> Option<(i32, &'static str)> {
    let found: Vec<(i32, &'static str)> = steps()
        .flat_map(|(quality, steps)| (0..12).map(move |root| (root, quality, steps)))
        .filter(|(root, _, steps)| steps.iter().map(|step| (root + step) % 12).collect::<BTreeSet<i32>>() == *classes)
        .map(|(root, quality, _)| (root, quality))
        .collect();
    for root in prefer {
        if let Some(candidate) = found.iter().find(|(each, _)| each == root) {
            return Some(*candidate);
        }
    }
    found.first().copied()
}

/// The chord label, `A:min7/b7`, that pitches sounding together make exactly, or None when they make none.
pub fn spelled(pitches: &[i32]) -> Option<String> {
    let pitches: Vec<i32> = pitches.iter().copied().collect::<BTreeSet<i32>>().into_iter().collect();
    let classes: BTreeSet<i32> = pitches.iter().map(|pitch| pitch.rem_euclid(12)).collect();
    if classes.len() < 3 {
        return None;
    }
    let (bass, upper) = (pitches[0], &pitches[1..]);
    let above: BTreeSet<i32> = upper.iter().map(|pitch| pitch.rem_euclid(12)).collect();
    let mut tries: Vec<(&BTreeSet<i32>, Vec<i32>)> = Vec::new();
    if bass < export::CHORD_ROOT && export::CHORD_ROOT <= upper[0] {
        tries.push((&above, vec![upper[0].rem_euclid(12), bass.rem_euclid(12)]));
    }
    tries.push((&classes, vec![bass.rem_euclid(12), upper[0].rem_euclid(12)]));
    if !above.contains(&bass.rem_euclid(12)) {
        tries.push((&above, vec![upper[0].rem_euclid(12)]));
    }
    for (wanted, prefer) in tries {
        let Some((root, quality)) = shape(wanted, &prefer) else {
            continue;
        };
        let mut text = format!("{}:{quality}", rebuild::SHARP_NAMES[root as usize]);
        let step = (bass - root).rem_euclid(12);
        if step != 0 {
            text.push('/');
            text.push_str(tone_degree(quality, step).unwrap_or(DEGREES[step as usize]));
        }
        return Some(text);
    }
    None
}

/// `(start, end, chord)` from a chords track's notes `(start, end, pitch)` on the score's grid, the last
/// chord running to `end`, and the start of every chord whose notes are no chord of the score format.
pub fn read(notes: &[(usize, usize, i32)], end: usize, scale: Option<&BTreeSet<i32>>) -> (Vec<(usize, usize, String)>, Vec<usize>) {
    let onsets: Vec<usize> = notes.iter().map(|note| note.0).collect::<BTreeSet<usize>>().into_iter().collect();
    let mut rows: Vec<(usize, usize, String)> = Vec::new();
    let mut unnamed = Vec::new();
    for (index, &onset) in onsets.iter().enumerate() {
        let stop = onsets.get(index + 1).copied().unwrap_or_else(|| end.max(onset + 1));
        let sounding: Vec<i32> = notes
            .iter()
            .filter(|(start, finish, _)| *start == onset || (*start < onset && onset < *finish && 2 * (finish.min(&stop) - onset) >= stop - onset))
            .map(|(_, _, pitch)| *pitch)
            .collect();
        let chord = match spelled(&sounding) {
            Some(chord) => chord,
            None => {
                unnamed.push(onset);
                let mut weights = [0.0; 12];
                for pitch in &sounding {
                    weights[pitch.rem_euclid(12) as usize] += 1.0;
                }
                let lowest = sounding.iter().copied().min().expect("a chord starts with a note");
                label(&weights, lowest.rem_euclid(12) as usize, false, scale)
            }
        };
        match rows.last_mut() {
            Some(last) if last.2 == chord && last.1 == onset => last.1 = stop,
            _ => rows.push((onset, stop, chord)),
        }
    }
    (rows, unnamed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_layout_save_as_midi_writes_decides_two_chords_at_once() {
        assert_eq!(spelled(&[48, 52, 55, 57]).as_deref(), Some("C:maj6"));
        assert_eq!(spelled(&[45, 48, 52, 55]).as_deref(), Some("C:maj/6"));
        assert_eq!(spelled(&[48, 57, 60, 64, 67]).as_deref(), Some("C:maj6"));
        assert_eq!(spelled(&[48, 55]), None);
        assert_eq!(spelled(&[47, 50, 53, 56]).as_deref(), Some("D:dim/6"));
    }

    #[test]
    fn a_guess_follows_the_weight_of_what_sounds_together() {
        let scale: BTreeSet<i32> = [0, 2, 4, 5, 7, 9, 11].into_iter().collect();
        let mut weights = [0.0; 12];
        for (pitch, weight) in [(0, 2.0), (4, 1.0), (7, 1.0)] {
            weights[pitch] = weight;
        }
        assert_eq!(label(&weights, 0, false, Some(&scale)), "C:maj");
        assert_eq!(label(&[0.0; 12], 0, false, None), "N");
        let notes = vec![(Q::int(0), Q::int(4), 48, 1.0), (Q::int(0), Q::int(4), 52, 1.0), (Q::int(0), Q::int(4), 55, 1.0), (Q::int(4), Q::int(8), 50, 1.0)];
        let rows = guess(&notes, &[(Q::int(0), Q::int(2)), (Q::int(2), Q::int(4)), (Q::int(4), Q::int(8))], false, Some(&scale));
        assert_eq!(rows, vec![(Q::int(0), Q::int(4), "C:maj".to_string()), (Q::int(4), Q::int(8), "N".to_string())]);
    }
}
