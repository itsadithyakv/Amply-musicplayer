import type { LyricLine } from '@/types/music';

/** [mm:ss], [mm:ss.xx], [mm:ss.xxx] and the colon variant [mm:ss:xx]. Mirrors the Rust parser. */
const timeRegex = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** Enhanced-LRC word timings, <mm:ss.xx>, removed from the displayed text. */
const wordTimeRegex = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
/** A whole-line metadata tag: [ar:Artist], [ti:Title], [offset:+250], [length:3:41]. */
const metaTagRegex = /^\[([A-Za-z#]+):([^\]]*)\]$/;

/** Milliseconds from an LRC fraction: "5" is 500 ms, "50" is 500 ms, "123" is 123 ms. */
const fractionMs = (fraction: string | undefined): number => Number((fraction ?? '').slice(0, 3).padEnd(3, '0')) || 0;

export const parseLrc = (raw: string): LyricLine[] => {
  const parsed: Array<LyricLine & { order: number }> = [];
  let offsetMs = 0;
  let order = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    const meta = metaTagRegex.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') {
        offsetMs = Number(meta[2].trim()) || 0;
      }
      continue;
    }

    const text = line.replace(timeRegex, '').replace(wordTimeRegex, '').trim();
    const matches = [...line.matchAll(timeRegex)];

    if (!matches.length) {
      if (text) {
        parsed.push({ timeMs: null, text, order: order++ });
      }
      continue;
    }

    for (const match of matches) {
      const timeMs = Math.max(0, Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + fractionMs(match[3]) - offsetMs);
      parsed.push({ timeMs, text, order: order++ });
    }
  }

  // In a synced file, an untimed line (a credit, a section label) stays where it was written by
  // taking the time of the line before it, instead of sinking to the end of the lyrics.
  if (parsed.some((line) => line.timeMs !== null)) {
    let previous = 0;
    for (const line of parsed) {
      if (line.timeMs === null) {
        line.timeMs = previous;
      } else {
        previous = line.timeMs;
      }
    }
  }

  return parsed
    .sort((a, b) => (a.timeMs ?? Number.MAX_SAFE_INTEGER) - (b.timeMs ?? Number.MAX_SAFE_INTEGER) || a.order - b.order)
    .map(({ timeMs, text }) => ({ timeMs, text }));
};
