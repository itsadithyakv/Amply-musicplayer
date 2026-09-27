#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::mpsc;

use log::LevelFilter;
use tauri::image::Image;
use tauri::{Manager, WindowEvent};
use tauri_plugin_log::{Target, TargetKind};

mod artwork;
mod audio;
mod error;
mod files;
mod library;
mod library_watch;
mod metadata;
mod platform;
mod scan_index;
mod storage;

use audio::engine::{AudioCommand, AudioState};

fn main() {
    let (audio_tx, audio_rx) = mpsc::channel::<AudioCommand>();

    tauri::Builder::default()
        // Must be the first plugin: a second launch (autostart plus a manual start, a double-click on
        // the shortcut) hands off to the running player instead of opening a rival that fights it
        // for the audio device, the media keys and the mini player.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A file opened while Amply runs arrives as the second instance's arguments.
            let files = library::open_file_args(argv.into_iter().skip(1));
            if !files.is_empty() {
                use tauri::Emitter;
                if let Err(error) = app.emit("amply://open-files", files) {
                    log::warn!("Failed to forward opened files: {error}");
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("amply".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                // Decoder chatter about bit-reservoir underflow and bitrate-estimated durations is
                // routine for MP3s and drowns out the app's own warnings.
                .level_for("symphonia_bundle_mp3", LevelFilter::Error)
                .level_for("symphonia_core", LevelFilter::Error)
                .level_for("lofty", LevelFilter::Error)
                .level(if cfg!(debug_assertions) {
                    LevelFilter::Info
                } else {
                    LevelFilter::Warn
                })
                .build(),
        )
        // Reopen where the user left the main window: size, position and maximised state. The
        // first launch keeps the config's maximised window. The mini player places itself.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .with_denylist(&["overlay"])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        // Album art is served from the on-disk artwork store instead of travelling as base64.
        // Asynchronous: on Windows a synchronous handler runs on the UI thread, and the first request
        // for a thumbnail decodes and re-encodes it, which stuttered scrolling through big grids.
        .register_asynchronous_uri_scheme_protocol(artwork::SCHEME, |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || responder.respond(artwork::handle_request(&request)));
        })
        .manage(AudioState::new(audio_tx.clone()))
        .manage(library::PendingOpenFiles(std::sync::Mutex::new(library::open_file_args(std::env::args().skip(1)))))
        .setup(|app| {
            let storage_root = storage::storage_root_path(app.handle())?;
            artwork::init(&storage_root)?;
            app.manage(storage::StorageDb::open(storage_root)?);
            // Asset-protocol access to every known library folder must exist before the webview loads.
            let roots = library::restore_library_roots(app.handle());
            app.manage(library_watch::LibraryWatcher::start(app.handle().clone(), &roots.snapshot()));
            app.manage(roots);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = metadata::cache::migrate_legacy_blobs(&handle) {
                    log::error!("Failed to migrate legacy metadata caches: {error}");
                }
            });
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                if let Err(error) =
                    app.handle().plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
                {
                    log::error!("Failed to initialize autostart plugin: {error}");
                }
            }

            let window_icon = Image::from_bytes(include_bytes!("../icons/LogoAmply.png")).ok();
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = window_icon {
                    if let Err(error) = window.set_icon(icon) {
                        log::warn!("Failed to set window icon: {error}");
                    }
                }
            }

            platform::start_windows_audio_focus_watcher(app.handle().clone());
            platform::taskbar_init(app.handle());
            // Windows routes media keys to the active media session. The global keyboard hook is
            // only a fallback for when the system media controls cannot be created.
            if !platform::media_controls::init(app.handle()) {
                platform::start_windows_media_key_listener(app.handle().clone());
            }

            let app_handle = app.handle().clone();
            audio::spawn_audio_thread(app_handle, audio_rx);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::ensure_storage_dirs,
            storage::open_storage_dir,
            storage::clear_storage_cache,
            library::delete_song_file,
            library::pick_music_folders,
            storage::read_storage_file,
            storage::write_storage_file,
            library::scan_music,
            audio::commands::audio_preload,
            audio::commands::audio_load_song,
            audio::commands::audio_play,
            audio::commands::audio_play_from,
            audio::commands::audio_pause,
            audio::commands::audio_stop,
            audio::commands::audio_seek,
            audio::commands::audio_set_volume,
            audio::commands::audio_set_rate,
            audio::commands::audio_set_loop,
            audio::commands::audio_set_eq_gains,
            audio::commands::audio_set_visualizer_enabled,
            audio::commands::audio_set_output_device,
            audio::commands::audio_list_output_devices,
            audio::loudness::audio_track_loudness,
            library::load_embedded_artwork,
            metadata::artist::has_cached_artist_profile_rust,
            metadata::artist::has_cached_artist_profiles_rust,
            metadata::artist::read_cached_artist_profile_rust,
            metadata::artist::load_artist_profile_rust,
            metadata::artwork::load_track_artwork_rust,
            metadata::tracklist::load_album_tracklist_cache_rust,
            metadata::tracklist::load_album_tracklist_rust,
            metadata::genre::load_song_genre_cache_rust,
            metadata::genre::load_song_genre_rust,
            metadata::lyrics::lyrics_find_candidates_rust,
            metadata::lyrics::lyrics_save_selection_rust,
            metadata::lyrics::lyrics_load_rust,
            metadata::http::fetch_recommendation_json_rust,
            library::build_album_art_frequency_rust,
            library::take_open_files,
            library::probe_audio_files,
            library::write_song_tags,
            files::save_text_file,
            files::open_text_file,
            platform::store_review::is_store_install_rust,
            platform::store_review::request_store_review_rust,
            platform::media_controls::media_controls_update,
            platform::startup::startup_get_state,
            platform::startup::startup_set_enabled
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if window.label() == "overlay" {
                    return;
                }
                let app = window.app_handle();
                close_all_windows(app);
                app.exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build amply")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Stop helper threads before the process exits so hooks and COM are released.
                platform::shutdown();
                audio::shutdown(app);
            }
        });
}

fn close_all_windows(app: &tauri::AppHandle) {
    // destroy(), not close(): close() would re-enter this CloseRequested handler for every window.
    for (label, window) in app.webview_windows() {
        if let Err(error) = window.destroy() {
            log::warn!("Failed to close window {label}: {error}");
        }
    }
}
