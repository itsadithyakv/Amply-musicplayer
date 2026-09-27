import { Button, Surface } from '@/components/ui';
import { CoverBackdrop } from '@/components/ui/CoverBackdrop';
import type { Song } from '@/types/music';
import { useT } from '@/i18n';

export type MadeForYouMixCard = {
  id: string;
  /** The two lead artists; the card's title is built from them in the current language. */
  artists: [string, string];
  subtitle: string;
  /** Genre the mix is drawn from; null for an artist-pair mix. */
  genre: string | null;
  songIds: string[];
  coverSongs: Song[];
  backgroundArtwork?: string;
};

interface MadeForYouHeroProps {
  mix: MadeForYouMixCard;
  onPlay: () => void;
}

export const MadeForYouHero = ({ mix, onPlay }: MadeForYouHeroProps) => {
  const { t, tp } = useT();
  const title = t('library.home.pairMix', { first: mix.artists[0], second: mix.artists[1] });
  const cover = mix.backgroundArtwork ?? mix.coverSongs.find((song) => song.albumArt)?.albumArt;
  return (
    <Surface variant="raised" radius="lg" className="relative flex min-h-[300px] items-center overflow-hidden sm:min-h-[340px]">
      <CoverBackdrop src={cover} fade="right" />
      <div className="relative z-10 ml-auto flex w-[62%] min-w-0 flex-col gap-5 p-6 sm:p-8">
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amply-onCoverMuted">{t('library.home.madeForYou')}</p>
          <h3 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-amply-onCover sm:text-[32px]">{title}</h3>
          <p className="text-[14px] font-semibold text-amply-onCoverMuted">{mix.genre ?? t('library.home.madeForYou')}</p>
          <p className="text-[12px] leading-snug text-amply-onCoverMuted">{mix.subtitle}</p>
          <p className="text-[12px] text-amply-onCoverMuted">{tp('library.songCount', mix.songIds.length)}</p>
        </div>
        <div>
          <Button variant="primary" size="lg" icon="play" onClick={onPlay} title={title}>
            {t('library.home.playMix')}
          </Button>
        </div>
      </div>
    </Surface>
  );
};
