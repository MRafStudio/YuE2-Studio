//! The score editor's routes. A problem with a score or an edit is something
//! the person editing needs to read, so it answers 200 with `ok: false` and
//! the reason; a request that is not what the editor sends is a 400.

use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{edits, export, notation, transpose};

type Answer = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn refused(reason: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": reason })))
}

fn problem(reason: String) -> Answer {
    Ok(Json(json!({ "ok": false, "error": reason })))
}

fn too_long(text: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if text.len() > notation::LONGEST {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, Json(json!({ "ok": false, "error": "That is far longer than any score." }))));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ReadRequest {
    abc: String,
}

/// A score as the roll draws it; one the model did not finish is drawn up to its last whole group.
pub async fn read(Json(request): Json<ReadRequest>) -> Answer {
    too_long(&request.abc)?;
    let edit = edits::read(&request.abc);
    let (text, cut) = notation::editable(&edit.score);
    match notation::read(&text) {
        Ok(sheet) => {
            let mut sheet = serde_json::to_value(sheet).map_err(|error| refused(&error.to_string()))?;
            sheet["cut"] = json!(cut);
            Ok(Json(json!({ "ok": true, "sheet": sheet, "words": edit.words, "keep": edit.keep })))
        }
        Err(reason) => problem(reason),
    }
}

#[derive(Deserialize)]
pub struct WriteRequest {
    abc: String,
    sheet: Value,
}

/// An edit written into the score: the new text, the bars written again, and the new text read back.
/// A cut score is written on its whole groups; an edit that changes nothing hands the score back as it came.
pub async fn write(Json(request): Json<WriteRequest>) -> Answer {
    too_long(&request.abc)?;
    let edit = edits::read(&request.abc);
    let (text, cut) = notation::editable(&edit.score);
    let written = match notation::write(&text, &request.sheet) {
        Ok(written) => written,
        Err(reason) => return problem(reason),
    };
    let sheet = match notation::read(&written.abc) {
        Ok(sheet) => sheet,
        Err(reason) => return problem(reason),
    };
    let same = cut && written.abc.trim() == text.trim();
    let mut sheet = serde_json::to_value(sheet).map_err(|error| refused(&error.to_string()))?;
    sheet["cut"] = json!(same);
    let abc = if same { edit.score } else { written.abc };
    Ok(Json(json!({ "ok": true, "abc": abc, "bars": written.bars, "sheet": sheet })))
}

#[derive(Deserialize)]
pub struct LengthRequest {
    abc: String,
    bars: i64,
    #[serde(default = "blank_bpm")]
    bpm: i64,
}

fn blank_bpm() -> i64 {
    notation::BLANK_BPM
}

/// A score made longer by empty bars, or a blank one of that many bars when there is none.
pub async fn length(Json(request): Json<LengthRequest>) -> Answer {
    too_long(&request.abc)?;
    let edit = edits::read(&request.abc);
    let made = if edit.score.trim().is_empty() {
        notation::blank(request.bars, request.bpm)
    } else {
        notation::lengthened(&notation::editable(&edit.score).0, request.bars)
    };
    let text = match made.and_then(|text| notation::read(&text).map(|_| text)) {
        Ok(text) => text,
        Err(reason) => return problem(reason),
    };
    Ok(Json(json!({ "ok": true, "abc": text })))
}

#[derive(Deserialize)]
pub struct TransposeRequest {
    abc: String,
    semitones: i32,
}

/// The whole score moved to another key: both parts, every chord and every key field together.
pub async fn transpose(Json(request): Json<TransposeRequest>) -> Answer {
    if request.semitones == 0 || request.semitones.abs() >= 12 {
        return Err(refused("'semitones' must be a whole number from -11 to 11, not 0."));
    }
    too_long(&request.abc)?;
    let edit = edits::read(&request.abc);
    let (text, _cut) = notation::editable(&edit.score);
    let moved = match transpose::transpose(&text, request.semitones) {
        Ok(moved) => moved,
        Err(reason) => return problem(format!("{} The score stays in the key it is in.", reason.split("\n\n").next().unwrap_or(&reason))),
    };
    let sheet = match notation::read(&moved.text) {
        Ok(sheet) => sheet,
        Err(reason) => return problem(reason),
    };
    let mut sheet = serde_json::to_value(sheet).map_err(|error| refused(&error.to_string()))?;
    sheet["cut"] = json!(false);
    Ok(Json(json!({ "ok": true, "abc": moved.text, "sheet": sheet, "before": moved.before, "after": moved.after })))
}

#[derive(Deserialize)]
pub struct MidiRequest {
    abc: String,
}

/// The score as a MIDI file, handed back as base64: voice, instrument and chords on tracks of their own.
pub async fn midi(Json(request): Json<MidiRequest>) -> Answer {
    too_long(&request.abc)?;
    let score = edits::read(&request.abc).score;
    let whole = notation::whole_groups(&score).unwrap_or(score);
    match export::midi_of(&whole) {
        Ok(data) => Ok(Json(json!({ "ok": true, "data": base64::engine::general_purpose::STANDARD.encode(data) }))),
        Err(reason) => problem(reason),
    }
}
