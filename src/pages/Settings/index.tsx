import { useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { clearStorageCache, pickMusicFolders } from '@/services/storageService';

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
    <label className="flex items-center justify-between gap-6 rounded-lg border border-amply-border bg-amply-bgSecondary px-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-amply-textPrimary">{title}</p>
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

  const setPlaybackSpeed = usePlayerStore((state) => state.setPlaybackSpeed);
  const setCrossfadeEnabled = usePlayerStore((state) => state.setCrossfadeEnabled);
  const setCrossfadeDuration = usePlayerStore((state) => state.setCrossfadeDuration);
  const setGaplessEnabled = usePlayerStore((state) => state.setGaplessEnabled);
  const setVolumeNormalizationEnabled = usePlayerStore((state) => state.setVolumeNormalizationEnabled);
  const setSleepTimer = usePlayerStore((state) => state.setSleepTimer);
  const setLaunchOnStartup = usePlayerStore((state) => state.setLaunchOnStartup);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);

  const [localPath, setLocalPath] = useState('');
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const startMetadataFetch = useLibraryStore((state) => state.startMetadataFetch);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  return (
    <div className="max-w-3xl space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-amply-textPrimary">Settings</h1>
        <p className="text-[13px] text-amply-textSecondary">Library scan settings and advanced playback controls.</p>
      </header>

      <section className="rounded-card border border-amply-border bg-amply-card p-4">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Music Library</h2>
        <p className="mb-4 mt-1 text-[13px] text-amply-textSecondary">
          Add one or more folders. Amply scans all folders in this list.
        </p>

        <div className="mb-4 flex gap-3">
          <input
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
            placeholder="Add folder path manually (optional)"
            className="flex-1 rounded-lg border border-amply-border bg-amply-bgSecondary px-3 py-2 text-[13px] text-amply-textPrimary outline-none focus:border-amply-accent"
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
            className="rounded-lg bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
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
            className="rounded-lg border border-amply-border px-4 py-2 text-[13px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            Browse Folders
          </button>
          <button
            type="button"
            onClick={() => {
              void scanLibrary();
            }}
            className="rounded-lg border border-amply-border px-4 py-2 text-[13px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            {isScanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>

        <div className="space-y-2">
          {libraryPaths.map((path) => (
            <div key={path} className="flex items-center justify-between rounded-md border border-amply-border bg-amply-bgSecondary px-3 py-2">
              <p className="truncate pr-4 text-[13px] text-amply-textSecondary">{path}</p>
              <button
                type="button"
                onClick={() => {
                  void removeLibraryPath(path);
                }}
                className="rounded-md border border-amply-border px-2 py-1 text-[12px] text-amply-textMuted transition-colors hover:bg-amply-hover hover:text-amply-textPrimary"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-card border border-amply-border bg-amply-card p-4">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Library Data</h2>
        <p className="mt-1 text-[13px] text-amply-textSecondary">
          Fetch artist info, lyrics, and genres for all songs, or clear cached data.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={metadataFetch.running}
            onClick={() => {
              setBulkMessage(null);
              startMetadataFetch();
            }}
            className="rounded-md bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {metadataFetch.running ? 'Fetching...' : 'Fetch All Metadata'}
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
            className="rounded-md border border-amply-border px-4 py-2 text-[13px] text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {clearingCache ? 'Clearing...' : 'Clear Cache & Stored Data'}
          </button>
        </div>

        {metadataFetch.running ? (
          <p className="mt-3 text-[12px] text-amply-textMuted">
            Processed {metadataFetch.done}/{metadataFetch.total} songs - Artists {metadataFetch.artists} - Lyrics {metadataFetch.lyrics} - Genres {metadataFetch.genres}
          </p>
        ) : null}

        {metadataFetch.message || bulkMessage ? (
          <p className="mt-3 text-[12px] text-amply-textMuted">{metadataFetch.message ?? bulkMessage}</p>
        ) : null}
      </section>

      <section className="rounded-card border border-amply-border bg-amply-card p-4">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">App Behavior</h2>
        <p className="mt-1 text-[13px] text-amply-textSecondary">Control how Amply launches and behaves on startup.</p>

        <div className="mt-4 grid gap-3">
          <ToggleRow
            title="Launch on System Startup"
            description="Start Amply automatically when your system boots."
            checked={settings.launchOnStartup}
            onChange={(next) => {
              void setLaunchOnStartup(next);
            }}
          />
        </div>
      </section>

      <section className="rounded-card border border-amply-border bg-amply-card p-4">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Advanced Playback</h2>

        <div className="mt-4 grid gap-3">
          <ToggleRow
            title="Crossfade"
            description="Smoothly blend the end of a track into the next."
            checked={settings.crossfadeEnabled}
            onChange={(next) => {
              void setCrossfadeEnabled(next);
            }}
          />

          <div className="rounded-lg border border-amply-border bg-amply-bgSecondary px-4 py-3">
            <div className="flex items-center justify-between text-[13px] text-amply-textSecondary">
              <span>Crossfade Duration</span>
              <span>{settings.crossfadeDurationSec}s</span>
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={settings.crossfadeDurationSec}
              onChange={(event) => {
                void setCrossfadeDuration(Number(event.target.value));
              }}
              className="mt-2 h-1 w-full cursor-pointer accent-amply-accent"
            />
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

          <div className="rounded-lg border border-amply-border bg-amply-bgSecondary px-4 py-3">
            <div className="flex items-center justify-between text-[13px] text-amply-textSecondary">
              <span>Playback Speed</span>
              <span>{settings.playbackSpeed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={settings.playbackSpeed}
              onChange={(event) => {
                void setPlaybackSpeed(Number(event.target.value));
              }}
              className="mt-2 h-1 w-full cursor-pointer accent-amply-accent"
            />
          </div>
        </div>
      </section>

      <section className="rounded-card border border-amply-border bg-amply-card p-4">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Lyrics Visuals</h2>
        <p className="mt-1 text-[13px] text-amply-textSecondary">Ambient backgrounds for the lyrics view.</p>

        <div className="mt-4 grid gap-3">
          <ToggleRow
            title="Enable Visuals"
            description="Enable ambient visuals behind lyrics."
            checked={settings.lyricsVisualsEnabled}
            onChange={(next) => {
              void setLyricsVisualsEnabled(next);
            }}
          />

          <div className="rounded-lg border border-amply-border bg-amply-bgSecondary px-4 py-3">
            <p className="text-[13px] text-amply-textSecondary">Theme</p>
            <select
              value={settings.lyricsVisualTheme}
              onChange={(event) => {
                void setLyricsVisualTheme(event.target.value as typeof settings.lyricsVisualTheme);
              }}
              className="mt-2 w-full rounded-md border border-amply-border bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
            >
              <option value="ember">Ember</option>
              <option value="aurora">Aurora</option>
              <option value="mono">Mono</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-card border border-amply-border bg-amply-card p-4">
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Sleep Timer</h2>
        <p className="mt-1 text-[13px] text-amply-textSecondary">Stop playback automatically after a selected duration.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {[15, 30, 45, 60].map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => setSleepTimer(minutes)}
              className="rounded-md border border-amply-border px-3 py-2 text-[13px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
            >
              {minutes}m
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSleepTimer(null)}
            className="rounded-md bg-amply-accent px-3 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
          >
            Cancel Timer
          </button>
        </div>

        {sleepTimerEndsAt ? (
          <p className="mt-3 text-[12px] text-amply-textMuted">Timer ends at {new Date(sleepTimerEndsAt).toLocaleTimeString()}</p>
        ) : (
          <p className="mt-3 text-[12px] text-amply-textMuted">No active sleep timer.</p>
        )}
      </section>
    </div>
  );
};

export default SettingsPage;
