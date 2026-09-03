use std::{collections::HashMap, path::Path};

use rusqlite::Connection;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::storage::{
    delete_kv, delete_storage_kv, insert_kv_if_absent, read_kv, read_kv_backfilled, read_storage_kv,
    read_storage_prefix, resolve_storage_path, storage_db, write_kv, write_storage_kv,
};

use super::{ALBUM_TRACKLIST_CACHE_PATH, SONG_GENRE_CACHE_PATH, TRACK_ARTWORK_CACHE_PATH};

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
            Err(error) => {
                log::warn!("Dropping unparsable JSON at {relative_path}: {error}");
                if resolve_storage_path(app, relative_path).is_ok() {
                    if let Err(error) = delete_storage_kv(app, relative_path).await {
                        log::warn!("Failed to delete {relative_path}: {error}");
                    }
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

// ---------------------------------------------------------------------------
// Per-key metadata caches
//
// Each entry lives in its own kv row: `<prefix><entry key>` with a compact JSON
// value. Before schema 2 the whole map was one JSON blob under the legacy path.
// ---------------------------------------------------------------------------

const METADATA_SCHEMA_MARKER_KEY: &str = "metadata_cache/_schema";
const METADATA_SCHEMA_VERSION: &str = "2";
/// Obsolete blob that was superseded by the per-track artwork cache.
const LEGACY_ALBUM_ART_BLOB_KEY: &str = "metadata_cache/album_art_cache.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CacheKind {
    TrackArtwork,
    AlbumTracklist,
    SongGenre,
}

impl CacheKind {
    pub(crate) const ALL: [CacheKind; 3] = [CacheKind::TrackArtwork, CacheKind::AlbumTracklist, CacheKind::SongGenre];

    pub(crate) fn prefix(&self) -> &'static str {
        match self {
            CacheKind::TrackArtwork => "metadata_cache/track_artwork/",
            CacheKind::AlbumTracklist => "metadata_cache/album_tracklist/",
            CacheKind::SongGenre => "metadata_cache/song_genre/",
        }
    }

    /// Path of the pre-schema-2 whole-map JSON blob.
    pub(crate) fn legacy_blob_path(&self) -> &'static str {
        match self {
            CacheKind::TrackArtwork => TRACK_ARTWORK_CACHE_PATH,
            CacheKind::AlbumTracklist => ALBUM_TRACKLIST_CACHE_PATH,
            CacheKind::SongGenre => SONG_GENRE_CACHE_PATH,
        }
    }

    fn entry_path(&self, key: &str) -> String {
        format!("{}{}", self.prefix(), key)
    }
}

pub(crate) async fn cache_get<T: DeserializeOwned>(
    app: &tauri::AppHandle,
    kind: CacheKind,
    key: &str,
) -> Result<Option<T>, String> {
    let path = kind.entry_path(key);
    let Some(text) = read_storage_kv(app, &path).await? else {
        return Ok(None);
    };
    match serde_json::from_str::<T>(&text) {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            log::warn!("Dropping unparsable cache entry {path}: {error}");
            if let Err(error) = delete_storage_kv(app, &path).await {
                log::warn!("Failed to delete cache entry {path}: {error}");
            }
            Ok(None)
        }
    }
}

pub(crate) async fn cache_put<T: Serialize>(
    app: &tauri::AppHandle,
    kind: CacheKind,
    key: &str,
    value: &T,
) -> Result<(), String> {
    let serialized = serde_json::to_string(value).map_err(|err| err.to_string())?;
    write_storage_kv(app, &kind.entry_path(key), &serialized).await
}

pub(crate) async fn cache_all<T: DeserializeOwned>(
    app: &tauri::AppHandle,
    kind: CacheKind,
) -> Result<HashMap<String, T>, String> {
    let prefix = kind.prefix();
    let rows = read_storage_prefix(app, prefix).await?;
    let mut map = HashMap::with_capacity(rows.len());
    for (path, text) in rows {
        let Some(key) = path.strip_prefix(prefix) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<T>(&text) {
            map.insert(key.to_string(), value);
        }
    }
    Ok(map)
}

/// Splits the legacy whole-map blobs into per-key rows. Idempotent; guarded by
/// the `metadata_cache/_schema` marker. Existing per-key rows are never
/// overwritten. `root` enables the on-disk legacy backfill for the blob keys.
pub(crate) fn migrate_legacy_blobs_blocking(conn: &Connection, root: Option<&Path>) -> Result<(), String> {
    if read_kv(conn, METADATA_SCHEMA_MARKER_KEY)?.as_deref() == Some(METADATA_SCHEMA_VERSION) {
        return Ok(());
    }

    for kind in CacheKind::ALL {
        let blob_key = kind.legacy_blob_path();
        let Some(text) = read_kv_backfilled(conn, root, blob_key)? else {
            continue;
        };
        match serde_json::from_str::<HashMap<String, serde_json::Value>>(&text) {
            Ok(entries) => {
                let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
                for (key, value) in &entries {
                    let serialized = serde_json::to_string(value).map_err(|err| err.to_string())?;
                    insert_kv_if_absent(&tx, &kind.entry_path(key), &serialized)?;
                }
                tx.commit().map_err(|err| err.to_string())?;
                delete_kv(conn, blob_key)?;
            }
            Err(_) => {
                // Corrupt blob: nothing recoverable, drop it.
                delete_kv(conn, blob_key)?;
            }
        }
    }

    delete_kv(conn, LEGACY_ALBUM_ART_BLOB_KEY)?;
    write_kv(conn, METADATA_SCHEMA_MARKER_KEY, METADATA_SCHEMA_VERSION)
}

pub(crate) fn migrate_legacy_blobs(app: &tauri::AppHandle) -> Result<(), String> {
    let db = storage_db(app)?;
    db.with_conn(|conn| migrate_legacy_blobs_blocking(conn, Some(db.root())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::SongGenreCacheEntry;
    use crate::storage::{init_storage_db, read_kv_prefix};

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        init_storage_db(&conn).expect("init schema");
        conn
    }

    fn genre_entry(conn: &Connection, key: &str) -> Option<SongGenreCacheEntry> {
        read_kv(conn, &CacheKind::SongGenre.entry_path(key))
            .unwrap()
            .map(|text| serde_json::from_str(&text).unwrap())
    }

    #[test]
    fn cache_kind_prefixes_are_distinct_and_slash_terminated() {
        for kind in CacheKind::ALL {
            assert!(kind.prefix().ends_with('/'));
            assert!(kind.prefix().starts_with("metadata_cache/"));
        }
        assert_ne!(CacheKind::TrackArtwork.prefix(), CacheKind::SongGenre.prefix());
        assert_eq!(CacheKind::SongGenre.entry_path("a--b"), "metadata_cache/song_genre/a--b");
    }

    #[test]
    fn migration_splits_blobs_without_overwriting_and_is_idempotent() {
        let conn = memory_db();
        write_kv(
            &conn,
            SONG_GENRE_CACHE_PATH,
            r#"{"a--b":{"genre":"Pop","fetchedAt":1},"c--d":{"genre":"Rock","fetchedAt":2}}"#,
        )
        .unwrap();
        // Newer per-key row that must survive the migration untouched.
        write_kv(
            &conn,
            &CacheKind::SongGenre.entry_path("c--d"),
            r#"{"genre":"Jazz","fetchedAt":3}"#,
        )
        .unwrap();
        write_kv(
            &conn,
            TRACK_ARTWORK_CACHE_PATH,
            r#"{"x--y":"data:image/jpeg;base64,AAAA"}"#,
        )
        .unwrap();
        write_kv(&conn, ALBUM_TRACKLIST_CACHE_PATH, "definitely not json").unwrap();
        write_kv(&conn, LEGACY_ALBUM_ART_BLOB_KEY, "{}").unwrap();

        migrate_legacy_blobs_blocking(&conn, None).unwrap();

        let migrated = genre_entry(&conn, "a--b").expect("a--b migrated");
        assert_eq!(migrated.genre, "Pop");
        assert_eq!(migrated.fetched_at, 1);
        let kept = genre_entry(&conn, "c--d").expect("c--d present");
        assert_eq!(kept.genre, "Jazz");
        assert_eq!(kept.fetched_at, 3);

        let artwork = read_kv(&conn, &CacheKind::TrackArtwork.entry_path("x--y")).unwrap();
        assert_eq!(artwork.as_deref(), Some(r#""data:image/jpeg;base64,AAAA""#));
        assert_eq!(
            serde_json::from_str::<String>(artwork.as_deref().unwrap()).unwrap(),
            "data:image/jpeg;base64,AAAA"
        );

        assert_eq!(read_kv(&conn, SONG_GENRE_CACHE_PATH).unwrap(), None);
        assert_eq!(read_kv(&conn, TRACK_ARTWORK_CACHE_PATH).unwrap(), None);
        assert_eq!(read_kv(&conn, ALBUM_TRACKLIST_CACHE_PATH).unwrap(), None);
        assert_eq!(read_kv(&conn, LEGACY_ALBUM_ART_BLOB_KEY).unwrap(), None);
        assert!(read_kv_prefix(&conn, CacheKind::AlbumTracklist.prefix()).unwrap().is_empty());
        assert_eq!(
            read_kv(&conn, METADATA_SCHEMA_MARKER_KEY).unwrap().as_deref(),
            Some(METADATA_SCHEMA_VERSION)
        );

        // Second run is a no-op: a freshly written blob is left alone.
        write_kv(&conn, SONG_GENRE_CACHE_PATH, r#"{"e--f":{"genre":"Folk","fetchedAt":9}}"#).unwrap();
        migrate_legacy_blobs_blocking(&conn, None).unwrap();
        assert!(read_kv(&conn, SONG_GENRE_CACHE_PATH).unwrap().is_some());
        assert!(genre_entry(&conn, "e--f").is_none());
        assert_eq!(read_kv_prefix(&conn, CacheKind::SongGenre.prefix()).unwrap().len(), 2);
    }

    #[test]
    fn migration_on_empty_db_only_writes_marker() {
        let conn = memory_db();
        migrate_legacy_blobs_blocking(&conn, None).unwrap();
        let rows = read_kv_prefix(&conn, "").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, METADATA_SCHEMA_MARKER_KEY);
    }
}
