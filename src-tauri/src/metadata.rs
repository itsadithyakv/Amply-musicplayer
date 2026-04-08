use std::{
    collections::{HashMap, HashSet},
    fs,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use once_cell::sync::Lazy;
use tokio::sync::Mutex;
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use crate::resolve_storage_path;

static TIME_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]").unwrap());

static FEAT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bfeat\.?\b|\bft\.?\b|\bfeaturing\b").unwrap());
static PARENS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*[\(\[].*?[\)\]]").unwrap());
static NON_ALNUM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static MULTISPACE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());
static TRACK_CLEAN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(remaster(ed)?|mono|stereo|bonus track|explicit|clean)\b").unwrap());
static MB_LAST_REQUEST: Lazy<Mutex<Option<std::time::Instant>>> = Lazy::new(|| Mutex::new(None));

const ARTIST_CACHE_FOLDER: &str = "artist_cache";
const LYRICS_CACHE_FOLDER: &str = "lyrics_cache";
const LYRICS_INDEX_PATH: &str = "lyrics_cache/index.json";
const ALBUM_ART_CACHE_PATH: &str = "metadata_cache/album_art_cache.json";
const ALBUM_TRACKLIST_CACHE_PATH: &str = "metadata_cache/album_tracklist_cache.json";
const SONG_GENRE_CACHE_PATH: &str = "metadata_cache/song_genre_cache.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistProfile {
    pub artist_name: String,
    pub summary: String,
    pub image_url: Option<String>,
    pub source_url: Option<String>,
    pub fetched_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistProfileLoadResult {
    pub status: String,
    pub profile: Option<ArtistProfile>,
    pub from_cache: Option<bool>,
    pub cache_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumTrack {
    pub position: u32,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumTracklist {
    pub key: String,
    pub album: String,
    pub artist: String,
    pub tracks: Vec<AlbumTrack>,
    pub source: String,
    pub fetched_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongInput {
    pub id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub genre: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongGenreCacheEntry {
    pub genre: String,
    pub fetched_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongGenreLoadResult {
    pub status: String,
    pub genre: Option<String>,
    pub from_cache: Option<bool>,
    pub cache_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsCandidate {
    pub id: String,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    pub duration_sec: Option<f64>,
    pub is_synced: bool,
    pub raw: String,
    pub preview: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLoadResult {
    pub status: String,
    pub raw: Option<String>,
    pub cache_path: String,
    pub from_cache: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSaveResult {
    pub status: String,
    pub raw: Option<String>,
    pub cache_path: String,
}

#[derive(Clone, Debug)]
struct LyricLine {
    time_ms: Option<i64>,
    text: String,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn normalize_text(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    let spaced = NON_ALNUM_RE.replace_all(&lower, " ");
    MULTISPACE_RE.replace_all(&spaced, " ").trim().to_string()
}

fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .count()
}

fn is_disambiguation_text(value: &str) -> bool {
    let text = normalize_text(value);
    text.contains("may refer to") || text.contains("can refer to")
}

fn is_music_related_text(value: &str) -> bool {
    let text = normalize_text(value);
    let keywords = [
        "band",
        "musician",
        "singer",
        "rapper",
        "dj",
        "group",
        "music",
        "album",
        "song",
    ];
    keywords.iter().any(|keyword| text.contains(keyword))
}

fn is_likely_artist_title(title: &str, artist_name: &str) -> bool {
    let normalized_title = normalize_text(title);
    let normalized_artist = normalize_text(artist_name);
    let has_qualifier = normalized_title.contains("(band)")
        || normalized_title.contains("(musician)")
        || normalized_title.contains("(singer)")
        || normalized_title.contains("(rapper)")
        || normalized_title.contains("(dj)")
        || normalized_title.contains("(group)");

    normalized_title == normalized_artist
        || normalized_title.contains(&normalized_artist)
        || has_qualifier
}

fn to_word_range(value: &str, min_words: usize, max_words: usize) -> String {
    let words: Vec<&str> = value.split_whitespace().filter(|part| !part.is_empty()).collect();
    if words.is_empty() {
        return String::new();
    }
    if words.len() > max_words {
        return format!("{}...", words[..max_words].join(" "));
    }
    if words.len() < min_words {
        return words.join(" ");
    }
    words.join(" ")
}

fn to_base36(value: i64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let alphabet = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut buf = Vec::new();
    let mut num = value.abs();
    while num > 0 {
        let idx = (num % 36) as usize;
        buf.push(alphabet[idx] as char);
        num /= 36;
    }
    buf.iter().rev().collect()
}

fn hash_string(value: &str) -> String {
    let mut hash: i64 = 5381;
    for ch in value.chars() {
        hash = ((hash << 5) + hash) ^ (ch as i64);
    }
    to_base36(hash.abs())
}

fn cache_key_for_artist(artist_name: &str) -> String {
    let base = if artist_name.trim().is_empty() {
        "unknown-artist"
    } else {
        artist_name
    };
    let slug = slugify(base);
    let artist_slug = if slug.is_empty() {
        format!("artist-{}", hash_string(base))
    } else {
        slug
    };
    format!("{ARTIST_CACHE_FOLDER}/{artist_slug}.json")
}

fn cache_key_for_album_art(artist: &str, album: &str) -> String {
    format!(
        "{}--{}",
        slugify(if artist.trim().is_empty() { "unknown-artist" } else { artist }),
        slugify(if album.trim().is_empty() { "unknown-album" } else { album })
    )
}

fn normalize_track_title(value: &str) -> String {
    let lower = value.to_lowercase();
    let stripped = FEAT_RE.replace_all(&lower, "");
    let stripped = stripped.replace(" - ", " ");
    let stripped = PARENS_RE.replace_all(&stripped, " ");
    let stripped = TRACK_CLEAN_RE.replace_all(&stripped, " ");
    let stripped = NON_ALNUM_RE.replace_all(&stripped, " ");
    MULTISPACE_RE.replace_all(&stripped, " ").trim().to_string()
}

fn get_album_tracklist_key(artist: &str, album: &str) -> String {
    format!(
        "{}--{}",
        slugify(if artist.trim().is_empty() { "unknown-artist" } else { artist }),
        slugify(if album.trim().is_empty() { "unknown-album" } else { album })
    )
}

fn normalize_plain_lyrics(raw: &str) -> String {
    raw.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_match_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn safe_includes(haystack: &str, needle: &str) -> bool {
    normalize_match_name(haystack).contains(&normalize_match_name(needle))
}

fn normalize_artist(value: &str) -> String {
    let stripped = PARENS_RE.replace_all(value, " ");
    let stripped = FEAT_RE.replace_all(&stripped, " ");
    let stripped = stripped
        .replace('&', ",")
        .replace('+', ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace(" & ", ",");
    MULTISPACE_RE.replace_all(&stripped, " ").trim().to_lowercase()
}

fn split_artists(value: &str) -> Vec<String> {
    normalize_artist(value)
        .split(',')
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

fn normalize_title(value: &str) -> String {
    let cleaned = PARENS_RE.replace_all(value, " ");
    let cleaned = cleaned.split(" - ").next().unwrap_or("").trim();
    normalize_text(cleaned)
}

fn is_close_match(candidate: &str, target: &str) -> bool {
    let left = normalize_title(candidate);
    let right = normalize_title(target);
    if left.is_empty() || right.is_empty() {
        return false;
    }
    if left == right {
        return true;
    }
    if left.len() < 3 || right.len() < 3 {
        return false;
    }
    left.contains(&right) || right.contains(&left)
}

fn is_exact_match(candidate: &str, target: &str) -> bool {
    normalize_title(candidate) == normalize_title(target)
}

fn is_artist_close_match(candidate: &str, target: &str) -> bool {
    let left_parts = split_artists(candidate);
    let right_parts = split_artists(target);
    if left_parts.is_empty() || right_parts.is_empty() {
        return false;
    }
    for left in &left_parts {
        for right in &right_parts {
            if left == right {
                return true;
            }
            if left.len() >= 3 && right.len() >= 3 && (left.contains(right) || right.contains(left)) {
                return true;
            }
        }
    }
    false
}

fn normalize_whitespace(value: &str) -> String {
    MULTISPACE_RE.replace_all(value, " ").trim().to_string()
}

fn normalize_part(value: &str) -> String {
    normalize_whitespace(value.trim_matches(|c: char| ",.;/|- ".contains(c)))
}

fn split_simple_and(value: &str) -> Vec<String> {
    let lower = value.to_lowercase();
    if !lower.contains(" and ") {
        return vec![value.to_string()];
    }
    let parts: Vec<String> = value
        .split(" and ")
        .map(normalize_part)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() != 2 {
        return vec![value.to_string()];
    }

    let left_words = parts[0].split_whitespace().count();
    let right_words = parts[1].split_whitespace().count();
    let right_starts_with_the = parts[1].to_lowercase().starts_with("the ");
    let left_lower = parts[0].to_lowercase();
    let right_lower = parts[1].to_lowercase();

    if left_words == 1
        && right_words == 1
        && !right_starts_with_the
        && left_lower != "of"
        && right_lower != "of"
    {
        return parts;
    }
    vec![value.to_string()]
}

fn split_artist_names(artist: &str) -> Vec<String> {
    let raw = normalize_whitespace(artist);
    if raw.is_empty() {
        return vec!["Unknown Artist".to_string()];
    }
    let normalized = raw
        .replace("feat.", ",")
        .replace("featuring", ",")
        .replace("ft.", ",")
        .replace(" with ", ",")
        .replace('+', ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace('&', ",")
        .replace(';', ",")
        .replace('/', ",")
        .replace('|', ",");
    let mut parts: Vec<String> = Vec::new();
    for part in normalized.split(',') {
        for piece in split_simple_and(part) {
            let cleaned = normalize_part(&piece);
            if !cleaned.is_empty() {
                parts.push(cleaned);
            }
        }
    }
    if parts.is_empty() {
        return vec![raw];
    }
    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for part in parts {
        let key = part.to_lowercase();
        if seen.insert(key) {
            unique.push(part);
        }
    }
    if unique.is_empty() {
        vec![raw]
    } else {
        unique
    }
}

fn get_primary_artist_name(artist: &str) -> String {
    split_artist_names(artist).first().cloned().unwrap_or_else(|| "Unknown Artist".to_string())
}

fn is_unknown_genre(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "unknown genre"
        || normalized == "unknown"
        || normalized == "n/a"
        || normalized == "na"
        || normalized == "none"
        || normalized == "unspecified"
        || normalized == "various"
        || normalized == "other"
}

fn read_text(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    let target = resolve_storage_path(app, relative_path)?;
    if !target.exists() {
        return Ok(None);
    }
    fs::read_to_string(&target)
        .map(Some)
        .map_err(|err| err.to_string())
}

fn write_text(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    let target = resolve_storage_path(app, relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(target, content).map_err(|err| err.to_string())
}

fn read_json<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    relative_path: &str,
) -> Result<Option<T>, String> {
    if let Some(text) = read_text(app, relative_path)? {
        match serde_json::from_str::<T>(&text) {
            Ok(parsed) => return Ok(Some(parsed)),
            Err(_) => {
                if let Ok(target) = resolve_storage_path(app, relative_path) {
                    let _ = fs::remove_file(target);
                }
                return Ok(None);
            }
        }
    }
    Ok(None)
}

async fn musicbrainz_throttle() {
    let mut guard = MB_LAST_REQUEST.lock().await;
    let now = std::time::Instant::now();
    if let Some(last) = *guard {
        let elapsed = now.duration_since(last);
        if elapsed < Duration::from_millis(1100) {
            let wait_for = Duration::from_millis(1100) - elapsed;
            drop(guard);
            tokio::time::sleep(wait_for).await;
            let mut guard = MB_LAST_REQUEST.lock().await;
            *guard = Some(std::time::Instant::now());
            return;
        }
    }
    *guard = Some(now);
}

fn write_json<T: Serialize>(app: &tauri::AppHandle, relative_path: &str, value: &T) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    write_text(app, relative_path, &serialized)
}

fn to_storage_cache_path(relative_path: &str) -> String {
    format!("storage/{}", relative_path.replace('\\', "/"))
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(url: Url, user_agent: Option<&str>) -> Result<T, String> {
    let client = reqwest::Client::new();
    let mut request = client.get(url);
    if let Some(agent) = user_agent {
        request = request.header("User-Agent", agent);
    }
    request = request.header("Accept", "application/json");
    let response = request.send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }
    response.json::<T>().await.map_err(|err| err.to_string())
}

#[derive(Debug, Deserialize)]
struct WikipediaSummaryPayload {
    title: Option<String>,
    #[serde(rename = "type")]
    page_type: Option<String>,
    extract: Option<String>,
    thumbnail: Option<WikipediaThumbnail>,
    content_urls: Option<WikipediaContentUrls>,
}

#[derive(Debug, Deserialize)]
struct WikipediaThumbnail {
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WikipediaContentUrls {
    desktop: Option<WikipediaDesktopUrl>,
}

#[derive(Debug, Deserialize)]
struct WikipediaDesktopUrl {
    page: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WikipediaSearchPayload {
    query: Option<WikipediaSearchQuery>,
}

#[derive(Debug, Deserialize)]
struct WikipediaSearchQuery {
    search: Option<Vec<WikipediaSearchEntry>>,
}

#[derive(Debug, Deserialize)]
struct WikipediaSearchEntry {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WikipediaExtractPayload {
    query: Option<WikipediaExtractQuery>,
}

#[derive(Debug, Deserialize)]
struct WikipediaExtractQuery {
    pages: Option<HashMap<String, WikipediaExtractPage>>,
}

#[derive(Debug, Deserialize)]
struct WikipediaExtractPage {
    extract: Option<String>,
}

async fn fetch_wikipedia_summary(title: &str) -> Result<Option<WikipediaSummaryPayload>, String> {
    let endpoint = format!("https://en.wikipedia.org/api/rest_v1/page/summary/{}", urlencoding::encode(title));
    let url = Url::parse(&endpoint).map_err(|err| err.to_string())?;
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    response.json::<WikipediaSummaryPayload>().await.map(Some).map_err(|err| err.to_string())
}

async fn fetch_wikipedia_search_titles(artist_name: &str) -> Result<Vec<String>, String> {
    async fn search(query: String) -> Result<Vec<String>, String> {
        let url = Url::parse_with_params(
            "https://en.wikipedia.org/w/api.php",
            &[
                ("action", "query"),
                ("list", "search"),
                ("srlimit", "8"),
                ("format", "json"),
                ("origin", "*"),
                ("srsearch", query.as_str()),
            ],
        )
        .map_err(|err| err.to_string())?;
        let payload: WikipediaSearchPayload = fetch_json(url, None).await?;
        let titles = payload
            .query
            .and_then(|query| query.search)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|entry| entry.title.map(|t| t.trim().to_string()))
            .filter(|title| !title.is_empty())
            .collect::<Vec<_>>();
        Ok(titles)
    }

    let quoted_query = format!("\"{}\" musician singer rapper band", artist_name);
    let mut titles = search(quoted_query).await?;
    if titles.is_empty() {
        let fallback_query = format!("{} musician singer rapper band", artist_name);
        titles = search(fallback_query).await?;
    }

    titles.sort_by(|a, b| {
        let score = |title: &str| -> i32 {
            let mut points = 0;
            if is_likely_artist_title(title, artist_name) {
                points += 4;
            }
            if normalize_text(title) == normalize_text(artist_name) {
                points += 3;
            }
            if is_music_related_text(title) {
                points += 2;
            }
            points
        };
        score(b).cmp(&score(a))
    });

    Ok(titles)
}

async fn fetch_wikipedia_intro_extract(title: &str) -> Result<Option<String>, String> {
    let url = Url::parse_with_params(
        "https://en.wikipedia.org/w/api.php",
        &[
            ("action", "query"),
            ("prop", "extracts"),
            ("explaintext", "1"),
            ("exintro", "1"),
            ("format", "json"),
            ("origin", "*"),
            ("titles", title),
        ],
    )
    .map_err(|err| err.to_string())?;
    let payload: WikipediaExtractPayload = fetch_json(url, None).await?;
    let pages = payload.query.and_then(|query| query.pages).unwrap_or_default();
    let extract = pages.values().next().and_then(|page| page.extract.clone());
    Ok(extract.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    }))
}

async fn build_candidate_titles(artist_name: &str) -> Result<Vec<String>, String> {
    let trimmed = artist_name.trim();
    let qualifiers = ["musician", "band", "singer", "rapper", "dj", "group"];
    let mut candidates = qualifiers
        .iter()
        .map(|qualifier| format!("{trimmed} ({qualifier})"))
        .collect::<Vec<_>>();
    candidates.push(trimmed.to_string());
    let searched = fetch_wikipedia_search_titles(trimmed).await?;
    candidates.extend(searched);

    Ok(candidates
        .into_iter()
        .filter(|title| !title.trim().is_empty())
        .collect())
}

async fn fetch_artist_profile(artist_name: &str) -> Result<Option<ArtistProfile>, String> {
    let candidate_titles = build_candidate_titles(artist_name).await?;
    let mut seen = HashSet::new();

    for title in candidate_titles {
        let normalized = normalize_text(&title);
        if normalized.is_empty() || !seen.insert(normalized) {
            continue;
        }
        let summary_payload = match fetch_wikipedia_summary(&title).await? {
            Some(payload) => payload,
            None => continue,
        };

        let summary_extract = summary_payload.extract.clone().unwrap_or_default();
        let is_disambiguation = summary_payload.page_type.as_deref() == Some("disambiguation")
            || is_disambiguation_text(&summary_extract);
        if is_disambiguation {
            continue;
        }

        let resolved_title = summary_payload.title.clone().unwrap_or_else(|| title.clone());
        let intro_extract = fetch_wikipedia_intro_extract(&resolved_title).await?;
        let merged_summary = to_word_range(
            intro_extract.as_deref().unwrap_or(&summary_extract),
            100,
            200,
        );
        if merged_summary.trim().is_empty() || is_disambiguation_text(&merged_summary) {
            continue;
        }

        let title_matches = is_likely_artist_title(&resolved_title, artist_name);
        if !is_music_related_text(&merged_summary) && !title_matches {
            continue;
        }

        return Ok(Some(ArtistProfile {
            artist_name: artist_name.to_string(),
            summary: merged_summary,
            image_url: summary_payload.thumbnail.and_then(|thumb| thumb.source),
            source_url: summary_payload
                .content_urls
                .and_then(|urls| urls.desktop)
                .and_then(|desktop| desktop.page),
            fetched_at: now_unix(),
        }));
    }

    Ok(None)
}

fn is_valid_cached_summary(summary: &str) -> bool {
    if summary.trim().is_empty() {
        return false;
    }
    if is_disambiguation_text(summary) {
        return false;
    }
    is_music_related_text(summary) || count_words(summary) >= 20
}

#[tauri::command]
pub async fn has_cached_artist_profile_rust(app: tauri::AppHandle, artist_name: String) -> Result<bool, String> {
    let name = artist_name.trim().to_string();
    if name.is_empty() || name.to_lowercase() == "unknown artist" {
        return Ok(true);
    }
    let cache_key = cache_key_for_artist(&name);
    let cached: Option<ArtistProfile> = read_json(&app, &cache_key)?;
    Ok(cached
        .as_ref()
        .map(|profile| is_valid_cached_summary(&profile.summary))
        .unwrap_or(false))
}

#[tauri::command]
pub async fn read_cached_artist_profile_rust(
    app: tauri::AppHandle,
    artist_name: String,
) -> Result<ArtistProfileLoadResult, String> {
    let name = artist_name.trim().to_string();
    let cache_key = cache_key_for_artist(&name);
    let cache_path = to_storage_cache_path(&cache_key);

    if name.is_empty() || name.to_lowercase() == "unknown artist" {
        return Ok(ArtistProfileLoadResult {
            status: "missing".to_string(),
            profile: None,
            from_cache: None,
            cache_path,
        });
    }

    let cached: Option<ArtistProfile> = read_json(&app, &cache_key)?;
    if let Some(profile) = cached {
        if is_valid_cached_summary(&profile.summary) {
            return Ok(ArtistProfileLoadResult {
                status: "ready".to_string(),
                profile: Some(profile),
                from_cache: Some(true),
                cache_path,
            });
        }
    }

    Ok(ArtistProfileLoadResult {
        status: "missing".to_string(),
        profile: None,
        from_cache: None,
        cache_path,
    })
}

#[tauri::command]
pub async fn load_artist_profile_rust(
    app: tauri::AppHandle,
    artist_name: String,
) -> Result<ArtistProfileLoadResult, String> {
    let name = artist_name.trim().to_string();
    let cache_key = cache_key_for_artist(&name);
    let cache_path = to_storage_cache_path(&cache_key);

    if name.is_empty() || name.to_lowercase() == "unknown artist" {
        return Ok(ArtistProfileLoadResult {
            status: "missing".to_string(),
            profile: None,
            from_cache: None,
            cache_path,
        });
    }

    if let Some(cached) = read_json::<ArtistProfile>(&app, &cache_key)? {
        if is_valid_cached_summary(&cached.summary) {
            return Ok(ArtistProfileLoadResult {
                status: "ready".to_string(),
                profile: Some(cached),
                from_cache: Some(true),
                cache_path,
            });
        }
    }

    match fetch_artist_profile(&name).await {
        Ok(Some(profile)) => {
            write_json(&app, &cache_key, &profile)?;
            Ok(ArtistProfileLoadResult {
                status: "ready".to_string(),
                profile: Some(profile),
                from_cache: Some(false),
                cache_path,
            })
        }
        Ok(None) => Ok(ArtistProfileLoadResult {
            status: "missing".to_string(),
            profile: None,
            from_cache: None,
            cache_path,
        }),
        Err(_) => Ok(ArtistProfileLoadResult {
            status: "no-internet".to_string(),
            profile: None,
            from_cache: None,
            cache_path,
        }),
    }
}

#[tauri::command]
pub async fn load_album_artwork_cache_rust(
    app: tauri::AppHandle,
) -> Result<HashMap<String, String>, String> {
    Ok(read_json::<HashMap<String, String>>(&app, ALBUM_ART_CACHE_PATH)?.unwrap_or_default())
}

#[tauri::command]
pub async fn read_cached_album_artwork_rust(
    app: tauri::AppHandle,
    artist: String,
    album: String,
) -> Result<Option<String>, String> {
    if artist.trim().is_empty() || album.trim().is_empty() {
        return Ok(None);
    }
    let cache = read_json::<HashMap<String, String>>(&app, ALBUM_ART_CACHE_PATH)?.unwrap_or_default();
    let key = cache_key_for_album_art(&artist, &album);
    Ok(cache.get(&key).cloned())
}

fn normalize_artwork_url(url: &str) -> String {
    url.replace("100x100bb", "300x300bb")
}

async fn fetch_album_artwork_url(artist: &str, album: &str) -> Result<Option<String>, String> {
    let term = format!("{} {}", artist, album);
    let url = Url::parse_with_params(
        "https://itunes.apple.com/search",
        &[
            ("term", term.as_str()),
            ("entity", "album"),
            ("limit", "1"),
        ],
    )
    .map_err(|err| err.to_string())?;
    #[derive(Deserialize)]
    struct ItunesAlbumPayload {
        results: Option<Vec<ItunesAlbumHit>>,
    }
    #[derive(Deserialize)]
    struct ItunesAlbumHit {
        #[serde(rename = "artworkUrl100")]
        artwork_url_100: Option<String>,
    }
    let payload: ItunesAlbumPayload = fetch_json(url, None).await?;
    let artwork = payload
        .results
        .and_then(|results| results.into_iter().next())
        .and_then(|hit| hit.artwork_url_100);
    Ok(artwork.map(|url| normalize_artwork_url(&url)))
}

fn compress_image_to_data_url(image: DynamicImage) -> Option<String> {
    let (width, height) = image.dimensions();
    let max_size = 220u32;
    let scale = (max_size as f32 / width.max(height) as f32).min(1.0);
    let target_w = ((width as f32) * scale).round().max(1.0) as u32;
    let target_h = ((height as f32) * scale).round().max(1.0) as u32;
    let resized = image.resize_exact(target_w, target_h, FilterType::Lanczos3);
    let mut buffer = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 78);
    encoder.encode_image(&resized).ok()?;
    let b64 = BASE64_STANDARD.encode(buffer);
    Some(format!("data:image/jpeg;base64,{b64}"))
}

async fn fetch_album_artwork_data_url(artist: &str, album: &str) -> Result<Option<String>, String> {
    let url = match fetch_album_artwork_url(artist, album).await? {
        Some(url) => url,
        None => return Ok(None),
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client.get(url.clone()).send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let image = image::load_from_memory(&bytes).map_err(|err| err.to_string())?;
    let compressed = compress_image_to_data_url(image);
    Ok(Some(compressed.unwrap_or(url)))
}

#[tauri::command]
pub async fn load_album_artwork_rust(
    app: tauri::AppHandle,
    artist: String,
    album: String,
) -> Result<Option<String>, String> {
    if artist.trim().is_empty() || album.trim().is_empty() {
        return Ok(None);
    }
    let mut cache = read_json::<HashMap<String, String>>(&app, ALBUM_ART_CACHE_PATH)?.unwrap_or_default();
    let key = cache_key_for_album_art(&artist, &album);
    if let Some(cached) = cache.get(&key) {
        return Ok(Some(cached.clone()));
    }

    let fetched = match fetch_album_artwork_data_url(&artist, &album).await {
        Ok(value) => value,
        Err(_) => None,
    };
    if let Some(value) = fetched.clone() {
        cache.insert(key, value.clone());
        write_json(&app, ALBUM_ART_CACHE_PATH, &cache)?;
    }
    Ok(fetched)
}

#[derive(Debug, Deserialize)]
struct MbReleaseSearch {
    releases: Option<Vec<MbRelease>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct MbRelease {
    id: String,
    title: Option<String>,
    status: Option<String>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MbArtistCredit>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct MbArtistCredit {
    name: Option<String>,
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
    Ok(read_json::<HashMap<String, AlbumTracklist>>(&app, ALBUM_TRACKLIST_CACHE_PATH)?.unwrap_or_default())
}

#[tauri::command]
pub async fn read_cached_album_tracklist_rust(
    app: tauri::AppHandle,
    artist: String,
    album: String,
) -> Result<Option<AlbumTracklist>, String> {
    if artist.trim().is_empty() || album.trim().is_empty() {
        return Ok(None);
    }
    let cache = read_json::<HashMap<String, AlbumTracklist>>(&app, ALBUM_TRACKLIST_CACHE_PATH)?.unwrap_or_default();
    let key = get_album_tracklist_key(&artist, &album);
    Ok(cache.get(&key).cloned())
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
    let mut cache = read_json::<HashMap<String, AlbumTracklist>>(&app, ALBUM_TRACKLIST_CACHE_PATH)?.unwrap_or_default();
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
    write_json(&app, ALBUM_TRACKLIST_CACHE_PATH, &cache)?;
    Ok(Some(entry))
}

#[tauri::command]
pub async fn load_song_genre_cache_rust(
    app: tauri::AppHandle,
) -> Result<HashMap<String, SongGenreCacheEntry>, String> {
    Ok(read_json::<HashMap<String, SongGenreCacheEntry>>(&app, SONG_GENRE_CACHE_PATH)?.unwrap_or_default())
}

fn cache_key_for_song_genre(song: &SongInput) -> String {
    format!(
        "{}--{}",
        slugify(song.artist.as_str()),
        slugify(if song.title.trim().is_empty() {
            song.id.as_deref().unwrap_or("unknown")
        } else {
            song.title.as_str()
        })
    )
}

#[derive(Debug, Deserialize)]
struct ItunesSongPayload {
    results: Option<Vec<ItunesSongHit>>,
}

#[derive(Debug, Deserialize)]
struct ItunesSongHit {
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    #[serde(rename = "primaryGenreName")]
    primary_genre_name: Option<String>,
}

fn score_itunes_hit(song: &SongInput, hit: &ItunesSongHit) -> i32 {
    let primary_artist = get_primary_artist_name(&song.artist);
    let track_match = hit
        .track_name
        .as_deref()
        .map(|value| is_close_match(value, &song.title))
        .unwrap_or(false);
    let artist_match = hit
        .artist_name
        .as_deref()
        .map(|value| is_artist_close_match(value, &primary_artist))
        .unwrap_or(false);
    if !track_match || !artist_match {
        return 0;
    }
    let mut score = 0;
    if let Some(name) = &hit.track_name {
        score += if is_exact_match(name, &song.title) { 6 } else { 4 };
    }
    if let Some(name) = &hit.artist_name {
        score += if is_exact_match(name, &primary_artist) { 6 } else { 4 };
    }
    if hit.primary_genre_name.is_some() {
        score += 1;
    }
    score
}

async fn fetch_song_genre(song: &SongInput) -> Result<Option<String>, String> {
    let primary_artist = get_primary_artist_name(&song.artist);
    let term = format!("{} {}", primary_artist, song.title);
    let url = Url::parse_with_params(
        "https://itunes.apple.com/search",
        &[
            ("term", term.as_str()),
            ("entity", "song"),
            ("limit", "8"),
        ],
    )
    .map_err(|err| err.to_string())?;
    let payload: ItunesSongPayload = fetch_json(url, None).await?;
    let hits = payload.results.unwrap_or_default();
    if hits.is_empty() {
        return Ok(None);
    }
    let mut ranked: Vec<(i32, ItunesSongHit)> = hits
        .into_iter()
        .map(|hit| (score_itunes_hit(song, &hit), hit))
        .filter(|(score, _)| *score >= 7)
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    let genre = ranked
        .first()
        .and_then(|(_, hit)| hit.primary_genre_name.clone());
    match genre {
        Some(value) if !is_unknown_genre(&value) => Ok(Some(value)),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn load_song_genre_rust(
    app: tauri::AppHandle,
    song: SongInput,
) -> Result<SongGenreLoadResult, String> {
    let cache_path = to_storage_cache_path(SONG_GENRE_CACHE_PATH);

    if let Some(genre) = song.genre.as_deref() {
        if !is_unknown_genre(genre) {
            return Ok(SongGenreLoadResult {
                status: "ready".to_string(),
                genre: Some(genre.to_string()),
                from_cache: Some(true),
                cache_path,
            });
        }
    }

    let mut cache = read_json::<HashMap<String, SongGenreCacheEntry>>(&app, SONG_GENRE_CACHE_PATH)?.unwrap_or_default();
    let key = cache_key_for_song_genre(&song);
    if let Some(entry) = cache.get(&key) {
        if !is_unknown_genre(&entry.genre) {
            return Ok(SongGenreLoadResult {
                status: "ready".to_string(),
                genre: Some(entry.genre.clone()),
                from_cache: Some(true),
                cache_path,
            });
        }
    }

    match fetch_song_genre(&song).await {
        Ok(Some(genre)) => {
            cache.insert(
                key,
                SongGenreCacheEntry {
                    genre: genre.clone(),
                    fetched_at: now_unix(),
                },
            );
            write_json(&app, SONG_GENRE_CACHE_PATH, &cache)?;
            Ok(SongGenreLoadResult {
                status: "ready".to_string(),
                genre: Some(genre),
                from_cache: Some(false),
                cache_path,
            })
        }
        Ok(None) => Ok(SongGenreLoadResult {
            status: "missing".to_string(),
            genre: None,
            from_cache: None,
            cache_path,
        }),
        Err(_) => Ok(SongGenreLoadResult {
            status: "no-internet".to_string(),
            genre: None,
            from_cache: None,
            cache_path,
        }),
    }
}

fn cache_key_for_song(song: &SongInput) -> String {
    let primary_artist = get_primary_artist_name(&song.artist);
    let artist = slugify(if primary_artist.trim().is_empty() { "unknown-artist" } else { &primary_artist });
    let title = slugify(if song.title.trim().is_empty() { "unknown-title" } else { &song.title });
    let album = song.album.as_deref().unwrap_or("").trim();
    let album_part = if album.is_empty() { String::new() } else { format!("-{}", slugify(album)) };
    format!("{LYRICS_CACHE_FOLDER}/{artist}-{title}{album_part}.lrc")
}

fn legacy_cache_keys_for_song(song: &SongInput) -> Vec<String> {
    let artist_raw = if song.artist.trim().is_empty() { "unknown-artist" } else { &song.artist };
    let primary = get_primary_artist_name(artist_raw);
    let title = if song.title.trim().is_empty() { "unknown-title" } else { &song.title };
    let artist_slug = slugify(artist_raw);
    let primary_slug = slugify(&primary);
    let title_key = slugify(title);
    let mut keys = HashSet::new();
    keys.insert(format!("{LYRICS_CACHE_FOLDER}/{artist_slug}-{title_key}.lrc"));
    keys.insert(format!("{LYRICS_CACHE_FOLDER}/{primary_slug}-{title_key}.lrc"));
    keys.into_iter().filter(|key| key != &cache_key_for_song(song)).collect()
}

fn read_lyrics_index(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_json::<HashMap<String, String>>(app, LYRICS_INDEX_PATH)?.unwrap_or_default())
}

fn write_lyrics_index(app: &tauri::AppHandle, index: &HashMap<String, String>) -> Result<(), String> {
    write_json(app, LYRICS_INDEX_PATH, index)
}

fn read_cached_lyrics_text(
    app: &tauri::AppHandle,
    song: &SongInput,
) -> Result<Option<(String, String)>, String> {
    let key = cache_key_for_song(song);
    if let Some(text) = read_text(app, &key)? {
        if !text.trim().is_empty() {
            return Ok(Some((key, text)));
        }
    }

    if let Some(song_id) = song.id.as_deref() {
        let index = read_lyrics_index(app)?;
        if let Some(mapped) = index.get(song_id) {
            if mapped != &key {
                if let Some(text) = read_text(app, mapped)? {
                    if !text.trim().is_empty() {
                        return Ok(Some((mapped.clone(), text)));
                    }
                }
            }
        }
    }

    for legacy in legacy_cache_keys_for_song(song) {
        if let Some(text) = read_text(app, &legacy)? {
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
    unique.len() as f32 >= (text_lines.len() as f32 * 0.3)
}

fn score_candidate(song: &SongInput, candidate: &LyricsCandidate) -> i32 {
    let primary_artist = get_primary_artist_name(&song.artist);
    let mut score = 0;
    if normalize_match_name(&candidate.track_name) == normalize_match_name(&song.title) {
        score += 6;
    } else if safe_includes(&candidate.track_name, &song.title) {
        score += 3;
    }

    if normalize_match_name(&candidate.artist_name) == normalize_match_name(&primary_artist) {
        score += 5;
    } else if safe_includes(&candidate.artist_name, &primary_artist) {
        score += 2;
    }

    if let (Some(candidate_album), Some(song_album)) = (&candidate.album_name, &song.album) {
        if normalize_match_name(candidate_album) == normalize_match_name(song_album) {
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
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
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

async fn fetch_lyrics_search_candidates(song: &SongInput) -> Result<Vec<LyricsCandidate>, String> {
    let artist = get_primary_artist_name(&song.artist);
    let title = song.title.trim();
    if artist.trim().is_empty() || title.is_empty() {
        return Ok(Vec::new());
    }
    let mut params = vec![("artist_name", artist.as_str()), ("track_name", title)];
    if let Some(album) = song.album.as_deref() {
        if !album.trim().is_empty() {
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

async fn fetch_lyrics_single_candidate(song: &SongInput) -> Result<Vec<LyricsCandidate>, String> {
    let artist = get_primary_artist_name(&song.artist);
    let title = song.title.trim();
    if artist.trim().is_empty() || title.is_empty() {
        return Ok(Vec::new());
    }
    let mut params = vec![("artist_name", artist.as_str()), ("track_name", title)];
    if let Some(album) = song.album.as_deref() {
        if !album.trim().is_empty() {
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
    let mut candidates = fetch_lyrics_search_candidates(song).await?;
    if candidates.is_empty() {
        candidates = fetch_lyrics_single_candidate(song).await?;
    }
    Ok(candidates)
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
    if let Some((cache_key, text)) = read_cached_lyrics_text(&app, &song)? {
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
    write_text(&app, &key, &candidate.raw)?;
    if let Some(song_id) = song.id.as_ref() {
        let mut index = read_lyrics_index(&app)?;
        if index.get(song_id) != Some(&key) {
            index.insert(song_id.clone(), key.clone());
            write_lyrics_index(&app, &index)?;
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
    if let Some((cache_key, text)) = read_cached_lyrics_text(&app, &song)? {
        if validate_lyrics_quality(&text) {
            if let Some(song_id) = song.id.as_ref() {
                let mut index = read_lyrics_index(&app)?;
                if index.get(song_id) != Some(&key) {
                    index.insert(song_id.clone(), key.clone());
                    write_lyrics_index(&app, &index)?;
                }
            }
            if cache_key != key {
                let _ = write_text(&app, &key, &text);
            }
            return Ok(build_lyrics_result(&text, &cache_key, true));
        } else {
            let _ = write_text(&app, &cache_key, "");
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

    write_text(&app, &key, &best.raw)?;
    if let Some(song_id) = song.id.as_ref() {
        let mut index = read_lyrics_index(&app)?;
        if index.get(song_id) != Some(&key) {
            index.insert(song_id.clone(), key.clone());
            write_lyrics_index(&app, &index)?;
        }
    }

    Ok(build_lyrics_result(&best.raw, &key, false))
}
