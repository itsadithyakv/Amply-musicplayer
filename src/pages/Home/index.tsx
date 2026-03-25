import clsx from 'clsx';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { readCachedArtistProfile } from '@/services/artistProfileService';
import { getAlbumTracklistKey, loadAlbumTracklistCache, normalizeTrackTitle } from '@/services/albumTracklistService';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist, Song } from '@/types/music';
import { getPrimaryArtistName, splitArtistNames } from '@/utils/artists';

const SectionRow = ({
  title,
  songs,
  onPick,
  scrollable = false,
}: {
  title: string;
  songs: Song[];
  onPick: (song: Song) => void;
  scrollable?: boolean;
}) => {
  if (!songs.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[20px] font-semibold text-amply-textPrimary">{title}</h2>
      {scrollable ? (
        <div className="flex gap-5 overflow-x-auto pb-3 pr-2">
          {songs.map((song) => (
            <div
              key={`${title}-${song.id}`}
              className="card-sheen group min-w-[200px] max-w-[220px] flex-1 overflow-hidden rounded-card border border-amply-border/60 bg-amply-surface/60 p-1 shadow-card transition-transform duration-200 ease-smooth hover:-translate-y-1 hover:shadow-lift"
            >
              <AlbumCard title={song.title} subtitle={song.artist} artwork={song.albumArt} onClick={() => onPick(song)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5">
          {songs.map((song) => (
            <div
              key={`${title}-${song.id}`}
              className="card-sheen group overflow-hidden rounded-card border border-amply-border/60 bg-amply-surface/60 p-1 shadow-card transition-transform duration-200 ease-smooth hover:-translate-y-1 hover:shadow-lift"
            >
              <AlbumCard title={song.title} subtitle={song.artist} artwork={song.albumArt} onClick={() => onPick(song)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

interface TopArtistEntry {
  artistName: string;
  topSong: Song;
  songIds: string[];
}

interface PlaylistCardItem {
  id: string;
  baseId: string;
  title: string;
  subtitle: string;
  artwork?: string;
  artworks?: string[];
  songIds: string[];
  description?: string;
  startSongId?: string;
  kind: 'smart' | 'custom';
}

const playlistToneClasses = [
  'bg-gradient-to-br from-[#1f2a45] via-[#151b26] to-[#0f1218]',
  'bg-gradient-to-br from-[#3a2614] via-[#22170e] to-[#14110c]',
  'bg-gradient-to-br from-[#1a352d] via-[#121f1b] to-[#0c1311]',
  'bg-gradient-to-br from-[#3a1d34] via-[#23131f] to-[#130b11]',
];

const playlistGlowClasses = [
  'shadow-[0_0_0_1px_rgba(90,130,255,0.16),0_14px_30px_rgba(17,24,39,0.6)]',
  'shadow-[0_0_0_1px_rgba(255,170,90,0.16),0_14px_30px_rgba(20,12,8,0.6)]',
  'shadow-[0_0_0_1px_rgba(96,220,170,0.16),0_14px_30px_rgba(9,16,13,0.6)]',
  'shadow-[0_0_0_1px_rgba(210,120,230,0.16),0_14px_30px_rgba(17,10,15,0.6)]',
];

const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const scheduleIdleTask = (task: () => void, timeoutMs = 300): (() => void) => {
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


const HomePage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const playlists = useLibraryStore((state) => state.playlists);
  const regenerateSmartPlaylists = useLibraryStore((state) => state.regenerateSmartPlaylists);
  const smartPlaylistSeed = useLibraryStore((state) => state.smartPlaylistSeed);
  const regeneratingSmartPlaylists = useLibraryStore((state) => state.regeneratingSmartPlaylists);
  const playlistUsage = useLibraryStore((state) => state.playlistUsage);
  const metadataFetchDone = useLibraryStore((state) => state.metadataFetch.done);
  const recordPlaylistUse = useLibraryStore((state) => state.recordPlaylistUse);
  const navigate = useNavigate();

  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const [showMoreMixes, setShowMoreMixes] = useState(false);
  const [artistImages, setArtistImages] = useState<Record<string, string | undefined>>({});
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>([]);
  const [rediscoverSongs, setRediscoverSongs] = useState<Song[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const [topArtists, setTopArtists] = useState<TopArtistEntry[]>([]);
  const [smartPlaylistCards, setSmartPlaylistCards] = useState<PlaylistCardItem[]>([]);
  const [smartPlaylistLoading, setSmartPlaylistLoading] = useState(true);
  const [smartMixesAll, setSmartMixesAll] = useState<PlaylistCardItem[]>([]);
  const [albumTracklistCache, setAlbumTracklistCache] = useState<Record<string, { tracks?: Array<{ position: number; title: string }> }>>({});
  const [smartPlaylistRenderSeed, setSmartPlaylistRenderSeed] = useState(() => smartPlaylistSeed || Date.now());
  const clickTimerRef = useRef<number | null>(null);
  const clickTargetRef = useRef<string | null>(null);
  const albumSubtitleCacheRef = useRef<Map<string, string>>(new Map());
  const wasRegeneratingRef = useRef(regeneratingSmartPlaylists);
  const smartMixCount = useMemo(
    () => playlists.filter((playlist) => playlist.type === 'smart' && playlist.songIds.length).length,
    [playlists],
  );
  const showMoreMixesCard = smartMixCount > 0;

  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const allSongIds = useMemo(() => songs.map((song) => song.id), [songs]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const cache = await loadAlbumTracklistCache();
      if (alive) {
        setAlbumTracklistCache(cache);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [songs.length, playlists.length]);

  const getAlbumSpotlightSubtitle = useCallback(
    (playlist: Playlist): string => {
      if (playlist.id !== 'smart_album_spotlight') {
        return `${playlist.songIds.length} songs`;
      }
      const songsInPlaylist = playlist.songIds.map((id) => songsById.get(id)).filter((entry): entry is Song => Boolean(entry));
      const first = songsInPlaylist[0];
      if (!first) {
        return `${playlist.songIds.length} songs`;
      }
      const cacheKey = `${playlist.id}:${first.id}`;
      const key = getAlbumTracklistKey(getPrimaryArtistName(first.artist), first.album);
      const tracklist = albumTracklistCache[key];
      if (!tracklist?.tracks?.length) {
        return albumSubtitleCacheRef.current.get(cacheKey) ?? `${playlist.songIds.length} songs`;
      }
      const byTrack = new Map<number, Song>();
      const byTitle = new Map<string, Song>();
      for (const song of songsInPlaylist) {
        if (song.track && song.track > 0 && !byTrack.has(song.track)) {
          byTrack.set(song.track, song);
        }
        const normalized = normalizeTrackTitle(song.title);
        if (normalized && !byTitle.has(normalized)) {
          byTitle.set(normalized, song);
        }
      }
      let available = 0;
      for (const track of tracklist.tracks) {
        const normalized = normalizeTrackTitle(track.title);
        const match = byTrack.get(track.position) ?? (normalized ? byTitle.get(normalized) : undefined);
        if (match) {
          available += 1;
        }
      }
      const next = `${available}/${tracklist.tracks.length} available`;
      albumSubtitleCacheRef.current.set(cacheKey, next);
      return next;
    },
    [albumTracklistCache, songsById],
  );

  const handleSmartCardClick = useCallback(
    (id: string, onClick: () => void, onDoubleClick: () => void) => {
      if (clickTimerRef.current && clickTargetRef.current !== id) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (clickTimerRef.current && clickTargetRef.current === id) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        clickTargetRef.current = null;
        onDoubleClick();
        return;
      }
      clickTargetRef.current = id;
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        clickTargetRef.current = null;
        onClick();
      }, 220);
    },
    [],
  );

  useEffect(() => {
    if (smartPlaylistSeed) {
      setSmartPlaylistRenderSeed(smartPlaylistSeed);
    }
  }, [smartPlaylistSeed]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickTargetRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wasRegenerating = wasRegeneratingRef.current;
    if (wasRegenerating && !regeneratingSmartPlaylists) {
      setSmartPlaylistRenderSeed(Date.now());
    }
    wasRegeneratingRef.current = regeneratingSmartPlaylists;
  }, [regeneratingSmartPlaylists]);

  useEffect(() => {
    let alive = true;
    const cancel = scheduleIdleTask(() => {
      if (!alive) {
        return;
      }
      const next = [...songs]
        .filter((song) => song.lastPlayed)
        .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        .slice(0, 16);
      setRecentlyPlayed(next);
    }, 150);
    return () => {
      alive = false;
      cancel();
    };
  }, [songs]);

  useEffect(() => {
    let alive = true;
    const cancel = scheduleIdleTask(() => {
      if (!alive) {
        return;
      }
      const rediscover = playlists.find((playlist) => playlist.id === 'smart_rediscover');
      if (!rediscover) {
        startTransition(() => {
          setRediscoverSongs([]);
        });
        return;
      }
      const next = rediscover.songIds
        .map((songId) => songsById.get(songId))
        .filter((song): song is Song => Boolean(song))
        .slice(0, 16);
      startTransition(() => {
        setRediscoverSongs(next);
      });
    }, 200);
    return () => {
      alive = false;
      cancel();
    };
  }, [playlists, songsById]);

  useEffect(() => {
    let alive = true;
    const cancel = scheduleIdleTask(() => {
      if (!alive) {
        return;
      }
      startTransition(() => {
        setUserPlaylists(
          playlists.filter((playlist) => playlist.type === 'custom').filter((playlist) => playlist.songIds.length),
        );
      });
    }, 200);
    return () => {
      alive = false;
      cancel();
    };
  }, [playlists]);

  useEffect(() => {
    let alive = true;
    const songList = [...songs];
    const playCountBySongId = new Map(songList.map((song) => [song.id, song.playCount]));
    const artistMap = new Map<string, Song[]>();
    const artistSongIdMap = new Map<string, Set<string>>();
    let index = 0;

    const processChunk = () => {
      if (!alive) {
        return;
      }
      const end = Math.min(index + 300, songList.length);
      for (; index < end; index += 1) {
        const song = songList[index];
        for (const artistName of splitArtistNames(song.artist)) {
          const songIds = artistSongIdMap.get(artistName) ?? new Set<string>();
          if (songIds.has(song.id)) {
            continue;
          }
          songIds.add(song.id);
          artistSongIdMap.set(artistName, songIds);

          const list = artistMap.get(artistName) ?? [];
          list.push(song);
          artistMap.set(artistName, list);
        }
      }

      if (index < songList.length) {
        scheduleIdleTask(processChunk, 250);
        return;
      }

      const rankedArtists: TopArtistEntry[] = [];
      for (const [artistName, artistSongs] of artistMap.entries()) {
        const sortedSongs = [...artistSongs].sort(
          (a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title),
        );
        const topSong = sortedSongs[0];
        if (!topSong) {
          continue;
        }
        rankedArtists.push({
          artistName,
          topSong,
          songIds: sortedSongs.map((entry) => entry.id),
        });
      }

      const next = rankedArtists
        .sort((a, b) => {
          const aPlays = a.songIds.reduce((total, id) => total + (playCountBySongId.get(id) ?? 0), 0);
          const bPlays = b.songIds.reduce((total, id) => total + (playCountBySongId.get(id) ?? 0), 0);
          return bPlays - aPlays;
        })
        .slice(0, 16);

      startTransition(() => {
        setTopArtists(next);
      });
    };

    const cancel = scheduleIdleTask(processChunk, 250);
    return () => {
      alive = false;
      cancel();
    };
  }, [songs]);

  useEffect(() => {
    let alive = true;
    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    const idleWait = () =>
      new Promise<void>((resolve) => {
        if (typeof idle === 'function') {
          idle(() => resolve(), { timeout: 300 });
          return;
        }
        setTimeout(() => resolve(), 0);
      });
    const load = async () => {
      const next: Record<string, string | undefined> = {};
      let handled = 0;
      for (const entry of topArtists) {
        const result = await readCachedArtistProfile(entry.artistName);
        if (!alive) {
          return;
        }
        if (result.status === 'ready') {
          next[entry.artistName] = result.profile.imageUrl ?? undefined;
        }
        handled += 1;
        if (handled % 3 === 0) {
          await idleWait();
        }
      }
      if (alive) {
        setArtistImages(next);
      }
    };

    const cancel = scheduleIdleTask(() => {
      if (!alive) {
        return;
      }
      void load();
    }, 400);
    return () => {
      alive = false;
      cancel();
    };
  }, [topArtists, metadataFetchDone]);

  const getPlaylistArtwork = (playlist: Playlist): string | undefined => {
    if (playlist.artwork) {
      return playlist.artwork;
    }

    const firstSong = playlist.songIds.map((songId) => songsById.get(songId)).find(Boolean);
    return firstSong?.albumArt;
  };

  const getPlaylistArtworkSet = (playlist: Playlist): string[] => {
    const artSet = new Set<string>();
    for (const songId of playlist.songIds) {
      const art = songsById.get(songId)?.albumArt;
      if (art) {
        artSet.add(art);
      }
      if (artSet.size >= 4) {
        break;
      }
    }
    const list = [...artSet];
    if (list.length) {
      while (list.length < 4) {
        list.push(list[list.length - 1]);
      }
    }
    return list;
  };

  useEffect(() => {
    let alive = true;
    setSmartPlaylistLoading(true);
    const cancel = scheduleIdleTask(() => {
      if (!alive) {
        return;
      }
      const smart = playlists
        .filter((playlist) => playlist.type === 'smart')
        .map((playlist) => ({
          id: playlist.id,
          baseId: playlist.id,
          title: playlist.name,
          subtitle: getAlbumSpotlightSubtitle(playlist),
          artwork: getPlaylistArtwork(playlist),
          artworks: getPlaylistArtworkSet(playlist),
          description: playlist.description,
          songIds: playlist.songIds,
          kind: 'smart' as const,
        }))
        .filter((entry) => entry.songIds.length);

      const custom = playlists
        .filter((playlist) => playlist.type === 'custom')
        .map((playlist) => ({
          id: `${playlist.id}-recent`,
          baseId: playlist.id,
          title: playlist.name,
          subtitle: `Recently played - ${playlist.songIds.length} songs`,
          artwork: getPlaylistArtwork(playlist),
          artworks: getPlaylistArtworkSet(playlist),
          description: playlist.description,
          songIds: playlist.songIds,
          kind: 'custom' as const,
        }))
        .filter((entry) => entry.songIds.length);

      const seed = smartPlaylistRenderSeed || Date.now();
      const now = Date.now() / 1000;
      const scoreFor = (baseId: string) => {
        const usage = playlistUsage[baseId];
        if (!usage) {
          return 0;
        }
        const daysSince = Math.max(0, (now - usage.lastUsed) / 86_400);
        const recencyBoost = Math.max(0, 14 - daysSince) * 2;
        return usage.count * 10 + recencyBoost;
      };
      const combined = [...smart, ...custom]
        .sort((a, b) => {
          const scoreDiff = scoreFor(b.baseId) - scoreFor(a.baseId);
          if (scoreDiff !== 0) {
            return scoreDiff;
          }
          return hash(`${a.id}:${seed}`) - hash(`${b.id}:${seed}`);
        })
        .slice(0, 7);

      setSmartPlaylistCards(combined);
      setSmartPlaylistLoading(false);
    }, 120);
    return () => {
      alive = false;
      cancel();
    };
  }, [playlists, songsById, smartPlaylistSeed, playlistUsage, getAlbumSpotlightSubtitle]);

  useEffect(() => {
    let alive = true;
    if (!showMoreMixes) {
      setSmartMixesAll([]);
      return () => {
        alive = false;
      };
    }

    const cancel = scheduleIdleTask(() => {
      if (!alive) {
        return;
      }
      const next = playlists
        .filter((playlist) => playlist.type === 'smart')
        .map((playlist) => ({
          id: playlist.id,
          baseId: playlist.id,
          title: playlist.name,
          subtitle: playlist.description || getAlbumSpotlightSubtitle(playlist),
          artwork: getPlaylistArtwork(playlist),
          artworks: getPlaylistArtworkSet(playlist),
          songIds: playlist.songIds,
          kind: 'smart' as const,
        }))
        .filter((entry) => entry.songIds.length);
      setSmartMixesAll(next);
    }, 180);

    return () => {
      alive = false;
      cancel();
    };
  }, [playlists, songsById, showMoreMixes, getAlbumSpotlightSubtitle]);

  const pickSong = (song: Song) => {
    setQueue(allSongIds, song.id);
    void playSongById(song.id, false);
  };

  const playPlaylist = (playlistSongIds: string[], startSongId?: string, playlistId?: string) => {
    const queue = playlistSongIds.filter((songId) => songsById.has(songId));
    const fallbackSongId = queue[0];
    const targetSongId = startSongId && queue.includes(startSongId) ? startSongId : fallbackSongId;

    if (!targetSongId) {
      return;
    }

    setQueue(queue, targetSongId);
    void playSongById(targetSongId, false);
    if (playlistId) {
      void recordPlaylistUse(playlistId);
    }
  };

  const openPlaylistDetail = (playlistId?: string) => {
    if (!playlistId) {
      return;
    }
    navigate(`/playlist/${playlistId}`);
  };

  return (
    <div className="space-y-8 pb-8">
      <header className="space-y-2 border-b border-amply-border/60 pb-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[32px] font-bold tracking-tight text-amply-textPrimary">Discover</h1>
          <button
            type="button"
            onClick={async () => {
              setRegenMessage(null);
              await regenerateSmartPlaylists();
              setRegenMessage('Smart playlists regenerated.');
              window.setTimeout(() => setRegenMessage(null), 2500);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-amply-border/60 text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Regenerate playlists"
            title="Regenerate playlists"
            disabled={regeneratingSmartPlaylists}
          >
            {regeneratingSmartPlaylists ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin">
                <path
                  d="M12 4a8 8 0 1 1-7.32 11.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M20 12a8 8 0 0 1-13.66 5.66M4 12a8 8 0 0 1 13.66-5.66M4 4v4h4M20 20v-4h-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
        {regenMessage ? <p className="text-[11px] text-amply-textMuted">{regenMessage}</p> : null}
      </header>

      <section className="max-w-none space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-amply-textPrimary">Smart Playlists</h2>
        </div>

        <div className="relative">
          {regeneratingSmartPlaylists ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-black/25 backdrop-blur-sm">
              <div className="flex items-center gap-2 rounded-full border border-amply-border/60 bg-amply-surface/80 px-3 py-2 text-[12px] text-amply-textSecondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin">
                  <path
                    d="M12 4a8 8 0 1 1-7.32 11.2"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Refreshing playlists...
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-5 pb-2 sm:grid-flow-row-dense sm:grid-cols-2 xl:grid-cols-3">
            {smartPlaylistLoading && !smartPlaylistCards.length
            ? Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`smart-skeleton-${index}`}
                  className={clsx(
                    'min-h-[180px] rounded-card border border-amply-border/60 bg-amply-surface/70',
                    index === 0 ? 'sm:col-span-2 xl:col-span-2' : '',
                  )}
                />
              ))
            : smartPlaylistCards.map((item, index) => {
            const isFeatured = index === 0;
            const artworkSet = item.artworks?.length ? item.artworks : item.artwork ? [item.artwork] : [];
            const glowClass = playlistGlowClasses[index % playlistGlowClasses.length];
            const backgroundStyle = artworkSet[0]
              ? {
                  backgroundImage: `linear-gradient(140deg, rgba(10, 10, 12, 0.78), rgba(10, 10, 12, 0.45)), url(${artworkSet[0]})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundBlendMode: 'overlay',
                }
              : undefined;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  handleSmartCardClick(
                    item.id,
                    () => playPlaylist(item.songIds, item.startSongId, item.baseId),
                    () => openPlaylistDetail(item.baseId),
                  )
                }
                className={clsx(
                  'playlist-card group relative overflow-hidden rounded-card border border-amply-border/60 p-6 text-left transition-[transform,box-shadow,filter] duration-300 ease-smooth hover:scale-[1.02] hover:shadow-lift hover:brightness-110 hover:saturate-125',
                  playlistToneClasses[index % playlistToneClasses.length],
                  glowClass,
                  isFeatured ? 'min-h-[240px] sm:col-span-2 xl:col-span-2' : 'min-h-[180px]',
                )}
                style={backgroundStyle}
                title="Click to play. Double-click to open playlist."
              >
                {artworkSet[0] ? (
                  <div className="blur-backdrop playlist-backdrop">
                    <img src={artworkSet[0]} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  </div>
                ) : null}

                <div className="glass-overlay" />

                <div className="relative flex h-full flex-col justify-between gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <p
                        className={clsx(
                          'playlist-text-shadow max-w-[320px] font-semibold text-amply-textPrimary',
                          isFeatured ? 'text-[24px]' : 'text-[18px]',
                        )}
                      >
                        {item.title}
                      </p>
                      <p className="playlist-text-shadow text-[13px] font-semibold text-amply-textPrimary/90">
                        {item.subtitle}
                      </p>
                      {isFeatured && item.description ? (
                        <p className="playlist-text-shadow max-w-[360px] text-[12px] text-amply-textMuted">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                  <div className={clsx('playlist-play', isFeatured ? 'pr-2 pt-2' : '')}>
                    <div className="play-fab">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5.5v13l11-6.5-11-6.5z" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div className={clsx('artwork-collage', isFeatured ? 'max-w-[360px]' : 'max-w-[240px]')}>
                    {[0, 1, 2, 3].map((slot) => {
                      const art = artworkSet[slot] ?? artworkSet[0];
                      return (
                        <div
                          key={`${item.id}-art-${slot}`}
                          className={clsx(
                            'artwork-tile bg-gradient-to-br from-[#1d1f2a] via-[#12151f] to-[#0c0f17]',
                            isFeatured ? 'h-24 w-24' : 'h-20 w-20',
                          )}
                        >
                          {art ? <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </button>
            );
          })}

            {showMoreMixesCard ? (
              <button
                type="button"
                onClick={() => setShowMoreMixes((value) => !value)}
                className={clsx(
                  'playlist-card group relative min-h-[180px] overflow-hidden rounded-card border border-amply-border/60 p-5 text-left transition-[transform,box-shadow,filter] duration-300 ease-smooth hover:scale-[1.02] hover:shadow-lift hover:brightness-110 hover:saturate-125',
                  playlistToneClasses[0],
                  playlistGlowClasses[0],
                )}
              >
                <div className="glass-overlay" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_55%)]" />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-amply-border/60 bg-black/25 px-2 py-1 text-[11px] uppercase tracking-wide text-amply-textSecondary">
                      More Mixes
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[17px] font-semibold text-amply-textPrimary">Explore Mixes</p>
                    <p className="text-[12px] text-amply-textSecondary">
                      {showMoreMixes ? 'Hide the full mix list' : 'Show genre and mood mixes'}
                    </p>
                  </div>
                </div>
              </button>
            ) : null}
          </div>
        </div>

        {!smartPlaylistLoading && !smartPlaylistCards.length ? (
          <div className="rounded-card border border-amply-border/60 bg-amply-surface p-4 text-[13px] text-amply-textMuted">
            No smart playlists yet. Add more music or refresh your library to generate mixes.
          </div>
        ) : null}

        {showMoreMixes ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-amply-textSecondary">All Mixes</h3>
            {smartMixesAll.length ? (
              <div className="flex gap-4 overflow-x-auto pb-2 pr-2">
                {smartMixesAll.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      handleSmartCardClick(
                        item.id,
                        () => playPlaylist(item.songIds, undefined, item.baseId),
                        () => openPlaylistDetail(item.baseId),
                      )
                    }
                    className={clsx(
                      'card-sheen relative min-w-[220px] max-w-[240px] flex-1 overflow-hidden rounded-card border border-amply-border/60 p-5 text-left shadow-card transition-all duration-200 ease-smooth hover:scale-[1.02] hover:shadow-lift',
                      playlistToneClasses[(index + 1) % playlistToneClasses.length],
                    )}
                    title="Click to play. Double-click to open playlist."
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_55%)]" />
                    <div className="relative flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[16px] font-semibold text-amply-textPrimary">{item.title}</p>
                        <p className="truncate text-[12px] text-amply-textSecondary">{item.subtitle}</p>
                      </div>
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-amply-border/60 bg-amply-surface/70">
                        {item.artwork ? (
                          <img src={item.artwork} alt={item.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-amply-border/60 bg-amply-surface p-4 text-[13px] text-amply-textMuted">
                No mixes available yet. Add more music to expand smart mixes.
              </div>
            )}
          </div>
        ) : null}
      </section>

      <SectionRow title="Recently Played" songs={recentlyPlayed} onPick={pickSong} scrollable />
      <SectionRow title="Rediscover" songs={rediscoverSongs} onPick={pickSong} scrollable />

      {userPlaylists.length ? (
        <section className="space-y-3">
          <h2 className="text-[20px] font-semibold text-amply-textPrimary">Your Playlists</h2>
          <div className="flex gap-5 overflow-x-auto pb-3 pr-2">
            {userPlaylists.map((playlist) => (
              <div key={playlist.id} className="min-w-[200px] max-w-[220px] flex-1">
                <AlbumCard
                  title={playlist.name}
                  subtitle={`${playlist.songIds.length} songs`}
                  artwork={getPlaylistArtwork(playlist)}
                  onClick={() => playPlaylist(playlist.songIds, undefined, playlist.id)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[20px] font-semibold text-amply-textPrimary">Top Artists</h2>
        <div className="flex gap-5 overflow-x-auto pb-3 pr-2">
          {topArtists.map((entry) => (
            <div key={entry.artistName} className="min-w-[200px] max-w-[220px] flex-1">
              <AlbumCard
                title={entry.artistName}
                subtitle={`${entry.songIds.length} songs`}
                artwork={artistImages[entry.artistName] ?? entry.topSong.albumArt}
                onClick={() => playPlaylist(entry.songIds, entry.topSong.id)}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default HomePage;
