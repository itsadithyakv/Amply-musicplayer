import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Select, Slider, Toggle } from '@/components/ui';
import { isTauri } from '@/services/storageService';
import { listOutputDevices, type OutputDeviceInfo } from '@/services/audioDeviceService';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

export const PlaybackSection = () => {
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
    <SettingsSection icon="volume" title="Advanced Playback" description="Routing, fades, and playback speed.">
      <div className="grid gap-1">
        {isTauri() ? (
          <SettingField label="Output Device" icon="volume">
            <Select
              label="Device"
              value={outputDeviceName ?? ''}
              onChange={(event) => {
                const value = event.target.value || null;
                void setOutputDeviceName(value);
              }}
            >
              <option value="">System Default</option>
              {outputDevices.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.name}
                  {device.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </Select>
          </SettingField>
        ) : null}

        <Toggle
          icon="shuffle"
          label="Crossfade"
          description="Blend tracks into each other."
          checked={crossfadeEnabled}
          onChange={(next) => {
            void setCrossfadeEnabled(next);
          }}
        />

        <SettingField label="Crossfade Duration" trailing={`${crossfadeDurationSec}s`}>
          <Slider
            value={crossfadeDurationSec}
            min={1}
            max={12}
            step={1}
            ariaLabel="Crossfade duration"
            formatValue={(value) => `${value} seconds`}
            onChange={(value) => {
              void setCrossfadeDuration(value);
            }}
          />
        </SettingField>

        <Toggle
          icon="next"
          label="Gapless Playback"
          description="Preload the next track."
          checked={gaplessEnabled}
          onChange={(next) => {
            void setGaplessEnabled(next);
          }}
        />

        <SettingField label="Playback Speed" icon="speed" trailing={`${playbackSpeed.toFixed(2)}x`}>
          <Slider
            value={playbackSpeed}
            min={0.75}
            max={1.5}
            step={0.05}
            ariaLabel="Playback speed"
            formatValue={(value) => `${value.toFixed(2)}x`}
            onChange={(value) => {
              void setPlaybackSpeed(value);
            }}
          />
        </SettingField>
      </div>
    </SettingsSection>
  );
};
