import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import {
  loadArtistProfile,
  type ArtistProfile,
  type ArtistProfileLoadResult,
} from '@/services/artistProfileService';
import { loadSongGenre, type SongGenreLoadResult } from '@/services/songMetadataService';
import { formatDuration } from '@/utils/time';

const isUnknownGenre = (value: string | undefined): boolean => {
  if (!value?.trim()) {
    return true;
  }

  return value.trim().toLowerCase() === 'unknown genre';
};

const NowPlayingPanel = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const songs = useLibraryStore((state) => state.songs);
  const updateSongGenre = useLibraryStore((state) => state.updateSongGenre);

  const song = currentSongId ? songs.find((entry) => entry.id === currentSongId) : undefined;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistStatus, setArtistStatus] = useState<ArtistProfileLoadResult['status']>('missing');
  const [artistCachePath, setArtistCachePath] = useState<string | null>(null);
  const [artistFromCache, setArtistFromCache] = useState(false);
  const [resolvedGenre, setResolvedGenre] = useState<string>('Unknown Genre');
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreStatus, setGenreStatus] = useState<SongGenreLoadResult['status']>('missing');
  const [genreFromCache, setGenreFromCache] = useState(false);
  const [genreCachePath, setGenreCachePath] = useState<string | null>(null);

  useEffect(() => {
    if (!song) {
      setResolvedGenre('Unknown Genre');
      setGenreLoading(false);
      setGenreStatus('missing');
      setGenreFromCache(false);
      setGenreCachePath(null);
      return;
    }

    const currentGenre = song.genre?.trim() || 'Unknown Genre';
    setResolvedGenre(currentGenre);
    setGenreStatus(isUnknownGenre(currentGenre) ? 'missing' : 'ready');
    setGenreFromCache(!isUnknownGenre(currentGenre));
    setGenreCachePath(null);

    if (!isUnknownGenre(currentGenre)) {
      setGenreLoading(false);
      return;
    }

    let alive = true;
    setGenreLoading(true);

    loadSongGenre(song)
      .then((result) => {
        if (!alive) {
          return;
        }

        setGenreStatus(result.status);
        setGenreCachePath(result.cachePath);

        if (result.status === 'ready') {
          setResolvedGenre(result.genre);
          setGenreFromCache(result.fromCache);
          if (isUnknownGenre(song.genre)) {
            void updateSongGenre(song.id, result.genre);
          }
        } else {
          setGenreFromCache(false);
        }
      })
      .finally(() => {
        if (alive) {
          setGenreLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [song?.id, song?.genre, song?.artist, song?.title, updateSongGenre]);

  useEffect(() => {
    if (!song?.artist) {
      setArtistProfile(null);
      setArtistLoading(false);
      setArtistStatus('missing');
      setArtistCachePath(null);
      setArtistFromCache(false);
      return;
    }

    let alive = true;
    setArtistLoading(true);
    setArtistStatus('missing');
    setArtistProfile(null);
    setArtistCachePath(null);
    setArtistFromCache(false);

    loadArtistProfile(song.artist)
      .then((result) => {
        if (!alive) {
          return;
        }

        setArtistStatus(result.status);
        setArtistCachePath(result.cachePath);

        if (result.status === 'ready') {
          setArtistProfile(result.profile);
          setArtistFromCache(result.fromCache);
        }
      })
      .finally(() => {
        if (alive) {
          setArtistLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [song?.artist]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-amply-border bg-amply-bgPrimary p-4">
      <p className="px-1 text-[13px] font-medium text-amply-textSecondary">Now Playing</p>

      {!song ? (
        <div className="mt-4 flex-1 rounded-card border border-amply-border bg-amply-card p-4">
          <p className="text-[13px] text-amply-textMuted">Select a song to view track and artist details.</p>
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pb-24 pr-1">
          <div className="rounded-card border border-amply-border bg-amply-card p-4">
            <div className="h-[260px] w-full overflow-hidden rounded-lg bg-zinc-800">
              {song.albumArt ? <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="mt-3 space-y-1">
              <p className="text-[18px] font-bold text-amply-textPrimary">{song.title}</p>
              <p className="text-[14px] font-medium text-amply-textSecondary">{song.artist}</p>
              <p className="text-[12px] text-amply-textMuted">{song.album}</p>
              <p className="text-[12px] text-amply-textMuted">
                {resolvedGenre} - {formatDuration(song.duration)}
              </p>
              {genreLoading ? <p className="text-[11px] text-amply-textMuted">Fetching genre...</p> : null}
              {!genreLoading && genreStatus === 'ready' && isUnknownGenre(song.genre) ? (
                <p className="text-[11px] text-amply-textMuted">
                  {genreFromCache ? 'Genre loaded from cache' : 'Genre saved to cache'}
                  {genreCachePath ? ` - ${genreCachePath}` : ''}
                </p>
              ) : null}
              {!genreLoading && genreStatus === 'no-internet' ? (
                <p className="text-[11px] text-amply-textMuted">No internet connection to fetch genre.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-card border border-amply-border bg-amply-card p-4">
            <p className="text-[13px] font-medium text-amply-textPrimary">About the Artist</p>

            {artistLoading ? (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-amply-textSecondary">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-amply-border border-t-amply-accent" />
                <span>Loading artist info...</span>
              </div>
            ) : null}

            {!artistLoading && artistStatus === 'ready' && artistProfile ? (
              <div className="mt-3 space-y-3">
                {artistProfile.imageUrl ? (
                  <div className="h-[160px] w-full overflow-hidden rounded-lg bg-zinc-800">
                    <img src={artistProfile.imageUrl} alt={artistProfile.artistName} className="h-full w-full object-cover" />
                  </div>
                ) : null}
                <div className="max-h-44 overflow-y-auto pr-1">
                  <p className="text-[12px] leading-relaxed text-amply-textSecondary">{artistProfile.summary}</p>
                </div>
                <p className="text-[11px] text-amply-textMuted">
                  {artistFromCache ? 'Loaded from cache' : 'Saved to cache'}
                  {isOffline ? ' (No internet)' : ''}
                  {artistCachePath ? ` - ${artistCachePath}` : ''}
                </p>
                {artistProfile.sourceUrl ? (
                  <a
                    href={artistProfile.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-amply-accent transition-colors hover:text-amply-accentHover"
                  >
                    Source
                  </a>
                ) : null}
              </div>
            ) : null}

            {!artistLoading && artistStatus === 'no-internet' ? (
              <p className="mt-3 text-[12px] text-amply-textMuted">No internet connection to load artist details.</p>
            ) : null}

            {!artistLoading && artistStatus === 'missing' ? (
              <p className="mt-3 text-[12px] text-amply-textMuted">Artist details not available for this track.</p>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
};

export default NowPlayingPanel;
