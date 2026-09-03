import { memo, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppSettings } from '@/types/music';
import { isTauri } from '@/services/storageService';

type VisualTheme = AppSettings['lyricsVisualTheme'];

interface LyricsVisualizerProps {
  active: boolean;
  isPlaying: boolean;
  theme: VisualTheme;
  tint?: string | null;
}

interface AudioSpectrumEvent {
  bands: number[];
}

const BAND_COUNT = 8;

const themeColors: Record<VisualTheme, [string, string, string]> = {
  ember: ['255,112,30', '255,158,72', '255,207,148'],
  aurora: ['62,204,175', '92,139,244', '211,105,196'],
  mono: ['92,88,84', '145,139,132', '205,198,190'],
};

const rgba = (color: string, alpha: number): string => `rgba(${color},${alpha})`;

const roundedBar = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void => {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(width / 2, height / 2));
  context.fill();
};

const drawTint = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  tint: string | null | undefined,
  energy: number,
): void => {
  if (!tint) {
    return;
  }
  const gradient = context.createRadialGradient(
    width * 0.5,
    height * 0.5,
    0,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.58,
  );
  gradient.addColorStop(0, tint);
  gradient.addColorStop(1, 'transparent');
  context.save();
  context.globalAlpha = 0.025 + energy * 0.055;
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
};

const drawEmber = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: Float32Array,
  colors: [string, string, string],
): void => {
  const count = 17;
  const gap = Math.max(7, Math.min(15, width / 70));
  const barWidth = Math.max(7, Math.min(18, (width - gap * (count - 1)) / count));
  const totalWidth = count * barWidth + (count - 1) * gap;
  const startX = (width - totalWidth) / 2;
  const centerY = height * 0.56;

  for (let index = 0; index < count; index += 1) {
    const mirrored = Math.abs(index - Math.floor(count / 2));
    const bandIndex = Math.min(BAND_COUNT - 1, Math.floor((mirrored / (count / 2)) * BAND_COUNT));
    const level = bands[bandIndex] ?? 0;
    const barHeight = 10 + Math.pow(level, 0.72) * height * 0.32;
    const x = startX + index * (barWidth + gap);
    const color = colors[Math.min(2, Math.floor((index / count) * 3))];

    context.save();
    context.fillStyle = rgba(color, 0.12 + level * 0.17);
    context.shadowColor = rgba(color, 0.42);
    context.shadowBlur = 18 + level * 20;
    roundedBar(context, x, centerY - barHeight / 2, barWidth, barHeight);
    context.restore();
  }
};

const drawAurora = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: Float32Array,
  colors: [string, string, string],
  time: number,
): void => {
  const centerY = height * 0.52;
  const steps = 44;

  for (let wave = 0; wave < 3; wave += 1) {
    const phase = time * (0.00018 + wave * 0.000025) + wave * 1.7;
    context.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const bandPosition = ratio * (BAND_COUNT - 1);
      const low = Math.floor(bandPosition);
      const high = Math.min(BAND_COUNT - 1, low + 1);
      const mix = bandPosition - low;
      const level = bands[low] * (1 - mix) + bands[high] * mix;
      const edgeFade = Math.sin(ratio * Math.PI);
      const amplitude = (12 + level * height * 0.22) * edgeFade;
      const x = ratio * width;
      const y = centerY + Math.sin(ratio * Math.PI * (2.4 + wave * 0.35) + phase) * amplitude;
      if (step === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = rgba(colors[wave], 0.18);
    context.lineWidth = 1.5 + wave * 0.45;
    context.shadowColor = rgba(colors[wave], 0.48);
    context.shadowBlur = 20;
    context.stroke();
  }
};

const drawMono = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: Float32Array,
  colors: [string, string, string],
  time: number,
): void => {
  const centerX = width / 2;
  const centerY = height * 0.52;
  const radius = Math.min(width, height) * 0.16;
  const count = 56;

  context.save();
  context.translate(centerX, centerY);
  context.rotate(time * 0.000025);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const bandIndex = Math.min(BAND_COUNT - 1, Math.floor((index / count) * BAND_COUNT));
    const level = bands[bandIndex] ?? 0;
    const length = 5 + Math.pow(level, 0.76) * radius * 0.7;
    const inner = radius - length * 0.12;
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * (radius + length), Math.sin(angle) * (radius + length));
    context.strokeStyle = rgba(colors[index % 3], 0.12 + level * 0.24);
    context.lineWidth = 1.2;
    context.shadowColor = rgba(colors[index % 3], 0.3);
    context.shadowBlur = 10;
    context.stroke();
  }
  context.restore();
};

const LyricsVisualizer = memo(({ active, isPlaying, theme, tint }: LyricsVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const target = new Float32Array(BAND_COUNT);
    const smoothed = new Float32Array(BAND_COUNT);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let displayWidth = Math.max(1, canvas.clientWidth);
    let displayHeight = Math.max(1, canvas.clientHeight);
    let animationFrame = 0;
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      displayWidth = Math.max(1, entry.contentRect.width);
      displayHeight = Math.max(1, entry.contentRect.height);
    });
    resizeObserver.observe(canvas);

    if (isTauri()) {
      void listen<AudioSpectrumEvent>('amply://audio-spectrum', (event) => {
        for (let index = 0; index < BAND_COUNT; index += 1) {
          const value = event.payload.bands[index];
          target[index] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        }
      }).then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }).catch(() => undefined);
    }

    const draw = (time: number): void => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const nextWidth = Math.max(1, Math.round(displayWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(displayHeight * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, displayWidth, displayHeight);

      let energy = 0;
      for (let index = 0; index < BAND_COUNT; index += 1) {
        const destination = isPlaying ? target[index] : 0;
        const speed = destination > smoothed[index] ? 0.24 : 0.065;
        smoothed[index] += (destination - smoothed[index]) * speed;
        energy += smoothed[index];
      }
      energy /= BAND_COUNT;

      drawTint(context, displayWidth, displayHeight, tint, energy);
      const colors = themeColors[theme];
      if (theme === 'ember') {
        drawEmber(context, displayWidth, displayHeight, smoothed, colors);
      } else if (theme === 'aurora') {
        drawAurora(context, displayWidth, displayHeight, smoothed, colors, reduceMotion ? 0 : time);
      } else {
        drawMono(context, displayWidth, displayHeight, smoothed, colors, reduceMotion ? 0 : time);
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      unlisten?.();
    };
  }, [active, isPlaying, theme, tint]);

  return <canvas ref={canvasRef} className="lyrics-visualizer absolute inset-0 h-full w-full" aria-hidden="true" />;
});

LyricsVisualizer.displayName = 'LyricsVisualizer';

export default LyricsVisualizer;
