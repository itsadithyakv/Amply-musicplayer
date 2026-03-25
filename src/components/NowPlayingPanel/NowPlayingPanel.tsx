import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import retryIcon from '@/assets/icons/repeat.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import {
  readCachedArtistProfile,
  loadArtistProfile,
  type ArtistProfile,
  type ArtistProfileLoadResult,
} from '@/services/artistProfileService';
import { formatDuration } from '@/utils/time';
import { useIdleRender } from '@/hooks/useIdleRender';
import { useMetadataPriority } from '@/hooks/useMetadataPriority';
import { getPrimaryArtistName, splitArtistNames } from '@/utils/artists';
import {
  getAlbumTracklistKey,
  loadAlbumTracklist,
  loadAlbumTracklistCache,
  normalizeTrackTitle,
  type AlbumTracklist,
} from '@/services/albumTracklistService';
import { releaseMetadata, tryAcquireMetadata } from '@/services/metadataAttemptService';
import {
  getAlbumQueueCacheKey,
  getArtistQueueCacheKey,
  getCachedQueue,
  getGenreQueueCacheKey,
  setCachedQueue,
} from '@/services/queueCacheService';
import { isUnknownGenre } from '@/services/songMetadataService';

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
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);
  const fetchMissingMetadataForSong = useLibraryStore((state) => state.fetchMissingMetadataForSong);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const setAlbumQueueView = usePlayerStore((state) => state.setAlbumQueueView);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const songs = useLibraryStore((state) => state.songs);
  const metadataFetchDone = useLibraryStore((state) => state.metadataFetch.done);
  const navigate = useNavigate();
  const songsById = useMemo(() => new Map(songs.map((entry) => [entry.id, entry])), [songs]);
  const song = currentSongId ? songs.find((entry) => entry.id === currentSongId) : undefined;
  const primaryArtist = song ? getPrimaryArtistName(song.artist) : null;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistStatus, setArtistStatus] = useState<ArtistProfileLoadResult['status']>('missing');
  const [artistCachePath, setArtistCachePath] = useState<string | null>(null);
  const [artistFromCache, setArtistFromCache] = useState(false);
  const [artistChecked, setArtistChecked] = useState(false);
  const [resolvedGenre, setResolvedGenre] = useState<string>('Unknown Genre');
  const idleReady = useIdleRender(300);
  const { onSongChange, shouldLoadExpensiveMetadata } = useMetadataPriority();
  const lastArtistRef = useRef<string | null>(null);

  useEffect(() => {
    if (gameMode) {
      setResolvedGenre('Unknown Genre');
      return;
    }

    if (!song) {
      setResolvedGenre('Unknown Genre');
      return;
    }

    const currentGenre = song.genre?.trim() || 'Unknown Genre';
    setResolvedGenre(currentGenre);

    // Notify priority system of song change
    onSongChange();
  }, [song?.id, song?.genre, gameMode, onSongChange]);

  useEffect(() => {
    if (gameMode) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistCachePath(null);
      setArtistFromCache(false);
      setArtistChecked(false);
      lastArtistRef.current = null;
      return;
    }

    if (!primaryArtist) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistCachePath(null);
      setArtistFromCache(false);
      setArtistChecked(false);
      lastArtistRef.current = null;
      return;
    }

    let alive = true;
    const normalizedArtist = primaryArtist.trim();
    const isSameArtist = lastArtistRef.current === normalizedArtist;
    lastArtistRef.current = normalizedArtist;

    if (!isSameArtist) {
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistProfile(null);
      setArtistCachePath(null);
      setArtistFromCache(false);
      setArtistChecked(false);
    }

    const retryTimers: number[] = [];

    const scheduleRetry = () => {
      const handle = window.setTimeout(() => {
        if (!alive) {
          return;
        }
        const artistKey = primaryArtist.trim().toLowerCase();
        if (!artistKey || !tryAcquireMetadata('artist', artistKey)) {
          return;
        }
        setArtistLoading(true);
        loadArtistProfile(primaryArtist)
          .then((fresh) => {
            if (!alive) {
              return;
            }
            setArtistStatus(fresh.status);
            setArtistCachePath(fresh.cachePath);
            setArtistChecked(true);
            if (fresh.status === 'ready') {
              setArtistProfile(fresh.profile);
              setArtistFromCache(fresh.fromCache);
            }
          })
          .finally(() => {
            releaseMetadata('artist', artistKey);
            if (alive) {
              setArtistLoading(false);
            }
          });
      }, 1600);
      retryTimers.push(handle);
    };

    const cancel = scheduleDeferredIdle(() => {
      if (!alive) {
        return;
      }
      if (isSameArtist && artistProfile) {
        return;
      }
      setArtistLoading(true);
      readCachedArtistProfile(primaryArtist)
        .then((result) => {
          if (!alive) {
            return;
          }

          setArtistStatus(result.status);
          setArtistCachePath(result.cachePath);
          if (result.status !== 'missing') {
            setArtistChecked(true);
          } else {
            setArtistChecked(false);
          }

          if (result.status === 'ready') {
            setArtistProfile(result.profile);
            setArtistFromCache(result.fromCache);
            return;
          }
          if (isOffline) {
            setArtistChecked(true);
            return;
          }

          // Check if we should load expensive metadata (network calls)
          if (!shouldLoadExpensiveMetadata()) {
            // User is rapidly changing songs, skip expensive operations
            scheduleRetry();
            return;
          }

          const artistKey = primaryArtist.trim().toLowerCase();
          if (!artistKey || !tryAcquireMetadata('artist', artistKey)) {
            return;
          }
          loadArtistProfile(primaryArtist)
            .then((fresh) => {
              if (!alive) {
                return;
              }
              setArtistStatus(fresh.status);
              setArtistCachePath(fresh.cachePath);
              setArtistChecked(true);
              if (fresh.status === 'ready') {
                setArtistProfile(fresh.profile);
                setArtistFromCache(fresh.fromCache);
              }
            })
            .finally(() => {
              releaseMetadata('artist', artistKey);
            });
        })
        .finally(() => {
          if (alive) {
            setArtistLoading(false);
          }
        });
    });

    return () => {
      alive = false;
      retryTimers.forEach((handle) => window.clearTimeout(handle));
      cancel();
    };
  }, [primaryArtist, gameMode, artistProfile, metadataFetchDone, metadataFetchPaused, isOffline]);

  const openAlbumQueue = useCallback(
    async (current: NonNullable<typeof song>) => {
      if (!current.album?.trim()) {
        return;
      }
      const albumKey = getAlbumQueueCacheKey(getPrimaryArtistName(current.artist), current.album);
      const cached = await getCachedQueue('albums', albumKey, songs);
      const albumSongs = cached
        ? cached.songIds
            .map((id) => songsById.get(id))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        : songs.filter((entry) => entry.album === current.album);
      if (!albumSongs.length) {
        return;
      }
      if (!cached) {
        await setCachedQueue(
          'albums',
          albumKey,
          albumSongs.map((entry) => entry.id),
          songs,
        );
      }
      const primary = getPrimaryArtistName(current.artist);
      const key = getAlbumTracklistKey(primary, current.album);
      const cache = await loadAlbumTracklistCache();
      let tracklist: AlbumTracklist | null = cache[key] ?? null;

      if (!tracklist && !metadataFetchPaused && tryAcquireMetadata('album_tracklist', key)) {
        try {
          tracklist = await loadAlbumTracklist(primary, current.album);
        } finally {
          releaseMetadata('album_tracklist', key);
        }
      }

      const byTrack = new Map<number, (typeof albumSongs)[number]>();
      const byTitle = new Map<string, (typeof albumSongs)[number]>();
      for (const entry of albumSongs) {
        if (entry.track && entry.track > 0 && !byTrack.has(entry.track)) {
          byTrack.set(entry.track, entry);
        }
        const normalized = normalizeTrackTitle(entry.title);
        if (normalized && !byTitle.has(normalized)) {
          byTitle.set(normalized, entry);
        }
      }

      const orderedSongs: (typeof albumSongs)[number][] = [];
      const viewItems: Array<{ id?: string; title: string; position: number; available: boolean }> = [];

      if (tracklist?.tracks?.length) {
        for (const track of tracklist.tracks) {
          const normalized = normalizeTrackTitle(track.title);
          const match = byTrack.get(track.position) ?? (normalized ? byTitle.get(normalized) : undefined);
          if (match && !orderedSongs.some((songEntry) => songEntry.id === match.id)) {
            orderedSongs.push(match);
            viewItems.push({ id: match.id, title: track.title, position: track.position, available: true });
          } else {
            viewItems.push({ title: track.title, position: track.position, available: false });
          }
        }
      }

      if (!orderedSongs.length) {
        const fallback = [...albumSongs].sort((a, b) => a.title.localeCompare(b.title) || a.filename.localeCompare(b.filename));
        orderedSongs.push(...fallback);
        if (!viewItems.length) {
          fallback.forEach((entry, index) => {
            viewItems.push({ id: entry.id, title: entry.title, position: index + 1, available: true });
          });
        }
      } else {
        const fallback = [...albumSongs].sort((a, b) => a.title.localeCompare(b.title) || a.filename.localeCompare(b.filename));
        for (const entry of fallback) {
          if (!orderedSongs.some((existing) => existing.id === entry.id)) {
            orderedSongs.push(entry);
          }
        }
      }

      const queue = orderedSongs.map((entry) => entry.id);
      setQueue(queue, orderedSongs[0]?.id);
      setAlbumQueueView({
        album: current.album,
        artist: primary,
        items: viewItems,
      });
      setNowPlayingTab('queue');
      navigate('/now-playing');
      if (orderedSongs[0]) {
        void playSongById(orderedSongs[0].id, false);
      }
    },
    [songs, songsById, metadataFetchPaused, setQueue, setAlbumQueueView, setNowPlayingTab, navigate, playSongById],
  );

  const openArtistQueue = useCallback(
    async (current: NonNullable<typeof song>) => {
      const primary = getPrimaryArtistName(current.artist);
      if (!primary) {
        return;
      }
      const artistKey = getArtistQueueCacheKey(primary);
      const cached = await getCachedQueue('artists', artistKey, songs);
      const artistSongs = cached
        ? cached.songIds
            .map((id) => songsById.get(id))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        : songs.filter((entry) =>
            splitArtistNames(entry.artist).some((name) => name.toLowerCase() === primary.toLowerCase()),
          );
      if (!artistSongs.length) {
        return;
      }
      if (!cached) {
        await setCachedQueue(
          'artists',
          artistKey,
          artistSongs.map((entry) => entry.id),
          songs,
        );
      }
      const ordered = [...artistSongs].sort(
        (a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title),
      );
      const queue = ordered.map((entry) => entry.id);
      setQueue(queue, ordered[0].id);
      setNowPlayingTab('queue');
      navigate('/now-playing');
      void playSongById(ordered[0].id, false);
    },
    [songs, songsById, setQueue, setNowPlayingTab, navigate, playSongById],
  );

  const openGenreQueue = useCallback(
    async (current: NonNullable<typeof song>) => {
      const genreLabel = current.genre?.trim() || '';
      if (!genreLabel || genreLabel.toLowerCase() === 'unknown genre') {
        return;
      }
      const genreKey = getGenreQueueCacheKey(genreLabel);
      const cached = await getCachedQueue('genres', genreKey, songs);
      const genreSongs = cached
        ? cached.songIds
            .map((id) => songsById.get(id))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        : songs.filter((entry) => (entry.genre?.trim() || '').toLowerCase() === genreLabel.toLowerCase());
      if (!genreSongs.length) {
        return;
      }
      if (!cached) {
        await setCachedQueue(
          'genres',
          genreKey,
          genreSongs.map((entry) => entry.id),
          songs,
        );
      }
      const ordered = [...genreSongs].sort(
        (a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title),
      );
      const queue = ordered.map((entry) => entry.id);
      setQueue(queue, ordered[0].id);
      setNowPlayingTab('queue');
      navigate('/now-playing');
      void playSongById(ordered[0].id, false);
    },
    [songs, songsById, setQueue, setNowPlayingTab, navigate, playSongById],
  );

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
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    void openArtistQueue(song);
                  }}
                  className="text-left text-[13px] font-medium text-amply-textSecondary transition-colors hover:text-amply-textPrimary"
                >
                  {getPrimaryArtistName(song.artist)}
                </button>
                {song.album ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openAlbumQueue(song);
                    }}
                    className="text-left text-[12px] text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                  >
                    {song.album}
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-amply-textMuted">
                {isUnknownGenre(resolvedGenre) ? (
                  <span>{resolvedGenre}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void openGenreQueue(song);
                    }}
                    className="text-[11px] text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                  >
                    {resolvedGenre}
                  </button>
                )}
                <span className="h-1 w-1 rounded-full bg-amply-border/70" />
                <span>{formatDuration(song.duration)}</span>
              </div>
              {!gameMode ? (
                <p className="text-[11px] text-amply-textMuted">
                  Loudness:{' '}
                  {typeof song.loudnessLufs === 'number' ? `${song.loudnessLufs.toFixed(1)} LUFS` : 'Analyzing...'}
                </p>
              ) : null}
              {isUnknownGenre(resolvedGenre) ? (
                <p className="text-[11px] text-amply-textMuted">Genre not cached yet.</p>
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

            {!artistLoading && artistChecked && artistStatus === 'missing' ? (
              <p className="text-[12px] text-amply-textMuted">Artist details not available for this track.</p>
            ) : null}

            {artistChecked && !artistLoading && artistStatus !== 'ready' ? (
              <div className="pt-2">
                <button
                  type="button"
                  aria-label="Retry metadata"
                  title="Retry metadata"
                  disabled={!song}
                  onClick={() => {
                    if (!song) {
                      return;
                    }
                    void fetchMissingMetadataForSong(song.id, {
                      forceRetry: true,
                      ignoreCooldown: true,
                      allowWhenPaused: true,
                    });
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amply-border/60 text-amply-textSecondary transition-colors hover:text-amply-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <img src={retryIcon} alt="" className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
};

export default memo(NowPlayingPanel);
