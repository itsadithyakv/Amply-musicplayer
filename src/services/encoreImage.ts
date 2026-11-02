import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/services/storageService';

/** Text the share card shows, already translated and formatted. */
export interface EncoreCardText {
  kicker: string;
  minutes: string;
  minutesLabel: string;
  topArtistLabel: string;
  topArtist: string;
  topSongsLabel: string;
  topSongs: string[];
  persona: string;
  footer: string;
}

const W = 1080;
const H = 1350;

const fit = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
};

/**
 * Draws the share card (1080×1350, the portrait size social apps show uncropped) as a PNG, in the
 * deck's own look: a bold sunset gradient, soft light blobs and big white type.
 */
export const renderEncoreCard = async (text: EncoreCardText): Promise<string> => {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas unavailable');
  }
  const font = (weight: number, size: number) => `${weight} ${size}px "ZT Nature", "Segoe UI", sans-serif`;

  const sky = ctx.createLinearGradient(0, 0, W, H);
  sky.addColorStop(0, '#5b21b6');
  sky.addColorStop(0.55, '#db2777');
  sky.addColorStop(1, '#f97316');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [
    [W * 0.92, H * 0.06, 520, 0.28],
    [W * 0.02, H * 0.62, 460, 0.16],
    [W * 0.75, H * 0.98, 420, 0.2],
  ] as const) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(255,255,255,${a})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  const left = 92;
  const width = W - left * 2;
  const label = (value: string, y: number) => {
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = font(700, 32);
    ctx.fillText(value.toUpperCase(), left, y);
  };
  ctx.textBaseline = 'alphabetic';

  label(text.kicker, 150);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 196);
  ctx.fillText(fit(ctx, text.minutes, width), left, 345);
  ctx.font = font(700, 46);
  ctx.fillText(fit(ctx, text.minutesLabel, width), left, 410);

  label(text.topArtistLabel, 530);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 84);
  ctx.fillText(fit(ctx, text.topArtist, width), left, 620);

  label(text.topSongsLabel, 735);
  text.topSongs.slice(0, 5).forEach((song, index) => {
    const y = 805 + index * 64;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = font(900, 42);
    ctx.fillText(String(index + 1), left, y);
    ctx.font = font(600, 40);
    ctx.fillText(fit(ctx, song, width - 72), left + 72, y);
  });

  // A pill for the personality, so it reads as a badge and never runs into the list above.
  ctx.font = font(800, 44);
  const persona = fit(ctx, text.persona, width - 64);
  const pillW = ctx.measureText(persona).width + 64;
  const pillY = H - 210;
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.roundRect(left, pillY, pillW, 84, 42);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(persona, left + 32, pillY + 57);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = font(700, 30);
  ctx.fillText(text.footer, left, H - 70);

  return canvas.toDataURL('image/png');
};

/** Asks where to save the card. Resolves to the saved path, or null when cancelled. */
export const saveEncoreCard = async (dataUrl: string, options: { title: string; defaultName: string; filterName: string }): Promise<string | null> => {
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!isTauri()) {
    // Browser preview: a download is the closest thing to a save dialog.
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${options.defaultName}.png`;
    link.click();
    return `${options.defaultName}.png`;
  }
  return invoke<string | null>('save_image_file', { ...options, defaultName: `${options.defaultName}.png`, data });
};
