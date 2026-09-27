//! Loudness measurement for volume normalisation. Files with ReplayGain tags are levelled from the
//! tags (in the frontend); everything else is measured here once, with EBU R128 integrated loudness
//! (the measure ReplayGain 2 and streaming services use), and cached per file in SQLite. The
//! frontend asks for the next songs while the current one plays, so a song's gain is known before
//! it starts and never changes mid-song.

use std::fs;
use std::io::BufReader;
use std::path::Path;

use ebur128::{EbuR128, Mode};
use rodio::{Decoder, Source};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AmplyError, AmplyResult};
use crate::scan_index::Stamp;
use crate::storage;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    /// Integrated loudness in LUFS.
    pub lufs: f64,
    /// Highest absolute sample value (1.0 = full scale).
    pub peak: f64,
}

pub(crate) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS loudness (
            path TEXT PRIMARY KEY,
            modified_ms INTEGER NOT NULL,
            size INTEGER NOT NULL,
            lufs REAL NOT NULL,
            peak REAL NOT NULL
         );",
    )
    .map_err(|err| err.to_string())
}

fn cached(conn: &Connection, path: &str, stamp: Stamp) -> Result<Option<Loudness>, String> {
    conn.query_row(
        "SELECT lufs, peak FROM loudness WHERE path = ?1 AND modified_ms = ?2 AND size = ?3",
        params![path, stamp.modified_ms, stamp.size],
        |row| Ok(Loudness { lufs: row.get(0)?, peak: row.get(1)? }),
    )
    .optional()
    .map_err(|err| err.to_string())
}

fn store(conn: &Connection, path: &str, stamp: Stamp, loudness: Loudness) -> Result<(), String> {
    conn.execute(
        "INSERT INTO loudness (path, modified_ms, size, lufs, peak) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET modified_ms = ?2, size = ?3, lufs = ?4, peak = ?5",
        params![path, stamp.modified_ms, stamp.size, loudness.lufs, loudness.peak],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

/// Decodes the whole file and measures it. None for silence or an undecodable file.
pub(crate) fn measure(path: &Path) -> Option<Loudness> {
    let file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let decoder = Decoder::builder()
        .with_data(BufReader::new(file))
        .with_byte_len(len)
        .with_seekable(true)
        .build()
        .ok()?;
    let channels = u32::from(decoder.channels().get());
    let rate = decoder.sample_rate().get();
    let mut meter = EbuR128::new(channels, rate, Mode::I).ok()?;

    // Feed in blocks of whole frames; a one-sample-at-a-time loop would be far slower.
    const FRAMES_PER_BLOCK: usize = 4096;
    let block_len = FRAMES_PER_BLOCK * channels as usize;
    let mut block = Vec::with_capacity(block_len);
    let mut peak = 0f32;
    for sample in decoder {
        peak = peak.max(sample.abs());
        block.push(sample);
        if block.len() == block_len {
            meter.add_frames_f32(&block).ok()?;
            block.clear();
        }
    }
    let whole_frames = block.len() - block.len() % channels as usize;
    if whole_frames > 0 {
        meter.add_frames_f32(&block[..whole_frames]).ok()?;
    }
    let lufs = meter.loudness_global().ok()?;
    // Digital silence measures as -inf; there is nothing to level.
    (lufs.is_finite() && peak > 0.0).then_some(Loudness { lufs, peak: f64::from(peak) })
}

/// Cached loudness for `path`, measuring (and caching) it when the file is new or changed.
fn loudness_for(db: Option<&storage::StorageDb>, path: &str) -> Option<Loudness> {
    let stamp = Stamp::of(&fs::metadata(path).ok()?);
    if let Some(db) = db {
        match db.with_conn(|conn| cached(conn, path, stamp)) {
            Ok(Some(hit)) => return Some(hit),
            Ok(None) => {}
            Err(error) => log::warn!("Loudness cache read failed: {error}"),
        }
    }
    let measured = measure(Path::new(path))?;
    if let Some(db) = db {
        if let Err(error) = db.with_conn(|conn| store(conn, path, stamp, measured)) {
            log::warn!("Loudness cache write failed: {error}");
        }
    }
    Some(measured)
}

/// Loudness of each file in `paths` (None where it cannot be measured), positionally aligned.
#[tauri::command]
pub async fn audio_track_loudness(app: tauri::AppHandle, paths: Vec<String>) -> AmplyResult<Vec<Option<Loudness>>> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = storage::storage_db(&app).ok();
        paths.iter().map(|path| loudness_for(db.as_deref(), path)).collect()
    })
    .await
    .map_err(|err| AmplyError::Other(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_misses_on_a_changed_file() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let stamp = Stamp { modified_ms: 10, size: 100 };
        let value = Loudness { lufs: -9.5, peak: 0.98 };
        store(&conn, "D:\\a.mp3", stamp, value).unwrap();
        assert_eq!(cached(&conn, "D:\\a.mp3", stamp).unwrap(), Some(value));
        assert_eq!(cached(&conn, "D:\\a.mp3", Stamp { modified_ms: 11, size: 100 }).unwrap(), None);
    }

    /// Measures a few real files: `AMPLY_TEST_SONGS="D:/Songs i like" cargo test --release -- --ignored loudness_real_files --nocapture`.
    #[test]
    #[ignore]
    fn loudness_real_files() {
        let folder = std::env::var("AMPLY_TEST_SONGS").expect("set AMPLY_TEST_SONGS");
        let files: Vec<_> = fs::read_dir(folder)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| crate::library::is_supported_audio(path))
            .take(8)
            .collect();
        for path in files {
            let started = std::time::Instant::now();
            let loudness = measure(&path).expect("measurable");
            eprintln!(
                "{:>6.1} LUFS  peak {:.3}  {:>5} ms  {}",
                loudness.lufs,
                loudness.peak,
                started.elapsed().as_millis(),
                path.file_name().unwrap().to_string_lossy()
            );
            assert!((-40.0..0.0).contains(&loudness.lufs));
        }
    }
}
