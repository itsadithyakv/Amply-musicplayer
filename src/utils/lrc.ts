import type { LyricLine } from '@/types/music';

const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]/g;

export const parseLrc = (raw: string): LyricLine[] => {
  const lines = raw.split(/\r?\n/);
  const parsed: LyricLine[] = [];

  for (const line of lines) {
    const text = line.replace(timeRegex, '').trim();
    const matches = [...line.matchAll(timeRegex)];

    if (!matches.length) {
      if (text) {
        parsed.push({ timeMs: null, text });
      }
      continue;
    }

    for (const match of matches) {
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      const hundredths = Number(match[3] ?? '0');
      const timeMs = mins * 60_000 + secs * 1_000 + hundredths * 10;
      parsed.push({ timeMs, text });
    }
  }

  return parsed.sort((a, b) => (a.timeMs ?? Number.MAX_SAFE_INTEGER) - (b.timeMs ?? Number.MAX_SAFE_INTEGER));
};

