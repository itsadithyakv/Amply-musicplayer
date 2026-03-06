import { useMemo } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { buildStats } from '@/services/statsService';
import { formatDuration } from '@/utils/time';

const StatsPage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const stats = useMemo(() => buildStats(songs), [songs]);

  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-amply-textPrimary">Statistics</h1>
        <p className="text-[13px] text-amply-textSecondary">Local listening trends from your offline playback history.</p>
      </header>

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Top Songs</p>
          <p className="mt-2 text-2xl font-bold text-amply-textPrimary">{stats.topSongs.length}</p>
        </div>
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Top Artists</p>
          <p className="mt-2 text-2xl font-bold text-amply-textPrimary">{stats.topArtists.length}</p>
        </div>
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Top Albums</p>
          <p className="mt-2 text-2xl font-bold text-amply-textPrimary">{stats.topAlbums.length}</p>
        </div>
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Listening Time</p>
          <p className="mt-2 text-2xl font-bold text-amply-textPrimary">{stats.totalListeningHours}h</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="mb-3 text-[13px] font-medium text-amply-textPrimary">Top Songs</p>
          <div className="space-y-2">
            {stats.topSongs.map((song) => (
              <div key={song.id} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-amply-textSecondary">{song.title}</span>
                <span className="text-amply-textMuted">{song.playCount} plays</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="mb-3 text-[13px] font-medium text-amply-textPrimary">Top Artists</p>
          <div className="space-y-2">
            {stats.topArtists.map((artist) => (
              <div key={artist.artist} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-amply-textSecondary">{artist.artist}</span>
                <span className="text-amply-textMuted">{artist.count} plays</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-amply-border bg-amply-card p-4">
          <p className="mb-3 text-[13px] font-medium text-amply-textPrimary">Most Played Albums</p>
          <div className="space-y-2">
            {stats.topAlbums.map((album) => (
              <div key={album.album} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-amply-textSecondary">{album.album}</span>
                <span className="text-amply-textMuted">{album.count} plays</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {stats.topSongs.length === 0 ? (
        <p className="text-[13px] text-amply-textMuted">No listening data yet. Start playback to populate stats.</p>
      ) : null}

      {stats.topSongs[0] ? (
        <p className="text-[12px] text-amply-textMuted">Most played track duration: {formatDuration(stats.topSongs[0].duration)}</p>
      ) : null}
    </div>
  );
};

export default StatsPage;
