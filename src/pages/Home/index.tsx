import { djb2 as hash } from '@/utils/hash';
import { cancelIdle, requestIdle, yieldToIdle } from '@/utils/idle';
import clsx from 'clsx';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
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
        <div className="flex gap-3 overflow-x-auto px-1.5 py-1.5 pr-3">
          {songs.map((song) => (
            <div key={`${title}-${song.id}`} className="min-w-[200px] max-w-[220px] flex-1">
              <AlbumCard title={song.title} subtitle={song.artist} artwork={song.albumArt} onClick={() => onPick(song)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {songs.map((song) => (
            <div key={`${title}-${song.id}`}>
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

type AlbumTracklistSummary = { tracks?: Array<{ position: number; title: string }> };
type SmartPlaylistCardItem = {
  id: string;
  baseId: string;
  title: string;
  subtitle: string;
  artwork?: string;
  artworks: string[];
  backgroundArtwork?: string;
  description?: string;
  songIds: string[];
  kind: 'smart';
  isMoreMix: boolean;
};

type MadeForYouMixCard = {
  id: string;
  title: string;
  subtitle: string;
  genre: string;
  songIds: string[];
  coverSongs: Song[];
  backgroundArtwork?: string;
};

const playlistToneClasses = [
  'bg-gradient-to-br from-[#fffaf3] via-[#f7efe4] to-[#efe4d6]',
  'bg-gradient-to-br from-[#fff8f0] via-[#f6ede6] to-[#ecdfd1]',
  'bg-gradient-to-br from-[#fbfaf4] via-[#edf1e7] to-[#dde6d7]',
  'bg-gradient-to-br from-[#fff9f5] via-[#f2ebef] to-[#e6dce3]',
];

const playlistGlowClasses = [
  'shadow-[0_0_0_1px_rgba(122,145,176,0.12),0_10px_22px_rgba(109,95,79,0.10)]',
  'shadow-[0_0_0_1px_rgba(201,150,104,0.12),0_10px_22px_rgba(109,95,79,0.10)]',
  'shadow-[0_0_0_1px_rgba(133,163,129,0.12),0_10px_22px_rgba(109,95,79,0.10)]',
  'shadow-[0_0_0_1px_rgba(168,144,168,0.12),0_10px_22px_rgba(109,95,79,0.10)]',
];
const MADE_FOR_YOU_REFRESH_DAYS = 3;
const smartPlaylistUiCache = new Map<string, SmartPlaylistCardItem[]>();
const smartPlaylistHighlightCache = new Map<string, SmartPlaylistCardItem[]>();
const SMART_PLAYLIST_UI_CACHE_LIMIT = 6;

const unknownGenreValues = new Set(['', 'unknown genre', 'unknown', 'other']);

const getMadeForYouRefreshSeed = (nowMs = Date.now()): number => {
  const day = Math.floor(nowMs / 86_400_000);
  return Math.floor(day / MADE_FOR_YOU_REFRESH_DAYS);
};

const getNextMadeForYouRefreshMs = (nowMs = Date.now()): number => {
  const day = Math.floor(nowMs / 86_400_000);
  const nextCycleDay = (Math.floor(day / MADE_FOR_YOU_REFRESH_DAYS) + 1) * MADE_FOR_YOU_REFRESH_DAYS;
  return nextCycleDay * 86_400_000;
};

const getAlbumIdentity = (song: Song): string => {
  const artist = getPrimaryArtistName(song.artist).trim().toLowerCase();
  const album = song.album?.trim().toLowerCase();
  return `${artist || 'unknown'}::${album || song.id}`;
};

const getCleanGenre = (song: Song): string | null => {
  const genre = song.genre?.split(/[;,/]/)[0]?.trim() ?? '';
  if (unknownGenreValues.has(genre.toLowerCase())) {
    return null;
  }
  return genre;
};

const scoreSongInterest = (song: Song, nowSec: number): number => {
  const recency = song.lastPlayed ? Math.max(0, 45 - (nowSec - song.lastPlayed) / 86_400) : 0;
  const completion = song.totalPlaySeconds && song.duration ? Math.min(18, (song.totalPlaySeconds / song.duration) * 2) : 0;
  return recency + Math.sqrt(Math.max(0, song.playCount ?? 0)) * 10 + (song.favorite ? 36 : 0) + completion;
};

const pickRotatingArtists = <T,>(artists: T[], seed: number, limit: number, keyFor: (artist: T) => string): T[] => {
  if (artists.length <= limit) {
    return artists;
  }
  const stableAnchor = artists[0];
  const pool = artists.slice(1, Math.min(artists.length, 10));
  const rotated = [...pool].sort((a, b) => hash(`${seed}:${keyFor(a)}`) - hash(`${seed}:${keyFor(b)}`));
  return [stableAnchor, ...rotated].slice(0, limit);
};

const pickUniqueAlbumSongs = (songs: Song[], seed: number, limit: number): Song[] => {
  const seenAlbums = new Set<string>();
  const selected: Song[] = [];
  const ranked = songs
    .filter((song) => Boolean(song.albumArt))
    .sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));

  for (const song of ranked) {
    const albumKey = getAlbumIdentity(song);
    if (seenAlbums.has(albumKey)) {
      continue;
    }
    seenAlbums.add(albumKey);
    selected.push(song);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
};

const scheduleIdleTask = (task: () => void, timeoutMs = 300): (() => void) => {
  const handle = requestIdle(task, { timeout: timeoutMs, fallbackDelayMs: timeoutMs });
  return () => cancelIdle(handle);
};

const setBoundedCache = <T,>(cache: Map<string, T>, key: string, value: T) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > SMART_PLAYLIST_UI_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
};


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

  const moreFromArtist = useMemo(() => {
    if (!deferredSongs.length) {
      return null;
    }

    const nowSec = Date.now() / 1000;
    const artistMap = new Map<string, { score: number; songs: Song[] }>();
    for (const song of deferredSongs) {
      const songScore = scoreSongInterest(song, nowSec);
      for (const artistName of splitArtistNames(song.artist)) {
        const normalized = artistName.trim();
        if (!normalized || normalized.toLowerCase() === 'unknown artist') {
          continue;
        }
        const entry = artistMap.get(normalized) ?? { score: 0, songs: [] };
        entry.score += songScore;
        entry.songs.push(song);
        artistMap.set(normalized, entry);
      }
    }

    const ranked = Array.from(artistMap.entries())
      .filter(([, entry]) => entry.songs.length >= 2)
      .sort((a, b) => b[1].score - a[1].score);

    const best = ranked[0];
    if (!best) {
      return null;
    }

    const [artistName, entry] = best;
    const songs = [...entry.songs]
      .sort(
        (a, b) =>
          scoreSongInterest(b, nowSec) - scoreSongInterest(a, nowSec) ||
          hash(`${homeMixSeed}:${a.id}`) - hash(`${homeMixSeed}:${b.id}`),
      )
      .slice(0, 12);

    return { artistName, songs };
  }, [deferredSongs, homeMixSeed]);

  const madeForYouMixes = useMemo<MadeForYouMixCard[]>(() => {
    if (!deferredSongs.length) {
      return [];
    }

    const nowSec = Date.now() / 1000;
    const genreMap = new Map<
      string,
      Map<string, { score: number; songs: Song[] }>
    >();

    for (const song of deferredSongs) {
      const genre = getCleanGenre(song);
      if (!genre) {
        continue;
      }
      const songScore = scoreSongInterest(song, nowSec);
      const artistNames = splitArtistNames(song.artist).filter(
        (artistName) => artistName.trim() && artistName.trim().toLowerCase() !== 'unknown artist',
      );
      if (!artistNames.length) {
        continue;
      }
      const artistMap = genreMap.get(genre) ?? new Map<string, { score: number; songs: Song[] }>();
      for (const artistName of artistNames) {
        const entry = artistMap.get(artistName) ?? { score: 0, songs: [] };
        entry.score += songScore;
        entry.songs.push(song);
        artistMap.set(artistName, entry);
      }
      genreMap.set(genre, artistMap);
    }

    const mixes: Array<MadeForYouMixCard & { score: number }> = [];
    for (const [genre, artistMap] of genreMap.entries()) {
      const artists = Array.from(artistMap.entries())
        .filter(([, entry]) => entry.songs.length)
        .sort((a, b) => b[1].score - a[1].score);

      if (artists.length < 2) {
        continue;
      }

      const selectedArtists = pickRotatingArtists(
        artists,
        hash(`${homeMixSeed}:${genre}`),
        4,
        ([artistName]) => artistName,
      );
      const candidateMap = new Map<string, Song>();
      let totalScore = 0;
      for (const [, entry] of selectedArtists) {
        totalScore += entry.score;
        for (const song of entry.songs) {
          candidateMap.set(song.id, song);
        }
      }

      const candidates = Array.from(candidateMap.values()).sort(
        (a, b) =>
          scoreSongInterest(b, nowSec) - scoreSongInterest(a, nowSec) ||
          hash(`${homeMixSeed}:${genre}:${a.id}`) - hash(`${homeMixSeed}:${genre}:${b.id}`),
      );
      const songIds = candidates.slice(0, 40).map((song) => song.id);
      if (songIds.length < 3) {
        continue;
      }

      const coverSongs = pickUniqueAlbumSongs(candidates, hash(`${genre}:${homeMixSeed}`), 4);
      const artistNames = selectedArtists.map(([artistName]) => artistName);
      mixes.push({
        id: `home-made-for-you-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: `${artistNames[0]} + ${artistNames[1]} Mix`,
        subtitle: artistNames.slice(0, 3).join(', '),
        genre,
        songIds,
        coverSongs,
        backgroundArtwork: coverSongs[0]?.albumArt,
        score: totalScore,
      });
    }

    const existingIds = new Set(mixes.map((mix) => mix.id));
    if (mixes.length < 4) {
      const artistFallbacks = new Map<string, { score: number; songs: Song[] }>();
      for (const song of deferredSongs) {
        for (const artistName of splitArtistNames(song.artist)) {
          const key = artistName.trim();
          if (!key || key.toLowerCase() === 'unknown artist') {
            continue;
          }
          const entry = artistFallbacks.get(key) ?? { score: 0, songs: [] };
          entry.score += scoreSongInterest(song, nowSec);
          entry.songs.push(song);
          artistFallbacks.set(key, entry);
        }
      }
      const rankedArtists = [...artistFallbacks.entries()].sort((a, b) => b[1].score - a[1].score);
      for (let index = 0; index < rankedArtists.length - 1 && mixes.length < 4; index += 2) {
        const first = rankedArtists[index];
        const second = rankedArtists[index + 1];
        if (!first || !second) {
          break;
        }
        const [firstName, firstEntry] = first;
        const [secondName, secondEntry] = second;
        const id = `home-made-for-you-artist-${firstName}-${secondName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (existingIds.has(id)) {
          continue;
        }
        const candidates = [...firstEntry.songs, ...secondEntry.songs].sort(
          (a, b) =>
            scoreSongInterest(b, nowSec) - scoreSongInterest(a, nowSec) ||
            hash(`${homeMixSeed}:${id}:${a.id}`) - hash(`${homeMixSeed}:${id}:${b.id}`),
        );
        const songIds = [...new Set(candidates.map((song) => song.id))].slice(0, 40);
        if (songIds.length < 3) {
          continue;
        }
        const coverSongs = pickUniqueAlbumSongs(candidates, hash(`${id}:${homeMixSeed}`), 4);
        existingIds.add(id);
        mixes.push({
          id,
          title: `${firstName} + ${secondName} Mix`,
          subtitle: [firstName, secondName].join(', '),
          genre: 'Made for you',
          songIds,
          coverSongs,
          backgroundArtwork: coverSongs[0]?.albumArt,
          score: firstEntry.score + secondEntry.score,
        });
      }
    }

    return mixes
      .sort((a, b) => b.score - a.score || hash(`${homeMixSeed}:${a.id}`) - hash(`${homeMixSeed}:${b.id}`))
      .slice(0, 4)
      .map(({ score: _score, ...mix }) => mix);
  }, [deferredSongs, homeMixSeed]);

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

  return (
    <div className="space-y-8 pb-8">
      <header className="space-y-2 border-b border-amply-border/60 pb-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[32px] font-bold tracking-tight text-amply-textPrimary">Discover</h1>
          <button
            type="button"
            onClick={async () => {
              setRegenMessage(null);
              try {
                await regenerateSmartPlaylists();
                setRegenMessage('Smart playlists regenerated.');
              } catch (error) {
                setRegenMessage(error instanceof Error ? error.message : 'Failed to regenerate playlists.');
              } finally {
                window.setTimeout(() => setRegenMessage(null), 2500);
              }
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
          <div className="grid grid-cols-1 gap-5 px-2 py-2 sm:grid-flow-row-dense sm:grid-cols-2 xl:grid-cols-3">
            {smartHighlightCards.map((item, index) => {
            const isFeatured = index === 0;
            const artworkSet = item.artworks?.length ? item.artworks : item.artwork ? [item.artwork] : [];
            const glowClass = playlistGlowClasses[index % playlistGlowClasses.length];
            return (
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
                  'playlist-card playlist-card--smart playlist-card-selected-surface group relative overflow-hidden rounded-card p-6 text-left',
                  playlistToneClasses[index % playlistToneClasses.length],
                  glowClass,
                  isFeatured ? 'min-h-[240px] sm:col-span-2 xl:col-span-2' : 'min-h-[180px]',
                )}
                title="Click to play. Double-click to open playlist."
              >
                <div
                  className={clsx(
                    'playlist-card-media',
                    !item.backgroundArtwork ? 'bg-gradient-to-br from-[#2b2723] via-[#4a4035] to-[#171514]' : '',
                  )}
                  style={
                    item.backgroundArtwork
                      ? {
                          backgroundImage: `linear-gradient(140deg, rgba(10, 10, 12, 0.66), rgba(10, 10, 12, 0.28)), url(${item.backgroundArtwork})`,
                        }
                      : undefined
                  }
                />
                <div className="glass-overlay" />

                <div className="relative flex h-full flex-col justify-between gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <p
                        className={clsx(
                          'playlist-text-shadow max-w-[320px] font-semibold text-white',
                          isFeatured ? 'text-[24px]' : 'text-[18px]',
                        )}
                      >
                        {item.title}
                      </p>
                      <p className="playlist-text-shadow text-[13px] font-semibold text-white/90">
                        {item.subtitle}
                      </p>
                      {isFeatured && item.description && item.description !== item.subtitle ? (
                        <p className="playlist-text-shadow max-w-[360px] text-[12px] text-white/78">
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

                  <div className={clsx('artwork-collage artwork-collage--symmetric', isFeatured ? 'max-w-[360px]' : 'max-w-[240px]')}>
                    {[0, 1, 2, 3].map((slot) => {
                      const art = artworkSet[slot] ?? artworkSet[0];
                      return (
                        <div
                          key={`${item.id}-art-${slot}`}
                          className={clsx(
                            'artwork-tile artwork-tile--soft bg-gradient-to-br from-white/95 via-[#f3eadf] to-[#eadcca]',
                            isFeatured ? 'h-24 w-24' : 'h-20 w-20',
                          )}
                        >
                          {art ? <ArtworkImage src={art} alt="" className="h-full w-full object-cover" /> : null}
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
                  'playlist-card playlist-card--smart playlist-card-selected-surface group relative min-h-[180px] overflow-hidden rounded-card p-5 text-left',
                  playlistToneClasses[0],
                  playlistGlowClasses[0],
                )}
              >
                <div
                  className={clsx(
                    'playlist-card-media',
                    !exploreArtworkSongs[0]?.albumArt ? 'bg-gradient-to-br from-[#2b2723] via-[#4a4035] to-[#171514]' : '',
                  )}
                  style={
                    exploreArtworkSongs[0]?.albumArt
                      ? {
                          backgroundImage: `linear-gradient(140deg, rgba(9, 9, 10, 0.72), rgba(9, 9, 10, 0.30)), url(${exploreArtworkSongs[0].albumArt})`,
                        }
                      : undefined
                  }
                />
                <div className="glass-overlay" />
                <div className="absolute inset-2 rounded-[calc(var(--radius-card)-4px)] bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_58%)]" />
                {exploreArtworkSongs.length ? (
                  <div className="absolute right-4 top-4 grid grid-cols-2 gap-2 opacity-95">
                    {exploreArtworkSongs.slice(0, 4).map((song, slot) => (
                      <div
                        key={`explore-art-${song.id}-${slot}`}
                        className="h-14 w-14 overflow-hidden rounded-2xl border border-white/25 bg-white/90 shadow-[0_12px_28px_rgba(0,0,0,0.24)] sm:h-16 sm:w-16"
                      >
                        <ArtworkImage src={song.albumArt} alt="" className="h-full w-full object-cover" />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="relative flex h-full max-w-[72%] flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-amply-border/60 bg-amply-surface/85 px-2 py-1 text-[11px] uppercase tracking-wide text-amply-textSecondary">
                      More Mixes
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="playlist-text-shadow text-[18px] font-semibold text-white">Explore Mixes</p>
                    <p className="playlist-text-shadow text-[12px] text-white/84">
                      {showMoreMixes ? 'Hide the full mix list' : 'Show genre and mood mixes'}
                    </p>
                  </div>
                </div>
              </button>
            ) : null}
          </div>
        </div>

        {!smartHighlightCards.length ? (
          <div className="rounded-card border border-amply-border/60 bg-amply-surface p-4 text-[13px] text-amply-textMuted">
            No smart playlists yet. Add more music or refresh your library to generate mixes.
          </div>
        ) : null}

        {showMoreMixes ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-amply-textSecondary">All Mixes</h3>
            {smartMixesAll.length ? (
              <div className="flex gap-4 overflow-x-auto px-2 py-2 pr-3">
                {smartMixesAll.map((item, index) => {
                  return (
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
                      'card-sheen playlist-card playlist-card--smart playlist-card-selected-surface relative min-w-[220px] max-w-[240px] flex-1 overflow-hidden rounded-card p-5 text-left',
                      playlistToneClasses[(index + 1) % playlistToneClasses.length],
                    )}
                    title="Click to play. Double-click to open playlist."
                  >
                    <div
                      className={clsx(
                        'playlist-card-media',
                        !item.backgroundArtwork ? 'bg-gradient-to-br from-[#2b2723] via-[#4a4035] to-[#171514]' : '',
                      )}
                      style={
                        item.backgroundArtwork
                          ? {
                              backgroundImage: `linear-gradient(140deg, rgba(10, 10, 12, 0.66), rgba(10, 10, 12, 0.32)), url(${item.backgroundArtwork})`,
                            }
                          : undefined
                      }
                    />
                    <div className="absolute inset-2 rounded-[calc(var(--radius-card)-4px)] bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_55%)]" />
                    <div className="relative flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="playlist-text-shadow truncate text-[16px] font-semibold text-white">{item.title}</p>
                        <p className="playlist-text-shadow truncate text-[12px] font-medium text-white">{item.subtitle}</p>
                      </div>
                      <div className="artwork-tile artwork-tile--soft h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/90">
                        {item.artwork ? <ArtworkImage src={item.artwork} alt={item.title} className="h-full w-full object-cover" /> : null}
                      </div>
                    </div>
                  </button>
                  );
                })}
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
          <h2 className="text-[20px] font-semibold text-amply-textPrimary">Your Playlists</h2>
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

      <section className="space-y-3">
        <h2 className="text-[20px] font-semibold text-amply-textPrimary">Top Artists</h2>
        <div className="flex gap-3 overflow-x-auto pb-3 pr-2">
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

      {madeForYouMixes.length ? (
        <section className="space-y-3">
          <h2 className="text-[20px] font-semibold text-amply-textPrimary">Made for you</h2>
          <div className="grid gap-5 xl:grid-cols-2">
            {madeForYouMixes.map((mix) => {
              const cover = mix.coverSongs[0]?.albumArt;
              return (
                <button
                  key={mix.id}
                  type="button"
                  onClick={() => playPlaylist(mix.songIds)}
                  className="made-for-you-card playlist-card playlist-card--smart playlist-card-selected-surface group relative min-h-[420px] overflow-hidden rounded-card bg-[#111] p-7 text-left text-white sm:min-h-[480px]"
                  title={mix.title}
                >
                  <div
                    className={clsx(
                      'playlist-card-media',
                      !mix.backgroundArtwork ? 'bg-gradient-to-br from-[#2b2723] via-[#4a4035] to-[#171514]' : '',
                    )}
                    style={
                      mix.backgroundArtwork
                        ? {
                            backgroundImage: `linear-gradient(180deg, rgba(5, 5, 6, 0.22), rgba(5, 5, 6, 0.72)), url(${mix.backgroundArtwork})`,
                          }
                        : undefined
                    }
                  />
                  <div className="absolute inset-2 rounded-[calc(var(--radius-card)-4px)] bg-black/32" />
                  <div className="absolute inset-x-2 bottom-2 h-1/2 rounded-b-[calc(var(--radius-card)-4px)] bg-gradient-to-t from-black/88 via-black/52 to-transparent" />
                  <div className="relative flex h-full flex-col justify-between gap-8">
                    <div className="flex items-start gap-5">
                      <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/10 shadow-[0_18px_42px_rgba(0,0,0,0.34)]">
                        {cover ? <ArtworkImage src={cover} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 pt-5">
                        <p className="playlist-text-shadow text-[12px] font-semibold text-white/72">Made for you</p>
                        <p className="playlist-text-shadow mt-2 text-[34px] font-bold leading-none text-white sm:text-[44px]">
                          {mix.title}
                        </p>
                        <p className="playlist-text-shadow mt-3 text-[15px] font-semibold text-white/78">
                          {mix.genre}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-end justify-between gap-4">
                      <p className="playlist-text-shadow max-w-[70%] text-[15px] font-semibold text-white">
                        {mix.subtitle}
                      </p>
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_16px_34px_rgba(0,0,0,0.30)] transition-transform group-hover:scale-105">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5.5v13l11-6.5-11-6.5z" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default HomePage;
