#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use lofty::{
    file::TaggedFile,
    prelude::{Accessor, AudioFile, TaggedFileExt},
    probe::Probe,
};
use serde::Serialize;
use tauri::Manager;
use tauri::image::Image;
use walkdir::WalkDir;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedSong {
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
                "mp3" | "mp4" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus" | "aif" | "aiff" | "wma" | "webm"
            )
        }
        None => false,
    }
}

fn default_music_path() -> PathBuf {
    let cwd_music = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("music");

    if cwd_music.exists() {
        return cwd_music;
    }

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
            let now = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0);
            now
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

fn extract_album_art(tagged_file: &TaggedFile) -> Option<String> {
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;

    let picture = tag.pictures().first()?;

    // Avoid huge inlined payloads when scanning large libraries.
    if picture.data().len() > 300_000 {
        return None;
    }

    let mime = picture
        .mime_type()
        .map(|mime| mime.as_str().to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());

    let encoded = BASE64_STANDARD.encode(picture.data());
    Some(format!("data:{};base64,{}", mime, encoded))
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

#[tauri::command]
fn scan_music(folder: Option<String>) -> Result<Vec<ScannedSong>, String> {
    let scan_root = folder
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_music_path);

    if !scan_root.exists() {
        return Ok(Vec::new());
    }

    let mut songs: Vec<ScannedSong> = Vec::new();

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

        let (title, artist, album, genre, track, year, replay_gain, duration, album_art) =
            match Probe::open(path).and_then(|probe| probe.read()) {
                Ok(tagged_file) => {
                    let (title, artist, album, genre, track, year, replay_gain) =
                        extract_text_metadata(&tagged_file, filename_no_ext);
                    let duration = tagged_file.properties().duration().as_secs_f64();
                    let album_art = extract_album_art(&tagged_file);
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

    Ok(songs)
}

fn storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("storage");

    fs::create_dir_all(root.join("lyrics_cache")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("playlists")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("artist_cache")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("metadata_cache")).map_err(|err| err.to_string())?;

    Ok(root)
}

fn resolve_storage_path(app: &tauri::AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);

    if candidate.is_absolute() {
        return Err("Storage path must be relative".to_string());
    }

    for component in candidate.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Unsafe storage path".to_string());
        }
    }

    Ok(storage_root(app)?.join(candidate))
}

#[tauri::command]
fn ensure_storage_dirs(app: tauri::AppHandle) -> Result<String, String> {
  let root = storage_root(&app)?;
  Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn clear_storage_cache(app: tauri::AppHandle) -> Result<(), String> {
    let root = storage_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|err| err.to_string())?;
    }
    let _ = storage_root(&app)?;
    Ok(())
}

#[tauri::command]
fn pick_music_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select Music Folder")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_music_folders() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Select Music Folders")
        .pick_folders()
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn read_storage_file(app: tauri::AppHandle, relative_path: String) -> Result<Option<String>, String> {
    let target = resolve_storage_path(&app, &relative_path)?;

    if !target.exists() {
        return Ok(None);
    }

    let mut file = fs::File::open(target).map_err(|err| err.to_string())?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|err| err.to_string())?;

    Ok(Some(content))
}

#[tauri::command]
fn write_storage_file(app: tauri::AppHandle, relative_path: String, content: String) -> Result<(), String> {
    let target = resolve_storage_path(&app, &relative_path)?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let mut file = fs::File::create(target).map_err(|err| err.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|err| err.to_string())?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let _ = storage_root(&app.handle());
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                if let Err(error) =
                    app.handle().plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
                {
                    eprintln!("Failed to initialize autostart plugin: {error}");
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_storage_dirs,
            clear_storage_cache,
            pick_music_folder,
            pick_music_folders,
            read_storage_file,
            write_storage_file,
            scan_music
        ])
        .run(tauri::generate_context!())
        .expect("failed to run amply");
}
