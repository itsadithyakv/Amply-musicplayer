use std::collections::HashMap;

use reqwest::Url;
use serde::Deserialize;

use super::cache::{read_json, write_json};
use super::http::{fetch_json, musicbrainz_throttle};
use super::normalize::{normalize_track_title, slugify};
use super::{now_unix, AlbumTrack, AlbumTracklist, ALBUM_TRACKLIST_CACHE_PATH};

fn get_album_tracklist_key(artist: &str, album: &str) -> String {
    format!(
        "{}--{}",
        slugify(if artist.trim().is_empty() { "unknown-artist" } else { artist }),
        slugify(if album.trim().is_empty() { "unknown-album" } else { album })
    )
}

#[derive(Debug, Deserialize)]
struct MbReleaseSearch {
    releases: Option<Vec<MbRelease>>,
}

#[derive(Debug, Deserialize)]
struct MbRelease {
    id: String,
    title: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseLookup {
    media: Option<Vec<MbMedia>>,
}

#[derive(Debug, Deserialize)]
struct MbMedia {
    tracks: Option<Vec<MbTrack>>,
}

#[derive(Debug, Deserialize)]
struct MbTrack {
    position: Option<u32>,
    number: Option<String>,
    title: Option<String>,
    recording: Option<MbRecording>,
}

#[derive(Debug, Deserialize)]
struct MbRecording {
    title: Option<String>,
}

fn find_best_release_id(result: &MbReleaseSearch, album: &str) -> Option<String> {
    let releases = result.releases.as_ref()?;
    if releases.is_empty() {
        return None;
    }
    let normalized_album = normalize_track_title(album);
    if let Some(exact) = releases.iter().find(|release| normalize_track_title(release.title.as_deref().unwrap_or("")) == normalized_album) {
        return Some(exact.id.clone());
    }
    if let Some(official) = releases.iter().find(|release| release.status.as_deref().unwrap_or("").to_lowercase() == "official") {
        return Some(official.id.clone());
    }
    releases.first().map(|release| release.id.clone())
}

fn parse_release_tracks(payload: &MbReleaseLookup) -> Vec<AlbumTrack> {
    let mut tracks: Vec<AlbumTrack> = Vec::new();
    for medium in payload.media.as_ref().unwrap_or(&Vec::new()) {
        for track in medium.tracks.as_ref().unwrap_or(&Vec::new()) {
            let title = track
                .title
                .clone()
                .or_else(|| track.recording.as_ref().and_then(|rec| rec.title.clone()))
                .unwrap_or_default();
            if title.trim().is_empty() {
                continue;
            }
            let position = track
                .position
                .or_else(|| track.number.as_ref().and_then(|value| value.parse::<u32>().ok()))
                .unwrap_or(0);
            tracks.push(AlbumTrack {
                position: if position > 0 { position } else { (tracks.len() + 1) as u32 },
                title,
            });
        }
    }
    tracks.sort_by_key(|track| track.position);
    tracks
}

#[tauri::command]
pub async fn load_album_tracklist_cache_rust(
    app: tauri::AppHandle,
) -> Result<HashMap<String, AlbumTracklist>, String> {
    Ok(read_json::<HashMap<String, AlbumTracklist>>(&app, ALBUM_TRACKLIST_CACHE_PATH)
        .await?
        .unwrap_or_default())
}

#[tauri::command]
pub async fn load_album_tracklist_rust(
    app: tauri::AppHandle,
    artist: String,
    album: String,
) -> Result<Option<AlbumTracklist>, String> {
    if artist.trim().is_empty() || album.trim().is_empty() {
        return Ok(None);
    }
    let mut cache = read_json::<HashMap<String, AlbumTracklist>>(&app, ALBUM_TRACKLIST_CACHE_PATH)
        .await?
        .unwrap_or_default();
    let key = get_album_tracklist_key(&artist, &album);
    if let Some(cached) = cache.get(&key) {
        if !cached.tracks.is_empty() {
            return Ok(Some(cached.clone()));
        }
    }

    let query = format!("artist:{} AND release:{}", artist, album);
    let search_url = Url::parse_with_params(
        "https://musicbrainz.org/ws/2/release/",
        &[
            ("query", query.as_str()),
            ("fmt", "json"),
            ("limit", "5"),
        ],
    )
    .map_err(|err| err.to_string())?;

    musicbrainz_throttle().await;
    let search_result: MbReleaseSearch = fetch_json(
        search_url,
        Some("AmplyMusicPlayer/1.4 (https://github.com/)")
    )
    .await?;
    let release_id = match find_best_release_id(&search_result, &album) {
        Some(id) => id,
        None => return Ok(None),
    };

    musicbrainz_throttle().await;
    let lookup_url = Url::parse_with_params(
        &format!("https://musicbrainz.org/ws/2/release/{release_id}"),
        &[("inc", "recordings"), ("fmt", "json")],
    )
    .map_err(|err| err.to_string())?;
    let lookup_result: MbReleaseLookup = fetch_json(
        lookup_url,
        Some("AmplyMusicPlayer/1.4 (https://github.com/)")
    )
    .await?;
    let tracks = parse_release_tracks(&lookup_result);
    if tracks.is_empty() {
        return Ok(None);
    }

    let entry = AlbumTracklist {
        key: key.clone(),
        album,
        artist,
        tracks,
        source: "musicbrainz".to_string(),
        fetched_at: now_unix(),
    };
    cache.insert(key, entry.clone());
    write_json(&app, ALBUM_TRACKLIST_CACHE_PATH, &cache).await?;
    Ok(Some(entry))
}
