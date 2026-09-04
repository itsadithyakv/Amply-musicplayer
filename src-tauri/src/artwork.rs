//! On-disk artwork store served to the webview through the `amplyart` custom URI scheme.
//!
//! Album art used to travel as a base64 `data:` URL inside every `Song` record, which meant the
//! persisted library JSON, every IPC scan response and the in-memory store all carried a copy of
//! each cover per track. The store keeps one resized JPEG per distinct picture under
//! `<storage>/artwork/<content-hash>.jpg` and hands out a short URL instead; the webview loads it
//! like any other image (cached by the browser, decoded off the main thread).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::FilterType;
use image::GenericImageView;
use tauri::http::{header, Request, Response, StatusCode};

pub(crate) const SCHEME: &str = "amplyart";
const MAX_EDGE: u32 = 320;
const JPEG_QUALITY: u8 = 76;

static ARTWORK_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Create the artwork folder and remember it for the rest of the process.
pub(crate) fn init(storage_root: &Path) -> Result<(), String> {
    let dir = storage_root.join("artwork");
    fs::create_dir_all(&dir).map_err(|err| format!("create artwork dir: {err}"))?;
    let _ = ARTWORK_DIR.set(dir);
    Ok(())
}

fn dir() -> Option<&'static Path> {
    ARTWORK_DIR.get().map(PathBuf::as_path)
}

/// The URL the webview uses for a stored picture. Windows WebView2 maps custom schemes onto
/// `http://<scheme>.localhost`, other platforms use `<scheme>://localhost`.
pub(crate) fn artwork_url(key: &str) -> String {
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{key}.jpg")
    } else {
        format!("{SCHEME}://localhost/{key}.jpg")
    }
}

/// FNV-1a over the bytes plus the length — stable, dependency-free, and collisions are
/// irrelevant at library scale (a collision would only swap two covers).
fn content_key(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}{:08x}", bytes.len() as u32)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("jpg.tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|err| err.to_string())?;
        file.write_all(bytes).map_err(|err| err.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|err| err.to_string())
}

/// Resize an arbitrary picture to a `MAX_EDGE` JPEG, store it, and return its URL.
/// Re-encoding is skipped when the same source bytes were stored before.
pub(crate) fn store_picture(bytes: &[u8]) -> Option<String> {
    let dir = dir()?;
    let key = content_key(bytes);
    let file = dir.join(format!("{key}.jpg"));
    if file.exists() {
        return Some(artwork_url(&key));
    }

    let image = image::load_from_memory(bytes).ok()?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return None;
    }
    let resized = if width.max(height) > MAX_EDGE {
        image.resize(MAX_EDGE, MAX_EDGE, FilterType::Triangle)
    } else {
        image
    };
    let mut buffer = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, JPEG_QUALITY);
    encoder.encode_image(&resized).ok()?;
    if let Err(error) = write_atomic(&file, &buffer) {
        log::warn!("Failed to store artwork {key}: {error}");
        return None;
    }
    Some(artwork_url(&key))
}

/// Store an already-encoded JPEG (e.g. one produced by a previous version or a metadata fetch).
pub(crate) fn store_encoded_jpeg(bytes: &[u8]) -> Option<String> {
    let dir = dir()?;
    let key = content_key(bytes);
    let file = dir.join(format!("{key}.jpg"));
    if !file.exists() {
        if let Err(error) = write_atomic(&file, bytes) {
            log::warn!("Failed to store artwork {key}: {error}");
            return None;
        }
    }
    Some(artwork_url(&key))
}

/// Turn a legacy `data:image/...;base64,...` string into a stored file URL.
/// Anything that is not a data URL is returned unchanged.
pub(crate) fn migrate_data_url(value: &str) -> String {
    let Some(comma) = value.find(',') else {
        return value.to_string();
    };
    if !value.starts_with("data:image/") {
        return value.to_string();
    }
    let Ok(bytes) = BASE64_STANDARD.decode(value[comma + 1..].trim()) else {
        return value.to_string();
    };
    let stored = if value.starts_with("data:image/jpeg") {
        store_encoded_jpeg(&bytes)
    } else {
        store_picture(&bytes)
    };
    stored.unwrap_or_else(|| value.to_string())
}

/// Serve `/<hex>.jpg` from the artwork folder. Anything else is a 404.
pub(crate) fn handle_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path().trim_start_matches('/');
    let key = path.strip_suffix(".jpg").unwrap_or("");
    let valid = !key.is_empty() && key.len() <= 32 && key.bytes().all(|b| b.is_ascii_hexdigit());
    let file = dir().filter(|_| valid).map(|dir| dir.join(format!("{key}.jpg")));
    match file.and_then(|file| fs::read(file).ok()) {
        Some(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(bytes)
            .unwrap_or_else(|_| Response::new(Vec::new())),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("amply-artwork-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn content_key_is_stable_and_hex() {
        let a = content_key(b"hello");
        assert_eq!(a, content_key(b"hello"));
        assert_ne!(a, content_key(b"hellp"));
        assert!(a.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(a.len(), 24);
    }

    #[test]
    fn stores_and_serves_a_picture_once() {
        let root = temp_root("store");
        init(&root).unwrap();
        // A 2x2 red PNG.
        let mut png = Vec::new();
        image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let url = store_picture(&png).expect("stored");
        assert!(url.contains(SCHEME));
        let again = store_picture(&png).unwrap();
        assert_eq!(url, again);

        let key = url.rsplit('/').next().unwrap().trim_end_matches(".jpg").to_string();
        let request = Request::builder().uri(format!("{SCHEME}://localhost/{key}.jpg")).body(Vec::new()).unwrap();
        let response = handle_request(&request);
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.body().is_empty());

        let bad = Request::builder().uri(format!("{SCHEME}://localhost/../etc.jpg")).body(Vec::new()).unwrap();
        assert_eq!(handle_request(&bad).status(), StatusCode::NOT_FOUND);

        let data_url = format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&png));
        assert_eq!(migrate_data_url(&data_url), url);
        assert_eq!(migrate_data_url("https://example.com/a.jpg"), "https://example.com/a.jpg");
        let _ = fs::remove_dir_all(root);
    }
}
