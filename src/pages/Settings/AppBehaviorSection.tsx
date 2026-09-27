import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Divider, TextInput, Toggle } from '@/components/ui';
import { useT } from '@/i18n';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const AppBehaviorSection = () => {
  const { t } = useT();
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
    <SettingsSection icon="settings" title={t('settings.behavior.title')} description={t('settings.behavior.description')}>
      <div className="grid gap-1">
        <Toggle
          label={t('settings.behavior.startup.label')}
          description={t('settings.behavior.startup.description')}
          checked={launchOnStartup}
          onChange={(next) => {
            void setLaunchOnStartup(next);
          }}
        />
        <Toggle
          label={t('settings.behavior.gameMode.label')}
          description={t('settings.behavior.gameMode.description')}
          checked={gameMode}
          onChange={(next) => {
            void setGameMode(next);
          }}
        />
        <Toggle
          label={t('settings.behavior.autoPause.label')}
          description={t('settings.behavior.autoPause.description')}
          checked={autoPauseOnFocus}
          onChange={(next) => {
            void setAutoPauseOnFocus(next);
          }}
        />
        <Toggle
          label={t('settings.behavior.ignoreFullscreen.label')}
          description={t('settings.behavior.ignoreFullscreen.description')}
          checked={autoPauseIgnoreFullscreen}
          onChange={(next) => {
            void setAutoPauseIgnoreFullscreen(next);
          }}
        />

        <Divider className="my-1" />

        <SettingField label={t('settings.behavior.ignoreApps.label')} description={t('settings.behavior.ignoreApps.description')}>
          <TextInput
            value={ignoreAppsText}
            onValueChange={setIgnoreAppsText}
            aria-label={t('settings.behavior.ignoreApps.aria')}
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
