import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '@/types/music';
import {
  loadLyrics,
  saveLyricsSelection,
  type LyricsCandidate,
  type LyricsResult,
} from '@/services/lyricsFetcher';
import { getCurrentLyricIndex } from '@/utils/lrc';
import { formatDuration } from '@/utils/time';
import { usePlayerStore } from '@/store/playerStore';

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
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [choices, setChoices] = useState<LyricsCandidate[]>([]);
  const [cachePath, setCachePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingChoiceId, setSavingChoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  useEffect(() => {
    if (!song || !active) {
      return;
    }

    let alive = true;
    setLoading(true);
    setSavingChoiceId(null);
    setError(null);
    setLyrics(null);
    setChoices([]);
    setCachePath(null);

    loadLyrics(song)
      .then((result) => {
        if (!alive) {
          return;
        }

        setCachePath(result.cachePath);

        if (result.status === 'ready') {
          setLyrics(result.lyrics);
          return;
        }

        if (result.status === 'choose') {
          setChoices(result.candidates);
          return;
        }

        setError('No lyrics found for this track yet.');
      })
      .catch(() => {
        if (alive) {
          setError('Lyrics fetch failed.');
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [active, song?.id]);

  const currentIndex = useMemo(() => {
    if (!lyrics?.isSynced) {
      return -1;
    }

    return getCurrentLyricIndex(lyrics.lines, positionSec);
  }, [lyrics, positionSec]);

  useEffect(() => {
    if (currentIndex < 0 || !lyrics?.isSynced) {
      return;
    }

    const container = lyricsContainerRef.current;
    const node = lineRefs.current[currentIndex];
    if (!container || !node) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const topThreshold = containerRect.top + containerRect.height * 0.25;
    const bottomThreshold = containerRect.top + containerRect.height * 0.75;

    if (nodeRect.top < topThreshold || nodeRect.bottom > bottomThreshold) {
      const targetTop = Math.max(0, node.offsetTop - container.clientHeight * 0.35);
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [currentIndex, lyrics?.isSynced]);

  if (!song) {
    return <p className="text-[13px] text-amply-textMuted">No song selected.</p>;
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
        className={clsx(
          'overflow-y-auto rounded-card border border-amply-border bg-amply-card p-6 scroll-smooth',
          fullHeight ? 'min-h-0 flex-1' : 'h-[420px]',
        )}
      >
        <div className="space-y-5 text-center">
          {lyrics.lines.map((line, index) => {
            const isCurrent = lyrics.isSynced && index === currentIndex;
            const isPast = lyrics.isSynced && currentIndex >= 0 && index < currentIndex;

            return (
              <p
                key={`${line.timeMs ?? 'plain'}-${index}`}
                ref={(node) => {
                  lineRefs.current[index] = node;
                }}
                className={[
                  'transition-[color,transform,opacity] duration-500 ease-smooth',
                  isCurrent
                    ? 'scale-[1.015] text-2xl font-bold text-amply-textPrimary'
                    : isPast
                      ? 'text-lg text-amply-textSecondary'
                      : lyrics.isSynced
                        ? 'text-lg text-amply-textMuted'
                        : 'text-lg text-amply-textSecondary',
                ].join(' ')}
              >
                {line.text || '...'}
              </p>
            );
          })}
        </div>
      </div>
      {!lyrics.isSynced ? <p className="text-center text-[12px] text-amply-textMuted">Unsynced</p> : null}
      <p className="text-center text-[11px] text-amply-textMuted">{lyrics.fromCache ? `Cached: ${lyrics.cachePath}` : `Saved to: ${cachePath ?? lyrics.cachePath}`}</p>
    </div>
  );
};

export default LyricsViewer;
