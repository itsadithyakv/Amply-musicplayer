import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { maxMixesPerSongFor } from './assign';
import { capsForLibrary } from './diversity';
import { DAY, NOW, baseInput, buildLibrary } from './fixtures';
import { generateMixes } from './index';
import { dailyTargetFor, isTwinOf, minSongsFor } from './score';

/** A library just scanned: everything added two days ago, nothing played or favourited yet. */
const freshInstall = (songs: Song[]): Song[] =>
  songs.map((song) => ({ ...song, addedAt: NOW - 2 * DAY, playCount: 0, lastPlayed: undefined, favorite: false, skipCount: 0, totalPlaySeconds: 0 }));

const library = (size: number) => buildLibrary({ songs: size, artists: Math.max(2, Math.round(size / 8)), seed: size, withEvents: true });

const shown = (songs: Song[], events: ReturnType<typeof buildLibrary>['events'] = []) =>
  generateMixes(baseInput(songs, { events })).playlists.filter((playlist) => playlist.songIds.length);

describe('mixes in a small library', () => {
  it('sizes the Daily Mix to the library: all of a tiny one, half of a small one', () => {
    expect(dailyTargetFor(60, 8)).toBe(8);
    expect(dailyTargetFor(60, 25)).toBe(25);
    expect(dailyTargetFor(60, 80)).toBe(40);
    expect(dailyTargetFor(60, 1000)).toBe(60);
    const songs = freshInstall(library(20).songs);
    expect(shown(songs).find((playlist) => playlist.id === 'smart_daily_mix')?.songIds).toHaveLength(20);
  });

  it('makes no mix of a handful of songs, and no mix twice', () => {
    for (const size of [8, 20, 40, 80, 150, 200]) {
      const { songs, events } = library(size);
      for (const input of [freshInstall(songs), songs]) {
        const mixes = shown(input, input === songs ? events : []);
        for (const mix of mixes) {
          expect(mix.songIds.length, `${size}: ${mix.name}`).toBeGreaterThanOrEqual(mix.id === 'smart_daily_mix' ? 1 : 5);
        }
        const others = mixes.filter((mix) => mix.id !== 'smart_daily_mix');
        for (const mix of others) {
          for (const earlier of mixes.slice(0, mixes.indexOf(mix))) {
            if (['smart_recently_played', 'smart_favorites'].includes(mix.id)) continue;
            expect(isTwinOf(mix.songIds, new Set(earlier.songIds)), `${size}: ${mix.name} ~ ${earlier.name}`).toBe(false);
          }
        }
      }
    }
  });

  it('leaves out mixes that need a bigger library', () => {
    const ids = shown(freshInstall(library(40).songs)).map((playlist) => playlist.id);
    for (const id of ['smart_explore', 'smart_deep_cuts', 'smart_rediscover', 'smart_quick_hits', 'smart_long_sessions']) {
      expect(ids).not.toContain(id);
    }
    expect(ids.some((id) => id.startsWith('smart_genre_mix_'))).toBe(false);
  });

  it('calls nothing "recently added" when everything is new, and means the last month otherwise', () => {
    expect(shown(freshInstall(library(80).songs)).map((playlist) => playlist.id)).not.toContain('smart_recently_added');
    const songs = library(120).songs.map((song, index) => ({ ...song, addedAt: NOW - (index < 15 ? 3 : 200) * DAY }));
    const added = generateMixes(baseInput(songs)).playlists.find((playlist) => playlist.id === 'smart_recently_added');
    expect(added?.songIds.length).toBeGreaterThan(0);
    expect(added?.songIds.every((id) => Number(id.split('-')[1]) < 15)).toBe(true);
  });

  it('puts every favourite in Favorites, even when songs are scarce', () => {
    const songs = library(60).songs.map((song, index) => ({ ...song, favorite: index % 4 === 0 }));
    const favorites = generateMixes(baseInput(songs)).playlists.find((playlist) => playlist.id === 'smart_favorites');
    expect(favorites?.songIds.length).toBe(15);
  });

  it('does not call yesterday\'s arrivals "not played in a while"', () => {
    expect(shown(freshInstall(library(200).songs)).map((playlist) => playlist.id)).not.toContain('smart_rediscover');
  });

  it('lets a few artists fill a mix, and songs sit in one more mix when there are few', () => {
    expect(capsForLibrary(20, 2, 4).artistCap).toBe(10);
    expect(capsForLibrary(60, 40, 120)).toEqual({ artistCap: 9, albumCap: 6 });
    expect(maxMixesPerSongFor(150)).toBe(3);
    expect(maxMixesPerSongFor(1200)).toBe(2);
    expect(minSongsFor('favorites')).toBe(5);
    expect(minSongsFor('genre')).toBe(8);
  });
});
