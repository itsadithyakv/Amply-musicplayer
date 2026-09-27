import { usePlayerStore } from '@/store/playerStore';
import { Select, Toggle } from '@/components/ui';
import { useT } from '@/i18n';
import type { AppSettings } from '@/types/music';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const VisualizerSection = () => {
  const { t } = useT();
  const lyricsVisualsEnabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const lyricsVisualTheme = usePlayerStore((state) => state.settings.lyricsVisualTheme);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);

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
              void setLyricsVisualTheme(event.target.value as AppSettings['lyricsVisualTheme']);
            }}
          >
            <option value="ember">{t('settings.visualizer.theme.ember')}</option>
            <option value="aurora">{t('settings.visualizer.theme.aurora')}</option>
            <option value="mono">{t('settings.visualizer.theme.mono')}</option>
          </Select>
        </SettingField>
      </div>
    </SettingsSection>
  );
};
