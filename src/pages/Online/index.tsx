import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { PageHeader, PillButton, SoftPanel, UnifiedSearchInput } from '@/components/ui/AmplyUI';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { downloadOnlineTrack, searchOnlineTracks, type OnlineTrackResult } from '@/services/onlineDownloadService';
import { isTauri } from '@/services/storageService';
import { formatDuration } from '@/utils/time';

const RESULT_LIMIT = 18;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Online request failed.';
};

const OnlineResultRow = ({
  item,
  downloading,
  onDownload,
}: {
  item: OnlineTrackResult;
  downloading: boolean;
  onDownload: (item: OnlineTrackResult) => void;
}) => {
  const meta = [
    item.provider,
    item.year,
    item.duration ? formatDuration(item.duration) : null,
    item.license ? 'Licensed source' : null,
  ].filter(Boolean);

  return (
    <article className="song-row-card grid gap-3 rounded-[24px] border border-amply-border/50 bg-[var(--control-surface)] p-3 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center">
      <ArtworkImage
        src={item.artworkUrl ?? undefined}
        alt={item.title}
        forceReady
        className="h-14 w-14 rounded-2xl object-cover"
        placeholderClassName="flex h-14 w-14 items-center justify-center rounded-2xl bg-amply-bgPrimary/50 text-[16px] font-bold text-amply-textMuted"
        placeholderContent={item.title.slice(0, 1).toUpperCase()}
      />
      <div className="min-w-0">
        <h2 className="truncate text-[14px] font-semibold text-amply-textPrimary" title={item.title}>
          {item.title}
        </h2>
        <p className="mt-1 truncate text-[12px] text-amply-textSecondary" title={item.artist}>
          {item.artist}
        </p>
        {meta.length ? (
          <p className="mt-2 truncate text-[10px] uppercase tracking-[0.16em] text-amply-textMuted">
            {meta.join(' / ')}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[38px] items-center justify-center rounded-2xl bg-[var(--control-surface)] px-3 text-[11px] font-medium text-amply-textSecondary shadow-[inset_0_0_0_1px_var(--control-border)] hover:bg-amply-hover hover:text-amply-textPrimary"
        >
          Source
        </a>
        <PillButton
          type="button"
          variant="primary"
          disabled={downloading}
          onClick={() => onDownload(item)}
          className="min-h-[38px] px-3"
        >
          {downloading ? 'Saving...' : item.downloadLabel}
        </PillButton>
      </div>
    </article>
  );
};

const OnlinePage = () => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<OnlineTrackResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isRescanPending, startRescanTransition] = useTransition();
  const requestIdRef = useRef(0);

  const libraryPaths = useLibraryStore((state) => state.libraryPaths);
  const scanLibrary = useLibraryStore((state) => state.scanLibrary);
  const isScanning = useLibraryStore((state) => state.isScanning);
  const showToast = usePlayerStore((state) => state.showToast);
  const primaryLibraryPath = libraryPaths[0] ?? 'music';

  const visibleResults = useMemo(() => results.slice(0, RESULT_LIMIT), [results]);

  useEffect(() => {
    const term = deferredQuery.trim();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);
    const handle = window.setTimeout(() => {
      void searchOnlineTracks(term)
        .then((items) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setResults(items);
        })
        .catch((searchError) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setResults([]);
          setError(getErrorMessage(searchError));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setSearching(false);
          }
        });
    }, 280);

    return () => {
      window.clearTimeout(handle);
    };
  }, [deferredQuery]);

  const handleDownload = async (item: OnlineTrackResult) => {
    if (downloadingId) {
      return;
    }
    setDownloadingId(item.id);
    setError(null);
    try {
      const saved = await downloadOnlineTrack(item, primaryLibraryPath);
      showToast(`Saved ${saved.filename}`);
      startRescanTransition(() => {
        void scanLibrary();
      });
    } catch (downloadError) {
      const message = getErrorMessage(downloadError);
      setError(message);
      showToast(message);
    } finally {
      setDownloadingId(null);
    }
  };

  const statusText = useMemo(() => {
    if (!isTauri()) {
      return 'Desktop app required.';
    }
    if (downloadingId) {
      return 'Saving download...';
    }
    if (isScanning || isRescanPending) {
      return 'Updating library...';
    }
    if (searching) {
      return 'Searching...';
    }
    if (deferredQuery.trim().length >= 2) {
      return `${visibleResults.length.toLocaleString()} results`;
    }
    return `Saving to ${primaryLibraryPath}`;
  }, [deferredQuery, downloadingId, isRescanPending, isScanning, primaryLibraryPath, searching, visibleResults.length]);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Online" description="Search downloadable audio and save it into your local library." />

      <SoftPanel className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <UnifiedSearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search songs, artists, live sets..."
            disabled={!isTauri()}
            className="min-w-0"
            autoFocus
          />
          <span className="rounded-2xl bg-[var(--control-surface)] px-3 py-2 text-[11px] font-medium text-amply-textSecondary shadow-[inset_0_0_0_1px_var(--control-border)]">
            {statusText}
          </span>
        </div>
      </SoftPanel>

      {error ? (
        <SoftPanel className="border border-red-400/30 p-4 text-[13px] text-red-400">
          {error}
        </SoftPanel>
      ) : null}

      {!isTauri() ? (
        <SoftPanel className="p-6 text-[13px] text-amply-textMuted">
          Online downloads are available in the Tauri desktop app.
        </SoftPanel>
      ) : visibleResults.length ? (
        <div className="grid gap-3">
          {visibleResults.map((item) => (
            <OnlineResultRow
              key={item.id}
              item={item}
              downloading={downloadingId === item.id}
              onDownload={handleDownload}
            />
          ))}
        </div>
      ) : deferredQuery.trim().length >= 2 && !searching ? (
        <SoftPanel className="p-6 text-[13px] text-amply-textMuted">
          No downloadable matches found.
        </SoftPanel>
      ) : (
        <SoftPanel className="p-6 text-[13px] text-amply-textMuted">
          Search public downloadable audio.
        </SoftPanel>
      )}
    </div>
  );
};

export default OnlinePage;
