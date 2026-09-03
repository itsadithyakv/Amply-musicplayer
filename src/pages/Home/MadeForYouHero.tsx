import { Button, Card, Kicker, Meta } from '@/components/ui';
import type { Song } from '@/types/music';
import { ArtworkWell } from '@/pages/Home/ArtworkWell';
import { ToneDot } from '@/pages/Home/SmartPlaylistCard';

export type MadeForYouMixCard = {
  id: string;
  title: string;
  subtitle: string;
  genre: string;
  songIds: string[];
  coverSongs: Song[];
  backgroundArtwork?: string;
};

interface MadeForYouHeroProps {
  mix: MadeForYouMixCard;
  toneIndex?: number;
  onPlay: () => void;
}

export const MadeForYouHero = ({ mix, toneIndex, onPlay }: MadeForYouHeroProps) => (
  <Card padding="lg" radius="lg" className="flex min-h-[320px] flex-col gap-6 sm:min-h-[360px] sm:flex-row sm:items-center">
    <ArtworkWell
      artworks={mix.coverSongs.map((song) => song.albumArt)}
      alt={mix.title}
      className="w-full shrink-0 rounded-md sm:w-56 lg:w-64"
    />
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {toneIndex !== undefined ? <ToneDot index={toneIndex} /> : null}
          <Kicker>Made for you</Kicker>
        </div>
        <h3 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-amply-textPrimary sm:text-[32px]">{mix.title}</h3>
        <p className="text-[14px] font-semibold text-amply-textSecondary">{mix.genre}</p>
        <Meta>{mix.subtitle}</Meta>
        <Meta className="text-amply-textMuted">{mix.songIds.length} songs</Meta>
      </div>
      <div>
        <Button variant="primary" size="lg" icon="play" onClick={onPlay} title={mix.title}>
          Play mix
        </Button>
      </div>
    </div>
  </Card>
);
