import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { playbackActions, usePlayerStore } from '@/store/playerStore';
import { isTauri } from '@/services/storageService';
import { useCurrentSongSnapshot } from '@/hooks/useLibraryViews';

export const useMediaSession = (): void => {
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const { song } = useCurrentSongSnapshot();

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    if (isTauri() && getCurrentWebviewWindow().label === 'overlay') {
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

    if (isTauri() && getCurrentWebviewWindow().label === 'overlay') {
      return;
    }

    const mediaSession = navigator.mediaSession;
    mediaSession.setActionHandler('play', () => {
      resumePlayback();
    });
    mediaSession.setActionHandler('pause', () => {
      pausePlayback();
    });
    mediaSession.setActionHandler('stop', () => {
      pausePlayback();
    });
    mediaSession.setActionHandler('previoustrack', () => {
      void playbackActions.playPrevious();
    });
    mediaSession.setActionHandler('nexttrack', () => {
      void playbackActions.playNext(true);
    });

    return () => {
      mediaSession.setActionHandler('play', null);
      mediaSession.setActionHandler('pause', null);
      mediaSession.setActionHandler('stop', null);
      mediaSession.setActionHandler('previoustrack', null);
      mediaSession.setActionHandler('nexttrack', null);
    };
  }, [pausePlayback, resumePlayback]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: UnlistenFn | null = null;
    let alive = true;

    listen<{ action?: string }>('amply://media-key', (event) => {
      if (!alive) {
        return;
      }
      const action = event.payload?.action;
      if (!action) {
        return;
      }
      if (action === 'playpause') {
        togglePlayPause();
        return;
      }
      if (action === 'play') {
        resumePlayback();
        return;
      }
      if (action === 'pause' || action === 'stop') {
        pausePlayback();
        return;
      }
      if (action === 'next') {
        void playbackActions.playNext(true);
        return;
      }
      if (action === 'previous') {
        void playbackActions.playPrevious();
      }
    }).then((dispose) => {
      if (alive) {
        unlisten = dispose;
      } else {
        dispose();
      }
    });

    return () => {
      alive = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [pausePlayback, resumePlayback, togglePlayPause]);
};
