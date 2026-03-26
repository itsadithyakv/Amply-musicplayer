import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Song } from '@/types/music';
import {
  readCachedLyrics,
  loadLyrics,
  saveLyricsSelection,
  type LyricsCandidate,
  type LyricsResult,
} from '@/services/lyricsFetcher';
import { formatDuration } from '@/utils/time';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { readStorageJson, writeStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { useIdleRender } from '@/hooks/useIdleRender';

interface LyricsViewerProps {
  song: Song | null;
  active: boolean;
  fullHeight?: boolean;
}

const buildChoiceSubtitle = (candidate: LyricsCandidate): string => {
  const parts = [candidate.artistName];

  if (candidate.albumName) {
    parts.push(candidate.albumName);
  }

  if (candidate.durationSec) {
    parts.push(formatDuration(candidate.durationSec));
  }

  return parts.join(' - ');
};

const buildChoicePreview = (candidate: LyricsCandidate): string => {
  const firstLine = candidate.preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return 'No preview available';
  }

  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine;
};

const LyricsViewer = ({ song, active, fullHeight = false }: LyricsViewerProps) => {
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const lyricsVisualsEnabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const lyricsVisualTheme = usePlayerStore((state) => state.settings.lyricsVisualTheme);
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const fetchLyricsCandidatesForSong = useLibraryStore((state) => state.fetchLyricsCandidatesForSong);
  const idleReady = useIdleRender(300);
  const [artworkTint, setArtworkTint] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [choices, setChoices] = useState<LyricsCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingChoiceId, setSavingChoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [offsetMs, setOffsetMs] = useState(0);

  // Use refs to avoid triggering re-renders
  const offsetRef = useRef(0);
  const offsetsCacheRef = useRef<Record<string, number>>({});
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const autoScrollLockRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<number | null>(null);
  const lyricsAbortRef = useRef<AbortController | null>(null);
  const backdropAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (gameMode) {
      setLoading(false);
      setSavingChoiceId(null);
      setError('Lyrics disabled in Game Mode.');
      setLyrics(null);
      setChoices([]);
      return;
    }

    if (!song || !active) {
      return;
    }

    // Cancel any previous request
    if (lyricsAbortRef.current) {
      lyricsAbortRef.current.abort();
    }

    const abortController = new AbortController();
    lyricsAbortRef.current = abortController;

    let alive = true;
    let retryHandle: number | null = null;
    setLoading(true);
    setSavingChoiceId(null);
    setError(null);
    setLyrics(null);
    setChoices([]);

    setAutoScroll(true);

    const load = async () => {
      try {
        const cached = await readCachedLyrics(song);
        if (abortController.signal.aborted || !alive) {
          return;
        }

        if (cached.status === 'ready') {
          setLyrics(cached.lyrics);
          return;
        }

        // No cache yet: attempt a live fetch once.
        const fetched = await loadLyrics(song);
        if (abortController.signal.aborted || !alive) {
          return;
        }

        if (fetched.status === 'ready') {
          setLyrics(fetched.lyrics);
          setError(null);
          return;
        }

        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setError(offline ? 'Lyrics unavailable (offline).' : 'No lyrics found for this track yet.');

        retryHandle = window.setTimeout(() => {
          if (abortController.signal.aborted || !alive) {
            return;
          }
          readCachedLyrics(song)
            .then((retryResult) => {
              if (abortController.signal.aborted || !alive) {
                return;
              }
              if (retryResult.status === 'ready') {
                setLyrics(retryResult.lyrics);
                setError(null);
              }
            })
            .catch((error) => {
              if (!abortController.signal.aborted && alive) {
                console.warn('[Lyrics] Retry failed:', error);
              }
            });
        }, 4000);
      } catch (error) {
        if (!abortController.signal.aborted && alive) {
          console.warn('[Lyrics] Initial load failed:', error);
          setError('Failed to load lyrics.');
        }
      } finally {
        if (!abortController.signal.aborted && alive) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      alive = false;
      abortController.abort();
      if (retryHandle !== null) {
        window.clearTimeout(retryHandle);
      }
    };
  }, [active, song?.id, gameMode]);

  useEffect(() => {
    if (!song?.id) {
      setOffsetMs(0);
      return;
    }

    let alive = true;
    const key = 'lyrics_offsets.json';
    const loadOffset = async () => {
      const cache = await readStorageJson<Record<string, number>>(key, {});
      if (!alive) {
        return;
      }
      offsetsCacheRef.current = cache;
      const saved = cache[song.id];
      if (typeof saved === 'number' && Number.isFinite(saved)) {
        setOffsetMs(saved);
      } else {
        setOffsetMs(0);
      }
    };
    void loadOffset();
    return () => {
      alive = false;
    };
  }, [song?.id]);

  useEffect(() => {
    offsetRef.current = offsetMs;
  }, [offsetMs]);

  const handleOffsetChange = async (deltaMs: number) => {
    if (!song?.id) {
      return;
    }
    const next = Math.max(-8000, Math.min(8000, offsetRef.current + deltaMs));
    setOffsetMs(next);
    offsetsCacheRef.current = {
      ...offsetsCacheRef.current,
      [song.id]: next,
    };
    await writeStorageJsonDebounced('lyrics_offsets.json', offsetsCacheRef.current, 600);
  };

  const handleManualChoose = async () => {
    if (!song || loading) {
      return;
    }
    setSavingChoiceId(null);
    setError(null);
    setLoading(true);
    try {
      const candidates = await fetchLyricsCandidatesForSong(song.id);
      if (!candidates.length) {
        setError('No alternate lyrics found.');
        return;
      }
      setChoices(candidates);
    } catch {
      setError('Lyrics fetch failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!song) {
      return;
    }
    const handleOffset = (event: Event) => {
      const detail = (event as CustomEvent<{ deltaMs?: number }>).detail;
      if (!detail || typeof detail.deltaMs !== 'number') {
        return;
      }
      void handleOffsetChange(detail.deltaMs);
    };
    const handleChoose = () => {
      void handleManualChoose();
    };
    window.addEventListener('amply://lyrics-offset', handleOffset as EventListener);
    window.addEventListener('amply://lyrics-choose', handleChoose);
    return () => {
      window.removeEventListener('amply://lyrics-offset', handleOffset as EventListener);
      window.removeEventListener('amply://lyrics-choose', handleChoose);
    };
  }, [song?.id, loading]);

  useEffect(() => {
    if (gameMode) {
      setArtworkTint(null);
      return;
    }

    if (!song?.id) {
      setArtworkTint(null);
      return;
    }

    // Cancel any previous backdrop loading
    if (backdropAbortRef.current) {
      backdropAbortRef.current.abort();
    }

    const abortController = new AbortController();
    backdropAbortRef.current = abortController;

    let alive = true;
    const cachePath = 'lyrics_bg_cache.json';

    const loadBackdrop = async () => {
      try {
        const cache = await readStorageJson<Record<string, string | null>>(cachePath, {});
        const cached = cache[song.id];
        const cachedIsColor = typeof cached === 'string' && (cached.startsWith('rgb(') || cached.startsWith('#'));
        if (alive && !abortController.signal.aborted && cached && cachedIsColor) {
          setArtworkTint(cached);
          return;
        }

        const source = song.albumArt ?? null;
        if (!source) {
          if (alive && !abortController.signal.aborted) {
            setArtworkTint(null);
          }
          return;
        }

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = source;

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Image load timeout')), 5000);
          image.onload = () => {
            clearTimeout(timeout);
            resolve();
          };
          image.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Image load failed'));
          };
        });

        if (abortController.signal.aborted || !alive) {
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas unavailable');
        }

        ctx.drawImage(image, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const tint = `rgb(${r}, ${g}, ${b})`;

        if (alive && !abortController.signal.aborted) {
          setArtworkTint(tint);
        }

        await writeStorageJson(cachePath, {
          ...cache,
          [song.id]: tint,
        });
      } catch (error) {
        if (alive && !abortController.signal.aborted) {
          console.warn('[Lyrics] Backdrop loading failed:', error);
          setArtworkTint(null);
        }
      }
    };

    void loadBackdrop();

    return () => {
      alive = false;
      abortController.abort();
    };
  }, [song?.id, song?.albumArt, gameMode]);

  const lines = useMemo(() => (Array.isArray(lyrics?.lines) ? lyrics!.lines : []), [lyrics]);

  useEffect(() => {
    lineRefs.current = [];
  }, [lyrics?.raw]);

  useEffect(() => {
    if (lyrics?.raw) {
      setAutoScroll(true);
    }
  }, [lyrics?.raw]);

  const timedIndex = useMemo(() => {
    if (!lyrics?.isSynced || !lines.length) {
      return [];
    }

    return lines
      .map((line, index) => (line.timeMs === null ? null : { timeMs: line.timeMs, index }))
      .filter((entry): entry is { timeMs: number; index: number } => Boolean(entry));
  }, [lyrics?.isSynced, lines]);

  const currentIndex = useMemo(() => {
    if (!lyrics?.isSynced || timedIndex.length === 0) {
      return -1;
    }

    const target = positionSec * 1000 + offsetMs;
    let left = 0;
    let right = timedIndex.length - 1;
    let best = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const stamp = timedIndex[mid].timeMs;
      if (stamp <= target) {
        best = timedIndex[mid].index;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return best;
  }, [lyrics?.isSynced, timedIndex, positionSec]);

  const visualsStyle = useMemo(() => {
    const lowPerf =
      typeof window !== 'undefined' &&
      (window as unknown as { __AMP_LOW_PERF__?: boolean }).__AMP_LOW_PERF__ === true;
    if (!lyricsVisualsEnabled || lowPerf) {
      return artworkTint ? ({ '--lyrics-bg-color': artworkTint } as CSSProperties) : undefined;
    }

    const progress = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;
    const pulse = Math.sin(positionSec * 1.25) * 0.5 + 0.5;

    return {
      '--lyric-progress': String(progress),
      '--lyric-pulse': String(pulse),
      ...(artworkTint ? { '--lyrics-bg-color': artworkTint } : {}),
    } as CSSProperties;
  }, [lyricsVisualsEnabled, positionSec, durationSec, artworkTint]);

  useEffect(() => {
    if (currentIndex < 0 || !lyrics?.isSynced || !autoScroll) {
      return;
    }

    const container = lyricsContainerRef.current;
    const node = lineRefs.current[currentIndex];
    if (!container || !node) {
      return;
    }

    const targetTop = Math.max(0, node.offsetTop - container.clientHeight * 0.35);
    if (programmaticScrollRef.current !== null) {
      window.clearTimeout(programmaticScrollRef.current);
    }
    programmaticScrollRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = null;
    }, 350);
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, [currentIndex, lyrics?.isSynced, autoScroll]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (lyricsAbortRef.current) {
        lyricsAbortRef.current.abort();
      }
      if (backdropAbortRef.current) {
        backdropAbortRef.current.abort();
      }
      if (autoScrollLockRef.current) {
        window.clearTimeout(autoScrollLockRef.current);
      }
      if (programmaticScrollRef.current !== null) {
        window.clearTimeout(programmaticScrollRef.current);
      }
    };
  }, []);

  if (!song) {
    return <p className="text-[13px] text-amply-textMuted">No song selected.</p>;
  }

  if (active && !idleReady) {
    return (
      <div className={clsx('rounded-card border border-amply-border bg-amply-card p-4', fullHeight && 'h-full')}>
        <p className="text-[12px] text-amply-textMuted">Preparing lyrics...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={clsx(
          'flex items-center gap-3 rounded-card border border-amply-border bg-amply-card p-4 text-[13px] text-amply-textSecondary',
          fullHeight && 'h-full',
        )}
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-amply-border border-t-amply-accent" />
        <span>Loading lyrics...</span>
      </div>
    );
  }

  if (choices.length) {
    return (
      <div className={clsx('space-y-3 rounded-card border border-amply-border bg-amply-card p-4', fullHeight && 'h-full overflow-y-auto')}>
        <div className="space-y-1">
          <p className="text-[14px] font-medium text-amply-textPrimary">Multiple lyric matches found</p>
          <p className="text-[12px] text-amply-textSecondary">Pick the correct one. Your selection will be cached for offline playback.</p>
        </div>

        <div className="space-y-2">
          {choices.map((candidate) => {
            const isSaving = savingChoiceId === candidate.id;
            return (
              <button
                key={candidate.id}
                type="button"
                disabled={Boolean(savingChoiceId)}
                onClick={async () => {
                  if (!song) {
                    return;
                  }

                  setError(null);
                  setSavingChoiceId(candidate.id);

                  try {
                    const selected = await saveLyricsSelection(song, candidate);
                    setLyrics(selected);
                    setChoices([]);
                  } catch {
                    setError('Failed to save selected lyrics.');
                  } finally {
                    setSavingChoiceId(null);
                  }
                }}
                className="w-full rounded-lg border border-amply-border bg-amply-bgSecondary p-3 text-left transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-amply-textPrimary">{candidate.trackName}</p>
                  <span className={`text-[11px] ${candidate.isSynced ? 'text-amply-accent' : 'text-amply-textMuted'}`}>
                    {candidate.isSynced ? 'Synced' : 'Unsynced'}
                  </span>
                </div>
                <p className="mt-1 truncate text-[12px] text-amply-textSecondary">{buildChoiceSubtitle(candidate)}</p>
                <p className="mt-1 truncate text-[12px] text-amply-textMuted">{isSaving ? 'Saving selection...' : buildChoicePreview(candidate)}</p>
              </button>
            );
          })}
        </div>

        {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
      </div>
    );
  }

  if (!lyrics || error) {
    return (
      <div className={clsx('rounded-card border border-amply-border bg-amply-card p-4', fullHeight && 'h-full')}>
        <p className="text-[13px] text-amply-textMuted">{error ?? 'No lyrics available.'}</p>
      </div>
    );
  }

  return (
    <div className={clsx('space-y-3', fullHeight && 'flex h-full min-h-0 flex-col')}>
      <div
        ref={lyricsContainerRef}
        style={visualsStyle}
        onScroll={() => {
          if (!lyricsContainerRef.current) {
            return;
          }

          const container = lyricsContainerRef.current;
          if (programmaticScrollRef.current !== null) {
            return;
          }
          const node = lineRefs.current[currentIndex];
          if (!node) {
            return;
          }

          const distance = Math.abs(node.offsetTop - container.scrollTop);
          const disengageThreshold = container.clientHeight * 0.6;
          const reengageThreshold = container.clientHeight * 0.25;
          const lock = autoScrollLockRef.current;

          if (distance > disengageThreshold && autoScroll) {
            setAutoScroll(false);
          } else if (!autoScroll && distance < reengageThreshold) {
            if (lock) {
              return;
            }
            autoScrollLockRef.current = window.setTimeout(() => {
              setAutoScroll(true);
              autoScrollLockRef.current = null;
            }, 600);
          }
        }}
        className={clsx(
          'lyrics-surface relative isolate overflow-y-auto rounded-card border border-amply-border p-6 scroll-smooth',
          fullHeight ? 'min-h-0 flex-1' : 'h-[420px]',
        )}
      >
        {lyricsVisualsEnabled &&
        !(typeof window !== 'undefined' && (window as unknown as { __AMP_LOW_PERF__?: boolean }).__AMP_LOW_PERF__ === true) ? (
          <div className={clsx('lyrics-visuals', `lyrics-visuals--${lyricsVisualTheme}`)}>
            <span className="lyrics-blob lyrics-blob--a" />
            <span className="lyrics-blob lyrics-blob--b" />
            <span className="lyrics-blob lyrics-blob--c" />
          </div>
        ) : null}
        <div className="relative z-10 space-y-5 text-center">
          {lines.map((line, index) => {
            const isCurrent = lyrics.isSynced && index === currentIndex;
            const isPast = lyrics.isSynced && currentIndex >= 0 && index < currentIndex;
            const isClickable = lyrics.isSynced && line.timeMs !== null;

            return (
              <p
                key={`${line.timeMs ?? 'plain'}-${index}`}
                ref={(node) => {
                  lineRefs.current[index] = node;
                }}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={() => {
                  if (isClickable) {
                    usePlayerStore.getState().seekTo(line.timeMs! / 1000);
                    setAutoScroll(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (isClickable && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    usePlayerStore.getState().seekTo(line.timeMs! / 1000);
                    setAutoScroll(true);
                  }
                }}
                className={[
                  'will-change-[transform,opacity] transition-[transform,opacity,color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  isCurrent
                    ? 'translate-y-0 scale-[1.02] text-[clamp(18px,2.4vw,28px)] font-bold text-amply-textPrimary'
                    : isPast
                      ? '-translate-y-[1px] text-[clamp(14px,1.8vw,20px)] text-amply-textSecondary opacity-80'
                      : lyrics.isSynced
                        ? 'translate-y-[2px] text-[clamp(14px,1.8vw,20px)] text-amply-textMuted opacity-60'
                        : 'text-[clamp(14px,1.8vw,20px)] text-amply-textSecondary',
                  isClickable ? 'cursor-pointer hover:text-amply-textPrimary' : '',
                ].join(' ')}
              >
                {line.text || '...'}
              </p>
            );
          })}
        </div>
      </div>
      {!lyrics.isSynced ? <p className="text-center text-[12px] text-amply-textMuted">Unsynced</p> : null}
    </div>
  );
};

export default LyricsViewer;
