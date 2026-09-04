use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use reqwest::Url;
use serde::Deserialize;
use tokio::sync::Mutex;

use super::normalize::{get_primary_artist_name, is_artist_close_match, is_close_match, is_exact_match};
use super::SongInput;

/// MusicBrainz requires a contact in the user agent; every provider gets the same one.
pub(crate) const UA: &str = concat!(
    "Amply/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/adithyakv/amply; adithyakrishnan.vinod@gmail.com)"
);

/// One process-wide client: connection pooling, shared timeouts and user agent.
/// Per-request overrides (shorter timeouts) go on the request builder.
pub(crate) static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .expect("reqwest client with static configuration")
});

const MB_MIN_GAP: Duration = Duration::from_millis(1100);

static MB_LAST_REQUEST: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

/// Serialises MusicBrainz callers so consecutive requests are at least
/// `MB_MIN_GAP` apart. The guard is held across the sleep on purpose: a second
/// caller waits for the first one's slot instead of racing for the same one.
pub(crate) async fn musicbrainz_throttle() {
    let mut last = MB_LAST_REQUEST.lock().await;
    if let Some(prev) = *last {
        let wait = MB_MIN_GAP.saturating_sub(prev.elapsed());
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
    *last = Some(Instant::now());
}

/// Prefix on transport failures so callers can tell "offline" from "the page is missing".
pub(crate) const OFFLINE_PREFIX: &str = "offline: ";

pub(crate) fn is_offline_error(message: &str) -> bool {
    message.starts_with(OFFLINE_PREFIX)
}

fn describe_transport_error(err: reqwest::Error) -> String {
    if err.is_connect() || err.is_timeout() || err.is_request() {
        format!("{OFFLINE_PREFIX}{err}")
    } else {
        err.to_string()
    }
}

pub(crate) async fn fetch_json<T: for<'de> Deserialize<'de>>(url: Url) -> Result<T, String> {
    let response = HTTP
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(describe_transport_error)?;
    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }
    response.json::<T>().await.map_err(|err| err.to_string())
}

/// Hosts the frontend recommendation service may fetch through the native client.
/// Routing these through reqwest sidesteps webview CORS and lets MusicBrainz see a real user agent.
const RECOMMENDATION_HOSTS: &[&str] = &["ws.audioscrobbler.com", "musicbrainz.org"];

#[tauri::command]
pub async fn fetch_recommendation_json_rust(url: String) -> crate::error::AmplyResult<serde_json::Value> {
    let parsed = Url::parse(&url).map_err(|err| crate::error::AmplyError::InvalidInput(err.to_string()))?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https" || !RECOMMENDATION_HOSTS.contains(&host) {
        return Err(crate::error::AmplyError::Forbidden(format!("host not allowed: {host}")));
    }
    if host == "musicbrainz.org" {
        musicbrainz_throttle().await;
    }
    fetch_json::<serde_json::Value>(parsed).await.map_err(crate::error::AmplyError::Other)
}

pub(crate) fn wikipedia_summary_url(title: &str) -> Result<Url, String> {
    let mut url = Url::parse("https://en.wikipedia.org/api/rest_v1/page/summary").map_err(|err| err.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "bad url".to_string())?
        .push(title);
    Ok(url)
}

pub(crate) fn compress_image_to_data_url(image: DynamicImage) -> Option<String> {
    let (width, height) = image.dimensions();
    let max_size = 300u32;
    let scale = (max_size as f32 / width.max(height) as f32).min(1.0);
    let target_w = ((width as f32) * scale).round().max(1.0) as u32;
    let target_h = ((height as f32) * scale).round().max(1.0) as u32;
    let resized = image.resize_exact(target_w, target_h, FilterType::Lanczos3);
    let mut buffer = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 74);
    encoder.encode_image(&resized).ok()?;
    crate::artwork::store_encoded_jpeg(&buffer)
}

pub(crate) async fn fetch_image_data_url(url: &str) -> Result<Option<String>, String> {
    let response = HTTP.get(url).send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let image = image::load_from_memory(&bytes).map_err(|err| err.to_string())?;
    let compressed = compress_image_to_data_url(image);
    Ok(Some(compressed.unwrap_or_else(|| url.to_string())))
}

#[derive(Debug, Deserialize)]
pub(crate) struct ItunesSongPayload {
    pub(crate) results: Option<Vec<ItunesSongHit>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ItunesSongHit {
    #[serde(rename = "trackName")]
    pub(crate) track_name: Option<String>,
    #[serde(rename = "artistName")]
    pub(crate) artist_name: Option<String>,
    #[serde(rename = "primaryGenreName")]
    pub(crate) primary_genre_name: Option<String>,
    #[serde(rename = "artworkUrl100")]
    pub(crate) artwork_url_100: Option<String>,
}

pub(crate) fn score_itunes_hit(song: &SongInput, hit: &ItunesSongHit) -> i32 {
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
    fn user_agent_carries_version_and_contact() {
        assert!(UA.starts_with(concat!("Amply/", env!("CARGO_PKG_VERSION"))));
        assert!(UA.contains('@'));
    }

    #[test]
    fn musicbrainz_throttle_spaces_consecutive_callers() {
        tauri::async_runtime::block_on(async {
            // Shares the process-wide slot, so only relative gaps are asserted.
            musicbrainz_throttle().await;
            let first = Instant::now();
            musicbrainz_throttle().await;
            assert!(first.elapsed() >= Duration::from_millis(1000));
        });
    }
}
