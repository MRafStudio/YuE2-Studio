//! Lyrics laid along four bare tunes by YuE2-ComfyUI, laid again here, with the
//! syllables and section labels it counts. `expected.json` is the reference's
//! own output; its notices name 'max_seconds', where the studio says
//! "an automatic length".

use serde_json::Value;

use super::{label_of, lay, syllables};

fn expected() -> Value {
    serde_json::from_str(include_str!("expected.json")).expect("the reference output is JSON")
}

#[test]
fn lyrics_are_laid_along_a_bare_tune_the_way_the_reference_lays_them() {
    let expected = expected();
    for (name, wanted) in expected["laid"].as_object().unwrap() {
        let laid = lay(wanted["input"].as_str().unwrap(), wanted["lyrics"].as_str().unwrap()).unwrap_or_else(|| panic!("{name}: not laid"));
        assert_eq!(laid.score, wanted["score"].as_str().unwrap(), "{name}: the score");
        assert!((laid.seconds - wanted["seconds"].as_f64().unwrap()).abs() < 1e-9, "{name}: {} seconds", laid.seconds);
        let notices: Vec<Value> = laid.notices.iter().map(|(level, text)| serde_json::json!([level, text])).collect();
        let wanted_notices: Vec<Value> = wanted["notices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|notice| serde_json::json!([notice[0], notice[1].as_str().unwrap().replace("with 'max_seconds' at 0", "with an automatic length")]))
            .collect();
        assert_eq!(notices, wanted_notices, "{name}: the notices");
    }
}

#[test]
fn a_named_score_and_lyrics_without_a_sung_line_are_sung_as_they_come() {
    let expected = expected();
    let input = expected["laid"]["band"]["input"].as_str().unwrap();
    assert!(lay(&format!("{input}\n% verse"), "La la la").is_none());
    assert!(lay(input, "[Intro]\n\n[Outro]\n...").is_none());
}

#[test]
fn syllables_and_labels_are_counted_as_the_reference_counts_them() {
    let expected = expected();
    for (word, count) in expected["syllables"].as_object().unwrap() {
        assert_eq!(syllables(word) as u64, count.as_u64().unwrap(), "{word}");
    }
    for (tag, label) in expected["labels"].as_object().unwrap() {
        assert_eq!(label_of(tag), label.as_str().unwrap(), "{tag}");
    }
}
