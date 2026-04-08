use std::collections::{HashMap, HashSet};

use regex::Regex;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

static MULTISPACE_RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| Regex::new(r"\s+").unwrap());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSongInput {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub play_count: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsArtistCount {
    pub artist: String,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsAlbumCount {
    pub album: String,
    pub artist: String,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsResult {
    pub total_listening_hours: f64,
    pub top_song_ids: Vec<String>,
    pub top_artists: Vec<StatsArtistCount>,
    pub top_albums: Vec<StatsAlbumCount>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSongInput {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkSongInput {
    pub id: String,
    pub artist: String,
    pub album: Option<String>,
    pub album_art: Option<String>,
    pub track: Option<u32>,
    pub favorite: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtCount {
    pub art: String,
    pub count: u32,
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
    split_artist_names(artist)
        .first()
        .cloned()
        .unwrap_or_else(|| "Unknown Artist".to_string())
}

#[tauri::command]
pub fn build_stats_rust(songs: Vec<StatsSongInput>) -> Result<StatsResult, String> {
    let mut sorted = songs.clone();
    sorted.sort_by(|a, b| b.play_count.cmp(&a.play_count));

    let mut artist_map: HashMap<String, u32> = HashMap::new();
    let mut album_map: HashMap<String, StatsAlbumCount> = HashMap::new();
    let mut listening_seconds = 0.0_f64;

    for song in &songs {
        listening_seconds += song.duration * (song.play_count as f64);
        for artist_name in split_artist_names(&song.artist) {
            let entry = artist_map.entry(artist_name).or_insert(0);
            *entry += song.play_count;
        }
        let artist = get_primary_artist_name(&song.artist);
        let key = format!("{}::{}", artist.to_lowercase(), song.album.to_lowercase());
        let entry = album_map.entry(key).or_insert_with(|| StatsAlbumCount {
            album: song.album.clone(),
            artist,
            count: 0,
        });
        entry.count += song.play_count;
    }

    let mut top_artists: Vec<StatsArtistCount> = artist_map
        .into_iter()
        .map(|(artist, count)| StatsArtistCount { artist, count })
        .collect();
    top_artists.sort_by(|a, b| b.count.cmp(&a.count));
    top_artists.truncate(8);

    let mut top_albums: Vec<StatsAlbumCount> = album_map
        .into_values()
        .collect();
    top_albums.sort_by(|a, b| b.count.cmp(&a.count));
    top_albums.truncate(8);

    let top_song_ids = sorted
        .iter()
        .take(10)
        .map(|song| song.id.clone())
        .collect::<Vec<_>>();

    let hours = ((listening_seconds / 3600.0) * 10.0).round() / 10.0;

    Ok(StatsResult {
        total_listening_hours: hours,
        top_song_ids,
        top_artists,
        top_albums,
    })
}

fn normalize_search_value(value: &str) -> String {
    let lower = value.to_lowercase();
    let mut out = String::new();
    for ch in lower.nfkd() {
        if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch.is_whitespace() {
            out.push(ch);
        } else {
            out.push(' ');
        }
    }
    MULTISPACE_RE.replace_all(&out, " ").trim().to_string()
}

fn tokenize(value: &str) -> Vec<String> {
    normalize_search_value(value)
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect()
}

#[derive(Clone, Debug)]
struct NormalizedSongFields {
    title: String,
    artist: String,
    album: String,
    genre: String,
    combined: String,
}

fn get_normalized_fields(song: &SearchSongInput) -> NormalizedSongFields {
    let title = normalize_search_value(&song.title);
    let artist = normalize_search_value(&song.artist);
    let album = normalize_search_value(&song.album);
    let genre = normalize_search_value(song.genre.as_deref().unwrap_or(""));
    let combined = normalize_search_value(&format!(
        "{} {} {} {}",
        song.title,
        song.artist,
        song.album,
        song.genre.as_deref().unwrap_or("")
    ));
    NormalizedSongFields {
        title,
        artist,
        album,
        genre,
        combined,
    }
}

fn field_score(normalized_field: &str, tokens: &[String]) -> i32 {
    if normalized_field.is_empty() {
        return 0;
    }
    let mut score = 0;
    for token in tokens {
        if token.is_empty() {
            continue;
        }
        if normalized_field == token {
            score += 8;
        } else if normalized_field.starts_with(token) {
            score += 4;
        } else if normalized_field.contains(token) {
            score += 2;
        }
    }
    score
}

fn compare_matches(a: &SearchMatch, b: &SearchMatch) -> std::cmp::Ordering {
    let score_diff = b.score.cmp(&a.score);
    if score_diff != std::cmp::Ordering::Equal {
        return score_diff;
    }
    let title_diff = a.song.title.cmp(&b.song.title);
    if title_diff != std::cmp::Ordering::Equal {
        return title_diff;
    }
    let artist_diff = a.song.artist.cmp(&b.song.artist);
    if artist_diff != std::cmp::Ordering::Equal {
        return artist_diff;
    }
    let album_diff = a.song.album.cmp(&b.song.album);
    if album_diff != std::cmp::Ordering::Equal {
        return album_diff;
    }
    a.song.id.cmp(&b.song.id)
}

fn score_song_for_query(song: &SearchSongInput, tokens: &[String]) -> i32 {
    if tokens.is_empty() {
        return 0;
    }
    let normalized = get_normalized_fields(song);
    let mut score = 0;
    score += field_score(&normalized.title, tokens) * 3;
    score += field_score(&normalized.artist, tokens) * 2;
    score += (field_score(&normalized.album, tokens) as f64 * 1.5) as i32;
    score += field_score(&normalized.genre, tokens);

    if !normalized.combined.is_empty() {
        let all_tokens_match = tokens.iter().all(|token| normalized.combined.contains(token));
        if all_tokens_match {
            score += 6;
        }
    }
    score
}

#[derive(Clone, Debug)]
struct SearchMatch {
    song: SearchSongInput,
    score: i32,
}

#[tauri::command]
pub fn search_filter_rank_rust(
    songs: Vec<SearchSongInput>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<String>, String> {
    let normalized_query = normalize_search_value(&query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }
    let tokens = tokenize(&normalized_query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let max_limit = limit.unwrap_or(u32::MAX) as usize;

    let mut matches: Vec<SearchMatch> = Vec::new();
    for song in songs {
        let score = score_song_for_query(&song, &tokens);
        if score <= 0 {
            continue;
        }
        matches.push(SearchMatch { song, score });
    }

    matches.sort_by(compare_matches);
    if matches.len() > max_limit {
        matches.truncate(max_limit);
    }

    Ok(matches.into_iter().map(|entry| entry.song.id).collect())
}

fn hash(value: &str) -> i32 {
    let mut h: i32 = 0;
    for ch in value.chars() {
        h = h.wrapping_shl(5).wrapping_sub(h).wrapping_add(ch as i32);
    }
    h.abs()
}

fn album_key_for(song: &ArtworkSongInput) -> String {
    let artist = get_primary_artist_name(&song.artist).to_lowercase();
    let album = song.album.as_deref().unwrap_or("").trim().to_lowercase();
    format!("{artist}::{album}")
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

#[tauri::command]
pub fn build_artwork_set_rust(
    songs: Vec<ArtworkSongInput>,
    freq: Vec<ArtCount>,
    desired: u32,
    preferred_art: Option<String>,
) -> Result<Vec<String>, String> {
    let mut freq_map: HashMap<String, u32> = HashMap::new();
    for entry in freq {
        freq_map.insert(entry.art, entry.count);
    }

    let mut candidates: Vec<(String, String, i32)> = Vec::new();
    for song in &songs {
        let art = match song.album_art.as_ref() {
            Some(value) if !value.is_empty() => value.clone(),
            _ => continue,
        };
        let frequency = *freq_map.get(&art).unwrap_or(&0) as i32;
        let track_penalty = if song.track.unwrap_or(0) == 1 { -18 } else { 0 };
        let album_bonus = if song.album.as_deref().unwrap_or("").trim().is_empty() { 0 } else { 2 };
        let favorite_bonus = if song.favorite { 3 } else { 0 };
        let diversity_boost = (hash(&format!("{}:{}", song.id, art)) % 7) - 3;
        let score = 100 - frequency * 2 + track_penalty + album_bonus + favorite_bonus + diversity_boost;
        candidates.push((art, album_key_for(song), score));
    }

    candidates.sort_by(|a, b| b.2.cmp(&a.2));

    let mut seen_art: HashSet<String> = HashSet::new();
    let mut seen_album: HashSet<String> = HashSet::new();
    let mut picked: Vec<String> = Vec::new();

    if let Some(preferred) = preferred_art {
        if !preferred.is_empty() {
            picked.push(preferred.clone());
            seen_art.insert(preferred.clone());
            if let Some(entry) = candidates.iter().find(|entry| entry.0 == preferred) {
                seen_album.insert(entry.1.clone());
            }
        }
    }

    let desired_usize = desired.max(1) as usize;
    for entry in &candidates {
        if seen_art.contains(&entry.0) {
            continue;
        }
        if seen_album.contains(&entry.1) && candidates.len() > desired_usize * 2 {
            continue;
        }
        seen_art.insert(entry.0.clone());
        seen_album.insert(entry.1.clone());
        picked.push(entry.0.clone());
        if picked.len() >= desired_usize {
            break;
        }
    }

    if picked.len() < desired_usize && !candidates.is_empty() {
        for entry in &candidates {
            if seen_art.contains(&entry.0) {
                continue;
            }
            seen_art.insert(entry.0.clone());
            picked.push(entry.0.clone());
            if picked.len() >= desired_usize {
                break;
            }
        }
    }

    Ok(picked)
}
