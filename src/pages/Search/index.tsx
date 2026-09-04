import AlbumCard from '@/components/AlbumCard/AlbumCard';
import SongList from '@/components/SongList/SongList';
import { Badge, SectionTitle } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useLibraryStore } from '@/store/libraryStore';
import { useSearchRouteView, useStructuralSongsSnapshot } from '@/hooks/useLibraryViews';
import { useSearchRecommendations } from '@/hooks/useSearchRecommendations';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';

const SearchPage = () => {
  const query = useLibraryStore((state) => state.searchQuery);
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const searchView = useSearchRouteView();
  const librarySongs = useStructuralSongsSnapshot();
  const filteredSongs = searchView.songs;
  const suggestions = query.trim() ? searchView.suggestions : [];
  const recommendations = useSearchRecommendations(librarySongs, searchView.query, filteredSongs);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);

  const playRecommendation = (song: Song) => {
    if (!recommendations) {
      return;
    }
    setQueue(recommendations.items.map((item) => item.song.id), song.id);
    void playSongById(song.id, false);
  };

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

      {recommendations ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SectionTitle description={recommendations.caption}>{recommendations.title}</SectionTitle>
            {recommendations.usedOnlineSignals ? <Badge tone="success">Online signals</Badge> : null}
          </div>
          <div className="flex gap-3 overflow-x-auto px-1.5 py-1.5 pr-3">
            {recommendations.items.map((item) => (
              <div key={item.song.id} className="min-w-[200px] max-w-[220px] flex-1">
                <AlbumCard
                  title={item.song.title}
                  subtitle={item.song.artist}
                  artwork={item.song.albumArt}
                  meta={item.reason}
                  onClick={() => playRecommendation(item.song)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
