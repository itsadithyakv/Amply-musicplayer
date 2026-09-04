import { describe, expect, it } from 'vitest';
import type { Playlist, Song } from '@/types/music';
import { normalizeToken } from '@/utils/text';
import { DAY, NOW, RAW_GENRES, TZ, baseInput, buildDominatedLibrary, buildLibrary } from './fixtures';
import { artistKeyForSong } from './genres';
import { generateMixes, generateMixesLite, isMoreMixPlaylistId } from './index';
import { MOODS, moodMixId } from './moods';
import { CORE_MIXES, GENRE_MIX_TARGET, MOOD_MIX_TARGET, effectiveTarget, scaledTarget } from './score';
import type { MixEngineInput, MixHistory } from './types';

const library = buildLibrary({ withEvents: true });
const songsById = new Map(library.songs.map((song) => [song.id, song]));
const input = baseInput(library.songs, { events: library.events });
const output = generateMixes(input);
const byId = new Map(output.playlists.map((playlist) => [playlist.id, playlist]));

const get = (id: string): Playlist => {
  const playlist = byId.get(id);
  if (!playlist) throw new Error(`missing playlist ${id}`);
  return playlist;
};
const songsOf = (playlist: Playlist): Song[] => playlist.songIds.map((id) => songsById.get(id)!);
const targetOf = (id: string, librarySize = library.songs.length): number => {
  if (id.startsWith('smart_genre_mix_')) return scaledTarget(GENRE_MIX_TARGET, librarySize);
  const core = CORE_MIXES.find((def) => def.id === id);
  return core ? effectiveTarget(core, librarySize) : scaledTarget(MOOD_MIX_TARGET, librarySize);
};
/** Spacing is only provable when no artist exceeds what a 2-per-5 window can hold. */
const spacingFeasible = (songs: Song[]): boolean => {
  const counts = new Map<string, number>();
  for (const song of songs) counts.set(artistKeyForSong(song), (counts.get(artistKeyForSong(song)) ?? 0) + 1);
  const length = songs.length;
  const maxAllowed = 2 * Math.floor(length / 5) + Math.min(2, length % 5);
  return [...counts.values()].every((count) => count <= maxAllowed && count <= Math.ceil(length / 2));
};
const albumKeyOf = (song: Song): string => `${artistKeyForSong(song)}::${normalizeToken(song.album)}`;
const overlap = (a: readonly string[], b: readonly string[]): number => {
  const set = new Set(a);
  let shared = 0;
  for (const id of b) if (set.has(id)) shared += 1;
  return shared / Math.max(1, Math.min(a.length, b.length));
};

describe('mix engine on a warm library', () => {
  it('emits the ids the UI depends on with metadata', () => {
    for (const id of [
      'smart_daily_mix',
      'smart_on_repeat',
      'smart_recently_played',
      'smart_recently_added',
      'smart_most_played',
      'smart_rediscover',
      'smart_favorites',
      'smart_loved_played',
      'smart_quick_hits',
      'smart_long_sessions',
      'smart_deep_cuts',
      'smart_explore',
    ]) {
      const playlist = get(id);
      expect(playlist.updatedAt).toBe(NOW);
      expect(playlist.description.length).toBeGreaterThan(0);
      expect(playlist.songIds.length).toBeGreaterThan(0);
      expect(playlist.artwork).toBe(songsOf(playlist).find((song) => song.albumArt)?.albumArt);
    }
    expect(get('smart_daily_mix').type).toBe('daily');
    expect(output.playlists.some((playlist) => playlist.id.startsWith('smart_genre_mix_'))).toBe(true);
    expect(output.playlists.filter((playlist) => isMoreMixPlaylistId(playlist.id)).length).toBeGreaterThan(8);
    expect(output.playlists.every((playlist) => !/unknown/i.test(playlist.name))).toBe(true);
    const ids = output.playlists.map((playlist) => playlist.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Most Played only contains played songs above the threshold', () => {
    const songs = songsOf(get('smart_most_played'));
    expect(songs.length).toBeGreaterThan(10);
    for (const song of songs) expect(song.playCount).toBeGreaterThan(0);
  });

  it('On Repeat only contains recent repeats', () => {
    const songs = songsOf(get('smart_on_repeat'));
    expect(songs.length).toBeGreaterThan(10);
    for (const song of songs) {
      expect(song.playCount).toBeGreaterThanOrEqual(3);
      expect(song.lastPlayed!).toBeGreaterThan(NOW - 21 * DAY);
    }
  });

  it('Explore and Daily contain nothing played in the last 36 hours', () => {
    for (const id of ['smart_explore', 'smart_daily_mix']) {
      const songs = songsOf(get(id));
      expect(songs.length).toBeGreaterThan(20);
      for (const song of songs) {
        if (song.lastPlayed !== undefined) expect(song.lastPlayed).toBeLessThan(NOW - 36 * 3600);
      }
    }
    for (const song of songsOf(get('smart_explore'))) {
      expect(song.playCount === 0 || song.lastPlayed! < NOW - 30 * DAY).toBe(true);
    }
  });

  it('Rediscover excludes anything played in the last 45 days and Deep Cuts stays obscure', () => {
    for (const song of songsOf(get('smart_rediscover'))) {
      expect(song.playCount).toBeGreaterThan(0);
      expect(song.lastPlayed!).toBeLessThan(NOW - 45 * DAY);
    }
    for (const song of songsOf(get('smart_deep_cuts'))) {
      expect(song.playCount).toBeLessThanOrEqual(1);
      expect(song.addedAt).toBeLessThan(NOW - 21 * DAY);
    }
    for (const song of songsOf(get('smart_quick_hits'))) expect(song.duration).toBeLessThanOrEqual(180);
    for (const song of songsOf(get('smart_long_sessions'))) expect(song.duration).toBeGreaterThanOrEqual(360);
    for (const song of songsOf(get('smart_favorites'))) expect(song.favorite).toBe(true);
    for (const song of songsOf(get('smart_loved_played'))) {
      expect(song.favorite).toBe(true);
      expect(song.playCount).toBeGreaterThan(0);
    }
  });

  it('Recently Played is chronological', () => {
    const songs = songsOf(get('smart_recently_played'));
    for (let i = 1; i < songs.length; i += 1) {
      expect(songs[i - 1].lastPlayed!).toBeGreaterThanOrEqual(songs[i].lastPlayed!);
    }
  });

  it('genre mixes only contain canonical (or inferred) members of their genre', () => {
    const hipHop = get('smart_genre_mix_hip-hop');
    for (const song of songsOf(hipHop)) expect(song.genre).toBe('Hip-Hop');
    const metal = get('smart_genre_mix_metal');
    for (const song of songsOf(metal)) expect(song.genre).toBe('Melodic Death Metal');
    expect(byId.has('smart_genre_mix_unknown-genre')).toBe(false);
  });

  it('puts every song in at most two mixes and never in two of one family', () => {
    const uses = new Map<string, string[]>();
    for (const playlist of output.playlists) {
      for (const id of playlist.songIds) {
        const list = uses.get(id) ?? [];
        list.push(playlist.id);
        uses.set(id, list);
      }
    }
    const families = [
      ['smart_explore', 'smart_deep_cuts', 'smart_rediscover'],
      ['smart_favorites', 'smart_loved_played'],
      ['smart_recently_played', 'smart_on_repeat'],
    ];
    for (const [, mixes] of uses) {
      expect(mixes.length).toBeLessThanOrEqual(2);
      for (const family of families) {
        expect(mixes.filter((mix) => family.includes(mix)).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('holds artist/album caps and spacing in every mix', () => {
    for (const playlist of output.playlists) {
      const target = targetOf(playlist.id);
      const artistCap = Math.max(2, Math.ceil(0.15 * target));
      const albumCap = Math.max(2, Math.ceil(0.1 * target));
      const songs = songsOf(playlist);
      const artists = new Map<string, number>();
      const albums = new Map<string, number>();
      for (const song of songs) {
        artists.set(artistKeyForSong(song), (artists.get(artistKeyForSong(song)) ?? 0) + 1);
        albums.set(albumKeyOf(song), (albums.get(albumKeyOf(song)) ?? 0) + 1);
      }
      for (const count of artists.values()) expect(count).toBeLessThanOrEqual(artistCap);
      for (const count of albums.values()) expect(count).toBeLessThanOrEqual(albumCap);
      expect(new Set(playlist.songIds).size).toBe(playlist.songIds.length);
      if (playlist.id === 'smart_recently_played' || !spacingFeasible(songs)) continue;
      for (let i = 1; i < songs.length; i += 1) {
        expect(artistKeyForSong(songs[i])).not.toBe(artistKeyForSong(songs[i - 1]));
      }
      for (let i = 0; i + 5 <= songs.length; i += 1) {
        const window = new Map<string, number>();
        for (const song of songs.slice(i, i + 5)) {
          window.set(artistKeyForSong(song), (window.get(artistKeyForSong(song)) ?? 0) + 1);
        }
        for (const count of window.values()) expect(count).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps caps when one album is 60% of the library', () => {
    const dominated = buildDominatedLibrary();
    const result = generateMixes(baseInput(dominated));
    const lookup = new Map(dominated.map((song) => [song.id, song]));
    for (const playlist of result.playlists) {
      const target = targetOf(playlist.id, dominated.length);
      const mega = playlist.songIds.filter((id) => lookup.get(id)!.album === 'The One Album').length;
      expect(mega).toBeLessThanOrEqual(Math.max(2, Math.ceil(0.1 * target)));
    }
    expect(result.playlists.find((playlist) => playlist.id === 'smart_daily_mix')!.songIds.length).toBeGreaterThan(20);
  });

  it('reports diagnostics for every mix definition', () => {
    const daily = output.diagnostics.find((entry) => entry.mixId === 'smart_daily_mix');
    expect(daily?.poolSize).toBe(library.songs.length);
    expect(daily?.produced).toBe(get('smart_daily_mix').songIds.length);
    expect(output.diagnostics.length).toBeGreaterThan(output.playlists.length - 1);
  });
});

describe('anti-repeat history', () => {
  it('reuses at most 20% of yesterday in the Daily Mix and returns updated history', () => {
    const yesterdayInput = baseInput(library.songs, { events: library.events, now: NOW - DAY, dailySeed: 20260903 });
    const yesterday = generateMixes(yesterdayInput);
    expect(yesterday.history['smart_daily_mix']?.[0]?.dayKey).toBe('2026-09-03');
    const yesterdayDaily = yesterday.history['smart_daily_mix'][0].songIds;

    // Same daily seed as yesterday would reproduce the same list without the rule.
    const today = generateMixes(baseInput(library.songs, { events: library.events, dailySeed: 20260903, history: yesterday.history }));
    const daily = today.playlists.find((playlist) => playlist.id === 'smart_daily_mix')!;
    const shared = daily.songIds.filter((id) => yesterdayDaily.includes(id)).length;
    expect(shared).toBeLessThanOrEqual(Math.floor(0.2 * 60));
    expect(daily.songIds.length).toBeGreaterThan(40);
    expect(today.history['smart_daily_mix'][0].dayKey).toBe('2026-09-04');
    expect(today.history['smart_daily_mix'][1].dayKey).toBe('2026-09-03');
  });

  it('Explore excludes what Explore surfaced in the last 7 days', () => {
    const first = generateMixes(baseInput(library.songs, { events: library.events, now: NOW - 2 * DAY }));
    const firstExplore = new Set(first.history['smart_explore'][0].songIds);
    const second = generateMixes(baseInput(library.songs, { events: library.events, history: first.history }));
    const explore = second.playlists.find((playlist) => playlist.id === 'smart_explore')!;
    expect(explore.songIds.length).toBeGreaterThan(10);
    for (const id of explore.songIds) expect(firstExplore.has(id)).toBe(false);
  });

  it('trims history to 14 entries per mix', () => {
    let history: MixHistory = {};
    for (let day = 0; day < 20; day += 1) {
      history = generateMixesLite(baseInput(library.songs, { now: NOW - (20 - day) * DAY, history })).history;
    }
    expect(history['smart_daily_mix']).toHaveLength(14);
  });
});

describe('determinism and seed scopes', () => {
  const run = (overrides: Partial<MixEngineInput>) => generateMixes(baseInput(library.songs, { events: library.events, ...overrides }));
  const idsOf = (result: ReturnType<typeof generateMixes>) =>
    Object.fromEntries(result.playlists.map((playlist) => [playlist.id, playlist.songIds]));

  it('same input -> identical output', () => {
    expect(JSON.stringify(generateMixes(input))).toBe(JSON.stringify(generateMixes(input)));
  });

  it('dailySeed changes only the Daily Mix', () => {
    const a = idsOf(run({ dailySeed: 1 }));
    const b = idsOf(run({ dailySeed: 2 }));
    expect(a['smart_daily_mix']).not.toEqual(b['smart_daily_mix']);
    for (const id of Object.keys(a)) {
      if (id === 'smart_daily_mix') continue;
      expect(a[id]).toEqual(b[id]);
    }
  });

  it('weeklySeed changes the other mixes', () => {
    const a = idsOf(run({ weeklySeed: 1 }));
    const b = idsOf(run({ weeklySeed: 2 }));
    let changed = 0;
    for (const id of Object.keys(a)) {
      if (id === 'smart_daily_mix' || id === 'smart_recently_played') continue;
      if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) changed += 1;
    }
    expect(changed).toBeGreaterThanOrEqual(Object.keys(a).length - 4);
  });

  it('regenNonce changes every mix including Daily', () => {
    const a = idsOf(run({ regenNonce: 1 }));
    const b = idsOf(run({ regenNonce: 2 }));
    for (const id of Object.keys(a)) {
      if (id === 'smart_recently_played' || a[id].length < 10) continue;
      expect(a[id], id).not.toEqual(b[id]);
    }
  });

  it('discovery and randomness intensities move the output without breaking determinism', () => {
    const low = run({ discoveryIntensity: 0, randomnessIntensity: 0 });
    const high = run({ discoveryIntensity: 1, randomnessIntensity: 1 });
    expect(JSON.stringify(low)).not.toBe(JSON.stringify(high));
    expect(JSON.stringify(run({ discoveryIntensity: 1, randomnessIntensity: 1 }))).toBe(JSON.stringify(high));
  });
});

describe('cold start', () => {
  const cold = buildLibrary({ coldStart: true, songs: 1500, artists: 100, seed: 5 });
  const result = generateMixes(baseInput(cold.songs));
  const coldById = new Map(cold.songs.map((song) => [song.id, song]));
  const playlist = (id: string) => result.playlists.find((entry) => entry.id === id);

  it('fills the Daily Mix with a stratified sample and leaves play-based mixes empty', () => {
    const daily = playlist('smart_daily_mix')!;
    expect(daily.songIds.length).toBeGreaterThanOrEqual(40);
    const genres = new Set(daily.songIds.map((id) => coldById.get(id)!.genre));
    const decades = new Set(daily.songIds.map((id) => Math.floor(coldById.get(id)!.year! / 10)));
    expect(genres.size).toBeGreaterThanOrEqual(8);
    expect(decades.size).toBeGreaterThanOrEqual(4);
    expect(playlist('smart_most_played')!.songIds).toEqual([]);
    expect(playlist('smart_on_repeat')!.songIds).toEqual([]);
    expect(playlist('smart_recently_played')!.songIds).toEqual([]);
    expect(result.diagnostics.find((entry) => entry.mixId === 'smart_daily_mix')?.reason).toBe('cold-start-stratified');
  });

  it('Rediscover falls back to the oldest never-played songs', () => {
    const rediscover = playlist('smart_rediscover')!;
    expect(rediscover.songIds.length).toBeGreaterThan(20);
    const ages = rediscover.songIds.map((id) => coldById.get(id)!.addedAt);
    const median = [...cold.songs].sort((a, b) => a.addedAt - b.addedAt)[Math.floor(cold.songs.length / 2)].addedAt;
    expect(ages.filter((addedAt) => addedAt <= median).length).toBeGreaterThan(ages.length * 0.8);
    expect(result.diagnostics.find((entry) => entry.mixId === 'smart_rediscover')?.reason).toBe('cold-start-fallback');
  });

  it('emits all twelve mood mixes and keeps them pairwise < 60% overlapping', () => {
    const moods = MOODS.map((mood) => playlist(moodMixId(mood.id))).filter((entry): entry is Playlist => Boolean(entry));
    expect(moods).toHaveLength(12);
    const sizeable = result.playlists.filter((entry) => entry.songIds.length >= 15);
    for (let i = 0; i < sizeable.length; i += 1) {
      for (let j = i + 1; j < sizeable.length; j += 1) {
        expect(overlap(sizeable[i].songIds, sizeable[j].songIds), `${sizeable[i].id} vs ${sizeable[j].id}`).toBeLessThan(0.6);
      }
    }
  });

  it('produces no mood or genre mix for an untagged library and never names "Unknown Genre"', () => {
    const untagged = buildLibrary({ coldStart: true, untagged: true });
    const bare = generateMixes(baseInput(untagged.songs));
    expect(bare.playlists.some((entry) => isMoreMixPlaylistId(entry.id))).toBe(false);
    expect(bare.playlists.find((entry) => entry.id === 'smart_daily_mix')!.songIds.length).toBeGreaterThan(40);
    for (const entry of [...bare.playlists, ...result.playlists]) {
      expect(entry.name).not.toMatch(/unknown/i);
      expect(entry.id).not.toContain('unknown');
    }
    expect(RAW_GENRES).toContain('Unknown Genre');
  });
});

describe('lite mode', () => {
  it('is a subset of the full output ids and skips heavy mixes', () => {
    const lite = generateMixesLite(input);
    const liteIds = lite.playlists.map((playlist) => playlist.id);
    expect(liteIds).toEqual(['smart_daily_mix', 'smart_on_repeat', 'smart_recently_played', 'smart_favorites', 'smart_explore']);
    for (const id of liteIds) expect(byId.has(id)).toBe(true);
    expect(lite.playlists.find((playlist) => playlist.id === 'smart_daily_mix')!.songIds.length).toBeGreaterThan(40);
  });

  it('handles an empty library', () => {
    const empty = generateMixes(baseInput([]));
    expect(empty.playlists.map((playlist) => playlist.id)).toContain('smart_daily_mix');
    expect(empty.playlists.every((playlist) => playlist.songIds.length === 0)).toBe(true);
  });
});

describe('time handling', () => {
  it('accepts milliseconds for now and keeps updatedAt in seconds', () => {
    const ms = generateMixesLite(baseInput(library.songs, { now: NOW * 1000 }));
    expect(ms.playlists[0].updatedAt).toBe(NOW);
    expect(ms.history['smart_daily_mix'][0].dayKey).toBe('2026-09-04');
    expect(TZ).toBe(-330);
  });
});
