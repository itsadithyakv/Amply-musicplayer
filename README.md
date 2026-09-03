# Amply

A modern, offline-first desktop music player for local libraries. Amply combines fast scanning, smart mixes and a soft neumorphic desktop UI while keeping your music fully local.

## Highlights

- Offline-first library with fast incremental scanning
- Daily Mix refreshes daily; other smart mixes refresh weekly
- Smart mixes (On Repeat, Genre and Mood mixes)
- Lyrics sync with caching and manual corrections
- Native Rust audio engine (rodio + symphonia): gapless preloading, crossfade, live 5-band EQ, playback speed, output-device selection
- Game Mode for low-resource playback
- Always-on-top mini overlay player
- Sleep timer with countdown and auto-stop
- Light and dark neumorphic themes
- Large-library performance (virtualised grids, cached lookups)

## Tech stack

- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind 3, Zustand for state
- **Desktop**: Tauri 2 (WebView2 on Windows)
- **Audio**: Rust — rodio with the symphonia decoders (mp3, flac, wav, vorbis, aac/m4a)
- **Storage**: a single SQLite key-value store (`amply_cache.db`) under the app data dir, accessed through Tauri commands

## Development

```bash
npm install
npm run dev          # frontend only, in a browser (silent stub audio engine, demo songs)
npm run tauri dev    # full desktop app
```

Quality gates (all must be clean before a commit):

```bash
npm run check        # typecheck + eslint + vitest
npm run lint:dead    # knip: unused files / exports / dependencies
cd src-tauri && cargo check && cargo clippy --all-targets && cargo test
```

Production build: `npm run tauri build`.

## Project structure

```text
src/
  App.tsx / AppShell.tsx   overlay window vs. main shell (both lazy)
  components/ui/           the design system: Surface, Card, Button, IconButton, Icon, Toggle,
                           Slider, ProgressBar, Modal, ConfirmDialog, Badge/Chip, Divider,
                           PageHeader, SegmentedTabs, TextInput/SearchInput/Select, Typography
  components/              feature components (Player, SongList, NowPlayingPanel, LyricsViewer, ...)
  pages/                   Home, Library, Playlists, PlaylistDetail, NowPlaying, Search, Settings,
                           GameMode, Overlay — each large page is split into sibling files
  store/                   Zustand stores (playerStore, libraryStore) + defaultSettings
  services/                storage, audio engine bridge, metadata clients, schedulers,
                           runtimeFlags (typed process-wide flags), preferences (validated UI prefs)
  hooks/                   view models (useLibraryViews), theme sync, dialogs, persisted preferences
  utils/                   hash, random (seeded shuffle), text normalisation, idle scheduling, date seeds
  index.css                design tokens (light + dark) and the neumorphic surface recipes
src-tauri/src/
  main.rs                  Tauri builder, plugins, command registration
  storage.rs               SQLite kv store (StorageDb)
  library.rs               scanning (lofty), embedded artwork, folder picker, delete
  audio/                   engine (rodio), dsp (biquad EQ, spectrum, shared speed), commands
  platform/                Windows audio-focus watcher and media keys
  metadata/                Wikipedia / iTunes / MusicBrainz / lrclib clients, per-key caches
  playlist.rs              smart playlist generation
```

## Design system

Everything visible is a `Surface` with one of a few recipes defined in `src/index.css`:
`neu-raised` (cards, modals), `neu-raised-sm` (buttons, chips), `neu-pressed` / `neu-pressed-sm`
(inputs, selected state, tab tracks), `neu-flat` (list rows at rest), `neu-well` (artwork and empty
states), `neu-accent` / `neu-danger` (primary and destructive actions). Colours come from the
`--amply-*` tokens (RGB triplets exposed to Tailwind as `amply-*`), radii from `rounded-sm/md/lg/full`,
and icons from the `Icon` component. Focus is drawn with `outline`, so shadows never hide it.
`html[data-low-perf="true"]` collapses every shadow to a hairline on weak machines.

## Smart mix rules (simplified)

- **Daily Mix**: non-recent tracks + favourites, interleaved by genre, refreshed daily
- **On Repeat**: high play count + recent plays, seeded shuffle
- **Genre / Mood mixes**: keyword scoring on genre/title with a favourites boost

Mixes are seeded from the ISO week / day so they stay stable within a period; manual regeneration reseeds.

## Notes

- The default scan path is your system Music folder; add more folders in Settings.
- Only folders you have scanned (plus the system Music folder) are reachable through the asset protocol, and songs can only be deleted from inside those folders.
- In browser mode (`npm run dev`) the app runs with two demo songs and a silent audio engine.
- Logs are written to `%LOCALAPPDATA%\AdithyaKV.AmplyMusicPlayer\logs\amply.log`.
