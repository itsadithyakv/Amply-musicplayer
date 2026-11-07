import { memo, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppSettings } from '@/types/music';
import { isTauri } from '@/services/storageService';

type VisualTheme = AppSettings['lyricsVisualTheme'];

interface AudioVisualizerProps {
  active: boolean;
  isPlaying: boolean;
  theme: VisualTheme;
}

interface AudioSpectrumEvent {
  bands: number[];
}

const BAND_COUNT = 8;

type Rgb = [number, number, number];

/** What the styles draw with, read from the live design tokens so they follow theme and accent. */
interface Colors {
  dark: boolean;
  accent: Rgb;
  ink: Rgb;
  edge: Rgb;
}

const readRgb = (styles: CSSStyleDeclaration, token: string, fallback: Rgb): Rgb => {
  const parts = styles.getPropertyValue(token).trim().split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as Rgb) : fallback;
};

const readColors = (): Colors => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return { dark: false, accent: [235, 126, 35], ink: [35, 31, 27], edge: [120, 105, 88] };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    dark: document.documentElement.dataset.theme === 'dark',
    accent: readRgb(styles, '--amply-accent', [235, 126, 35]),
    ink: readRgb(styles, '--amply-text-primary', [35, 31, 27]),
    edge: readRgb(styles, '--amply-edge', [120, 105, 88]),
  };
};

const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
const WHITE: Rgb = [255, 255, 255];

/**
 * Spectrum level at `position` (0 = centre, 1 = edge). The bass sits in the middle, where the eye
 * rests, and the spectrum fans out symmetrically to the treble at both ends.
 */
const levelAt = (bands: Float32Array, position: number): number => {
  const scaled = Math.max(0, Math.min(1, position)) * (BAND_COUNT - 1);
  const low = Math.floor(scaled);
  const high = Math.min(BAND_COUNT - 1, low + 1);
  return bands[low] + (bands[high] - bands[low]) * (scaled - low);
};

/**
 * Per-column movement on top of the 8 bands. Spread smoothly over a hundred columns, 8 bands make
 * a flat plateau; a slow, deterministic ripple gives each column its own life, as on a real
 * analyser. Scales with the level, so silence stays still.
 */
const ripple = (index: number, time: number): number =>
  0.62 + 0.38 * (0.5 + 0.5 * Math.sin(index * 1.73 + time * 0.0042) * Math.cos(index * 0.61 - time * 0.0027));

/** Centre-out position of column `index` of `count`. */
const centred = (index: number, count: number): number => Math.abs(index - (count - 1) / 2) / ((count - 1) / 2);

/**
 * The strip runs edge to edge, so it tapers instead of stopping: full height across the middle,
 * easing down to nothing over the outer 18% on each side.
 */
const taper = (position: number): number => {
  const edge = Math.max(0, Math.min(1, (1 - position) / 0.18));
  return edge * edge * (3 - 2 * edge);
};

/** Level of column `index` of `count`, with the edge taper applied. */
const columnLevel = (bands: Float32Array, index: number, count: number): number => {
  const position = centred(index, count);
  return levelAt(bands, position) * taper(position);
};

/* Ember: rounded bars in the accent colour, warming to a lighter tip, with peak caps that hang a
   moment and fall. The classic, made soft. */
const EMBER_BAR = 4;
const EMBER_GAP = 3;
/** Upper bound for the peak-cap memory; a 4K-wide strip still fits. */
const MAX_BARS = 640;

const drawEmber = (ctx: CanvasRenderingContext2D, w: number, h: number, bands: Float32Array, colors: Colors, peaks: Float32Array, dt: number, time: number): void => {
  // Thin bars at a fixed width, as many as fit: wide ones read as a row of bubbles.
  const count = Math.min(MAX_BARS, Math.max(8, Math.floor((w + EMBER_GAP) / (EMBER_BAR + EMBER_GAP))));
  const barW = EMBER_BAR;
  const gap = (w - count * barW) / Math.max(1, count - 1);
  const usable = h - 6;
  const fill = ctx.createLinearGradient(0, h, 0, 0);
  fill.addColorStop(0, rgba(colors.accent, 0.95));
  fill.addColorStop(1, rgba(mix(colors.accent, colors.dark ? WHITE : colors.ink, colors.dark ? 0.45 : 0.15), 0.9));
  const capColor = rgba(colors.dark ? mix(colors.accent, WHITE, 0.6) : colors.accent, 0.9);

  for (let index = 0; index < count; index += 1) {
    const level = Math.pow(columnLevel(bands, index, count), 0.85) * ripple(index, time);
    const barH = Math.max(2 * taper(centred(index, count)), level * usable);
    if (barH < 0.5) {
      continue;
    }
    const x = index * (barW + gap);
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.55 + level * 0.45;
    ctx.beginPath();
    ctx.roundRect(x, h - barH, barW, barH + barW, barW / 2);
    ctx.fill();

    // Peak caps rise with the bar and fall slowly, so transients stay readable.
    peaks[index] = Math.max(barH, peaks[index] - 26 * dt);
    if (peaks[index] > barH + 2) {
      ctx.globalAlpha = Math.min(1, (peaks[index] - barH) / 8);
      ctx.fillStyle = capColor;
      ctx.beginPath();
      ctx.roundRect(x, h - peaks[index] - 3, barW, 2, 1);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
};

/* Aurora: two flowing waves shading from violet through cyan to green and back, drifting slowly
   on their own, with a bright crest. Vivid on dark, deeper on light so it never washes out. */
const AURORA_DARK: Rgb[] = [[167, 139, 250], [56, 214, 236], [74, 222, 160]];
const AURORA_LIGHT: Rgb[] = [[124, 77, 230], [8, 145, 178], [16, 150, 105]];
const AURORA_POINTS = 48;

const drawAurora = (ctx: CanvasRenderingContext2D, w: number, h: number, bands: Float32Array, colors: Colors, time: number): void => {
  const hues = colors.dark ? AURORA_DARK : AURORA_LIGHT;
  const gradient = (alpha: number) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    [hues[0], hues[1], hues[2], hues[1], hues[0]].forEach((hue, i) => g.addColorStop(i / 4, rgba(hue, alpha)));
    return g;
  };
  const crest = (amplitude: number, phase: number): Array<[number, number]> => {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= AURORA_POINTS; i += 1) {
      const ratio = i / AURORA_POINTS;
      const level = columnLevel(bands, i, AURORA_POINTS + 1) * (0.8 + 0.2 * ripple(i, time));
      const drift = (Math.sin(ratio * Math.PI * 3 + phase) * 0.5 + 0.5) * 0.18 * taper(centred(i, AURORA_POINTS + 1));
      points.push([ratio * w, h - 2 - Math.min(1, level * amplitude + drift * amplitude) * (h - 6)]);
    }
    return points;
  };
  const trace = (points: Array<[number, number]>) => {
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
  };

  ctx.save();
  if (colors.dark) {
    ctx.globalCompositeOperation = 'lighter';
  }
  const seconds = time / 1000;
  for (const [amplitude, phase, fillAlpha, lineAlpha] of [
    [0.75, seconds * 0.9 + 2, 0.12, 0.35],
    [1, seconds * 0.6, 0.24, 0.95],
  ] as const) {
    const points = crest(amplitude, phase);
    ctx.beginPath();
    trace(points);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient(fillAlpha);
    ctx.fill();
    ctx.beginPath();
    trace(points);
    ctx.strokeStyle = gradient(lineAlpha);
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
};

/* Mono: a hi-fi dot-matrix meter. Columns of small dots light up from the bottom in the text
   colour, the top lit dot in the accent. Only the bottom row stays as a faint baseline: a full
   grid of unlit dots would lay a grey texture over the page. */
const MONO_DOT = 3;
const MONO_PITCH = 5;

const drawMono = (ctx: CanvasRenderingContext2D, w: number, h: number, bands: Float32Array, colors: Colors, time: number): void => {
  const rows = Math.max(3, Math.floor((h - 2) / MONO_PITCH));
  const columns = Math.max(8, Math.floor(w / (MONO_PITCH + 1)));
  const columnPitch = w / columns;
  const unlit = rgba(colors.edge, colors.dark ? 0.16 : 0.14);
  const lit = rgba(colors.ink, colors.dark ? 0.6 : 0.5);
  const tip = rgba(colors.accent, 1);
  const baseline = rgba(colors.ink, colors.dark ? 0.32 : 0.26);
  for (let column = 0; column < columns; column += 1) {
    const level = columnLevel(bands, column, columns) * ripple(column, time);
    const litRows = Math.round(Math.pow(level, 0.8) * rows);
    const x = column * columnPitch + (columnPitch - MONO_DOT) / 2;
    for (let row = 0; row < Math.max(1, litRows); row += 1) {
      // The bottom row is a steady baseline; a single lit dot is not a peak, so it is not accented.
      ctx.fillStyle = row === 0 && litRows <= 1 ? baseline : row >= litRows ? unlit : row === litRows - 1 ? tip : lit;
      ctx.beginPath();
      ctx.roundRect(x, h - 2 - (row + 1) * MONO_PITCH + (MONO_PITCH - MONO_DOT), MONO_DOT, MONO_DOT, 1);
      ctx.fill();
    }
  }
};

/**
 * The browser preview (`npm run dev`) has no audio engine, so it would only ever show the idle
 * strip. There, a synthetic beat stands in for the spectrum; desktop builds never use it.
 */
const SIMULATE_SPECTRUM = import.meta.env.DEV && !isTauri();

const simulateSpectrum = (bands: Float32Array, time: number): void => {
  const beat = Math.pow(Math.max(0, Math.sin((time / 1000) * Math.PI * 2 * 2)), 6);
  for (let index = 0; index < BAND_COUNT; index += 1) {
    const wobble = 0.5 + 0.5 * Math.sin(time / (260 + index * 70) + index * 1.7);
    bands[index] = Math.min(1, (index < 2 ? beat * 0.7 : 0.15) + wobble * (0.55 - index * 0.04));
  }
};

/** The spectrum strip above the player bar, in the chosen style. */
const AudioVisualizer = memo(({ active, isPlaying, theme }: AudioVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [target] = useState(() => new Float32Array(BAND_COUNT));
  const [smoothed] = useState(() => new Float32Array(BAND_COUNT));
  const [peaks] = useState(() => new Float32Array(MAX_BARS));
  const sizeRef = useRef({ width: 1, height: 1 });
  const colorsRef = useRef<Colors>(readColors());

  // Theme, accent and true black all change the tokens; re-read them when any does.
  useEffect(() => {
    colorsRef.current = readColors();
    if (typeof MutationObserver === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => {
      colorsRef.current = readColors();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'data-black'] });
    return () => observer.disconnect();
  }, []);

  // Spectrum events and canvas sizing are subscribed once per activation.
  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    sizeRef.current = { width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) };
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        sizeRef.current = { width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) };
      }
    });
    resizeObserver.observe(canvas);

    if (isTauri()) {
      void listen<AudioSpectrumEvent>('amply://audio-spectrum', (event) => {
        for (let index = 0; index < BAND_COUNT; index += 1) {
          const value = event.payload.bands[index];
          target[index] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        }
      })
        .then((stop) => {
          if (disposed) {
            stop();
          } else {
            unlisten = stop;
          }
        })
        .catch(() => undefined);
    }

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      unlisten?.();
      target.fill(0);
      peaks.fill(0);
    };
  }, [active, target, peaks]);

  // Draw loop: cheap to restart, so it follows the visual inputs directly.
  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduceMotion = motionQuery.matches;
    const handleMotion = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
    };
    motionQuery.addEventListener('change', handleMotion);

    let frame = 0;
    let last = performance.now();
    // Idle "breathing" so a paused strip never looks frozen.
    let idlePhase = 0;

    const draw = (time: number): void => {
      const dt = Math.min(0.05, Math.max(0.001, (time - last) / 1000));
      last = time;
      const { width: w, height: h } = sizeRef.current;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.max(1, Math.round(w * ratio));
      const ph = Math.max(1, Math.round(h * ratio));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      idlePhase += reduceMotion ? 0 : dt;
      if (SIMULATE_SPECTRUM && isPlaying) {
        simulateSpectrum(target, time);
      }
      for (let index = 0; index < BAND_COUNT; index += 1) {
        const idle = 0.05 + Math.sin(idlePhase * 1.2 + index) * 0.025;
        const destination = isPlaying ? target[index] : idle;
        const speed = destination > smoothed[index] ? 0.3 : 0.09;
        smoothed[index] += (destination - smoothed[index]) * speed;
      }

      const colors = colorsRef.current;
      const motionTime = reduceMotion ? 0 : time;
      if (theme === 'aurora') {
        drawAurora(ctx, w, h, smoothed, colors, motionTime);
      } else if (theme === 'mono') {
        drawMono(ctx, w, h, smoothed, colors, motionTime);
      } else {
        drawEmber(ctx, w, h, smoothed, colors, peaks, dt, motionTime);
      }
      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      motionQuery.removeEventListener('change', handleMotion);
    };
  }, [active, isPlaying, theme, target, smoothed, peaks]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
});

AudioVisualizer.displayName = 'AudioVisualizer';

export default AudioVisualizer;
