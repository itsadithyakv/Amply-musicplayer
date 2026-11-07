import { useEffect, useState } from 'react';
import { LockedRow } from '@/components/Pro/ProGate';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore } from '@/store/proStore';
import { Divider, TextInput, Toggle } from '@/components/ui';
import { useT, type MessageKey } from '@/i18n';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

/** Mirrors useGlobalShortcuts. */
const SHORTCUTS: ReadonlyArray<readonly [string[], MessageKey]> = [
  [['Space'], 'settings.shortcuts.playPause'],
  [['←', '→'], 'settings.shortcuts.seek'],
  [['Shift + ←', 'Shift + →'], 'settings.shortcuts.track'],
  [['↑', '↓'], 'settings.shortcuts.volume'],
  [['M'], 'settings.shortcuts.mute'],
];

export const AppBehaviorSection = () => {
  const { t } = useT();
  const autoPauseIgnoreApps = usePlayerStore((state) => state.settings.autoPauseIgnoreApps);
  const autoPauseIgnoreFullscreen = usePlayerStore((state) => state.settings.autoPauseIgnoreFullscreen);
  const autoPauseOnFocus = usePlayerStore((state) => state.settings.autoPauseOnFocus);
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const isPro = useProStore((state) => state.isPro);
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
        {isPro ? (
          <Toggle
            label={t('settings.behavior.gameMode.label')}
            description={t('settings.behavior.gameMode.description')}
            checked={gameMode}
            onChange={(next) => {
              void setGameMode(next);
            }}
          />
        ) : (
          <LockedRow feature="gameMode" />
        )}
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

        <Divider className="my-1" />

        <SettingField label={t('settings.shortcuts.title')}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={action} className="contents">
                <dt className="flex flex-wrap gap-1">
                  {keys.map((key) => (
                    <kbd key={key} className="neu-pressed-sm rounded-sm px-1.5 py-0.5 font-sans text-[11px] text-amply-textPrimary">
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="text-amply-textSecondary">{t(action)}</dd>
              </div>
            ))}
          </dl>
        </SettingField>
      </div>
    </SettingsSection>
  );
};
