import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  FixedSizeGrid as Grid,
  FixedSizeList as List,
  type GridChildComponentProps,
  type ListChildComponentProps,
} from 'react-window';
import { useLibraryStore } from '@/store/libraryStore';
import { buildStats } from '@/services/statsService';
import { formatDuration } from '@/utils/time';
import { loadArtistProfile } from '@/services/artistProfileService';
import { loadAlbumArtwork } from '@/services/albumArtworkService';

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
  count: number;
};

const TopSongRow = memo(({ index, style, data }: ListChildComponentProps) => {
  const { songs, albumImages } = data as {
    songs: TopSongItem[];
    albumImages: Record<string, string | undefined>;
  };
  const song = songs[index];
  if (!song) {
    return null;
  }

  return (
    <div
      style={style}
      className="group flex items-center gap-3 rounded-lg border border-amply-border/60 bg-amply-bgSecondary/70 px-3 py-2 transition-colors hover:bg-amply-hover"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-amply-border/60 bg-amply-bgPrimary text-[11px] text-amply-textMuted">
        {index + 1}
      </span>
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800">
        {albumImages[song.album] ? (
          <img src={albumImages[song.album]} alt={song.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : song.albumArt ? (
          <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : null}
      </div>
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
    <div style={style} className="rounded-lg border border-amply-border/60 bg-amply-bgSecondary/70 p-3 transition-colors hover:bg-amply-hover">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-full bg-zinc-800">
          {artistImages[artist.artist] ? (
            <img src={artistImages[artist.artist]} alt={artist.artist} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : songsByArtist.get(artist.artist) ? (
            <img src={songsByArtist.get(artist.artist)} alt={artist.artist} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-amply-textPrimary">{artist.artist}</p>
          <p className="text-[11px] text-amply-textMuted">{artist.count} plays</p>
        </div>
      </div>
    </div>
  );
});

const TopAlbumCell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
  const { albums, albumImages, albumRepresentatives } = data as {
    albums: TopAlbumItem[];
    albumImages: Record<string, string | undefined>;
    albumRepresentatives: Map<string, { albumArt?: string; artist?: string }>;
  };
  const index = rowIndex * 2 + columnIndex;
  const album = albums[index];
  if (!album) {
    return null;
  }

  return (
    <div style={style} className="rounded-lg border border-amply-border/60 bg-amply-bgSecondary/70 p-3 transition-colors hover:bg-amply-hover">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-md bg-zinc-800">
          {albumImages[album.album] ? (
            <img src={albumImages[album.album]} alt={album.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : albumRepresentatives.get(album.album)?.albumArt ? (
            <img src={albumRepresentatives.get(album.album)?.albumArt} alt={album.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-amply-textPrimary">{album.album}</p>
          <p className="text-[11px] text-amply-textMuted">{album.count} plays</p>
        </div>
      </div>
    </div>
  );
});

const StatsPage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const stats = useMemo(() => buildStats(songs), [songs]);
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
  const albumRepresentatives = useMemo(() => {
    const map = new Map<string, { albumArt?: string; artist?: string }>();
    for (const song of songs) {
      if (!song.album) {
        continue;
      }
      if (!map.has(song.album)) {
        map.set(song.album, { albumArt: song.albumArt, artist: song.artist });
      }
    }
    return map;
  }, [songs]);

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
    for (const song of songs) {
      if (!song.lastPlayed) {
        continue;
      }
      const dayKey = new Date(song.lastPlayed * 1000).toLocaleDateString();
      dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + song.duration);
    }
    const topDay = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];

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
        title: topDay ? topDay[0] : 'No data yet',
        subtitle: topDay ? formatDuration(topDay[1]) : 'Play a few tracks',
        gradient: '#B84CFF, #FF4CE2 55%, #FFB84C',
      },
    ];
  }, [stats.topSongs, songs]);

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
        const result = await loadArtistProfile(artist.artist);
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
  }, [stats.topArtists]);

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
        ...stats.topAlbums.map((album) => album.album),
        ...stats.topSongs.map((song) => song.album),
      ].filter(Boolean);

      let handled = 0;
      for (const album of targets) {
        if (!album || next[album]) {
          continue;
        }
        const rep = albumRepresentatives.get(album);
        if (!rep?.artist) {
          continue;
        }
        const remote = await loadAlbumArtwork(rep.artist, album);
        if (!alive) {
          return;
        }
        next[album] = remote ?? rep.albumArt;
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

  return (
    <div className="space-y-6 pb-8">
      <header className="relative overflow-hidden rounded-card border border-amply-border bg-amply-card p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,122,26,0.22),transparent_60%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-amply-border/60 bg-amply-bgSecondary px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-amply-textMuted">
              Stats
            </div>
            <h1 className="text-[28px] font-semibold text-amply-textPrimary">Listening overview</h1>
            <p className="max-w-xl text-[13px] text-amply-textSecondary">
              A focused snapshot of your local play history. Lightweight, fast, and easy to skim.
            </p>
          </div>
          <div className="rounded-2xl border border-amply-border/50 bg-amply-bgSecondary/70 px-5 py-4 text-right shadow-card">
            <p className="text-[11px] uppercase tracking-[0.18em] text-amply-textMuted">Listening Time</p>
            <p className="mt-2 text-[28px] font-semibold text-amply-textPrimary">{stats.totalListeningHours}h</p>
            <p className="text-[11px] text-amply-textSecondary">Offline playback only</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-card border border-amply-border bg-amply-card shadow-card">
          <div className="flex items-center justify-between border-b border-amply-border/60 px-5 py-4">
            <div>
              <p className="text-[13px] font-semibold text-amply-textPrimary">Top Songs</p>
              <p className="text-[11px] text-amply-textMuted">Sorted by play count</p>
            </div>
            {stats.topSongs[0] ? (
              <span className="text-[11px] text-amply-textMuted">
                Longest in top: {formatDuration(stats.topSongs[0].duration)}
              </span>
            ) : null}
          </div>
          <div className="px-4 py-4" style={{ height: topSongsHeight }}>
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

          <div className="border-t border-amply-border/60 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-amply-textPrimary">Energy Cards</p>
                <p className="text-[11px] text-amply-textMuted">Quick pulse checks from your history</p>
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Auto</span>
            </div>
            <div className="mt-4">
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
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-card border border-amply-border bg-amply-card shadow-card">
            <div className="border-b border-amply-border/60 px-5 py-4">
              <p className="text-[13px] font-semibold text-amply-textPrimary">Top Artists</p>
              <p className="text-[11px] text-amply-textMuted">Most played creators</p>
            </div>
            <div className="px-4 py-4 overflow-hidden" style={{ height: topArtistsHeight }}>
              <AutoSizer>
                {({ height, width }) => (
                  <Grid
                    height={height}
                    width={width}
                    columnCount={2}
                    rowCount={Math.ceil(stats.topArtists.length / 2)}
                    columnWidth={Math.floor(width / 2)}
                    rowHeight={84}
                    itemData={{ artists: stats.topArtists, artistImages, songsByArtist }}
                  >
                    {TopArtistCell}
                  </Grid>
                )}
              </AutoSizer>
            </div>
          </section>

          <section className="rounded-card border border-amply-border bg-amply-card shadow-card">
            <div className="border-b border-amply-border/60 px-5 py-4">
              <p className="text-[13px] font-semibold text-amply-textPrimary">Top Albums</p>
              <p className="text-[11px] text-amply-textMuted">Heavy rotation picks</p>
            </div>
            <div className="px-4 py-4 overflow-hidden" style={{ height: topAlbumsHeight }}>
              <AutoSizer>
                {({ height, width }) => (
                  <Grid
                    height={height}
                    width={width}
                    columnCount={2}
                    rowCount={Math.ceil(stats.topAlbums.length / 2)}
                    columnWidth={Math.floor(width / 2)}
                    rowHeight={84}
                    itemData={{ albums: stats.topAlbums, albumImages, albumRepresentatives }}
                  >
                    {TopAlbumCell}
                  </Grid>
                )}
              </AutoSizer>
            </div>
          </section>
        </div>
      </div>

      {stats.topSongs.length === 0 ? (
        <p className="text-[13px] text-amply-textMuted">No listening data yet. Start playback to populate stats.</p>
      ) : null}
    </div>
  );
};

export default StatsPage;
