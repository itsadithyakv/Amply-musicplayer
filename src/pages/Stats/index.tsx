import { useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, SegmentedTabs } from '@/components/ui';
import { usePersistedPreference } from '@/hooks/usePersistedPreference';
import { oneOf } from '@/services/preferences';
import {
  computeListeningStats,
  formatListeningTime,
  type RankedEntry,
  type StatsRange,
} from '@/services/listeningStats';
import type { ListeningEvent } from '@/services/mixEngine/types';
import { useT } from '@/i18n';
import { getListeningEvents, loadListeningHistory, useLibraryStore } from '@/store/libraryStore';
import { ColumnChart, type Column } from './ColumnChart';

const isStatsRange = oneOf<StatsRange>(['7d', '30d', 'all']);

const StatTile = ({ label, value }: { label: string; value: string }) => (
  <Card padding="md" className="min-w-0">
    <p className="text-[12px] text-amply-textSecondary">{label}</p>
    <p className="mt-1 truncate text-[24px] font-semibold text-amply-textPrimary">{value}</p>
  </Card>
);

/** A ranked list: label, a bar sized to the leader, the value at the bar's tip in text ink. */
const RankedList = ({ title, entries }: { title: string; entries: RankedEntry[] }) => {
  const { t, tp } = useT();
  const leader = entries[0]?.plays ?? 0;
  return (
    <Card padding="md" className="min-w-0">
      <h3 className="mb-3 text-[13px] font-semibold text-amply-textPrimary">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-[12px] text-amply-textMuted">{t('stats.top.empty')}</p>
      ) : (
        <ol className="grid gap-2.5">
          {entries.map((entry, index) => (
            <li key={entry.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-[12px] text-amply-textPrimary">
                  <span className="mr-1.5 tabular-nums text-amply-textMuted">{index + 1}</span>
                  {entry.label}
                  {entry.sublabel ? <span className="text-amply-textMuted"> · {entry.sublabel}</span> : null}
                </p>
                <span className="shrink-0 text-[12px] tabular-nums text-amply-textSecondary">
                  {tp('stats.plays', entry.plays)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full" aria-hidden>
                <div className="h-full rounded-full bg-amply-chart" style={{ width: `${leader ? Math.max(2, (entry.plays / leader) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
};

const dayLabel = (day: string, long: boolean, language: string) => {
  const date = new Date(`${day}T12:00:00`);
  return date.toLocaleDateString(language, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric' });
};

const StatsPage = () => {
  const { t, tp, language } = useT();
  const compact = useMemo(() => new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }), [language]);
  const [range, setRange] = usePersistedPreference<StatsRange>('stats.range', isStatsRange, '30d');
  // Recompute when plays are recorded or the library changes.
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const [now] = useState(() => Date.now());
  // The log loads lazily; take what is in memory now and swap in the stored log once it is read.
  const [events, setEvents] = useState<readonly ListeningEvent[]>(() => getListeningEvents());
  useEffect(() => {
    let alive = true;
    void loadListeningHistory().then((loaded) => {
      if (alive) {
        setEvents([...loaded]);
      }
    });
    return () => {
      alive = false;
    };
  }, [activityVersion]);

  const stats = useMemo(
    () => computeListeningStats(events, useLibraryStore.getState().getSongsById(), range, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, range, now, libraryVersion],
  );

  const dayColumns: Column[] = stats.byDay.map((entry, index) => ({
    label: dayLabel(entry.day, true, language),
    tick: stats.byDay.length <= 7 || index % 5 === 4 || index === stats.byDay.length - 1 ? dayLabel(entry.day, stats.byDay.length <= 7, language) : '',
    value: entry.sec,
    display: formatListeningTime(entry.sec),
  }));
  const hourColumns: Column[] = stats.byHour.map((plays, hour) => ({
    label: `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`,
    tick: hour % 6 === 0 ? `${String(hour).padStart(2, '0')}:00` : '',
    value: plays,
    display: tp('stats.plays', plays),
  }));
  const empty = stats.plays === 0 && stats.totalSec === 0;

  return (
    <div className="min-w-0 space-y-5 pb-8">
      <PageHeader title={t('stats.title')} description={t('stats.description')} />

      <SegmentedTabs
        ariaLabel={t('stats.range.label')}
        value={range}
        onChange={setRange}
        tabs={[
          { label: t('stats.range.7d'), value: '7d' },
          { label: t('stats.range.30d'), value: '30d' },
          { label: t('stats.range.all'), value: 'all' },
        ]}
      />

      {empty ? (
        <Card padding="lg">
          <p className="text-[14px] font-semibold text-amply-textPrimary">{t('stats.empty.title')}</p>
          <p className="mt-1 text-[13px] text-amply-textSecondary">{t('stats.empty.body')}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))]">
            {/* The hero figure gets a row of its own until there is room beside it; it never wraps. */}
            <Card padding="md" className="col-span-2 min-w-0 md:col-span-4 2xl:col-span-1">
              <p className="text-[12px] text-amply-textSecondary">{t('stats.tiles.listeningTime')}</p>
              <p className="mt-1 whitespace-nowrap text-[48px] font-semibold leading-none text-amply-textPrimary">{formatListeningTime(stats.totalSec)}</p>
            </Card>
            <StatTile label={t('stats.tiles.plays')} value={compact.format(stats.plays)} />
            <StatTile label={t('stats.tiles.songs')} value={compact.format(stats.songs)} />
            <StatTile label={t('stats.tiles.artists')} value={compact.format(stats.artists)} />
            <StatTile label={t('stats.tiles.streak')} value={tp('stats.days', stats.streakDays)} />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Card padding="md" className="min-w-0">
              <ColumnChart title={range === 'all' ? t('stats.charts.perDayLast30') : t('stats.charts.perDay')} columns={dayColumns} />
            </Card>
            <Card padding="md" className="min-w-0">
              <ColumnChart title={t('stats.charts.byHour')} columns={hourColumns} />
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <RankedList title={t('stats.top.songs')} entries={stats.topSongs} />
            <RankedList title={t('stats.top.artists')} entries={stats.topArtists} />
            <RankedList title={t('stats.top.genres')} entries={stats.topGenres} />
          </div>
        </>
      )}
    </div>
  );
};

export default StatsPage;
