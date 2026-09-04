import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Badge, Slider, TextInput, Toggle } from '@/components/ui';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

const clampLevel = (value: number | undefined, fallback: number): number => Math.max(0, Math.min(1, value ?? fallback));

const discoveryLabelFor = (level: number): string =>
  level < 0.2 ? 'Subtle' : level < 0.5 ? 'Balanced' : level < 0.8 ? 'Adventurous' : 'Wild';

const randomnessLabelFor = (level: number): string =>
  level < 0.2 ? 'Focused' : level < 0.5 ? 'Varied' : level < 0.8 ? 'Surprising' : 'Wild';

const formatLevel = (level: number, labelFor: (level: number) => string): string =>
  `${Math.round(level * 100)}% / ${labelFor(level)}`;

export const SmartPlaylistsSection = () => {
  const discoveryIntensity = usePlayerStore((state) => state.settings.discoveryIntensity);
  const randomnessIntensity = usePlayerStore((state) => state.settings.randomnessIntensity);
  const pauseMixRegenDuringPlayback = usePlayerStore((state) => state.settings.pauseMixRegenDuringPlayback);
  const onlineRecommendationsEnabled = usePlayerStore((state) => state.settings.onlineRecommendationsEnabled);
  const lastFmApiKey = usePlayerStore((state) => state.settings.lastFmApiKey);

  const setDiscoveryIntensity = usePlayerStore((state) => state.setDiscoveryIntensity);
  const setRandomnessIntensity = usePlayerStore((state) => state.setRandomnessIntensity);
  const setPauseMixRegenDuringPlayback = usePlayerStore((state) => state.setPauseMixRegenDuringPlayback);
  const setOnlineRecommendationsEnabled = usePlayerStore((state) => state.setOnlineRecommendationsEnabled);
  const setLastFmApiKey = usePlayerStore((state) => state.setLastFmApiKey);

  const [lastFmApiKeyText, setLastFmApiKeyText] = useState(lastFmApiKey ?? '');

  useEffect(() => {
    setLastFmApiKeyText(lastFmApiKey ?? '');
  }, [lastFmApiKey]);

  const discoveryLevel = clampLevel(discoveryIntensity, 0.35);
  const randomnessLevel = clampLevel(randomnessIntensity, 0.3);

  return (
    <SettingsSection icon="sparkle" title="Smart Playlists" description="Control discovery and mix variation.">
      <div className="grid gap-1">
        <SettingField
          label="Discovery Intensity"
          description="Higher values surface more low-play and forgotten tracks."
          trailing={formatLevel(discoveryLevel, discoveryLabelFor)}
        >
          <Slider
            value={discoveryLevel}
            min={0}
            max={1}
            step={0.05}
            ariaLabel="Discovery intensity"
            formatValue={(value) => formatLevel(value, discoveryLabelFor)}
            onChange={(value) => {
              void setDiscoveryIntensity(value);
            }}
          />
        </SettingField>

        <SettingField
          label="Randomness"
          description="Higher values reduce repeats and bias toward less-played songs."
          trailing={formatLevel(randomnessLevel, randomnessLabelFor)}
        >
          <Slider
            value={randomnessLevel}
            min={0}
            max={1}
            step={0.05}
            ariaLabel="Randomness"
            formatValue={(value) => formatLevel(value, randomnessLabelFor)}
            onChange={(value) => {
              void setRandomnessIntensity(value);
            }}
          />
        </SettingField>

        <Toggle
          label="Pause Mix Regen During Playback"
          description="Skip heavy mix updates while music plays."
          checked={pauseMixRegenDuringPlayback}
          onChange={(next) => {
            void setPauseMixRegenDuringPlayback(next);
          }}
        />
        <Toggle
          label="Online Recommendations"
          description="Use cached Last.fm and MusicBrainz signals in idle background jobs."
          checked={onlineRecommendationsEnabled}
          onChange={(next) => {
            void setOnlineRecommendationsEnabled(next);
          }}
        />

        <SettingField
          label="Last.fm API Key"
          description="Optional. MusicBrainz remains available without a key."
          trailing={<Badge tone={lastFmApiKey ? 'success' : 'neutral'}>{lastFmApiKey ? 'Saved' : 'Not Set'}</Badge>}
        >
          <TextInput
            type="password"
            autoComplete="off"
            value={lastFmApiKeyText}
            onValueChange={setLastFmApiKeyText}
            placeholder="Last.fm API key"
            aria-label="Last.fm API key"
            onBlur={() => {
              if (lastFmApiKeyText !== (lastFmApiKey ?? '')) {
                void setLastFmApiKey(lastFmApiKeyText);
              }
            }}
          />
        </SettingField>
      </div>
    </SettingsSection>
  );
};
