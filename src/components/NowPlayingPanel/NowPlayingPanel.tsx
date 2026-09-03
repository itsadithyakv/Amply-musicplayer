import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import retryIcon from '@/assets/icons/repeat.svg';
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
  const navigate = useNavigate();
  const primaryArtist = song ? getMetadataArtistName(song.artist, song.title) : null;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistStatus, setArtistStatus] = useState<ArtistProfileLoadResult['status']>('missing');
  const [artistChecked, setArtistChecked] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [artistRefreshToken, setArtistRefreshToken] = useState(0);
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
          if (!artistKey || !tryAcquireMetadata('artist', artistKey)) {
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
  }, [primaryArtist, gameMode, metadataFetchPaused, isOffline, shouldLoadExpensiveMetadata, artistRefreshToken]);

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
    <aside className="panel-surface flex h-full min-h-0 flex-col border-l border-amply-border/40 px-4 py-5">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="amply-kicker">Now playing</p>
          <p className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-amply-textPrimary">Track &amp; artist</p>
        </div>
        {song ? <button type="button" onClick={() => navigate('/now-playing')} className="text-[11px] font-medium text-amply-textMuted hover:text-amply-textPrimary">Open view</button> : null}
      </div>
      <div className="amply-hairline mt-4" />

      {!song ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-[20px] border border-dashed border-amply-border/45 px-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-amply-border/40 text-[18px] text-amply-textMuted">♪</div>
          <p className="text-[13px] font-medium text-amply-textPrimary">Nothing playing</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amply-textMuted">Choose a track to see its artwork and artist details.</p>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1 pb-20 pr-2">
          <div className="space-y-4 border-b border-[var(--divider-soft)] pb-5">
            <div className="aspect-square w-full overflow-hidden rounded-[20px] bg-amply-bgSecondary shadow-[var(--artwork-shadow)]">
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
              {isUnknownGenre(resolvedGenre) ? (
                <p className="text-[11px] text-amply-textMuted">Genre not cached yet.</p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
            <p className="amply-kicker">About artist</p>

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
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="aspect-[16/9] w-full overflow-hidden rounded-[14px] bg-amply-bgSecondary">
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
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-amply-textMuted">
                  <button type="button" onClick={() => setSummaryExpanded((current) => !current)} className="font-medium text-amply-textPrimary">{summaryExpanded ? 'Show less' : 'Read more'}</button>
                  {isOffline ? <span>· Offline</span> : null}
                </div>
                {artistProfile.sourceUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openArtistSource(artistProfile.sourceUrl);
                    }}
                    className="inline-flex w-fit items-center text-[11px] font-medium text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                  >
                    Source
                  </button>
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
                    }).then(() => setArtistRefreshToken((current) => current + 1));
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
