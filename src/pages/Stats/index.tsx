import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { buildStats } from '@/services/statsService';
import { formatDuration } from '@/utils/time';
import { loadArtistProfile } from '@/services/artistProfileService';
import { loadAlbumArtwork } from '@/services/albumArtworkService';

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

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next: Record<string, string | undefined> = {};
      for (const artist of stats.topArtists) {
        const result = await loadArtistProfile(artist.artist);
        if (!alive) {
          return;
        }
        if (result.status === 'ready') {
          next[artist.artist] = result.profile.imageUrl ?? undefined;
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
    const load = async () => {
      const next: Record<string, string | undefined> = {};
      const targets = [
        ...stats.topAlbums.map((album) => album.album),
        ...stats.topSongs.map((song) => song.album),
      ].filter(Boolean);

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

  return (
    <div className="space-y-8 pb-10">
      <header className="relative overflow-hidden rounded-card border border-amply-border bg-amply-card p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,122,26,0.18),transparent_55%)]" />
        <div className="relative space-y-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted">Amply Wrapped</p>
          <h1 className="text-3xl font-bold text-amply-textPrimary">Your listening, reimagined</h1>
          <p className="text-[13px] text-amply-textSecondary">
            A snapshot of your offline play history, powered by local stats.
          </p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-amply-textMuted">Listening Time</p>
          <p className="mt-2 text-3xl font-bold text-amply-textPrimary">{stats.totalListeningHours}h</p>
          <p className="mt-1 text-[12px] text-amply-textSecondary">Total offline playback</p>
        </div>
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-amply-textMuted">Top Songs</p>
          <p className="mt-2 text-3xl font-bold text-amply-textPrimary">{stats.topSongs.length}</p>
          <p className="mt-1 text-[12px] text-amply-textSecondary">Most replayed tracks</p>
        </div>
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-amply-textMuted">Top Artists</p>
          <p className="mt-2 text-3xl font-bold text-amply-textPrimary">{stats.topArtists.length}</p>
          <p className="mt-1 text-[12px] text-amply-textSecondary">Artists you love most</p>
        </div>
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-amply-textMuted">Top Albums</p>
          <p className="mt-2 text-3xl font-bold text-amply-textPrimary">{stats.topAlbums.length}</p>
          <p className="mt-1 text-[12px] text-amply-textSecondary">Albums in heavy rotation</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-card border border-amply-border bg-amply-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-semibold text-amply-textPrimary">Top Songs</p>
            {stats.topSongs[0] ? (
              <span className="text-[11px] text-amply-textMuted">
                Most played duration: {formatDuration(stats.topSongs[0].duration)}
              </span>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            {stats.topSongs.map((song, index) => (
              <div key={song.id} className="flex items-center gap-3 rounded-lg border border-amply-border bg-amply-bgSecondary px-3 py-2">
                <span className="w-6 text-center text-[12px] text-amply-textMuted">{index + 1}</span>
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                  {albumImages[song.album] ? (
                    <img src={albumImages[song.album]} alt={song.album} className="h-full w-full object-cover" />
                  ) : song.albumArt ? (
                    <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-amply-textPrimary">{song.title}</p>
                  <p className="truncate text-[11px] text-amply-textSecondary">{song.artist}</p>
                </div>
                <span className="text-[11px] text-amply-textMuted">{song.playCount} plays</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-card border border-amply-border bg-amply-card p-5">
            <p className="text-[14px] font-semibold text-amply-textPrimary">Top Artists</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {stats.topArtists.map((artist) => (
                <div key={artist.artist} className="rounded-lg border border-amply-border bg-amply-bgSecondary p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-full bg-zinc-800">
                      {artistImages[artist.artist] ? (
                        <img src={artistImages[artist.artist]} alt={artist.artist} className="h-full w-full object-cover" />
                      ) : songsByArtist.get(artist.artist) ? (
                        <img src={songsByArtist.get(artist.artist)} alt={artist.artist} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-amply-textPrimary">{artist.artist}</p>
                      <p className="text-[11px] text-amply-textMuted">{artist.count} plays</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-amply-border bg-amply-card p-5">
            <p className="text-[14px] font-semibold text-amply-textPrimary">Top Albums</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {stats.topAlbums.map((album) => (
                <div key={album.album} className="rounded-lg border border-amply-border bg-amply-bgSecondary p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-md bg-zinc-800">
                      {albumImages[album.album] ? (
                        <img src={albumImages[album.album]} alt={album.album} className="h-full w-full object-cover" />
                      ) : albumRepresentatives.get(album.album)?.albumArt ? (
                        <img src={albumRepresentatives.get(album.album)?.albumArt} alt={album.album} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-amply-textPrimary">{album.album}</p>
                      <p className="text-[11px] text-amply-textMuted">{album.count} plays</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {stats.topSongs.length === 0 ? (
        <p className="text-[13px] text-amply-textMuted">No listening data yet. Start playback to populate stats.</p>
      ) : null}
    </div>
  );
};

export default StatsPage;
