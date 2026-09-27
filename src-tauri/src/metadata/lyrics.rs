use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
    time::Duration,
};

use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};

use super::cache::{read_json, read_text, to_storage_cache_path, write_json, write_text};
use super::http::{describe_transport_error, is_offline_error, HTTP};
use super::normalize::{
    clean_lyrics_title, get_primary_artist_name, is_low_confidence_artist_name, is_unknown_album,
    metadata_artist_for_song, normalize_plain_lyrics, normalize_text, normalize_whitespace, safe_includes, slugify,
    split_artist_names,
};
use super::{
    now_unix, LyricsCandidate, LyricsLoadResult, LyricsSaveResult, SongInput, LYRICS_CACHE_FOLDER, LYRICS_INDEX_PATH,
};
use crate::error::AmplyResult;
use crate::storage::delete_storage_kv;

/// [mm:ss], [mm:ss.xx], [mm:ss.xxx] and the colon variant [mm:ss:xx].
static TIME_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]").unwrap());
/// Enhanced-LRC word timings, <mm:ss.xx>, stripped from the displayed text.
static WORD_TIME_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>").unwrap());
/// A whole-line metadata tag: [ar:Artist], [ti:Title], [offset:+250], [length:3:41].
static META_TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[([A-Za-z#]+):([^\]]*)\]$").unwrap());

/// Serialises read-modify-write cycles on the lyrics index so concurrent lyrics
/// loads cannot drop each other's entries.
static LYRICS_INDEX_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

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

/// Points `song_id` at `key` in the lyrics index (no-op when already mapped).
async fn set_lyrics_index_entry(app: &tauri::AppHandle, song_id: &str, key: &str) -> Result<(), String> {
    let _guard = LYRICS_INDEX_LOCK.lock().await;
    let mut index = read_lyrics_index(app).await?;
    if index.get(song_id).map(String::as_str) != Some(key) {
        index.insert(song_id.to_string(), key.to_string());
        write_lyrics_index(app, &index).await?;
    }
    Ok(())
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

/// Milliseconds from an LRC fraction: "5" is 500 ms, "50" is 500 ms, "123" is 123 ms.
fn fraction_ms(fraction: &str) -> i64 {
    let digits: String = fraction.chars().take(3).collect();
    format!("{digits:0<3}").parse().unwrap_or(0)
}

fn parse_lrc(raw: &str) -> Vec<LyricLine> {
    let mut offset_ms = 0i64;
    let mut parsed: Vec<LyricLine> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        // [ar:], [ti:], [length:], [by:] ... are metadata, not lyrics; [offset:±ms] shifts timings.
        if let Some(caps) = META_TAG_RE.captures(trimmed) {
            if caps[1].eq_ignore_ascii_case("offset") {
                offset_ms = caps[2].trim().parse().unwrap_or(0);
            }
            continue;
        }
        let without_times = TIME_TAG_RE.replace_all(trimmed, "");
        let text = WORD_TIME_TAG_RE.replace_all(&without_times, "").trim().to_string();
        let matches: Vec<_> = TIME_TAG_RE.captures_iter(trimmed).collect();
        if matches.is_empty() {
            if !text.is_empty() {
                parsed.push(LyricLine { time_ms: None, text });
            }
            continue;
        }
        for capture in matches {
            let mins = capture.get(1).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
            let secs = capture.get(2).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
            let fraction = capture.get(3).map(|m| fraction_ms(m.as_str())).unwrap_or(0);
            let time_ms = (mins * 60_000 + secs * 1_000 + fraction - offset_ms).max(0);
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
        // Sorted above, so only gaps can be wrong: five minutes of silence means a broken file.
        let times: Vec<i64> = timed.iter().filter_map(|line| line.time_ms).collect();
        if times.windows(2).any(|pair| pair[1] - pair[0] > 300_000) {
            return false;
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

/// Punctuation-, case- and script-insensitive comparison key ("Don’t" == "Don't").
fn match_key(value: &str) -> String {
    normalize_text(value)
}

fn title_score(song: &SongInput, candidate: &LyricsCandidate) -> i32 {
    let cleaned_title = lyrics_title_for_song(song);
    let candidate_title = match_key(&candidate.track_name);
    let candidate_clean = match_key(&clean_lyrics_title(&candidate.track_name, None));
    if candidate_title == match_key(&cleaned_title) || candidate_clean == match_key(&cleaned_title) {
        8
    } else if candidate_title == match_key(&song.title) {
        5
    } else if safe_includes(&candidate.track_name, &cleaned_title) {
        4
    } else if safe_includes(&candidate.track_name, &song.title) {
        2
    } else {
        0
    }
}

fn artist_score(song: &SongInput, candidate: &LyricsCandidate) -> i32 {
    let primary_artist = metadata_artist_for_song(song);
    let fallback_artist = get_primary_artist_name(&song.artist);
    let candidate_artist = match_key(&candidate.artist_name);
    if !candidate_artist.is_empty() && candidate_artist == match_key(&primary_artist) {
        5
    } else if !fallback_artist.eq_ignore_ascii_case(&primary_artist) && candidate_artist == match_key(&fallback_artist) {
        4
    } else if safe_includes(&candidate.artist_name, &primary_artist)
        // Credits are listed in different orders by different uploads ("Gopi Sundar, Vijay Yesudas"
        // vs "Vijay Yesudas, Sachin Warrier"): any shared credited artist counts.
        || split_artist_names(&song.artist).iter().any(|name| safe_includes(&candidate.artist_name, name))
    {
        2
    } else {
        0
    }
}

/// Seconds between the candidate's and the song's durations, when both are known.
fn duration_gap(song: &SongInput, candidate: &LyricsCandidate) -> Option<f64> {
    match (candidate.duration_sec, song.duration) {
        (Some(candidate), Some(song)) if candidate > 0.0 && song > 0.0 => Some((candidate - song).abs()),
        _ => None,
    }
}

fn score_candidate(song: &SongInput, candidate: &LyricsCandidate) -> i32 {
    let mut score = title_score(song, candidate) + artist_score(song, candidate);

    if let (Some(candidate_album), Some(song_album)) = (&candidate.album_name, &song.album) {
        if !is_unknown_album(song_album) && match_key(candidate_album) == match_key(song_album) {
            score += 3;
        }
    }
    if candidate.is_synced {
        score += 2;
    }
    match duration_gap(song, candidate) {
        Some(gap) if gap <= 2.0 => score += 3,
        Some(gap) if gap <= 7.0 => score += 2,
        Some(gap) if gap <= 12.0 => score += 1,
        _ => {}
    }
    score
}

/// Whether a candidate is plausibly this recording: the title has to match, and the artist or the
/// duration has to agree. More than 15 s off is a different recording (a remix, a live cut, another
/// song with the same name), however well the names match.
fn is_acceptable_match(song: &SongInput, candidate: &LyricsCandidate) -> bool {
    let gap = duration_gap(song, candidate);
    if gap.is_some_and(|gap| gap > 15.0) {
        return false;
    }
    title_score(song, candidate) >= 4 && (artist_score(song, candidate) >= 2 || gap.is_some_and(|gap| gap <= 3.0))
}

/// Good enough to stop asking: acceptable, time-synced, and the same length (when known).
fn is_confident_match(song: &SongInput, candidate: &LyricsCandidate) -> bool {
    candidate.is_synced
        && is_acceptable_match(song, candidate)
        && duration_gap(song, candidate).is_none_or(|gap| gap <= 3.0)
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
    /// lrclib marks tracks it knows to have no vocals.
    instrumental: Option<bool>,
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
    let synced = hit.synced_lyrics.clone().or_else(|| hit.synced_lyrics_alt.clone()).filter(|text| !text.trim().is_empty());
    let plain_raw = hit.plain_lyrics.clone().or_else(|| hit.plain_lyrics_alt.clone()).filter(|text| !text.trim().is_empty());
    let plain = plain_raw.as_ref().map(|value| normalize_plain_lyrics(value));
    let raw = synced.clone().or_else(|| plain_raw.clone())?;
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

/// What one lrclib request came back with.
enum LrcLibReply {
    Hits(Vec<LrcLibSearchHit>),
    /// 404, another non-success status, or an empty answer.
    Nothing,
    /// 429: stop asking for now, and do not remember a miss.
    Throttled,
}

async fn lrclib_request(endpoint: &str, params: &[(&str, String)], timeout: Duration) -> Result<LrcLibReply, String> {
    let url = Url::parse_with_params(&format!("https://lrclib.net/api/{endpoint}"), params).map_err(|err| err.to_string())?;
    let response = HTTP.get(url).timeout(timeout).send().await.map_err(describe_transport_error)?;
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Ok(LrcLibReply::Throttled);
    }
    if !status.is_success() {
        return Ok(LrcLibReply::Nothing);
    }
    let payload: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let hits: Vec<LrcLibSearchHit> = match payload {
        serde_json::Value::Array(items) => items.into_iter().filter_map(|item| serde_json::from_value(item).ok()).collect(),
        object @ serde_json::Value::Object(_) => serde_json::from_value(object).ok().into_iter().collect(),
        _ => Vec::new(),
    };
    Ok(if hits.is_empty() { LrcLibReply::Nothing } else { LrcLibReply::Hits(hits) })
}

/// At most this many requests per song and lookup: one exact match plus a few searches.
const MAX_LYRICS_REQUESTS: usize = 4;

/// One planned lrclib request.
struct LyricsLookup {
    endpoint: &'static str,
    params: Vec<(&'static str, String)>,
    timeout: Duration,
}

/// Cheapest and most precise first: the exact endpoint (it needs album and duration), then searches
/// by the cleaned and the raw title, then free text when the artist field is a channel or unknown.
/// Identical requests are planned once.
fn plan_lyrics_lookups(song: &SongInput) -> Vec<LyricsLookup> {
    let artist = metadata_artist_for_song(song);
    let artist_known = !is_low_confidence_artist_name(&artist);
    let raw_title = normalize_whitespace(&song.title);
    let clean_title = lyrics_title_for_song(song);
    let album = song
        .album
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !is_unknown_album(value))
        .map(str::to_string);
    let duration = song.duration.filter(|value| *value > 0.0).map(|value| value.round() as u32);

    let mut lookups: Vec<LyricsLookup> = Vec::new();
    let mut planned: HashSet<String> = HashSet::new();
    let mut push = |endpoint: &'static str, params: Vec<(&'static str, String)>, timeout: Duration| {
        if params.iter().any(|(_, value)| value.trim().is_empty()) {
            return;
        }
        let signature = format!(
            "{endpoint}?{}",
            params.iter().map(|(key, value)| format!("{key}={}", value.to_lowercase())).collect::<Vec<_>>().join("&")
        );
        if planned.insert(signature) {
            lookups.push(LyricsLookup { endpoint, params, timeout });
        }
    };

    if artist_known {
        if let (Some(album), Some(duration)) = (&album, duration) {
            push(
                "get",
                vec![
                    ("artist_name", artist.clone()),
                    ("track_name", clean_title.clone()),
                    ("album_name", album.clone()),
                    ("duration", duration.to_string()),
                ],
                Duration::from_secs(8),
            );
        }
        push("search", vec![("artist_name", artist.clone()), ("track_name", clean_title.clone())], Duration::from_secs(10));
        if match_key(&raw_title) != match_key(&clean_title) {
            push("search", vec![("artist_name", artist.clone()), ("track_name", raw_title.clone())], Duration::from_secs(10));
        }
    } else {
        push("search", vec![("q", clean_title.clone())], Duration::from_secs(10));
    }
    lookups.truncate(MAX_LYRICS_REQUESTS);
    lookups
}

/// Outcome of looking a song's lyrics up online.
enum LyricsFetch {
    Found(Vec<LyricsCandidate>),
    /// The service knows this track and says it has no vocals.
    Instrumental,
    /// Every request completed and nothing matched.
    NotFound,
    /// A request could not reach the service (offline, DNS, timeout): try again later.
    Offline,
    /// The service asked us to slow down: try again later.
    Throttled,
}

/// Runs the planned lookups. Unless `exhaustive`, stops at the first confident synced match.
/// A failed request no longer aborts the rest; only being offline or throttled does.
async fn fetch_lyrics_candidates(song: &SongInput, exhaustive: bool) -> LyricsFetch {
    let clean_title = match_key(&lyrics_title_for_song(song));
    let mut candidates: Vec<LyricsCandidate> = Vec::new();
    let mut instrumental = false;
    let mut interrupted: Option<LyricsFetch> = None;

    for lookup in plan_lyrics_lookups(song) {
        let reply = match lrclib_request(lookup.endpoint, &lookup.params, lookup.timeout).await {
            Ok(reply) => reply,
            Err(error) if is_offline_error(&error) => {
                log::warn!("Lyrics lookup for {:?} could not reach lrclib: {error}", song.title);
                interrupted = Some(LyricsFetch::Offline);
                break;
            }
            Err(error) => {
                log::warn!("Lyrics {} request for {:?} failed: {error}", lookup.endpoint, song.title);
                continue;
            }
        };
        match reply {
            LrcLibReply::Throttled => {
                interrupted = Some(LyricsFetch::Throttled);
                break;
            }
            LrcLibReply::Nothing => continue,
            LrcLibReply::Hits(hits) => {
                for hit in &hits {
                    let same_track = hit
                        .track_name
                        .as_deref()
                        .or(hit.track_name_alt.as_deref())
                        .is_some_and(|name| match_key(&clean_lyrics_title(name, None)) == clean_title);
                    if hit.instrumental == Some(true) && same_track {
                        instrumental = true;
                    }
                    if let Some(candidate) = to_candidate(song, hit, candidates.len()) {
                        candidates.push(candidate);
                    }
                }
            }
        }
        if !exhaustive && candidates.iter().any(|candidate| is_confident_match(song, candidate)) {
            break;
        }
    }

    if !candidates.is_empty() {
        LyricsFetch::Found(dedupe_candidates(candidates))
    } else if let Some(interrupted) = interrupted {
        interrupted
    } else if instrumental {
        LyricsFetch::Instrumental
    } else {
        LyricsFetch::NotFound
    }
}

/// A remembered lookup that found nothing, so the next play does not ask lrclib again.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LyricsMiss {
    at: i64,
    instrumental: bool,
}

/// How long a "no lyrics" answer is trusted before asking again (lrclib grows every day).
const LYRICS_MISS_TTL_SECS: i64 = 14 * 24 * 60 * 60;

fn lyrics_miss_key(cache_key: &str) -> String {
    let stem = cache_key
        .trim_start_matches(&format!("{LYRICS_CACHE_FOLDER}/"))
        .trim_end_matches(".lrc");
    format!("{LYRICS_CACHE_FOLDER}/_miss/{stem}.json")
}

async fn remember_lyrics_miss(app: &tauri::AppHandle, cache_key: &str, instrumental: bool) {
    let miss = LyricsMiss { at: now_unix(), instrumental };
    if let Err(error) = write_json(app, &lyrics_miss_key(cache_key), &miss).await {
        log::warn!("Failed to remember lyrics miss for {cache_key}: {error}");
    }
}

fn build_lyrics_result(raw: &str, cache_key: &str, from_cache: bool) -> LyricsLoadResult {
    LyricsLoadResult {
        status: "ready".to_string(),
        raw: Some(raw.to_string()),
        cache_path: to_storage_cache_path(cache_key),
        from_cache: Some(from_cache),
    }
}

fn lyrics_status(status: &str, cache_key: &str) -> LyricsLoadResult {
    LyricsLoadResult {
        status: status.to_string(),
        raw: None,
        cache_path: to_storage_cache_path(cache_key),
        from_cache: None,
    }
}

#[tauri::command]
pub async fn lyrics_find_candidates_rust(
    _app: tauri::AppHandle,
    song: SongInput,
) -> AmplyResult<Vec<LyricsCandidate>> {
    // A manual search shows everything found, including weak matches: the user is choosing.
    let candidates = match fetch_lyrics_candidates(&song, true).await {
        LyricsFetch::Found(candidates) => candidates,
        _ => Vec::new(),
    };
    Ok(rank_candidates(&song, candidates))
}

#[tauri::command]
pub async fn lyrics_save_selection_rust(
    app: tauri::AppHandle,
    song: SongInput,
    candidate: LyricsCandidate,
) -> AmplyResult<LyricsSaveResult> {
    let key = cache_key_for_song(&song);
    write_text(&app, &key, &candidate.raw).await?;
    if let Some(song_id) = song.id.as_deref() {
        set_lyrics_index_entry(&app, song_id, &key).await?;
    }
    // A hand-picked result overrides any remembered miss.
    if let Err(error) = delete_storage_kv(&app, &lyrics_miss_key(&key)).await {
        log::debug!("No lyrics miss to clear for {key}: {error}");
    }
    Ok(LyricsSaveResult {
        status: "ready".to_string(),
        raw: Some(candidate.raw),
        cache_path: to_storage_cache_path(&key),
    })
}

/// Cached lyrics, else a remembered miss, else a lookup. Statuses: "ready", "missing",
/// "instrumental" (the service says the track has no vocals), "offline" (try again later).
/// Lyric files larger than this are not lyrics.
const MAX_SIDECAR_BYTES: u64 = 512 * 1024;

/// Lyrics the user keeps next to the song: "Song.lrc" (timed) or "Song.txt" (plain) beside
/// "Song.mp3". Returns the file's path and text when one exists and reads as real lyrics.
fn read_sidecar_lyrics(audio_path: &str) -> Option<(String, String)> {
    let audio = std::path::Path::new(audio_path);
    ["lrc", "txt"].iter().find_map(|extension| {
        let candidate = audio.with_extension(extension);
        let metadata = std::fs::metadata(&candidate).ok()?;
        if !metadata.is_file() || metadata.len() > MAX_SIDECAR_BYTES {
            return None;
        }
        let bytes = std::fs::read(&candidate).ok()?;
        let text = String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string();
        validate_lyrics_quality(&text).then(|| (candidate.to_string_lossy().into_owned(), text))
    })
}

#[tauri::command]
pub async fn lyrics_load_rust(
    app: tauri::AppHandle,
    song: SongInput,
) -> AmplyResult<LyricsLoadResult> {
    // A lyrics file next to the song is the user's own choice and beats anything downloaded.
    if let Some(path) = song.path.clone() {
        let sidecar = tauri::async_runtime::spawn_blocking(move || read_sidecar_lyrics(&path))
            .await
            .map_err(|err| err.to_string())?;
        if let Some((sidecar_path, text)) = sidecar {
            return Ok(build_lyrics_result(&text, &sidecar_path, true));
        }
    }

    let key = cache_key_for_song(&song);
    if let Some((cache_key, text)) = read_cached_lyrics_text(&app, &song).await? {
        if validate_lyrics_quality(&text) {
            if let Some(song_id) = song.id.as_deref() {
                set_lyrics_index_entry(&app, song_id, &key).await?;
            }
            if cache_key != key {
                if let Err(error) = write_text(&app, &key, &text).await {
                    log::warn!("Failed to copy lyrics cache {cache_key} to {key}: {error}");
                }
            }
            return Ok(build_lyrics_result(&text, &cache_key, true));
        }
        // Only this song's own entry is cleared: `cache_key` may be a legacy key or another song's
        // entry reached through the index, which must not be destroyed.
        if cache_key == key {
            if let Err(error) = write_text(&app, &key, "").await {
                log::warn!("Failed to clear low-quality lyrics cache {key}: {error}");
            }
        }
    }

    if let Some(miss) = read_json::<LyricsMiss>(&app, &lyrics_miss_key(&key)).await? {
        if miss.instrumental {
            return Ok(lyrics_status("instrumental", &key));
        }
        if now_unix() - miss.at < LYRICS_MISS_TTL_SECS {
            return Ok(lyrics_status("missing", &key));
        }
    }

    match fetch_lyrics_candidates(&song, false).await {
        LyricsFetch::Offline => Ok(lyrics_status("offline", &key)),
        LyricsFetch::Throttled => Ok(lyrics_status("missing", &key)),
        LyricsFetch::Instrumental => {
            remember_lyrics_miss(&app, &key, true).await;
            Ok(lyrics_status("instrumental", &key))
        }
        LyricsFetch::NotFound => {
            remember_lyrics_miss(&app, &key, false).await;
            Ok(lyrics_status("missing", &key))
        }
        LyricsFetch::Found(candidates) => {
            // Among acceptable matches a synced one wins even if a plain one ranks higher: timed
            // lyrics are strictly more useful (line highlighting, auto-scroll).
            let acceptable: Vec<LyricsCandidate> = rank_candidates(&song, candidates)
                .into_iter()
                .filter(|candidate| is_acceptable_match(&song, candidate) && validate_lyrics_quality(&candidate.raw))
                .collect();
            let best = acceptable
                .iter()
                .find(|candidate| candidate.is_synced)
                .or_else(|| acceptable.first())
                .cloned();
            let Some(best) = best else {
                remember_lyrics_miss(&app, &key, false).await;
                return Ok(lyrics_status("missing", &key));
            };
            write_text(&app, &key, &best.raw).await?;
            if let Some(song_id) = song.id.as_deref() {
                set_lyrics_index_entry(&app, song_id, &key).await?;
            }
            Ok(build_lyrics_result(&best.raw, &key, false))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lyrics_cache_key_uses_cleaned_upload_title() {
        let song = SongInput {
            path: None,
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
            path: None,
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
            path: None,
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
    fn lrc_parser_handles_real_world_variants() {
        let raw = "[ar:Someone]
[ti:Song]
[offset:+500]
[00:12.5]Half second
[00:20:50]Colon fraction
[00:30.00]<00:30.10>Word <00:30.50>timed
[00:40.00][00:50.00]Twice";
        let lines = parse_lrc(raw);
        let texts: Vec<_> = lines.iter().map(|line| line.text.as_str()).collect();
        assert!(!texts.iter().any(|text| text.contains("ar:") || text.contains("offset")));
        assert_eq!(lines[0].time_ms, Some(12_500 - 500));
        assert_eq!(lines[1].time_ms, Some(20_500 - 500));
        assert_eq!(lines[2].text, "Word timed");
        assert_eq!(lines.iter().filter(|line| line.text == "Twice").count(), 2);
    }

    #[test]
    fn acceptance_needs_title_plus_artist_or_duration() {
        let song = SongInput {
            path: None,
            id: Some("war-pigs".to_string()),
            title: "War Pigs - 2009 Remaster".to_string(),
            artist: "Black Sabbath".to_string(),
            album: Some("Paranoid".to_string()),
            duration: Some(475.0),
            genre: None,
        };
        let candidate = |track: &str, artist: &str, duration: f64| LyricsCandidate {
            id: "c".to_string(),
            track_name: track.to_string(),
            artist_name: artist.to_string(),
            album_name: None,
            duration_sec: Some(duration),
            is_synced: true,
            raw: "[00:01.00]a
[00:02.00]b".to_string(),
            preview: String::new(),
        };
        assert!(is_acceptable_match(&song, &candidate("War Pigs", "Black Sabbath", 476.0)));
        assert!(is_confident_match(&song, &candidate("War Pigs", "Black Sabbath", 476.0)));
        // Same name, other artist, other length: another song.
        assert!(!is_acceptable_match(&song, &candidate("War Pigs", "Cake", 300.0)));
        // Right song but a 40 s longer live version.
        assert!(!is_acceptable_match(&song, &candidate("War Pigs", "Black Sabbath", 515.0)));
        // Unrelated title.
        assert!(!is_acceptable_match(&song, &candidate("Iron Man", "Black Sabbath", 475.0)));
    }

    #[test]
    fn lookups_are_capped_deduplicated_and_exact_first() {
        let song = SongInput {
            path: None,
            id: None,
            title: "War Pigs - 2009 Remaster".to_string(),
            artist: "Black Sabbath".to_string(),
            album: Some("Paranoid".to_string()),
            duration: Some(475.0),
            genre: None,
        };
        let lookups = plan_lyrics_lookups(&song);
        assert!(lookups.len() <= MAX_LYRICS_REQUESTS);
        assert_eq!(lookups[0].endpoint, "get");
        let unknown = SongInput { artist: "Unknown Artist".to_string(), album: None, ..song };
        let lookups = plan_lyrics_lookups(&unknown);
        assert_eq!(lookups.len(), 1);
        assert_eq!(lookups[0].params[0].0, "q");
    }

    #[test]
    fn lyrics_files_beside_the_song_win_and_junk_is_ignored() {
        let dir = std::env::temp_dir().join(format!("amply-sidecar-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let song = dir.join("Song.mp3");
        let lrc = "[00:01.00]First line of the song\n[00:04.00]Second line goes here\n[00:08.00]Third line keeps going\n[00:12.00]Fourth line is different\n[00:16.00]Fifth line to be sure\n[00:20.00]Sixth and final line\n";
        std::fs::write(dir.join("Song.txt"), "plain\nwords\n").unwrap();
        std::fs::write(dir.join("Song.lrc"), format!("\u{feff}{lrc}")).unwrap();
        let (path, text) = read_sidecar_lyrics(&song.to_string_lossy()).expect("the .lrc file");
        assert!(path.ends_with("Song.lrc"));
        assert!(text.starts_with("[00:01.00]"), "BOM stripped");

        // Metadata only, no lyric lines: not lyrics, so the online lookup still runs.
        std::fs::write(dir.join("Song.lrc"), "[ar:Someone]\n[ti:Song]\n").unwrap();
        std::fs::remove_file(dir.join("Song.txt")).unwrap();
        assert!(read_sidecar_lyrics(&song.to_string_lossy()).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn miss_keys_live_beside_the_lyrics() {
        assert_eq!(lyrics_miss_key("lyrics_cache/a-b.lrc"), "lyrics_cache/_miss/a-b.json");
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

#[cfg(test)]
mod live_probe {
    use super::*;

    /// Live lrclib check against real library titles: `cargo test -- --ignored lyrics_live_probe --nocapture`.
    #[test]
    #[ignore]
    fn lyrics_live_probe() {
        let cases = [
            ("Black Sabbath", "War Pigs - 2009 Remaster", "Paranoid", 475.0),
            ("Eagles", "Hotel California - 2013 Remaster", "Hotel California", 391.0),
            ("Gopi Sundar, Vijay Yesudas, Sachin Warrier", "Maangalyam - From \"Bangalore Days\"", "Bangalore Days", 234.0),
            ("Backstreet Boys", "Everybody (Backstreet's Back) - Radio Edit", "Backstreet's Back", 225.0),
            ("Kendrick Lamar", "For Free? - Interlude", "To Pimp A Butterfly", 130.0),
            ("Pink Floyd", "Speak to Me", "The Dark Side of the Moon", 65.0),
        ];
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for (artist, title, album, duration) in cases {
            let song = SongInput {
                path: None,
                id: None,
                title: title.to_string(),
                artist: artist.to_string(),
                album: Some(album.to_string()),
                duration: Some(duration),
                genre: None,
            };
            let started = std::time::Instant::now();
            let requests = plan_lyrics_lookups(&song).len();
            let outcome = rt.block_on(fetch_lyrics_candidates(&song, false));
            let summary = match outcome {
                LyricsFetch::Found(candidates) => {
                    let acceptable: Vec<_> = rank_candidates(&song, candidates)
                        .into_iter()
                        .filter(|c| is_acceptable_match(&song, c) && validate_lyrics_quality(&c.raw))
                        .collect();
                    let best = acceptable.iter().find(|c| c.is_synced).or_else(|| acceptable.first()).cloned();
                    match best {
                        Some(best) => format!("FOUND {} / {} synced={}", best.artist_name, best.track_name, best.is_synced),
                        None => "found candidates but none acceptable".to_string(),
                    }
                }
                LyricsFetch::Instrumental => "INSTRUMENTAL".to_string(),
                LyricsFetch::NotFound => "not found".to_string(),
                LyricsFetch::Offline => "offline".to_string(),
                LyricsFetch::Throttled => "throttled".to_string(),
            };
            eprintln!("{title:55} planned={requests} {:>5}ms  {summary}", started.elapsed().as_millis());
        }
    }
}
