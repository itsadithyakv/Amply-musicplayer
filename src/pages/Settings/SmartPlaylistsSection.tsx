import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Badge, Slider, TextInput, Toggle } from '@/components/ui';
import { useT, type MessageKey } from '@/i18n';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

const clampLevel = (value: number | undefined, fallback: number): number => Math.max(0, Math.min(1, value ?? fallback));

const discoveryLabelFor = (level: number): MessageKey =>
  level < 0.2
    ? 'settings.smart.discovery.subtle'
    : level < 0.5
      ? 'settings.smart.discovery.balanced'
      : level < 0.8
        ? 'settings.smart.discovery.adventurous'
        : 'settings.smart.wild';

const randomnessLabelFor = (level: number): MessageKey =>
  level < 0.2
    ? 'settings.smart.randomness.focused'
    : level < 0.5
      ? 'settings.smart.randomness.varied'
      : level < 0.8
        ? 'settings.smart.randomness.surprising'
        : 'settings.smart.wild';

export const SmartPlaylistsSection = () => {
  const { t, language } = useT();
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

  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
  const formatLevel = (level: number, labelFor: (level: number) => MessageKey): string =>
    `${percent.format(level)} / ${t(labelFor(level))}`;

  return (
    <SettingsSection icon="sparkle" title={t('settings.smart.title')} description={t('settings.smart.description')}>
      <div className="grid gap-1">
        <SettingField
          label={t('settings.smart.discovery.label')}
          description={t('settings.smart.discovery.description')}
          trailing={formatLevel(discoveryLevel, discoveryLabelFor)}
        >
          <Slider
            value={discoveryLevel}
            min={0}
            max={1}
            step={0.05}
            ariaLabel={t('settings.smart.discovery.label')}
            formatValue={(value) => formatLevel(value, discoveryLabelFor)}
            onChange={(value) => {
              void setDiscoveryIntensity(value);
            }}
          />
        </SettingField>

        <SettingField
          label={t('settings.smart.randomness.label')}
          description={t('settings.smart.randomness.description')}
          trailing={formatLevel(randomnessLevel, randomnessLabelFor)}
        >
          <Slider
            value={randomnessLevel}
            min={0}
            max={1}
            step={0.05}
            ariaLabel={t('settings.smart.randomness.label')}
            formatValue={(value) => formatLevel(value, randomnessLabelFor)}
            onChange={(value) => {
              void setRandomnessIntensity(value);
            }}
          />
        </SettingField>

        <Toggle
          label={t('settings.smart.pauseRegen.label')}
          description={t('settings.smart.pauseRegen.description')}
          checked={pauseMixRegenDuringPlayback}
          onChange={(next) => {
            void setPauseMixRegenDuringPlayback(next);
          }}
        />
        <Toggle
          label={t('settings.smart.online.label')}
          description={t('settings.smart.online.description')}
          checked={onlineRecommendationsEnabled}
          onChange={(next) => {
            void setOnlineRecommendationsEnabled(next);
          }}
        />

        <SettingField
          label={t('settings.smart.lastFm.label')}
          description={t('settings.smart.lastFm.description')}
          trailing={
            <Badge tone={lastFmApiKey ? 'success' : 'neutral'}>
              {lastFmApiKey ? t('settings.smart.lastFm.saved') : t('settings.smart.lastFm.notSet')}
            </Badge>
          }
        >
          <TextInput
            type="password"
            autoComplete="off"
            value={lastFmApiKeyText}
            onValueChange={setLastFmApiKeyText}
            placeholder={t('settings.smart.lastFm.label')}
            aria-label={t('settings.smart.lastFm.label')}
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
