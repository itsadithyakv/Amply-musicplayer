//! Save and open dialogs for text files the user exchanges with Amply: playlists (.m3u8) and
//! backups (.json). The user picks the location in a native dialog, so nothing is read or written
//! anywhere they did not choose.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::error::{AmplyError, AmplyResult};

/// Larger files are not playlists or backups Amply wrote; refuse them rather than load them whole.
const MAX_OPEN_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedTextFile {
    pub path: String,
    pub content: String,
}

fn dialog(title: &str, filter_name: &str, extensions: &[String]) -> rfd::FileDialog {
    let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
    rfd::FileDialog::new().set_title(title).add_filter(filter_name, &extensions)
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> AmplyResult<T> + Send + 'static) -> AmplyResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| AmplyError::Other(err.to_string()))?
}

/// Asks where to save `content` and writes it there. Returns the path, or None when cancelled.
#[tauri::command]
pub async fn save_text_file(
    title: String,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    content: String,
) -> AmplyResult<Option<String>> {
    blocking(move || {
        let Some(path) = dialog(&title, &filter_name, &extensions).set_file_name(&default_name).save_file() else {
            return Ok(None);
        };
        fs::write(&path, content.as_bytes()).map_err(|err| AmplyError::Other(format!("{}: {err}", path.display())))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

/// Asks for a file to open and returns its text. None when cancelled.
#[tauri::command]
pub async fn open_text_file(title: String, filter_name: String, extensions: Vec<String>) -> AmplyResult<Option<OpenedTextFile>> {
    blocking(move || {
        let Some(path): Option<PathBuf> = dialog(&title, &filter_name, &extensions).pick_file() else {
            return Ok(None);
        };
        let size = fs::metadata(&path).map_err(|err| AmplyError::Other(err.to_string()))?.len();
        if size > MAX_OPEN_BYTES {
            return Err(AmplyError::InvalidInput(format!("{} is too large ({size} bytes)", path.display())));
        }
        let bytes = fs::read(&path).map_err(|err| AmplyError::Other(err.to_string()))?;
        // Playlists from other players are often in the system code page; keep what decodes.
        let content = String::from_utf8(bytes).unwrap_or_else(|err| String::from_utf8_lossy(err.as_bytes()).into_owned());
        Ok(Some(OpenedTextFile { path: path.to_string_lossy().into_owned(), content }))
    })
    .await
}
