import clsx from 'clsx';
import { memo, type CSSProperties } from 'react';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { artworkThumb } from '@/utils/artwork';

interface PlaylistArtworkCollageProps {
  /** Up to four artwork URLs. A set where every entry is the same image renders as a single tile. */
  artworkSet: string[];
  /** Outer radius: `sm` for compact cards, `md` for the detail hero. */
  radius?: 'sm' | 'md';
  /** Pad the tiles inside the well and round each one (hero style). */
  padded?: boolean;
  /**
   * Request on-demand thumbnails for `amplyart` artwork instead of the full image. Pass `128`
   * when the whole well renders at 128px or less (card grids, the composer preview).
   */
  thumbSize?: 64 | 128;
  className?: string;
  style?: CSSProperties;
}

/**
 * Square artwork well used by playlist cards, the detail hero and the composer preview.
 * Renders a 2×2 collage, a single cover, or an "Amply" placeholder inside a `neu-well`.
 */
export const PlaylistArtworkCollage = memo(({ artworkSet, radius = 'sm', padded = false, thumbSize, className, style }: PlaylistArtworkCollageProps) => {
  const tiles = artworkSet.slice(0, 4).map((art) => (thumbSize ? artworkThumb(art, thumbSize) ?? art : art));
  const single = tiles.length > 0 && tiles.every((art) => art === tiles[0]);

  return (
    <div
      aria-hidden="true"
      style={style}
      className={clsx(
        'neu-well relative aspect-square shrink-0 overflow-hidden',
        radius === 'md' ? 'rounded-md' : 'rounded-sm',
        className,
      )}
    >
      {single ? (
        <div className={clsx('h-full w-full overflow-hidden', padded && 'rounded-sm p-2')}>
          <ArtworkImage src={tiles[0]} alt="" className={clsx('h-full w-full object-cover', padded && 'rounded-sm')} pulse={false} />
        </div>
      ) : tiles.length ? (
        <div className={clsx('grid h-full w-full grid-cols-2 grid-rows-2', padded ? 'gap-1.5 p-2' : 'gap-0.5')}>
          {tiles.map((art, index) => (
            <div key={`art-${index}`} className={clsx('overflow-hidden', padded && 'rounded-sm')}>
              <ArtworkImage src={art} alt="" className="h-full w-full object-cover" pulse={false} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold uppercase tracking-[0.2em] text-amply-textMuted">
          Amply
        </div>
      )}
    </div>
  );
});
PlaylistArtworkCollage.displayName = 'PlaylistArtworkCollage';
