import { useDeferredValue, useMemo } from 'react';
import SongList from '@/components/SongList/SongList';
import { useLibraryStore } from '@/store/libraryStore';
import { splitArtistNames } from '@/utils/artists';
import { filterAndRankSongs } from '@/utils/search';

const SearchPage = ({ embedded = false }: { embedded?: boolean }) => {
  const query = useLibraryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const songs = useLibraryStore((state) => state.songs);
  const deferredQuery = useDeferredValue(query);

  const filteredSongs = useMemo(() => {
    const trimmed = deferredQuery.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.length < 2) {
      return [];
    }
    return filterAndRankSongs(songs, trimmed, 10);
  }, [deferredQuery, songs]);

  const suggestions = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const pool = new Set<string>();

    for (const song of filteredSongs) {
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
  }, [deferredQuery, filteredSongs]);

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-5 pb-8'}>
      {!embedded ? (
        <header className="space-y-1">
          <h1 className="text-[30px] font-bold tracking-tight text-amply-textPrimary">Search</h1>
        </header>
      ) : null}

      <div className="rounded-card border border-amply-border bg-amply-card p-4">
        <div className="flex items-center gap-3 rounded-xl border border-amply-border/60 bg-amply-bgSecondary px-4 py-3">
          <div className="h-2 w-2 rounded-full bg-amply-accent" />
          <input
            value={query}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search songs, artists, albums, playlists..."
            className="w-full bg-transparent text-[13px] text-amply-textPrimary outline-none"
          />
        </div>

        {suggestions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setSearchQuery(suggestion)}
                className="rounded-full border border-amply-border/60 bg-amply-bgPrimary/40 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {filteredSongs.length ? (
        <SongList songs={filteredSongs} persistKey="search" hideSort />
      ) : deferredQuery.trim().length >= 2 ? (
        <div className="rounded-card border border-amply-border bg-amply-card p-6 text-[13px] text-amply-textMuted">
          No results found. Try a different search term.
        </div>
      ) : (
        <div className="rounded-card border border-amply-border bg-amply-card p-6 text-[13px] text-amply-textMuted">
          Start typing to search your library.
        </div>
      )}
    </div>
  );
};

export default SearchPage;
