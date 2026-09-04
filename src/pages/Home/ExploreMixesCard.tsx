import { Button, Surface } from '@/components/ui';
import { CoverBackdrop } from '@/components/ui/CoverBackdrop';
import type { Song } from '@/types/music';

interface ExploreMixesCardProps {
  artworkSongs: Song[];
  expanded: boolean;
  onToggle: () => void;
}

/** Toggle card that reveals the full genre/mood mix list. */
export const ExploreMixesCard = ({ artworkSongs, expanded, onToggle }: ExploreMixesCardProps) => (
  <Surface variant="raised" radius="lg" className="relative flex h-full min-h-[200px] items-center overflow-hidden">
    <CoverBackdrop src={artworkSongs.find((song) => song.albumArt)?.albumArt} fade="right" />
    <div className="relative z-10 ml-auto flex w-[62%] min-w-0 flex-col gap-4 p-6">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amply-onCoverMuted">More mixes</p>
        <p className="text-[20px] font-bold tracking-[-0.02em] text-amply-onCover">Explore Mixes</p>
        <p className="text-[12px] text-amply-onCoverMuted">{expanded ? 'Hide the full mix list' : 'Show genre and mood mixes'}</p>
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
  </Surface>
);
