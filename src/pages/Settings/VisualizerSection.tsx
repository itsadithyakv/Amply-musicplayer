import { usePlayerStore } from '@/store/playerStore';
import { Select, Toggle } from '@/components/ui';
import type { AppSettings } from '@/types/music';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const VisualizerSection = () => {
  const lyricsVisualsEnabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const lyricsVisualTheme = usePlayerStore((state) => state.settings.lyricsVisualTheme);
  const setLyricsVisualsEnabled = usePlayerStore((state) => state.setLyricsVisualsEnabled);
  const setLyricsVisualTheme = usePlayerStore((state) => state.setLyricsVisualTheme);

  return (
    <SettingsSection icon="eq" title="Audio Visualizer" description="Live spectrum rising out of the player bar while music plays.">
      <div className="grid gap-1">
        <Toggle
          label="Show visualizer"
          description="Draws the current track's spectrum above the player bar."
          checked={lyricsVisualsEnabled}
          onChange={(next) => {
            void setLyricsVisualsEnabled(next);
          }}
        />

        <SettingField label="Style">
          <Select
            label="Style"
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
