//! The words of a karaoke MIDI file: lyrics YuE2 can sing, and the ticks their
//! sections begin at.
//!
//! Files in the .kar layout keep the syllables as text events, with lines
//! starting '@' for headers, '\' starting a paragraph and '/' a line; other
//! files use lyric events and end a line with a carriage return or a newline.
//! Lyric events win when a file has enough of them. A paragraph is a section;
//! so is the start of a verse after two bars of 4/4 of silence in a file that
//! marks no paragraphs, and an empty line ends one too. A paragraph whose words
//! repeat an earlier one's is the chorus, and so is that earlier one; the rest
//! are verses, unless a marker named after a section sits near its start. The
//! encoding is guessed once from all the syllables together. Ported from
//! YuE2-ComfyUI's `midi/karaoke.py`.

use std::sync::OnceLock;

use regex::Regex;

use super::super::{sections, smf};
use super::parts;

/// Fewer timed syllables than this are a title or a credit, not the words of a song.
const LEAST_SYLLABLES: usize = 8;
/// Quarter notes of silence between syllables that start a new section in a file marking no paragraphs.
const PAUSE_QUARTERS: u64 = 8;
/// Quarter notes either side of a paragraph's first syllable a marker may sit and still name it.
const MARKER_REACH: u64 = 4;

#[derive(Clone, Debug)]
pub struct Section {
    pub tick: u64,
    pub tag: String,
    pub label: String,
    pub lines: Vec<String>,
}

/// A song's words in sections, and the tick of every syllable that is sung.
#[derive(Clone, Debug)]
pub struct Words {
    pub sections: Vec<Section>,
    pub syllables: Vec<u64>,
}

impl Words {
    /// The words as lyrics for YuE2: a tag above each section, a blank line between sections.
    pub fn lyrics(&self) -> String {
        self.sections.iter().map(|section| format!("[{}]\n{}", section.tag, section.lines.join("\n"))).collect::<Vec<_>>().join("\n\n")
    }
}

fn labels() -> &'static Vec<&'static str> {
    static LABELS: OnceLock<Vec<&'static str>> = OnceLock::new();
    LABELS.get_or_init(|| {
        let mut labels: Vec<&'static str> = sections::TAGS.iter().map(|(label, _)| *label).collect();
        labels.sort_by_key(|label| std::cmp::Reverse(label.chars().count()));
        labels
    })
}

/// The section a marker names, as a label the section tags know: 'Chorus 2' is 'chorus'.
pub fn section_label(text: &str) -> Option<&'static str> {
    let clean = text.to_lowercase().replace('_', " ").split_whitespace().collect::<Vec<_>>().join(" ");
    labels().iter().copied().find(|label| {
        clean.strip_prefix(label).is_some_and(|rest| rest.chars().next().is_none_or(|next| next.is_whitespace() || next.is_numeric() || matches!(next, ':' | '.' | '-')))
    })
}

/// `(tick, label)` for every marker that names a section, in order.
pub fn marker_sections(song: &smf::Song) -> Vec<(u64, &'static str)> {
    song.markers.iter().filter_map(|(tick, payload)| section_label(&parts::decode(payload)).map(|label| (*tick, label))).collect()
}

fn syllables(song: &smf::Song) -> Vec<(u64, Vec<u8>)> {
    let mut lyric: Vec<(u64, Vec<u8>)> = song
        .tracks
        .iter()
        .flat_map(|track| track.texts.iter())
        .filter(|(_, kind, payload)| *kind == smf::LYRIC && !payload.starts_with(b"@"))
        .map(|(tick, _, payload)| (*tick, payload.clone()))
        .collect();
    if lyric.len() >= LEAST_SYLLABLES {
        lyric.sort_by_key(|(tick, _)| *tick);
        return lyric;
    }
    let mut best: Vec<(u64, Vec<u8>)> = Vec::new();
    for track in &song.tracks {
        let found: Vec<(u64, Vec<u8>)> = track.texts.iter().filter(|(_, kind, payload)| *kind == smf::TEXT && !payload.starts_with(b"@")).map(|(tick, _, payload)| (*tick, payload.clone())).collect();
        if found.len() > best.len() {
            best = found;
        }
    }
    if best.len() >= LEAST_SYLLABLES { best } else { Vec::new() }
}

fn folded(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Sections of lines, filled a syllable at a time.
#[derive(Default)]
struct Builder {
    sections: Vec<(u64, Vec<String>)>,
    lines: Vec<String>,
    line: String,
    start: Option<u64>,
}

impl Builder {
    fn add(&mut self, tick: u64, text: &str) {
        if !text.trim().is_empty() && self.start.is_none() {
            self.start = Some(tick);
        }
        self.line.push_str(text);
    }

    fn end_line(&mut self) {
        let text = folded(&self.line);
        self.line.clear();
        if !text.is_empty() {
            self.lines.push(text);
        } else if !self.lines.is_empty() {
            self.end_section();
        }
    }

    fn end_section(&mut self) {
        let text = folded(&self.line);
        self.line.clear();
        if !text.is_empty() {
            self.lines.push(text);
        }
        if !self.lines.is_empty() {
            let start = self.start.expect("a line of words starts at its first syllable");
            self.sections.push((start, std::mem::take(&mut self.lines)));
        }
        self.lines.clear();
        self.start = None;
    }
}

fn non_word() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\W+").expect("a valid pattern"))
}

fn tagged(found: Vec<(u64, Vec<String>)>, song: &smf::Song) -> Vec<Section> {
    let keys: Vec<String> = found.iter().map(|(_, lines)| non_word().replace_all(&lines.join(" ").to_lowercase(), "").into_owned()).collect();
    let mut tags: Vec<String> = vec!["Verse".to_string(); found.len()];
    for index in 0..keys.len() {
        for earlier in 0..index {
            if !keys[index].is_empty() && keys[earlier] == keys[index] {
                tags[index] = "Chorus".to_string();
                tags[earlier] = "Chorus".to_string();
            }
        }
    }
    let markers = marker_sections(song);
    let reach = MARKER_REACH * song.division as u64;
    found
        .into_iter()
        .zip(tags)
        .map(|((tick, lines), tag)| {
            let near = markers.iter().filter(|(at, _)| at.abs_diff(tick) <= reach).map(|(at, label)| (at.abs_diff(tick), *label)).min();
            let tag = near.map(|(_, label)| sections::tag_of(label).to_string()).unwrap_or(tag);
            Section { tick, label: tag.to_lowercase(), tag, lines }
        })
        .collect()
}

fn line_breaks() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\r\n|\r|\n").expect("a valid pattern"))
}

/// The song's words, or None when the file carries no timed words.
pub fn read(song: &smf::Song) -> Option<Words> {
    let syllables = syllables(song);
    if syllables.is_empty() {
        return None;
    }
    let encoding = parts::encoding_of(&syllables.iter().map(|(_, payload)| payload.as_slice()).collect::<Vec<_>>().join(&b' '));
    let pause = PAUSE_QUARTERS * song.division as u64;
    let mut builder = Builder::default();
    let mut previous: Option<u64> = None;
    for (tick, payload) in &syllables {
        let text = parts::text_of(payload, encoding);
        if previous.is_some_and(|previous| tick - previous >= pause) && (!builder.lines.is_empty() || !builder.line.trim().is_empty()) {
            builder.end_section();
        }
        previous = Some(*tick);
        let piece = if let Some(rest) = text.strip_prefix('\\') {
            builder.end_section();
            rest
        } else if let Some(rest) = text.strip_prefix('/') {
            builder.end_line();
            rest
        } else {
            text.as_str()
        };
        let mut pieces = line_breaks().split(piece);
        builder.add(*tick, pieces.next().unwrap_or(""));
        for rest in pieces {
            builder.end_line();
            builder.add(*tick, rest);
        }
    }
    builder.end_section();
    if builder.sections.is_empty() {
        return None;
    }
    let sections = tagged(std::mem::take(&mut builder.sections), song);
    let sung = syllables.iter().filter(|(_, payload)| !parts::text_of(payload, encoding).trim_matches([' ', '\\', '/', '\r', '\n']).is_empty()).map(|(tick, _)| *tick).collect();
    Some(Words { sections, syllables: sung })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_name_their_section() {
        assert_eq!(section_label("Chorus 2"), Some("chorus"));
        assert_eq!(section_label("Pre-Chorus_1"), Some("pre-chorus"));
        assert_eq!(section_label("PRE_CHORUS"), None);
        assert_eq!(section_label("Verse:"), Some("verse"));
        assert_eq!(section_label("Choruses"), None);
        assert_eq!(section_label("intro and verse"), Some("intro and verse"));
    }

    #[test]
    fn kar_paragraphs_become_sections_and_a_repeated_one_is_the_chorus() {
        let texts: Vec<(u64, u8, Vec<u8>)> = [
            "@TTitle", "\\Hel", "lo ", "world", "/Sing ", "a", "long", "\\La ", "la ", "la", "/la ", "la", "\\Hel", "lo ", "world", "/Sing ", "a", "long",
        ]
        .iter()
        .enumerate()
        .map(|(index, text)| (index as u64 * 240, smf::TEXT, text.as_bytes().to_vec()))
        .collect();
        let track = smf::Track { texts, ..smf::Track::default() };
        let song = smf::Song { division: 480, tracks: vec![track], ..smf::Song::default() };
        let words = read(&song).unwrap();
        assert_eq!(words.lyrics(), "[Chorus]\nHello world\nSing along\n\n[Verse]\nLa la la\nla la\n\n[Chorus]\nHello world\nSing along");
        assert_eq!(words.sections[1].tick, 7 * 240);
        assert_eq!(words.syllables.len(), 17);
    }
}
