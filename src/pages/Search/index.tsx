import { useMemo } from 'react';
import SongList from '@/components/SongList/SongList';
import { useLibraryStore } from '@/store/libraryStore';
import { splitArtistNames } from '@/utils/artists';

const SearchPage = () => {
  const query = useLibraryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const songs = useLibraryStore((state) => state.getFilteredSongs());

  const suggestions = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const pool = new Set<string>();

    for (const song of songs) {
      pool.add(song.title);
      for (const artistName of splitArtistNames(song.artist)) {
        pool.add(artistName);
      }
      pool.add(song.album);
      if (pool.size >= 8) {
        break;
      }
    }

    return [...pool];
  }, [query, songs]);

  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-amply-textPrimary">Search</h1>
        <p className="text-[13px] text-amply-textSecondary">Instant search across songs, artists, albums, genres, and playlists.</p>
      </header>

      <div className="rounded-card border border-amply-border bg-amply-card p-4">
        <input
          value={query}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search songs, artists, albums, playlists..."
          className="w-full rounded-lg border border-amply-border bg-amply-bgSecondary px-4 py-3 text-[13px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
        />

        {suggestions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setSearchQuery(suggestion)}
                className="rounded-full border border-amply-border px-3 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <SongList songs={songs} />
    </div>
  );
};

export default SearchPage;
