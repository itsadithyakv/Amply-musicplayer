use std::collections::HashMap;

use reqwest::Url;
use serde::Deserialize;

use super::cache::{read_json, to_storage_cache_path, write_json};
use super::http::{fetch_json, wikipedia_summary_url, HTTP};
use super::identity::{resolve_artist_page, RESOLVER_VERSION};
use super::normalize::{
    classify_wikipedia_page, count_words, hash_string, identity_contains, is_disambiguation_text,
    is_music_related_text, normalize_text, page_title_core, same_artist_name, slugify, slugify_legacy,
    to_word_range, wikipedia_title_from_url, PageKind,
};
use super::{now_unix, ArtistContext, ArtistProfile, ArtistProfileLoadResult, ARTIST_CACHE_FOLDER};
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
async fn fetch_artist_profile(artist_name: &str, context: &ArtistContext) -> Result<Option<ArtistProfile>, String> {
    let Some(page) = resolve_artist_page(artist_name, context).await? else {
        return Ok(None);
    };
    let lead = page.summary.extract.clone().unwrap_or_default();
    let intro = match fetch_wikipedia_intro_extract(&page.title).await {
        Ok(extract) => extract,
        Err(error) => {
            log::warn!("Wikipedia intro extract for {:?} failed: {error}", page.title);
            None
        }
    };
    let summary = to_word_range(intro.as_deref().unwrap_or(&lead), 100, 200);
    if summary.trim().is_empty() || is_disambiguation_text(&summary) {
        return Ok(None);
    }
    let source_url = page.summary.content_urls.and_then(|urls| urls.desktop).and_then(|desktop| desktop.page);
    Ok(Some(ArtistProfile {
        artist_name: artist_name.to_string(),
        summary,
        image_url: page.summary.thumbnail.and_then(|thumb| thumb.source),
        source_url,
        fetched_at: now_unix(),
        mbid: page.mbid,
        resolver: RESOLVER_VERSION,
    }))
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

/// Whether a cached profile may be shown for `artist_name`. Song, album and list pages never are.
/// Profiles from the current resolver had their identity checked when fetched; older ones were
/// accepted on a name match alone, so they must at least sit on a page named for the artist.
pub(crate) fn is_valid_artist_profile(profile: &ArtistProfile, artist_name: &str) -> bool {
    if !is_valid_cached_summary(&profile.summary) || normalize_text(artist_name).is_empty() {
        return false;
    }
    let page_title = profile.source_url.as_deref().and_then(wikipedia_title_from_url).unwrap_or_default();
    if matches!(
        classify_wikipedia_page(&page_title, &profile.summary),
        PageKind::Work | PageKind::List | PageKind::Disambiguation
    ) {
        return false;
    }
    if profile.resolver >= RESOLVER_VERSION {
        return true;
    }
    same_artist_name(page_title_core(&page_title), artist_name) && identity_contains(&profile.summary, artist_name)
}

/// An entry from before identities were checked that sits on a disambiguated page ("Bellini
/// (Italian band)"): the old resolver guessed which namesake to show, so it stays hidden until the
/// new one has re-checked it.
fn is_unchecked_namesake_guess(profile: &ArtistProfile) -> bool {
    let page_title = profile.source_url.as_deref().and_then(wikipedia_title_from_url).unwrap_or_default();
    profile.resolver < RESOLVER_VERSION && page_title_core(&page_title) != page_title.trim()
}

/// The first cached profile valid for `name`, with the key it was found under. Invalid entries are
/// deleted on the way.
async fn read_valid_cached_profile(app: &tauri::AppHandle, name: &str) -> AmplyResult<Option<(String, ArtistProfile)>> {
    for candidate_key in cache_keys_for_artist(name) {
        let Some(profile) = read_json::<ArtistProfile>(app, &candidate_key).await? else {
            continue;
        };
        if is_valid_artist_profile(&profile, name) {
            return Ok(Some((candidate_key, profile)));
        }
        if let Err(error) = delete_storage_kv(app, &candidate_key).await {
            log::warn!("Failed to drop invalid artist profile cache {candidate_key}: {error}");
        }
    }
    Ok(None)
}

async fn drop_cached_profiles(app: &tauri::AppHandle, name: &str) {
    for key in cache_keys_for_artist(name) {
        if let Err(error) = delete_storage_kv(app, &key).await {
            log::warn!("Failed to drop artist profile cache {key}: {error}");
        }
    }
}

async fn migrate_cache_key(app: &tauri::AppHandle, found_key: &str, cache_key: &str, profile: &ArtistProfile) {
    if found_key != cache_key {
        if let Err(error) = write_json(app, cache_key, profile).await {
            log::warn!("Failed to migrate artist profile cache to {cache_key}: {error}");
        }
    }
}

fn ready_result(profile: ArtistProfile, from_cache: bool, cache_path: String) -> ArtistProfileLoadResult {
    ArtistProfileLoadResult {
        status: "ready".to_string(),
        profile: Some(profile),
        from_cache: Some(from_cache),
        cache_path,
    }
}

fn empty_result(status: &str, cache_path: String) -> ArtistProfileLoadResult {
    ArtistProfileLoadResult {
        status: status.to_string(),
        profile: None,
        from_cache: None,
        cache_path,
    }
}

fn is_placeholder_artist(name: &str) -> bool {
    name.is_empty() || name.eq_ignore_ascii_case("unknown artist")
}

/// True when a checked profile is cached. Profiles from an older resolver report false so the
/// library's metadata pass re-resolves them; the read below still serves them meanwhile.
#[tauri::command]
pub async fn has_cached_artist_profile_rust(app: tauri::AppHandle, artist_name: String) -> AmplyResult<bool> {
    let name = artist_name.trim().to_string();
    if is_placeholder_artist(&name) {
        return Ok(true);
    }
    Ok(read_valid_cached_profile(&app, &name)
        .await?
        .is_some_and(|(_, profile)| profile.resolver >= RESOLVER_VERSION))
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
    if is_placeholder_artist(&name) {
        return Ok(empty_result("missing", to_storage_cache_path(&cache_key)));
    }
    match read_valid_cached_profile(&app, &name).await? {
        Some((found_key, profile)) if !is_unchecked_namesake_guess(&profile) => {
            migrate_cache_key(&app, &found_key, &cache_key, &profile).await;
            Ok(ready_result(profile, true, to_storage_cache_path(&found_key)))
        }
        _ => Ok(empty_result("missing", to_storage_cache_path(&cache_key))),
    }
}

/// Returns the cached profile when it is current, otherwise resolves the artist. `context` holds
/// songs and albums the library files under this artist; they decide between namesakes.
#[tauri::command]
pub async fn load_artist_profile_rust(
    app: tauri::AppHandle,
    artist_name: String,
    context: Option<ArtistContext>,
) -> AmplyResult<ArtistProfileLoadResult> {
    let name = artist_name.trim().to_string();
    let cache_key = cache_key_for_artist(&name);
    let cache_path = to_storage_cache_path(&cache_key);
    if is_placeholder_artist(&name) {
        return Ok(empty_result("missing", cache_path));
    }

    let cached = read_valid_cached_profile(&app, &name).await?;
    if let Some((found_key, profile)) = cached.as_ref() {
        if profile.resolver >= RESOLVER_VERSION {
            migrate_cache_key(&app, found_key, &cache_key, profile).await;
            return Ok(ready_result(profile.clone(), true, to_storage_cache_path(found_key)));
        }
    }

    match fetch_artist_profile(&name, &context.unwrap_or_default()).await {
        Ok(Some(profile)) => {
            write_json(&app, &cache_key, &profile).await?;
            Ok(ready_result(profile, false, cache_path))
        }
        Ok(None) => {
            // The re-check tied no page to this artist, so an older entry was a guess.
            if cached.is_some() {
                drop_cached_profiles(&app, &name).await;
            }
            Ok(empty_result("missing", cache_path))
        }
        Err(error) => {
            log::warn!("Artist profile for {name:?} failed: {error}");
            // Only transport failures mean "offline"; anything else is a lookup miss the user can retry.
            let offline = super::http::is_offline_error(&error);
            match cached {
                // Offline, an older entry beats nothing, unless it was a namesake guess.
                Some((found_key, profile)) if offline && !is_unchecked_namesake_guess(&profile) => {
                    Ok(ready_result(profile, true, to_storage_cache_path(&found_key)))
                }
                _ => Ok(empty_result(if offline { "no-internet" } else { "missing" }, cache_path)),
            }
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
            source_url: Some("https://en.wikipedia.org/wiki/ASAP_Rocky".to_string()),
            fetched_at: 0,
            mbid: None,
            resolver: 0,
        };

        assert!(is_valid_artist_profile(&profile, "A$AP Rocky"));
    }
}

#[cfg(test)]
mod cache_probe {
    use super::*;

    /// Replays the cache rules over the real app database (read-only):
    /// `cargo test -- --ignored artist_cache_probe --nocapture`.
    #[test]
    #[ignore]
    fn artist_cache_probe() {
        let db = std::path::PathBuf::from(std::env::var("APPDATA").unwrap())
            .join("AdithyaKV.AmplyMusicPlayer/storage/amply_cache.db");
        let conn = rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let mut stmt = conn.prepare("select value from kv where path like 'artist_cache/%'").unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
        let (mut shown, mut hidden, mut dropped) = (0, 0, 0);
        for value in rows.flatten() {
            let Ok(profile) = serde_json::from_str::<ArtistProfile>(&value) else { continue };
            let page = profile.source_url.as_deref().and_then(wikipedia_title_from_url).unwrap_or_default();
            let verdict = if !is_valid_artist_profile(&profile, &profile.artist_name) {
                dropped += 1;
                "DROP"
            } else if is_unchecked_namesake_guess(&profile) {
                hidden += 1;
                "HIDE"
            } else {
                shown += 1;
                continue;
            };
            eprintln!("{verdict}  {:<24} -> {page}", profile.artist_name);
        }
        eprintln!("kept {shown}, hidden until re-checked {hidden}, dropped {dropped}");
    }
}
