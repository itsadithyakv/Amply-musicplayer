# Amply

Amply is a smart offline music player for local libraries, designed to feel like Spotify for downloaded music.

## Stack

- Frontend: React + TypeScript + Vite + TailwindCSS
- Desktop: Tauri
- Audio: Howler.js + Web Audio API hooks
- State: Zustand
- Local storage: JSON files in `storage/` via Tauri commands

## Implemented Features

- Spotify-style desktop layout
  - 240px sidebar
  - Main content area
  - 90px bottom player bar
- Exact dark theme and accent color system
- Home sections
  - Daily Shuffle
  - Recently Played
  - Rediscover
  - Smart Playlists
  - Top Artists
- Library tabs
  - Songs, Albums, Artists, Genres, Playlists
- Now Playing view
  - 320x320 artwork
  - transport controls
  - tabs: Now Playing, Lyrics, Queue
- Lyrics system
  - fetches from internet on first open
  - caches to `storage/lyrics_cache/*.lrc`
  - offline reuse
  - synced karaoke highlighting when timestamps exist
- Smart playlists
  - Recently Added
  - Most Played
  - Rediscover
  - Favorites
  - Daily Shuffle (genre-mixed, avoids recent plays, boosts favorites)
- Advanced playback controls
  - Crossfade (configurable)
  - Gapless preloading
  - Volume normalization using ReplayGain when available
  - Playback speed (0.75x to 1.5x)
  - Sleep timer
  - Temporary queue with drag reorder
- Search with instant filtering + quick suggestions
- Local stats page
  - top songs/artists/albums
  - total listening time

## Folder Layout

```text
amply/
  src/
    components/
      Sidebar/
      Player/
      SongList/
      AlbumCard/
      LyricsViewer/
    pages/
      Home/
      Library/
      NowPlaying/
      Search/
      Stats/
      Settings/
    services/
      musicScanner.ts
      audioEngine.ts
      playlistGenerator.ts
      lyricsFetcher.ts
      metadataParser.ts
      storageService.ts
      statsService.ts
    store/
      playerStore.ts
      libraryStore.ts
  src-tauri/
    src/main.rs
  assets/icons/
  icons/
  storage/
    lyrics_cache/
    playlists/
  music/
```

## Run (Web Dev)

```bash
npm install
npm run dev
```

## Build Frontend

```bash
npm run build
```

## Run Desktop (Tauri)

Install Rust + Tauri prerequisites first, then:

```bash
npm run tauri dev
```

## Notes

- Default scan path is `music` in project root; configurable in Settings.
- In non-Tauri browser mode, the app falls back to demo songs.
- Icons are included in both `assets/icons/` and `icons/`.
