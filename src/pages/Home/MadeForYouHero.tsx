import { Button, Surface } from '@/components/ui';
import { CoverBackdrop } from '@/components/ui/CoverBackdrop';
import type { Song } from '@/types/music';

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
  onPlay: () => void;
}

export const MadeForYouHero = ({ mix, onPlay }: MadeForYouHeroProps) => {
  const cover = mix.backgroundArtwork ?? mix.coverSongs.find((song) => song.albumArt)?.albumArt;
  return (
    <Surface variant="raised" radius="lg" className="relative flex min-h-[300px] items-center overflow-hidden sm:min-h-[340px]">
      <CoverBackdrop src={cover} fade="right" />
      <div className="relative z-10 ml-auto flex w-[62%] min-w-0 flex-col gap-5 p-6 sm:p-8">
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amply-onCoverMuted">Made for you</p>
          <h3 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-amply-onCover sm:text-[32px]">{mix.title}</h3>
          <p className="text-[14px] font-semibold text-amply-onCoverMuted">{mix.genre}</p>
          <p className="text-[12px] leading-snug text-amply-onCoverMuted">{mix.subtitle}</p>
          <p className="text-[12px] text-amply-onCoverMuted">{mix.songIds.length} songs</p>
        </div>
        <div>
          <Button variant="primary" size="lg" icon="play" onClick={onPlay} title={mix.title}>
            Play mix
          </Button>
        </div>
      </div>
    </Surface>
  );
};
