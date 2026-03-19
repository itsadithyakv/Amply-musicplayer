import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import {
  loadArtistProfile,
  type ArtistProfile,
  type ArtistProfileLoadResult,
} from '@/services/artistProfileService';
import { loadSongGenre, type SongGenreLoadResult } from '@/services/songMetadataService';
import { formatDuration } from '@/utils/time';
import { useIdleRender } from '@/hooks/useIdleRender';

const isUnknownGenre = (value: string | undefined): boolean => {
  if (!value?.trim()) {
    return true;
  }

  return value.trim().toLowerCase() === 'unknown genre';
};

const scheduleIdle = (task: () => void, timeoutMs = 300): (() => void) => {
  const idle = (globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  }).requestIdleCallback;
  const cancelIdle = (globalThis as typeof globalThis & {
    cancelIdleCallback?: (handle: number) => void;
  }).cancelIdleCallback;

  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;

  if (typeof idle === 'function') {
    idleHandle = idle(task, { timeout: timeoutMs });
  } else {
    timeoutHandle = window.setTimeout(task, timeoutMs);
  }

  return () => {
    if (idleHandle !== null && typeof cancelIdle === 'function') {
      cancelIdle(idleHandle);
    }
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
  };
};

const scheduleDeferredIdle = (task: () => void, delayMs = 1200, idleTimeoutMs = 1200): (() => void) => {
  let idleCancel: (() => void) | null = null;
  const timeoutHandle = window.setTimeout(() => {
    idleCancel = scheduleIdle(task, idleTimeoutMs);
  }, delayMs);

  return () => {
    window.clearTimeout(timeoutHandle);
    if (idleCancel) {
      idleCancel();
    }
  };
};

const NowPlayingPanel = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const songs = useLibraryStore((state) => state.songs);
  const updateSongGenre = useLibraryStore((state) => state.updateSongGenre);

  const song = currentSongId ? songs.find((entry) => entry.id === currentSongId) : undefined;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistStatus, setArtistStatus] = useState<ArtistProfileLoadResult['status']>('missing');
  const [artistCachePath, setArtistCachePath] = useState<string | null>(null);
  const [artistFromCache, setArtistFromCache] = useState(false);
  const [resolvedGenre, setResolvedGenre] = useState<string>('Unknown Genre');
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreStatus, setGenreStatus] = useState<SongGenreLoadResult['status']>('missing');
  const [genreFromCache, setGenreFromCache] = useState(false);
  const [genreCachePath, setGenreCachePath] = useState<string | null>(null);
  const idleReady = useIdleRender(300);

  useEffect(() => {
    if (gameMode) {
      setResolvedGenre('Unknown Genre');
      setGenreLoading(false);
      setGenreStatus('missing');
      setGenreFromCache(false);
      setGenreCachePath(null);
      return;
    }

    if (!song) {
      setResolvedGenre('Unknown Genre');
      setGenreLoading(false);
      setGenreStatus('missing');
      setGenreFromCache(false);
      setGenreCachePath(null);
      return;
    }

    const currentGenre = song.genre?.trim() || 'Unknown Genre';
    setResolvedGenre(currentGenre);
    setGenreStatus(isUnknownGenre(currentGenre) ? 'missing' : 'ready');
    setGenreFromCache(!isUnknownGenre(currentGenre));
    setGenreCachePath(null);
    setGenreLoading(false);

    if (!isUnknownGenre(currentGenre)) {
      setGenreLoading(false);
      return;
    }

    let alive = true;
    const cancel = scheduleDeferredIdle(() => {
      if (!alive) {
        return;
      }
      setGenreLoading(true);
      loadSongGenre(song)
        .then((result) => {
          if (!alive) {
            return;
          }

          setGenreStatus(result.status);
          setGenreCachePath(result.cachePath);

          if (result.status === 'ready') {
            setResolvedGenre(result.genre);
            setGenreFromCache(result.fromCache);
            if (isUnknownGenre(song.genre)) {
              void updateSongGenre(song.id, result.genre);
            }
          } else {
            setGenreFromCache(false);
          }
        })
        .finally(() => {
          if (alive) {
            setGenreLoading(false);
          }
        });
    });

    return () => {
      alive = false;
      cancel();
    };
  }, [song?.id, song?.genre, song?.artist, song?.title, updateSongGenre, gameMode, isPlaying]);

  useEffect(() => {
    if (gameMode) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistCachePath(null);
      setArtistFromCache(false);
      return;
    }

    if (!song?.artist) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistCachePath(null);
      setArtistFromCache(false);
      return;
    }

    let alive = true;
    setArtistLoading(false);
    setArtistStatus('missing');
    setArtistProfile(null);
    setArtistCachePath(null);
    setArtistFromCache(false);

    const cancel = scheduleDeferredIdle(() => {
      if (!alive) {
        return;
      }
      setArtistLoading(true);
      loadArtistProfile(song.artist)
        .then((result) => {
          if (!alive) {
            return;
          }

          setArtistStatus(result.status);
          setArtistCachePath(result.cachePath);

          if (result.status === 'ready') {
            setArtistProfile(result.profile);
            setArtistFromCache(result.fromCache);
          }
        })
        .finally(() => {
          if (alive) {
            setArtistLoading(false);
          }
        });
    });

    return () => {
      alive = false;
      cancel();
    };
  }, [song?.artist, gameMode, isPlaying]);

  return (
    <aside className="panel-surface flex h-full min-h-0 flex-col border-l border-amply-border/60 p-5">
      <p className="px-1 text-[13px] font-semibold text-amply-textSecondary">Now Playing</p>

      {!song ? (
        <div className="mt-4 flex-1 rounded-xl border border-amply-border/40 bg-amply-surface/30 p-4">
          <p className="text-[13px] text-amply-textMuted">Select a song to view track and artist details.</p>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1">
          <div className="space-y-4 border-b border-amply-border/40 pb-4">
            <div className="h-[240px] w-full overflow-hidden rounded-2xl bg-zinc-900/70 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
              {song.albumArt ? (
                <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-[18px] font-semibold text-amply-textPrimary">{song.title}</p>
              <p className="text-[13px] font-medium text-amply-textSecondary">{song.artist}</p>
              <p className="text-[12px] text-amply-textMuted">{song.album}</p>
              <div className="flex items-center gap-2 text-[11px] text-amply-textMuted">
                <span>{resolvedGenre}</span>
                <span className="h-1 w-1 rounded-full bg-amply-border/70" />
                <span>{formatDuration(song.duration)}</span>
              </div>
              {!gameMode ? (
                <p className="text-[11px] text-amply-textMuted">
                  Loudness:{' '}
                  {typeof song.loudnessLufs === 'number' ? `${song.loudnessLufs.toFixed(1)} LUFS` : 'Analyzing...'}
                </p>
              ) : null}
              {genreLoading ? <p className="text-[11px] text-amply-textMuted">Fetching genre...</p> : null}
              {!genreLoading && genreStatus === 'ready' && isUnknownGenre(song.genre) ? (
                <p className="text-[11px] text-amply-textMuted">
                  {genreFromCache ? 'Genre loaded from cache' : 'Genre saved to cache'}
                  {genreCachePath ? ` - ${genreCachePath}` : ''}
                </p>
              ) : null}
              {!genreLoading && genreStatus === 'no-internet' ? (
                <p className="text-[11px] text-amply-textMuted">No internet connection to fetch genre.</p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-amply-textMuted">About the Artist</p>

            {!idleReady ? (
              <p className="text-[12px] text-amply-textMuted">Warming up artist profile...</p>
            ) : null}

            {artistLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-amply-textSecondary">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-amply-border border-t-amply-accent" />
                <span>Loading artist info...</span>
              </div>
            ) : null}

            {idleReady && !artistLoading && artistStatus === 'ready' && artistProfile ? (
              <div className="space-y-3">
                {artistProfile.imageUrl ? (
                  <div className="h-[150px] w-full overflow-hidden rounded-2xl bg-zinc-900/60">
                    <img src={artistProfile.imageUrl} alt={artistProfile.artistName} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  </div>
                ) : null}
                <div className="max-h-44 overflow-y-auto pr-1">
                  <p className="text-[12px] leading-relaxed text-amply-textSecondary">{artistProfile.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-amply-textMuted">
                  <span>{artistFromCache ? 'Loaded from cache' : 'Saved to cache'}</span>
                  {isOffline ? <span>· No internet</span> : null}
                  {artistCachePath ? <span>· {artistCachePath}</span> : null}
                </div>
                {artistProfile.sourceUrl ? (
                  <a
                    href={artistProfile.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-amply-accent transition-colors hover:text-amply-accentHover"
                  >
                    Source
                  </a>
                ) : null}
              </div>
            ) : null}

            {!artistLoading && artistStatus === 'no-internet' ? (
              <p className="text-[12px] text-amply-textMuted">No internet connection to load artist details.</p>
            ) : null}

            {!artistLoading && artistStatus === 'missing' ? (
              <p className="text-[12px] text-amply-textMuted">Artist details not available for this track.</p>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
};

export default NowPlayingPanel;
