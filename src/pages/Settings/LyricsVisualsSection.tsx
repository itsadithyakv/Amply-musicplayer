import { usePlayerStore } from '@/store/playerStore';
import { Select, Toggle } from '@/components/ui';
import type { AppSettings } from '@/types/music';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const LyricsVisualsSection = () => {
  const lyricsVisualsEnabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const lyricsVisualTheme = usePlayerStore((state) => state.settings.lyricsVisualTheme);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);

  return (
    <SettingsSection icon="lyrics" title="Lyrics Visuals" description="Ambient visuals for the lyrics view.">
      <div className="grid gap-1">
        <Toggle
          icon="lyrics"
          label="Enable Visuals"
          description="Show animated backgrounds behind lyrics."
          checked={lyricsVisualsEnabled}
          onChange={(next) => {
            void setLyricsVisualsEnabled(next);
          }}
        />

        <SettingField label="Theme" icon="sparkle">
          <Select
            label="Theme"
            value={lyricsVisualTheme}
            disabled={!lyricsVisualsEnabled}
            className={!lyricsVisualsEnabled ? 'cursor-not-allowed opacity-50' : undefined}
            onChange={(event) => {
              void setLyricsVisualTheme(event.target.value as AppSettings['lyricsVisualTheme']);
            }}
          >
            <option value="ember">Ember · Spectrum</option>
            <option value="aurora">Aurora · Wave</option>
            <option value="mono">Mono · Orbit</option>
          </Select>
        </SettingField>
      </div>
    </SettingsSection>
  );
};
