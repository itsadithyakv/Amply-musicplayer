use std::collections::HashMap;

use reqwest::Url;

use super::cache::{read_json, write_json};
use super::http::{fetch_image_data_url, fetch_json, score_itunes_hit, ItunesSongHit, ItunesSongPayload};
use super::normalize::{clean_lyrics_title, metadata_artist_for_song, slugify};
use super::{SongInput, TRACK_ARTWORK_CACHE_PATH};

fn cache_key_for_track_artwork(song: &SongInput) -> String {
    let primary_artist = metadata_artist_for_song(song);
    let title = clean_lyrics_title(&song.title, Some(&primary_artist));
    format!(
        "{}--{}",
        slugify(if primary_artist.trim().is_empty() { "unknown-artist" } else { &primary_artist }),
        slugify(if title.trim().is_empty() { song.title.as_str() } else { title.as_str() })
    )
}

fn normalize_artwork_url(url: &str) -> String {
    url.replace("100x100bb", "300x300bb")
}

async fn fetch_itunes_track_artwork_url(song: &SongInput) -> Result<Option<String>, String> {
    let primary_artist = metadata_artist_for_song(song);
    let title = clean_lyrics_title(&song.title, Some(&primary_artist));
    if title.trim().is_empty() || primary_artist.trim().is_empty() {
        return Ok(None);
    }

    let term = format!("{} {}", primary_artist, title);
    let url = Url::parse_with_params(
        "https://itunes.apple.com/search",
        &[
            ("term", term.as_str()),
            ("entity", "song"),
            ("limit", "5"),
        ],
    )
    .map_err(|err| err.to_string())?;
    let payload: ItunesSongPayload = fetch_json(url, None).await?;
    let mut ranked: Vec<(i32, ItunesSongHit)> = payload
        .results
        .unwrap_or_default()
        .into_iter()
        .map(|hit| (score_itunes_hit(song, &hit), hit))
        .filter(|(score, hit)| *score >= 7 && hit.artwork_url_100.is_some())
        .collect();
    ranked.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    Ok(ranked
        .into_iter()
        .find_map(|(_, hit)| hit.artwork_url_100.map(|url| normalize_artwork_url(&url))))
}

async fn fetch_track_artwork_data_url(song: &SongInput) -> Result<Option<String>, String> {
    if let Ok(Some(url)) = fetch_itunes_track_artwork_url(song).await {
        if let Ok(Some(data_url)) = fetch_image_data_url(&url).await {
            return Ok(Some(data_url));
        }
        return Ok(Some(url));
    }

    Ok(None)
}

#[tauri::command]
pub async fn load_track_artwork_rust(
    app: tauri::AppHandle,
    song: SongInput,
) -> Result<Option<String>, String> {
    let mut cache = read_json::<HashMap<String, String>>(&app, TRACK_ARTWORK_CACHE_PATH)
        .await?
        .unwrap_or_default();
    let key = cache_key_for_track_artwork(&song);
    if let Some(cached) = cache.get(&key) {
        return Ok(Some(cached.clone()));
    }

    let fetched: Option<String> = fetch_track_artwork_data_url(&song).await.unwrap_or_default();
    if let Some(value) = fetched.clone() {
        cache.insert(key, value.clone());
        write_json(&app, TRACK_ARTWORK_CACHE_PATH, &cache).await?;
    }
    Ok(fetched)
}
