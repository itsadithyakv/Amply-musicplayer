use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::FilterType;
use image::GenericImageView;
use lofty::{
    file::TaggedFile,
    picture::{Picture, PictureType},
    prelude::{Accessor, AudioFile, TaggedFileExt},
    probe::Probe,
    tag::Tag,
};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

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

fn compress_artwork_to_data_url(bytes: &[u8]) -> Option<String> {
    let image = image::load_from_memory(bytes).ok()?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return None;
    }

    let max_size = 320u32;
    let resized = if width.max(height) > max_size {
        image.resize(max_size, max_size, FilterType::Lanczos3)
    } else {
        image
    };
    let mut buffer = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 76);
    encoder.encode_image(&resized).ok()?;
    let b64 = BASE64_STANDARD.encode(buffer);
    Some(format!("data:image/jpeg;base64,{b64}"))
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
pub async fn scan_music(folder: Option<String>) -> Result<Vec<ScannedSong>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scan_root = folder
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_music_path);

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

        Ok(songs)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn delete_song_file(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("Song path missing".to_string());
        }
        let target = PathBuf::from(trimmed);
        if !target.exists() {
            return Ok(false);
        }
        if !target.is_file() {
            return Err("Selected path is not a file".to_string());
        }
        fs::remove_file(&target).map_err(|err| err.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn pick_music_folders() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Select Music Folders")
        .pick_folders()
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
pub async fn load_embedded_artwork(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tagged_file = Probe::open(Path::new(&path))
            .and_then(|probe| probe.read())
            .map_err(|err| err.to_string())?;
        Ok(extract_embedded_artwork(&tagged_file))
    })
    .await
    .map_err(|err| err.to_string())?
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

#[tauri::command]
pub fn build_album_art_frequency_rust(songs: Vec<ArtworkSongInput>) -> Result<Vec<ArtCount>, String> {
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
