import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

const loadedSrcs = new Set<string>();

interface OptimizedImageProps {
  src?: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderContent?: React.ReactNode;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  onLoad?: () => void;
  pulse?: boolean;
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
  pulse = true,
}) => {
  const normalizedSrc = typeof src === 'string' && src.trim().length > 0 ? src : undefined;
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    // Reset state when src changes
    if (!normalizedSrc) {
      setIsLoaded(false);
      setError(false);
      notifiedRef.current = false;
      return;
    }
    if (loadedSrcs.has(normalizedSrc)) {
      setIsLoaded(true);
      setError(false);
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        onLoad?.();
      }
      return;
    }
    setIsLoaded(false);
    setError(false);
    notifiedRef.current = false;
  }, [normalizedSrc, onLoad]);

  useEffect(() => {
    if (!normalizedSrc) {
      return;
    }
    let cancelled = false;
    const handle = window.requestAnimationFrame(() => {
      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        loadedSrcs.add(normalizedSrc);
        if (!cancelled) {
          setIsLoaded(true);
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onLoad?.();
          }
        }
      }
    });

    const decodeIfPossible = async () => {
      const img = imgRef.current;
      if (!img || typeof img.decode !== 'function') {
        return;
      }
      try {
        await img.decode();
        loadedSrcs.add(normalizedSrc);
        if (!cancelled) {
          setIsLoaded(true);
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onLoad?.();
          }
        }
      } catch {
        // ignore decode errors, onLoad/onError will handle
      }
    };

    void decodeIfPossible();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(handle);
    };
  }, [normalizedSrc, onLoad]);

  // If no src and placeholder content provided, show it
  if (!normalizedSrc && placeholderContent) {
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

  if ((!normalizedSrc || error) && !placeholderContent) {
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
            'absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950',
            pulse && 'animate-pulse',
            placeholderClassName,
          )}
          aria-hidden="true"
        />
      )}

      {/* Actual image */}
      {normalizedSrc && !error && (
        <img
          ref={imgRef}
          src={normalizedSrc}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className={clsx('h-full w-full object-cover', {
            'opacity-0': !isLoaded && !error,
            'opacity-100 transition-opacity': isLoaded,
          })}
          onLoad={() => {
            if (normalizedSrc) {
              loadedSrcs.add(normalizedSrc);
            }
            setIsLoaded(true);
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              onLoad?.();
            }
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
