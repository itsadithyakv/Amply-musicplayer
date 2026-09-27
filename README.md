# Amply

An offline-first desktop music player for local libraries. Amply scans the folders you point it at,
builds smart mixes from how you actually listen, fetches artwork, lyrics, genres and artist
biographies from the open web, and plays everything through a native Rust audio engine — all in a
soft neumorphic interface with light and dark themes.

Nothing about your library leaves the machine except the metadata lookups you can switch off.

- **Runtime**: Tauri 2 (WebView2 on Windows), React 18 + TypeScript frontend, Rust backend
- **Version**: 1.7.0
- **Platform**: Windows (the audio and metadata layers are portable; the focus watcher and media-key
  hook are Windows-only and compile to no-ops elsewhere)

## Contents

- [Feature catalogue](#feature-catalogue) — what the app does and where each part lives
- [Architecture](#architecture) — process model, state, storage, IPC
- [Audio pipeline](#audio-pipeline)
- [Smart mix engine](#smart-mix-engine)
- [Metadata pipeline](#metadata-pipeline)
- [Design system](#design-system)
- [Performance](#performance)
- [Security model](#security-model)
- [Development](#development)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Feature catalogue

### Library

| Feature | How it is built |
|---|---|
| Folder scanning with incremental merge | `scan_music` in `src-tauri/src/library.rs` walks the roots with `walkdir` and reads tags in parallel (`scan_folder_blocking` → `scan_one`). Results merge into the cached library rather than replacing it, so play counts and favourites survive a rescan. |
| Tag reading | `lofty` 0.25 — title, artist, album, genre, track number, recording date, duration, and the embedded cover picture. Missing titles fall back to the filename. |
| Supported formats | mp3, flac, wav, ogg/vorbis, m4a/aac (symphonia decoders, declared in `Cargo.toml`). Extensions without a decoder are not listed as supported. |
| Multiple library folders | Roots are picked with a native dialog (`rfd`), canonicalised with `dunce`, and persisted to `library/roots.json`. Each scanned root is added to the asset-protocol scope so the webview may read from it. |
| Album art extraction | The first `CoverFront` picture (or the first picture of any tag) is decoded, resized to fit 320 px, re-encoded as JPEG at quality 76 and written once per distinct cover into the artwork store. |
| Library views | Songs / Albums / Artists / Genres tabs in `src/pages/Library/`, virtualised with `react-window`. The artists tab prefers the cached artist photo over an album cover (`useArtistImage`). |
| Search | `filterAndRankSongs` in `src/utils/search.ts`, debounced 120 ms over a structural snapshot of the library so a play or a favourite does not re-run it. Empty query browses the whole library. |
| Favourites, play counts, skip tracking | Stored per song in `playlists/song_activity.json` and merged into the in-memory library. |
| Delete from disk | `delete_song_file` canonicalises the path and refuses anything outside a registered library root. |

### Playback

| Feature | How it is built |
|---|---|
| Native audio engine | `rodio` 0.22 on a dedicated thread that owns the output device and the sink; the frontend talks to it through `audio_*` Tauri commands and a `mpsc` channel. |
| Gapless / preloading | `audio_preload` reads whole files into `Arc<[u8]>` and every decoder built from one shares that buffer, so queueing the next track costs no copy. |
| Crossfade | Two sinks with a linear volume ramp (`fade_in` / `fade_out` in `NativeAudio`), duration configurable 1–20 s. Mutually exclusive with gapless. |
| 5-band EQ | Biquad peaking filters at 60 Hz, 250 Hz, 1 kHz, 4 kHz, 12 kHz (`src-tauri/src/audio/dsp.rs`), ±12 dB. Gains live in atomics, so dragging a band re-computes coefficients in place without rebuilding the sink. Presets: flat, warm, bass, treble, vocal, club, custom. |
| Playback speed | `SharedSpeed`, a rate-aware wrapper that reads an atomic factor. Changing speed folds the current position first, so the progress bar stays truthful at 0.5×–2×. |
| Seeking | `Sink::try_seek` through the whole DSP chain (each stage implements `try_seek` and resets its filter state), with a decode-and-discard fallback if a container refuses. |
| Output device selection | `audio_list_output_devices` enumerates cpal devices; switching rebuilds the stream and resumes at the same position. |
| Queue, shuffle, repeat | `src/store/playerStore.ts`. Shuffle is a seeded Fisher–Yates (`src/utils/random.ts`) so the order is reproducible; repeat loops the current track by queueing a second copy rather than using `repeat_infinite` (which would buffer the whole decoded song). |
| Sleep timer | Countdown with auto-stop, in `src/pages/Settings/SleepTimerSection.tsx`. |
| Spectrum analyser | `SpectrumSource` taps the signal, splits it into 8 bands and publishes smoothed levels into atomics; the audio thread emits `amply://audio-spectrum` at 20 Hz while playing and the visualizer is enabled. |
| Playback recording | A play counts once it reaches 30 s or half the track (`QUALIFIED_PLAY_SEC`), a natural finish records exactly once, and any session under 60 % of the duration records a skip with its position. This feeds the mix engine. |

### Smart mixes

Up to ~30 playlists are generated locally from your listening history. See
[Smart mix engine](#smart-mix-engine) for the rules.

| Feature | How it is built |
|---|---|
| Core mixes | Daily Mix, On Repeat, Recently Played, Recently Added, Most Played, Rediscover, Favorites, Loved & Played, Quick Hits, Long Sessions, Deep Cuts, Explore. |
| Genre and mood mixes | Up to 8 genre mixes and up to 12 mood mixes, sized to the library. |
| Runs off the main thread | `src/workers/mixEngine.worker.ts` behind `mixEngineClient.ts`; a "lite" pass regenerates only the five time-sensitive mixes after a play. |
| Determinism | Seeded from the ISO week and the day, so mixes are stable within a period. Manual regeneration bumps a nonce that reseeds everything. |
| Anti-repeat | 14 days of per-mix history in `playlists/mix_history.json`; Explore never repeats a song it showed in the last 7 days, and the Daily Mix keeps at most 20 % of yesterday. |
| Custom playlists | Created and reordered with `@dnd-kit`, persisted to `playlists/custom_playlists.json`. |

### Metadata and lyrics

| Feature | How it is built |
|---|---|
| Time-synced lyrics | LRCLIB search and fetch in `src-tauri/src/metadata/lyrics.rs`; `.lrc` parsing in `src/utils/lrc.ts`; the viewer auto-scrolls to the active line and offers a "Back to current line" button when you scroll away. |
| Manual lyric correction | If the automatic match is wrong, the viewer lists other candidates and remembers the one you pick. |
| Artist biographies and photos | Wikipedia REST summary plus a search fallback, filtered so a disambiguation or discography page is never accepted as an artist. |
| Album tracklists | MusicBrainz, throttled to one request every 1.1 s process-wide. |
| Genre backfill | iTunes lookup for songs whose tag genre is missing or generic. |
| Missing cover art | iTunes artwork lookup, stored in the same artwork store as embedded art. |
| Attempt bookkeeping | `metadataAttemptService.ts` records failures; after 3 attempts a lookup backs off for 30 days. The manual retry in the Now Playing panel bypasses every cooldown. |
| Pause switch | Settings → Library data → Pause metadata fetching stops all outbound lookups. |

### Recommendations

| Feature | How it is built |
|---|---|
| Search-page recommendations | `src/services/searchRecommendations.ts` — "Recommended for you" from your listening history when the search box is empty, "More like these" seeded by the current results otherwise. Pure and deterministic; capped at 2 songs per artist. |
| Online signals | Last.fm (similar artists, similar tracks, tags — needs an API key in Settings) and MusicBrainz (tags, genres). Requests go through the native HTTP client (`fetch_recommendation_json_rust`) because the webview cannot satisfy Last.fm's CORS policy or MusicBrainz's user-agent requirement. |
| Signal reuse | Signals also re-rank the smart mixes (`recommendationIndex.ts`). Cached 30 days; a failed provider call retries after an hour. |

### Interface

| Feature | How it is built |
|---|---|
| Neumorphic light and dark themes | See [Design system](#design-system). The theme is applied by an inline script in `index.html` before first paint, so there is no flash. |
| Window memory | The main window reopens at its last size, position and maximised state (`tauri-plugin-window-state`, pinned to ~2.4 to match Tauri 2.11). |
| Mini player | A separate always-on-top, transparent, undecorated `WebviewWindow` (`src/pages/Overlay/`, `useOverlayController.ts`). It collapses to artwork plus play, expands on hover, is draggable, and can auto-hide when paused. Toggled from the sidebar or Settings. |
| Audio visualizer | A compact spectrum strip on the top edge of the player bar, in three styles (Ember, Aurora, Mono), drawn on a canvas from the live spectrum and the theme tokens. |
| Game Mode | A single low-cost page with no artwork grids; disables the FPS monitor and collapses every shadow to a hairline. For playing while something else needs the GPU. |
| Now Playing | Full-page view with artwork, queue, lyrics and the artist panel; a condensed version of the same lives in the right-hand sidebar. |
| Keyboard shortcuts | Space play/pause, ←/→ seek 5 s, Shift+←/→ previous/next track, ↑/↓ volume ±5 %, M mute (`useGlobalShortcuts.ts`; ignored while typing or on a focused slider). |
| Media keys | A low-level Windows keyboard hook forwards play/pause/next/previous as `amply://media-key`. |
| System media session | `useMediaSession.ts` publishes title, artist and artwork to the OS. |
| Toasts, modals, confirmations | `src/components/ui/` — every modal traps focus, closes on Escape and restores focus on close (`useDialog.ts`). |
| Error boundaries | Each route and the player bar are wrapped; a crash shows a fallback card and arms safe mode for the next start instead of taking down the window. |

### Windows integration

| Feature | How it is built |
|---|---|
| Pause when another app plays audio | A WASAPI session watcher (`src-tauri/src/platform/windows.rs`) polls active render sessions and emits `amply://audio-focus`. Configurable: ignore list by process name, and an option to ignore fullscreen apps. |
| Launch on startup | `tauri-plugin-autostart` (a single `HKCU\...\Run` entry). |
| Branded installer | NSIS with Amply header and sidebar bitmaps generated from the logo, the app icon, and a per-user install. |

---

## Architecture

### Process model

```
┌─ Main window (WebView2) ────────────┐     ┌─ Overlay window ─────────┐
│  React app: routes, stores, UI      │     │  Mini player, same origin│
└──────────────┬──────────────────────┘     └────────┬─────────────────┘
               │ Tauri IPC (commands + events)       │
┌──────────────┴─────────────────────────────────────┴─────────────────┐
│ Rust core                                                            │
│  storage.rs  one SQLite connection (WAL) behind a mutex              │
│  library.rs  parallel scan, tag reading, root scope, delete guard    │
│  artwork.rs  on-disk JPEG store + `amplyart://` protocol handler     │
│  audio/      dedicated thread: rodio sink, biquad EQ, spectrum tap   │
│  metadata/   one reqwest client: Wikipedia, iTunes, MusicBrainz,     │
│              LRCLIB, plus per-key caches                             │
│  platform/   Windows audio-focus watcher and media-key hook          │
└──────────────────────────────────────────────────────────────────────┘
```

The audio engine is single-threaded by design: one thread owns the device and the sink, and every
command is a message on an `mpsc` channel with a reply channel and a timeout (15 s for anything that
decodes or opens a device, 5 s otherwise). That keeps the engine free of locks around the sink.

### State

Two Zustand stores plus a few leaf modules:

- **`playerStore`** — queue, current song, playback flags, settings, sleep timer. Settings writes go
  through a serialised write queue so two rapid toggles cannot lose each other.
- **`libraryStore`** — songs, playlists, scan status, metadata fetch status, listening profile.
- **`playbackProgressStore`** — position and duration only, split out so the 4 Hz progress tick does
  not re-render anything that only cares about the queue.
- **`libraryDataStore`** — snapshot accessors (`getSongsSnapshot`, `getSongsSnapshotStructural`)
  keyed by version counters, so views recompute only when the fields they read actually changed.
- **`runtimeFlags`** — a typed vanilla-Zustand store for process-wide flags (`isPlaying`, `lowPerf`,
  `gameMode`, …) that leaf services can read without importing a store.
- **`preferences`** — validated `localStorage` access under the `amply:pref:` prefix; every read
  passes through a validator, so a corrupt value falls back instead of throwing.

Settings have one definition (`src/store/defaultSettings.ts`): `DEFAULT_SETTINGS` plus
`normalizeSettings`, which coerces any persisted object into a valid, fully-populated shape.

### Storage

Everything lives under `%APPDATA%\AdithyaKV.AmplyMusicPlayer\storage\`:

- `amply_cache.db` — a single SQLite key-value table (`kv`: path → value), WAL, `synchronous=NORMAL`,
  5 s busy timeout, cached prepared statements. One connection for the whole process.
- `artwork/` — one JPEG per distinct cover, named by an FNV-1a hash of the source bytes, plus 64 px
  and 128 px thumbnails generated on demand.
- `artist_cache/`, `lyrics_cache/`, `metadata_cache/` — legacy on-disk caches, still read for
  migration.

Notable keys:

| Key | Contents |
|---|---|
| `settings.json` | The full `AppSettings` object |
| `playlists/library_cache.json` | The scanned library |
| `playlists/song_activity.json` | Play counts, favourites, skips, last-played |
| `playlists/listening_events.json` | Rolling per-play event log for the mix engine |
| `playlists/listening_profile.json`, `taste_profile.json` | Aggregated listening shape |
| `playlists/smart_cache.json`, `smart_cache_lite.json` | Generated mixes |
| `playlists/mix_history.json` | 14 days of per-mix output, for anti-repeat |
| `playlists/custom_playlists.json` | Your own playlists |
| `library/roots.json` | Canonical scanned roots (re-allowed in the asset scope at startup) |
| `metadata_cache/metadata_attempts.json` | Failure counts and cooldowns |
| `recommendations/*.json` | Online signals, index and diagnostics |

### IPC surface

Commands are grouped by module: `audio_*` (14 of them), `scan_music`, `load_embedded_artwork`,
`pick_music_folders`, `delete_song_file`, `build_album_art_frequency_rust`, the storage four
(`read_storage_file`, `write_storage_file`, `ensure_storage_dirs`, `clear_storage_cache`,
`open_storage_dir`), and the metadata set (artist, artwork, tracklist, genre, lyrics,
`fetch_recommendation_json_rust`).

Events flow the other way: `amply://audio-progress` (4 Hz while playing),
`amply://audio-spectrum` (20 Hz, only when the visualizer is on), `amply://audio-ended`,
`amply://audio-focus`, `amply://media-key`, plus `amply://overlay-*` between the two windows.

Errors are one type — `AmplyError` in `src-tauri/src/error.rs` (`Io`, `Db`, `Http`, `Json`, `Audio`,
`Forbidden`, `InvalidInput`, `Unavailable`, `Other`) — serialised to its `Display` string, so the
TypeScript side always receives a plain message.

---

## Audio pipeline

```
file bytes (Arc<[u8]>, shared across sinks)
   ↓ rodio Decoder (symphonia)
   ↓ BiquadSource ×5        peaking filters, gains read from atomics
   ↓ SpectrumSource         8-band envelope follower → atomics → events
   ↓ SharedSpeed            rate read from an atomic, forwards try_seek
   ↓ rodio Sink → output device
```

The EQ and the spectrum tap run at the decoder's native sample rate, so their tuning does not move
with the playback rate; the speed wrapper is outermost. Every stage implements `try_seek` and resets
its filter state on seek, which is what makes in-place seeking possible instead of rebuilding the
graph.

Position is derived, not polled: `position = paused_position + elapsed × rate_at_start`. Changing the
rate folds the current position first, so the reported position stays correct across speed changes.

The thread idles on `recv_timeout` — a 50 ms tick only while there is work to do (playing, fading, or
looping), and a 60 s block otherwise.

---

## Smart mix engine

`src/services/mixEngine/` is a pure, deterministic module: same input, same output. It runs in a Web
Worker and is covered by unit tests (engine, diversity, genres, signals, plus a 10 k-song performance
budget).

**Per song signals** (`signals.ts`): play count with exponential decay, recent plays over 21 days,
days since played and since added, skip ratio and skip position, favourite, duration, canonical genre
and genre hints, artist and album keys.

**Eligibility is a hard gate**, not a score — Most Played only ever contains songs with plays, Quick
Hits only tracks under 3 minutes, Deep Cuts only songs played at most once and added more than 21
days ago, Explore only songs never played or untouched for 30 days *and* not heard in the last 36
hours *and* not shown by Explore in the last 7 days.

**Ranking** blends a taste score (artist affinity, genre affinity, recency recovery, favourite bonus,
skip penalty) with per-mix weights, then splits the result into an *exploit* share and an *explore*
share — 100 % exploit for Recently Played, 70 % for the Daily Mix, 50 % for Recently Added.
Discovery and randomness sliders in Settings shift those shares by up to ±15 points and control the
sampling temperature.

**Diversity caps** are enforced by backfill, never by truncation: at most 15 % of a mix from one
artist and 10 % from one album, skipping ahead to the next candidate rather than stopping.

**Exclusivity**: a song appears in at most 2 mixes, and mixes are grouped into families (`discovery`,
`loved`, `recent`) so two mixes in the same family do not become near-duplicates. The Daily Mix
reserves its picks first.

**Anti-repeat**: 14 days of history per mix; a song shown in the last 14 days is penalised, Explore
excludes its last 7 days outright, and the Daily Mix carries over at most 20 % of yesterday.

**Cold start**: with little history, Rediscover falls back to never-played songs and the recency
window relaxes from 36 h to 12 h, so a fresh library still gets distinct mixes.

---

## Metadata pipeline

One `reqwest` client for the whole process (`metadata/http.rs`) with a descriptive user agent —
MusicBrainz requires a contact — a 12 s timeout and a 5 s connect timeout. MusicBrainz calls pass
through a process-wide throttle that holds its mutex across the sleep, so callers queue rather than
race for the same slot.

Lookups are scheduled, not fired on sight: `metadataActivityGate` and `appScheduler` keep them off
the critical path, `metadataPriority` backs off while the user is skipping between songs rapidly, and
the current song's artist bypasses the idle gate because it is on screen.

Artist matching is deliberately strict. A Wikipedia candidate must look like a person or group, not a
discography or disambiguation page, and the summary must mention a music-related term — the list
covers performers, producers, composers, instrumentalists and DJs, so a producer's page is not
rejected for lacking the word "band".

Two lookup rules worth knowing:

- A real artist tag always wins. A title like `Blackbird - 2018 Mix` by The Beatles is not read as
  artist "Blackbird"; the `Artist - Title` pattern only fills in when the tag is missing or is junk
  (a "Topic" channel, an uploader name).
- Only transport failures are reported as offline. A 404 from Wikipedia is a miss you can retry, not
  a network error.

---

## Design system

Everything visible is a `Surface` with one of a few recipes defined in `src/index.css`:

| Recipe | Used for |
|---|---|
| `neu-raised` | Cards, modals, the featured playlist card |
| `neu-raised-sm` | Buttons, chips, list rows on hover |
| `neu-pressed` / `neu-pressed-sm` | Inputs, selected state, tab tracks, the active nav entry |
| `neu-flat` | List rows at rest (cheap enough for virtualised lists) |
| `neu-well` | Artwork frames and empty states |
| `neu-accent` / `neu-danger` | Primary and destructive actions |

Colours come from `--amply-*` tokens defined as RGB triplets, so Tailwind's `/alpha` syntax keeps
working (`text-amply-textPrimary`, `bg-amply-bgDeep/60`). The dark theme redefines the same tokens
under `:root[data-theme='dark']`. Radii are `rounded-sm/md/lg/full` (10/16/24 px), and z-index is a
named scale (`raised`, `player`, `shell`, `modal`, `toast`, `feedback`).

Icons are one component (`src/components/ui/Icon.tsx`) — 55 glyphs drawn on a 24 grid as path data,
inheriting `currentColor` and a 1.8 stroke. No icon font, no icon library.

Focus is drawn with a subtle inset ring rather than an outline ring, and never with the accent colour;
motion lives in one layer (`.anim-page`, `.anim-rise`, `.anim-stagger`, …) that
`html[data-low-perf="true"]` disables wholesale along with every shadow.

---

## Performance

The work that matters on a large library, and where it lives:

- **Artwork is not in the data.** Covers used to travel as base64 `data:` URLs inside every song
  record, which bloated the library cache, the scan response and memory. They are now files served
  through the `amplyart://` scheme, with 64/128 px thumbnails for lists (`src/utils/artwork.ts`).
- **Parallel scanning** across the walker's entries.
- **Split stores** so the progress tick does not rewrite the queue, and version-keyed snapshots so a
  favourite toggle does not invalidate a structural view.
- **Virtualised lists and grids** (`react-window`), with `neu-flat` rows at rest so scrolling never
  composites a full neumorphic shadow per row.
- **The mix engine runs in a worker**, with a lite pass for the five time-sensitive mixes.
- **An FPS monitor** flips `lowPerf` when the frame rate drops below 28, which collapses shadows and
  unmounts the visualizer until it recovers.
- **A perf diagnostics ring buffer** (`perfDiagnostics.ts`) records marks and interaction latencies;
  `window.__AMPLY_DEBUG__.getPerfSnapshot()` dumps it in a dev build.

---

## Security model

- **Content-Security-Policy** is set in `tauri.conf.json`. `img-src` allows the app's own schemes plus
  `upload.wikimedia.org` and `*.mzstatic.com`; `connect-src` allows the IPC origin plus
  `ws.audioscrobbler.com` and `musicbrainz.org`; `object-src` and `frame-src` are `none`.
- **Asset scope** starts at the system Music folder and grows only to folders you have actually
  scanned. Roots are persisted and re-allowed at startup.
- **Deleting a file** is refused unless the canonical path sits inside a registered root.
- **The opener capability** is narrowed to `https://` URLs (the app only opens Wikipedia links).
- **Devtools** are off on the main window and the internal toggle is denied in the capability set.
- **Metadata requests** all originate in Rust with one user agent; the webview never talks to a
  third-party host directly.

---

## Development

```bash
npm install
npm run dev          # frontend only, in a browser (silent stub audio engine, demo songs)
npm run tauri dev    # full desktop app
```

Quality gates — all must be clean before a commit:

```bash
npm run check        # typecheck + eslint + vitest (216 tests)
npm run lint:dead    # knip: unused files, exports, dependencies
cd src-tauri && cargo check && cargo clippy --all-targets && cargo test   # 41 tests
```

Two Rust tests are `#[ignore]`d because they need a real music folder:

```bash
cd src-tauri && AMPLY_TEST_SONGS="D:/path/to/songs" cargo test -- --ignored --nocapture
```

They decode a sample of the folder through the full DSP chain (including a mid-track seek) and read
tags from every file — the fastest way to catch a decoder or tag-reader regression after a dependency
bump.

Building:

```bash
npm run tauri build                 # all bundles
npx tauri build --bundles nsis      # Windows installer only
```

The installer is branded from `src-tauri/installer/` (header and sidebar bitmaps, regenerated from
the logo by `python scripts/installer-branding.py`, needs Pillow) and configured under
`bundle.windows.nsis` in `src-tauri/tauri.conf.json`.

### Conventions

- TypeScript is strict; no `any` in application code.
- ESLint runs `react-hooks/rules-of-hooks` and `exhaustive-deps` as errors.
- `localStorage` is only touched through `services/preferences.ts`; direct access is banned by lint.
- Process-wide flags go through `runtimeFlags`, never `window.*`.
- Comments explain *why*, not *what*; a comment that restates the code is noise.

---

## Project structure

```text
src/
  App.tsx                  picks the overlay window or the main shell (both lazy)
  AppShell.tsx             layout, routes, scheduler wiring, error boundaries
  components/
    ui/                    the design system: Surface, Card, Button, IconButton, Icon, Toggle,
                           Slider, ProgressBar, Modal, ConfirmDialog, Badge/Chip, Divider,
                           PageHeader, SegmentedTabs, Input/Select, Typography, Toast, Spinner,
                           CoverBackdrop
    Player/                player bar, transport, progress, visualizer strip, game-mode bar
    SongList/              virtualised song table with sorting and persistence
    NowPlayingPanel/       right sidebar: artwork, genre, artist profile
    LyricsViewer/          lyrics view, candidate picker, auto-scroll
    AudioVisualizer/       canvas spectrum scenes (ember, aurora, mono)
    Sidebar/               navigation, mini-player toggle, scan status
  pages/                   Home, Library, Playlists, PlaylistDetail, NowPlaying, Search, Settings,
                           GameMode, Overlay — large pages are split into sibling files
  services/
    mixEngine/             the smart-playlist engine (pure, tested, worker-hosted)
    storageService.ts      the kv bridge, debounced writes, in-memory cache
    audioEngine.ts         the audio bridge (native under Tauri, silent stub in a browser)
    *ProfileService, lyricsFetcher, albumTracklistService, songMetadataService
    appScheduler, playbackScheduler, metadataPriority, metadataActivityGate
    runtimeFlags.ts        typed process-wide flags
    preferences.ts         validated localStorage access
  store/                   playerStore, libraryStore, libraryDataStore, playbackProgressStore,
                           defaultSettings
  hooks/                   useLibraryViews (view models), useThemeSync, useDialog,
                           useOverlayController, useGlobalShortcuts, useSearchRecommendations, …
  utils/                   hash, seeded random, text normalisation, artist parsing, idle scheduling,
                           date seeds, lrc parsing, artwork thumbnails
  workers/                 mixEngine.worker.ts
  index.css                design tokens (light + dark), surface recipes, motion layer

src-tauri/src/
  main.rs                  Tauri builder, plugins, protocol registration, command list
  error.rs                 AmplyError
  storage.rs               SQLite kv store (StorageDb) and storage commands
  library.rs               scanning, tag reading, artwork extraction, roots, delete guard
  artwork.rs               on-disk artwork store and the amplyart:// protocol handler
  audio/
    engine.rs              NativeAudio: sinks, fades, position, loop, device switching
    dsp.rs                 biquad EQ, spectrum tap, shared-rate wrapper
    commands.rs            audio_* commands with per-command timeouts
    mod.rs                 the audio thread and its event emission
  metadata/
    http.rs                the shared client, throttle, recommendation proxy
    artist.rs              Wikipedia lookup and validation
    artwork.rs             iTunes cover lookup
    tracklist.rs           MusicBrainz tracklists
    genre.rs               iTunes genre backfill
    lyrics.rs              LRCLIB search, fetch, cache and manual selection
    normalize.rs           artist/title normalisation and matching
    cache.rs               per-key metadata caches and the legacy blob migration
  platform/windows.rs      audio-focus watcher, media-key hook, clean shutdown

scripts/installer-branding.py   regenerates the NSIS header and sidebar bitmaps
release-notes/                  per-version notes
```

---

## Troubleshooting

**Logs** are written to `%LOCALAPPDATA%\AdithyaKV.AmplyMusicPlayer\logs\amply.log`. Routine MP3
decoder chatter (bit-reservoir underflow, bitrate-estimated duration) is filtered out; anything at
warning level or above is the app's own.

**A view fails to render** — the route error boundary shows a card and arms safe mode for the next
start. In development this usually means the Vite dev server died: routes are code-split, so the next
route you open cannot fetch its chunk.

**Artist details not available** — the manual retry in the Now Playing panel bypasses every cooldown
and shows its progress. If it still misses, Wikipedia has no page matching the tagged artist name.

**Recommendations look empty** — they need either listening history (for the local part) or a Last.fm
API key in Settings (for similar artists and tracks). MusicBrainz tags work without a key.

**A library on another drive is silent** — the asset scope only covers folders you have scanned. Add
the folder in Settings and rescan.

**Browser mode** (`npm run dev`) runs with two demo songs and a silent audio engine that fakes
progress, so UI work does not need the desktop shell.
