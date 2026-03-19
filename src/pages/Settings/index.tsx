import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import {
  clearStorageCache,
  getStorageStats,
  isTauri,
  openStorageDir,
  pickMusicFolders,
  type StorageStats,
} from '@/services/storageService';
import { listOutputDevices, type OutputDeviceInfo } from '@/services/audioDeviceService';

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
    <label className="flex items-center justify-between gap-6 rounded-xl border border-amply-border/60 bg-amply-surface px-4 py-3 shadow-card">
      <div>
        <p className="text-[13px] font-semibold text-amply-textPrimary">{title}</p>
        {description ? <p className="mt-1 text-[11px] text-amply-textMuted">{description}</p> : null}
      </div>
      <span className="relative inline-flex items-center">
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
  const setCrossfadeEnabled = usePlayerStore((state) => state.setCrossfadeEnabled);
  const setCrossfadeDuration = usePlayerStore((state) => state.setCrossfadeDuration);
  const setGaplessEnabled = usePlayerStore((state) => state.setGaplessEnabled);
  const setVolumeNormalizationEnabled = usePlayerStore((state) => state.setVolumeNormalizationEnabled);
  const setSleepTimer = usePlayerStore((state) => state.setSleepTimer);
  const setLaunchOnStartup = usePlayerStore((state) => state.setLaunchOnStartup);
  const setCloseToTaskbar = usePlayerStore((state) => state.setCloseToTaskbar);
  const setGameMode = usePlayerStore((state) => state.setGameMode);
  const setMiniNowPlayingOverlay = usePlayerStore((state) => state.setMiniNowPlayingOverlay);
  const setOverlayAutoHide = usePlayerStore((state) => state.setOverlayAutoHide);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);

  const [localPath, setLocalPath] = useState('');
  const [timeTick, setTimeTick] = useState(Date.now());
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const startMetadataFetch = useLibraryStore((state) => state.startMetadataFetch);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const songs = useLibraryStore((state) => state.songs);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [outputDevices, setOutputDevices] = useState<OutputDeviceInfo[]>([]);
  const sleepTimerRemainingMs = sleepTimerEndsAt ? Math.max(0, sleepTimerEndsAt - timeTick) : 0;
  const sleepTimerRemainingMin = sleepTimerEndsAt ? Math.max(0, Math.ceil(sleepTimerRemainingMs / 60000)) : 0;
  const sleepTimerProgress =
    sleepTimerEndsAt && sleepTimerDurationMin
      ? Math.min(100, Math.max(0, (sleepTimerRemainingMs / (sleepTimerDurationMin * 60_000)) * 100))
      : 0;

  const totalSongs = songs.length || 1;
  const lyricsProgress = storageStats ? Math.min(100, (storageStats.lyricsFiles / totalSongs) * 100) : 0;
  const artistProgress = storageStats ? Math.min(100, (storageStats.artistFiles / totalSongs) * 100) : 0;
  const metadataProgress = storageStats ? Math.min(100, (storageStats.metadataFiles / totalSongs) * 100) : 0;

  const statusItems = useMemo(
    () => [
      { label: 'Lyrics Cache', count: storageStats?.lyricsFiles ?? 0, progress: lyricsProgress },
      { label: 'Artist Cache', count: storageStats?.artistFiles ?? 0, progress: artistProgress },
      { label: 'Metadata Cache', count: storageStats?.metadataFiles ?? 0, progress: metadataProgress },
      { label: 'Playlists', count: storageStats?.playlistsFiles ?? 0, progress: 100 },
    ],
    [storageStats, lyricsProgress, artistProgress, metadataProgress],
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setStatsLoading(true);
      try {
        const stats = await getStorageStats();
        if (alive) {
          setStorageStats(stats);
        }
      } finally {
        if (alive) {
          setStatsLoading(false);
        }
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
    const handle = window.setInterval(() => {
      setTimeTick(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(handle);
    };
  }, [sleepTimerEndsAt]);

  return (
    <div className="space-y-4 pb-8">
      <header className="space-y-1">
        <h1 className="text-[26px] font-bold tracking-tight text-amply-textPrimary">Settings</h1>
        <p className="text-[12px] text-amply-textSecondary">Library, playback, and app behavior.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card">
        <div className="space-y-1">
          <h2 className="text-[16px] font-bold text-amply-textPrimary">Music Library</h2>
          <p className="text-[12px] text-amply-textSecondary">
            Add one or more folders. Amply scans all folders in this list.
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
            placeholder="Add folder path manually (optional)"
            className="min-w-[220px] flex-1 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
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
            className="rounded-full bg-amply-accent px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
          >
            Add Path
          </button>
          <button
            type="button"
            onClick={async () => {
              const picked = await pickMusicFolders();
              if (picked.length) {
                const merged = Array.from(new Set([...libraryPaths, ...picked]));
                await setLibraryPaths(merged);
              }
            }}
            className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            Browse Folders
          </button>
          <button
            type="button"
            onClick={() => {
              void scanLibrary();
            }}
            className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            {isScanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>

        <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {libraryPaths.map((path) => (
            <div key={path} className="flex items-center justify-between rounded-lg border border-amply-border/60 bg-amply-surface px-3 py-2">
              <p className="truncate pr-4 text-[12px] text-amply-textSecondary">{path}</p>
              <button
                type="button"
                onClick={() => {
                  void removeLibraryPath(path);
                }}
                className="rounded-md border border-amply-border/60 px-2 py-1 text-[12px] text-amply-textMuted transition-colors hover:bg-amply-hover hover:text-amply-textPrimary"
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={metadataFetch.running}
            onClick={() => {
              setBulkMessage(null);
              startMetadataFetch();
            }}
            className="rounded-full bg-amply-accent px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {metadataFetch.running ? 'Fetching...' : 'Fetch Missing Metadata'}
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
            className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {clearingCache ? 'Clearing...' : 'Clear Cache & Stored Data'}
          </button>
          <button
            type="button"
            onClick={() => {
              void openStorageDir();
            }}
            className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            Open Storage
          </button>
          <button
            type="button"
            onClick={async () => {
              setStatsLoading(true);
              const stats = await getStorageStats();
              setStorageStats(stats);
              setStatsLoading(false);
            }}
            className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            {statsLoading ? 'Refreshing...' : 'Refresh Status'}
          </button>
        </div>

        {metadataFetch.running && metadataFetch.total > 0 ? (
          <div className="mt-3 rounded-lg border border-amply-border/60 bg-amply-surface px-3 py-2 text-[12px] text-amply-textMuted">
            Processed {metadataFetch.done}/{metadataFetch.total} pending songs - Artists {metadataFetch.artists} - Lyrics {metadataFetch.lyrics} - Genres {metadataFetch.genres}
          </div>
        ) : null}

        {metadataFetch.message || bulkMessage ? (
          <div className="mt-3 rounded-lg border border-amply-border/60 bg-amply-surface px-3 py-2 text-[12px] text-amply-textMuted">
            {metadataFetch.message ?? bulkMessage}
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-amply-border/60 bg-amply-bgSecondary/40 p-4">
          <div className="flex items-center justify-between">
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
              <p className="text-[11px] text-amply-textMuted">Storage path: {storageStats.storagePath}</p>
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
            title="Close to Tray"
            description="Keep Amply running in the tray when you close the window."
            checked={settings.closeToTaskbar}
            onChange={(next) => {
              void setCloseToTaskbar(next);
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
            <p className="text-[12px] text-amply-textSecondary">EQ Preset</p>
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
            </select>
            <p className="mt-2 text-[11px] text-amply-textMuted">
              EQ presets are applied in the native engine.
            </p>
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
            <div className="flex items-center justify-between text-[12px] text-amply-textSecondary">
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
            <div className="flex items-center justify-between text-[12px] text-amply-textSecondary">
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
          <p className="text-[12px] text-amply-textSecondary">Stop playback automatically after a selected duration.</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[15, 30, 45, 60].map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => setSleepTimer(minutes)}
              className="rounded-full border border-amply-border/60 px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
            >
              {minutes}m
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSleepTimer(null)}
            className="rounded-full bg-amply-accent px-3 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
          >
            Cancel Timer
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-amply-border/60 bg-amply-bgSecondary/40 px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-amply-textMuted">
            <span>Time left</span>
            <span>{sleepTimerEndsAt ? `${sleepTimerRemainingMin} min` : '—'}</span>
          </div>
          <div className="relative mt-2 h-1 rounded-full bg-[#3a3a3a]">
            <div className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent" style={{ width: `${sleepTimerProgress}%` }} />
          </div>
        </div>

        {sleepTimerEndsAt ? (
          <p className="mt-3 text-[11px] text-amply-textMuted">Timer ends at {new Date(sleepTimerEndsAt).toLocaleTimeString()}</p>
        ) : (
          <p className="mt-3 text-[11px] text-amply-textMuted">No active sleep timer.</p>
        )}
        </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

