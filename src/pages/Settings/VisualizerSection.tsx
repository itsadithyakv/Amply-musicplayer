import { useEffectiveSetting } from '@/hooks/useEffectiveSettings';
import { isProVisualizerTheme } from '@/services/proFeatures';
import { usePlayerStore } from '@/store/playerStore';
import { requirePro, useProStore } from '@/store/proStore';
import { Select, Toggle } from '@/components/ui';
import { useT } from '@/i18n';
import type { AppSettings } from '@/types/music';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const VisualizerSection = () => {
  const { t } = useT();
  const lyricsVisualsEnabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const lyricsVisualTheme = useEffectiveSetting((settings) => settings.lyricsVisualTheme);
  const isPro = useProStore((state) => state.isPro);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);

  const proLabel = (name: string) => (isPro ? name : t('pro.option', { name }));

  return (
    <SettingsSection icon="eq" title={t('settings.visualizer.title')} description={t('settings.visualizer.description')}>
      <div className="grid gap-1">
        <Toggle
          label={t('settings.visualizer.show.label')}
          description={t('settings.visualizer.show.description')}
          checked={lyricsVisualsEnabled}
          onChange={(next) => {
            void setLyricsVisualsEnabled(next);
          }}
        />

        <SettingField label={t('settings.visualizer.style')}>
          <Select
            label={t('settings.visualizer.style')}
            value={lyricsVisualTheme}
            disabled={!lyricsVisualsEnabled}
            className={!lyricsVisualsEnabled ? 'cursor-not-allowed opacity-50' : undefined}
            onChange={(event) => {
              const next = event.target.value as AppSettings['lyricsVisualTheme'];
              if (!isProVisualizerTheme(next) || requirePro('visualizerStyles')) {
                void setLyricsVisualTheme(next);
              }
            }}
          >
            <option value="ember">{t('settings.visualizer.theme.ember')}</option>
            <option value="aurora">{proLabel(t('settings.visualizer.theme.aurora'))}</option>
            <option value="mono">{proLabel(t('settings.visualizer.theme.mono'))}</option>
          </Select>
        </SettingField>
      </div>
    </SettingsSection>
  );
};
