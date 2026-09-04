import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Divider, TextInput, Toggle } from '@/components/ui';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const AppBehaviorSection = () => {
  const autoPauseIgnoreApps = usePlayerStore((state) => state.settings.autoPauseIgnoreApps);
  const autoPauseIgnoreFullscreen = usePlayerStore((state) => state.settings.autoPauseIgnoreFullscreen);
  const autoPauseOnFocus = usePlayerStore((state) => state.settings.autoPauseOnFocus);
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const launchOnStartup = usePlayerStore((state) => state.settings.launchOnStartup);

  const setLaunchOnStartup = usePlayerStore((state) => state.setLaunchOnStartup);
  const setGameMode = usePlayerStore((state) => state.setGameMode);
  const setAutoPauseOnFocus = usePlayerStore((state) => state.setAutoPauseOnFocus);
  const setAutoPauseIgnoreApps = usePlayerStore((state) => state.setAutoPauseIgnoreApps);
  const setAutoPauseIgnoreFullscreen = usePlayerStore((state) => state.setAutoPauseIgnoreFullscreen);

  const [ignoreAppsText, setIgnoreAppsText] = useState(autoPauseIgnoreApps.join(', '));

  useEffect(() => {
    setIgnoreAppsText(autoPauseIgnoreApps.join(', '));
  }, [autoPauseIgnoreApps]);

  return (
    <SettingsSection icon="settings" title="App Behavior" description="Launch and focus behavior.">
      <div className="grid gap-1">
        <Toggle
          label="Launch on System Startup"
          description="Open Amply when your system starts."
          checked={launchOnStartup}
          onChange={(next) => {
            void setLaunchOnStartup(next);
          }}
        />
        <Toggle
          label="Game Mode"
          description="Lean mode with fewer heavy panels."
          checked={gameMode}
          onChange={(next) => {
            void setGameMode(next);
          }}
        />
        <Toggle
          label="Auto-pause for Other Audio (Windows)"
          description="Pause for other audio, then resume."
          checked={autoPauseOnFocus}
          onChange={(next) => {
            void setAutoPauseOnFocus(next);
          }}
        />
        <Toggle
          label="Ignore Fullscreen Apps"
          description="Keep playing while fullscreen apps are active."
          checked={autoPauseIgnoreFullscreen}
          onChange={(next) => {
            void setAutoPauseIgnoreFullscreen(next);
          }}
        />

        <Divider className="my-1" />

        <SettingField
          label="Ignore These Apps"
          description={'Comma-separated process names, e.g. "eldenring.exe, valorant.exe".'}
        >
          <TextInput
            value={ignoreAppsText}
            onValueChange={setIgnoreAppsText}
            aria-label="Ignored apps"
            placeholder="eldenring.exe, valorant.exe"
            onBlur={() => {
              const list = ignoreAppsText
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
              void setAutoPauseIgnoreApps(list);
            }}
          />
        </SettingField>
      </div>
    </SettingsSection>
  );
};
