# Amply

Amply is a smart offline music player for local libraries, built to feel like a modern streaming app while staying entirely local.

## Highlights

- Spotify-style desktop layout with a persistent player bar
- Smart playlists and mixes (Daily Mix, On Repeat, Genre Mixes, etc.)
- Lyrics fetch and offline caching with synced karaoke highlighting
- Advanced playback controls: crossfade, gapless, replay-gain normalization, speed control, sleep timer
- Fast search with instant filtering and suggestions
- Local listening stats and insights

## Tech Stack

- Frontend: React + TypeScript + Vite + TailwindCSS
- Desktop: Tauri
- Audio: Howler.js + Web Audio API hooks
- State: Zustand
- Storage: JSON files in `storage/` via Tauri commands

## Project Structure

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

## Development (Web)

```bash
npm install
npm run dev
```

## Build (Frontend)

```bash
npm run build
```

## Run Desktop (Tauri)

Install Rust and Tauri prerequisites first, then:

```bash
npm run tauri dev
```

## Notes

- Default scan path is `music` in the project root; configurable in Settings.
- In non-Tauri browser mode, the app falls back to demo songs.
- Icons are included in both `assets/icons/` and `icons/`.
