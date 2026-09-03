/** Calendar-derived keys and seeds (UTC) used to keep smart mixes stable within a day / week. */

export const getIsoWeek = (date: Date): { year: number; week: number } => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
};

/** e.g. "2026-W36" */
export const isoWeekKey = (date = new Date()): string => {
  const { year, week } = getIsoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

/** e.g. "2026-09-03" */
export const dayKey = (date = new Date()): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Numeric seed from a key such as "2026-W36" or "2026-09-03" (digits only). */
export const seedFromKey = (key: string): number => {
  const seed = Number(key.replace(/[^0-9]/g, ''));
  return Number.isFinite(seed) ? seed : Date.now();
};

export const weeklySeed = (date = new Date()): number => seedFromKey(isoWeekKey(date));
export const dailySeed = (date = new Date()): number => seedFromKey(dayKey(date));
