import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button, Divider, Kicker, Spinner } from '@/components/ui';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { getSongsByIds } from '@/store/libraryDataStore';
import {
  readCachedArtistProfile,
  loadArtistProfile,
  type ArtistProfile,
  type ArtistProfileLoadResult,
} from '@/services/artistProfileService';
import { formatDuration } from '@/utils/time';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { useIdleRender } from '@/hooks/useIdleRender';
import { useMetadataPriority } from '@/hooks/useMetadataPriority';
import { getMetadataArtistName, getPrimaryArtistName, splitArtistNames } from '@/utils/artists';
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
import {
  getNonCriticalDelay,
  scheduleNonCriticalTask,
  shouldThrottleNonCriticalWork,
} from '@/services/appScheduler';
import { useCurrentSongSnapshot } from '@/hooks/useLibraryViews';
import { recordPerfEvent } from '@/services/perfDiagnostics';

const reportArtistProfileError = (stage: string, error: unknown): void => {
  recordPerfEvent('now-playing.artist-profile.error', {
    stage,
    error: error instanceof Error ? error.message : String(error),
  });
};

const scheduleIdle = (task: () => void, timeoutMs = 300): (() => void) => {
  return scheduleNonCriticalTask(() => {
    if (shouldThrottleNonCriticalWork()) {
      return;
    }
    task();
  }, { timeoutMs, reason: 'now-playing-panel.idle' });
};

const scheduleDeferredIdle = (task: () => void, delayMs = 1200, idleTimeoutMs = 1200): (() => void) => {
  let idleCancel: (() => void) | null = null;
  const timeoutHandle = window.setTimeout(() => {
    idleCancel = scheduleIdle(task, idleTimeoutMs);
  }, getNonCriticalDelay(delayMs));

  return () => {
    window.clearTimeout(timeoutHandle);
    if (idleCancel) {
      idleCancel();
    }
  };
};

const NowPlayingPanel = () => {
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);
  const fetchMissingMetadataForSong = useLibraryStore((state) => state.fetchMissingMetadataForSong);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const setAlbumQueueView = usePlayerStore((state) => state.setAlbumQueueView);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const { song } = useCurrentSongSnapshot();
  const songId = song?.id ?? null;
  const songGenre = song?.genre ?? null;
  const navigate = useNavigate();
  const primaryArtist = song ? getMetadataArtistName(song.artist, song.title) : null;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistStatus, setArtistStatus] = useState<ArtistProfileLoadResult['status']>('missing');
  const [artistChecked, setArtistChecked] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [artistRefreshing, setArtistRefreshing] = useState(false);
  const [resolvedGenre, setResolvedGenre] = useState<string>('Unknown Genre');
  const idleReady = useIdleRender(300);
  const { onSongChange, shouldLoadExpensiveMetadata } = useMetadataPriority();
  const lastArtistRef = useRef<string | null>(null);
  // Mirrors `artistProfile` for the deferred artist-load callback below, which must see the latest
  // value without re-running the effect (and re-fetching) every time the profile changes.
  const artistProfileRef = useRef<ArtistProfile | null>(null);

  useEffect(() => {
    artistProfileRef.current = artistProfile;
  }, [artistProfile]);

  useEffect(() => {
    if (gameMode) {
      setResolvedGenre('Unknown Genre');
      return;
    }

    if (!songId) {
      setResolvedGenre('Unknown Genre');
      return;
    }

    const currentGenre = songGenre?.trim() || 'Unknown Genre';
    setResolvedGenre(currentGenre);

    // Notify priority system of song change
    onSongChange();
  }, [songId, songGenre, gameMode, onSongChange]);

  useEffect(() => {
    if (gameMode) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistChecked(false);
      lastArtistRef.current = null;
      return;
    }

    if (!primaryArtist) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
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
      setArtistChecked(false);
      setSummaryExpanded(false);
    }

    const retryTimers: number[] = [];
    let retryAttempts = 0;

    const scheduleRetry = () => {
      if (retryAttempts >= 10) {
        setArtistChecked(true);
        return;
      }
      retryAttempts += 1;
      const handle = window.setTimeout(() => {
        if (!alive) {
          return;
        }
        const artistKey = primaryArtist.trim().toLowerCase();
        if (!artistKey) {
          return;
        }
        if (!tryAcquireMetadata('artist', artistKey)) {
          // The library store's own metadata pass owns the artist lock right now; it will fill the
          // cache, so keep re-reading instead of leaving the panel blank.
          readCachedArtistProfile(primaryArtist)
            .then((cached) => {
              if (!alive) {
                return;
              }
              if (cached.status === 'ready') {
                setArtistStatus('ready');
                setArtistChecked(true);
                setArtistProfile(cached.profile);
                return;
              }
              scheduleRetry();
            })
            .catch((error) => reportArtistProfileError('retry-read', error));
          return;
        }
        setArtistLoading(true);
        loadArtistProfile(primaryArtist, { waitForIdle: false })
          .then((fresh) => {
            if (!alive) {
              return;
            }
            setArtistStatus(fresh.status);
            setArtistChecked(true);
            if (fresh.status === 'ready') {
              setArtistProfile(fresh.profile);
            }
          })
          .catch((error) => reportArtistProfileError('retry-load', error))
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
      if (isSameArtist && artistProfileRef.current) {
        return;
      }
      setArtistLoading(true);
      readCachedArtistProfile(primaryArtist)
        .then((result) => {
          if (!alive) {
            return;
          }

          setArtistStatus(result.status);
          if (result.status !== 'missing') {
            setArtistChecked(true);
          } else {
            setArtistChecked(false);
          }

          if (result.status === 'ready') {
            setArtistProfile(result.profile);
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
          if (!artistKey) {
            return;
          }
          if (!tryAcquireMetadata('artist', artistKey)) {
            scheduleRetry();
            return;
          }
          loadArtistProfile(primaryArtist, { waitForIdle: false })
            .then((fresh) => {
              if (!alive) {
                return;
              }
              setArtistStatus(fresh.status);
              setArtistChecked(true);
              if (fresh.status === 'ready') {
                setArtistProfile(fresh.profile);
              }
            })
            .catch((error) => reportArtistProfileError('load', error))
            .finally(() => {
              releaseMetadata('artist', artistKey);
            });
        })
        .catch((error) => reportArtistProfileError('read-cache', error))
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
  }, [primaryArtist, gameMode, metadataFetchPaused, isOffline, shouldLoadExpensiveMetadata]);

  // Manual retry: bypass every cooldown and idle gate, then read the answer back directly instead of
  // waiting for the deferred effect (which may be throttled right after the click).
  const retryArtistProfile = useCallback(async () => {
    if (!song || !primaryArtist || artistRefreshing) {
      return;
    }
    setArtistRefreshing(true);
    setArtistLoading(true);
    try {
      await fetchMissingMetadataForSong(song.id, { forceRetry: true, ignoreCooldown: true, allowWhenPaused: true });
      let result = await readCachedArtistProfile(primaryArtist);
      if (result.status !== 'ready') {
        result = await loadArtistProfile(primaryArtist, { waitForIdle: false });
      }
      setArtistStatus(result.status);
      if (result.status === 'ready') {
        setArtistProfile(result.profile);
      }
    } catch (error) {
      reportArtistProfileError('retry-metadata', error);
    } finally {
      setArtistChecked(true);
      setArtistLoading(false);
      setArtistRefreshing(false);
    }
  }, [song, primaryArtist, artistRefreshing, fetchMissingMetadataForSong]);

  const openAlbumQueue = useCallback(
    async (current: NonNullable<typeof song>) => {
      const songs = useLibraryStore.getState().songs;
      if (!current.album?.trim()) {
        return;
      }
      const albumKey = getAlbumQueueCacheKey(getPrimaryArtistName(current.artist), current.album);
      const cached = await getCachedQueue('albums', albumKey, songs);
      const albumSongs = cached
        ? getSongsByIds(cached.songIds)
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
    [metadataFetchPaused, setQueue, setAlbumQueueView, setNowPlayingTab, navigate, playSongById],
  );

  const openArtistQueue = useCallback(
    async (current: NonNullable<typeof song>) => {
      const songs = useLibraryStore.getState().songs;
      const primary = getPrimaryArtistName(current.artist);
      if (!primary) {
        return;
      }
      const artistKey = getArtistQueueCacheKey(primary);
      const cached = await getCachedQueue('artists', artistKey, songs);
      const artistSongs = cached
        ? getSongsByIds(cached.songIds)
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
    [setQueue, setNowPlayingTab, navigate, playSongById],
  );

  const openGenreQueue = useCallback(
    async (current: NonNullable<typeof song>) => {
      const songs = useLibraryStore.getState().songs;
      const genreLabel = current.genre?.trim() || '';
      if (!genreLabel || genreLabel.toLowerCase() === 'unknown genre') {
        return;
      }
      const genreKey = getGenreQueueCacheKey(genreLabel);
      const cached = await getCachedQueue('genres', genreKey, songs);
      const genreSongs = cached
        ? getSongsByIds(cached.songIds)
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
    [setQueue, setNowPlayingTab, navigate, playSongById],
  );

  const openArtistSource = useCallback(async (sourceUrl: string | null | undefined) => {
    if (!sourceUrl) {
      return;
    }

    try {
      await openUrl(sourceUrl);
    } catch {
      window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-amply-bg px-4 py-5 shadow-[inset_1px_0_0_rgb(var(--amply-edge)/var(--edge-a))]">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-amply-textPrimary">Now playing</p>
        </div>
        {song ? (
          <Button variant="ghost" size="sm" iconRight="chevron-right" onClick={() => navigate('/now-playing')}>
            Open view
          </Button>
        ) : null}
      </div>
      <Divider accentLead className="mt-4" />

      {!song ? (
        <div className="neu-well mt-4 flex flex-1 flex-col items-center justify-center rounded-md px-6 text-center">
          <div className="neu-raised-sm mb-4 flex h-12 w-12 items-center justify-center rounded-full text-[18px] text-amply-textMuted" aria-hidden="true">♪</div>
          <p className="text-[13px] font-medium text-amply-textPrimary">Nothing playing</p>
          <p className="mt-1 text-[12px] leading-relaxed text-amply-textMuted">Choose a track to see its artwork and artist details.</p>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1 pb-20 pr-2">
          <div className="anim-stagger space-y-4 pb-5">
            <div className="neu-raised aspect-square w-full overflow-hidden rounded-lg">
              {song.albumArt ? (
                <ArtworkImage src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="eager" forceReady />
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="line-clamp-2 text-[20px] font-semibold leading-tight tracking-[-0.035em] text-amply-textPrimary">{song.title}</p>
              <div className="flex min-w-0 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    void openArtistQueue(song);
                  }}
                  className="truncate text-left text-[13px] font-medium text-amply-textSecondary transition-colors hover:text-amply-textPrimary"
                >
                  {primaryArtist ?? getPrimaryArtistName(song.artist)}
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
              <div className="flex items-center gap-2 text-[12px] text-amply-textMuted">
                {isUnknownGenre(resolvedGenre) ? (
                  <span>{resolvedGenre}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void openGenreQueue(song);
                    }}
                    className="text-[12px] text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                  >
                    {resolvedGenre}
                  </button>
                )}
                <span className="h-1 w-1 rounded-full bg-amply-textMuted/60" aria-hidden="true" />
                <span>{formatDuration(song.duration)}</span>
              </div>
              {isUnknownGenre(resolvedGenre) ? (
                <p className="text-[12px] text-amply-textMuted">Genre not cached yet.</p>
              ) : null}
            </div>
          </div>
          <Divider />

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
            <Kicker>About artist</Kicker>

            {!idleReady ? (
              <p className="text-[12px] text-amply-textMuted">Warming up artist profile...</p>
            ) : null}

            {artistLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-amply-textSecondary">
                <Spinner size={16} label="Loading artist info" />
                <span>{artistRefreshing ? 'Looking the artist up again...' : 'Loading artist info...'}</span>
              </div>
            ) : null}

            {idleReady && !artistLoading && artistStatus === 'ready' && artistProfile ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="neu-well aspect-[16/9] w-full overflow-hidden rounded-md">
                  {artistProfile.imageUrl ? (
                    <ArtworkImage
                      src={artistProfile.imageUrl}
                      alt={primaryArtist ?? getPrimaryArtistName(song.artist)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-[12px] text-amply-textMuted">
                      Artist image not cached yet.
                    </div>
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  <p className={summaryExpanded ? 'text-[12px] leading-relaxed text-amply-textSecondary' : 'line-clamp-4 text-[12px] leading-relaxed text-amply-textSecondary'}>{artistProfile.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-amply-textMuted">
                  <button type="button" onClick={() => setSummaryExpanded((current) => !current)} className="font-medium text-amply-textPrimary">{summaryExpanded ? 'Show less' : 'Read more'}</button>
                  {isOffline ? <span>· Offline</span> : null}
                </div>
                {artistProfile.sourceUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconRight="external-link"
                    className="w-fit"
                    onClick={() => {
                      void openArtistSource(artistProfile.sourceUrl);
                    }}
                  >
                    Source
                  </Button>
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
                <Button variant="secondary" size="sm" icon="refresh" disabled={!song} onClick={() => void retryArtistProfile()}>
                  Try again
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
};

export default memo(NowPlayingPanel);
