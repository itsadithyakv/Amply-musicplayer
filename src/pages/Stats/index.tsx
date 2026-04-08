import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeGrid as Grid,
  FixedSizeList as List,
  type GridChildComponentProps,
  type ListChildComponentProps,
} from 'react-window';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { buildStats, type StatsCards } from '@/services/statsService';
import { formatDuration } from '@/utils/time';
import { loadArtistProfile, readCachedArtistProfile } from '@/services/artistProfileService';
import { readCachedAlbumArtwork } from '@/services/albumArtworkService';
import { getPrimaryArtistName } from '@/utils/artists';

type TopSongItem = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArt?: string;
  playCount: number;
  duration: number;
};

type TopArtistItem = {
  artist: string;
  count: number;
};

type TopAlbumItem = {
  album: string;
  artist: string;
  albumKey: string;
  count: number;
};

const normalizeKeyPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildAlbumKey = (artist: string, album: string): string =>
  `${normalizeKeyPart(artist)}::${normalizeKeyPart(album)}`;

const TopSongRow = memo(({ index, style, data }: ListChildComponentProps) => {
  const { songs, albumImages } = data as {
    songs: TopSongItem[];
    albumImages: Record<string, string | undefined>;
  };
  const song = songs[index];
  if (!song) {
    return null;
  }
  const albumKey = buildAlbumKey(getPrimaryArtistName(song.artist), song.album);

  return (
    <div
      style={style}
      className="group flex items-center gap-3 rounded-lg border border-amply-border/60 bg-amply-bgSecondary/70 px-3 py-2 transition-colors hover:bg-amply-hover"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-amply-border/60 bg-amply-bgPrimary text-[11px] text-amply-textMuted">
        {index + 1}
      </span>
      <ArtworkImage
        src={albumImages[albumKey] ?? song.albumArt}
        alt={song.album}
        className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-amply-textPrimary">{song.title}</p>
        <p className="truncate text-[11px] text-amply-textSecondary">{song.artist}</p>
      </div>
      <span className="rounded-full border border-amply-border/60 bg-amply-bgPrimary px-2 py-1 text-[10px] text-amply-textMuted">
        {song.playCount} plays
      </span>
    </div>
  );
});

const TopArtistCell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
  const { artists, artistImages, songsByArtist } = data as {
    artists: TopArtistItem[];
    artistImages: Record<string, string | undefined>;
    songsByArtist: Map<string, string | undefined>;
  };
  const index = rowIndex * 2 + columnIndex;
  const artist = artists[index];
  if (!artist) {
    return null;
  }

  return (
    <div
      style={{ ...style, padding: 6, boxSizing: 'border-box' }}
      className="overflow-hidden"
    >
      <div className="h-full rounded-lg border border-amply-border/60 bg-amply-bgSecondary/70 p-3 transition-colors hover:bg-amply-hover">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-full bg-zinc-800">
          {artistImages[artist.artist] ? (
            <ArtworkImage src={artistImages[artist.artist]} alt={artist.artist} className="h-full w-full object-cover" />
          ) : songsByArtist.get(artist.artist) ? (
            <ArtworkImage src={songsByArtist.get(artist.artist)} alt={artist.artist} className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-amply-textPrimary">{artist.artist}</p>
          <p className="text-[11px] text-amply-textMuted">{artist.count} plays</p>
        </div>
      </div>
    </div>
    </div>
  );
});

const TopAlbumCell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
  const { albums, albumImages, albumRepresentatives } = data as {
    albums: TopAlbumItem[];
    albumImages: Record<string, string | undefined>;
    albumRepresentatives: Map<string, { albumArt?: string; artist?: string; album?: string }>;
  };
  const index = rowIndex * 2 + columnIndex;
  const album = albums[index];
  if (!album) {
    return null;
  }

  return (
    <div
      style={{ ...style, padding: 6, boxSizing: 'border-box' }}
      className="overflow-hidden"
    >
      <div className="h-full rounded-lg border border-amply-border/60 bg-amply-bgSecondary/70 p-3 transition-colors hover:bg-amply-hover">
      <div className="flex items-center gap-3">
        <ArtworkImage
          src={albumImages[album.albumKey] ?? albumRepresentatives.get(album.albumKey)?.albumArt}
          alt={album.album}
          className="h-12 w-12 overflow-hidden rounded-md bg-zinc-800"
        />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-amply-textPrimary">{album.album}</p>
          <p className="text-[11px] text-amply-textMuted">{album.count} plays</p>
        </div>
      </div>
    </div>
    </div>
  );
});

const StatsPage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const listeningActivity = useLibraryStore((state) => state.listeningActivity);
  const metadataFetchDone = useLibraryStore((state) => state.metadataFetch.done);
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);
  const [stats, setStats] = useState<StatsCards>(() => ({
    totalListeningHours: 0,
    topSongs: [],
    topArtists: [],
    topAlbums: [],
  }));

  useEffect(() => {
    let alive = true;
    void buildStats(songs).then((next) => {
      if (alive) {
        setStats(next);
      }
    });
    return () => {
      alive = false;
    };
  }, [songs]);
  const [artistImages, setArtistImages] = useState<Record<string, string | undefined>>({});
  const [albumImages, setAlbumImages] = useState<Record<string, string | undefined>>({});
  const songsByArtist = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const song of songs) {
      if (!song.artist) {
        continue;
      }
      if (!map.has(song.artist)) {
        map.set(song.artist, song.albumArt);
      }
    }
    return map;
  }, [songs]);
  const albumArtByKey = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const song of songs) {
      if (!song.album || !song.albumArt) {
        continue;
      }
      const albumKey = buildAlbumKey(getPrimaryArtistName(song.artist), song.album);
      const bucket = map.get(albumKey) ?? new Map<string, number>();
      bucket.set(song.albumArt, (bucket.get(song.albumArt) ?? 0) + 1);
      map.set(albumKey, bucket);
    }
    const resolved = new Map<string, string>();
    for (const [albumKey, bucket] of map.entries()) {
      let best: string | null = null;
      let bestCount = -1;
      for (const [art, count] of bucket.entries()) {
        if (count > bestCount) {
          best = art;
          bestCount = count;
        }
      }
      if (best) {
        resolved.set(albumKey, best);
      }
    }
    return resolved;
  }, [songs]);

  const albumRepresentatives = useMemo(() => {
    const map = new Map<string, { albumArt?: string; artist?: string; album?: string }>();
    for (const song of songs) {
      if (!song.album) {
        continue;
      }
      const albumKey = buildAlbumKey(getPrimaryArtistName(song.artist), song.album);
      if (!map.has(albumKey)) {
        map.set(albumKey, {
          albumArt: albumArtByKey.get(albumKey) ?? song.albumArt,
          artist: song.artist,
          album: song.album,
        });
      }
    }
    return map;
  }, [songs, albumArtByKey]);


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
      for (const artist of stats.topArtists) {
        let result = await readCachedArtistProfile(artist.artist);
        if (result.status === 'missing' && !metadataFetchPaused) {
          result = await loadArtistProfile(artist.artist);
        }
        if (!alive) {
          return;
        }
        if (result.status === 'ready') {
          next[artist.artist] = result.profile.imageUrl ?? undefined;
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

    void load();
    return () => {
      alive = false;
    };
  }, [stats.topArtists, metadataFetchDone, metadataFetchPaused]);

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
      const targets = [
        ...stats.topAlbums.map((album) => ({
          albumKey: album.albumKey,
          album: album.album,
          artist: album.artist,
        })),
        ...stats.topSongs.map((song) => ({
          albumKey: buildAlbumKey(getPrimaryArtistName(song.artist), song.album),
          album: song.album,
          artist: getPrimaryArtistName(song.artist),
        })),
      ];

      let handled = 0;
      for (const target of targets) {
        if (!target?.albumKey || next[target.albumKey]) {
          continue;
        }
        const rep = albumRepresentatives.get(target.albumKey);
        const artist = (target.artist || rep?.artist || '').toString();
        const album = rep?.album ?? target.album;
        if (!artist || !album) {
          continue;
        }
        const remote = await readCachedAlbumArtwork(artist, album);
        if (!alive) {
          return;
        }
        next[target.albumKey] = rep?.albumArt ?? remote ?? undefined;
        handled += 1;
        if (handled % 3 === 0) {
          await idleWait();
        }
      }

      if (alive) {
        setAlbumImages(next);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [stats.topAlbums, stats.topSongs, albumRepresentatives]);

  const topSongsHeight = Math.min(380, Math.max(200, stats.topSongs.length * 64));
  const topArtistsRows = Math.ceil(stats.topArtists.length / 2);
  const topArtistsHeight = Math.min(360, Math.max(200, topArtistsRows * 84));
  const topAlbumsRows = Math.ceil(stats.topAlbums.length / 2);
  const topAlbumsHeight = Math.min(360, Math.max(200, topAlbumsRows * 84));
  const topSong = stats.topSongs[0];
  const topArtist = stats.topArtists[0];
  const topAlbum = stats.topAlbums[0];
  const topSongArtist = topSong?.artist ?? 'No plays yet';
  const topSongAlbum = topSong?.album ?? '';
  const [activityMode, setActivityMode] = useState<'weekly' | 'monthly'>('weekly');
  const dailySeconds = useMemo(() => {
    const stored = listeningActivity?.dailySeconds ?? {};
    if (Object.keys(stored).length > 0) {
      return stored;
    }
    const fallback: Record<string, number> = {};
    for (const song of songs) {
      if (!song.lastPlayed) {
        continue;
      }
      const seconds = typeof song.totalPlaySeconds === 'number' && song.totalPlaySeconds > 0
        ? song.totalPlaySeconds
        : song.duration * (song.playCount || 0);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        continue;
      }
      const date = new Date(song.lastPlayed * 1000);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`;
      fallback[key] = (fallback[key] ?? 0) + seconds;
    }
    return fallback;
  }, [listeningActivity, songs]);

  const energyCards = useMemo(() => {
    const topSongByTime = stats.topSongs.length
      ? stats.topSongs
          .map((song) => ({ song, timeSec: song.duration * song.playCount }))
          .sort((a, b) => b.timeSec - a.timeSec)[0]
      : null;

    const genreTotals = new Map<string, number>();
    for (const song of songs) {
      const genre = song.genre?.trim() || 'Unknown Genre';
      const plays = song.playCount || 0;
      if (!plays) {
        continue;
      }
      genreTotals.set(genre, (genreTotals.get(genre) ?? 0) + plays);
    }
    const topGenre = [...genreTotals.entries()].sort((a, b) => b[1] - a[1])[0];

    const dayTotals = new Map<string, number>();
    for (const [dayKey, seconds] of Object.entries(dailySeconds)) {
      dayTotals.set(dayKey, seconds);
    }
    const topDay = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    const formatDay = (value: string) => {
      const parts = value.split('-').map((item) => Number(item));
      if (parts.length === 3 && parts.every((item) => Number.isFinite(item))) {
        const [year, month, day] = parts;
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return value;
    };

    return [
      {
        id: 'time-on-track',
        label: 'Time on One Track',
        title: topSongByTime ? topSongByTime.song.title : 'No plays yet',
        subtitle: topSongByTime ? formatDuration(topSongByTime.timeSec) : 'Start listening',
        gradient: '#FFD438, #FF8A00 55%, #FF3D00',
      },
      {
        id: 'most-loved-genre',
        label: 'Most Loved Genre',
        title: topGenre ? topGenre[0] : 'No data yet',
        subtitle: topGenre ? `${topGenre[1]} plays` : 'Keep listening',
        gradient: '#3DFFEC, #1ED0FF 55%, #005BFF',
      },
      {
        id: 'biggest-day',
        label: 'Biggest Listening Day',
        title: topDay ? formatDay(topDay[0]) : 'No data yet',
        subtitle: topDay ? formatDuration(topDay[1]) : 'Play a few tracks',
        gradient: '#B84CFF, #FF4CE2 55%, #FFB84C',
      },
    ];
  }, [stats.topSongs, songs, dailySeconds]);

  const energyCarouselRef = useRef<HTMLDivElement | null>(null);
  const [energyIndex, setEnergyIndex] = useState(0);
  const dragStartXRef = useRef<number | null>(null);
  const dragDeltaRef = useRef(0);

  useEffect(() => {
    if (!energyCards.length) {
      return;
    }
    let interval: number | null = null;
    const start = () => {
      if (interval) {
        return;
      }
      interval = window.setInterval(() => {
        setEnergyIndex((prev) => (prev + 1) % energyCards.length);
      }, 4200);
    };
    const stop = () => {
      if (interval) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        start();
      }
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, [energyCards.length]);

  const handleEnergyPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragStartXRef.current = event.clientX;
    dragDeltaRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleEnergyPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) {
      return;
    }
    dragDeltaRef.current = event.clientX - dragStartXRef.current;
  };

  const handleEnergyPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) {
      return;
    }
    const delta = dragDeltaRef.current;
    dragStartXRef.current = null;
    dragDeltaRef.current = 0;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (Math.abs(delta) < 40) {
      return;
    }
    if (delta < 0) {
      setEnergyIndex((prev) => (prev + 1) % energyCards.length);
    } else {
      setEnergyIndex((prev) => (prev - 1 + energyCards.length) % energyCards.length);
    }
  };

  const weeklyProfile = useMemo(() => {
    const buckets = new Array(7).fill(0);
    const now = new Date();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`;
      const day = date.getDay();
      const normalized = (day + 6) % 7;
      buckets[normalized] += dailySeconds[key] ?? 0;
    }
    const max = Math.max(1, ...buckets);
    return buckets.map((value) => ({
      value,
      percent: Math.round((value / max) * 100),
    }));
  }, [dailySeconds]);

  const monthlyProfile = useMemo(() => {
    const buckets: Array<{ key: string; value: number }> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({ key, value: 0 });
    }
    const bucketMap = new Map(buckets.map((entry) => [entry.key, entry]));
    for (const [key, value] of Object.entries(dailySeconds)) {
      const monthKey = key.slice(0, 7);
      const entry = bucketMap.get(monthKey);
      if (entry) {
        entry.value += value;
      }
    }
    const max = Math.max(1, ...buckets.map((entry) => entry.value));
    return buckets.map((entry) => ({
      value: entry.value,
      percent: Math.round((entry.value / max) * 100),
    }));
  }, [dailySeconds]);
  const weeklyLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthlyLabels = useMemo(() => {
    const now = new Date();
    const labels: string[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(date.toLocaleString(undefined, { month: 'short' }));
    }
    return labels;
  }, []);
  const activityProfile = activityMode === 'weekly' ? weeklyProfile : monthlyProfile;
  const activityLabels = activityMode === 'weekly' ? weeklyLabels : monthlyLabels;
  const activityMaxHours = useMemo(() => {
    const maxValue = Math.max(1, ...activityProfile.map((entry) => entry.value ?? 0));
    return maxValue / 3600;
  }, [activityProfile]);
  const activityMidHours = activityMaxHours / 2;
  const formatHours = (value: number) => {
    if (value < 1 && value > 0) {
      return `${Math.round(value * 60)}m`;
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}h`;
  };

  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-3xl border border-amply-border/70 bg-amply-card">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,138,43,0.18),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-amply-bgPrimary/60 via-transparent to-transparent" />
        <div className="relative flex flex-col gap-6 px-8 py-7 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-amply-border/60 bg-amply-bgSecondary/70 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-amply-textMuted">
              Statistics
            </div>
            <h1 className="text-[34px] font-semibold text-amply-textPrimary">Listening Overview</h1>
            <p className="max-w-xl text-[13px] text-amply-textSecondary">
              A refined snapshot of your library activity, tuned to the Amply aesthetic.
            </p>
          </div>
          <div className="rounded-2xl border border-amply-border/50 bg-amply-bgSecondary/80 px-5 py-4 text-right shadow-card">
            <p className="text-[11px] uppercase tracking-[0.18em] text-amply-textMuted">Listening Time</p>
            <p className="mt-2 text-[28px] font-semibold text-amply-textPrimary">{stats.totalListeningHours}h</p>
            <p className="text-[11px] text-amply-textSecondary">Offline playback only</p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl border border-amply-border/60 bg-amply-card p-6 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amply-textMuted">Most Heard Song</p>
              <p className="mt-2 text-[22px] font-semibold text-amply-textPrimary">{topSong?.title ?? 'No plays yet'}</p>
              <p className="text-[12px] text-amply-accent">{topSong ? `${topSong.playCount} plays` : 'Start listening'}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amply-bgSecondary text-amply-textMuted">
              ♪
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <ArtworkImage
              src={albumImages[topSongAlbum] ?? topSong?.albumArt}
              alt={topSongAlbum}
              className="h-12 w-12 overflow-hidden rounded-lg bg-zinc-800"
            />
            <div>
              <p className="text-[12px] font-semibold text-amply-textPrimary">{topSongArtist}</p>
              <p className="text-[11px] text-amply-textMuted">{topSongAlbum || 'Unknown album'}</p>
            </div>
          </div>
          <div className="absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-amply-accent/10 blur-3xl" />
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-amply-border/60 bg-amply-card p-6 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amply-textMuted">Top Artist</p>
              <p className="mt-2 text-[22px] font-semibold text-amply-textPrimary">{topArtist?.artist ?? 'No data yet'}</p>
              <p className="text-[12px] text-amply-accent">{topArtist ? `${topArtist.count} plays` : 'Keep listening'}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amply-bgSecondary text-amply-textMuted">
              ◎
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-full bg-amply-bgSecondary">
              {topArtist?.artist ? (
                <ArtworkImage
                  src={artistImages[topArtist.artist] ?? songsByArtist.get(topArtist.artist)}
                  alt={topArtist.artist}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div>
              <p className="text-[12px] font-semibold text-amply-textPrimary">{topArtist?.artist ?? 'Amply'}</p>
              <p className="text-[11px] text-amply-textMuted">Your top creator</p>
            </div>
          </div>
          <div className="absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-blue-500/10 blur-3xl" />
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-amply-border/60 bg-amply-card p-6 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amply-textMuted">Most Loved Album</p>
              <p className="mt-2 text-[22px] font-semibold text-amply-textPrimary">{topAlbum?.album ?? 'No data yet'}</p>
              <p className="text-[12px] text-amply-accent">{topAlbum ? `${topAlbum.count} plays` : 'Build history'}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amply-bgSecondary text-amply-textMuted">
              ◈
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <ArtworkImage
              src={
                topAlbum
                  ? albumImages[topAlbum.albumKey] ?? albumRepresentatives.get(topAlbum.albumKey)?.albumArt
                  : undefined
              }
              alt={topAlbum?.album ?? 'Album artwork'}
              className="h-12 w-12 overflow-hidden rounded-lg bg-zinc-800"
            />
            <div>
              <p className="text-[12px] font-semibold text-amply-textPrimary">{topAlbum?.album ?? 'Amply'}</p>
              <p className="text-[11px] text-amply-textMuted">Top album</p>
            </div>
          </div>
          <div className="absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-amply-accent/10 blur-3xl" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-3xl border border-amply-border/60 bg-amply-card p-7 shadow-card">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[18px] font-semibold text-amply-textPrimary">Listening Activity</p>
              <p className="text-[12px] text-amply-textMuted">Weekly activity across your peak days</p>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <button
                type="button"
                onClick={() => setActivityMode('weekly')}
                className={`rounded-full px-3 py-1 transition-colors ${
                  activityMode === 'weekly'
                    ? 'bg-amply-bgSecondary text-amply-textPrimary'
                    : 'text-amply-textMuted hover:bg-amply-hover'
                }`}
              >
                Weekly
              </button>
              <button
                type="button"
                onClick={() => setActivityMode('monthly')}
                className={`rounded-full px-3 py-1 transition-colors ${
                  activityMode === 'monthly'
                    ? 'bg-amply-bgSecondary text-amply-textPrimary'
                    : 'text-amply-textMuted hover:bg-amply-hover'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>
          <div className="mt-8 grid gap-4" style={{ gridTemplateColumns: '32px minmax(0, 1fr)' }}>
            <div className="flex h-40 flex-col justify-between text-[10px] font-semibold text-amply-textMuted">
              <span>{formatHours(activityMaxHours)}</span>
              <span>{formatHours(activityMidHours)}</span>
              <span>0h</span>
            </div>
            <div className="relative grid h-40 items-end gap-2 overflow-hidden" style={{ gridTemplateColumns: `repeat(${activityMode === 'weekly' ? 7 : 12}, minmax(0, 1fr))` }}>
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-0 h-px bg-amply-border/50" />
                <div className="absolute left-0 right-0 top-1/2 h-px bg-amply-border/40" />
                <div className="absolute left-0 right-0 bottom-0 h-px bg-amply-border/50" />
              </div>
              {activityProfile.map((entry, index) => (
                <div key={activityLabels[index]} className="flex flex-col items-center gap-3">
                  <div className="flex h-40 w-full items-end">
                    <div
                      className="w-full rounded-t-xl bg-amply-accent/70"
                      style={{ height: `${Math.max(4, entry.percent)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amply-textMuted">
                    {activityLabels[index]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-amply-border/60 bg-amply-card p-7 shadow-card">
          <div className="mb-6 flex items-center justify-between">
            <p className="text-[18px] font-semibold text-amply-textPrimary">Energy Cards</p>
            <span className="text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Auto</span>
          </div>
          <div
            ref={energyCarouselRef}
            className="energy-carousel relative h-[260px] w-full overflow-hidden rounded-3xl"
            onPointerDown={handleEnergyPointerDown}
            onPointerMove={handleEnergyPointerMove}
            onPointerUp={handleEnergyPointerUp}
            onPointerCancel={handleEnergyPointerUp}
          >
            <div
              className="energy-track flex h-full w-full gap-0 transition-transform duration-[650ms] ease-[cubic-bezier(0.2,0.9,0.2,1)]"
              style={{ transform: `translateX(-${energyIndex * 100}%)` }}
            >
              {energyCards.map((card) => (
                <div
                  key={card.id}
                  className="energy-card relative min-w-full overflow-hidden rounded-3xl border border-white/30 p-7 shadow-[0_18px_45px_rgba(0,0,0,0.35)]"
                  style={{
                    background: `linear-gradient(135deg, ${card.gradient})`,
                  }}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.55),transparent_60%)]" />
                  <div className="absolute -bottom-8 -right-6 h-28 w-28 rounded-full bg-white/40 blur-2xl" />
                  <div className="relative flex h-full flex-col justify-between gap-6">
                    <div className="space-y-3">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-black/60">{card.label}</p>
                      <p className="text-[26px] font-semibold leading-tight text-black">{card.title}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-black/10 px-3 py-1 text-[11px] font-semibold text-black/70">
                        {card.subtitle}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-black/50">Swipe</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-amply-border/60 bg-amply-card p-7 shadow-card">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-[20px] font-semibold text-amply-textPrimary">Top Tracks</p>
        </div>
        <div className="space-y-3" style={{ height: topSongsHeight }}>
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                itemCount={stats.topSongs.length}
                itemSize={64}
                itemData={{ songs: stats.topSongs, albumImages }}
                overscanCount={6}
              >
                {TopSongRow}
              </List>
            )}
          </AutoSizer>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-amply-border/60 bg-amply-card shadow-card">
          <div className="border-b border-amply-border/60 px-6 py-4">
            <p className="text-[13px] font-semibold text-amply-textPrimary">Top Artists</p>
            <p className="text-[11px] text-amply-textMuted">Most played creators</p>
          </div>
          <div className="px-4 py-4 overflow-hidden" style={{ height: topArtistsHeight }}>
            <AutoSizer>
              {({ height, width }) => {
                const columnWidth = Math.max(0, Math.floor((width - 8) / 2));
                return (
                  <Grid
                    height={height}
                    width={width}
                    columnCount={2}
                    rowCount={Math.ceil(stats.topArtists.length / 2)}
                    columnWidth={columnWidth}
                    rowHeight={96}
                    itemData={{ artists: stats.topArtists, artistImages, songsByArtist }}
                    className="overflow-x-hidden"
                  >
                    {TopArtistCell}
                  </Grid>
                  );
                }}
              </AutoSizer>
            </div>
          </section>

        <section className="rounded-3xl border border-amply-border/60 bg-amply-card shadow-card">
          <div className="border-b border-amply-border/60 px-6 py-4">
            <p className="text-[13px] font-semibold text-amply-textPrimary">Top Albums</p>
            <p className="text-[11px] text-amply-textMuted">Heavy rotation picks</p>
          </div>
          <div className="px-4 py-4 overflow-hidden" style={{ height: topAlbumsHeight }}>
            <AutoSizer>
              {({ height, width }) => {
                const columnWidth = Math.max(0, Math.floor((width - 8) / 2));
                return (
                  <Grid
                    height={height}
                    width={width}
                    columnCount={2}
                    rowCount={Math.ceil(stats.topAlbums.length / 2)}
                    columnWidth={columnWidth}
                    rowHeight={96}
                    itemData={{ albums: stats.topAlbums, albumImages, albumRepresentatives }}
                    className="overflow-x-hidden"
                  >
                    {TopAlbumCell}
                  </Grid>
                  );
                }}
              </AutoSizer>
            </div>
          </section>
      </div>

      {stats.topSongs.length === 0 ? (
        <p className="text-[13px] text-amply-textMuted">No listening data yet. Start playback to populate stats.</p>
      ) : null}
    </div>
  );
};

export default StatsPage;
