use std::collections::HashMap;

use reqwest::Url;
use serde::Deserialize;

use super::artist::{
    build_candidate_titles, cache_keys_for_artist, fetch_wikipedia_search_titles_for_query,
    fetch_wikipedia_summary, is_valid_artist_profile,
};
use super::cache::{cache_all, cache_get, cache_put, read_json, to_storage_cache_path, CacheKind};
use super::http::{fetch_json, musicbrainz_throttle, score_itunes_hit, ItunesSongHit, ItunesSongPayload};
use super::normalize::{
    artist_identity_matches, clean_lyrics_title, get_primary_artist_name, identity_contains,
    is_artist_close_match, is_close_match, is_exact_match, is_unknown_genre, metadata_artist_for_song,
    normalize_text, slugify,
};
use super::{
    now_unix, ArtistProfile, SongGenreCacheEntry, SongGenreLoadResult, SongInput, SONG_GENRE_CACHE_PATH,
};
use crate::error::AmplyResult;

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

#[tauri::command]
pub async fn load_song_genre_cache_rust(
    app: tauri::AppHandle,
) -> AmplyResult<HashMap<String, SongGenreCacheEntry>> {
    Ok(cache_all::<SongGenreCacheEntry>(&app, CacheKind::SongGenre).await?)
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

    let payload: WikipediaCategoryPayload = fetch_json(url).await?;
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

        let categories = match fetch_wikipedia_categories_for_title(&title).await {
            Ok(categories) => categories,
            Err(error) => {
                log::warn!("Wikipedia categories for {title:?} failed: {error}");
                Vec::new()
            }
        };
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
    let payload: MbRecordingGenreSearch = fetch_json(url).await?;
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
        let found = match fetch_wikipedia_search_titles_for_query(&query, 8).await {
            Ok(found) => found,
            Err(error) => {
                log::warn!("Wikipedia song search for {query:?} failed: {error}");
                continue;
            }
        };
        for found_title in found {
            if !candidate_titles
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&found_title))
            {
                candidate_titles.push(found_title);
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
    let payload: ItunesSongPayload = fetch_json(url).await?;
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
        Err(error) => log::warn!("MusicBrainz genre for {:?} failed: {error}", song.title),
    }
    match fetch_wikipedia_song_genre(song).await {
        Ok(Some(genre)) => return Ok(Some(genre)),
        Ok(None) => {}
        Err(error) => log::warn!("Wikipedia genre for {:?} failed: {error}", song.title),
    }
    match fetch_itunes_song_genre(song).await {
        Ok(Some(genre)) => return Ok(Some(genre)),
        Ok(None) => {}
        Err(error) => log::warn!("iTunes genre for {:?} failed: {error}", song.title),
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
) -> AmplyResult<SongGenreLoadResult> {
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

    let key = cache_key_for_song_genre(&song);
    if let Some(entry) = cache_get::<SongGenreCacheEntry>(&app, CacheKind::SongGenre, &key).await? {
        if !is_unknown_genre(&entry.genre) {
            return Ok(SongGenreLoadResult {
                status: "ready".to_string(),
                genre: Some(entry.genre),
                from_cache: Some(true),
                cache_path,
            });
        }
    }

    let primary_artist = metadata_artist_for_song(&song);
    let inferred = match infer_cached_artist_profile_genre(&app, &primary_artist).await {
        Ok(genre) => genre,
        Err(error) => {
            log::warn!("Cached artist profile genre for {primary_artist:?} failed: {error}");
            None
        }
    };
    if let Some(genre) = inferred {
        cache_put(
            &app,
            CacheKind::SongGenre,
            &key,
            &SongGenreCacheEntry {
                genre: genre.clone(),
                fetched_at: now_unix(),
            },
        )
        .await?;
        return Ok(SongGenreLoadResult {
            status: "ready".to_string(),
            genre: Some(genre),
            from_cache: Some(true),
            cache_path,
        });
    }

    match fetch_song_genre(&song).await {
        Ok(Some(genre)) => {
            cache_put(
                &app,
                CacheKind::SongGenre,
                &key,
                &SongGenreCacheEntry {
                    genre: genre.clone(),
                    fetched_at: now_unix(),
                },
            )
            .await?;
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
        Err(error) => {
            log::warn!("Genre providers for {:?} failed: {error}", song.title);
            Ok(SongGenreLoadResult {
                status: "no-internet".to_string(),
                genre: None,
                from_cache: None,
                cache_path,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_genre_tags_collapse_to_mix_friendly_buckets() {
        assert_eq!(canonical_genre_tag("hard rock").map(|entry| entry.0), Some("Rock"));
        assert_eq!(canonical_genre_tag("east coast hip hop").map(|entry| entry.0), Some("Hip-Hop/Rap"));
        assert_eq!(canonical_genre_tag("conscious hip hop").map(|entry| entry.0), Some("Hip-Hop/Rap"));
    }
}
