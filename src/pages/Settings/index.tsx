import { useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { pickMusicFolders } from '@/services/storageService';

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

  const [localPath, setLocalPath] = useState('');

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
        <h2 className="text-[18px] font-bold text-amply-textPrimary">Advanced Playback</h2>

        <div className="mt-4 grid gap-4">
          <label className="flex items-center justify-between text-[13px] text-amply-textSecondary">
            <span>Crossfade</span>
            <input
              type="checkbox"
              checked={settings.crossfadeEnabled}
              onChange={(event) => {
                void setCrossfadeEnabled(event.target.checked);
              }}
              className="h-4 w-4 accent-amply-accent"
            />
          </label>

          <label className="space-y-1 text-[13px] text-amply-textSecondary">
            <div className="flex items-center justify-between">
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
              className="h-1 w-full cursor-pointer accent-amply-accent"
            />
          </label>

          <label className="flex items-center justify-between text-[13px] text-amply-textSecondary">
            <span>Gapless Playback</span>
            <input
              type="checkbox"
              checked={settings.gaplessEnabled}
              onChange={(event) => {
                void setGaplessEnabled(event.target.checked);
              }}
              className="h-4 w-4 accent-amply-accent"
            />
          </label>

          <label className="flex items-center justify-between text-[13px] text-amply-textSecondary">
            <span>Volume Normalization</span>
            <input
              type="checkbox"
              checked={settings.volumeNormalizationEnabled}
              onChange={(event) => {
                void setVolumeNormalizationEnabled(event.target.checked);
              }}
              className="h-4 w-4 accent-amply-accent"
            />
          </label>

          <label className="space-y-1 text-[13px] text-amply-textSecondary">
            <div className="flex items-center justify-between">
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
              className="h-1 w-full cursor-pointer accent-amply-accent"
            />
          </label>
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
