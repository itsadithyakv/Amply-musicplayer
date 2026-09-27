import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { playbackActions, usePlayerStore } from '@/store/playerStore';
import { isTauri } from '@/services/storageService';
import { useCurrentSongSnapshot } from '@/hooks/useLibraryViews';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '@/i18n';
import { recordPerfEvent } from '@/services/perfDiagnostics';
import { getPlaybackProgressSnapshot, subscribePlaybackProgress } from '@/store/playbackProgressStore';

/** A position this far from where playback should be means the user seeked. */
const SEEK_JUMP_SEC = 2;
/** Periodic resync of Windows' media flyout timeline while playing. */
const TIMELINE_REFRESH_MS = 15_000;

/**
 * Feeds Windows' system media controls (the media flyout, lock screen and taskbar buttons) in the
 * desktop app. The browser build uses `navigator.mediaSession` below instead.
 */
const useNativeMediaControls = (): void => {
  const { t } = useT();
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playbackSpeed = usePlayerStore((state) => state.settings.playbackSpeed);
  const { song } = useCurrentSongSnapshot();
  const songId = song?.id ?? null;
  const songTitle = song?.title ?? '';
  const songArtist = song?.artist ?? '';
  const songAlbum = song?.album ?? '';
  const songAlbumArt = song?.albumArt ?? null;

  useEffect(() => {
    if (!isTauri() || getCurrentWebviewWindow().label === 'overlay') {
      return;
    }
    let lastSent = { positionSec: 0, at: 0 };
    const send = () => {
      const { positionSec, durationSec } = getPlaybackProgressSnapshot();
      lastSent = { positionSec, at: Date.now() };
      const state = songId
        ? {
            songId,
            title: songTitle,
            artist: songArtist,
            album: songAlbum,
            artwork: songAlbumArt,
            playing: isPlaying,
            positionSec,
            durationSec,
            labels: { previous: t('common.previous'), play: t('common.play'), pause: t('common.pause'), next: t('common.next') },
          }
        : null;
      invoke('media_controls_update', { state }).catch((error: unknown) => {
        recordPerfEvent('media-controls.update-error', { error: error instanceof Error ? error.message : String(error) });
      });
    };
    send();
    if (!songId) {
      return;
    }

    const unsubscribe = subscribePlaybackProgress(() => {
      const { positionSec } = getPlaybackProgressSnapshot();
      const elapsed = isPlaying ? ((Date.now() - lastSent.at) / 1000) * (playbackSpeed || 1) : 0;
      if (Math.abs(positionSec - (lastSent.positionSec + elapsed)) > SEEK_JUMP_SEC) {
        send();
      }
    });
    const refresh = isPlaying ? window.setInterval(send, TIMELINE_REFRESH_MS) : null;
    return () => {
      unsubscribe();
      if (refresh !== null) {
        window.clearInterval(refresh);
      }
    };
  }, [songId, songTitle, songArtist, songAlbum, songAlbumArt, isPlaying, playbackSpeed, t]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let alive = true;
    let unlisten: UnlistenFn | null = null;
    listen<{ positionSec?: number }>('amply://media-seek', (event) => {
      const target = event.payload?.positionSec;
      if (alive && typeof target === 'number' && Number.isFinite(target)) {
        playbackActions.seekTo(Math.max(0, target));
      }
    })
      .then((dispose) => {
        if (alive) {
          unlisten = dispose;
        } else {
          dispose();
        }
      })
      .catch((error: unknown) => {
        recordPerfEvent('media-controls.seek-listen-error', { error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
};


export const useMediaSession = (): void => {
  useNativeMediaControls();
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const { song } = useCurrentSongSnapshot();
  const songId = song?.id ?? null;
  const songTitle = song?.title ?? '';
  const songArtist = song?.artist ?? '';
  const songAlbum = song?.album ?? '';
  const songAlbumArt = song?.albumArt ?? null;

  useEffect(() => {
    // The desktop app reports to Windows natively (useNativeMediaControls); the webview's media
    // session has no audio element behind it there.
    if (isTauri() || typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    const MediaMeta = (window as typeof window & { MediaMetadata?: typeof MediaMetadata }).MediaMetadata;
    if (songId && MediaMeta) {
      const artwork = songAlbumArt
        ? [
            {
              src: songAlbumArt,
              sizes: '512x512',
              type: 'image/png',
            },
          ]
        : [];

      mediaSession.metadata = new MediaMeta({
        title: songTitle,
        artist: songArtist,
        album: songAlbum,
        artwork,
      });
    } else {
      mediaSession.metadata = null;
    }

    mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [songId, songTitle, songArtist, songAlbum, songAlbumArt, isPlaying]);

  useEffect(() => {
    if (isTauri() || typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
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
    }).catch((error) => {
      recordPerfEvent('media-session.listen-error', { error: error instanceof Error ? error.message : String(error) });
    });

    return () => {
      alive = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [pausePlayback, resumePlayback, togglePlayPause]);
};
