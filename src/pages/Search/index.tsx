import SongList from '@/components/SongList/SongList';
import { PageHeader, SoftPanel, UnifiedSearchInput } from '@/components/ui/AmplyUI';
import { useLibraryStore } from '@/store/libraryStore';
import { useSearchRouteView } from '@/hooks/useLibraryViews';

const SearchPage = () => {
  const query = useLibraryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const searchView = useSearchRouteView();
  const filteredSongs = searchView.songs;
  const suggestions = query.trim() ? searchView.suggestions : [];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Search" />

      <SoftPanel className="p-4">
        <UnifiedSearchInput
          value={query}
          onValueChange={setSearchQuery}
          placeholder="Search songs, artists, albums, playlists..."
        />

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
      </SoftPanel>

      {filteredSongs.length ? (
        <SongList songs={filteredSongs} persistKey="search" hideSort />
      ) : searchView.query.trim().length >= 2 ? (
        <SoftPanel className="p-6 text-[13px] text-amply-textMuted">
          No results found. Try a different search term.
        </SoftPanel>
      ) : (
        <SoftPanel className="p-6 text-[13px] text-amply-textMuted">
          Start typing to search your library.
        </SoftPanel>
      )}
    </div>
  );
};

export default SearchPage;
