import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import addIcon from '@/assets/icons/add.svg';
import libraryIcon from '@/assets/icons/library.svg';
import searchIcon from '@/assets/icons/search.svg';
import trashIcon from '@/assets/icons/trash.svg';
import {
  clearStorageCache,
  getStorageStats,
  isTauri,
  openStorageDir,
  pickMusicFolders,
  type StorageStats,
} from '@/services/storageService';
import { listOutputDevices, type OutputDeviceInfo } from '@/services/audioDeviceService';

const EQ_BANDS = [
  { freq: '60Hz', short: 'Sub' },
  { freq: '250Hz', short: 'Bass' },
  { freq: '1kHz', short: 'Mid' },
  { freq: '4kHz', short: 'Presence' },
  { freq: '12kHz', short: 'Air' },
] as const;

const EQ_PRESET_LABELS = {
  flat: 'Flat',
  warm: 'Warm',
  bass: 'Bass Boost',
  treble: 'Treble Lift',
  vocal: 'Vocal Focus',
  club: 'Club',
  custom: 'Custom',
} as const;

const EQ_GRAPH_WIDTH = 100;
const EQ_GRAPH_HEIGHT = 52;
const EQ_MIN_DB = -12;
const EQ_MAX_DB = 12;

const clampEqGain = (value: number): number => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, value));

const getEqPoint = (bands: number[], index: number) => {
  const x = bands.length > 1 ? (index * EQ_GRAPH_WIDTH) / (bands.length - 1) : EQ_GRAPH_WIDTH / 2;
  const normalized = (clampEqGain(bands[index] ?? 0) - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB);
  const y = Number((EQ_GRAPH_HEIGHT - normalized * EQ_GRAPH_HEIGHT).toFixed(2));
  return { x: Number(x.toFixed(2)), y };
};

const buildEqLinePath = (bands: number[]): string => {
  if (!bands.length) {
    return '';
  }

  const points = bands.map((_, index) => getEqPoint(bands, index));
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = Number(((current.x + next.x) / 2).toFixed(2));
    path += ` Q ${current.x} ${current.y} ${midX} ${Number(((current.y + next.y) / 2).toFixed(2))}`;
  }
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  path += ` Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`;
  return path;
};

const buildEqAreaPath = (bands: number[]): string => {
  if (!bands.length) {
    return '';
  }

  const linePath = buildEqLinePath(bands);
  const first = getEqPoint(bands, 0);
  const last = getEqPoint(bands, bands.length - 1);
  return `${linePath} L ${last.x} ${EQ_GRAPH_HEIGHT} L ${first.x} ${EQ_GRAPH_HEIGHT} Z`;
};

const EQGraphEditor = ({
  bands,
  onChange,
}: {
  bands: number[];
  onChange: (bands: number[]) => void;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }

    const updateFromPointer = (clientY: number) => {
      const svg = svgRef.current;
      if (!svg) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (!rect.height) {
        return;
      }
      const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const ratio = 1 - relativeY / rect.height;
      const gain = clampEqGain(Number((EQ_MIN_DB + ratio * (EQ_MAX_DB - EQ_MIN_DB)).toFixed(1)));
      const next = [...bands];
      next[activeIndex] = gain;
      onChange(next);
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateFromPointer(event.clientY);
    };

    const handlePointerUp = () => {
      setActiveIndex(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeIndex, bands, onChange]);

  return (
    <div className="px-1 py-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${EQ_GRAPH_WIDTH} ${EQ_GRAPH_HEIGHT}`}
        className="h-40 w-full touch-none sm:h-48"
      >
        <defs>
          <linearGradient id="eqCurveStroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff9b46" />
            <stop offset="100%" stopColor="#ff8a2b" />
          </linearGradient>
          <linearGradient id="eqCurveFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,138,43,0.20)" />
            <stop offset="100%" stopColor="rgba(255,138,43,0.02)" />
          </linearGradient>
        </defs>

        {[0, 25, 50, 75, 100].map((line) => {
          const y = (EQ_GRAPH_HEIGHT * line) / 100;
          return (
            <line
              key={line}
              x1="0"
              y1={y}
              x2={EQ_GRAPH_WIDTH}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="1.5 2.5"
              strokeWidth="0.45"
            />
          );
        })}

        {EQ_BANDS.map((_, index) => {
          const point = getEqPoint(bands, index);
          return (
            <line
              key={`guide-${index}`}
              x1={point.x}
              y1="0"
              x2={point.x}
              y2={EQ_GRAPH_HEIGHT}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="1.5 3"
              strokeWidth="0.45"
            />
          );
        })}

        <path d={buildEqAreaPath(bands)} fill="url(#eqCurveFill)" />
        <path
          d={buildEqLinePath(bands)}
          fill="none"
          stroke="url(#eqCurveStroke)"
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {EQ_BANDS.map((band, index) => {
          const point = getEqPoint(bands, index);
          const isActive = activeIndex === index;
          return (
            <g key={band.freq}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isActive ? '4.1' : '3.4'}
                fill="#121212"
                stroke="#ff8a2b"
                strokeWidth="1.15"
              />
              <circle cx={point.x} cy={point.y} r={isActive ? '1.5' : '1.2'} fill="#ff8a2b" />
              <circle
                cx={point.x}
                cy={point.y}
                r="8"
                fill="transparent"
                className="cursor-pointer"
                onPointerDown={(event) => {
                  event.preventDefault();
                  setActiveIndex(index);
                }}
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-3 grid grid-cols-5 gap-2 text-center">
        {EQ_BANDS.map((band, index) => (
          <button
            key={band.freq}
            type="button"
            onClick={() => setActiveIndex(index)}
            className={`rounded-xl px-2 py-2 text-[10px] transition-colors sm:text-[11px] ${
              activeIndex === index ? 'bg-white/10 text-white' : 'text-amply-textMuted hover:bg-white/5 hover:text-amply-textSecondary'
            }`}
          >
            <span className="block font-semibold">{band.short}</span>
            <span className="block mt-1">
              {bands[index] > 0 ? '+' : ''}
              {bands[index].toFixed(1)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

const ToggleRow = ({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) => {
  return (
    <label className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-amply-border/60 bg-amply-surface px-4 py-3 shadow-card sm:flex-nowrap sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-amply-textPrimary">{title}</p>
        {description ? <p className="mt-1 text-[11px] text-amply-textMuted">{description}</p> : null}
      </div>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-amply-border transition-colors peer-checked:bg-amply-accent" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-amply-textPrimary transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
};

const SettingsPage = () => {
  const libraryPaths = useLibraryStore((state) => state.libraryPaths);
  const isScanning = useLibraryStore((state) => state.isScanning);
  const addLibraryPath = useLibraryStore((state) => state.addLibraryPath);
  const removeLibraryPath = useLibraryStore((state) => state.removeLibraryPath);
  const setLibraryPaths = useLibraryStore((state) => state.setLibraryPaths);
  const scanLibrary = useLibraryStore((state) => state.scanLibrary);

  const settings = usePlayerStore((state) => state.settings);
  const sleepTimerEndsAt = usePlayerStore((state) => state.sleepTimerEndsAt);
  const sleepTimerDurationMin = usePlayerStore((state) => state.sleepTimerDurationMin);

  const setPlaybackSpeed = usePlayerStore((state) => state.setPlaybackSpeed);
  const setOutputDeviceName = usePlayerStore((state) => state.setOutputDeviceName);
  const setEqPreset = usePlayerStore((state) => state.setEqPreset);
  const setEqBands = usePlayerStore((state) => state.setEqBands);
  const setCrossfadeEnabled = usePlayerStore((state) => state.setCrossfadeEnabled);
  const setCrossfadeDuration = usePlayerStore((state) => state.setCrossfadeDuration);
  const setGaplessEnabled = usePlayerStore((state) => state.setGaplessEnabled);
  const setVolumeNormalizationEnabled = usePlayerStore((state) => state.setVolumeNormalizationEnabled);
  const setSleepTimer = usePlayerStore((state) => state.setSleepTimer);
  const setLaunchOnStartup = usePlayerStore((state) => state.setLaunchOnStartup);
  const setGameMode = usePlayerStore((state) => state.setGameMode);
  const setMiniNowPlayingOverlay = usePlayerStore((state) => state.setMiniNowPlayingOverlay);
  const setOverlayAutoHide = usePlayerStore((state) => state.setOverlayAutoHide);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);
  const setMetadataFetchPaused = usePlayerStore((state) => state.setMetadataFetchPaused);

  const [localPath, setLocalPath] = useState('');
  const [customSleepMinutes, setCustomSleepMinutes] = useState('');
  const [timeTick, setTimeTick] = useState(Date.now());
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const startMetadataFetch = useLibraryStore((state) => state.startMetadataFetch);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const songs = useLibraryStore((state) => state.songs);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [outputDevices, setOutputDevices] = useState<OutputDeviceInfo[]>([]);
  const sleepTimerRemainingMs = sleepTimerEndsAt ? Math.max(0, sleepTimerEndsAt - timeTick) : 0;
  const sleepTimerRemainingMin = sleepTimerEndsAt ? Math.max(0, Math.ceil(sleepTimerRemainingMs / 60000)) : 0;
  const sleepTimerDisplay = sleepTimerEndsAt
    ? sleepTimerRemainingMs < 60_000
      ? '<1m'
      : `${Math.floor(sleepTimerRemainingMs / 3_600_000)}h ${Math.floor((sleepTimerRemainingMs % 3_600_000) / 60_000)
          .toString()
          .padStart(2, '0')}m`
    : '--';

  const totalSongs = songs.length || 1;
  const lyricsProgress = storageStats ? Math.min(100, (storageStats.lyricsFiles / totalSongs) * 100) : 0;
  const artistTotal = useMemo(() => {
    const set = new Set<string>();
    for (const song of songs) {
      if (song.artist?.trim()) {
        set.add(song.artist.trim().toLowerCase());
      }
    }
    return set.size || 1;
  }, [songs]);
  const artistProgress = storageStats ? Math.min(100, (storageStats.artistFiles / artistTotal) * 100) : 0;
  const genresFound = useMemo(
    () => songs.filter((song) => song.genre?.trim() && song.genre.trim().toLowerCase() !== 'unknown genre').length,
    [songs],
  );
  const genresProgress = Math.min(100, (genresFound / totalSongs) * 100);

  const statusItems = useMemo(
    () => [
      { label: 'Lyrics Cached', count: storageStats?.lyricsFiles ?? 0, progress: lyricsProgress },
      { label: 'Genres Found', count: genresFound, progress: genresProgress },
      { label: 'Artist Data Cached', count: storageStats?.artistFiles ?? 0, progress: artistProgress },
    ],
    [storageStats, lyricsProgress, artistProgress, genresFound, genresProgress],
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const stats = await getStorageStats();
        if (alive) {
          setStorageStats(stats);
        }
      } catch {
        // Ignore stats load errors; storage stats are optional.
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!isTauri()) {
      return () => {
        alive = false;
      };
    }

    const load = async () => {
      const devices = await listOutputDevices();
      if (alive) {
        setOutputDevices(devices);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!metadataFetch.running) {
      void getStorageStats().then((stats) => {
        if (stats) {
          setStorageStats(stats);
        }
      });
    }
  }, [metadataFetch.running]);

  useEffect(() => {
    if (!sleepTimerEndsAt) {
      return;
    }

    let handle: number | null = null;
    const updateTick = () => {
      const now = Date.now();
      setTimeTick(now);

      if (now >= sleepTimerEndsAt) {
        return;
      }

      const remaining = sleepTimerEndsAt - now;
      const delay =
        remaining <= 60_000
          ? 1000
          : (((remaining - 1) % 60_000) + 1);

      handle = window.setTimeout(updateTick, delay);
    };

    updateTick();

    return () => {
      if (handle !== null) {
        window.clearTimeout(handle);
      }
    };
  }, [sleepTimerEndsAt]);

  return (
    <div className="space-y-4 pb-8">
      <header className="space-y-1">
        <h1 className="text-[22px] font-bold tracking-tight text-amply-textPrimary sm:text-[26px]">Settings</h1>
        <p className="text-[12px] text-amply-textSecondary">Library, playback, and app behavior.</p>
      </header>

      <div className="grid gap-4 2xl:grid-cols-2">
        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
          <div className="space-y-1">
          <h2 className="text-[16px] font-bold text-amply-textPrimary">Music Library</h2>
          <p className="text-[12px] text-amply-textSecondary">
            Add one or more folders. Amply scans all folders in this list.
          </p>
          </div>

        <div className="mt-3 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              placeholder="Add folder path manually (optional)"
              className="min-w-0 flex-1 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
            />
            <button
              type="button"
              onClick={async () => {
                const value = localPath.trim();
                if (!value) {
                  return;
                }
                await addLibraryPath(value);
                setLocalPath('');
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amply-accent px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover sm:w-auto sm:min-w-[120px]"
              title="Add path"
            >
              <img src={addIcon} alt="" className="h-4 w-4" />
              Add Path
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={async () => {
                const picked = await pickMusicFolders();
                if (picked.length) {
                  const merged = Array.from(new Set([...libraryPaths, ...picked]));
                  await setLibraryPaths(merged);
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              title="Browse folders"
            >
              <img src={libraryIcon} alt="" className="h-4 w-4 brightness-0 invert opacity-80" />
              Browse
            </button>
            <button
              type="button"
              onClick={() => {
                void scanLibrary();
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              title="Rescan library"
            >
              <img src={searchIcon} alt="" className="h-4 w-4 brightness-0 invert opacity-80" />
              {isScanning ? 'Scanning...' : 'Rescan'}
            </button>
          </div>
        </div>

        <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {libraryPaths.map((path) => (
            <div key={path} className="flex flex-col gap-2 rounded-lg border border-amply-border/60 bg-amply-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 break-all text-[12px] text-amply-textSecondary sm:truncate sm:pr-4">{path}</p>
              <button
                type="button"
                onClick={() => {
                  void removeLibraryPath(path);
                }}
                className="self-start rounded-md border border-amply-border/60 px-2 py-1 text-[12px] text-amply-textMuted transition-colors hover:bg-amply-hover hover:text-amply-textPrimary sm:self-auto"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        </section>

        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
        <div className="space-y-1">
          <h2 className="text-[16px] font-bold text-amply-textPrimary">Library Data</h2>
          <p className="text-[12px] text-amply-textSecondary">
            Fetch artist info, lyrics, and genres that are missing, or clear cached data.
          </p>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            disabled={metadataFetch.running}
            onClick={() => {
              setBulkMessage(null);
              startMetadataFetch();
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amply-accent px-3 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <img src={searchIcon} alt="" className="h-4 w-4" />
            {metadataFetch.running ? 'Fetching...' : 'Fetch Missing'}
          </button>

          <button
            type="button"
            onClick={() => {
              void openStorageDir();
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amply-border/60 px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            <img src={libraryIcon} alt="" className="h-4 w-4 brightness-0 invert opacity-80" />
            Storage
          </button>

          <button
            type="button"
            disabled={clearingCache}
            onClick={async () => {
              if (clearingCache) {
                return;
              }
              setClearingCache(true);
              setBulkMessage(null);
              try {
                await clearStorageCache();
                setBulkMessage('Cache cleared. Restart the app to rescan library data.');
              } finally {
                setClearingCache(false);
              }
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-amply-border/60 px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <img src={trashIcon} alt="" className="h-4 w-4 brightness-0 invert opacity-80" />
            {clearingCache ? 'Clearing...' : 'Clear Cache'}
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          <ToggleRow
            title="Pause Metadata Lookups"
            description="Stops all background metadata fetching (lyrics, artist info, genres, loudness, album tracklists)."
            checked={settings.metadataFetchPaused}
            onChange={(next) => {
              void setMetadataFetchPaused(next);
            }}
          />
        </div>

        {metadataFetch.running && metadataFetch.total > 0 ? (
          <div className="mt-3 rounded-lg border border-amply-border/60 bg-amply-surface px-3 py-2 text-[12px] text-amply-textMuted">
            Processed {metadataFetch.done}/{metadataFetch.total} pending songs. Artists {metadataFetch.artists}. Lyrics {metadataFetch.lyrics}. Genres {metadataFetch.genres}. Loudness {metadataFetch.loudness}. Album Art {metadataFetch.albumArt}.
          </div>
        ) : null}

        {metadataFetch.message || bulkMessage ? (
          <div className="mt-3 rounded-lg border border-amply-border/60 bg-amply-surface px-3 py-2 text-[12px] text-amply-textMuted">
            {metadataFetch.message ?? bulkMessage}
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-amply-border/60 bg-amply-bgSecondary/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted">Local Cache Status</p>
            <span className="text-[11px] text-amply-textMuted">
              {storageStats ? `${storageStats.totalFiles} files` : '-'}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {statusItems.map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-[12px] text-amply-textSecondary">
                  <span>{item.label}</span>
                  <span>{item.count}</span>
                </div>
                <div className="relative h-1 rounded-full bg-[#3a3a3a]">
                  <div className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent" style={{ width: `${item.progress}%` }} />
                </div>
              </div>
            ))}
            {storageStats ? (
              <p className="break-all text-[11px] text-amply-textMuted">Storage path: {storageStats.storagePath}</p>
            ) : (
              <p className="text-[11px] text-amply-textMuted">Storage stats are available in desktop mode.</p>
            )}
          </div>
        </div>
        </section>

        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
        <div className="space-y-1">
          <h2 className="text-[16px] font-bold text-amply-textPrimary">App Behavior</h2>
          <p className="text-[12px] text-amply-textSecondary">Control how Amply launches and behaves on startup.</p>
        </div>

        <div className="mt-3 grid gap-2">
          <ToggleRow
            title="Launch on System Startup"
            description="Start Amply automatically when your system boots."
            checked={settings.launchOnStartup}
            onChange={(next) => {
              void setLaunchOnStartup(next);
            }}
          />
          <ToggleRow
            title="Game Mode"
            description="Bare-minimum mode: only playlists + playbar. Disables smart fetching and heavy panels."
            checked={settings.gameMode}
            onChange={(next) => {
              void setGameMode(next);
            }}
          />
        </div>
        </section>

        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
        <div className="space-y-1">
          <h2 className="text-[16px] font-bold text-amply-textPrimary">Overlay</h2>
          <p className="text-[12px] text-amply-textSecondary">Always-on-top mini player controls.</p>
        </div>

        <div className="mt-3 grid gap-2">
          <ToggleRow
            title="Mini Now Playing Overlay"
            description="Show a translucent overlay on top of other apps."
            checked={settings.miniNowPlayingOverlay}
            onChange={(next) => {
              void setMiniNowPlayingOverlay(next);
            }}
          />
          <ToggleRow
            title="Auto-hide Overlay"
            description="Hide the overlay when playback is paused."
            checked={settings.overlayAutoHide}
            onChange={(next) => {
              void setOverlayAutoHide(next);
            }}
          />
        </div>
        </section>

        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
        <h2 className="text-[16px] font-bold text-amply-textPrimary">Advanced Playback</h2>

        <div className="mt-3 grid gap-2">
          {isTauri() ? (
            <div className="rounded-lg border border-amply-border/60 bg-amply-surface px-4 py-3">
              <p className="text-[12px] text-amply-textSecondary">Output Device</p>
              <select
                value={settings.outputDeviceName ?? ''}
                onChange={(event) => {
                  const value = event.target.value || null;
                  void setOutputDeviceName(value);
                }}
                className="mt-2 w-full rounded-md border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
              >
                <option value="">System Default</option>
                {outputDevices.map((device) => (
                  <option key={device.name} value={device.name}>
                    {device.name}
                    {device.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="rounded-lg border border-amply-border/60 bg-amply-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-amply-textSecondary">EQ Preset</p>
              <span className="text-[11px] uppercase tracking-[0.16em] text-amply-textMuted">
                {EQ_PRESET_LABELS[settings.eqPreset]}
              </span>
            </div>
            <select
              value={settings.eqPreset}
              onChange={(event) => {
                void setEqPreset(event.target.value as typeof settings.eqPreset);
              }}
              className="mt-2 w-full rounded-md border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
            >
              <option value="flat">Flat</option>
              <option value="warm">Warm</option>
              <option value="bass">Bass Boost</option>
              <option value="treble">Treble Lift</option>
              <option value="vocal">Vocal Focus</option>
              <option value="club">Club</option>
              <option value="custom">Custom</option>
            </select>
            <p className="mt-2 text-[11px] text-amply-textMuted">
              Presets are templates. Drag the graph or sliders below to fine-tune your own curve.
            </p>
          </div>

          <div className="rounded-lg border border-amply-border/60 bg-amply-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[12px] text-amply-textSecondary">EQ Curve</p>
                <p className="mt-1 text-[11px] text-amply-textMuted">Click or drag a node to shape the curve directly.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void setEqPreset('flat');
                }}
                className="rounded-full border border-amply-border/60 px-3 py-1.5 text-[11px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              >
                Reset
              </button>
            </div>

            <div className="mt-4">
              <EQGraphEditor
                bands={settings.eqBands}
                onChange={(next) => {
                  void setEqBands(next);
                }}
              />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              {EQ_BANDS.map((band, index) => (
                <div
                  key={band.freq}
                  className="rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.012))] px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3 sm:block">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amply-textSecondary">{band.short}</p>
                      <p className="mt-1 text-[10px] text-amply-textMuted">{band.freq}</p>
                    </div>
                    <span className="rounded-full border border-[rgba(255,138,43,0.22)] bg-[rgba(255,138,43,0.08)] px-2.5 py-1 text-[10px] font-semibold text-amply-textPrimary sm:mt-4 sm:inline-flex">
                      {settings.eqBands[index] > 0 ? '+' : ''}
                      {settings.eqBands[index].toFixed(1)} dB
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <ToggleRow
            title="Crossfade"
            description="Smoothly blend the end of a track into the next."
            checked={settings.crossfadeEnabled}
            onChange={(next) => {
              void setCrossfadeEnabled(next);
            }}
          />

          <div className="rounded-lg border border-amply-border/60 bg-amply-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-amply-textSecondary">
              <span>Crossfade Duration</span>
              <span>{settings.crossfadeDurationSec}s</span>
            </div>
            <div className="relative mt-2 h-1 w-full rounded-full bg-[#3a3a3a]">
              <div
                className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent"
                style={{ width: `${((settings.crossfadeDurationSec - 1) / 11) * 100}%` }}
              />
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={settings.crossfadeDurationSec}
                onChange={(event) => {
                  void setCrossfadeDuration(Number(event.target.value));
                }}
                className="absolute left-0 top-[-6px] h-4 w-full cursor-pointer appearance-none bg-transparent"
              />
            </div>
          </div>

          <ToggleRow
            title="Gapless Playback"
            description="Preload the next track to avoid silence."
            checked={settings.gaplessEnabled}
            onChange={(next) => {
              void setGaplessEnabled(next);
            }}
          />

          <ToggleRow
            title="Volume Normalization"
            description="Balance volume using ReplayGain when available."
            checked={settings.volumeNormalizationEnabled}
            onChange={(next) => {
              void setVolumeNormalizationEnabled(next);
            }}
          />

          <div className="rounded-lg border border-amply-border/60 bg-amply-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-amply-textSecondary">
              <span>Playback Speed</span>
              <span>{settings.playbackSpeed.toFixed(2)}x</span>
            </div>
            <div className="relative mt-2 h-1 w-full rounded-full bg-[#3a3a3a]">
              <div
                className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent"
                style={{ width: `${((settings.playbackSpeed - 0.75) / 0.75) * 100}%` }}
              />
              <input
                type="range"
                min={0.75}
                max={1.5}
                step={0.05}
                value={settings.playbackSpeed}
                onChange={(event) => {
                  void setPlaybackSpeed(Number(event.target.value));
                }}
                className="absolute left-0 top-[-6px] h-4 w-full cursor-pointer appearance-none bg-transparent"
              />
            </div>
          </div>
        </div>
        </section>

        <div className="grid gap-4">
        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
        <div className="space-y-1">
          <h2 className="text-[16px] font-bold text-amply-textPrimary">Lyrics Visuals</h2>
          <p className="text-[12px] text-amply-textSecondary">Ambient backgrounds for the lyrics view.</p>
        </div>

        <div className="mt-3 grid gap-2">
          <ToggleRow
            title="Enable Visuals"
            description="Enable ambient visuals behind lyrics."
            checked={settings.lyricsVisualsEnabled}
            onChange={(next) => {
              void setLyricsVisualsEnabled(next);
            }}
          />

          <div className="rounded-lg border border-amply-border/60 bg-amply-surface px-4 py-3">
            <p className="text-[12px] text-amply-textSecondary">Theme</p>
            <select
              value={settings.lyricsVisualTheme}
              onChange={(event) => {
                void setLyricsVisualTheme(event.target.value as typeof settings.lyricsVisualTheme);
              }}
              className="mt-2 w-full rounded-md border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
            >
              <option value="ember">Ember</option>
              <option value="aurora">Aurora</option>
              <option value="mono">Mono</option>
            </select>
          </div>
        </div>
        </section>

        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
          <div className="space-y-1">
            <h2 className="text-[16px] font-bold text-amply-textPrimary">Sleep Timer</h2>
            <p className="text-[12px] text-amply-textSecondary">Choose when playback should stop.</p>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="rounded-xl border border-amply-border/60 bg-amply-bgSecondary/35 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-amply-textMuted">Remaining</p>
                  <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                    <span className="text-[28px] font-semibold leading-none text-amply-textPrimary sm:text-[34px]">
                      {sleepTimerDisplay}
                    </span>
                    <span className="pb-1 text-[12px] text-amply-textSecondary">
                      {sleepTimerEndsAt ? `${sleepTimerRemainingMin} min left` : 'Off'}
                    </span>
                  </div>
                  <p className="mt-3 text-[11px] text-amply-textMuted">
                    {sleepTimerEndsAt
                      ? `Stops at ${new Date(sleepTimerEndsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                      : 'No active timer'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSleepTimer(null)}
                  disabled={!sleepTimerEndsAt}
                  className="inline-flex min-h-[38px] items-center justify-center rounded-full border border-amply-border/60 px-4 text-[12px] font-medium text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-amply-border/60 bg-amply-bgSecondary/35 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-amply-textMuted">Custom</p>
              <p className="mt-1 text-[12px] text-amply-textSecondary">Enter minutes up to 12 hours.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={customSleepMinutes}
                  onChange={(event) => setCustomSleepMinutes(event.target.value)}
                  placeholder="Custom minutes"
                  className="min-w-0 rounded-full border border-amply-border/60 bg-amply-bgSecondary px-4 py-2.5 text-[13px] text-amply-textPrimary outline-none transition-colors focus:border-[#ff9b46]/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    const nextMinutes = Number.parseInt(customSleepMinutes, 10);
                    if (!Number.isFinite(nextMinutes) || nextMinutes < 1) {
                      return;
                    }

                    void setSleepTimer(Math.min(nextMinutes, 720));
                    setCustomSleepMinutes('');
                  }}
                  className="inline-flex min-h-[42px] items-center justify-center rounded-full bg-[#ff8a2b] px-4 text-[12px] font-semibold text-black transition-colors hover:bg-[#ff9b46]"
                >
                  Set Timer
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-amply-textMuted">Quick Presets</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[15, 30, 45, 60].map((minutes) => {
                const isActive = sleepTimerEndsAt && sleepTimerDurationMin === minutes;

                return (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setSleepTimer(minutes)}
                    className={`rounded-full border px-4 py-2.5 text-[13px] font-medium transition-colors ${
                      isActive
                        ? 'border-[#ff9b46]/40 bg-[#ff8a2b]/10 text-amply-textPrimary'
                        : 'border-amply-border/60 bg-amply-bgSecondary/20 text-amply-textSecondary hover:bg-amply-hover hover:text-amply-textPrimary'
                    }`}
                  >
                    {minutes} min
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;


