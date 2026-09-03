import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { SectionTitle } from '@/components/ui';
import type { Song } from '@/types/music';

interface SectionRowProps {
  title: string;
  songs: Song[];
  onPick: (song: Song) => void;
  scrollable?: boolean;
}

export const SectionRow = ({ title, songs, onPick, scrollable = false }: SectionRowProps) => {
  if (!songs.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <SectionTitle>{title}</SectionTitle>
      {scrollable ? (
        <div className="flex gap-3 overflow-x-auto px-1.5 py-1.5 pr-3">
          {songs.map((song) => (
            <div key={`${title}-${song.id}`} className="min-w-[200px] max-w-[220px] flex-1">
              <AlbumCard title={song.title} subtitle={song.artist} artwork={song.albumArt} onClick={() => onPick(song)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {songs.map((song) => (
            <div key={`${title}-${song.id}`}>
              <AlbumCard title={song.title} subtitle={song.artist} artwork={song.albumArt} onClick={() => onPick(song)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
