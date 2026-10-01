//! Keys and chords named the way the key they sound in names them: B-flat,
//! not A-sharp, in F; `K:Bbm`, not `K:A#m`. A key takes the name with fewer
//! accidentals in its signature, and of two with six the sharp one. A chord
//! takes the root that brings its tones closest to the key's own notes on the
//! line of fifths, the root counted twice, the first letter from C to B on a
//! tie. Only names change: the pitch, time, quality and inversion stay.
//! Ported from YuE2-ComfyUI's `sheetsage/spelling.py`.

use super::Q;

const LETTERS: [char; 7] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];
/// Each letter's place on the line of fifths, C at 0.
const FIFTHS: [i32; 7] = [0, 2, 4, -1, 1, 3, 5];

/// How many fifths a key's tonic lies above the major key that shares its signature.
fn mode_shift(mode: &str) -> Option<i32> {
    match mode {
        "major" => Some(0),
        "minor" => Some(3),
        _ => None,
    }
}

/// Every quality the model names, as its tones' steps along the line of fifths from the root, root first.
fn tones(quality: &str) -> Option<&'static [i32]> {
    Some(match quality {
        "maj" => &[0, 4, 1],
        "min" => &[0, -3, 1],
        "dim" => &[0, -3, -6],
        "aug" => &[0, 4, 8],
        "maj7" => &[0, 4, 1, 5],
        "min7" => &[0, -3, 1, -2],
        "7" => &[0, 4, 1, -2],
        "hdim7" => &[0, -3, -6, -2],
        "dim7" => &[0, -3, -6, -9],
        "minmaj7" => &[0, -3, 1, 5],
        "sus2" => &[0, 2, 1],
        "sus4" => &[0, -1, 1],
        "sus4(b7)" => &[0, -1, 1, -2],
        "maj6" => &[0, 4, 1, 3],
        "min6" => &[0, -3, 1, 3],
        _ => return None,
    })
}

/// `(letter, alteration)` of a pitch name such as `A#` or `Bb`, with at most two accidentals of one kind.
fn parts(name: &str) -> Option<(usize, i32)> {
    let mut characters = name.chars();
    let first = characters.next()?;
    let letter = LETTERS.iter().position(|each| *each == first)?;
    let alteration = match characters.as_str() {
        "" => 0,
        "#" => 1,
        "##" => 2,
        "b" => -1,
        "bb" => -2,
        _ => return None,
    };
    Some((letter, alteration))
}

fn pitch_class(letter: usize, alteration: i32) -> i32 {
    (NATURAL[letter] + alteration).rem_euclid(12)
}

fn place(letter: usize, alteration: i32) -> i32 {
    FIFTHS[letter] + 7 * alteration
}

fn named(letter: usize, alteration: i32) -> String {
    let accidental = if alteration > 0 { "#".repeat(alteration as usize) } else { "b".repeat((-alteration) as usize) };
    format!("{}{accidental}", LETTERS[letter])
}

/// Every letter that can name a pitch class, C to B, each with the alteration it needs (-6 to 5).
fn spellings(pitch_class: i32) -> impl Iterator<Item = (usize, i32)> {
    (0..7).map(move |letter| (letter, (pitch_class - NATURAL[letter] + 6).rem_euclid(12) - 6))
}

fn key_parts(label: &str) -> Option<((usize, i32), &str)> {
    let (tonic, mode) = label.split_once(':').unwrap_or((label, ""));
    mode_shift(mode)?;
    Some((parts(tonic)?, mode))
}

/// A key label such as `A#:minor` under the name whose signature reads easiest, `Bb:minor`; anything else as it is.
pub fn key_name(label: &str) -> String {
    let Some(((letter, alteration), mode)) = key_parts(label) else {
        return label.to_string();
    };
    let shift = mode_shift(mode).unwrap_or(0);
    let mut best: Option<((i32, bool), (usize, i32))> = None;
    for spelled in spellings(pitch_class(letter, alteration)).filter(|(_, alteration)| alteration.abs() <= 1) {
        let at = place(spelled.0, spelled.1);
        let rank = ((at - shift).abs(), at < shift);
        if best.is_none_or(|(kept, _)| rank < kept) {
            best = Some((rank, spelled));
        }
    }
    let (_, (letter, alteration)) = best.expect("every pitch class has a name with at most one accidental");
    format!("{}:{mode}", named(letter, alteration))
}

/// How many sharps a key label is written with once it is named well, flats counted negative.
fn signature(label: &str) -> Option<i32> {
    let named = key_name(label);
    let ((letter, alteration), mode) = key_parts(&named)?;
    Some(place(letter, alteration) - mode_shift(mode)?)
}

/// A chord label such as `D#:maj/3` with its root named from `key`: `Eb:maj/3` in C minor.
/// No chord, a quality the model does not have, or a key that is no major or minor key label leaves it as it is.
pub fn chord_name(label: &str, key: &str) -> String {
    if matches!(label, "N" | "X") || key_parts(key).is_none() {
        return label.to_string();
    }
    let Some((root, rest)) = label.split_once(':') else {
        return label.to_string();
    };
    let quality = rest.split('/').next().unwrap_or(rest);
    let (Some((letter, alteration)), Some(steps), Some(centre)) = (parts(root), tones(quality), signature(key).map(|value| value + 2)) else {
        return label.to_string();
    };
    let cost = |(letter, alteration): (usize, i32)| -> i32 {
        let places: Vec<i32> = steps.iter().map(|step| place(letter, alteration) + step).collect();
        places.iter().chain(places.first()).map(|at| ((at - centre).abs() - 3).max(0)).sum()
    };
    let mut best: Option<(i32, (usize, i32))> = None;
    for spelled in spellings(pitch_class(letter, alteration)) {
        let value = cost(spelled);
        if best.is_none_or(|(kept, _)| value < kept) {
            best = Some((value, spelled));
        }
    }
    let (_, (letter, alteration)) = best.expect("seven letters name every pitch class");
    format!("{}:{rest}", named(letter, alteration))
}

/// Chord rows named from the key sounding at each one's midpoint. A midpoint exactly where one key gives
/// way to the next goes by the key that ends there; with no key at all the labels stay as they are.
pub fn respelled(chords: &[(Q, Q, String)], keys: &[(Q, Q, String)]) -> Vec<(Q, Q, String)> {
    if keys.is_empty() {
        return chords.to_vec();
    }
    let ends: Vec<Q> = keys[..keys.len() - 1].iter().map(|(_, end, _)| *end).collect();
    chords
        .iter()
        .map(|(start, end, label)| {
            let middle = (*start + *end) / Q::int(2);
            let at = ends.partition_point(|value| *value < middle);
            (*start, *end, chord_name(label, &keys[at].2))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_take_the_name_with_the_easier_signature() {
        assert_eq!(key_name("A#:minor"), "Bb:minor");
        assert_eq!(key_name("C#:major"), "Db:major");
        assert_eq!(key_name("F#:major"), "F#:major");
        assert_eq!(key_name("D#:minor"), "D#:minor");
        assert_eq!(key_name("G#:major"), "Ab:major");
        assert_eq!(key_name("not a key"), "not a key");
    }

    #[test]
    fn chords_are_named_from_the_key_they_sound_in() {
        assert_eq!(chord_name("D#:maj/3", "C:minor"), "Eb:maj/3");
        assert_eq!(chord_name("A#:maj", "F:major"), "Bb:maj");
        assert_eq!(chord_name("C#:hdim7", "G:major"), "C#:hdim7");
        assert_eq!(chord_name("F:hdim7", "G#:minor"), "E#:hdim7");
        assert_eq!(chord_name("N", "C:major"), "N");
        assert_eq!(chord_name("C:weird", "C:major"), "C:weird");
    }

    #[test]
    fn a_chord_on_a_key_change_goes_by_the_key_that_ends_there() {
        let keys = vec![(Q::ZERO, Q::int(4), "F:major".to_string()), (Q::int(4), Q::int(8), "E:major".to_string())];
        let chords = vec![(Q::int(2), Q::int(6), "A#:maj".to_string()), (Q::int(5), Q::int(7), "A#:maj".to_string())];
        let named: Vec<String> = respelled(&chords, &keys).into_iter().map(|(_, _, label)| label).collect();
        assert_eq!(named, ["Bb:maj", "A#:maj"]);
    }
}
