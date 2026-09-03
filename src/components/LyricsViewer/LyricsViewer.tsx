import { cancelIdle, requestIdle, type IdleHandle } from '@/utils/idle';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Song } from '@/types/music';
import { Badge, Card, IconButton, Meta, Spinner, Surface, surfaceClass } from '@/components/ui';
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
import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { useIdleRender } from '@/hooks/useIdleRender';
import { useInteractionFeedback } from '@/services/interactionFeedback';
import { beginPerfInteraction } from '@/services/perfDiagnostics';
import { getFlag } from '@/services/runtimeFlags';
import { scheduleAfterPaint } from '@/services/interactionTrace';
import { usePlaybackProgress } from '@/store/playbackProgressStore';
import LyricsVisualizer from './LyricsVisualizer';

interface LyricsViewerProps {
  song: Song | null;
  active: boolean;
  fullHeight?: boolean;
  onShellReady?: () => void;
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

const OFFSET_STEP_MS = 250;

const formatOffset = (offsetMs: number): string => {
  const seconds = (Math.abs(offsetMs) / 1000).toFixed(2);
  const sign = offsetMs > 0 ? '+' : offsetMs < 0 ? '-' : '';
  return `Sync ${sign}${seconds}s`;
};

/**
 * Artwork tints are cached as `rgb(r, g, b)` (older caches may hold a hex colour). Returns the
 * channels so the tint can be re-emitted with a CSS alpha, which a string suffix cannot do.
 */
const parseTintChannels = (tint: string): [number, number, number] | null => {
  const rgbMatch = tint.match(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const hexMatch = tint.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const value = Number.parseInt(hexMatch[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  return null;
};

const LyricsViewer = ({ song, active, fullHeight = false, onShellReady }: LyricsViewerProps) => {
  const positionSec = usePlaybackProgress((progress) => progress.positionSec);
  const lyricsVisualsEnabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const lyricsVisualTheme = usePlayerStore((state) => state.settings.lyricsVisualTheme);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const fetchLyricsCandidatesForSong = useLibraryStore((state) => state.fetchLyricsCandidatesForSong);
  const idleReady = useIdleRender(300);
  const interactionFeedback = useInteractionFeedback();
  const [artworkTint, setArtworkTint] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [choices, setChoices] = useState<LyricsCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingChoiceId, setSavingChoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [offsetMs, setOffsetMs] = useState(0);
  const [surfaceReady, setSurfaceReady] = useState(false);
  const songId = song?.id ?? null;

  // Use refs to avoid triggering re-renders
  const offsetRef = useRef(0);
  // Latest song object for effects keyed on `songId`: the snapshot identity changes on every activity
  // update, and re-fetching lyrics for the same track each time would be wasteful.
  const songRef = useRef<Song | null>(song);
  const offsetsCacheRef = useRef<Record<string, number>>({});
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const autoScrollLockRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<number | null>(null);
  const lyricsAbortRef = useRef<AbortController | null>(null);
  const backdropAbortRef = useRef<AbortController | null>(null);
  const shellReadyRef = useRef(false);
  const lyricsReadyRef = useRef<ReturnType<typeof beginPerfInteraction> | null>(null);

  useEffect(() => {
    songRef.current = song;
  }, [song]);

  useEffect(() => {
    if (!active) {
      setSurfaceReady(false);
      shellReadyRef.current = false;
      return;
    }
    setSurfaceReady(false);
    shellReadyRef.current = false;
    return scheduleAfterPaint(() => {
      setSurfaceReady(true);
    });
  }, [active, song?.id]);

  useEffect(() => {
    if (!active || !surfaceReady || shellReadyRef.current) {
      return;
    }
    shellReadyRef.current = true;
    onShellReady?.();
  }, [active, surfaceReady, onShellReady]);

  useEffect(() => {
    lyricsReadyRef.current?.cancel({ reason: 'replaced' });
    lyricsReadyRef.current = null;

    if (!active || !song?.id || gameMode) {
      return;
    }

    lyricsReadyRef.current = beginPerfInteraction('lyrics-first-ready', { songId: song.id });
    return () => {
      lyricsReadyRef.current?.cancel({ reason: 'reset' });
      lyricsReadyRef.current = null;
    };
  }, [active, song?.id, gameMode]);

  useEffect(() => {
    const handle = lyricsReadyRef.current;
    if (!handle || loading) {
      return;
    }
    if (lyrics || error || choices.length > 0 || gameMode) {
      handle.end({
        hasLyrics: Boolean(lyrics),
        hasChoices: choices.length > 0,
        hasError: Boolean(error),
      });
      lyricsReadyRef.current = null;
    }
  }, [lyrics, choices.length, error, loading, gameMode]);

  useEffect(() => {
    if (gameMode) {
      setLoading(false);
      setSavingChoiceId(null);
      setError('Lyrics disabled in Game Mode.');
      setLyrics(null);
      setChoices([]);
      return;
    }

    const currentSong = songRef.current;
    if (!currentSong || !active || !surfaceReady) {
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
        const cached = await readCachedLyrics(currentSong);
        if (abortController.signal.aborted || !alive) {
          return;
        }

        if (cached.status === 'ready') {
          setLyrics(cached.lyrics);
          return;
        }

        // No cache yet: attempt a live fetch once.
        const fetched = await loadLyrics(currentSong);
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
          readCachedLyrics(currentSong)
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
  }, [active, songId, gameMode, surfaceReady]);

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

  const handleOffsetChange = useCallback(async (deltaMs: number) => {
    if (!songId) {
      return;
    }
    const next = Math.max(-8000, Math.min(8000, offsetRef.current + deltaMs));
    setOffsetMs(next);
    offsetsCacheRef.current = {
      ...offsetsCacheRef.current,
      [songId]: next,
    };
    await writeStorageJsonDebounced('lyrics_offsets.json', offsetsCacheRef.current, 600);
  }, [songId]);

  const handleManualChoose = useCallback(async () => {
    if (!songId || loading) {
      return;
    }
    setSavingChoiceId(null);
    setError(null);
    setLoading(true);
    try {
      const candidates = await fetchLyricsCandidatesForSong(songId);
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
  }, [fetchLyricsCandidatesForSong, loading, songId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!songId) {
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
  }, [songId, handleOffsetChange, handleManualChoose]);

  useEffect(() => {
    if (gameMode) {
      setArtworkTint(null);
      return;
    }

    if (!song?.id || !active || !surfaceReady || !idleReady) {
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

    let idleHandle: IdleHandle | null = null;

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

        await writeStorageJsonDebounced(cachePath, {
          ...cache,
          [song.id]: tint,
        }, 1000);
      } catch (error) {
        if (alive && !abortController.signal.aborted) {
          console.warn('[Lyrics] Backdrop loading failed:', error);
          setArtworkTint(null);
        }
      }
    };

    idleHandle = requestIdle(
      () => {
        void loadBackdrop();
      },
      { timeout: 1500, fallbackDelayMs: 180 },
    );

    return () => {
      alive = false;
      abortController.abort();
      cancelIdle(idleHandle);
    };
  }, [song?.id, song?.albumArt, gameMode, active, surfaceReady, idleReady]);

  const lines = useMemo(() => (Array.isArray(lyrics?.lines) ? lyrics!.lines : []), [lyrics]);

  // A faint wash of the artwork colour over the pressed well; the surface itself stays `bg-amply-bg`.
  const tintStyle = useMemo<CSSProperties | undefined>(() => {
    const channels = artworkTint ? parseTintChannels(artworkTint) : null;
    if (!channels) {
      return undefined;
    }
    return {
      backgroundImage: `radial-gradient(ellipse at top, rgb(${channels.join(' ')} / 0.12), transparent 60%)`,
    };
  }, [artworkTint]);

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
  }, [lyrics?.isSynced, timedIndex, positionSec, offsetMs]);

  useEffect(() => {
    if (currentIndex < 0 || !lyrics?.isSynced || !autoScroll || !active || !surfaceReady) {
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
  }, [currentIndex, lyrics?.isSynced, autoScroll, active, surfaceReady]);

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

  if (active && !surfaceReady) {
    return <Card className={clsx(fullHeight && 'h-full')} />;
  }

  if (active && !idleReady) {
    return (
      <Card className={clsx(fullHeight && 'h-full')}>
        {interactionFeedback.visible ? null : <p className="text-[12px] text-amply-textMuted">Preparing lyrics...</p>}
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={clsx('flex items-center gap-3 text-[13px] text-amply-textSecondary', fullHeight && 'h-full')}>
        {interactionFeedback.visible ? null : (
          <>
            <Spinner size={16} label="Loading lyrics" />
            <span>Loading lyrics...</span>
          </>
        )}
      </Card>
    );
  }

  if (choices.length) {
    return (
      <Card className={clsx('space-y-3', fullHeight && 'h-full overflow-y-auto')}>
        <div className="space-y-1">
          <p className="text-[14px] font-medium text-amply-textPrimary">Multiple lyric matches found</p>
          <Meta>Pick the correct one. Your selection will be cached for offline playback.</Meta>
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
                className={clsx(
                  surfaceClass('flat'),
                  'neu-interactive block w-full rounded-md p-3 text-left hover:neu-raised-sm disabled:cursor-not-allowed disabled:opacity-70',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-amply-textPrimary">{candidate.trackName}</p>
                  <Badge tone={candidate.isSynced ? 'accent' : 'neutral'}>{candidate.isSynced ? 'Synced' : 'Unsynced'}</Badge>
                </div>
                <Meta className="mt-1 truncate">{buildChoiceSubtitle(candidate)}</Meta>
                <Meta className="mt-1 truncate text-amply-textMuted">{isSaving ? 'Saving selection...' : buildChoicePreview(candidate)}</Meta>
              </button>
            );
          })}
        </div>

        {error ? <p className="text-[12px] text-amply-danger">{error}</p> : null}
      </Card>
    );
  }

  if (!lyrics || error) {
    return (
      <Card className={clsx(fullHeight && 'h-full')}>
        <p className="text-[13px] text-amply-textMuted">{error ?? 'No lyrics available.'}</p>
      </Card>
    );
  }

  return (
    <div className={clsx('space-y-3', fullHeight && 'flex h-full min-h-0 flex-col')}>
      <Surface
        variant="pressed"
        radius="lg"
        className={clsx('relative isolate flex flex-col overflow-hidden bg-amply-bg', fullHeight ? 'min-h-0 flex-1' : 'h-[420px]')}
        style={tintStyle}
      >
        {lyricsVisualsEnabled && !getFlag('lowPerf') ? (
          <LyricsVisualizer active={active} isPlaying={isPlaying} theme={lyricsVisualTheme} tint={artworkTint} />
        ) : null}
        <div
          ref={lyricsContainerRef}
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
          className="lyrics-surface relative z-10 min-h-0 flex-1 overflow-y-auto px-[clamp(24px,7vw,96px)] scroll-smooth"
        >
          <div className="relative z-10 mx-auto w-full max-w-[760px] space-y-6 py-[22vh] text-center">
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
                  className={clsx(
                    'mx-auto max-w-full break-words text-center leading-[1.28] [text-wrap:balance] transition-[transform,opacity,color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    isCurrent
                      ? 'translate-y-0 scale-[1.02] text-[clamp(20px,2.6vw,30px)] font-bold tracking-[-0.025em] text-amply-textPrimary'
                      : isPast
                        ? '-translate-y-[1px] text-[clamp(14px,1.8vw,20px)] text-amply-textSecondary opacity-80'
                        : lyrics.isSynced
                          ? 'translate-y-[2px] text-[clamp(14px,1.8vw,20px)] text-amply-textMuted opacity-60'
                          : 'text-[clamp(14px,1.8vw,20px)] text-amply-textSecondary',
                    isClickable && 'cursor-pointer hover:text-amply-textPrimary',
                  )}
                >
                  {line.text || '...'}
                </p>
              );
            })}
          </div>
        </div>
      </Surface>

      {lyrics.isSynced ? (
        <div className="flex shrink-0 items-center justify-center gap-2">
          <IconButton
            name="minus"
            label="Shift lyrics later"
            size="xs"
            variant="ghost"
            onClick={() => void handleOffsetChange(-OFFSET_STEP_MS)}
          />
          <Meta className="min-w-[88px] text-center tabular-nums text-amply-textMuted">{formatOffset(offsetMs)}</Meta>
          <IconButton
            name="plus"
            label="Shift lyrics earlier"
            size="xs"
            variant="ghost"
            onClick={() => void handleOffsetChange(OFFSET_STEP_MS)}
          />
        </div>
      ) : (
        <Meta className="shrink-0 text-center text-amply-textMuted">Unsynced</Meta>
      )}
    </div>
  );
};

export default LyricsViewer;
