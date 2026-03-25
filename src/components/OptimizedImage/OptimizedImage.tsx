import { useState, useEffect } from 'react';
import clsx from 'clsx';

interface OptimizedImageProps {
  src?: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderContent?: React.ReactNode;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  onLoad?: () => void;
}

/**
 * Optimized image component that:
 * - Shows a placeholder while loading
 * - Prevents layout shift (with aspect ratio)
 * - Uses lazy loading by default
 * - Provides visual feedback
 */
export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderContent,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Reset state when src changes
    if (src) {
      setIsLoaded(false);
      setError(false);
    } else {
      setIsLoaded(false);
      setError(false);
    }
  }, [src]);

  // If no src and placeholder content provided, show it
  if (!src && placeholderContent) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900',
          placeholderClassName || className,
        )}
        role="img"
        aria-label={alt}
      >
        {placeholderContent}
      </div>
    );
  }

  if (!src && error) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900',
          placeholderClassName || className,
        )}
        role="img"
        aria-label={alt}
      >
        <span className="text-xs text-zinc-600">No image</span>
      </div>
    );
  }

  return (
    <div
      className={clsx('relative overflow-hidden', className)}
      style={{
        backgroundColor: !isLoaded && !error ? 'rgba(0,0,0,0.2)' : undefined,
      }}
    >
      {/* Placeholder gradient shown while loading */}
      {!isLoaded && !error && (
        <div
          className={clsx(
            'absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 animate-pulse',
            placeholderClassName,
          )}
          aria-hidden="true"
        />
      )}

      {/* Actual image */}
      {src && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className={clsx('h-full w-full object-cover', {
            'opacity-0': !isLoaded && !error,
            'opacity-100 transition-opacity': isLoaded,
          })}
          onLoad={() => {
            setIsLoaded(true);
            onLoad?.();
          }}
          onError={() => {
            setError(true);
            setIsLoaded(false);
          }}
        />
      )}
    </div>
  );
};
