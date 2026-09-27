import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Select, Slider, Toggle } from '@/components/ui';
import { isTauri } from '@/services/storageService';
import { listOutputDevices, type OutputDeviceInfo } from '@/services/audioDeviceService';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';
import { useT } from '@/i18n';

export const PlaybackSection = () => {
  const { t, tp, language } = useT();
  const formatSpeed = (value: number) =>
    `${new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}x`;
  const crossfadeDurationSec = usePlayerStore((state) => state.settings.crossfadeDurationSec);
  const crossfadeEnabled = usePlayerStore((state) => state.settings.crossfadeEnabled);
  const gaplessEnabled = usePlayerStore((state) => state.settings.gaplessEnabled);
  const outputDeviceName = usePlayerStore((state) => state.settings.outputDeviceName);
  const playbackSpeed = usePlayerStore((state) => state.settings.playbackSpeed);

  const setPlaybackSpeed = usePlayerStore((state) => state.setPlaybackSpeed);
  const setOutputDeviceName = usePlayerStore((state) => state.setOutputDeviceName);
  const setCrossfadeEnabled = usePlayerStore((state) => state.setCrossfadeEnabled);
  const setCrossfadeDuration = usePlayerStore((state) => state.setCrossfadeDuration);
  const setGaplessEnabled = usePlayerStore((state) => state.setGaplessEnabled);
  const volumeNormalization = usePlayerStore((state) => state.settings.volumeNormalization);
  const setVolumeNormalization = usePlayerStore((state) => state.setVolumeNormalization);

  const [outputDevices, setOutputDevices] = useState<OutputDeviceInfo[]>([]);

  useEffect(() => {
    let alive = true;
    if (!isTauri()) {
      return () => {
        alive = false;
      };
    }

    const load = async () => {
      const devices = await listOutputDevices();
      if (alive) {
        setOutputDevices(devices);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SettingsSection icon="volume" title={t('settings.playback.title')} description={t('settings.playback.description')}>
      <div className="grid gap-1">
        {isTauri() ? (
          <SettingField label={t('settings.playback.outputDevice')}>
            <Select
              label={t('settings.playback.device')}
              value={outputDeviceName ?? ''}
              onChange={(event) => {
                const value = event.target.value || null;
                void setOutputDeviceName(value);
              }}
            >
              <option value="">{t('settings.playback.systemDefault')}</option>
              {outputDevices.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.isDefault ? t('settings.playback.deviceDefault', { name: device.name }) : device.name}
                </option>
              ))}
            </Select>
          </SettingField>
        ) : null}

        <Toggle
          label={t('settings.playback.crossfade.label')}
          description={t('settings.playback.crossfade.description')}
          checked={crossfadeEnabled}
          onChange={(next) => {
            void setCrossfadeEnabled(next);
          }}
        />

        <SettingField
          label={t('settings.playback.crossfadeDuration.label')}
          trailing={t('settings.playback.crossfadeDuration.short', { seconds: crossfadeDurationSec })}
        >
          <Slider
            value={crossfadeDurationSec}
            min={1}
            max={12}
            step={1}
            ariaLabel={t('settings.playback.crossfadeDuration.label')}
            formatValue={(value) => tp('settings.playback.crossfadeDuration.seconds', value)}
            onChange={(value) => {
              void setCrossfadeDuration(value);
            }}
          />
        </SettingField>

        <Toggle
          label={t('settings.playback.gapless.label')}
          description={t('settings.playback.gapless.description')}
          checked={gaplessEnabled}
          onChange={(next) => {
            void setGaplessEnabled(next);
          }}
        />

        <SettingField
          label={t('settings.playback.normalization.label')}
          description={t('settings.playback.normalization.description')}
        >
          <Select
            label={t('settings.playback.normalization.level')}
            value={volumeNormalization}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'off' || next === 'track' || next === 'album') {
                void setVolumeNormalization(next);
              }
            }}
          >
            <option value="track">{t('settings.playback.normalization.track')}</option>
            <option value="album">{t('settings.playback.normalization.album')}</option>
            <option value="off">{t('settings.playback.normalization.off')}</option>
          </Select>
        </SettingField>

        <SettingField label={t('settings.playback.speed.label')} trailing={formatSpeed(playbackSpeed)}>
          <Slider
            value={playbackSpeed}
            min={0.75}
            max={1.5}
            step={0.05}
            ariaLabel={t('settings.playback.speed.label')}
            formatValue={formatSpeed}
            onChange={(value) => {
              void setPlaybackSpeed(value);
            }}
          />
        </SettingField>
      </div>
    </SettingsSection>
  );
};
