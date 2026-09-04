import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { Meta, SectionTitle } from '@/components/ui';
import type { Song } from '@/types/music';

export interface TopArtistEntry {
  artistName: string;
  topSong: Song;
  songIds: string[];
}

interface TopArtistsRowProps {
  artists: TopArtistEntry[];
  images: Record<string, string | undefined>;
  onPick: (entry: TopArtistEntry) => void;
}

export const TopArtistsRow = ({ artists, images, onPick }: TopArtistsRowProps) => {
  if (!artists.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <SectionTitle>Top Artists</SectionTitle>
      <div className="flex gap-3 overflow-x-auto px-1 pb-3 pt-1">
        {artists.map((entry) => {
          const initial = entry.artistName.trim().charAt(0).toUpperCase();
          return (
            <button
              key={entry.artistName}
              type="button"
              onClick={() => onPick(entry)}
              title={`Play ${entry.artistName}`}
              className="group flex w-[132px] shrink-0 flex-col items-center gap-2 rounded-md p-2 text-center"
            >
              <span className="neu-raised-sm neu-interactive block h-24 w-24 rounded-full p-1 transition-transform duration-150 ease-smooth group-hover:-translate-y-px">
                <span className="neu-well block h-full w-full overflow-hidden rounded-full">
                  <ArtworkImage
                    src={images[entry.artistName] ?? entry.topSong.albumArt}
                    alt=""
                    className="h-full w-full object-cover"
                    placeholderContent={
                      <span className="flex h-full w-full items-center justify-center text-[18px] font-semibold text-amply-textMuted">{initial}</span>
                    }
                  />
                </span>
              </span>
              <span className="w-full truncate text-[14px] font-semibold text-amply-textPrimary">{entry.artistName}</span>
              <Meta className="w-full truncate">{entry.songIds.length} songs</Meta>
            </button>
          );
        })}
      </div>
    </section>
  );
};
