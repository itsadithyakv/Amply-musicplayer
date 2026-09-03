use serde::{Deserialize, Serialize};

use crate::storage::{delete_storage_kv, read_storage_kv, resolve_storage_path, write_storage_kv};

pub(crate) async fn read_text(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    read_storage_kv(app, relative_path).await
}

pub(crate) async fn write_text(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    write_storage_kv(app, relative_path, content).await
}

pub(crate) async fn read_json<T: for<'de> Deserialize<'de>>(
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

pub(crate) async fn write_json<T: Serialize>(app: &tauri::AppHandle, relative_path: &str, value: &T) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    write_text(app, relative_path, &serialized).await
}

pub(crate) fn to_storage_cache_path(relative_path: &str) -> String {
    format!("storage/{}", relative_path.replace('\\', "/"))
}
