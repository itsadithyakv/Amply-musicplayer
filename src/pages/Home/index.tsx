import { djb2 as hash } from '@/utils/hash';
import { yieldToIdle } from '@/utils/idle';
import clsx from 'clsx';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { Icon, IconButton, Kicker, PageHeader, SectionTitle, Surface } from '@/components/ui';
import { loadArtistProfile, readCachedArtistProfile } from '@/services/artistProfileService';
import { getAlbumTracklistKey, loadAlbumTracklistCache, normalizeTrackTitle } from '@/services/albumTracklistService';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist, Song } from '@/types/music';
import { getPrimaryArtistName, splitArtistNames } from '@/utils/artists';
import { buildArtworkSet, pickPlaylistArtwork } from '@/services/playlistArtworkService';
import { useAlbumArtFrequency } from '@/hooks/useAlbumArtFrequency';
import { isMoreMixPlaylistId } from '@/services/playlistGenerator';
import { useHomeView } from '@/hooks/useLibraryViews';
import { ExploreMixesCard } from '@/pages/Home/ExploreMixesCard';
import { MadeForYouHero } from '@/pages/Home/MadeForYouHero';
import { SectionRow } from '@/pages/Home/SectionRow';
import { SmartPlaylistCard, type SmartPlaylistCardItem, type SmartPlaylistCardLayout } from '@/pages/Home/SmartPlaylistCard';
import { TopArtistsRow, type TopArtistEntry } from '@/pages/Home/TopArtistsRow';
import {
  buildMadeForYouMixes,
  buildMoreFromArtist,
  getMadeForYouRefreshSeed,
  getNextMadeForYouRefreshMs,
  pickUniqueAlbumSongs,
  scheduleIdleTask,
  setBoundedCache,
} from '@/pages/Home/homeMixes';

type AlbumTracklistSummary = { tracks?: Array<{ position: number; title: string }> };

const smartPlaylistUiCache = new Map<string, SmartPlaylistCardItem[]>();
const smartPlaylistHighlightCache = new Map<string, SmartPlaylistCardItem[]>();

const EmptyNote = ({ children }: { children: string }) => (
  <Surface variant="well" radius="md" className="p-4 text-[13px] text-amply-textMuted">
    {children}
  </Surface>
);

const HomePage = () => {
  const homeView = useHomeView();
  const deferredSongs = homeView.songs;
  const playlists = homeView.playlists;
  const regenerateSmartPlaylists = useLibraryStore((state) => state.regenerateSmartPlaylists);
  const smartPlaylistSeed = useLibraryStore((state) => state.smartPlaylistSeed);
  const regeneratingSmartPlaylists = useLibraryStore((state) => state.regeneratingSmartPlaylists);
  const playlistUsage = useLibraryStore((state) => state.playlistUsage);
  const metadataFetchDone = useLibraryStore((state) => state.metadataFetch.done);
  const recordPlaylistUse = useLibraryStore((state) => state.recordPlaylistUse);
  const navigate = useNavigate();
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);

  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const [showMoreMixes, setShowMoreMixes] = useState(false);
  const [artistImages, setArtistImages] = useState<Record<string, string | undefined>>({});
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [topArtists, setTopArtists] = useState<TopArtistEntry[]>([]);
  const [albumTracklistCache, setAlbumTracklistCache] = useState<Record<string, AlbumTracklistSummary>>({});
  const [smartPlaylistRenderSeed, setSmartPlaylistRenderSeed] = useState(() => smartPlaylistSeed || Date.now());
  const [madeForYouRefreshSeed, setMadeForYouRefreshSeed] = useState(() => getMadeForYouRefreshSeed());
  const clickTimerRef = useRef<number | null>(null);
  const clickTargetRef = useRef<string | null>(null);
  const albumSubtitleCacheRef = useRef<Map<string, string>>(new Map());
  const wasRegeneratingRef = useRef(regeneratingSmartPlaylists);
  const songsById = homeView.songsById;
  const allSongIds = homeView.allSongIds;
  const albumArtFrequency = useAlbumArtFrequency(deferredSongs);
  const homeMixSeed = useMemo(
    () => hash(`${smartPlaylistRenderSeed || 0}:made-for-you:${madeForYouRefreshSeed}`),
    [madeForYouRefreshSeed, smartPlaylistRenderSeed],
  );

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
  }, [metadataFetchDone]);

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
    let timeoutHandle: number | null = null;

    const scheduleNextRefresh = () => {
      const nextAt = getNextMadeForYouRefreshMs();
      const delay = Math.max(60_000, nextAt - Date.now() + 1000);
      timeoutHandle = window.setTimeout(() => {
        setMadeForYouRefreshSeed(getMadeForYouRefreshSeed());
        scheduleNextRefresh();
      }, delay);
    };

    scheduleNextRefresh();
    return () => {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

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

  const recentlyPlayed = homeView.recentlyPlayed;
  const rediscoverSongs = homeView.rediscoverSongs;
  const userPlaylists = homeView.userPlaylists.filter((playlist) => playlist.songIds.length);

  const exploreArtworkSongs = useMemo(
    () => pickUniqueAlbumSongs(deferredSongs, homeMixSeed || 1, 6),
    [deferredSongs, homeMixSeed],
  );

  const moreFromArtist = useMemo(() => buildMoreFromArtist(deferredSongs, homeMixSeed), [deferredSongs, homeMixSeed]);

  const madeForYouMixes = useMemo(() => buildMadeForYouMixes(deferredSongs, homeMixSeed), [deferredSongs, homeMixSeed]);

  useEffect(() => {
    let alive = true;
    const songList = [...deferredSongs];
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
  }, [deferredSongs]);

  useEffect(() => {
    let alive = true;
    const idleWait = () => yieldToIdle(300);
    const load = async () => {
      const next: Record<string, string | undefined> = {};
      let handled = 0;
      for (const entry of topArtists) {
        let result = await readCachedArtistProfile(entry.artistName);
        if (result.status === 'missing' && !metadataFetchPaused) {
          result = await loadArtistProfile(entry.artistName);
        }
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
  }, [topArtists, metadataFetchDone, metadataFetchPaused]);

  const getPlaylistArtwork = useCallback((playlist: Playlist): string | undefined => {
    if (playlist.artwork) {
      return playlist.artwork;
    }
    const playlistSongs = playlist.songIds
      .map((songId) => songsById.get(songId))
      .filter((entry): entry is Song => Boolean(entry));
    return pickPlaylistArtwork(playlistSongs, albumArtFrequency);
  }, [albumArtFrequency, songsById]);

  const getPlaylistArtworkSet = useCallback((playlist: Playlist): string[] => {
    const playlistSongs = playlist.songIds
      .map((songId) => songsById.get(songId))
      .filter((entry): entry is Song => Boolean(entry));
    const list = buildArtworkSet(playlistSongs, albumArtFrequency, 4, playlist.artwork);
    if (list.length) {
      while (list.length < 4) {
        list.push(list[list.length - 1]);
      }
    }
    return list;
  }, [albumArtFrequency, songsById]);

  const smartPlaylistItems = useMemo(() => {
    const seed = smartPlaylistRenderSeed || 0;
    const smartPlaylists = playlists.filter((playlist) => playlist.type === 'smart');
    const cacheKey = [
      seed,
      smartPlaylists
        .map((playlist) => `${playlist.id}:${playlist.name}:${playlist.description ?? ''}:${playlist.artwork ?? ''}:${playlist.songIds.join(',')}`)
        .join('|'),
    ].join('::');
    const cached = smartPlaylistUiCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const next = smartPlaylists
      .map((playlist) => {
        const artwork = getPlaylistArtwork(playlist);
        const artworks = getPlaylistArtworkSet(playlist);
        const backgroundArtwork = artworks.length ? artworks[hash(`${playlist.id}:${seed}`) % artworks.length] : artwork;
        return {
          id: playlist.id,
          baseId: playlist.id,
          title: playlist.name,
          subtitle: playlist.description || getAlbumSpotlightSubtitle(playlist),
          artwork,
          artworks,
          backgroundArtwork,
          description: playlist.description,
          songIds: playlist.songIds,
          kind: 'smart' as const,
          isMoreMix: isMoreMixPlaylistId(playlist.id),
        };
      })
      .filter((entry) => entry.songIds.length);
    setBoundedCache(smartPlaylistUiCache, cacheKey, next);
    return next;
  }, [playlists, getAlbumSpotlightSubtitle, getPlaylistArtwork, getPlaylistArtworkSet, smartPlaylistRenderSeed]);

  const smartHighlightCards = useMemo(() => {
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

    const cacheKey = [
      smartPlaylistRenderSeed || 0,
      smartPlaylistItems.map((entry) => entry.id).join('|'),
      Object.entries(playlistUsage)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, usage]) => `${id}:${usage.count}:${usage.lastUsed}`)
        .join('|'),
    ].join('::');
    const cached = smartPlaylistHighlightCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const next = smartPlaylistItems
      .filter((entry) => !entry.isMoreMix)
      .sort((a, b) => {
        const scoreDiff = scoreFor(b.baseId) - scoreFor(a.baseId);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return hash(`${a.id}:${smartPlaylistRenderSeed}`) - hash(`${b.id}:${smartPlaylistRenderSeed}`);
      })
      .slice(0, 7);
    setBoundedCache(smartPlaylistHighlightCache, cacheKey, next);
    return next;
  }, [smartPlaylistItems, playlistUsage, smartPlaylistRenderSeed]);

  const smartMixesAll = useMemo(() => {
    if (!showMoreMixes) {
      return [];
    }
    return smartPlaylistItems.filter((entry) => entry.isMoreMix);
  }, [smartPlaylistItems, showMoreMixes]);

  const showMoreMixesCard = smartPlaylistItems.some((entry) => entry.isMoreMix);

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

    setQueue(queue, targetSongId, { playlistId: playlistId ?? null });
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

  const handleRegenerate = async () => {
    setRegenMessage(null);
    try {
      await regenerateSmartPlaylists();
      setRegenMessage('Smart playlists regenerated.');
    } catch (error) {
      setRegenMessage(error instanceof Error ? error.message : 'Failed to regenerate playlists.');
    } finally {
      window.setTimeout(() => setRegenMessage(null), 2500);
    }
  };

  const renderSmartCard = (item: SmartPlaylistCardItem, layout: SmartPlaylistCardLayout, toneIndex: number) => (
    <SmartPlaylistCard
      item={item}
      layout={layout}
      toneIndex={toneIndex}
      onSelect={() =>
        handleSmartCardClick(
          item.id,
          () => playPlaylist(item.songIds, undefined, item.baseId),
          () => openPlaylistDetail(item.baseId),
        )
      }
      onPlay={() => playPlaylist(item.songIds, undefined, item.baseId)}
    />
  );

  return (
    <div className="space-y-8 pb-8">
      <PageHeader
        title="Discover"
        description={regenMessage ?? undefined}
        action={
          <IconButton
            name={regeneratingSmartPlaylists ? 'loader' : 'refresh'}
            label="Refresh mixes"
            onClick={() => void handleRegenerate()}
            disabled={regeneratingSmartPlaylists}
            className={regeneratingSmartPlaylists ? '[&>svg]:animate-spin' : undefined}
          />
        }
      />

      <section className="max-w-none space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>Smart Playlists</SectionTitle>
          {regeneratingSmartPlaylists ? (
            <Surface
              variant="raised-sm"
              radius="full"
              role="status"
              className="flex items-center gap-2 px-3 py-2 text-[12px] text-amply-textSecondary"
            >
              <Icon name="loader" size={14} className="animate-spin" />
              Refreshing playlists...
            </Surface>
          ) : null}
        </div>

        <div
          aria-busy={regeneratingSmartPlaylists || undefined}
          className={clsx(
            'grid grid-cols-1 gap-5 px-2 py-2 transition-opacity duration-150 ease-smooth sm:grid-flow-row-dense sm:grid-cols-2 xl:grid-cols-3',
            regeneratingSmartPlaylists && 'pointer-events-none opacity-60',
          )}
        >
          {smartHighlightCards.map((item, index) => {
            const isFeatured = index === 0;
            return (
              <div key={item.id} className={clsx('min-w-0', isFeatured && 'sm:col-span-2 xl:col-span-2')}>
                {renderSmartCard(item, isFeatured ? 'featured' : 'grid', index)}
              </div>
            );
          })}

          {showMoreMixesCard ? (
            <ExploreMixesCard
              artworkSongs={exploreArtworkSongs}
              expanded={showMoreMixes}
              onToggle={() => setShowMoreMixes((value) => !value)}
            />
          ) : null}
        </div>

        {!smartHighlightCards.length ? (
          <EmptyNote>No smart playlists yet. Add more music or refresh your library to generate mixes.</EmptyNote>
        ) : null}

        {showMoreMixes ? (
          <div id="home-all-mixes" className="space-y-3">
            <Kicker>All Mixes</Kicker>
            {smartMixesAll.length ? (
              <div className="flex gap-4 overflow-x-auto px-2 py-2 pr-3">
                {smartMixesAll.map((item, index) => (
                  <div key={item.id} className="min-w-[240px] max-w-[260px] flex-1">
                    {renderSmartCard(item, 'compact', index + 1)}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyNote>No mixes available yet. Add more music to expand smart mixes.</EmptyNote>
            )}
          </div>
        ) : null}
      </section>

      <SectionRow title="Recently Played" songs={recentlyPlayed} onPick={pickSong} scrollable />
      <SectionRow title="Rediscover" songs={rediscoverSongs} onPick={pickSong} scrollable />
      {moreFromArtist ? (
        <SectionRow
          title={`More from ${moreFromArtist.artistName}`}
          songs={moreFromArtist.songs}
          onPick={pickSong}
          scrollable
        />
      ) : null}

      {userPlaylists.length ? (
        <section className="space-y-3">
          <SectionTitle>Your Playlists</SectionTitle>
          <div className="flex gap-3 overflow-x-auto pb-3 pr-2">
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

      <TopArtistsRow artists={topArtists} images={artistImages} onPick={(entry) => playPlaylist(entry.songIds, entry.topSong.id)} />

      {madeForYouMixes.length ? (
        <section className="space-y-3">
          <SectionTitle>Made for you</SectionTitle>
          <div className="grid gap-5 xl:grid-cols-2">
            {madeForYouMixes.map((mix, index) => (
              <MadeForYouHero key={mix.id} mix={mix} toneIndex={index} onPlay={() => playPlaylist(mix.songIds)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default HomePage;
