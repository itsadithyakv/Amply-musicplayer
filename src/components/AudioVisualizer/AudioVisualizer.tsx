import { memo, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppSettings } from '@/types/music';
import { isTauri } from '@/services/storageService';

type VisualTheme = AppSettings['lyricsVisualTheme'];

interface AudioVisualizerProps {
  active: boolean;
  isPlaying: boolean;
  theme: VisualTheme;
  tint?: string | null;
}

interface AudioSpectrumEvent {
  bands: number[];
}

const BAND_COUNT = 8;

/** "r,g,b" triplet ready for `rgba(...)`. */
type Triplet = string;
interface Palette {
  /** Low → high energy colour ramp (4 stops). */
  ramp: [Triplet, Triplet, Triplet, Triplet];
  /** Whether additive blending looks right on this background (dark theme). */
  additive: boolean;
}
type Palettes = Record<VisualTheme, Palette>;

const NEUTRAL: Triplet = '128,128,128';
const FALLBACK: Palettes = {
  ember: { ramp: [NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL], additive: false },
  aurora: { ramp: [NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL], additive: false },
  mono: { ramp: [NEUTRAL, NEUTRAL, NEUTRAL, NEUTRAL], additive: false },
};

const readTriplet = (styles: CSSStyleDeclaration, token: string): Triplet => {
  const parts = styles.getPropertyValue(token).trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(Number(part)))) {
    return NEUTRAL;
  }
  return parts.map((part) => Math.round(Number(part))).join(',');
};

const mixTriplet = (a: Triplet, b: Triplet, t: number): Triplet => {
  const pa = a.split(',').map(Number);
  const pb = b.split(',').map(Number);
  return pa.map((channel, index) => Math.round(channel + (pb[index] - channel) * t)).join(',');
};

const lighten = (triplet: Triplet, amount: number): Triplet => mixTriplet(triplet, '255,255,255', amount);

/** Palettes derived from the live design tokens so every scene follows the light/dark theme. */
const readPalettes = (): Palettes => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACK;
  }
  const styles = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  const accent = readTriplet(styles, '--amply-accent');
  const danger = readTriplet(styles, '--amply-danger');
  const info = readTriplet(styles, '--amply-info');
  const success = readTriplet(styles, '--amply-success');
  const muted = readTriplet(styles, '--amply-text-muted');
  const primary = readTriplet(styles, '--amply-text-primary');
  return {
    ember: { ramp: [mixTriplet(danger, accent, 0.5), accent, lighten(accent, 0.35), lighten(accent, 0.75)], additive: dark },
    aurora: { ramp: [info, success, mixTriplet(success, accent, 0.5), lighten(info, 0.4)], additive: dark },
    mono: { ramp: [muted, mixTriplet(muted, primary, 0.4), mixTriplet(muted, primary, 0.75), primary], additive: false },
  };
};

const rgba = (color: Triplet, alpha: number): string => `rgba(${color},${Math.max(0, Math.min(1, alpha))})`;

/** Interpolated band level at a 0..1 position across the spectrum. */
const levelAt = (bands: Float32Array, ratio: number): number => {
  const position = Math.max(0, Math.min(1, ratio)) * (BAND_COUNT - 1);
  const low = Math.floor(position);
  const high = Math.min(BAND_COUNT - 1, low + 1);
  const mix = position - low;
  return bands[low] * (1 - mix) + bands[high] * mix;
};

/* ------------------------------------------------------------------ */
/* Scene 1 — Ember: mirrored flame bars rising from a glowing floor,   */
/* with drifting sparks whose spawn rate follows the energy.           */
/* ------------------------------------------------------------------ */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
}

interface EmberState {
  sparks: Spark[];
}

const drawEmber = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: Float32Array,
  palette: Palette,
  energy: number,
  dt: number,
  state: EmberState,
  reduceMotion: boolean,
): void => {
  const floorY = h * 0.86;
  const count = 24;
  const gap = Math.max(4, w / 140);
  const barW = (w * 0.78 - gap * (count - 1)) / count;
  const startX = (w - (barW * count + gap * (count - 1))) / 2;

  // floor glow
  const glow = ctx.createLinearGradient(0, floorY - h * 0.35, 0, floorY);
  glow.addColorStop(0, rgba(palette.ramp[0], 0));
  glow.addColorStop(1, rgba(palette.ramp[1], 0.08 + energy * 0.18));
  ctx.fillStyle = glow;
  ctx.fillRect(0, floorY - h * 0.35, w, h * 0.35);

  ctx.save();
  if (palette.additive) {
    ctx.globalCompositeOperation = 'lighter';
  }
  for (let index = 0; index < count; index += 1) {
    const centered = Math.abs(index - (count - 1) / 2) / ((count - 1) / 2); // 0 centre → 1 edge
    const level = levelAt(bands, centered);
    const eased = Math.pow(level, 0.7);
    const barH = 6 + eased * h * 0.55 * (1 - centered * 0.35);
    const x = startX + index * (barW + gap);
    const gradient = ctx.createLinearGradient(0, floorY, 0, floorY - barH);
    gradient.addColorStop(0, rgba(palette.ramp[0], 0.55));
    gradient.addColorStop(0.55, rgba(palette.ramp[1], 0.45));
    gradient.addColorStop(1, rgba(palette.ramp[3], 0.05 + eased * 0.6));
    ctx.fillStyle = gradient;
    ctx.shadowColor = rgba(palette.ramp[1], 0.35 + eased * 0.3);
    ctx.shadowBlur = 10 + eased * 22;
    ctx.beginPath();
    ctx.roundRect(x, floorY - barH, barW, barH, [barW / 2, barW / 2, 0, 0]);
    ctx.fill();
  }
  ctx.restore();

  // sparks
  if (!reduceMotion) {
    const spawn = energy * 40 * dt;
    let budget = spawn + (Math.random() < spawn % 1 ? 1 : 0);
    while (budget >= 1 && state.sparks.length < 90) {
      budget -= 1;
      const ratio = Math.random();
      state.sparks.push({
        x: startX + ratio * (w - startX * 2),
        y: floorY - Math.random() * 8,
        vx: (Math.random() - 0.5) * 18,
        vy: -(40 + Math.random() * 70 + energy * 60),
        life: 0,
        ttl: 1.2 + Math.random() * 1.6,
        size: 1 + Math.random() * 1.8,
      });
    }
    ctx.save();
    for (let i = state.sparks.length - 1; i >= 0; i -= 1) {
      const spark = state.sparks[i];
      spark.life += dt;
      if (spark.life >= spark.ttl) {
        state.sparks.splice(i, 1);
        continue;
      }
      spark.x += (spark.vx + Math.sin(spark.life * 6 + spark.x) * 10) * dt;
      spark.y += spark.vy * dt;
      spark.vy *= 1 - 0.6 * dt;
      const t = spark.life / spark.ttl;
      ctx.fillStyle = rgba(t < 0.5 ? palette.ramp[3] : palette.ramp[2], (1 - t) * 0.8);
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
};

/* ------------------------------------------------------------------ */
/* Scene 2 — Aurora: four translucent ribbons whose height follows    */
/* the spectrum, drifting slowly like curtains of light.               */
/* ------------------------------------------------------------------ */
const drawAurora = (ctx: CanvasRenderingContext2D, w: number, h: number, bands: Float32Array, palette: Palette, energy: number, time: number): void => {
  const ribbons = 4;
  const steps = 60;
  ctx.save();
  if (palette.additive) {
    ctx.globalCompositeOperation = 'lighter';
  }
  for (let r = 0; r < ribbons; r += 1) {
    const color = palette.ramp[r % palette.ramp.length];
    const baseY = h * (0.42 + r * 0.06);
    const phase = time * (0.00012 + r * 0.00003) + r * 1.9;
    const thickness = h * (0.16 + energy * 0.12);
    const top: Array<[number, number]> = [];
    for (let s = 0; s <= steps; s += 1) {
      const ratio = s / steps;
      const level = levelAt(bands, ratio);
      const drift = Math.sin(ratio * Math.PI * (1.6 + r * 0.4) + phase) * h * 0.06;
      const swell = Math.sin(ratio * Math.PI) * (0.3 + level) * h * 0.22;
      top.push([ratio * w, baseY + drift - swell]);
    }
    const gradient = ctx.createLinearGradient(0, baseY - h * 0.3, 0, baseY + thickness);
    gradient.addColorStop(0, rgba(color, 0));
    gradient.addColorStop(0.35, rgba(color, 0.16 + energy * 0.22));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let s = 1; s < top.length; s += 1) {
      const [x0, y0] = top[s - 1];
      const [x1, y1] = top[s];
      const cx = (x0 + x1) / 2;
      ctx.quadraticCurveTo(x0, y0, cx, (y0 + y1) / 2);
    }
    ctx.lineTo(w, baseY + thickness);
    ctx.lineTo(0, baseY + thickness);
    ctx.closePath();
    ctx.fill();

    // crest highlight
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let s = 1; s < top.length; s += 1) {
      const [x0, y0] = top[s - 1];
      const [x1, y1] = top[s];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.strokeStyle = rgba(palette.ramp[3], 0.18 + energy * 0.25);
    ctx.lineWidth = 1.2;
    ctx.shadowColor = rgba(color, 0.5);
    ctx.shadowBlur = 16;
    ctx.stroke();
  }
  ctx.restore();
};

/* ------------------------------------------------------------------ */
/* Scene 3 — Mono: a quiet radial spectrum. Thin mirrored spokes       */
/* around a breathing core; no glow, just the text colours.            */
/* ------------------------------------------------------------------ */
const drawMono = (ctx: CanvasRenderingContext2D, w: number, h: number, bands: Float32Array, palette: Palette, energy: number, time: number): void => {
  const cx = w / 2;
  const cy = h * 0.5;
  const radius = Math.min(w, h) * 0.17;
  const spokes = 96;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 0.00004);

  // core
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * (0.95 + energy * 0.15));
  core.addColorStop(0, rgba(palette.ramp[1], 0.16 + energy * 0.12));
  core.addColorStop(1, rgba(palette.ramp[0], 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2;
    // mirror the spectrum around the vertical axis so lows sit at the bottom, highs at the top
    const ratio = Math.abs(((i / spokes) * 2 + 0.5) % 2 - 1);
    const level = levelAt(bands, ratio);
    const length = radius * 0.12 + Math.pow(level, 0.8) * radius * 1.1;
    const inner = radius * 1.02;
    const stop = palette.ramp[Math.min(3, Math.floor(level * 4))];
    ctx.strokeStyle = rgba(stop, 0.22 + level * 0.5);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * (inner + length), Math.sin(angle) * (inner + length));
    ctx.stroke();
  }

  // ring
  ctx.strokeStyle = rgba(palette.ramp[2], 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const drawTint = (ctx: CanvasRenderingContext2D, w: number, h: number, tint: string | null | undefined, energy: number): void => {
  if (!tint) {
    return;
  }
  const gradient = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.6);
  gradient.addColorStop(0, tint);
  gradient.addColorStop(1, 'transparent');
  ctx.save();
  ctx.globalAlpha = 0.03 + energy * 0.06;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
};

const AudioVisualizer = memo(({ active, isPlaying, theme, tint }: AudioVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [target] = useState(() => new Float32Array(BAND_COUNT));
  const [smoothed] = useState(() => new Float32Array(BAND_COUNT));
  const sizeRef = useRef({ width: 1, height: 1 });
  const palettesRef = useRef<Palettes>(FALLBACK);
  const emberRef = useRef<EmberState>({ sparks: [] });

  useEffect(() => {
    palettesRef.current = readPalettes();
    if (typeof MutationObserver === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => {
      palettesRef.current = readPalettes();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
    const ember = emberRef.current;
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
      ember.sparks.length = 0;
    };
  }, [active, target]);

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
    // Idle "breathing" so a paused scene never looks frozen.
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

      idlePhase += dt;
      let energy = 0;
      for (let index = 0; index < BAND_COUNT; index += 1) {
        const idle = isPlaying ? 0 : 0.06 + Math.sin(idlePhase * 1.2 + index) * 0.03;
        const destination = isPlaying ? target[index] : idle;
        const speed = destination > smoothed[index] ? 0.28 : 0.08;
        smoothed[index] += (destination - smoothed[index]) * speed;
        energy += smoothed[index];
      }
      energy /= BAND_COUNT;

      drawTint(ctx, w, h, tint, energy);
      const palette = palettesRef.current[theme];
      const t = reduceMotion ? 0 : time;
      if (theme === 'ember') {
        drawEmber(ctx, w, h, smoothed, palette, energy, dt, emberRef.current, reduceMotion);
      } else if (theme === 'aurora') {
        drawAurora(ctx, w, h, smoothed, palette, energy, t);
      } else {
        drawMono(ctx, w, h, smoothed, palette, energy, t);
      }
      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      motionQuery.removeEventListener('change', handleMotion);
    };
  }, [active, isPlaying, theme, tint, target, smoothed]);

  return <canvas ref={canvasRef} className="audio-visualizer absolute inset-0 h-full w-full" aria-hidden="true" />;
});

AudioVisualizer.displayName = 'AudioVisualizer';

export default AudioVisualizer;
