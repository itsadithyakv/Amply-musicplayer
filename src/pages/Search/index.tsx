import SongList from '@/components/SongList/SongList';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
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
      ) : (
        <Card padding="lg" className="text-[13px] text-amply-textSecondary">
          {searchView.query.trim().length >= 2 ? 'No results found. Try a different search term.' : 'Start typing to search your library.'}
        </Card>
      )}
    </div>
  );
};

export default SearchPage;
