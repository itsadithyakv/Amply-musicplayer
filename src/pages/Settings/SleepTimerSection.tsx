import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Button, Chip, Kicker, TextInput } from '@/components/ui';
import { SettingsSection } from '@/pages/Settings/SettingsSection';

const SLEEP_PRESETS_MIN = [15, 30, 45, 60] as const;
const SLEEP_MAX_MIN = 720;

export const SleepTimerSection = () => {
  const sleepTimerEndsAt = usePlayerStore((state) => state.sleepTimerEndsAt);
  const sleepTimerDurationMin = usePlayerStore((state) => state.sleepTimerDurationMin);
  const setSleepTimer = usePlayerStore((state) => state.setSleepTimer);

  const [customSleepMinutes, setCustomSleepMinutes] = useState('');
  const [timeTick, setTimeTick] = useState(Date.now());

  const sleepTimerRemainingMs = sleepTimerEndsAt ? Math.max(0, sleepTimerEndsAt - timeTick) : 0;
  const sleepTimerRemainingMin = sleepTimerEndsAt ? Math.max(0, Math.ceil(sleepTimerRemainingMs / 60000)) : 0;
  const sleepTimerDisplay = sleepTimerEndsAt
    ? sleepTimerRemainingMs < 60_000
      ? '<1m'
      : `${Math.floor(sleepTimerRemainingMs / 3_600_000)}h ${Math.floor((sleepTimerRemainingMs % 3_600_000) / 60_000)
          .toString()
          .padStart(2, '0')}m`
    : '--';

  useEffect(() => {
    if (!sleepTimerEndsAt) {
      return;
    }

    let handle: number | null = null;
    const updateTick = () => {
      const now = Date.now();
      setTimeTick(now);

      if (now >= sleepTimerEndsAt) {
        return;
      }

      const remaining = sleepTimerEndsAt - now;
      const delay = remaining <= 60_000 ? 1000 : ((remaining - 1) % 60_000) + 1;

      handle = window.setTimeout(updateTick, delay);
    };

    updateTick();

    return () => {
      if (handle !== null) {
        window.clearTimeout(handle);
      }
    };
  }, [sleepTimerEndsAt]);

  return (
    <SettingsSection icon="sleep" title="Sleep Timer" description="Choose when playback should stop.">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="neu-pressed rounded-md p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Kicker>Remaining</Kicker>
              <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                <span className="text-[28px] font-semibold leading-none tabular-nums text-amply-textPrimary sm:text-[34px]">
                  {sleepTimerDisplay}
                </span>
                <span className="pb-1 text-[12px] text-amply-textSecondary">
                  {sleepTimerEndsAt ? `${sleepTimerRemainingMin} min left` : 'Off'}
                </span>
              </div>
              <p className="mt-3 text-[12px] text-amply-textSecondary">
                {sleepTimerEndsAt
                  ? `Stops at ${new Date(sleepTimerEndsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                  : 'No active timer'}
              </p>
            </div>

            <Button onClick={() => setSleepTimer(null)} disabled={!sleepTimerEndsAt}>
              Cancel
            </Button>
          </div>
        </div>

        <div className="neu-flat rounded-md p-4">
          <Kicker>Custom</Kicker>
          <p className="mt-1 text-[12px] text-amply-textSecondary">Enter minutes up to 12 hours.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <TextInput
              type="number"
              inputMode="numeric"
              min={1}
              max={SLEEP_MAX_MIN}
              step={1}
              value={customSleepMinutes}
              onValueChange={setCustomSleepMinutes}
              placeholder="Custom minutes"
              aria-label="Custom minutes"
              className="min-w-0"
            />
            <Button
              variant="primary"
              onClick={() => {
                const nextMinutes = Number.parseInt(customSleepMinutes, 10);
                if (!Number.isFinite(nextMinutes) || nextMinutes < 1) {
                  return;
                }

                void setSleepTimer(Math.min(nextMinutes, SLEEP_MAX_MIN));
                setCustomSleepMinutes('');
              }}
            >
              Set Timer
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Kicker>Quick Presets</Kicker>
        <div className="mt-2 flex flex-wrap gap-2">
          {SLEEP_PRESETS_MIN.map((minutes) => {
            const isActive = Boolean(sleepTimerEndsAt && sleepTimerDurationMin === minutes);

            return (
              <Chip
                key={minutes}
                active={isActive}
                uppercase={false}
                className="min-h-9 px-4 text-[12px]"
                onClick={() => setSleepTimer(minutes)}
              >
                {minutes} min
              </Chip>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
};
