use std::{sync::LazyLock, time::Duration};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use reqwest::Url;
use serde::Deserialize;
use tokio::sync::Mutex;

use super::normalize::{get_primary_artist_name, is_artist_close_match, is_close_match, is_exact_match};
use super::{SongInput, METADATA_USER_AGENT};

static MB_LAST_REQUEST: LazyLock<Mutex<Option<std::time::Instant>>> = LazyLock::new(|| Mutex::new(None));

pub(crate) async fn musicbrainz_throttle() {
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

pub(crate) async fn fetch_json<T: for<'de> Deserialize<'de>>(url: Url, user_agent: Option<&str>) -> Result<T, String> {
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
    let b64 = BASE64_STANDARD.encode(buffer);
    Some(format!("data:image/jpeg;base64,{b64}"))
}

pub(crate) async fn fetch_image_data_url(url: &str) -> Result<Option<String>, String> {
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
}
