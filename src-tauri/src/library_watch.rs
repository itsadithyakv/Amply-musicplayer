//! Watches the library folders so songs added, changed, renamed or deleted while Amply runs show up
//! without a manual rescan. Change bursts (copying an album) are coalesced: the frontend hears
//! `amply://library-changed` once things go quiet, and its rescan is cheap because unchanged files
//! come from the scan index.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;

use crate::library::is_supported_audio;

/// Silence needed before a burst of changes counts as finished.
const QUIET: Duration = Duration::from_secs(3);
/// Longest a continuous stream of changes can postpone the notification.
const MAX_DELAY: Duration = Duration::from_secs(60);

#[derive(Default)]
pub(crate) struct LibraryWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Mutex<HashSet<PathBuf>>,
}

/// Whether an event can change the song list: audio files appearing, changing or going away, and
/// folders being renamed or removed (their songs go with them). Reads and attribute touches cannot.
fn is_relevant(event: &Event) -> bool {
    let kind_matters = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Data(_))
            | EventKind::Modify(notify::event::ModifyKind::Name(_)) | EventKind::Modify(notify::event::ModifyKind::Any)
    );
    kind_matters
        && event.paths.iter().any(|path| {
            is_supported_audio(path)
                // No extension: a folder (renamed, removed or created) that may hold songs.
                || path.extension().is_none()
        })
}

impl LibraryWatcher {
    /// Starts watching `roots` and the thread that turns change bursts into one event.
    pub(crate) fn start(app: tauri::AppHandle, roots: &[PathBuf]) -> Self {
        let (tx, rx) = mpsc::channel::<()>();
        let watcher = notify::recommended_watcher(move |result: notify::Result<Event>| match result {
            Ok(event) if is_relevant(&event) => {
                let _ = tx.send(());
            }
            Ok(_) => {}
            Err(error) => log::warn!("Library watcher error: {error}"),
        });
        let this = Self::default();
        match watcher {
            Ok(watcher) => *this.watcher.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(watcher),
            Err(error) => {
                log::warn!("Library folders will not be watched: {error}");
                return this;
            }
        }
        for root in roots {
            this.watch(root);
        }

        let spawned = std::thread::Builder::new().name("amply-library-watch".into()).spawn(move || {
            // Ends when the watcher (and with it the sender) is dropped at exit.
            while rx.recv().is_ok() {
                let first = Instant::now();
                loop {
                    let left = MAX_DELAY.saturating_sub(first.elapsed());
                    if left.is_zero() || rx.recv_timeout(QUIET.min(left)).is_err() {
                        break;
                    }
                }
                if let Err(error) = app.emit("amply://library-changed", ()) {
                    log::warn!("Failed to emit library-changed: {error}");
                }
            }
        });
        if let Err(error) = spawned {
            log::warn!("Library watcher thread failed to start: {error}");
        }
        this
    }

    /// Adds `root` to the watch list (idempotent). A folder that cannot be watched (a network share
    /// without notifications) still scans normally; it just does not update live.
    pub(crate) fn watch(&self, root: &Path) {
        let mut watched = self.watched.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if watched.contains(root) || !root.is_dir() {
            return;
        }
        let mut guard = self.watcher.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(watcher) = guard.as_mut() else {
            return;
        };
        match watcher.watch(root, RecursiveMode::Recursive) {
            Ok(()) => {
                watched.insert(root.to_path_buf());
            }
            Err(error) => log::warn!("Cannot watch {}: {error}", root.display()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, MetadataKind, ModifyKind};

    fn event(kind: EventKind, path: &str) -> Event {
        Event::new(kind).add_path(PathBuf::from(path))
    }

    #[test]
    fn only_song_and_folder_changes_count() {
        assert!(is_relevant(&event(EventKind::Create(CreateKind::File), "D:\\Music\\new.mp3")));
        assert!(is_relevant(&event(EventKind::Remove(notify::event::RemoveKind::Any), "D:\\Music\\Old Album")));
        assert!(!is_relevant(&event(EventKind::Create(CreateKind::File), "D:\\Music\\cover.jpg")));
        assert!(!is_relevant(&event(EventKind::Access(AccessKind::Any), "D:\\Music\\song.mp3")));
        assert!(!is_relevant(&event(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)), "D:\\Music\\song.mp3")));
    }
}
