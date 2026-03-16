import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

export const useMediaSession = (): void => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const song = useLibraryStore((state) => (currentSongId ? state.getSongById(currentSongId) : undefined));

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    const mediaSession = navigator.mediaSession;
    const MediaMeta = (window as typeof window & { MediaMetadata?: typeof MediaMetadata }).MediaMetadata;
    if (song && MediaMeta) {
      const artwork = song.albumArt
        ? [
            {
              src: song.albumArt,
              sizes: '512x512',
              type: 'image/png',
            },
          ]
        : [];

      mediaSession.metadata = new MediaMeta({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork,
      });
    } else {
      mediaSession.metadata = null;
    }

    mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [song?.id, song?.title, song?.artist, song?.album, song?.albumArt, isPlaying]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    const mediaSession = navigator.mediaSession;
    mediaSession.setActionHandler('play', () => {
      resumePlayback();
    });
    mediaSession.setActionHandler('pause', () => {
      pausePlayback();
    });
    mediaSession.setActionHandler('previoustrack', () => {
      void playPrevious();
    });
    mediaSession.setActionHandler('nexttrack', () => {
      void playNext(true);
    });

    return () => {
      mediaSession.setActionHandler('play', null);
      mediaSession.setActionHandler('pause', null);
      mediaSession.setActionHandler('previoustrack', null);
      mediaSession.setActionHandler('nexttrack', null);
    };
  }, [playNext, playPrevious, pausePlayback, resumePlayback]);
};
