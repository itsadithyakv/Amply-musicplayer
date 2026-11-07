import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { Button, Icon, IconButton, Modal, Select } from '@/components/ui';
import { formatNumber, useT, type MessageKey } from '@/i18n';
import { renderEncoreCard, saveEncoreCard } from '@/services/encoreImage';
import { safeFileName } from '@/services/fileDialogs';
import { computeEncore, MIN_ENCORE_PLAYS, type Encore, type EncoreEntry, type ListeningPersona, type YearLog } from '@/services/yearInMusic';
import { listListeningYears, loadListeningYear, useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { requirePro, useProStore } from '@/store/proStore';

/* ------------------------------------------------------------------------------------------ */
/* Amply Encore: the year played back as a deck of cards you tap through, story-style.         */
/* Every card has its own colours, big type and one thing to say; numbers count up as they     */
/* arrive. The deck ends with a share card and a mix of the year's most played songs.          */
/* ------------------------------------------------------------------------------------------ */

const PERSONA: Record<ListeningPersona, { emoji: string; title: MessageKey; body: MessageKey }> = {
  nightOwl: { emoji: '🦉', title: 'stats.encore.persona.nightOwl', body: 'stats.encore.persona.nightOwlBody' },
  earlyBird: { emoji: '🌅', title: 'stats.encore.persona.earlyBird', body: 'stats.encore.persona.earlyBirdBody' },
  daytime: { emoji: '☀️', title: 'stats.encore.persona.daytime', body: 'stats.encore.persona.daytimeBody' },
  evening: { emoji: '🌆', title: 'stats.encore.persona.evening', body: 'stats.encore.persona.eveningBody' },
};

/** Each card's own palette: two gradient stops and the ink that reads on them. */
const PALETTES = {
  intro: { from: '#5b21b6', to: '#db2777', ink: '#ffffff' },
  minutes: { from: '#ea580c', to: '#dc2626', ink: '#ffffff' },
  genre: { from: '#0e7490', to: '#1d4ed8', ink: '#ffffff' },
  artist: { from: '#facc15', to: '#f97316', ink: '#1c1917' },
  song: { from: '#be185d', to: '#6d28d9', ink: '#ffffff' },
  top: { from: '#15803d', to: '#0f766e', ink: '#ffffff' },
  persona: { from: '#1e1b4b', to: '#7c3aed', ink: '#ffffff' },
  streak: { from: '#a3e635', to: '#16a34a', ink: '#14200f' },
  month: { from: '#f472b6', to: '#fb923c', ink: '#1f1020' },
  share: { from: '#111827', to: '#4c1d95', ink: '#ffffff' },
} as const;
type Palette = (typeof PALETTES)[keyof typeof PALETTES];

const CARD_MS = 7000;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `target` when the card appears. */
const CountUp = ({ target }: { target: number }) => {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <>{formatNumber(value)}</>;
};

/** A full-bleed card: gradient, two soft drifting shapes, and the content. */
const Card = ({ palette, children }: { palette: Palette; children: ReactNode }) => (
  <div
    className="encore-card relative flex h-full w-full flex-col justify-center overflow-hidden px-8 py-12 sm:px-12"
    style={{ background: `linear-gradient(150deg, ${palette.from}, ${palette.to})`, color: palette.ink } as CSSProperties}
  >
    <span aria-hidden className="encore-blob encore-blob-a" />
    <span aria-hidden className="encore-blob encore-blob-b" />
    <div className="relative z-10 flex flex-col gap-4">{children}</div>
  </div>
);

const Lead = ({ children }: { children: ReactNode }) => (
  <p className="encore-rise text-[15px] font-bold uppercase tracking-[0.16em] opacity-80">{children}</p>
);

const Huge = ({ children, delay = 1 }: { children: ReactNode; delay?: 1 | 2 | 3 }) => (
  <p className={`encore-pop encore-delay-${delay} text-[64px] font-black leading-[0.95] tracking-[-0.04em] sm:text-[84px]`}>{children}</p>
);

const Line = ({ children, delay = 2 }: { children: ReactNode; delay?: 1 | 2 | 3 }) => (
  <p className={`encore-rise encore-delay-${delay} max-w-[30ch] text-[19px] font-semibold leading-snug opacity-90`}>{children}</p>
);

const Artwork = ({ songId, size }: { songId?: string; size: string }) => {
  const art = songId ? useLibraryStore.getState().getSongById(songId)?.albumArt : undefined;
  return (
    <div className={clsx('shrink-0 overflow-hidden rounded-md bg-black/20 shadow-2xl', size)}>
      {art ? (
        <ArtworkImage src={art} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center opacity-60">
          <Icon name="music" size={28} />
        </div>
      )}
    </div>
  );
};

const TopFive = ({ entries }: { entries: EncoreEntry[] }) => (
  <ol className="grid gap-3">
    {entries.map((entry, index) => (
      <li key={entry.key} className={`encore-rise encore-stagger flex min-w-0 items-center gap-4`} style={{ animationDelay: `${0.15 + index * 0.12}s` }}>
        <span className="w-8 shrink-0 text-[30px] font-black tabular-nums">{index + 1}</span>
        <Artwork songId={entry.songId} size="h-12 w-12" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold">{entry.label}</span>
          <span className="block truncate text-[13px] opacity-75">{entry.sublabel}</span>
        </span>
      </li>
    ))}
  </ol>
);

const EncoreDeck = ({ encore, onClose }: { encore: Encore; onClose: () => void }) => {
  const { t, tp, language } = useT();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const showToast = usePlayerStore((state) => state.showToast);
  const topSong = encore.topSongs[0];
  const topArtist = encore.topArtists[0];
  const topGenre = encore.topGenres[0];
  const persona = PERSONA[encore.persona];
  const month = new Intl.DateTimeFormat(language, { month: 'long' }).format(new Date(encore.year, encore.busiestMonth, 1));
  const hour = new Intl.DateTimeFormat(language, { hour: 'numeric' }).format(new Date(2000, 0, 1, encore.peakHour));
  const days = Math.floor(encore.minutes / 1440);

  const playMix = () => {
    const player = usePlayerStore.getState();
    const ids = encore.mixSongIds.filter((id) => Boolean(useLibraryStore.getState().getSongById(id)));
    if (!ids.length) {
      return;
    }
    player.setQueue(ids, ids[0]);
    void player.playSongById(ids[0], false);
    showToast(t('stats.encore.share.playing'));
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      const dataUrl = await renderEncoreCard({
        kicker: t('stats.encore.title', { year: encore.year }),
        minutes: formatNumber(encore.minutes),
        minutesLabel: t('stats.encore.minutes.label'),
        topArtistLabel: t('stats.encore.artist.lead'),
        topArtist: topArtist?.label ?? '—',
        topSongsLabel: t('stats.encore.top.lead'),
        topSongs: encore.topSongs.map((entry) => (entry.sublabel ? `${entry.label} · ${entry.sublabel}` : entry.label)),
        persona: `${persona.emoji}  ${t(persona.title)}`,
        footer: 'Amply Encore',
      });
      const saved = await saveEncoreCard(dataUrl, {
        title: t('stats.encore.share.save'),
        defaultName: safeFileName(t('stats.encore.title', { year: encore.year })),
        filterName: t('stats.encore.filterName'),
      });
      if (saved) {
        showToast(t('stats.encore.share.saved', { path: saved }));
      }
    } catch (error) {
      showToast(t('stats.encore.share.saveFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  };

  const cards: Array<{ key: string; node: ReactNode }> = [
    {
      key: 'intro',
      node: (
        <Card palette={PALETTES.intro}>
          <div aria-hidden className="encore-eq mb-2 flex h-12 items-end gap-1.5">
            {[0, 1, 2, 3, 4].map((bar) => (
              <span key={bar} className="w-2.5 rounded-full bg-current" style={{ animationDelay: `${bar * 0.12}s` }} />
            ))}
          </div>
          <Huge delay={1}>{t('stats.encore.intro.title', { year: encore.year })}</Huge>
          <Line>{t('stats.encore.intro.body')}</Line>
        </Card>
      ),
    },
    {
      key: 'minutes',
      node: (
        <Card palette={PALETTES.minutes}>
          <Lead>{t('stats.encore.minutes.lead')}</Lead>
          <Huge>
            <CountUp target={encore.minutes} />
          </Huge>
          <Line delay={1}>{t('stats.encore.minutes.label')}</Line>
          <Line delay={3}>{days >= 1 ? tp('stats.encore.minutes.days', days) : tp('stats.encore.minutes.hours', Math.max(1, Math.round(encore.minutes / 60)))}</Line>
        </Card>
      ),
    },
    ...(topGenre
      ? [
          {
            key: 'genre',
            node: (
              <Card palette={PALETTES.genre}>
                <Lead>{t('stats.encore.genre.lead')}</Lead>
                <Huge>{topGenre.label}</Huge>
                <Line delay={3}>{t('stats.encore.genre.body')}</Line>
              </Card>
            ),
          },
        ]
      : []),
    ...(topArtist
      ? [
          {
            key: 'artist',
            node: (
              <Card palette={PALETTES.artist}>
                <Lead>{t('stats.encore.artist.lead')}</Lead>
                <div className="encore-pop encore-delay-1 flex items-center gap-5">
                  <Artwork songId={topArtist.songId} size="h-24 w-24 rounded-full" />
                  <p className="min-w-0 text-[48px] font-black leading-[0.95] tracking-[-0.03em] sm:text-[60px]">{topArtist.label}</p>
                </div>
                <Line delay={3}>{t('stats.encore.artist.body', { plays: formatNumber(topArtist.plays) })}</Line>
              </Card>
            ),
          },
        ]
      : []),
    ...(topSong
      ? [
          {
            key: 'song',
            node: (
              <Card palette={PALETTES.song}>
                <Lead>{t('stats.encore.song.lead')}</Lead>
                <div className="encore-spin-in">
                  <Artwork songId={topSong.songId} size="h-44 w-44" />
                </div>
                <p className="encore-pop encore-delay-2 text-[38px] font-black leading-tight tracking-[-0.02em]">{topSong.label}</p>
                <Line delay={3}>
                  {topSong.sublabel} · {tp('stats.encore.song.body', topSong.plays)}
                </Line>
              </Card>
            ),
          },
        ]
      : []),
    {
      key: 'top',
      node: (
        <Card palette={PALETTES.top}>
          <Lead>{t('stats.encore.top.lead')}</Lead>
          <TopFive entries={encore.topSongs} />
        </Card>
      ),
    },
    {
      key: 'persona',
      node: (
        <Card palette={PALETTES.persona}>
          <Lead>{t('stats.encore.persona.lead')}</Lead>
          <p className="encore-spin-in text-[88px] leading-none">{persona.emoji}</p>
          <Huge delay={2}>{t(persona.title)}</Huge>
          <Line delay={3}>{t(persona.body)}</Line>
          <p className="encore-rise encore-delay-3 text-[14px] font-semibold opacity-75">{t('stats.encore.persona.peak', { hour })}</p>
        </Card>
      ),
    },
    {
      key: 'streak',
      node: (
        <Card palette={PALETTES.streak}>
          <Lead>{t('stats.encore.streak.lead')}</Lead>
          <Huge>
            <CountUp target={encore.longestStreak} />
          </Huge>
          <Line delay={3}>{tp('stats.encore.streak.body', encore.longestStreak)}</Line>
        </Card>
      ),
    },
    {
      key: 'month',
      node: (
        <Card palette={PALETTES.month}>
          <Lead>{t('stats.encore.month.lead')}</Lead>
          <Huge>{month}</Huge>
          <Line delay={3}>{t('stats.encore.month.body')}</Line>
        </Card>
      ),
    },
    {
      key: 'share',
      node: (
        <Card palette={PALETTES.share}>
          <Lead>{t('stats.encore.title', { year: encore.year })}</Lead>
          <Huge delay={1}>{t('stats.encore.share.title')}</Huge>
          <Line>{t('stats.encore.share.body')}</Line>
          <div className="encore-rise encore-delay-3 flex flex-wrap gap-2 pt-2">
            <Button variant="primary" icon="play" onClick={playMix}>
              {t('stats.encore.share.play')}
            </Button>
            <Button icon="download" loading={saving} onClick={() => void save()}>
              {t('stats.encore.share.save')}
            </Button>
          </div>
        </Card>
      ),
    },
  ];

  const last = cards.length - 1;
  const go = useCallback((step: number) => setIndex((current) => Math.max(0, Math.min(last, current + step))), [last]);

  // Stories move on by themselves; holding the pointer down (or reaching the end) pauses them.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (paused || index >= last || reducedMotion()) {
      return;
    }
    timerRef.current = window.setTimeout(() => go(1), CARD_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [go, index, last, paused]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft') {
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  return (
    <div className="relative h-[min(640px,78vh)] w-full overflow-hidden rounded-lg bg-black select-none">
      <div key={cards[index].key} className="encore-enter absolute inset-0" aria-live="polite" aria-label={t('stats.encore.slide', { index: index + 1, total: cards.length })}>
        {cards[index].node}
      </div>

      {/* Story progress: one segment per card, the current one filling over its time. */}
      <div className="absolute inset-x-4 top-3 z-20 flex gap-1.5" aria-hidden>
        {cards.map((card, segment) => (
          <span key={card.key} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <span
              className={clsx('block h-full rounded-full bg-white', segment < index && 'w-full', segment > index && 'w-0', segment === index && (index === last ? 'w-full' : 'encore-progress'))}
              style={segment === index ? ({ animationDuration: `${CARD_MS}ms`, animationPlayState: paused ? 'paused' : 'running' } as CSSProperties) : undefined}
            />
          </span>
        ))}
      </div>
      <IconButton name="close" label={t('common.close')} size="sm" variant="ghost" className="absolute right-3 top-6 z-30 text-white" onClick={onClose} />

      {/* Tap the left third to go back, the rest to go on, like a story. Buttons on the last card stay clickable. */}
      {index < last ? (
        <>
          <button
            type="button"
            aria-label={t('stats.encore.back')}
            className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize"
            onClick={() => go(-1)}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
          />
          <button
            type="button"
            aria-label={t('stats.encore.next')}
            className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize"
            onClick={() => go(1)}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
          />
        </>
      ) : (
        <button type="button" aria-label={t('stats.encore.back')} className="absolute inset-y-0 left-0 z-10 w-12 cursor-w-resize" onClick={() => go(-1)} />
      )}
    </div>
  );
};

const useYearLog = (year: number) => {
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const [log, setLog] = useState<YearLog | null>(null);
  useEffect(() => {
    let alive = true;
    void loadListeningYear(year).then((loaded) => {
      if (alive) {
        // A copy, so a later play makes React see a new value.
        setLog({ ...loaded, songs: { ...loaded.songs }, days: [...loaded.days] });
      }
    });
    return () => {
      alive = false;
    };
  }, [year, activityVersion]);
  const encore = useMemo(
    () => (log ? computeEncore(log, useLibraryStore.getState().getSongsById()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, libraryVersion],
  );
  return { log, encore };
};

/** The Stats page's door to Encore: a teaser on the free plan, the deck with Pro. */
export const EncoreCard = () => {
  const { t, tp } = useT();
  const isPro = useProStore((state) => state.isPro);
  const [years, setYears] = useState<number[]>([new Date().getFullYear()]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [open, setOpen] = useState(false);
  const { log, encore } = useYearLog(year);

  useEffect(() => {
    let alive = true;
    void listListeningYears().then((found) => {
      if (alive && found.length) {
        setYears(found);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const body = encore
    ? t('stats.encore.cardBody', { minutes: formatNumber(encore.minutes) })
    : tp('stats.encore.cardEmpty', Math.max(1, MIN_ENCORE_PLAYS - (log?.plays ?? 0)));

  return (
    <div
      className="encore-teaser relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-lg px-6 py-5 text-white"
      style={{ background: `linear-gradient(120deg, ${PALETTES.intro.from}, ${PALETTES.intro.to} 55%, ${PALETTES.minutes.from})` }}
    >
      <span aria-hidden className="encore-blob encore-blob-a" />
      <div className="relative min-w-0">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] opacity-80">Amply Encore</p>
        <p className="mt-1 text-[24px] font-black tracking-[-0.02em]">{t('stats.encore.cardTitle', { year })}</p>
        <p className="mt-1 text-[13px] opacity-85">{body}</p>
      </div>
      <div className="relative flex flex-wrap items-center gap-2">
        {years.length > 1 ? (
          <Select size="sm" label={t('stats.encore.year')} value={String(year)} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : null}
        <Button
          variant="primary"
          icon={isPro ? 'play' : 'lock'}
          disabled={isPro && !encore}
          onClick={() => {
            if (requirePro('encore')) {
              setOpen(true);
            }
          }}
        >
          {isPro ? t('stats.encore.open') : t('stats.encore.unlock')}
        </Button>
      </div>
      {encore ? (
        <Modal open={open} onClose={() => setOpen(false)} size="md" hideClose flush className="encore-modal">
          <EncoreDeck encore={encore} onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </div>
  );
};
