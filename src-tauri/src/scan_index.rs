//! Per-file scan cache. A rescan stats every file but only re-reads tags and artwork for files whose
//! size or modification time changed since the last scan; everything else comes back from here.
//! Unchanged folders therefore rescan in a fraction of the time, and a OneDrive folder is not forced
//! to download every song just to be listed again.
//!
//! Rows are keyed by the file's full path and hold the scanned song as JSON. Bumping
//! `SCAN_INDEX_VERSION` makes every row stale, for when the scanner starts reading something new.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection};

/// Bump when `scan_one` changes what it extracts. v2: album artist and ReplayGain track/album.
pub(crate) const SCAN_INDEX_VERSION: i64 = 2;

/// What decides whether a file changed: its size and last-write time (ms).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Stamp {
    pub modified_ms: i64,
    pub size: i64,
}

impl Stamp {
    pub(crate) fn of(metadata: &fs::Metadata) -> Self {
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        Self { modified_ms, size: metadata.len() as i64 }
    }
}

pub(crate) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scan_index (
            path TEXT PRIMARY KEY,
            modified_ms INTEGER NOT NULL,
            size INTEGER NOT NULL,
            version INTEGER NOT NULL,
            song TEXT NOT NULL
         );",
    )
    .map_err(|err| err.to_string())
}

pub(crate) fn clear(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM scan_index", []).map_err(|err| err.to_string()).map(|_| ())
}

/// Current-version rows for files under `root` (a path prefix), keyed by path.
pub(crate) fn load_under(conn: &Connection, root: &str) -> Result<HashMap<String, (Stamp, String)>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT path, modified_ms, size, song FROM scan_index
             WHERE version = ?1 AND substr(path, 1, length(?2)) = ?2",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![SCAN_INDEX_VERSION, root], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Stamp { modified_ms: row.get(1)?, size: row.get(2)? },
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|err| err.to_string())?;
    let mut entries = HashMap::new();
    for row in rows {
        let (path, stamp, song) = row.map_err(|err| err.to_string())?;
        entries.insert(path, (stamp, song));
    }
    Ok(entries)
}

/// Stores freshly scanned files and forgets files under `root` that are no longer on disk, in one
/// transaction so an interrupted scan leaves the previous index intact.
pub(crate) fn apply(
    conn: &Connection,
    root: &str,
    upserts: &[(String, Stamp, String)],
    present: &HashSet<String>,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    {
        let mut upsert = tx
            .prepare_cached(
                "INSERT INTO scan_index (path, modified_ms, size, version, song) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET modified_ms = ?2, size = ?3, version = ?4, song = ?5",
            )
            .map_err(|err| err.to_string())?;
        for (path, stamp, song) in upserts {
            upsert
                .execute(params![path, stamp.modified_ms, stamp.size, SCAN_INDEX_VERSION, song])
                .map_err(|err| err.to_string())?;
        }

        let mut known = tx
            .prepare_cached("SELECT path FROM scan_index WHERE substr(path, 1, length(?1)) = ?1")
            .map_err(|err| err.to_string())?;
        let gone: Vec<String> = known
            .query_map(params![root], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?
            .filter_map(Result::ok)
            .filter(|path| !present.contains(path))
            .collect();
        let mut delete = tx.prepare_cached("DELETE FROM scan_index WHERE path = ?1").map_err(|err| err.to_string())?;
        for path in gone {
            delete.execute(params![path]).map_err(|err| err.to_string())?;
        }
    }
    tx.commit().map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn
    }

    fn stamp(size: i64) -> Stamp {
        Stamp { modified_ms: 1_000, size }
    }

    #[test]
    fn stores_reads_back_and_forgets_deleted_files() {
        let conn = db();
        let root = "D:\\Music";
        let a = "D:\\Music\\a.mp3".to_string();
        let b = "D:\\Music\\b.mp3".to_string();
        apply(&conn, root, &[(a.clone(), stamp(10), "{\"a\":1}".into()), (b.clone(), stamp(20), "{}".into())], &HashSet::from([a.clone(), b.clone()]))
            .unwrap();
        let loaded = load_under(&conn, root).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[&a], (stamp(10), "{\"a\":1}".to_string()));

        // b.mp3 was deleted: the next scan's apply forgets it.
        apply(&conn, root, &[], &HashSet::from([a.clone()])).unwrap();
        assert_eq!(load_under(&conn, root).unwrap().len(), 1);
    }

    #[test]
    fn roots_do_not_see_each_other() {
        let conn = db();
        apply(&conn, "D:\\Music", &[("D:\\Music\\a.mp3".into(), stamp(1), "{}".into())], &HashSet::from(["D:\\Music\\a.mp3".to_string()]))
            .unwrap();
        apply(&conn, "E:\\Other", &[], &HashSet::new()).unwrap();
        assert_eq!(load_under(&conn, "D:\\Music").unwrap().len(), 1);
        assert!(load_under(&conn, "E:\\Other").unwrap().is_empty());
    }

    #[test]
    fn old_version_rows_are_ignored() {
        let conn = db();
        conn.execute(
            "INSERT INTO scan_index (path, modified_ms, size, version, song) VALUES ('D:\\Music\\a.mp3', 1, 1, 0, '{}')",
            [],
        )
        .unwrap();
        assert!(load_under(&conn, "D:\\Music").unwrap().is_empty());
    }
}
