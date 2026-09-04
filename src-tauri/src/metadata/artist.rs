use std::collections::{HashMap, HashSet};

use reqwest::Url;
use serde::Deserialize;

use super::cache::{read_json, to_storage_cache_path, write_json};
use super::http::{fetch_json, wikipedia_summary_url, HTTP};
use super::normalize::{
    artist_identity_matches, count_words, hash_string, identity_contains, is_disambiguation_text,
    is_likely_artist_title, is_music_related_text, normalize_text, slugify, slugify_legacy,
    to_word_range,
};
use super::{now_unix, ArtistProfile, ArtistProfileLoadResult, ARTIST_CACHE_FOLDER};
use crate::error::AmplyResult;
use crate::storage::delete_storage_kv;

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

pub(crate) fn cache_keys_for_artist(artist_name: &str) -> Vec<String> {
    let mut keys = vec![cache_key_for_artist(artist_name)];
    let legacy = cache_key_for_artist_slug(artist_name, slugify_legacy(artist_name));
    if !keys.iter().any(|key| key == &legacy) {
        keys.push(legacy);
    }
    keys
}

#[derive(Debug, Deserialize)]
pub(crate) struct WikipediaSummaryPayload {
    pub(crate) title: Option<String>,
    #[serde(rename = "type")]
    pub(crate) page_type: Option<String>,
    pub(crate) extract: Option<String>,
    pub(crate) thumbnail: Option<WikipediaThumbnail>,
    pub(crate) content_urls: Option<WikipediaContentUrls>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WikipediaThumbnail {
    pub(crate) source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WikipediaContentUrls {
    pub(crate) desktop: Option<WikipediaDesktopUrl>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WikipediaDesktopUrl {
    pub(crate) page: Option<String>,
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
    pub(crate) title: Option<String>,
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
    pub(crate) extract: Option<String>,
}

pub(crate) async fn fetch_wikipedia_summary(title: &str) -> Result<Option<WikipediaSummaryPayload>, String> {
    let url = wikipedia_summary_url(title)?;
    let response = HTTP
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

pub(crate) async fn fetch_wikipedia_search_titles_for_query(query: &str, limit: usize) -> Result<Vec<String>, String> {
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
    let payload: WikipediaSearchPayload = fetch_json(url).await?;
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
    let payload: WikipediaExtractPayload = fetch_json(url).await?;
    let pages = payload.query.and_then(|query| query.pages).unwrap_or_default();
    let extract = pages.values().next().and_then(|page| page.extract.clone());
    Ok(extract.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    }))
}

pub(crate) async fn build_candidate_titles(artist_name: &str) -> Result<Vec<String>, String> {
    let trimmed = artist_name.trim();
    let qualifiers = ["musician", "band", "singer", "rapper", "dj", "group"];
    let mut candidates = qualifiers
        .iter()
        .map(|qualifier| format!("{trimmed} ({qualifier})"))
        .collect::<Vec<_>>();
    candidates.push(trimmed.to_string());
    match fetch_wikipedia_search_titles(trimmed).await {
        Ok(searched) => candidates.extend(searched),
        Err(error) => log::warn!("Wikipedia search for artist {trimmed:?} failed: {error}"),
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
        let intro_extract = match fetch_wikipedia_intro_extract(&resolved_title).await {
            Ok(extract) => extract,
            Err(error) => {
                log::warn!("Wikipedia intro extract for {resolved_title:?} failed: {error}");
                None
            }
        };
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

pub(crate) fn is_valid_artist_profile(profile: &ArtistProfile, artist_name: &str) -> bool {
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
pub async fn has_cached_artist_profile_rust(app: tauri::AppHandle, artist_name: String) -> AmplyResult<bool> {
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

/// Batch form of `has_cached_artist_profile_rust`: one IPC round trip for a whole library's
/// worth of artists instead of one per artist.
#[tauri::command]
pub async fn has_cached_artist_profiles_rust(
    app: tauri::AppHandle,
    artist_names: Vec<String>,
) -> AmplyResult<Vec<bool>> {
    let mut cached = Vec::with_capacity(artist_names.len());
    for name in artist_names {
        cached.push(has_cached_artist_profile_rust(app.clone(), name).await?);
    }
    Ok(cached)
}

#[tauri::command]
pub async fn read_cached_artist_profile_rust(
    app: tauri::AppHandle,
    artist_name: String,
) -> AmplyResult<ArtistProfileLoadResult> {
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
                    if let Err(error) = write_json(&app, &cache_key, &profile).await {
                        log::warn!("Failed to migrate artist profile cache to {cache_key}: {error}");
                    }
                }
                let resolved_cache_path = to_storage_cache_path(&candidate_key);
                return Ok(ArtistProfileLoadResult {
                    status: "ready".to_string(),
                    profile: Some(profile),
                    from_cache: Some(true),
                    cache_path: resolved_cache_path,
                });
            }
            if let Err(error) = delete_storage_kv(&app, &candidate_key).await {
                log::warn!("Failed to drop invalid artist profile cache {candidate_key}: {error}");
            }
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
) -> AmplyResult<ArtistProfileLoadResult> {
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
                    if let Err(error) = write_json(&app, &cache_key, &cached).await {
                        log::warn!("Failed to migrate artist profile cache to {cache_key}: {error}");
                    }
                }
                let resolved_cache_path = to_storage_cache_path(&candidate_key);
                return Ok(ArtistProfileLoadResult {
                    status: "ready".to_string(),
                    profile: Some(cached),
                    from_cache: Some(true),
                    cache_path: resolved_cache_path,
                });
            }
            if let Err(error) = delete_storage_kv(&app, &candidate_key).await {
                log::warn!("Failed to drop invalid artist profile cache {candidate_key}: {error}");
            }
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
        Err(error) => {
            log::warn!("Wikipedia artist profile for {name:?} failed: {error}");
            // Only transport failures mean "offline"; anything else is a lookup miss the user can retry.
            let status = if super::http::is_offline_error(&error) { "no-internet" } else { "missing" };
            Ok(ArtistProfileLoadResult {
                status: status.to_string(),
                profile: None,
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
}
