import { djb2 as hash } from '@/utils/hash';
import { yieldToIdle } from '@/utils/idle';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { Icon, IconButton, Kicker, PageHeader, SectionTitle, Surface } from '@/components/ui';
import { loadArtistProfile, readCachedArtistProfile } from '@/services/artistProfileService';
import { getAlbumTracklistKey, loadAlbumTracklistCache, normalizeTrackTitle } from '@/services/albumTracklistService';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryVersions } from '@/store/libraryDataStore';
import type { Playlist, Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import { buildArtworkSet, pickPlaylistArtwork } from '@/services/playlistArtworkService';
import { useAlbumArtFrequency } from '@/hooks/useAlbumArtFrequency';
import { isMoreMixPlaylistId } from '@/services/mixEngine';
import { useHomeView, useStructuralSongsSnapshot } from '@/hooks/useLibraryViews';
import { ExploreMixesCard } from '@/pages/Home/ExploreMixesCard';
import { FeaturedMixCarousel } from '@/pages/Home/FeaturedMixCarousel';
import { MadeForYouHero } from '@/pages/Home/MadeForYouHero';
import { SectionRow } from '@/pages/Home/SectionRow';
import { SmartPlaylistCard, type SmartPlaylistCardItem, type SmartPlaylistCardLayout } from '@/pages/Home/SmartPlaylistCard';
import { TopArtistsRow } from '@/pages/Home/TopArtistsRow';
import {
  buildMadeForYouMixes,
  buildMoreFromArtist,
  getMadeForYouRefreshSeed,
  getNextMadeForYouRefreshMs,
  pickUniqueAlbumSongs,
  scheduleIdleTask,
} from '@/pages/Home/homeMixes';

type AlbumTracklistSummary = { tracks?: Array<{ position: number; title: string }> };

/** Cover chosen for a playlist under a given render seed, so it survives artwork arriving later. */
const smartPlaylistCoverCache = new Map<string, string>();
const COVER_CACHE_LIMIT = 240;

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
  const metadataFetchDone = useLibraryStore((state) => state.metadataFetch.done);
  const recordPlaylistUse = useLibraryStore((state) => state.recordPlaylistUse);
  const navigate = useNavigate();
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);

  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const [showMoreMixes, setShowMoreMixes] = useState(false);
  const [artistImages, setArtistImages] = useState<Record<string, string | undefined>>({});
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [albumTracklistCache, setAlbumTracklistCache] = useState<Record<string, AlbumTracklistSummary>>({});
  const [smartPlaylistRenderSeed, setSmartPlaylistRenderSeed] = useState(() => smartPlaylistSeed || Date.now());
  const [madeForYouRefreshSeed, setMadeForYouRefreshSeed] = useState(() => getMadeForYouRefreshSeed());
  const clickTimerRef = useRef<number | null>(null);
  const clickTargetRef = useRef<string | null>(null);
  const albumSubtitleCacheRef = useRef<Map<string, string>>(new Map());
  const wasRegeneratingRef = useRef(regeneratingSmartPlaylists);
  const songsById = homeView.songsById;
  const allSongIds = homeView.allSongIds;
  const topArtists = homeView.topArtists;
  const { libraryVersion } = useLibraryVersions();

  // Home renders a snapshot of the playlists and songs taken on mount and on manual regenerate.
  // Background refreshes (a play, a favourite, artwork arriving) must not reshuffle the cards under
  // the pointer; navigating back to Home remounts and picks up whatever is fresh by then.
  const smartPlaylistCount = playlists.reduce((count, playlist) => (playlist.type === 'smart' ? count + 1 : count), 0);
  const hasAnyArtwork = deferredSongs.some((song) => Boolean(song.albumArt));
  const snapshotKey = `${smartPlaylistRenderSeed}:${libraryVersion}:${smartPlaylistCount > 0}:${hasAnyArtwork}:${madeForYouRefreshSeed}`;
  const snapshotRef = useRef<{ key: string; playlists: Playlist[]; songs: Song[] } | null>(null);
  if (!snapshotRef.current || snapshotRef.current.key !== snapshotKey) {
    snapshotRef.current = { key: snapshotKey, playlists, songs: deferredSongs };
  }
  const frozenPlaylists = snapshotRef.current.playlists;
  const frozenSongs = snapshotRef.current.songs;
  const albumArtFrequency = useAlbumArtFrequency(useStructuralSongsSnapshot());
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
    () => pickUniqueAlbumSongs(frozenSongs, homeMixSeed || 1, 6),
    [frozenSongs, homeMixSeed],
  );

  const moreFromArtist = useMemo(() => buildMoreFromArtist(frozenSongs, homeMixSeed), [frozenSongs, homeMixSeed]);

  const madeForYouMixes = useMemo(() => buildMadeForYouMixes(frozenSongs, homeMixSeed), [frozenSongs, homeMixSeed]);

  // Top artists come from the shared home view (already computed there); only the artist image
  // lookup lives here. Keyed on the joined names so a rebuild that yields the same artists does not
  // re-run the IPC probes.
  const topArtistNamesKey = useMemo(() => topArtists.map((entry) => entry.artistName).join('|'), [topArtists]);

  useEffect(() => {
    let alive = true;
    const artistNames = topArtistNamesKey ? topArtistNamesKey.split('|') : [];
    const idleWait = () => yieldToIdle(300);
    const load = async () => {
      const next: Record<string, string | undefined> = {};
      let handled = 0;
      for (const artistName of artistNames) {
        let result = await readCachedArtistProfile(artistName);
        if (result.status === 'missing' && !metadataFetchPaused) {
          result = await loadArtistProfile(artistName);
        }
        if (!alive) {
          return;
        }
        if (result.status === 'ready') {
          next[artistName] = result.profile.imageUrl ?? undefined;
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
  }, [topArtistNamesKey, metadataFetchDone, metadataFetchPaused]);

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
    const smartPlaylists = frozenPlaylists.filter((playlist) => playlist.type === 'smart');
    if (smartPlaylistCoverCache.size > COVER_CACHE_LIMIT) {
      smartPlaylistCoverCache.clear();
    }
    return smartPlaylists
      .map((playlist) => {
        const artwork = getPlaylistArtwork(playlist);
        const artworks = getPlaylistArtworkSet(playlist);
        const coverKey = `${seed}:${playlist.id}`;
        const remembered = smartPlaylistCoverCache.get(coverKey);
        const backgroundArtwork =
          remembered && (!artworks.length || artworks.includes(remembered))
            ? remembered
            : artworks.length
              ? artworks[hash(coverKey) % artworks.length]
              : artwork;
        if (backgroundArtwork) {
          smartPlaylistCoverCache.set(coverKey, backgroundArtwork);
        }
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
  }, [frozenPlaylists, getAlbumSpotlightSubtitle, getPlaylistArtwork, getPlaylistArtworkSet, smartPlaylistRenderSeed]);

  // Six static grid cards, ordered by the render seed only (usage no longer reorders them under the
  // pointer). The featured slot rotates through everything that did not fit in the grid.
  const { gridCards, featuredPool } = useMemo(() => {
    const seed = smartPlaylistRenderSeed || 0;
    const ordered = smartPlaylistItems
      .filter((entry) => !entry.isMoreMix)
      .sort((a, b) => hash(`${a.id}:${seed}`) - hash(`${b.id}:${seed}`));
    const grid = ordered.slice(1, 7);
    const gridIds = new Set(grid.map((entry) => entry.id));
    const pool = [ordered[0], ...smartPlaylistItems.filter((entry) => entry.isMoreMix), ...ordered.slice(7)]
      .filter((entry) => Boolean(entry) && !gridIds.has(entry.id))
      .slice(0, 6);
    return { gridCards: grid, featuredPool: pool };
  }, [smartPlaylistItems, smartPlaylistRenderSeed]);

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

  /** Cards render a snapshot; playback always uses the playlist's current contents. */
  const liveSongIdsFor = (item: SmartPlaylistCardItem): string[] =>
    playlists.find((playlist) => playlist.id === item.baseId)?.songIds ?? item.songIds;

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

  const renderSmartCard = (item: SmartPlaylistCardItem, layout: SmartPlaylistCardLayout) => (
    <SmartPlaylistCard
      item={item}
      layout={layout}
      onSelect={() =>
        handleSmartCardClick(
          item.id,
          () => playPlaylist(liveSongIdsFor(item), undefined, item.baseId),
          () => openPlaylistDetail(item.baseId),
        )
      }
      onPlay={() => playPlaylist(liveSongIdsFor(item), undefined, item.baseId)}
    />
  );

  return (
    <div className="anim-stagger space-y-8 pb-8">
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
          {featuredPool.length ? (
            <div className="min-w-0 sm:col-span-2 xl:col-span-2">
              <FeaturedMixCarousel
                items={featuredPool}
                onPlay={(item) => playPlaylist(liveSongIdsFor(item), undefined, item.baseId)}
                onOpen={(item) => openPlaylistDetail(item.baseId)}
              />
            </div>
          ) : null}
          {gridCards.map((item) => (
            <div key={item.id} className="min-w-0">
              {renderSmartCard(item, 'grid')}
            </div>
          ))}

          {showMoreMixesCard ? (
            <ExploreMixesCard
              artworkSongs={exploreArtworkSongs}
              expanded={showMoreMixes}
              onToggle={() => setShowMoreMixes((value) => !value)}
            />
          ) : null}
        </div>

        {!featuredPool.length && !gridCards.length ? (
          <EmptyNote>No smart playlists yet. Add more music or refresh your library to generate mixes.</EmptyNote>
        ) : null}

        {showMoreMixes ? (
          <div id="home-all-mixes" className="space-y-3">
            <Kicker>All Mixes</Kicker>
            {smartMixesAll.length ? (
              <div className="flex gap-4 overflow-x-auto px-2 py-2 pr-3">
                {smartMixesAll.map((item) => (
                  <div key={item.id} className="min-w-[240px] max-w-[260px] flex-1">
                    {renderSmartCard(item, 'compact')}
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
          <div className="anim-stagger grid gap-5 xl:grid-cols-2">
            {madeForYouMixes.map((mix) => (
              <MadeForYouHero key={mix.id} mix={mix} onPlay={() => playPlaylist(mix.songIds)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default HomePage;
