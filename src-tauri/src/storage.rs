use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

pub(crate) const STORAGE_SUBFOLDERS: [&str; 4] = ["lyrics_cache", "playlists", "artist_cache", "metadata_cache"];
const DB_FILE_NAME: &str = "amply_cache.db";

pub(crate) fn storage_root_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("storage"))
}

fn ensure_storage_dirs_blocking(root: &Path) -> Result<(), String> {
    for folder in STORAGE_SUBFOLDERS {
        fs::create_dir_all(root.join(folder)).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub(crate) async fn ensure_storage_dirs_async(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_path(app)?;
    let root_for_task = root.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_storage_dirs_blocking(&root_for_task))
        .await
        .map_err(|err| err.to_string())??;
    Ok(root)
}

/// Applies connection pragmas and creates the `kv` table. Safe to call on a fresh
/// in-memory connection (tests) as well as the on-disk database.
pub(crate) fn init_storage_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;
         CREATE TABLE IF NOT EXISTS kv (
            path TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
         );",
    )
    .map_err(|err| err.to_string())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Connection-level primitives (no AppHandle; unit-testable on an in-memory db)
// ---------------------------------------------------------------------------

pub(crate) fn read_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT value FROM kv WHERE path = ?1")
        .map_err(|err| err.to_string())?;
    stmt.query_row(params![key], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|err| err.to_string())
}

pub(crate) fn write_kv(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare_cached(
            "INSERT INTO kv (path, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .map_err(|err| err.to_string())?;
    stmt.execute(params![key, value, now_unix()])
        .map_err(|err| err.to_string())?;
    Ok(())
}

/// Inserts only when `key` is absent; an existing row is left untouched.
/// Returns `true` when a row was inserted.
pub(crate) fn insert_kv_if_absent(conn: &Connection, key: &str, value: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare_cached(
            "INSERT INTO kv (path, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO NOTHING",
        )
        .map_err(|err| err.to_string())?;
    let changed = stmt
        .execute(params![key, value, now_unix()])
        .map_err(|err| err.to_string())?;
    Ok(changed > 0)
}

pub(crate) fn delete_kv(conn: &Connection, key: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare_cached("DELETE FROM kv WHERE path = ?1")
        .map_err(|err| err.to_string())?;
    stmt.execute(params![key]).map_err(|err| err.to_string())?;
    Ok(())
}

/// Returns every `(path, value)` whose path starts with `prefix`, ordered by path.
pub(crate) fn read_kv_prefix(conn: &Connection, prefix: &str) -> Result<Vec<(String, String)>, String> {
    let upper = format!("{prefix}\u{10FFFF}");
    let mut stmt = conn
        .prepare_cached("SELECT path, value FROM kv WHERE path >= ?1 AND path < ?2 ORDER BY path")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![prefix, upper], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

/// Reads `key`; on a miss, imports the pre-sqlite on-disk file at `root/key`
/// (when `root` is given) and returns its content.
///
/// LEGACY: the on-disk backfill exists only to carry over caches written before
/// the sqlite store. It can be dropped after one release.
pub(crate) fn read_kv_backfilled(conn: &Connection, root: Option<&Path>, key: &str) -> Result<Option<String>, String> {
    if let Some(value) = read_kv(conn, key)? {
        return Ok(Some(value));
    }
    if let Some(root) = root {
        if let Ok(target) = resolve_relative_storage_path(root, key) {
            if let Ok(content) = fs::read_to_string(&target) {
                let _ = write_kv(conn, key, &content);
                return Ok(Some(content));
            }
        }
    }
    Ok(None)
}

// ---------------------------------------------------------------------------
// Managed state: one long-lived connection guarded by a mutex
// ---------------------------------------------------------------------------

pub(crate) struct StorageDb {
    conn: Mutex<Connection>,
    root: PathBuf,
}

impl StorageDb {
    pub(crate) fn open(root: PathBuf) -> Result<Self, String> {
        ensure_storage_dirs_blocking(&root)?;
        let conn = Connection::open(root.join(DB_FILE_NAME)).map_err(|err| err.to_string())?;
        init_storage_db(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            root,
        })
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    /// Runs `f` while holding the connection lock.
    pub(crate) fn with_conn<R>(&self, f: impl FnOnce(&Connection) -> Result<R, String>) -> Result<R, String> {
        let conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&conn)
    }

    pub(crate) fn read_blocking(&self, key: &str) -> Result<Option<String>, String> {
        self.with_conn(|conn| read_kv_backfilled(conn, Some(&self.root), key))
    }

    pub(crate) fn write_blocking(&self, key: &str, value: &str) -> Result<(), String> {
        self.with_conn(|conn| write_kv(conn, key, value))
    }

    pub(crate) fn delete_blocking(&self, key: &str) -> Result<(), String> {
        self.with_conn(|conn| delete_kv(conn, key))
    }

    pub(crate) fn read_prefix_blocking(&self, prefix: &str) -> Result<Vec<(String, String)>, String> {
        self.with_conn(|conn| read_kv_prefix(conn, prefix))
    }
}

pub(crate) fn storage_db(app: &tauri::AppHandle) -> Result<tauri::State<'_, StorageDb>, String> {
    app.try_state::<StorageDb>()
        .ok_or_else(|| "Storage database is not initialised".to_string())
}

// ---------------------------------------------------------------------------
// Async API used by the rest of the crate
// ---------------------------------------------------------------------------

pub(crate) async fn read_storage_kv(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    tauri::async_runtime::spawn_blocking(move || storage_db(&app_handle)?.read_blocking(&key))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn write_storage_kv(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    let value = content.to_string();
    tauri::async_runtime::spawn_blocking(move || storage_db(&app_handle)?.write_blocking(&key, &value))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn delete_storage_kv(app: &tauri::AppHandle, relative_path: &str) -> Result<(), String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    tauri::async_runtime::spawn_blocking(move || storage_db(&app_handle)?.delete_blocking(&key))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn read_storage_prefix(app: &tauri::AppHandle, prefix: &str) -> Result<Vec<(String, String)>, String> {
    let app_handle = app.clone();
    let prefix = prefix.to_string();
    tauri::async_runtime::spawn_blocking(move || storage_db(&app_handle)?.read_prefix_blocking(&prefix))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) fn resolve_relative_storage_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);

    if candidate.is_absolute() {
        return Err("Storage path must be relative".to_string());
    }

    for component in candidate.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Unsafe storage path".to_string());
        }
    }

    Ok(root.join(candidate))
}

pub(crate) fn resolve_storage_path(app: &tauri::AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    resolve_relative_storage_path(&storage_root_path(app)?, relative_path)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

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
        let db = storage_db(&app)?;
        db.with_conn(|conn| conn.execute_batch("DELETE FROM kv; VACUUM;").map_err(|err| err.to_string()))?;
        for folder in STORAGE_SUBFOLDERS {
            let target = db.root().join(folder);
            if target.exists() {
                fs::remove_dir_all(&target).map_err(|err| err.to_string())?;
            }
        }
        ensure_storage_dirs_blocking(db.root())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        init_storage_db(&conn).expect("init schema");
        conn
    }

    #[test]
    fn kv_upsert_read_delete_roundtrip() {
        let conn = memory_db();
        assert_eq!(read_kv(&conn, "a").unwrap(), None);

        write_kv(&conn, "a", "one").unwrap();
        assert_eq!(read_kv(&conn, "a").unwrap(), Some("one".to_string()));

        write_kv(&conn, "a", "two").unwrap();
        assert_eq!(read_kv(&conn, "a").unwrap(), Some("two".to_string()));

        assert!(!insert_kv_if_absent(&conn, "a", "three").unwrap());
        assert_eq!(read_kv(&conn, "a").unwrap(), Some("two".to_string()));
        assert!(insert_kv_if_absent(&conn, "b", "fresh").unwrap());
        assert_eq!(read_kv(&conn, "b").unwrap(), Some("fresh".to_string()));

        delete_kv(&conn, "a").unwrap();
        assert_eq!(read_kv(&conn, "a").unwrap(), None);
        delete_kv(&conn, "missing").unwrap();
    }

    #[test]
    fn prefix_scan_respects_bounds_and_orders_by_path() {
        let conn = memory_db();
        for (key, value) in [
            ("a/", "root"),
            ("a/2", "two"),
            ("a/1", "one"),
            ("a/1/x", "nested"),
            ("a.x", "before"),
            ("a0", "after"),
            ("b/1", "other"),
            ("a/\u{10FFFE}", "high"),
        ] {
            write_kv(&conn, key, value).unwrap();
        }

        let rows = read_kv_prefix(&conn, "a/").unwrap();
        let keys: Vec<&str> = rows.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["a/", "a/1", "a/1/x", "a/2", "a/\u{10FFFE}"]);
        assert_eq!(rows[1].1, "one");

        assert!(read_kv_prefix(&conn, "zzz/").unwrap().is_empty());
        assert_eq!(read_kv_prefix(&conn, "").unwrap().len(), 8);
    }

    #[test]
    fn backfill_without_root_is_plain_read() {
        let conn = memory_db();
        assert_eq!(read_kv_backfilled(&conn, None, "nope").unwrap(), None);
        write_kv(&conn, "k", "v").unwrap();
        assert_eq!(read_kv_backfilled(&conn, None, "k").unwrap(), Some("v".to_string()));
    }

    #[test]
    fn backfill_imports_legacy_on_disk_file_once() {
        let root = std::env::temp_dir().join(format!(
            "amply-storage-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(root.join("metadata_cache")).unwrap();
        let legacy_key = "metadata_cache/legacy.json";
        fs::write(root.join(legacy_key), "{\"from\":\"disk\"}").unwrap();

        let conn = memory_db();
        assert_eq!(read_kv(&conn, legacy_key).unwrap(), None);
        assert_eq!(
            read_kv_backfilled(&conn, Some(&root), legacy_key).unwrap().as_deref(),
            Some("{\"from\":\"disk\"}")
        );
        // Imported into kv, so later reads no longer need the file.
        assert_eq!(read_kv(&conn, legacy_key).unwrap().as_deref(), Some("{\"from\":\"disk\"}"));
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            read_kv_backfilled(&conn, Some(&root), legacy_key).unwrap().as_deref(),
            Some("{\"from\":\"disk\"}")
        );
        assert_eq!(read_kv_backfilled(&conn, Some(&root), "metadata_cache/absent").unwrap(), None);
        assert_eq!(read_kv_backfilled(&conn, Some(&root), "../escape").unwrap(), None);
    }

    #[test]
    fn relative_storage_path_rejects_traversal() {
        let root = Path::new("root");
        assert!(resolve_relative_storage_path(root, "../x").is_err());
        assert_eq!(
            resolve_relative_storage_path(root, "lyrics_cache/a.lrc").unwrap(),
            root.join("lyrics_cache").join("a.lrc")
        );
    }
}
