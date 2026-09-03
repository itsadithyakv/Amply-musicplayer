use std::{
    collections::{HashMap, HashSet},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use std::sync::LazyLock;
use tokio::sync::Mutex;
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use crate::{delete_storage_kv, read_storage_kv, resolve_storage_path, write_storage_kv};

static TIME_TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]").unwrap());

static FEAT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bfeat\.?\b|\bft\.?\b|\bfeaturing\b").unwrap());
static PARENS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*[\(\[].*?[\)\]]").unwrap());
static NON_ALNUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static MULTISPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static TRACK_CLEAN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(remaster(ed)?|mono|stereo|bonus track|explicit|clean)\b").unwrap());
static MB_LAST_REQUEST: LazyLock<Mutex<Option<std::time::Instant>>> = LazyLock::new(|| Mutex::new(None));

const ARTIST_CACHE_FOLDER: &str = "artist_cache";
const LYRICS_CACHE_FOLDER: &str = "lyrics_cache";
const LYRICS_INDEX_PATH: &str = "lyrics_cache/index.json";
const TRACK_ARTWORK_CACHE_PATH: &str = "metadata_cache/track_artwork_cache.json";
const ALBUM_TRACKLIST_CACHE_PATH: &str = "metadata_cache/album_tracklist_cache.json";
const SONG_GENRE_CACHE_PATH: &str = "metadata_cache/song_genre_cache.json";
const METADATA_USER_AGENT: &str = "Amply/1.6 (local music player; metadata cache)";

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
    for ch in canonicalize_stylized_text(value).trim().to_lowercase().chars() {
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

fn slugify_legacy(value: &str) -> String {
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

fn canonicalize_stylized_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '$' => out.push('s'),
            '!' => out.push('i'),
            '@' => out.push('a'),
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' | 'ă' | 'ą' | 'Á' | 'À' | 'Â' | 'Ä'
            | 'Ã' | 'Å' | 'Ā' | 'Ă' | 'Ą' => out.push('a'),
            'æ' | 'Æ' => out.push_str("ae"),
            'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' | 'Ç' | 'Ć' | 'Č' | 'Ĉ' | 'Ċ' => out.push('c'),
            'ď' | 'đ' | 'Ð' | 'Ď' | 'Đ' => out.push('d'),
            'é' | 'è' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' | 'É' | 'È' | 'Ê' | 'Ë'
            | 'Ē' | 'Ĕ' | 'Ė' | 'Ę' | 'Ě' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' | 'ī' | 'ĭ' | 'į' | 'İ' | 'Í' | 'Ì' | 'Î' | 'Ï' | 'Ī'
            | 'Ĭ' | 'Į' => out.push('i'),
            'ñ' | 'ń' | 'ň' | 'Ñ' | 'Ń' | 'Ň' => out.push('n'),
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ø' | 'ō' | 'ŏ' | 'ő' | 'Ó' | 'Ò' | 'Ô' | 'Ö'
            | 'Õ' | 'Ø' | 'Ō' | 'Ŏ' | 'Ő' => out.push('o'),
            'œ' | 'Œ' => out.push_str("oe"),
            'ŕ' | 'ř' | 'Ŕ' | 'Ř' => out.push('r'),
            'ś' | 'š' | 'ş' | 'ŝ' | 'Ś' | 'Š' | 'Ş' | 'Ŝ' => out.push('s'),
            'ß' => out.push_str("ss"),
            'ť' | 'ţ' | 'Ť' | 'Ţ' => out.push('t'),
            'ú' | 'ù' | 'û' | 'ü' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' | 'Ú' | 'Ù' | 'Û' | 'Ü'
            | 'Ū' | 'Ŭ' | 'Ů' | 'Ű' | 'Ų' => out.push('u'),
            'ý' | 'ÿ' | 'ŷ' | 'Ý' | 'Ÿ' | 'Ŷ' => out.push('y'),
            'ž' | 'ź' | 'ż' | 'Ž' | 'Ź' | 'Ż' => out.push('z'),
            _ => out.push(ch),
        }
    }
    out
}

fn normalize_text(value: &str) -> String {
    let lower = canonicalize_stylized_text(value).trim().to_lowercase();
    let spaced = NON_ALNUM_RE.replace_all(&lower, " ");
    MULTISPACE_RE.replace_all(&spaced, " ").trim().to_string()
}

fn normalize_compact(value: &str) -> String {
    normalize_text(value).replace(' ', "")
}

fn identity_tokens(value: &str) -> Vec<String> {
    normalize_text(value)
        .split_whitespace()
        .filter(|part| !matches!(*part, "the" | "and" | "of"))
        .map(|part| part.to_string())
        .collect()
}

fn has_ordered_identity_tokens(value: &str, artist_name: &str) -> bool {
    let artist_tokens = identity_tokens(artist_name);
    if artist_tokens.len() < 2 {
        return false;
    }

    let value_tokens = identity_tokens(value);
    if value_tokens.is_empty() {
        return false;
    }

    let mut cursor = 0usize;
    for token in value_tokens {
        if token == artist_tokens[cursor] {
            cursor += 1;
            if cursor == artist_tokens.len() {
                return true;
            }
        }
    }
    false
}

fn identity_contains(value: &str, artist_name: &str) -> bool {
    let normalized_value = normalize_text(value);
    let normalized_artist = normalize_text(artist_name);
    if normalized_artist.is_empty() {
        return false;
    }
    if normalized_value.contains(&normalized_artist) {
        return true;
    }

    let compact_value = normalize_compact(value);
    let compact_artist = normalize_compact(artist_name);
    (!compact_artist.is_empty() && compact_value.contains(&compact_artist))
        || has_ordered_identity_tokens(value, artist_name)
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
    let compact_title = normalize_compact(title);
    let compact_artist = normalize_compact(artist_name);

    normalized_title == normalized_artist
        || normalized_title.starts_with(&format!("{normalized_artist} "))
        || normalized_title.ends_with(&format!(" {normalized_artist}"))
        || (!compact_artist.is_empty()
            && (compact_title == compact_artist
                || compact_title.starts_with(&compact_artist)
                || compact_title.ends_with(&compact_artist)))
}

fn is_non_artist_page_title(title: &str) -> bool {
    let normalized_title = normalize_text(title);
    [
        "discography",
        "songs",
        "albums",
        "awards",
        "tour",
        "concert",
        "filmography",
        "production discography",
        " song",
    ]
    .iter()
    .any(|term| normalized_title.contains(term))
}

fn artist_identity_matches(title: &str, summary: &str, source_url: Option<&str>, artist_name: &str) -> bool {
    let normalized_artist = normalize_text(artist_name);
    if normalized_artist.is_empty() {
        return false;
    }

    if is_non_artist_page_title(title) {
        return false;
    }

    let title_matches = is_likely_artist_title(title, artist_name);
    let summary_matches = identity_contains(summary, artist_name);
    if title_matches && summary_matches {
        return true;
    }

    if summary_matches && is_music_related_text(summary) {
        return true;
    }

    source_url
        .map(|url| identity_contains(url, artist_name))
        .unwrap_or(false)
        && summary_matches
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
    cache_key_for_artist_slug(artist_name, slugify(artist_name))
}

fn cache_key_for_artist_slug(artist_name: &str, slug: String) -> String {
    let base = if artist_name.trim().is_empty() {
        "unknown-artist"
    } else {
        artist_name
    };
    let artist_slug = if slug.is_empty() {
        format!("artist-{}", hash_string(base))
    } else {
        slug
    };
    format!("{ARTIST_CACHE_FOLDER}/{artist_slug}.json")
}

fn cache_keys_for_artist(artist_name: &str) -> Vec<String> {
    let mut keys = vec![cache_key_for_artist(artist_name)];
    let legacy = cache_key_for_artist_slug(artist_name, slugify_legacy(artist_name));
    if !keys.iter().any(|key| key == &legacy) {
        keys.push(legacy);
    }
    keys
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
        .replace(['&', '+'], ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace(" & ", ",");
    normalize_text(&stripped)
}

fn split_artists(value: &str) -> Vec<String> {
    let stripped = PARENS_RE.replace_all(value, " ");
    let stripped = FEAT_RE.replace_all(&stripped, " ");
    let stripped = stripped
        .replace(['&', '+'], ",")
        .replace("×", ",")
        .replace(" x ", ",")
        .replace(" & ", ",");
    stripped
        .split(',')
        .map(normalize_text)
        .filter(|part| !part.is_empty())
        .collect()
}

fn cache_key_for_track_artwork(song: &SongInput) -> String {
    let primary_artist = metadata_artist_for_song(song);
    let title = clean_lyrics_title(&song.title, Some(&primary_artist));
    format!(
        "{}--{}",
        slugify(if primary_artist.trim().is_empty() { "unknown-artist" } else { &primary_artist }),
        slugify(if title.trim().is_empty() { song.title.as_str() } else { title.as_str() })
    )
}

fn normalize_title(value: &str) -> String {
    let cleaned = PARENS_RE.replace_all(value, " ");
    let cleaned = cleaned.split(" - ").next().unwrap_or("").trim();
    normalize_text(cleaned)
}

fn is_unknown_album(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "unknown album"
        || normalized == "unknown"
        || normalized == "n/a"
        || normalized == "na"
        || normalized == "none"
        || normalized == "unspecified"
        || normalized == "single"
}

fn split_artist_title_hint(value: &str) -> Option<(String, String)> {
    let separators = [" - ", " — ", " – ", " | ", " -- "];
    for sep in separators {
        if let Some((left, right)) = value.split_once(sep) {
            let artist = left.trim();
            let title = right.trim();
            if !artist.is_empty() && !title.is_empty() {
                return Some((artist.to_string(), title.to_string()));
            }
        }
    }
    None
}

fn clean_lyrics_title(raw: &str, artist_hint: Option<&str>) -> String {
    let mut title = raw.to_string();
    if let Some((left, right)) = split_artist_title_hint(&title) {
        if let Some(artist) = artist_hint {
            if normalize_artist(&left) == normalize_artist(artist) {
                title = right;
            }
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
        "vocals", "orchestral", "intro", "outro", "thefloridaman",
    ];
    let lowered = title.to_lowercase();
    if let Some(pos) = noise.iter().filter_map(|token| lowered.find(token)).min() {
        title = title[..pos].to_string();
    }
    let stripped = PARENS_RE.replace_all(&title, " ");
    let stripped = TRACK_CLEAN_RE.replace_all(&stripped, " ");
    normalize_part(&stripped)
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
        .replace(['&', ';', '/', '|'], ",");
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

fn is_low_confidence_artist_name(artist: &str) -> bool {
    let normalized = normalize_text(artist);
    if normalized.is_empty() || normalized == "unknown artist" {
        return true;
    }
    let compact = normalized.replace(' ', "");
    let noisy_terms = [
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
    ];
    noisy_terms.iter().any(|term| compact.contains(term))
}

fn metadata_artist_for_song(song: &SongInput) -> String {
    let primary_artist = get_primary_artist_name(&song.artist);
    if let Some((parsed_artist, parsed_title)) = split_artist_title_hint(&song.title) {
        let cleaned_artist = normalize_whitespace(&parsed_artist);
        let cleaned_title = normalize_whitespace(&parsed_title);
        if !cleaned_artist.is_empty()
            && !cleaned_title.is_empty()
            && (is_low_confidence_artist_name(&primary_artist)
                || !is_artist_close_match(&cleaned_artist, &primary_artist))
        {
            return cleaned_artist;
        }
    }
    primary_artist
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

async fn read_text(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    read_storage_kv(app, relative_path).await
}

async fn write_text(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    write_storage_kv(app, relative_path, content).await
}

async fn read_json<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    relative_path: &str,
) -> Result<Option<T>, String> {
    if let Some(text) = read_text(app, relative_path).await? {
        match serde_json::from_str::<T>(&text) {
            Ok(parsed) => return Ok(Some(parsed)),
            Err(_) => {
                if resolve_storage_path(app, relative_path).is_ok() {
                    let _ = delete_storage_kv(app, relative_path).await;
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

async fn write_json<T: Serialize>(app: &tauri::AppHandle, relative_path: &str, value: &T) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    write_text(app, relative_path, &serialized).await
}

fn to_storage_cache_path(relative_path: &str) -> String {
    format!("storage/{}", relative_path.replace('\\', "/"))
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(url: Url, user_agent: Option<&str>) -> Result<T, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client.get(url);
    request = request.header("User-Agent", user_agent.unwrap_or(METADATA_USER_AGENT));
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

fn wikipedia_summary_url(title: &str) -> Result<Url, String> {
    let mut url = Url::parse("https://en.wikipedia.org/api/rest_v1/page/summary").map_err(|err| err.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "bad url".to_string())?
        .push(title);
    Ok(url)
}

async fn fetch_wikipedia_summary(title: &str) -> Result<Option<WikipediaSummaryPayload>, String> {
    let url = wikipedia_summary_url(title)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", METADATA_USER_AGENT)
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
    let quoted_query = format!("\"{}\" musician singer rapper band", artist_name);
    let mut titles = fetch_wikipedia_search_titles_for_query(&quoted_query, 8).await?;
    if titles.is_empty() {
        let fallback_query = format!("{} musician singer rapper band", artist_name);
        titles = fetch_wikipedia_search_titles_for_query(&fallback_query, 8).await?;
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

async fn fetch_wikipedia_search_titles_for_query(query: &str, limit: usize) -> Result<Vec<String>, String> {
    let limit_string = limit.clamp(1, 20).to_string();
    let url = Url::parse_with_params(
        "https://en.wikipedia.org/w/api.php",
        &[
            ("action", "query"),
            ("list", "search"),
            ("srlimit", limit_string.as_str()),
            ("format", "json"),
            ("origin", "*"),
            ("srsearch", query),
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
    if let Ok(searched) = fetch_wikipedia_search_titles(trimmed).await {
        candidates.extend(searched);
    }

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
        let intro_extract = fetch_wikipedia_intro_extract(&resolved_title).await.unwrap_or(None);
        let merged_summary = to_word_range(
            intro_extract.as_deref().unwrap_or(&summary_extract),
            100,
            200,
        );
        if merged_summary.trim().is_empty() || is_disambiguation_text(&merged_summary) {
            continue;
        }

        let source_url = summary_payload
            .content_urls
            .as_ref()
            .and_then(|urls| urls.desktop.as_ref())
            .and_then(|desktop| desktop.page.as_deref());
        let identity_matches = artist_identity_matches(&resolved_title, &merged_summary, source_url, artist_name);
        if !identity_matches || !is_music_related_text(&merged_summary) {
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

fn is_valid_artist_profile(profile: &ArtistProfile, artist_name: &str) -> bool {
    if !is_valid_cached_summary(&profile.summary) {
        return false;
    }

    let normalized_artist = normalize_text(artist_name);
    if normalized_artist.is_empty() {
        return false;
    }

    identity_contains(&profile.summary, artist_name)
        || identity_contains(&profile.artist_name, artist_name)
        || identity_contains(artist_name, &profile.artist_name)
}

#[tauri::command]
pub async fn has_cached_artist_profile_rust(app: tauri::AppHandle, artist_name: String) -> Result<bool, String> {
    let name = artist_name.trim().to_string();
    if name.is_empty() || name.to_lowercase() == "unknown artist" {
        return Ok(true);
    }
    for cache_key in cache_keys_for_artist(&name) {
        let cached: Option<ArtistProfile> = read_json(&app, &cache_key).await?;
        if cached
            .as_ref()
            .map(|profile| is_valid_artist_profile(profile, &name))
            .unwrap_or(false)
        {
            return Ok(true);
        }
    }
    Ok(false)
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

    for candidate_key in cache_keys_for_artist(&name) {
        let cached: Option<ArtistProfile> = read_json(&app, &candidate_key).await?;
        if let Some(profile) = cached {
            if is_valid_artist_profile(&profile, &name) {
                if candidate_key != cache_key {
                    let _ = write_json(&app, &cache_key, &profile).await;
                }
                let resolved_cache_path = to_storage_cache_path(&candidate_key);
                return Ok(ArtistProfileLoadResult {
                    status: "ready".to_string(),
                    profile: Some(profile),
                    from_cache: Some(true),
                    cache_path: resolved_cache_path,
                });
            }
            let _ = delete_storage_kv(&app, &candidate_key).await;
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

    for candidate_key in cache_keys_for_artist(&name) {
        if let Some(cached) = read_json::<ArtistProfile>(&app, &candidate_key).await? {
            if is_valid_artist_profile(&cached, &name) {
                if candidate_key != cache_key {
                    let _ = write_json(&app, &cache_key, &cached).await;
                }
                let resolved_cache_path = to_storage_cache_path(&candidate_key);
                return Ok(ArtistProfileLoadResult {
                    status: "ready".to_string(),
                    profile: Some(cached),
                    from_cache: Some(true),
                    cache_path: resolved_cache_path,
                });
            }
            let _ = delete_storage_kv(&app, &candidate_key).await;
        }
    }

    match fetch_artist_profile(&name).await {
        Ok(Some(profile)) => {
            write_json(&app, &cache_key, &profile).await?;
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

fn normalize_artwork_url(url: &str) -> String {
    url.replace("100x100bb", "300x300bb")
}

fn compress_image_to_data_url(image: DynamicImage) -> Option<String> {
    let (width, height) = image.dimensions();
    let max_size = 300u32;
    let scale = (max_size as f32 / width.max(height) as f32).min(1.0);
    let target_w = ((width as f32) * scale).round().max(1.0) as u32;
    let target_h = ((height as f32) * scale).round().max(1.0) as u32;
    let resized = image.resize_exact(target_w, target_h, FilterType::Lanczos3);
    let mut buffer = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 74);
    encoder.encode_image(&resized).ok()?;
    let b64 = BASE64_STANDARD.encode(buffer);
    Some(format!("data:image/jpeg;base64,{b64}"))
}

async fn fetch_image_data_url(url: &str) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", METADATA_USER_AGENT)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let image = image::load_from_memory(&bytes).map_err(|err| err.to_string())?;
    let compressed = compress_image_to_data_url(image);
    Ok(Some(compressed.unwrap_or_else(|| url.to_string())))
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
struct MbArtistCredit {
    name: Option<String>,
    artist: Option<MbArtistRef>,
}

#[derive(Debug, Deserialize)]
struct MbArtistRef {
    disambiguation: Option<String>,
    genres: Option<Vec<MbTag>>,
    tags: Option<Vec<MbTag>>,
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

#[tauri::command]
pub async fn load_song_genre_cache_rust(
    app: tauri::AppHandle,
) -> Result<HashMap<String, SongGenreCacheEntry>, String> {
    Ok(read_json::<HashMap<String, SongGenreCacheEntry>>(&app, SONG_GENRE_CACHE_PATH)
        .await?
        .unwrap_or_default())
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
    #[serde(rename = "artworkUrl100")]
    artwork_url_100: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbRecordingGenreSearch {
    recordings: Option<Vec<MbRecordingGenreHit>>,
}

#[derive(Debug, Deserialize)]
struct MbRecordingGenreHit {
    title: Option<String>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MbArtistCredit>>,
    genres: Option<Vec<MbTag>>,
    tags: Option<Vec<MbTag>>,
}

#[derive(Clone, Debug, Deserialize)]
struct MbTag {
    name: Option<String>,
    count: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct WikipediaCategoryPayload {
    query: Option<WikipediaCategoryQuery>,
}

#[derive(Debug, Deserialize)]
struct WikipediaCategoryQuery {
    pages: Option<HashMap<String, WikipediaCategoryPage>>,
}

#[derive(Debug, Deserialize)]
struct WikipediaCategoryPage {
    categories: Option<Vec<WikipediaCategoryEntry>>,
}

#[derive(Debug, Deserialize)]
struct WikipediaCategoryEntry {
    title: Option<String>,
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

fn canonical_genre_tag(value: &str) -> Option<(&'static str, i32)> {
    let normalized = normalize_text(value);
    let compact = normalized.replace(' ', "");
    match normalized.as_str() {
        "east coast hip hop" | "east coast rap" => Some(("Hip-Hop/Rap", 100)),
        "west coast hip hop" | "west coast rap" => Some(("Hip-Hop/Rap", 98)),
        "southern hip hop" | "dirty south" => Some(("Hip-Hop/Rap", 96)),
        "conscious hip hop" | "political hip hop" => Some(("Hip-Hop/Rap", 95)),
        "alternative hip hop" | "alternative rap" => Some(("Hip-Hop/Rap", 92)),
        "jazz rap" => Some(("Hip-Hop/Rap", 91)),
        "gangsta rap" | "gangster rap" => Some(("Hip-Hop/Rap", 90)),
        "pop rap" => Some(("Hip-Hop/Rap", 88)),
        "trap" | "trap music" => Some(("Hip-Hop/Rap", 86)),
        "hardcore hip hop" | "hardcore rap" => Some(("Hip-Hop/Rap", 84)),
        "drill" | "uk drill" | "chicago drill" => Some(("Hip-Hop/Rap", 82)),
        "hip hop" | "hip hop music" | "hiphop" | "rap" => Some(("Hip-Hop/Rap", 50)),
        "r b" | "rnb" | "rhythm and blues" | "contemporary r b" | "contemporary r&b" => Some(("R&B/Soul", 60)),
        "neo soul" => Some(("Neo Soul", 82)),
        "alternative r b" | "alternative r&b" => Some(("R&B/Soul", 78)),
        "soul" | "soul music" => Some(("Soul", 58)),
        "pop" | "pop music" => Some(("Pop", 45)),
        "dance pop" | "electropop" | "synth pop" | "synthpop" | "teen pop" => Some(("Pop", 66)),
        "k pop" | "k-pop" | "j pop" | "j-pop" | "mandopop" | "cantopop" => Some(("Pop", 68)),
        "rock" | "rock music" => Some(("Rock", 45)),
        "alternative rock" => Some(("Alternative Rock", 70)),
        "indie rock" => Some(("Indie Rock", 70)),
        "classic rock"
        | "hard rock"
        | "soft rock"
        | "progressive rock"
        | "psychedelic rock"
        | "blues rock"
        | "pop rock"
        | "folk rock"
        | "garage rock"
        | "glam rock"
        | "glam metal"
        | "hair metal"
        | "arena rock"
        | "southern rock"
        | "art rock" => Some(("Rock", 68)),
        "funk" | "funk music" => Some(("Funk", 60)),
        "disco" | "disco music" => Some(("Disco", 60)),
        "electronic" | "electronica" => Some(("Electronic", 55)),
        "dance" | "dance music" => Some(("Dance", 54)),
        "house" | "house music" | "deep house" | "tech house" => Some(("House", 70)),
        "techno" | "trance" | "dubstep" | "drum and bass" | "dnb" => Some(("Electronic", 70)),
        "edm" | "electronic dance music" => Some(("EDM", 68)),
        "country" | "country music" => Some(("Country", 55)),
        "country pop" | "country rock" | "americana" | "bluegrass" => Some(("Country", 66)),
        "folk" | "folk music" | "indie folk" | "singer songwriter" | "singer-songwriter" => Some(("Folk", 55)),
        "reggae" | "dancehall" | "ska" | "dub" => Some(("Reggae", 60)),
        "latin" | "latin music" | "reggaeton" | "latin pop" | "bachata" | "salsa" => Some(("Latin", 55)),
        "classical" | "classical music" => Some(("Classical", 55)),
        "orchestral" | "opera" | "baroque music" | "romantic music" => Some(("Classical", 66)),
        "jazz" | "bebop" | "smooth jazz" | "vocal jazz" => Some(("Jazz", 55)),
        "blues" => Some(("Blues", 55)),
        "metal" | "heavy metal" | "death metal" | "black metal" | "metalcore" => Some(("Metal", 55)),
        "punk" | "punk rock" | "pop punk" | "post punk" => Some(("Punk", 55)),
        _ => {
            if compact.contains("billboardrapsongs")
                || compact.contains("randbhiphop")
                || normalized.contains("hip hop")
                || normalized.contains(" rap")
                || normalized.ends_with("rap")
            {
                return Some(("Hip-Hop/Rap", 80));
            }
            if normalized.contains("r b")
                || compact.contains("randb")
                || normalized.contains("rhythm and blues")
            {
                return Some(("R&B/Soul", 65));
            }
            if normalized.contains("pop music") || normalized.contains(" pop ") || normalized.ends_with(" pop") {
                return Some(("Pop", 45));
            }
            if normalized.contains("rock music")
                || normalized.contains(" rock ")
                || normalized.ends_with(" rock")
                || normalized.contains("hard rock")
                || normalized.contains("glam metal")
                || normalized.contains("hair metal")
            {
                return Some(("Rock", 45));
            }
            if normalized.contains("funk") {
                return Some(("Funk", 55));
            }
            if normalized.contains("disco") {
                return Some(("Disco", 55));
            }
            if normalized.contains("electronic") || normalized.contains("techno") || normalized.contains("house") {
                return Some(("Electronic", 55));
            }
            if normalized.contains("country") || normalized.contains("americana") {
                return Some(("Country", 55));
            }
            if normalized.contains("latin") || normalized.contains("reggaeton") || normalized.contains("salsa") {
                return Some(("Latin", 55));
            }
            if normalized.contains("classical") || normalized.contains("orchestral") {
                return Some(("Classical", 55));
            }
            if normalized.contains("jazz") {
                return Some(("Jazz", 55));
            }
            if normalized.contains("metal") {
                return Some(("Metal", 55));
            }
            if normalized.contains("punk") {
                return Some(("Punk", 55));
            }
            None
        }
    }
}

fn display_ranked_genres(scores: HashMap<&'static str, i32>) -> Option<String> {
    if scores.is_empty() {
        return None;
    }
    let mut ranked: Vec<(&'static str, i32)> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let selected = ranked
        .into_iter()
        .take(1)
        .map(|(name, _)| name)
        .collect::<Vec<_>>();
    if selected.is_empty() {
        None
    } else {
        Some(selected.join(", "))
    }
}

fn score_genre_categories(categories: &[String], multiplier: i32) -> HashMap<&'static str, i32> {
    let mut scores: HashMap<&'static str, i32> = HashMap::new();
    for title in categories {
        let cleaned = title.strip_prefix("Category:").unwrap_or(title);
        let Some((genre, base_score)) = canonical_genre_tag(cleaned) else {
            continue;
        };
        let entry = scores.entry(genre).or_insert(0);
        *entry += base_score * multiplier;
    }
    scores
}

fn merge_genre_scores(
    target: &mut HashMap<&'static str, i32>,
    source: HashMap<&'static str, i32>,
) {
    for (genre, score) in source {
        let entry = target.entry(genre).or_insert(0);
        *entry += score;
    }
}

fn score_musicbrainz_tags(
    target: &mut HashMap<&'static str, i32>,
    tags: impl IntoIterator<Item = MbTag>,
    multiplier: i32,
) {
    for tag in tags {
        let Some(name) = tag.name.as_deref() else {
            continue;
        };
        let Some((canonical, base_score)) = canonical_genre_tag(name) else {
            continue;
        };
        let count_boost = tag.count.unwrap_or(0).clamp(0, 20);
        let entry = target.entry(canonical).or_insert(0);
        *entry += (base_score + count_boost) * multiplier;
    }
}

fn score_artist_reference_genres(
    target: &mut HashMap<&'static str, i32>,
    artist: &MbArtistRef,
    multiplier: i32,
) {
    if let Some(disambiguation) = artist.disambiguation.as_deref() {
        if let Some(genre) = infer_genre_from_artist_text(disambiguation) {
            let entry = target.entry(genre).or_insert(0);
            *entry += 65 * multiplier;
        }
    }
    score_musicbrainz_tags(target, artist.genres.clone().unwrap_or_default(), multiplier);
    score_musicbrainz_tags(target, artist.tags.clone().unwrap_or_default(), multiplier);
}

fn is_likely_song_page_title(page_title: &str, song_title: &str, artist_name: &str) -> bool {
    let normalized_page = normalize_text(page_title);
    let normalized_song = normalize_text(song_title);
    let normalized_artist = normalize_text(artist_name);
    if normalized_page.is_empty() || normalized_song.is_empty() {
        return false;
    }
    if normalized_page == normalized_song {
        return true;
    }
    if !normalized_page.starts_with(&normalized_song) {
        return false;
    }
    normalized_page.contains(" song")
        || (!normalized_artist.is_empty() && normalized_page.contains(&normalized_artist))
}

async fn fetch_wikipedia_categories_for_title(title: &str) -> Result<Vec<String>, String> {
    let url = Url::parse_with_params(
        "https://en.wikipedia.org/w/api.php",
        &[
            ("action", "query"),
            ("prop", "categories"),
            ("cllimit", "100"),
            ("format", "json"),
            ("origin", "*"),
            ("titles", title),
        ],
    )
    .map_err(|err| err.to_string())?;

    let payload: WikipediaCategoryPayload = fetch_json(url, Some(METADATA_USER_AGENT)).await?;
    let pages = payload.query.and_then(|query| query.pages).unwrap_or_default();
    let mut categories = Vec::new();
    for page in pages.values() {
        if let Some(page_categories) = page.categories.as_ref() {
            categories.extend(page_categories.iter().filter_map(|category| category.title.clone()));
        }
    }
    Ok(categories)
}

fn infer_genre_from_artist_text(value: &str) -> Option<&'static str> {
    let text = normalize_text(value);
    if text.is_empty() {
        return None;
    }

    let classical_terms = ["classical composer", "classical pianist", "orchestra", "conductor", "opera singer"];
    if classical_terms.iter().any(|term| text.contains(term)) {
        return Some("Classical");
    }

    let hip_hop_terms = [
        "rapper",
        "hip hop",
        "hip-hop",
        "rap music",
        "rap artist",
    ];
    if hip_hop_terms.iter().any(|term| text.contains(term)) {
        return Some("Hip-Hop/Rap");
    }

    let metal_terms = ["metal band", "heavy metal", "metalcore", "death metal", "black metal"];
    if metal_terms.iter().any(|term| text.contains(term)) {
        return Some("Metal");
    }

    let punk_terms = ["punk band", "punk rock", "pop punk", "post punk"];
    if punk_terms.iter().any(|term| text.contains(term)) {
        return Some("Punk");
    }

    if text.contains("r b")
        || text.contains("r&b")
        || text.contains("rhythm and blues")
        || text.contains("soul singer")
    {
        return Some("R&B/Soul");
    }

    if text.contains("rock band")
        || text.contains("rock musician")
        || text.contains("rock singer")
        || text.contains("alternative rock")
        || text.contains("indie rock")
    {
        return Some("Rock");
    }

    if text.contains("pop singer")
        || text.contains("pop music")
        || text.contains("pop star")
        || text.contains("k pop")
        || text.contains("k-pop")
        || text.contains("j pop")
        || text.contains("j-pop")
    {
        return Some("Pop");
    }

    if text.contains("country singer")
        || text.contains("country music")
        || text.contains("americana")
        || text.contains("bluegrass")
    {
        return Some("Country");
    }

    if text.contains("electronic musician")
        || text.contains("electronic music")
        || text.contains("dj")
        || text.contains("record producer and dj")
    {
        return Some("Electronic");
    }

    if text.contains("reggae") || text.contains("dancehall") || text.contains("ska") {
        return Some("Reggae");
    }

    if text.contains("latin music")
        || text.contains("latin pop")
        || text.contains("reggaeton")
        || text.contains("salsa")
        || text.contains("bachata")
    {
        return Some("Latin");
    }

    if text.contains("folk singer")
        || text.contains("folk musician")
        || text.contains("folk band")
        || text.contains("singer songwriter")
    {
        return Some("Folk");
    }

    if text.contains("jazz") {
        return Some("Jazz");
    }

    if text.contains("blues") {
        return Some("Blues");
    }

    None
}

async fn fetch_wikipedia_artist_genre_fallback(artist_name: &str) -> Result<Option<String>, String> {
    if artist_name.trim().is_empty() {
        return Ok(None);
    }

    let titles = build_candidate_titles(artist_name).await?;
    for title in titles.into_iter().take(6) {
        let Some(summary) = fetch_wikipedia_summary(&title).await? else {
            continue;
        };
        let summary_text = summary.extract.as_deref().unwrap_or("");
        let source_url = summary
            .content_urls
            .as_ref()
            .and_then(|urls| urls.desktop.as_ref())
            .and_then(|desktop| desktop.page.as_deref());
        if !artist_identity_matches(
            summary.title.as_deref().unwrap_or(&title),
            summary_text,
            source_url,
            artist_name,
        ) {
            continue;
        }
        if let Some(genre) = infer_genre_from_artist_text(summary_text) {
            return Ok(Some(genre.to_string()));
        }

        let categories = fetch_wikipedia_categories_for_title(&title).await.unwrap_or_default();
        let scored = score_genre_categories(&categories, 1);
        if let Some(genre) = display_ranked_genres(scored) {
            return Ok(Some(genre));
        }
    }

    Ok(None)
}

fn score_musicbrainz_recording(song: &SongInput, hit: &MbRecordingGenreHit) -> i32 {
    let title_match = hit
        .title
        .as_deref()
        .map(|value| is_close_match(value, &song.title))
        .unwrap_or(false);
    if !title_match {
        return 0;
    }

    let artist_names = hit
        .artist_credit
        .as_ref()
        .map(|credits| {
            credits
                .iter()
                .filter_map(|credit| credit.name.as_deref())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let primary_artist = get_primary_artist_name(&song.artist);
    let artist_match = is_artist_close_match(&artist_names, &song.artist)
        || is_artist_close_match(&artist_names, &primary_artist)
        || identity_contains(&artist_names, &primary_artist);
    if !artist_match {
        return 0;
    }

    let mut score = 10;
    if let Some(title) = hit.title.as_deref() {
        score += if is_exact_match(title, &song.title) { 8 } else { 4 };
    }
    if is_artist_close_match(&artist_names, &primary_artist) {
        score += 6;
    }
    score
}

async fn fetch_musicbrainz_song_genre(song: &SongInput) -> Result<Option<String>, String> {
    let primary_artist = metadata_artist_for_song(song);
    let title = clean_lyrics_title(&song.title, Some(&primary_artist));
    if title.trim().is_empty() || primary_artist.trim().is_empty() {
        return Ok(None);
    }

    let query = format!("recording:\"{}\" AND artist:\"{}\"", title, primary_artist);
    let url = Url::parse_with_params(
        "https://musicbrainz.org/ws/2/recording",
        &[
            ("query", query.as_str()),
            ("fmt", "json"),
            ("limit", "10"),
            ("inc", "genres+tags+artist-credits"),
        ],
    )
    .map_err(|err| err.to_string())?;

    musicbrainz_throttle().await;
    let payload: MbRecordingGenreSearch = fetch_json(url, Some(METADATA_USER_AGENT)).await?;
    let mut genre_scores: HashMap<&'static str, i32> = HashMap::new();
    let mut artist_fallback_scores: HashMap<&'static str, i32> = HashMap::new();
    for hit in payload.recordings.unwrap_or_default() {
        let hit_score = score_musicbrainz_recording(song, &hit);
        if hit_score <= 0 {
            continue;
        }
        let mut hit_genre_scores: HashMap<&'static str, i32> = HashMap::new();
        score_musicbrainz_tags(
            &mut hit_genre_scores,
            hit.genres.unwrap_or_default().into_iter().chain(hit.tags.unwrap_or_default()),
            1,
        );
        for (genre, score) in hit_genre_scores {
            let entry = genre_scores.entry(genre).or_insert(0);
            *entry += score + hit_score;
        }
        if let Some(credits) = hit.artist_credit.as_ref() {
            for credit in credits {
                if let Some(artist) = credit.artist.as_ref() {
                    score_artist_reference_genres(&mut artist_fallback_scores, artist, 1);
                }
                if let Some(name) = credit.name.as_deref() {
                    if let Some(genre) = infer_genre_from_artist_text(name) {
                        let entry = artist_fallback_scores.entry(genre).or_insert(0);
                        *entry += 30;
                    }
                }
            }
        }
    }

    if let Some(genre) = display_ranked_genres(genre_scores) {
        return Ok(Some(genre));
    }
    Ok(display_ranked_genres(artist_fallback_scores))
}

async fn fetch_wikipedia_song_genre(song: &SongInput) -> Result<Option<String>, String> {
    let primary_artist = metadata_artist_for_song(song);
    let title = clean_lyrics_title(&song.title, Some(&primary_artist));
    if title.trim().is_empty() || primary_artist.trim().is_empty() {
        return Ok(None);
    }

    let mut scores: HashMap<&'static str, i32> = HashMap::new();

    let direct_candidates = [
        format!("{title} ({primary_artist} song)"),
        format!("{title} (song)"),
        title.clone(),
    ];
    let mut candidate_titles = Vec::new();
    for candidate in direct_candidates {
        if !candidate_titles.iter().any(|existing: &String| existing.eq_ignore_ascii_case(&candidate)) {
            candidate_titles.push(candidate);
        }
    }

    let search_queries = [
        format!("\"{title}\" \"{primary_artist}\" song genre"),
        format!("{title} {primary_artist} song"),
    ];
    for query in search_queries {
        if let Ok(found) = fetch_wikipedia_search_titles_for_query(&query, 8).await {
            for found_title in found {
                if !candidate_titles
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(&found_title))
                {
                    candidate_titles.push(found_title);
                }
            }
        }
    }

    for candidate_title in candidate_titles.into_iter().take(12) {
        if !is_likely_song_page_title(&candidate_title, &title, &primary_artist) {
            continue;
        }

        let categories = fetch_wikipedia_categories_for_title(&candidate_title).await?;
        if categories.is_empty() {
            continue;
        }
        merge_genre_scores(&mut scores, score_genre_categories(&categories, 1));
    }
    Ok(display_ranked_genres(scores))
}

async fn fetch_itunes_song_genre(song: &SongInput) -> Result<Option<String>, String> {
    let primary_artist = metadata_artist_for_song(song);
    let title = clean_lyrics_title(&song.title, Some(&primary_artist));
    let term = format!("{} {}", primary_artist, title);
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
    ranked.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    let genre = ranked
        .first()
        .and_then(|(_, hit)| hit.primary_genre_name.clone());
    match genre {
        Some(value) if !is_unknown_genre(&value) => Ok(Some(value)),
        _ => Ok(None),
    }
}

async fn fetch_song_genre(song: &SongInput) -> Result<Option<String>, String> {
    let primary_artist = metadata_artist_for_song(song);
    match fetch_musicbrainz_song_genre(song).await {
        Ok(Some(genre)) => return Ok(Some(genre)),
        Ok(None) => {}
        Err(_) => {}
    }
    match fetch_wikipedia_song_genre(song).await {
        Ok(Some(genre)) => return Ok(Some(genre)),
        Ok(None) => {}
        Err(_) => {}
    }
    match fetch_itunes_song_genre(song).await {
        Ok(Some(genre)) => return Ok(Some(genre)),
        Ok(None) => {}
        Err(_) => {}
    }
    fetch_wikipedia_artist_genre_fallback(&primary_artist).await
}

async fn infer_cached_artist_profile_genre(
    app: &tauri::AppHandle,
    artist_name: &str,
) -> Result<Option<String>, String> {
    if artist_name.trim().is_empty() || artist_name.trim().eq_ignore_ascii_case("unknown artist") {
        return Ok(None);
    }

    for key in cache_keys_for_artist(artist_name) {
        let cached: Option<ArtistProfile> = read_json(app, &key).await?;
        if let Some(profile) = cached {
            if is_valid_artist_profile(&profile, artist_name) {
                if let Some(genre) = infer_genre_from_artist_text(&profile.summary) {
                    return Ok(Some(genre.to_string()));
                }
            }
        }
    }

    Ok(None)
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

    let mut cache = read_json::<HashMap<String, SongGenreCacheEntry>>(&app, SONG_GENRE_CACHE_PATH)
        .await?
        .unwrap_or_default();
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

    let primary_artist = metadata_artist_for_song(&song);
    if let Ok(Some(genre)) = infer_cached_artist_profile_genre(&app, &primary_artist).await {
        cache.insert(
            key.clone(),
            SongGenreCacheEntry {
                genre: genre.clone(),
                fetched_at: now_unix(),
            },
        );
        write_json(&app, SONG_GENRE_CACHE_PATH, &cache).await?;
        return Ok(SongGenreLoadResult {
            status: "ready".to_string(),
            genre: Some(genre),
            from_cache: Some(true),
            cache_path,
        });
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
            write_json(&app, SONG_GENRE_CACHE_PATH, &cache).await?;
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
    fn wikipedia_summary_url_percent_encodes_title_segment() {
        let url = wikipedia_summary_url("Guns N' Roses/Live").unwrap();
        assert_eq!(
            url.as_str(),
            "https://en.wikipedia.org/api/rest_v1/page/summary/Guns%20N'%20Roses%2FLive"
        );
    }

    #[test]
    fn artist_match_handles_apostrophe_variants() {
        assert!(is_artist_close_match("Guns N' Roses", "Guns N Roses"));
        assert!(is_artist_close_match("Guns N’ Roses", "Guns N' Roses"));
    }

    #[test]
    fn artist_identity_handles_stylized_dollar_names() {
        assert!(identity_contains(
            "ASAP Rocky is an American rapper.",
            "A$AP Rocky"
        ));
        assert!(identity_contains("A$AP Rocky", "ASAP Rocky"));
        assert!(identity_contains("Pink is an American singer.", "P!nk"));
        assert!(identity_contains("Kesha is an American singer.", "Ke$ha"));
        assert!(identity_contains("Anderson Paak is an American rapper.", "Anderson .Paak"));
        assert!(identity_contains("Motley Crue is an American rock band.", "Mötley Crüe"));
    }

    #[test]
    fn artist_cache_keys_include_legacy_stylized_slug() {
        let keys = cache_keys_for_artist("A$AP Rocky");
        assert!(keys.contains(&"artist_cache/asap-rocky.json".to_string()));
        assert!(keys.contains(&"artist_cache/a-ap-rocky.json".to_string()));

        let pink_keys = cache_keys_for_artist("P!nk");
        assert!(pink_keys.contains(&"artist_cache/pink.json".to_string()));
        assert!(pink_keys.contains(&"artist_cache/p-nk.json".to_string()));
    }

    #[test]
    fn cached_artist_profile_accepts_stylized_artist_name_match() {
        let profile = ArtistProfile {
            artist_name: "ASAP Rocky".to_string(),
            summary: "ASAP Rocky is an American rapper, singer, songwriter, and record producer."
                .to_string(),
            image_url: None,
            source_url: None,
            fetched_at: 0,
        };

        assert!(is_valid_artist_profile(&profile, "A$AP Rocky"));
    }

    #[test]
    fn artist_identity_accepts_birth_name_inserted_between_tokens() {
        let summary = "Ye, born Kanye Omari West, is an American rapper, singer, songwriter, and record producer.";
        assert!(identity_contains(summary, "Kanye West"));
        assert!(artist_identity_matches("Ye", summary, Some("https://en.wikipedia.org/wiki/Ye"), "Kanye West"));
    }

    #[test]
    fn artist_identity_rejects_song_pages() {
        let summary = "Runaway is a song by American rapper Kanye West from his fifth studio album.";
        assert!(!artist_identity_matches(
            "Runaway (Kanye West song)",
            summary,
            Some("https://en.wikipedia.org/wiki/Runaway_(Kanye_West_song)"),
            "Kanye West"
        ));
    }

    #[test]
    fn major_genre_tags_collapse_to_mix_friendly_buckets() {
        assert_eq!(canonical_genre_tag("hard rock").map(|entry| entry.0), Some("Rock"));
        assert_eq!(canonical_genre_tag("east coast hip hop").map(|entry| entry.0), Some("Hip-Hop/Rap"));
        assert_eq!(canonical_genre_tag("conscious hip hop").map(|entry| entry.0), Some("Hip-Hop/Rap"));
    }

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
