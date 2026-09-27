use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use lofty::{
    config::{ParseOptions, ParsingMode},
    file::TaggedFile,
    picture::{Picture, PictureType},
    prelude::{Accessor, AudioFile, TaggedFileExt},
    probe::Probe,
    tag::{ItemKey, Tag},
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, LazyLock, OnceLock};
use tauri::Manager;
use walkdir::{DirEntry, WalkDir};

use crate::error::{AmplyError, AmplyResult};
use crate::scan_index::{self, Stamp};
use crate::storage;

/// kv key holding the JSON array of canonical library roots.
pub(crate) const LIBRARY_ROOTS_KEY: &str = "library/roots.json";

/// Canonical library folders registered with the asset protocol scope.
/// `delete_song_file` refuses anything outside this set.
#[derive(Default)]
pub(crate) struct LibraryRoots(pub Mutex<Vec<PathBuf>>);

impl LibraryRoots {
    pub(crate) fn snapshot(&self) -> Vec<PathBuf> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }

    /// Returns `true` when `root` was not registered before.
    fn insert(&self, root: PathBuf) -> bool {
        let mut roots = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if roots.contains(&root) {
            false
        } else {
            roots.push(root);
            true
        }
    }
}

/// Resolves a user-facing library folder to an absolute, canonical path.
///
/// * empty / `None` → the platform music folder
/// * relative (the frontend default is `"music"`) → under the audio dir (or home)
/// * absolute → as given
///
/// The result is canonicalised with `dunce` when the folder exists so that
/// `starts_with` checks against canonicalised file paths are meaningful.
pub(crate) fn resolve_library_root(input: Option<&str>) -> PathBuf {
    let path = match input.map(str::trim).filter(|value| !value.is_empty()) {
        None => default_music_path(),
        // The frontend's legacy default `libraryPath` is the bare word "music": treat it as the
        // system Music folder rather than a `Music/music` subfolder that never exists.
        Some(value) if value.eq_ignore_ascii_case("music") => default_music_path(),
        Some(value) => {
            let candidate = PathBuf::from(value);
            if candidate.is_absolute() {
                candidate
            } else {
                dirs::audio_dir()
                    .or_else(dirs::home_dir)
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(candidate)
            }
        }
    };
    dunce::canonicalize(&path).unwrap_or(path)
}

/// Adds `root` to the asset protocol scope and to the managed root set.
/// Returns `true` when the root is new.
pub(crate) fn register_library_root(app: &tauri::AppHandle, roots: &LibraryRoots, root: &Path) -> bool {
    if let Err(error) = app.asset_protocol_scope().allow_directory(root, true) {
        log::warn!("Failed to allow asset protocol access to {}: {error}", root.display());
    }
    roots.insert(root.to_path_buf())
}

fn persist_library_roots_blocking(app: &tauri::AppHandle, roots: &[PathBuf]) -> Result<(), String> {
    let listed: Vec<String> = roots.iter().map(|root| root.to_string_lossy().to_string()).collect();
    let serialized = serde_json::to_string(&listed).map_err(|err| err.to_string())?;
    storage::storage_db(app)?.write_blocking(LIBRARY_ROOTS_KEY, &serialized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLibrarySettings {
    #[serde(default)]
    library_paths: Vec<String>,
    #[serde(default)]
    library_path: Option<String>,
}

/// Rebuilds the root set at startup from `library/roots.json` and the
/// frontend's `settings.json`, registering each with the asset protocol scope
/// before the webview loads. Must run after `StorageDb` is managed.
pub(crate) fn restore_library_roots(app: &tauri::AppHandle) -> LibraryRoots {
    let roots = LibraryRoots::default();
    let db = match storage::storage_db(app) {
        Ok(db) => db,
        Err(error) => {
            log::warn!("Cannot restore library roots: {error}");
            return roots;
        }
    };

    let mut inputs: Vec<String> = Vec::new();
    match db.read_blocking(LIBRARY_ROOTS_KEY) {
        Ok(Some(text)) => match serde_json::from_str::<Vec<String>>(&text) {
            Ok(saved) => inputs.extend(saved),
            Err(error) => log::warn!("Ignoring unparsable {LIBRARY_ROOTS_KEY}: {error}"),
        },
        Ok(None) => {}
        Err(error) => log::warn!("Failed to read {LIBRARY_ROOTS_KEY}: {error}"),
    }
    match db.read_blocking("settings.json") {
        Ok(Some(text)) => match serde_json::from_str::<PersistedLibrarySettings>(&text) {
            Ok(settings) => {
                inputs.extend(settings.library_paths);
                inputs.extend(settings.library_path);
            }
            Err(error) => log::warn!("Ignoring unparsable settings.json for library paths: {error}"),
        },
        Ok(None) => {}
        Err(error) => log::warn!("Failed to read settings.json: {error}"),
    }

    for input in inputs {
        if input.trim().is_empty() {
            continue;
        }
        let root = resolve_library_root(Some(&input));
        register_library_root(app, &roots, &root);
    }
    roots
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedSong {
    id: String,
    path: String,
    filename: String,
    title: String,
    artist: String,
    album: String,
    /// The album's credited artist ("Various Artists" on a compilation), when tagged.
    #[serde(default)]
    album_artist: Option<String>,
    genre: String,
    duration: f64,
    track: u32,
    year: Option<u32>,
    album_art: Option<String>,
    added_at: i64,
    play_count: u32,
    last_played: Option<i64>,
    favorite: bool,
    /// ReplayGain track gain in dB.
    #[serde(default)]
    replay_gain: Option<f32>,
    /// ReplayGain album gain in dB.
    #[serde(default)]
    replay_gain_album: Option<f32>,
    /// ReplayGain track peak (linear, 1.0 = full scale).
    #[serde(default)]
    replay_peak: Option<f32>,
    /// File size in bytes; with the tags it tells a moved file from a different one.
    #[serde(default)]
    size: u64,
}

pub(crate) fn is_supported_audio(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                // Kept in step with the symphonia features in Cargo.toml. Opus and WMA have no
                // decoder, so they are not listed rather than listed-but-silent.
                "mp3" | "mp4" | "m4a" | "m4b" | "aac" | "wav" | "wave" | "flac" | "ogg" | "oga" | "aif" | "aiff" | "aifc"
            )
        }
        None => false,
    }
}

fn default_music_path() -> PathBuf {
    if let Some(music_dir) = dirs::audio_dir() {
        return music_dir;
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("music")
}

fn to_unix_secs(metadata: &fs::Metadata) -> i64 {
    metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0)
        })
}

fn sanitize_id(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// "-7.35 dB", "+1.2dB" or "0.98" -> the number. Out-of-range values are tagging mistakes.
fn parse_replay_gain(input: Option<&str>) -> Option<f32> {
    let raw = input?.trim();
    let value = raw.trim_end_matches(|c: char| c.is_ascii_alphabetic() || c.is_whitespace()).trim().parse::<f32>().ok()?;
    (value.is_finite() && value.abs() <= 64.0).then_some(value)
}

/// First non-blank value of a text field, preferring the primary tag and falling back to the
/// file's other tags (an empty ID3v2 title must not hide the ID3v1 one).
fn first_text(tagged_file: &TaggedFile, field: impl Fn(&Tag) -> Option<std::borrow::Cow<'_, str>>) -> Option<String> {
    tagged_file
        .primary_tag()
        .into_iter()
        .chain(tagged_file.tags())
        .filter_map(field)
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

struct TextMetadata {
    title: String,
    artist: String,
    album: String,
    album_artist: Option<String>,
    genre: String,
    track: u32,
    year: Option<u32>,
    replay_gain: Option<f32>,
    replay_gain_album: Option<f32>,
    replay_peak: Option<f32>,
}

fn extract_text_metadata(tagged_file: &TaggedFile, filename_fallback: &str) -> TextMetadata {
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    // lofty maps each format's spelling (ID3 TXXX, Vorbis comments, MP4 atoms) onto one key.
    let item = |key: ItemKey| first_text(tagged_file, |tag| tag.get_string(key).map(std::borrow::Cow::Borrowed));
    let gain = |key: ItemKey| parse_replay_gain(item(key).as_deref());

    TextMetadata {
        title: first_text(tagged_file, |tag| tag.title()).unwrap_or_else(|| filename_fallback.to_string()),
        artist: first_text(tagged_file, |tag| tag.artist()).unwrap_or_else(|| "Unknown Artist".to_string()),
        album: first_text(tagged_file, |tag| tag.album()).unwrap_or_else(|| "Unknown Album".to_string()),
        album_artist: item(ItemKey::AlbumArtist),
        genre: first_text(tagged_file, |tag| tag.genre()).unwrap_or_else(|| "Unknown Genre".to_string()),
        track: tag.and_then(|entry| entry.track()).unwrap_or(0),
        year: tag.and_then(|entry| entry.date()).map(|date| u32::from(date.year)),
        replay_gain: gain(ItemKey::ReplayGainTrackGain),
        replay_gain_album: gain(ItemKey::ReplayGainAlbumGain),
        replay_peak: gain(ItemKey::ReplayGainTrackPeak).filter(|peak| *peak > 0.0),
    }
}

fn pick_cover_picture(tag: &Tag) -> Option<&Picture> {
    tag.get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
}

/// Store the picture in the artwork store and return its `amplyart` URL.
fn compress_artwork_to_data_url(bytes: &[u8]) -> Option<String> {
    crate::artwork::store_picture(bytes)
}

fn extract_embedded_artwork(tagged_file: &TaggedFile) -> Option<String> {
    if let Some(tag) = tagged_file.primary_tag() {
        if let Some(picture) = pick_cover_picture(tag) {
            if let Some(art) = compress_artwork_to_data_url(picture.data()) {
                return Some(art);
            }
        }
    }

    for tag in tagged_file.tags() {
        if let Some(picture) = pick_cover_picture(tag) {
            if let Some(art) = compress_artwork_to_data_url(picture.data()) {
                return Some(art);
            }
        }
    }

    None
}

fn scan_artwork_cache_key(path: &Path, artist: &str, album: &str) -> String {
    let album_key = album.trim().to_ascii_lowercase();
    if album_key.is_empty() || album_key == "unknown album" || album_key == "single" {
        return path.to_string_lossy().to_string();
    }
    format!("{}--{}", artist.trim().to_ascii_lowercase(), album_key)
}

fn clean_title(raw: &str) -> String {
    let mut title = raw.to_string();
    if let Some((left, _)) = title.split_once(" - ") {
        title = left.to_string();
    }
    if let Some((left, _)) = title.split_once(" – ") {
        title = left.to_string();
    }
    if let Some((left, _)) = title.split_once(" — ") {
        title = left.to_string();
    }
    if let Some((left, _)) = title.split_once(" | ") {
        title = left.to_string();
    }
    for (open, close) in [('[', ']'), ('(', ')'), ('{', '}')] {
        while let Some(start) = title.find(open) {
            let Some(end) = title[start + 1..].find(close) else { break };
            let end = start + 1 + end;
            title.replace_range(start..=end, "");
        }
    }
    let lowered = title.to_lowercase();
    let cut = [" feat.", " ft.", " featuring ", " prod.", " produced by "]
        .iter()
        .filter_map(|token| lowered.find(token))
        .min();
    if let Some(idx) = cut {
        title = title[..idx].to_string();
    }
    let noise = [
        "official", "audio", "video", "lyrics", "lyric", "visualizer", "hq", "hd",
        "high quality", "remaster", "remastered", "instrumental", "acapella",
        "slowed", "reverb", "speed up", "sped up", "clean", "explicit",
    ];
    let lowered = title.to_lowercase();
    if let Some(pos) = noise.iter().filter_map(|token| lowered.find(token)).min() {
        title = title[..pos].to_string();
    }
    title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

static FILENAME_SITE_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(y2mate\.(com|is)|ytmp3\.(cc|nu)|savefrom\.net|mp3juices\.cc|flvto\.biz|soundcloud)\s*[-_:|]\s*")
        .expect("static regex")
});
static FILENAME_SITE_SUFFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)[\s_\-]*(spotdown\.org|spotifydown\.com|spotifymate\.com|y2mate\.(com|is)|ytmp3\.(cc|nu)|mp3juices\.cc|soundcloud|free\s*download)\s*$")
        .expect("static regex")
});
static FILENAME_COPY_COUNTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*\(\d{1,2}\)\s*$").expect("static regex"));
static FILENAME_VIDEO_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*\[[A-Za-z0-9_-]{11}\]\s*$").expect("static regex"));
static FILENAME_BITRATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s*[\(\[]\s*\d{2,3}\s*kbps\s*[\)\]]").expect("static regex"));
static FILENAME_TRACK_NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{1,3}\s*[.\-_)]\s+").expect("static regex"));

/// Strips download-site junk from a file name so it can stand in for a missing title tag.
/// "500 Miles_spotdown.org (1)" -> "500 Miles", "y2mate.com - Artist - Song [dQw4w9WgXcQ]" ->
/// "Artist - Song", "01 - Song" -> "Song". Returns the stem unchanged if cleaning empties it.
pub(crate) fn clean_filename_stem(stem: &str) -> String {
    let mut value = stem.trim().to_string();
    for _ in 0..2 {
        // Twice: "X_spotdown.org (1)" needs the counter off before the site suffix matches.
        value = FILENAME_COPY_COUNTER.replace(&value, "").into_owned();
        value = FILENAME_VIDEO_ID.replace(&value, "").into_owned();
        value = FILENAME_SITE_SUFFIX.replace(&value, "").into_owned();
    }
    value = FILENAME_SITE_PREFIX.replace(&value, "").into_owned();
    value = FILENAME_BITRATE.replace_all(&value, "").into_owned();
    value = FILENAME_TRACK_NUMBER.replace(&value, "").into_owned();
    if !value.contains(' ') && value.contains('_') {
        value = value.replace('_', " ");
    }
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = value.trim_matches(|c: char| c == '-' || c == '_' || c == '.' || c.is_whitespace());
    if value.is_empty() {
        stem.trim().to_string()
    } else {
        value.to_string()
    }
}

fn split_artist_title(raw: &str) -> Option<(String, String)> {
    let separators = [" - ", " – ", " — ", " -- ", " | "];
    for sep in separators {
        if let Some((left, right)) = raw.split_once(sep) {
            let artist = left.trim();
            let title = right.trim();
            // A bare number on the left is a track number ("01 - Intro"), never an artist.
            if artist.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            if !artist.is_empty() && !title.is_empty() {
                return Some((artist.to_string(), clean_title(title)));
            }
        }
    }
    None
}

fn is_low_confidence_scan_artist(artist: &str) -> bool {
    let normalized = artist
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("");
    if normalized.is_empty() || normalized == "unknownartist" {
        return true;
    }
    [
        "topic",
        "vevo",
        "official",
        "channel",
        "records",
        "recordings",
        "music",
        "thefloridaman",
        "youtube",
        "lyrics",
        "archive",
    ]
    .iter()
    .any(|term| normalized.contains(term))
}

/// Reads tags, sniffing the real container from the content (YouTube converters often save an
/// m4a or webm as ".mp3") and retrying in relaxed mode when a tag is malformed, so one broken
/// frame does not also throw away the duration and cover.
pub(crate) fn read_tagged_file(path: &Path) -> Option<TaggedFile> {
    for mode in [ParsingMode::BestAttempt, ParsingMode::Relaxed] {
        let probe = Probe::open(path).ok()?.guess_file_type().ok()?;
        if let Ok(file) = probe.options(ParseOptions::new().parsing_mode(mode)).read() {
            return Some(file);
        }
    }
    None
}

/// Album covers decoded so far in this scan, shared by every worker. A `OnceLock` per album means
/// the first worker to reach an album decodes its cover while any other worker holding a track
/// from the same album waits for that result instead of decoding the same picture again.
type ArtworkCache = Mutex<HashMap<String, Arc<OnceLock<Option<String>>>>>;

/// Read one audio file's tags and artwork.
fn scan_one(path: &Path, artwork_cache: &ArtworkCache) -> Option<ScannedSong> {
    let metadata = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return None,
    };

    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Unknown File".to_string());

    let raw_stem = path
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Unknown Title".to_string());
    let filename_no_ext = clean_filename_stem(&raw_stem);
    let filename_no_ext = filename_no_ext.as_str();

    let (text, duration, album_art) =
        match read_tagged_file(path) {
            Some(tagged_file) => {
                let text = extract_text_metadata(&tagged_file, filename_no_ext);
                let duration = tagged_file.properties().duration().as_secs_f64();
                let artwork_key = scan_artwork_cache_key(path, &text.artist, &text.album);
                let cell = {
                    let mut cache = artwork_cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                    Arc::clone(cache.entry(artwork_key).or_default())
                };
                // The album's cover when one decoded; otherwise try this track's own picture, so a
                // corrupt cover on the first track does not leave the whole album blank.
                let album_art = cell
                    .get_or_init(|| extract_embedded_artwork(&tagged_file))
                    .clone()
                    .or_else(|| extract_embedded_artwork(&tagged_file));
                (text, duration, album_art)
            }
            None => (
                TextMetadata {
                    title: filename_no_ext.to_string(),
                    artist: "Unknown Artist".to_string(),
                    album: "Unknown Album".to_string(),
                    album_artist: None,
                    genre: "Unknown Genre".to_string(),
                    track: 0,
                    year: None,
                    replay_gain: None,
                    replay_gain_album: None,
                    replay_peak: None,
                },
                0.0,
                None,
            ),
        };
    let TextMetadata { mut title, mut artist, mut album, album_artist, genre, track, year, replay_gain, replay_gain_album, replay_peak } = text;

    if artist.trim().eq_ignore_ascii_case("unknown artist")
        || is_low_confidence_scan_artist(&artist)
        || title.trim() == filename_no_ext
    {
        if let Some((parsed_artist, parsed_title)) = split_artist_title(filename_no_ext) {
            if artist.trim().eq_ignore_ascii_case("unknown artist") || is_low_confidence_scan_artist(&artist) {
                artist = parsed_artist;
            }
            if title.trim() == filename_no_ext {
                title = parsed_title;
            }
            if album.trim().eq_ignore_ascii_case("unknown album") {
                album = "Single".to_string();
            }
        }
    }

    let full_path = path.to_string_lossy().to_string();
    Some(ScannedSong {
        id: sanitize_id(&full_path),
        path: full_path,
        filename,
        title,
        artist,
        album,
        album_artist,
        genre,
        duration,
        track,
        year,
        album_art,
        added_at: to_unix_secs(&metadata),
        play_count: 0,
        last_played: None,
        favorite: false,
        replay_gain,
        replay_gain_album,
        replay_peak,
        size: metadata.len(),
    })
}

/// Walk `scan_root`, then read tags and artwork on a small pool of worker threads.
/// Tag parsing and JPEG re-encoding dominate scan time and parallelise cleanly per file.
/// Folders a music scan should never descend into: hidden and dot folders, the recycle bin and
/// other `$` system folders, and tooling folders that turn up inside drive roots.
fn is_skipped_dir(entry: &DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    let lowered = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with('$')
        || matches!(lowered.as_str(), "system volume information" | "node_modules" | "__macosx" | "windows" | "program files" | "program files (x86)" | "appdata")
}

/// Files smaller than this are zero-byte placeholders or truncated downloads, never playable songs.
const MIN_AUDIO_FILE_BYTES: u64 = 4 * 1024;

/// How a scan went: how many files came from the index and how many were read from disk.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ScanStats {
    pub reused: usize,
    pub read: usize,
}

/// The index prefix for files under `root`: the root plus a separator, so "D:\\Music" never claims
/// "D:\\Music2".
fn index_prefix(root: &Path) -> String {
    let mut prefix = root.to_string_lossy().into_owned();
    if !prefix.ends_with(std::path::MAIN_SEPARATOR) && !prefix.ends_with('/') {
        prefix.push(std::path::MAIN_SEPARATOR);
    }
    prefix
}

/// A cached song whose artwork file is gone (cache cleared) must be re-read to get it back.
fn cached_song_is_usable(song: &ScannedSong) -> bool {
    song.album_art
        .as_deref()
        .is_none_or(|url| !url.starts_with("http://amplyart.") && !url.starts_with("amplyart:") || crate::artwork::file_for_url(url).is_some())
}

/// Scans `scan_root`, reusing index entries for unchanged files when `db` is given.
fn scan_folder_blocking(scan_root: PathBuf, db: Option<&storage::StorageDb>) -> (Vec<ScannedSong>, ScanStats) {
    let prefix = index_prefix(&scan_root);
    let mut index = match db.map(|db| db.with_conn(|conn| scan_index::load_under(conn, &prefix))) {
        Some(Ok(index)) => index,
        Some(Err(error)) => {
            log::warn!("Scan index unavailable, reading every file: {error}");
            HashMap::new()
        }
        None => HashMap::new(),
    };

    let mut walk_errors = 0usize;
    let mut found: Vec<(PathBuf, Stamp)> = WalkDir::new(&scan_root)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| !is_skipped_dir(entry))
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(_) => {
                walk_errors += 1;
                None
            }
        })
        .filter(|entry| entry.file_type().is_file() && is_supported_audio(entry.path()))
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            (metadata.len() >= MIN_AUDIO_FILE_BYTES).then(|| (entry.into_path(), Stamp::of(&metadata)))
        })
        .collect();
    if walk_errors > 0 {
        log::warn!("Library scan of {} skipped {walk_errors} unreadable entries", scan_root.display());
    }
    // Deterministic order, so id-collision resolution below is stable between scans.
    found.sort_by(|a, b| a.0.cmp(&b.0));

    // Unchanged files come from the index; only new or modified ones are read below.
    let mut cached: Vec<Option<ScannedSong>> = Vec::with_capacity(found.len());
    for (path, stamp) in &found {
        let key = path.to_string_lossy();
        let reusable = index
            .remove(key.as_ref())
            .filter(|(indexed, _)| indexed == stamp)
            .and_then(|(_, json)| serde_json::from_str::<ScannedSong>(&json).ok())
            .filter(cached_song_is_usable);
        cached.push(reusable);
    }
    let paths: Vec<&PathBuf> = found
        .iter()
        .zip(&cached)
        .filter(|(_, cached)| cached.is_none())
        .map(|((path, _), _)| path)
        .collect();

    let workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2)
        .clamp(1, 8)
        .min(paths.len().max(1));
    let next = AtomicUsize::new(0);
    let artwork_cache: ArtworkCache = Mutex::new(HashMap::new());

    let indexed: Vec<(usize, ScannedSong)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                let next = &next;
                let paths = &paths;
                let artwork_cache = &artwork_cache;
                scope.spawn(move || {
                    let mut out = Vec::new();
                    loop {
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        if index >= paths.len() {
                            break;
                        }
                        let path = paths[index];
                        // A decoder or tag-parser panic on one malformed file must not take down
                        // the worker and every song it had already read.
                        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| scan_one(path, artwork_cache))) {
                            Ok(Some(song)) => out.push((index, song)),
                            Ok(None) => {}
                            Err(_) => log::warn!("Skipped {} after a parser panic", path.display()),
                        }
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    });

    let stats = ScanStats { reused: found.len() - paths.len(), read: indexed.len() };
    let fresh: HashMap<&Path, ScannedSong> = indexed
        .into_iter()
        .map(|(index, song)| (paths[index].as_path(), song))
        .collect();

    // Persist what was read, and forget files that are gone. Songs are stored before the id
    // disambiguation below, which depends on their neighbours and is redone every scan.
    if let Some(db) = db {
        let upserts: Vec<(String, Stamp, String)> = found
            .iter()
            .filter_map(|(path, stamp)| {
                let song = fresh.get(path.as_path())?;
                Some((path.to_string_lossy().into_owned(), *stamp, serde_json::to_string(song).ok()?))
            })
            .collect();
        let present: HashSet<String> = found.iter().map(|(path, _)| path.to_string_lossy().into_owned()).collect();
        if let Err(error) = db.with_conn(|conn| scan_index::apply(conn, &prefix, &upserts, &present)) {
            log::warn!("Failed to update the scan index: {error}");
        }
    }

    let mut fresh = fresh;
    let ordered: Vec<ScannedSong> = found
        .iter()
        .zip(cached)
        .filter_map(|((path, _), cached)| cached.or_else(|| fresh.remove(path.as_path())))
        .collect();

    // Path-derived ids fold every non-ASCII character to '_', so "காதல்.mp3" and "प्यार.mp3" in the
    // same folder collide. Keep the first (by path order) and give later ones a path-hash suffix,
    // so existing ids stay stable and a colliding song is no longer silently dropped.
    let mut seen_ids: HashSet<String> = HashSet::with_capacity(ordered.len());
    let mut songs: Vec<ScannedSong> = ordered
        .into_iter()
        .map(|mut song| {
            if !seen_ids.insert(song.id.clone()) {
                song.id = format!("{}_{:08x}", song.id, path_hash(&song.path));
                seen_ids.insert(song.id.clone());
            }
            song
        })
        .collect();

    songs.sort_by_cached_key(|song| {
        (
            song.artist.to_lowercase(),
            song.album.to_lowercase(),
            song.track,
            song.title.to_lowercase(),
        )
    });

    (songs, stats)
}

/// FNV-1a of the path, for disambiguating ids that sanitize to the same string.
fn path_hash(path: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in path.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

#[tauri::command]
pub async fn scan_music(
    app: tauri::AppHandle,
    roots: tauri::State<'_, LibraryRoots>,
    folder: Option<String>,
) -> AmplyResult<Vec<ScannedSong>> {
    let scan_root = resolve_library_root(folder.as_deref());
    if register_library_root(&app, &roots, &scan_root) {
        let snapshot = roots.snapshot();
        let handle = app.clone();
        let persisted = tauri::async_runtime::spawn_blocking(move || persist_library_roots_blocking(&handle, &snapshot))
            .await
            .map_err(|err| err.to_string())
            .and_then(|result| result);
        if let Err(error) = persisted {
            log::warn!("Failed to persist library roots: {error}");
        }
    }

    if let Some(watcher) = app.try_state::<crate::library_watch::LibraryWatcher>() {
        watcher.watch(&scan_root);
    }

    // An unplugged drive or an offline cloud folder must not read as "this folder is now empty":
    // the frontend would replace the library with nothing and drop every song's history.
    if !scan_root.is_dir() {
        return Err(AmplyError::Unavailable(format!("Folder not available: {}", scan_root.display())));
    }

    let handle = app.clone();
    let (songs, stats) = tauri::async_runtime::spawn_blocking(move || {
        let db = storage::storage_db(&handle).ok();
        scan_folder_blocking(scan_root, db.as_deref())
    })
    .await
    .map_err(|err| err.to_string())?;
    log::info!("Library scan: {} unchanged, {} read", stats.reused, stats.read);
    Ok(songs)
}

/// Deletes `path` only when it lives under one of the registered library roots.
/// Returns `Ok(false)` when the file is already gone.
fn delete_song_file_blocking(path: &str, roots: &[PathBuf]) -> AmplyResult<bool> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AmplyError::InvalidInput("Song path missing".to_string()));
    }
    if roots.is_empty() {
        return Err(AmplyError::Unavailable("Library not scanned yet".to_string()));
    }
    let raw = PathBuf::from(trimmed);
    let target = dunce::canonicalize(&raw).unwrap_or(raw);
    if !roots.iter().any(|root| target.starts_with(root)) {
        return Err(AmplyError::Forbidden(
            "Path is outside the configured library folders".to_string(),
        ));
    }
    if !target.exists() {
        return Ok(false);
    }
    if !target.is_file() {
        return Err(AmplyError::InvalidInput("Selected path is not a file".to_string()));
    }
    fs::remove_file(&target)?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_song_file(path: String, roots: tauri::State<'_, LibraryRoots>) -> AmplyResult<bool> {
    let roots = roots.snapshot();
    tauri::async_runtime::spawn_blocking(move || delete_song_file_blocking(&path, &roots))
        .await
        .map_err(|err| err.to_string())?
}

/// Files handed to Amply at launch ("Open with", a double-click on an associated file), held until
/// the frontend has loaded the library and asks for them.
#[derive(Default)]
pub(crate) struct PendingOpenFiles(pub Mutex<Vec<String>>);

/// The existing files and folders among command-line arguments; flags and junk are dropped.
pub(crate) fn open_file_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let path = Path::new(arg);
            path.is_dir() || (path.is_file() && is_supported_audio(path))
        })
        .collect()
}

#[tauri::command]
pub fn take_open_files(pending: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

/// Most files one open or drop may add: a whole drive dropped by mistake must not freeze the app.
const MAX_OPENED_FILES: usize = 5000;

/// Reads the audio files at `paths`, descending into folders. Used for files opened from Explorer
/// or dropped on the window, which may live outside every library folder.
fn probe_audio_files_blocking(paths: &[String]) -> Vec<ScannedSong> {
    let mut files: Vec<PathBuf> = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            files.extend(
                WalkDir::new(&path)
                    .follow_links(true)
                    .into_iter()
                    .filter_entry(|entry| !is_skipped_dir(entry))
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file() && is_supported_audio(entry.path()))
                    .map(|entry| entry.into_path()),
            );
        } else if path.is_file() && is_supported_audio(&path) {
            files.push(path);
        }
        if files.len() >= MAX_OPENED_FILES {
            files.truncate(MAX_OPENED_FILES);
            break;
        }
    }
    let artwork_cache: ArtworkCache = Mutex::new(HashMap::new());
    let mut seen = HashSet::new();
    files
        .iter()
        .filter(|path| seen.insert(path.to_path_buf()))
        .filter_map(|path| {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| scan_one(path, &artwork_cache))).ok().flatten()
        })
        .collect()
}

#[tauri::command]
pub async fn probe_audio_files(paths: Vec<String>) -> AmplyResult<Vec<ScannedSong>> {
    Ok(tauri::async_runtime::spawn_blocking(move || probe_audio_files_blocking(&paths))
        .await
        .map_err(|err| err.to_string())?)
}

#[tauri::command]
pub async fn pick_music_folders() -> Vec<String> {
    // rfd blocks until the dialog closes; keep that off the main thread.
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select Music Folders")
            .pick_folders()
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<String>>()
    })
    .await;
    match picked {
        Ok(paths) => paths,
        Err(error) => {
            log::warn!("Folder picker task failed: {error}");
            Vec::new()
        }
    }
}

#[tauri::command]
pub async fn load_embedded_artwork(path: String) -> AmplyResult<Option<String>> {
    let artwork = tauri::async_runtime::spawn_blocking(move || {
        let tagged_file =
            read_tagged_file(Path::new(&path)).ok_or_else(|| "Could not read audio tags".to_string())?;
        Ok::<_, String>(extract_embedded_artwork(&tagged_file))
    })
    .await
    .map_err(|err| err.to_string())??;
    Ok(artwork)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkSongInput {
    pub album_art: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtCount {
    pub art: String,
    pub count: u32,
}

#[tauri::command(async)]
pub fn build_album_art_frequency_rust(songs: Vec<ArtworkSongInput>) -> AmplyResult<Vec<ArtCount>> {
    let mut freq: HashMap<String, u32> = HashMap::new();
    for song in songs {
        let art = match song.album_art {
            Some(value) if !value.is_empty() => value,
            _ => continue,
        };
        let entry = freq.entry(art).or_insert(0);
        *entry += 1;
    }

    Ok(freq
        .into_iter()
        .map(|(art, count)| ArtCount { art, count })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_stems_lose_download_junk() {
        assert_eq!(clean_filename_stem("500 Miles_spotdown.org (1)"), "500 Miles");
        assert_eq!(clean_filename_stem("500 Miles_spotdown.org"), "500 Miles");
        assert_eq!(clean_filename_stem("y2mate.com - Artist - Song [dQw4w9WgXcQ]"), "Artist - Song");
        assert_eq!(clean_filename_stem("01 - Intro"), "Intro");
        assert_eq!(clean_filename_stem("Artist - Song (128kbps)"), "Artist - Song");
        assert_eq!(clean_filename_stem("my_song_name"), "my song name");
        // Real titles that only look like junk stay intact.
        assert_eq!(clean_filename_stem("29 Intro"), "29 Intro");
        assert_eq!(clean_filename_stem("500 Miles"), "500 Miles");
        assert_eq!(clean_filename_stem("16"), "16");
        assert_eq!(clean_filename_stem("4 Your Eyez Only"), "4 Your Eyez Only");
    }

    #[test]
    fn track_numbers_are_not_artists() {
        assert_eq!(split_artist_title("01 - Intro"), None);
        assert_eq!(split_artist_title("Daft Punk - Around the World").map(|(artist, _)| artist), Some("Daft Punk".to_string()));
    }

    #[test]
    fn scan_skips_system_folders_and_stub_files() {
        let root = temp_dir("skip");
        let hidden = root.join("$RECYCLE.BIN");
        let dotted = root.join(".cache");
        fs::create_dir_all(&hidden).unwrap();
        fs::create_dir_all(&dotted).unwrap();
        fs::write(hidden.join("deleted.mp3"), vec![0u8; 8192]).unwrap();
        fs::write(dotted.join("cached.mp3"), vec![0u8; 8192]).unwrap();
        fs::write(root.join("stub.mp3"), b"x").unwrap();
        fs::write(root.join("song.mp3"), vec![0u8; 8192]).unwrap();
        let (songs, _) = scan_folder_blocking(root.clone(), None);
        let names: Vec<_> = songs.iter().map(|song| song.filename.clone()).collect();
        assert_eq!(names, vec!["song.mp3".to_string()]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rescans_reuse_unchanged_files_and_reread_changed_ones() {
        let music = temp_dir("index-music");
        let storage_root = temp_dir("index-storage");
        let db = storage::StorageDb::open(storage_root.clone()).unwrap();
        fs::write(music.join("a.mp3"), vec![0u8; 8192]).unwrap();
        fs::write(music.join("b.mp3"), vec![0u8; 8192]).unwrap();

        let (first, stats) = scan_folder_blocking(music.clone(), Some(&db));
        assert_eq!(first.len(), 2);
        assert_eq!(stats, ScanStats { reused: 0, read: 2 });

        let (second, stats) = scan_folder_blocking(music.clone(), Some(&db));
        assert_eq!(stats, ScanStats { reused: 2, read: 0 });
        assert_eq!(
            first.iter().map(|song| &song.id).collect::<Vec<_>>(),
            second.iter().map(|song| &song.id).collect::<Vec<_>>()
        );

        // A changed size is a changed file; a deleted file drops out of the index.
        fs::write(music.join("a.mp3"), vec![0u8; 9000]).unwrap();
        fs::remove_file(music.join("b.mp3")).unwrap();
        let (third, stats) = scan_folder_blocking(music.clone(), Some(&db));
        assert_eq!(third.len(), 1);
        assert_eq!(stats, ScanStats { reused: 0, read: 1 });
        assert_eq!(third[0].size, 9000);
        let indexed = db.with_conn(|conn| scan_index::load_under(conn, &index_prefix(&music))).unwrap();
        assert_eq!(indexed.len(), 1);

        drop(db);
        fs::remove_dir_all(&music).unwrap();
        let _ = fs::remove_dir_all(&storage_root);
    }

    /// Times a cold scan against an indexed rescan of the real library, with a throwaway database:
    /// `AMPLY_TEST_SONGS="D:/Songs i like" cargo test -- --ignored scan_index_real_library --nocapture`.
    #[test]
    #[ignore]
    fn scan_index_real_library() {
        let folder = std::env::var("AMPLY_TEST_SONGS").expect("set AMPLY_TEST_SONGS");
        let storage_root = temp_dir("index-real");
        let db = storage::StorageDb::open(storage_root.clone()).unwrap();
        crate::artwork::init(&storage_root).unwrap();
        let root = PathBuf::from(folder);

        let started = std::time::Instant::now();
        let (cold, cold_stats) = scan_folder_blocking(root.clone(), Some(&db));
        let cold_time = started.elapsed();
        let started = std::time::Instant::now();
        let (warm, warm_stats) = scan_folder_blocking(root, Some(&db));
        let warm_time = started.elapsed();

        let with_album_artist = warm.iter().filter(|song| song.album_artist.is_some()).count();
        let with_gain = warm.iter().filter(|song| song.replay_gain.is_some()).count();
        eprintln!("cold: {} songs in {cold_time:?} ({cold_stats:?})", cold.len());
        eprintln!("warm: {} songs in {warm_time:?} ({warm_stats:?})", warm.len());
        eprintln!("{with_album_artist} with album artist, {with_gain} with ReplayGain");
        assert_eq!(cold.len(), warm.len());
        assert_eq!(warm_stats.read, 0);
        assert!(cold.iter().zip(&warm).all(|(a, b)| a.id == b.id && a.title == b.title && a.album_art == b.album_art));
        drop(db);
        let _ = fs::remove_dir_all(&storage_root);
    }

    #[test]
    fn replay_gain_values_parse_with_or_without_units() {
        assert_eq!(parse_replay_gain(Some("-7.35 dB")), Some(-7.35));
        assert_eq!(parse_replay_gain(Some("+1.20dB")), Some(1.2));
        assert_eq!(parse_replay_gain(Some("0.988")), Some(0.988));
        assert_eq!(parse_replay_gain(Some("loud")), None);
        assert_eq!(parse_replay_gain(Some("-900 dB")), None);
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "amply-library-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dunce::canonicalize(&dir).unwrap()
    }

    #[test]
    fn resolve_library_root_handles_empty_relative_and_absolute() {
        assert_eq!(resolve_library_root(None), resolve_library_root(Some("  ")));
        assert!(resolve_library_root(None).is_absolute());

        assert_eq!(resolve_library_root(Some("music")), resolve_library_root(None));
        assert_eq!(resolve_library_root(Some("Music")), resolve_library_root(None));

        let relative = resolve_library_root(Some("music/subfolder"));
        assert!(relative.is_absolute());
        assert!(relative.ends_with("subfolder"));

        let root = temp_dir("abs");
        assert_eq!(resolve_library_root(Some(&root.to_string_lossy())), root);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn library_roots_dedupe() {
        let roots = LibraryRoots::default();
        assert!(roots.insert(PathBuf::from("a")));
        assert!(!roots.insert(PathBuf::from("a")));
        assert!(roots.insert(PathBuf::from("b")));
        assert_eq!(roots.snapshot().len(), 2);
    }

    #[test]
    fn delete_song_file_requires_a_registered_root() {
        let root = temp_dir("root");
        let outside = temp_dir("outside");
        let inside_file = root.join("song.mp3");
        let outside_file = outside.join("song.mp3");
        fs::write(&inside_file, b"x").unwrap();
        fs::write(&outside_file, b"x").unwrap();

        let no_roots: Vec<PathBuf> = Vec::new();
        assert!(matches!(
            delete_song_file_blocking(&inside_file.to_string_lossy(), &no_roots),
            Err(AmplyError::Unavailable(_))
        ));
        assert!(matches!(
            delete_song_file_blocking("   ", std::slice::from_ref(&root)),
            Err(AmplyError::InvalidInput(_))
        ));

        let roots = vec![root.clone()];
        let forbidden = delete_song_file_blocking(&outside_file.to_string_lossy(), &roots).unwrap_err();
        assert!(matches!(forbidden, AmplyError::Forbidden(_)));
        assert_eq!(forbidden.to_string(), "Path is outside the configured library folders");
        assert!(outside_file.exists());

        assert!(matches!(
            delete_song_file_blocking(&root.to_string_lossy(), &roots),
            Err(AmplyError::InvalidInput(_))
        ));
        assert!(delete_song_file_blocking(&inside_file.to_string_lossy(), &roots).unwrap());
        assert!(!inside_file.exists());
        assert!(!delete_song_file_blocking(&inside_file.to_string_lossy(), &roots).unwrap());

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    /// Real-file smoke test for the tag reader: set AMPLY_TEST_SONGS to a folder and run with
    /// `cargo test -- --ignored reads_tags_from_real_library_files --nocapture`.
    #[test]
    #[ignore]
    fn reads_tags_from_real_library_files() {
        let Ok(folder) = std::env::var("AMPLY_TEST_SONGS") else {
            eprintln!("AMPLY_TEST_SONGS not set; skipping");
            return;
        };
        let mut files: Vec<_> = fs::read_dir(&folder)
            .expect("readable folder")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| is_supported_audio(path))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no audio files in {folder}");

        let mut read = 0usize;
        let mut with_year = 0usize;
        let mut with_cover = 0usize;
        let mut titled = 0usize;
        for path in &files {
            let tagged = Probe::open(path)
                .and_then(|probe| probe.read())
                .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
            let stem = path.file_stem().and_then(|name| name.to_str()).unwrap_or("?");
            let TextMetadata { title, artist, year, .. } = extract_text_metadata(&tagged, stem);
            let duration = tagged.properties().duration().as_secs_f64();
            assert!(duration > 0.0, "{}: zero duration", path.display());
            if title != stem {
                titled += 1;
            }
            if year.is_some() {
                with_year += 1;
            }
            let cover = tagged
                .primary_tag()
                .into_iter()
                .chain(tagged.tags())
                .find_map(pick_cover_picture)
                .is_some();
            if cover {
                with_cover += 1;
            }
            let _ = artist;
            read += 1;
        }
        let mut key_counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for path in files.iter().take(200) {
            if let Ok(tagged) = Probe::open(path).and_then(|probe| probe.read()) {
                if let Some(tag) = tagged.primary_tag() {
                    for item in tag.items() {
                        *key_counts.entry(format!("{:?}", item.key())).or_default() += 1;
                    }
                }
            }
        }
        eprintln!("tag keys in first 200 files: {key_counts:?}");
        eprintln!("read {read} files: {titled} tagged titles, {with_year} with year, {with_cover} with cover art");
        assert_eq!(read, files.len());
    }
}
