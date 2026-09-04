use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use lofty::{
    file::TaggedFile,
    picture::{Picture, PictureType},
    prelude::{Accessor, AudioFile, TaggedFileExt},
    probe::Probe,
    tag::Tag,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use walkdir::WalkDir;

use crate::error::{AmplyError, AmplyResult};
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedSong {
    id: String,
    path: String,
    filename: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    duration: f64,
    track: u32,
    year: Option<u32>,
    album_art: Option<String>,
    added_at: i64,
    play_count: u32,
    last_played: Option<i64>,
    favorite: bool,
    replay_gain: Option<f32>,
}

fn is_supported_audio(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp3" | "mp4" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "aif" | "aiff"
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

fn parse_replay_gain(input: Option<&str>) -> Option<f32> {
    let raw = input?.trim();
    let value = raw.replace("dB", "").trim().parse::<f32>().ok()?;
    Some(value)
}

fn extract_text_metadata(tagged_file: &TaggedFile, filename_fallback: &str) -> (String, String, String, String, u32, Option<u32>, Option<f32>) {
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|entry| entry.title().map(|value| value.into_owned()))
        .unwrap_or_else(|| filename_fallback.to_string());

    let artist = tag
        .and_then(|entry| entry.artist().map(|value| value.into_owned()))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let album = tag
        .and_then(|entry| entry.album().map(|value| value.into_owned()))
        .unwrap_or_else(|| "Unknown Album".to_string());

    let genre = tag
        .and_then(|entry| entry.genre().map(|value| value.into_owned()))
        .unwrap_or_else(|| "Unknown Genre".to_string());

    let track = tag.and_then(|entry| entry.track()).unwrap_or(0);
    let year = tag.and_then(|entry| entry.year());

    let replay_gain = tag.and_then(|entry| {
        for item in entry.items() {
            let key = format!("{:?}", item.key()).to_ascii_lowercase();
            if key.contains("replaygain") {
                return parse_replay_gain(item.value().text());
            }
        }
        None
    });

    (title, artist, album, genre, track, year, replay_gain)
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

fn split_artist_title(raw: &str) -> Option<(String, String)> {
    let separators = [" - ", " – ", " — ", " -- ", " | "];
    for sep in separators {
        if let Some((left, right)) = raw.split_once(sep) {
            let artist = left.trim();
            let title = right.trim();
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

    let songs = tauri::async_runtime::spawn_blocking(move || {
        if !scan_root.exists() {
            return Ok(Vec::new());
        }

        let mut songs: Vec<ScannedSong> = Vec::new();
        let mut artwork_cache: HashMap<String, Option<String>> = HashMap::new();

        for entry in WalkDir::new(scan_root)
            .follow_links(true)
            .into_iter()
            .filter_map(Result::ok)
        {
            let path = entry.path();

            if !entry.file_type().is_file() || !is_supported_audio(path) {
                continue;
            }

            let metadata = match fs::metadata(path) {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            let filename = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Unknown File")
                .to_string();

            let filename_no_ext = path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Unknown Title");

            let (mut title, mut artist, mut album, genre, track, year, replay_gain, duration, album_art) =
                match Probe::open(path).and_then(|probe| probe.read()) {
                    Ok(tagged_file) => {
                        let (title, artist, album, genre, track, year, replay_gain) =
                            extract_text_metadata(&tagged_file, filename_no_ext);
                        let duration = tagged_file.properties().duration().as_secs_f64();
                        let artwork_key = scan_artwork_cache_key(path, &artist, &album);
                        let album_art = if let Some(cached) = artwork_cache.get(&artwork_key) {
                            cached.clone()
                        } else {
                            let extracted = extract_embedded_artwork(&tagged_file);
                            artwork_cache.insert(artwork_key, extracted.clone());
                            extracted
                        };
                        (title, artist, album, genre, track, year, replay_gain, duration, album_art)
                    }
                    Err(_) => (
                        filename_no_ext.to_string(),
                        "Unknown Artist".to_string(),
                        "Unknown Album".to_string(),
                        "Unknown Genre".to_string(),
                        0,
                        None,
                        None,
                        0.0,
                        None,
                    ),
                };

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
            songs.push(ScannedSong {
                id: sanitize_id(&full_path),
                path: full_path,
                filename,
                title,
                artist,
                album,
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
            });
        }

        songs.sort_by(|a, b| {
            a.artist
                .to_ascii_lowercase()
                .cmp(&b.artist.to_ascii_lowercase())
                .then_with(|| a.album.to_ascii_lowercase().cmp(&b.album.to_ascii_lowercase()))
                .then_with(|| a.track.cmp(&b.track))
                .then_with(|| a.title.to_ascii_lowercase().cmp(&b.title.to_ascii_lowercase()))
        });

        Ok::<_, String>(songs)
    })
    .await
    .map_err(|err| err.to_string())??;
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
        let tagged_file = Probe::open(Path::new(&path))
            .and_then(|probe| probe.read())
            .map_err(|err| err.to_string())?;
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
}
