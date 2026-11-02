import { memo, useState } from 'react';
import { OptimizedImage } from '@/components/OptimizedImage/OptimizedImage';
import { useArtworkReady } from '@/hooks/useArtworkReady';

interface ArtworkImageProps {
  src?: string;
  /** Shown when `src` fails to load, e.g. a web photo while offline; usually local album art. */
  fallbackSrc?: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderContent?: React.ReactNode;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  onLoad?: () => void;
  forceReady?: boolean;
  pulse?: boolean;
}

export const ArtworkImage: React.FC<ArtworkImageProps> = memo(({
  src,
  fallbackSrc,
  alt,
  className,
  placeholderClassName,
  placeholderContent,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  forceReady = false,
  pulse = false,
}) => {
  const sharedArtworkReady = useArtworkReady();
  const artworkReady = forceReady || sharedArtworkReady;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const preferred = src && src !== failedSrc ? src : fallbackSrc;
  const resolvedSrc = artworkReady ? preferred : undefined;
  const resolvedPlaceholder = artworkReady
    ? placeholderContent
    : placeholderContent ?? <div className="h-full w-full" aria-hidden="true" />;

  return (
    <OptimizedImage
      src={resolvedSrc}
      alt={alt}
      className={className}
      placeholderClassName={placeholderClassName}
      placeholderContent={resolvedPlaceholder}
      loading={loading}
      decoding={decoding}
      onLoad={onLoad}
      onError={() => {
        if (src && resolvedSrc === src && fallbackSrc && fallbackSrc !== src) {
          setFailedSrc(src);
        }
      }}
      pulse={pulse}
    />
  );
});
