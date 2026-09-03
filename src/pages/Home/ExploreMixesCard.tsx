import { Button, Card, Kicker, Meta } from '@/components/ui';
import type { Song } from '@/types/music';
import { ArtworkWell } from '@/pages/Home/ArtworkWell';

interface ExploreMixesCardProps {
  artworkSongs: Song[];
  expanded: boolean;
  onToggle: () => void;
}

/** Toggle card that reveals the full genre/mood mix list. */
export const ExploreMixesCard = ({ artworkSongs, expanded, onToggle }: ExploreMixesCardProps) => (
  <Card padding="lg" radius="lg" className="flex h-full min-h-[180px] items-center gap-5">
    <ArtworkWell artworks={artworkSongs.slice(0, 4).map((song) => song.albumArt)} alt="Explore mixes" className="w-28 shrink-0 sm:w-32" />
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="space-y-1">
        <Kicker>More mixes</Kicker>
        <p className="text-[18px] font-semibold text-amply-textPrimary">Explore Mixes</p>
        <Meta>{expanded ? 'Hide the full mix list' : 'Show genre and mood mixes'}</Meta>
      </div>
      <div>
        <Button
          variant="primary"
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          pressed={expanded}
          aria-controls="home-all-mixes"
          onClick={onToggle}
        >
          {expanded ? 'Hide mixes' : 'Show all mixes'}
        </Button>
      </div>
    </div>
  </Card>
);
