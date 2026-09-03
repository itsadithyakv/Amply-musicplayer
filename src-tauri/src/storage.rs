use std::{
    fs,
    path::{Component, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::fs as async_fs;

pub(crate) fn storage_root_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("storage"))
}

pub(crate) fn storage_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(storage_root_path(app)?.join("amply_cache.db"))
}

fn ensure_storage_dirs_blocking(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_path(app)?;
    fs::create_dir_all(root.join("lyrics_cache")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("playlists")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("artist_cache")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("metadata_cache")).map_err(|err| err.to_string())?;
    Ok(root)
}

pub(crate) async fn ensure_storage_dirs_async(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_path(app)?;
    async_fs::create_dir_all(root.join("lyrics_cache"))
        .await
        .map_err(|err| err.to_string())?;
    async_fs::create_dir_all(root.join("playlists"))
        .await
        .map_err(|err| err.to_string())?;
    async_fs::create_dir_all(root.join("artist_cache"))
        .await
        .map_err(|err| err.to_string())?;
    async_fs::create_dir_all(root.join("metadata_cache"))
        .await
        .map_err(|err| err.to_string())?;
    Ok(root)
}

fn init_storage_db(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv (
            path TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn read_storage_kv_blocking(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    let _ = ensure_storage_dirs_blocking(app)?;
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE path = ?1")
        .map_err(|err| err.to_string())?;
    let mut rows = stmt.query(params![relative_path]).map_err(|err| err.to_string())?;
    if let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let value: String = row.get(0).map_err(|err| err.to_string())?;
        Ok(Some(value))
    } else {
        // Backfill from legacy file cache if present.
        if let Ok(target) = resolve_storage_path(app, relative_path) {
            if let Ok(content) = fs::read_to_string(&target) {
                let _ = write_storage_kv_blocking(app, relative_path, &content);
                return Ok(Some(content));
            }
        }
        Ok(None)
    }
}

fn write_storage_kv_blocking(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    let _ = ensure_storage_dirs_blocking(app)?;
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO kv (path, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![relative_path, content, now],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn delete_storage_kv_blocking(app: &tauri::AppHandle, relative_path: &str) -> Result<(), String> {
    let _ = ensure_storage_dirs_blocking(app)?;
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    conn.execute("DELETE FROM kv WHERE path = ?1", params![relative_path])
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn read_storage_kv(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    tauri::async_runtime::spawn_blocking(move || read_storage_kv_blocking(&app_handle, &key))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn write_storage_kv(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    let value = content.to_string();
    tauri::async_runtime::spawn_blocking(move || write_storage_kv_blocking(&app_handle, &key, &value))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn delete_storage_kv(app: &tauri::AppHandle, relative_path: &str) -> Result<(), String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    tauri::async_runtime::spawn_blocking(move || delete_storage_kv_blocking(&app_handle, &key))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) fn resolve_storage_path(app: &tauri::AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);

    if candidate.is_absolute() {
        return Err("Storage path must be relative".to_string());
    }

    for component in candidate.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Unsafe storage path".to_string());
        }
    }

    Ok(storage_root_path(app)?.join(candidate))
}

#[tauri::command]
pub async fn ensure_storage_dirs(app: tauri::AppHandle) -> Result<String, String> {
    let root = ensure_storage_dirs_async(&app).await?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_storage_dir(app: tauri::AppHandle) -> Result<(), String> {
    let root = ensure_storage_dirs_async(&app).await?;
    let target = root.to_string_lossy().to_string();
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn clear_storage_cache(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = storage_db_path(&app)?;
        if db_path.exists() {
            let conn = Connection::open(&db_path).map_err(|err| err.to_string())?;
            init_storage_db(&conn)?;
            let _ = conn.execute("DELETE FROM kv", []);
        }
        let root = ensure_storage_dirs_blocking(&app)?;
        for folder in ["lyrics_cache", "playlists", "artist_cache", "metadata_cache"] {
            let target = root.join(folder);
            if target.exists() {
                let _ = fs::remove_dir_all(&target);
            }
        }
        let _ = ensure_storage_dirs_blocking(&app)?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn read_storage_file(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<Option<String>, String> {
    read_storage_kv(&app, &relative_path).await
}

#[tauri::command]
pub async fn write_storage_file(
    app: tauri::AppHandle,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    write_storage_kv(&app, &relative_path, &content).await
}
