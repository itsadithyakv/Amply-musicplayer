# Amply v1.5.2

A modern, offline-first desktop music player built for local libraries. Amply combines fast scanning, smart mixes, and a smooth desktop UI while keeping your music fully local.

## Highlights

- Offline-first library with fast incremental scanning
- Daily Mix refreshes daily; other smart mixes refresh weekly
- Smart mixes (On Repeat, Genre and Mood mixes)
- Lyrics sync with caching and manual corrections
- Native audio engine with gapless, crossfade, and normalization
- EQ presets, output device selection, and playback speed controls
- Game Mode for low-resource playback
- Always-on-top mini overlay player
- Sleep timer with countdown and auto-stop
- Large-library performance upgrades (virtualized grids, cached lookups)

## New in 1.5.2

- Large-library performance passes across startup, search, library views, metadata fetch, and smart playlist refresh paths.
- Leaner Game Mode with a stripped-down player bar, disabled search warming, and fewer always-on background loops.
- Improved overlay compatibility and reduced redundant overlay state sync traffic from the main app.
- Fixed smart-playlist refresh conflicts and restored deterministic ordering in the optimized search path.

## Core Concepts

**Library-first**  
A local library is the source of truth. Everything (search, mixes, stats) is derived from your on-disk songs.

**Smart mixes**  
Generated playlists adapt to your listening behavior and metadata. Mixes are seeded weekly and can be manually regenerated on demand.

**Pipelines over pages**  
Data flows through a deterministic pipeline: scan ? enrich ? cache ? generate mixes ? play. UI is a projection of this pipeline state.

## Pipelines

### 1) Library Pipeline

```text
Folders ? Scan ? Normalize ? Cache ? Library Index
```

**Scan**  
Reads local folders, de-dupes, normalizes tags, and builds the library index.

**Cache**  
Persists song data and playlist state in `storage/` so the app starts fast.

### 2) Enrichment Pipeline (Idle-Only)

```text
Library ? (Idle) Lyrics / Artist / Genre ? Cache ? UI
```

- Runs only when the app is idle and not playing.
- Results are cached for offline use.

### 3) Smart Mix Pipeline

```text
Library + Usage ? Rules ? Seeded Shuffle ? Smart Playlists
```

- Weekly seed provides consistency.
- Manual regen re-seeds immediately for fresh ordering.

### 4) Playback Pipeline

```text
Queue ? Native Audio Engine ? Progress Events ? UI
```

- Native Rust audio engine handles playback, timing, EQ, and normalization.

## Smart Mix Rules (Simplified)

- **Daily Mix**: non-recent tracks + favorites, interleaved by genre, refreshed daily.
- **On Repeat**: high play count + recent plays, seeded shuffle.
- **Genre / Mood mixes**: keyword scoring on genre/title with a favorites boost.

## Tech Stack

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Desktop**: Tauri
- **Audio**: Native Rust audio engine (rodio + cpal)
- **State**: Zustand
- **Storage**: JSON files in `storage/` via Tauri commands

## Project Structure

```text
amply/
  src/
    components/
    pages/
    hooks/
    services/
    store/
  src-tauri/
    src/main.rs
  storage/
    lyrics_cache/
    playlists/
    metadata_cache/
```

## Development

```bash
npm install
npm run dev
```

## Desktop (Tauri)

```bash
npm run tauri dev
```

## Notes

- Default scan path is `music` in the project root; configurable in Settings.
- In non-Tauri browser mode, the app falls back to demo songs.
- Overlay and Game Mode are controlled in Settings.

