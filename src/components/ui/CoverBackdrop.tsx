import clsx from 'clsx';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';

export type CoverFade = 'bottom' | 'right' | 'left' | 'none';

interface CoverBackdropProps {
  src?: string;
  alt?: string;
  /** Which edge the card surface fades in from, so text placed there stays readable. */
  fade?: CoverFade;
  /** 0–1 strength of the surface scrim over the whole image (default 0.12). */
  tint?: number;
  className?: string;
}

const fadeStyle: Record<CoverFade, string> = {
  bottom: 'linear-gradient(to top, rgb(var(--amply-bg)) 0%, rgb(var(--amply-bg) / 0.92) 30%, rgb(var(--amply-bg) / 0.35) 60%, transparent 100%)',
  right: 'linear-gradient(to right, transparent 0%, rgb(var(--amply-bg) / 0.4) 38%, rgb(var(--amply-bg) / 0.94) 58%, rgb(var(--amply-bg)) 72%)',
  left: 'linear-gradient(to left, transparent 0%, rgb(var(--amply-bg) / 0.4) 38%, rgb(var(--amply-bg) / 0.94) 58%, rgb(var(--amply-bg)) 72%)',
  none: 'none',
};

/**
 * Full-bleed album cover behind a card, with the card's own surface colour fading in over the
 * side that carries text. Works in both themes because the scrim uses the surface token.
 */
export const CoverBackdrop = ({ src, alt = '', fade = 'bottom', tint = 0.12, className }: CoverBackdropProps) => (
  <div aria-hidden="true" className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)}>
    {src ? (
      <ArtworkImage src={src} alt={alt} className="h-full w-full scale-[1.02] object-cover" pulse={false} />
    ) : (
      <div className="h-full w-full bg-amply-bgDeep" />
    )}
    <div className="absolute inset-0" style={{ background: `rgb(var(--amply-bg) / ${tint})` }} />
    {fade !== 'none' ? <div className="absolute inset-0" style={{ background: fadeStyle[fade] }} /> : null}
  </div>
);
