import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist, Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';

const SectionRow = ({ title, songs, onPick }: { title: string; songs: Song[]; onPick: (song: Song) => void }) => {
  if (!songs.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[18px] font-bold text-amply-textPrimary">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {songs.map((song) => (
          <AlbumCard
            key={`${title}-${song.id}`}
            title={song.title}
            subtitle={song.artist}
            artwork={song.albumArt}
            onClick={() => onPick(song)}
          />
        ))}
      </div>
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
  title: string;
  subtitle: string;
  artwork?: string;
  songIds: string[];
  startSongId?: string;
  kind: 'smart' | 'custom';
}

const playlistToneClasses = [
  'bg-gradient-to-br from-[#1a1f2b] via-[#171b23] to-[#14171d]',
  'bg-gradient-to-br from-[#232019] via-[#1e1b16] to-[#181613]',
  'bg-gradient-to-br from-[#1a2521] via-[#16201c] to-[#121a16]',
  'bg-gradient-to-br from-[#272025] via-[#211b20] to-[#1a1619]',
];

const HomePage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const playlists = useLibraryStore((state) => state.playlists);
  const navigate = useNavigate();

  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const [showMoreMixes, setShowMoreMixes] = useState(false);

  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  const recentlyPlayed = useMemo(
    () => [...songs].filter((song) => song.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, 16),
    [songs],
  );

  const rediscoverSongs = useMemo(() => {
    const rediscover = playlists.find((playlist) => playlist.id === 'smart_rediscover');
    if (!rediscover) {
      return [];
    }

    return rediscover.songIds
      .map((songId) => songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song))
      .slice(0, 16);
  }, [playlists, songs]);

  const topArtists = useMemo(() => {
    const artistMap = new Map<string, Song[]>();
    const artistSongIdMap = new Map<string, Set<string>>();
    const playCountBySongId = new Map(songs.map((song) => [song.id, song.playCount]));

    for (const song of songs) {
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

    return rankedArtists
      .sort((a, b) => {
        const aPlays = a.songIds.reduce((total, id) => total + (playCountBySongId.get(id) ?? 0), 0);
        const bPlays = b.songIds.reduce((total, id) => total + (playCountBySongId.get(id) ?? 0), 0);
        return bPlays - aPlays;
      })
      .slice(0, 16);
  }, [songs]);

  const getPlaylistArtwork = (playlist: Playlist): string | undefined => {
    if (playlist.artwork) {
      return playlist.artwork;
    }

    const firstSong = playlist.songIds.map((songId) => songsById.get(songId)).find(Boolean);
    return firstSong?.albumArt;
  };

  const smartPlaylistCards = useMemo<PlaylistCardItem[]>(() => {
    const smart = playlists
      .filter((playlist) => playlist.type === 'smart')
      .map((playlist) => ({
        id: playlist.id,
        title: playlist.name,
        subtitle: `${playlist.songIds.length} songs`,
        artwork: getPlaylistArtwork(playlist),
        songIds: playlist.songIds,
        kind: 'smart' as const,
      }))
      .filter((entry) => entry.songIds.length);

    const recentlyPlayedCustom = playlists
      .filter((playlist) => playlist.type === 'custom')
      .map((playlist) => {
        const maxLastPlayed = Math.max(0, ...playlist.songIds.map((id) => songsById.get(id)?.lastPlayed ?? 0));

        return {
          playlist,
          maxLastPlayed,
        };
      })
      .filter((entry) => entry.maxLastPlayed > 0)
      .sort((a, b) => b.maxLastPlayed - a.maxLastPlayed)
      .slice(0, 6)
      .map(({ playlist }) => ({
        id: `${playlist.id}-recent`,
        title: playlist.name,
        subtitle: `Recently played - ${playlist.songIds.length} songs`,
        artwork: getPlaylistArtwork(playlist),
        songIds: playlist.songIds,
        kind: 'custom' as const,
      }))
      .filter((entry) => entry.songIds.length);

    return [...smart, ...recentlyPlayedCustom].slice(0, 6);
  }, [playlists, songsById]);

  const smartMixesAll = useMemo<PlaylistCardItem[]>(() => {
    return playlists
      .filter((playlist) => playlist.type === 'smart')
      .map((playlist) => ({
        id: playlist.id,
        title: playlist.name,
        subtitle: playlist.description || `${playlist.songIds.length} songs`,
        artwork: getPlaylistArtwork(playlist),
        songIds: playlist.songIds,
        kind: 'smart' as const,
      }))
      .filter((entry) => entry.songIds.length);
  }, [playlists, songsById]);


  const pickSong = (song: Song) => {
    const queue = songs.map((item) => item.id);
    setQueue(queue, song.id);
    void playSongById(song.id, false);
  };

  const playPlaylist = (playlistSongIds: string[], startSongId?: string) => {
    const queue = playlistSongIds.filter((songId) => songs.some((song) => song.id === songId));
    const fallbackSongId = queue[0];
    const targetSongId = startSongId && queue.includes(startSongId) ? startSongId : fallbackSongId;

    if (!targetSongId) {
      return;
    }

    setQueue(queue, targetSongId);
    void playSongById(targetSongId, false);
  };

  const openPlaylistQueue = (playlistSongIds: string[], startSongId?: string) => {
    const queue = playlistSongIds.filter((songId) => songs.some((song) => song.id === songId));
    const fallbackSongId = queue[0];
    const targetSongId = startSongId && queue.includes(startSongId) ? startSongId : fallbackSongId;

    if (!targetSongId) {
      return;
    }

    setQueue(queue, targetSongId);
    setNowPlayingTab('queue');
    navigate('/now-playing');
  };

  return (
    <div className="space-y-8 pb-8">
      <header className="space-y-1 border-b border-amply-border pb-3">
        <h1 className="text-2xl font-bold text-amply-textPrimary">Home</h1>
        <p className="text-[12px] uppercase tracking-[0.12em] text-amply-textMuted">Offline Music Player</p>
      </header>

      <section className="max-w-none space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-amply-textPrimary">Smart Playlists</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 xl:grid-cols-3">
          {smartPlaylistCards.map((item, index) => {
            const isFeatured = index === 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => playPlaylist(item.songIds, item.startSongId)}
                onDoubleClick={() => openPlaylistQueue(item.songIds, item.startSongId)}
                className={clsx(
                  'relative overflow-hidden rounded-card border border-amply-border p-4 text-left shadow-[0_12px_24px_rgba(0,0,0,0.25)] transition-all duration-200 ease-smooth hover:scale-[1.01] hover:border-[#3a3a3a]',
                  playlistToneClasses[index % playlistToneClasses.length],
                  isFeatured ? 'min-h-[200px] sm:col-span-2 xl:col-span-2' : 'min-h-[150px]',
                )}
                title="Click to play. Double-click to open queue."
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.10),transparent_50%)]" />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className={clsx('truncate font-bold text-amply-textPrimary', isFeatured ? 'text-[20px]' : 'text-[16px]')}>
                        {item.title}
                      </p>
                      <p className="truncate text-[12px] text-amply-textSecondary">{item.subtitle}</p>
                    </div>

                    <div
                      className={clsx(
                        'shrink-0 overflow-hidden rounded-lg border border-amply-border bg-amply-card/70',
                        isFeatured ? 'h-16 w-16' : 'h-12 w-12',
                      )}
                    >
                      {item.artwork ? <img src={item.artwork} alt={item.title} className="h-full w-full object-cover" /> : null}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowMoreMixes((value) => !value)}
            className={clsx(
              'relative min-h-[150px] overflow-hidden rounded-card border border-amply-border p-4 text-left transition-all duration-200 ease-smooth hover:scale-[1.01] hover:border-[#3a3a3a]',
              playlistToneClasses[0],
            )}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_55%)]" />
            <div className="relative flex h-full flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-full border border-amply-border bg-black/25 px-2 py-1 text-[11px] uppercase tracking-wide text-amply-textSecondary">
                  More Mixes
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-[16px] font-bold text-amply-textPrimary">Explore Mixes</p>
                <p className="text-[12px] text-amply-textSecondary">
                  {showMoreMixes ? 'Hide the full mix list' : 'Show genre and mood mixes'}
                </p>
              </div>
            </div>
          </button>
        </div>

        {showMoreMixes ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-amply-textSecondary">All Mixes</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {smartMixesAll.length ? (
                smartMixesAll.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => playPlaylist(item.songIds)}
                    onDoubleClick={() => openPlaylistQueue(item.songIds)}
                    className={clsx(
                      'relative overflow-hidden rounded-card border border-amply-border p-4 text-left transition-all duration-200 ease-smooth hover:scale-[1.01] hover:border-[#3a3a3a]',
                      playlistToneClasses[(index + 1) % playlistToneClasses.length],
                    )}
                    title="Click to play. Double-click to open queue."
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_55%)]" />
                    <div className="relative flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[16px] font-bold text-amply-textPrimary">{item.title}</p>
                        <p className="truncate text-[12px] text-amply-textSecondary">{item.subtitle}</p>
                      </div>
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-amply-border bg-amply-card/70">
                        {item.artwork ? <img src={item.artwork} alt={item.title} className="h-full w-full object-cover" /> : null}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-card border border-amply-border bg-amply-card p-4 text-[13px] text-amply-textMuted">
                  No mixes available yet. Add more music to expand smart mixes.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <SectionRow title="Recently Played" songs={recentlyPlayed} onPick={pickSong} />
      <SectionRow title="Rediscover" songs={rediscoverSongs} onPick={pickSong} />

      <section className="space-y-3">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Top Artists</h2>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {topArtists.map((entry) => (
            <AlbumCard
              key={entry.artistName}
              title={entry.topSong.title}
              subtitle={`${entry.artistName} - ${entry.songIds.length} songs`}
              artwork={entry.topSong.albumArt}
              onClick={() => playPlaylist(entry.songIds, entry.topSong.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

export default HomePage;
