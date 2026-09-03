use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
    time::Duration,
};

use regex::Regex;
use reqwest::Url;
use serde::Deserialize;

use super::cache::{read_json, read_text, to_storage_cache_path, write_json, write_text};
use super::normalize::{
    clean_lyrics_title, get_primary_artist_name, is_unknown_album, metadata_artist_for_song,
    normalize_artist, normalize_match_name, normalize_plain_lyrics, normalize_title, safe_includes,
    slugify, split_artist_title_hint,
};
use super::{
    LyricsCandidate, LyricsLoadResult, LyricsSaveResult, SongInput, LYRICS_CACHE_FOLDER, LYRICS_INDEX_PATH,
};

static TIME_TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]").unwrap());

#[derive(Clone, Debug)]
struct LyricLine {
    time_ms: Option<i64>,
    text: String,
}

fn lyrics_title_for_song(song: &SongInput) -> String {
    let primary_artist = metadata_artist_for_song(song);
    let cleaned = clean_lyrics_title(&song.title, Some(&primary_artist));
    if cleaned.trim().is_empty() {
        song.title.trim().to_string()
    } else {
        cleaned
    }
}

fn lyrics_album_part_for_song(song: &SongInput) -> String {
    let album = song.album.as_deref().unwrap_or("").trim();
    if album.is_empty() || is_unknown_album(album) {
        String::new()
    } else {
        format!("-{}", slugify(album))
    }
}

fn insert_lyrics_cache_key(keys: &mut HashSet<String>, artist: &str, title: &str, album_part: &str) {
    let artist_slug = slugify(if artist.trim().is_empty() { "unknown-artist" } else { artist });
    let title_slug = slugify(if title.trim().is_empty() { "unknown-title" } else { title });
    keys.insert(format!("{LYRICS_CACHE_FOLDER}/{artist_slug}-{title_slug}{album_part}.lrc"));
}

fn cache_key_for_song(song: &SongInput) -> String {
    let primary_artist = metadata_artist_for_song(song);
    let artist = slugify(if primary_artist.trim().is_empty() { "unknown-artist" } else { &primary_artist });
    let title = lyrics_title_for_song(song);
    let title = slugify(if title.trim().is_empty() { "unknown-title" } else { &title });
    let album_part = lyrics_album_part_for_song(song);
    format!("{LYRICS_CACHE_FOLDER}/{artist}-{title}{album_part}.lrc")
}

fn legacy_cache_keys_for_song(song: &SongInput) -> Vec<String> {
    let artist_raw = if song.artist.trim().is_empty() { "unknown-artist" } else { &song.artist };
    let metadata_artist = metadata_artist_for_song(song);
    let primary = get_primary_artist_name(artist_raw);
    let cleaned_title = lyrics_title_for_song(song);
    let raw_title = if song.title.trim().is_empty() { "unknown-title" } else { &song.title };
    let album = song.album.as_deref().unwrap_or("").trim();
    let album_part = if album.is_empty() { String::new() } else { format!("-{}", slugify(album)) };
    let normalized_album_part = lyrics_album_part_for_song(song);
    let mut keys = HashSet::new();

    let artists = [artist_raw.to_string(), metadata_artist, primary];
    let titles = [raw_title.to_string(), cleaned_title];
    let album_parts = [String::new(), album_part, normalized_album_part];

    for artist in artists.iter() {
        for title in titles.iter() {
            for album_part in album_parts.iter() {
                insert_lyrics_cache_key(&mut keys, artist, title, album_part);
            }
        }
    }

    keys.into_iter().filter(|key| key != &cache_key_for_song(song)).collect()
}

async fn read_lyrics_index(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_json::<HashMap<String, String>>(app, LYRICS_INDEX_PATH)
        .await?
        .unwrap_or_default())
}

async fn write_lyrics_index(app: &tauri::AppHandle, index: &HashMap<String, String>) -> Result<(), String> {
    write_json(app, LYRICS_INDEX_PATH, index).await
}

async fn read_cached_lyrics_text(
    app: &tauri::AppHandle,
    song: &SongInput,
) -> Result<Option<(String, String)>, String> {
    let key = cache_key_for_song(song);
    if let Some(text) = read_text(app, &key).await? {
        if !text.trim().is_empty() {
            return Ok(Some((key, text)));
        }
    }

    if let Some(song_id) = song.id.as_deref() {
        let index = read_lyrics_index(app).await?;
        if let Some(mapped) = index.get(song_id) {
            if mapped != &key {
                if let Some(text) = read_text(app, mapped).await? {
                    if !text.trim().is_empty() {
                        return Ok(Some((mapped.clone(), text)));
                    }
                }
            }
        }
    }

    for legacy in legacy_cache_keys_for_song(song) {
        if let Some(text) = read_text(app, &legacy).await? {
            if !text.trim().is_empty() {
                return Ok(Some((legacy, text)));
            }
        }
    }
    Ok(None)
}

fn parse_lrc(raw: &str) -> Vec<LyricLine> {
    let mut parsed: Vec<LyricLine> = Vec::new();
    for line in raw.lines() {
        let text = TIME_TAG_RE.replace_all(line, "").trim().to_string();
        let matches: Vec<_> = TIME_TAG_RE.captures_iter(line).collect();
        if matches.is_empty() {
            if !text.is_empty() {
                parsed.push(LyricLine { time_ms: None, text });
            }
            continue;
        }
        for capture in matches {
            let mins = capture.get(1).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
            let secs = capture.get(2).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
            let fraction = capture.get(3).map(|m| m.as_str()).unwrap_or("0");
            let centisecs = fraction.parse::<i64>().unwrap_or(0);
            let time_ms = mins * 60_000 + secs * 1_000 + if fraction.len() == 3 { centisecs } else { centisecs * 10 };
            parsed.push(LyricLine { time_ms: Some(time_ms), text: text.clone() });
        }
    }
    parsed.sort_by(|a, b| a.time_ms.unwrap_or(i64::MAX).cmp(&b.time_ms.unwrap_or(i64::MAX)));
    parsed
}

fn validate_lyrics_quality(raw: &str) -> bool {
    let lines = parse_lrc(raw);
    if lines.is_empty() {
        return false;
    }
    let is_synced = lines.iter().any(|line| line.time_ms.is_some());
    if is_synced {
        let timed: Vec<_> = lines.iter().filter(|line| line.time_ms.is_some()).collect();
        if timed.len() < (lines.len() as f32 * 0.5) as usize {
            return false;
        }
        let mut times: Vec<i64> = timed.iter().filter_map(|line| line.time_ms).collect();
        times.sort();
        for idx in 1..times.len() {
            if times[idx] < times[idx - 1] {
                return false;
            }
            if times[idx] - times[idx - 1] > 300_000 {
                return false;
            }
        }
    }

    let text_lines: Vec<&LyricLine> = lines.iter().filter(|line| !line.text.trim().is_empty()).collect();
    if text_lines.len() < 2 {
        return false;
    }
    let mut unique = HashSet::new();
    for line in text_lines.iter() {
        unique.insert(line.text.trim().to_lowercase());
    }
    unique.len() >= 2 || unique.len() as f32 >= (text_lines.len() as f32 * 0.15)
}

fn score_candidate(song: &SongInput, candidate: &LyricsCandidate) -> i32 {
    let primary_artist = metadata_artist_for_song(song);
    let fallback_artist = get_primary_artist_name(&song.artist);
    let cleaned_title = lyrics_title_for_song(song);
    let mut score = 0;

    if normalize_match_name(&candidate.track_name) == normalize_match_name(&cleaned_title) {
        score += 8;
    } else if normalize_match_name(&candidate.track_name) == normalize_match_name(&song.title) {
        score += 5;
    } else if safe_includes(&candidate.track_name, &cleaned_title) {
        score += 4;
    } else if safe_includes(&candidate.track_name, &song.title) {
        score += 2;
    }

    if normalize_match_name(&candidate.artist_name) == normalize_match_name(&primary_artist) {
        score += 5;
    } else if safe_includes(&candidate.artist_name, &primary_artist) {
        score += 2;
    } else if !fallback_artist.eq_ignore_ascii_case(&primary_artist)
        && normalize_match_name(&candidate.artist_name) == normalize_match_name(&fallback_artist)
    {
        score += 4;
    }

    if let (Some(candidate_album), Some(song_album)) = (&candidate.album_name, &song.album) {
        if !is_unknown_album(song_album) && normalize_match_name(candidate_album) == normalize_match_name(song_album) {
            score += 3;
        }
    }

    if candidate.is_synced {
        score += 2;
    }

    if let (Some(candidate_duration), Some(song_duration)) = (candidate.duration_sec, song.duration) {
        if song_duration > 0.0 {
            let diff = (candidate_duration - song_duration).abs();
            if diff <= 2.0 {
                score += 3;
            } else if diff <= 7.0 {
                score += 2;
            } else if diff <= 12.0 {
                score += 1;
            }
        }
    }
    score
}

fn dedupe_candidates(candidates: Vec<LyricsCandidate>) -> Vec<LyricsCandidate> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for candidate in candidates {
        let key = candidate.raw.trim().to_string();
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        result.push(candidate);
    }
    result
}

fn rank_candidates(song: &SongInput, candidates: Vec<LyricsCandidate>) -> Vec<LyricsCandidate> {
    let mut ranked: Vec<(i32, LyricsCandidate)> = candidates
        .into_iter()
        .map(|candidate| (score_candidate(song, &candidate), candidate))
        .collect();
    ranked.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    ranked.into_iter().map(|(_, candidate)| candidate).take(8).collect()
}

#[derive(Debug, Deserialize)]
struct LrcLibSearchHit {
    id: Option<serde_json::Value>,
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "track_name")]
    track_name_alt: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    #[serde(rename = "artist_name")]
    artist_name_alt: Option<String>,
    #[serde(rename = "albumName")]
    album_name: Option<String>,
    #[serde(rename = "album_name")]
    album_name_alt: Option<String>,
    duration: Option<serde_json::Value>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "synced_lyrics")]
    synced_lyrics_alt: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "plain_lyrics")]
    plain_lyrics_alt: Option<String>,
}

fn parse_number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(num) => num.as_f64(),
        serde_json::Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    }
}

fn parse_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        }
        serde_json::Value::Number(num) => Some(num.to_string()),
        _ => None,
    }
}

fn to_candidate(song: &SongInput, hit: &LrcLibSearchHit, index: usize) -> Option<LyricsCandidate> {
    let synced = hit.synced_lyrics.clone().or_else(|| hit.synced_lyrics_alt.clone());
    let plain_raw = hit.plain_lyrics.clone().or_else(|| hit.plain_lyrics_alt.clone());
    let plain = plain_raw.as_ref().map(|value| normalize_plain_lyrics(value));
    let raw = synced.clone().or_else(|| plain_raw.clone());
    let raw = raw?;
    let track_name = hit
        .track_name
        .clone()
        .or_else(|| hit.track_name_alt.clone())
        .unwrap_or_else(|| song.title.clone());
    let artist_name = hit
        .artist_name
        .clone()
        .or_else(|| hit.artist_name_alt.clone())
        .unwrap_or_else(|| song.artist.clone());
    let album_name = hit.album_name.clone().or_else(|| hit.album_name_alt.clone());
    let duration_sec = hit.duration.as_ref().and_then(parse_number);
    let id_seed = hit.id.as_ref().and_then(parse_string).unwrap_or_else(|| format!("{track_name}-{artist_name}-{index}"));
    Some(LyricsCandidate {
        id: slugify(&id_seed).if_empty_else(|| format!("candidate-{}", index + 1)),
        track_name,
        artist_name,
        album_name,
        duration_sec,
        is_synced: synced.is_some(),
        raw: raw.clone(),
        preview: plain.unwrap_or_else(|| raw.clone()),
    })
}

trait IfEmptyElse {
    fn if_empty_else(self, fallback: impl FnOnce() -> String) -> String;
}

impl IfEmptyElse for String {
    fn if_empty_else(self, fallback: impl FnOnce() -> String) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

async fn fetch_lyrics_search_candidates_for(
    artist: &str,
    title: &str,
    album: Option<&str>,
    song: &SongInput,
) -> Result<Vec<LyricsCandidate>, String> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut params = vec![("artist_name", artist), ("track_name", title)];
    if let Some(album) = album {
        if !album.trim().is_empty() && !is_unknown_album(album) {
            params.push(("album_name", album));
        }
    }
    let url = Url::parse_with_params("https://lrclib.net/api/search", &params).map_err(|err| err.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "Amply/1.0 (https://github.com/ampl-musicplayer)")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    let payload: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let array = payload.as_array().cloned().unwrap_or_default();
    let mut parsed = Vec::new();
    for (index, entry) in array.into_iter().enumerate() {
        if let Ok(hit) = serde_json::from_value::<LrcLibSearchHit>(entry) {
            if let Some(candidate) = to_candidate(song, &hit, index) {
                parsed.push(candidate);
            }
        }
    }
    Ok(dedupe_candidates(parsed))
}

async fn fetch_lyrics_single_candidate_for(
    artist: &str,
    title: &str,
    album: Option<&str>,
    song: &SongInput,
) -> Result<Vec<LyricsCandidate>, String> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut params = vec![("artist_name", artist), ("track_name", title)];
    if let Some(album) = album {
        if !album.trim().is_empty() && !is_unknown_album(album) {
            params.push(("album_name", album));
        }
    }
    let url = Url::parse_with_params("https://lrclib.net/api/get", &params).map_err(|err| err.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "Amply/1.0 (https://github.com/ampl-musicplayer)")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    let payload: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    if payload.is_array() || payload.is_null() {
        return Ok(Vec::new());
    }
    if let Ok(hit) = serde_json::from_value::<LrcLibSearchHit>(payload) {
        if let Some(candidate) = to_candidate(song, &hit, 0) {
            return Ok(vec![candidate]);
        }
    }
    Ok(Vec::new())
}

async fn fetch_lyrics_candidates(song: &SongInput) -> Result<Vec<LyricsCandidate>, String> {
    let artist = metadata_artist_for_song(song);
    let title = song.title.trim().to_string();
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(Vec::new());
    }

    let cleaned_title = clean_lyrics_title(&title, Some(&artist));
    let parsed = split_artist_title_hint(&title);
    let mut queries: Vec<(String, String, Option<String>)> = Vec::new();
    let album = song
        .album
        .as_deref()
        .filter(|value| !value.trim().is_empty() && !is_unknown_album(value));
    let mut push_query = |artist: String, title: String, album: Option<String>| {
        if artist.trim().is_empty() || title.trim().is_empty() {
            return;
        }
        queries.push((artist, title, album));
    };

    if !cleaned_title.trim().is_empty() {
        push_query(artist.clone(), cleaned_title.clone(), album.map(|value| value.to_string()));
        push_query(artist.clone(), cleaned_title.clone(), None);
    }
    push_query(artist.clone(), title.clone(), album.map(|value| value.to_string()));
    push_query(artist.clone(), title.clone(), None);

    if let Some((parsed_artist, parsed_title)) = parsed {
        if normalize_artist(&parsed_artist) == normalize_artist(&artist) {
            let cleaned = clean_lyrics_title(&parsed_title, Some(&artist));
            push_query(artist.clone(), cleaned, None);
        } else if song.artist.trim().eq_ignore_ascii_case("unknown artist") {
            let cleaned = clean_lyrics_title(&parsed_title, Some(&parsed_artist));
            push_query(parsed_artist, cleaned, None);
        }
    }

    let mut seen = HashSet::new();
    let mut all_candidates = Vec::new();
    for (artist, title, album) in &queries {
        let key = format!(
            "{}::{}::{}",
            normalize_artist(artist),
            normalize_title(title),
            album.as_deref().map(normalize_title).unwrap_or_default(),
        );
        if !seen.insert(key) {
            continue;
        }
        let results = fetch_lyrics_search_candidates_for(artist, title, album.as_deref(), song).await?;
        all_candidates.extend(results);
    }
    if all_candidates.is_empty() {
        for (artist, title, album) in &queries {
            let results = fetch_lyrics_single_candidate_for(artist, title, album.as_deref(), song).await?;
            all_candidates.extend(results);
        }
    }
    Ok(dedupe_candidates(all_candidates))
}

fn build_lyrics_result(raw: &str, cache_key: &str, from_cache: bool) -> LyricsLoadResult {
    LyricsLoadResult {
        status: "ready".to_string(),
        raw: Some(raw.to_string()),
        cache_path: to_storage_cache_path(cache_key),
        from_cache: Some(from_cache),
    }
}

#[tauri::command]
pub async fn lyrics_find_candidates_rust(
    _app: tauri::AppHandle,
    song: SongInput,
) -> Result<Vec<LyricsCandidate>, String> {
    let candidates = fetch_lyrics_candidates(&song).await.unwrap_or_default();
    Ok(rank_candidates(&song, candidates))
}

#[tauri::command]
pub async fn lyrics_read_cached_rust(
    app: tauri::AppHandle,
    song: SongInput,
) -> Result<LyricsLoadResult, String> {
    let key = cache_key_for_song(&song);
    if let Some((cache_key, text)) = read_cached_lyrics_text(&app, &song).await? {
        if !text.trim().is_empty() {
            return Ok(build_lyrics_result(&text, &cache_key, true));
        }
    }
    Ok(LyricsLoadResult {
        status: "missing".to_string(),
        raw: None,
        cache_path: to_storage_cache_path(&key),
        from_cache: None,
    })
}

#[tauri::command]
pub async fn lyrics_save_selection_rust(
    app: tauri::AppHandle,
    song: SongInput,
    candidate: LyricsCandidate,
) -> Result<LyricsSaveResult, String> {
    let key = cache_key_for_song(&song);
    write_text(&app, &key, &candidate.raw).await?;
    if let Some(song_id) = song.id.as_ref() {
        let mut index = read_lyrics_index(&app).await?;
        if index.get(song_id) != Some(&key) {
            index.insert(song_id.clone(), key.clone());
            write_lyrics_index(&app, &index).await?;
        }
    }
    Ok(LyricsSaveResult {
        status: "ready".to_string(),
        raw: Some(candidate.raw),
        cache_path: to_storage_cache_path(&key),
    })
}

#[tauri::command]
pub async fn lyrics_load_rust(
    app: tauri::AppHandle,
    song: SongInput,
) -> Result<LyricsLoadResult, String> {
    let key = cache_key_for_song(&song);
    if let Some((cache_key, text)) = read_cached_lyrics_text(&app, &song).await? {
        if validate_lyrics_quality(&text) {
            if let Some(song_id) = song.id.as_ref() {
                let mut index = read_lyrics_index(&app).await?;
                if index.get(song_id) != Some(&key) {
                    index.insert(song_id.clone(), key.clone());
                    write_lyrics_index(&app, &index).await?;
                }
            }
            if cache_key != key {
                let _ = write_text(&app, &key, &text).await;
            }
            return Ok(build_lyrics_result(&text, &cache_key, true));
        } else {
            let _ = write_text(&app, &cache_key, "").await;
        }
    }

    let candidates = fetch_lyrics_candidates(&song).await.unwrap_or_default();
    if candidates.is_empty() {
        return Ok(LyricsLoadResult {
            status: "missing".to_string(),
            raw: None,
            cache_path: to_storage_cache_path(&key),
            from_cache: None,
        });
    }

    let ranked = rank_candidates(&song, candidates);
    let best = match ranked.first() {
        Some(candidate) => candidate.clone(),
        None => {
            return Ok(LyricsLoadResult {
                status: "missing".to_string(),
                raw: None,
                cache_path: to_storage_cache_path(&key),
                from_cache: None,
            })
        }
    };

    if !validate_lyrics_quality(&best.raw) {
        return Ok(LyricsLoadResult {
            status: "missing".to_string(),
            raw: None,
            cache_path: to_storage_cache_path(&key),
            from_cache: None,
        });
    }

    write_text(&app, &key, &best.raw).await?;
    if let Some(song_id) = song.id.as_ref() {
        let mut index = read_lyrics_index(&app).await?;
        if index.get(song_id) != Some(&key) {
            index.insert(song_id.clone(), key.clone());
            write_lyrics_index(&app, &index).await?;
        }
    }

    Ok(build_lyrics_result(&best.raw, &key, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lyrics_cache_key_uses_cleaned_upload_title() {
        let song = SongInput {
            id: Some("never-see-me-again".to_string()),
            title: "Kanye West - Never See Me Again - High Quality Vocals + Orchestral Intro".to_string(),
            artist: "Kanye West".to_string(),
            album: Some("Single".to_string()),
            duration: Some(600.0),
            genre: None,
        };

        assert_eq!(
            cache_key_for_song(&song),
            "lyrics_cache/kanye-west-never-see-me-again.lrc"
        );
    }

    #[test]
    fn lyrics_legacy_keys_include_raw_upload_title() {
        let song = SongInput {
            id: Some("never-see-me-again".to_string()),
            title: "Kanye West - Never See Me Again - High Quality Vocals + Orchestral Intro".to_string(),
            artist: "Kanye West".to_string(),
            album: Some("Single".to_string()),
            duration: Some(600.0),
            genre: None,
        };
        let keys = legacy_cache_keys_for_song(&song);

        assert!(keys.contains(
            &"lyrics_cache/kanye-west-kanye-west-never-see-me-again-high-quality-vocals-orchestral-intro-single.lrc".to_string()
        ));
        assert!(keys.contains(&"lyrics_cache/kanye-west-never-see-me-again-single.lrc".to_string()));
    }

    #[test]
    fn lyrics_candidate_score_prefers_cleaned_title_match() {
        let song = SongInput {
            id: Some("never-see-me-again".to_string()),
            title: "Kanye West - Never See Me Again - High Quality Vocals + Orchestral Intro".to_string(),
            artist: "Kanye West".to_string(),
            album: Some("Single".to_string()),
            duration: Some(600.0),
            genre: None,
        };
        let cleaned_candidate = LyricsCandidate {
            id: "clean".to_string(),
            track_name: "Never See Me Again".to_string(),
            artist_name: "Kanye West".to_string(),
            album_name: None,
            duration_sec: Some(600.0),
            is_synced: true,
            raw: "[00:01.00]Line one\n[00:02.00]Line two".to_string(),
            preview: "Line one\nLine two".to_string(),
        };
        let noisy_candidate = LyricsCandidate {
            track_name: song.title.clone(),
            id: "noisy".to_string(),
            artist_name: "Kanye West".to_string(),
            album_name: None,
            duration_sec: Some(600.0),
            is_synced: true,
            raw: "[00:01.00]Line one\n[00:02.00]Line two".to_string(),
            preview: "Line one\nLine two".to_string(),
        };

        assert!(score_candidate(&song, &cleaned_candidate) > score_candidate(&song, &noisy_candidate));
    }

    #[test]
    fn lyrics_quality_allows_repetitive_valid_lyrics() {
        let raw = "[00:01.00]Hello\n[00:02.00]Hello\n[00:03.00]Goodbye\n[00:04.00]Hello";
        assert!(validate_lyrics_quality(raw));
    }

    #[test]
    fn lyrics_quality_rejects_one_repeated_line_only() {
        let raw = "[00:01.00]Na\n[00:02.00]Na\n[00:03.00]Na\n[00:04.00]Na\n[00:05.00]Na\n[00:06.00]Na\n[00:07.00]Na";
        assert!(!validate_lyrics_quality(raw));
    }
}
