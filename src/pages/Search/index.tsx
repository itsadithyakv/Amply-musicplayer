import SongList from '@/components/SongList/SongList';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useLibraryStore } from '@/store/libraryStore';
import { useSearchRouteView, useStructuralSongsSnapshot } from '@/hooks/useLibraryViews';

const SearchPage = () => {
  const query = useLibraryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const searchView = useSearchRouteView();
  const librarySongs = useStructuralSongsSnapshot();
  const filteredSongs = searchView.songs;
  const suggestions = query.trim() ? searchView.suggestions : [];

  return (
    <div className="anim-stagger space-y-5 pb-8">
      <PageHeader title="Search" />

      <Card padding="md">
        <SearchInput value={query} onValueChange={setSearchQuery} placeholder="Search songs, artists, albums, playlists…" />

        {suggestions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <Chip key={suggestion} onClick={() => setSearchQuery(suggestion)}>
                {suggestion}
              </Chip>
            ))}
          </div>
        ) : null}
      </Card>

      {filteredSongs.length ? (
        <SongList songs={filteredSongs} persistKey="search" hideSort />
      ) : searchView.query.trim().length >= 2 ? (
        <Card padding="lg" className="text-[13px] text-amply-textSecondary">
          No results found. Try a different search term.
        </Card>
      ) : (
        <SongList songs={librarySongs} persistKey="search-browse" initialSort="recently_added" />
      )}
    </div>
  );
};

export default SearchPage;
