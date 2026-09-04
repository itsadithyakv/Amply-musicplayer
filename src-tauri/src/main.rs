#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::mpsc;

use log::LevelFilter;
use tauri::image::Image;
use tauri::{Manager, WindowEvent};
use tauri_plugin_log::{Target, TargetKind};

mod artwork;
mod audio;
mod error;
mod library;
mod metadata;
mod platform;
mod storage;

use audio::engine::{AudioCommand, AudioState};

fn main() {
    let (audio_tx, audio_rx) = mpsc::channel::<AudioCommand>();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("amply".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .level(if cfg!(debug_assertions) {
                    LevelFilter::Info
                } else {
                    LevelFilter::Warn
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        // Album art is served from the on-disk artwork store instead of travelling as base64.
        .register_uri_scheme_protocol(artwork::SCHEME, |_ctx, request| artwork::handle_request(&request))
        .manage(AudioState::new(audio_tx.clone()))
        .setup(|app| {
            let storage_root = storage::storage_root_path(app.handle())?;
            artwork::init(&storage_root)?;
            app.manage(storage::StorageDb::open(storage_root)?);
            // Asset-protocol access to every known library folder must exist before the webview loads.
            app.manage(library::restore_library_roots(app.handle()));

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
            platform::start_windows_media_key_listener(app.handle().clone());

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
            library::load_embedded_artwork,
            metadata::has_cached_artist_profile_rust,
            metadata::has_cached_artist_profiles_rust,
            metadata::read_cached_artist_profile_rust,
            metadata::load_artist_profile_rust,
            metadata::load_track_artwork_rust,
            metadata::load_album_tracklist_cache_rust,
            metadata::load_album_tracklist_rust,
            metadata::load_song_genre_cache_rust,
            metadata::load_song_genre_rust,
            metadata::lyrics_find_candidates_rust,
            metadata::lyrics_read_cached_rust,
            metadata::lyrics_save_selection_rust,
            metadata::lyrics_load_rust,
            library::build_album_art_frequency_rust
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
    for (label, window) in app.webview_windows() {
        if let Err(error) = window.close() {
            log::warn!("Failed to close window {label}: {error}");
        }
    }
}
