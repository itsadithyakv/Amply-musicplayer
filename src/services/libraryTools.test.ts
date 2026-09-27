import { describe, expect, it } from 'vitest';
import type { AppSettings, Playlist, Song } from '@/types/music';
import { findDuplicateGroups } from '@/services/duplicates';
import { buildM3u, parseM3u, playlistNameFromPath } from '@/services/playlistFiles';
import { buildBackup, parseBackup, planRestore } from '@/services/backup';
import { DEFAULT_SETTINGS } from '@/store/defaultSettings';

let counter = 0;
const song = (extra: Partial<Song> = {}): Song => {
  counter += 1;
  return {
    id: `s${counter}`,
    path: `D:\\Music\\${counter}.mp3`,
    source: '',
    filename: `${counter}.mp3`,
    title: 'Take My Breath Away',
    artist: 'Berlin',
    album: 'Top Gun',
    genre: 'Pop',
    duration: 251,
    track: 1,
    addedAt: 0,
    playCount: 0,
    favorite: false,
    ...extra,
  };
};

describe('findDuplicateGroups', () => {
  it('groups copies and ranks the most played first', () => {
    const a = song({ path: 'D:\\Music\\a.mp3' });
    const b = song({ path: 'D:\\Music\\a (1).mp3', playCount: 5, title: 'Take My Breath Away (Official Audio)' });
    const groups = findDuplicateGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].songs.map((entry) => entry.id)).toEqual([b.id, a.id]);
  });

  it('keeps versions, other lengths and other artists apart', () => {
    const base = song();
    const live = song({ title: 'Take My Breath Away (Live)' });
    const extended = song({ duration: 330 });
    const cover = song({ artist: 'Jessica Simpson' });
    expect(findDuplicateGroups([base, live, extended, cover])).toHaveLength(0);
  });
});

describe('M3U playlists', () => {
  it('round-trips through build and parse', () => {
    const songs = [song({ path: 'D:\\Music\\One.mp3', title: 'One' }), song({ path: 'E:\\Två\\Låt.flac', title: 'Låt' })];
    const parsed = parseM3u(buildM3u('Road Trip', songs), 'D:\\Lists\\Road Trip.m3u8');
    expect(parsed.name).toBe('Road Trip');
    expect(parsed.paths).toEqual(['D:\\Music\\One.mp3', 'E:\\Två\\Låt.flac']);
  });

  it('resolves relative entries and file URLs, skipping streams', () => {
    const text = '\uFEFF#EXTM3U\nsongs/a.mp3\n..\\Other\\b.mp3\nfile:///D:/Music/My%20Song.mp3\nhttps://radio.example/stream\n';
    expect(parseM3u(text, 'D:\\Lists\\list.m3u').paths).toEqual([
      'D:\\Lists\\songs\\a.mp3',
      'D:\\Other\\b.mp3',
      'D:\\Music\\My Song.mp3',
    ]);
  });

  it('names a playlist after its file', () => {
    expect(playlistNameFromPath('D:\\Lists\\Road Trip.m3u8')).toBe('Road Trip');
  });
});

describe('backup and restore', () => {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, lastFmApiKey: 'secret', outputDeviceName: 'Speakers' };

  it('leaves secrets and machine settings out', () => {
    const backup = buildBackup({ songs: [], customPlaylists: [], settings, appVersion: '1.7.2' });
    expect(backup.settings.lastFmApiKey).toBeUndefined();
    expect(backup.settings.outputDeviceName).toBeUndefined();
    expect(parseBackup(JSON.stringify(backup))?.appVersion).toBe('1.7.2');
    expect(parseBackup('{"format":"something-else"}')).toBeNull();
  });

  it('restores onto moved files and merges instead of overwriting', () => {
    const played = song({ path: 'D:\\Music\\hit.mp3', title: 'Hit', playCount: 12, favorite: true });
    const playlist: Playlist = { id: 'p1', name: 'Mine', type: 'custom', description: '', songIds: [played.id], updatedAt: 0 };
    const backup = buildBackup({ songs: [played], customPlaylists: [playlist], settings, appVersion: '1.7.2' });

    // New PC: the drive letter changed and the song has been played twice since.
    const now = song({ path: 'E:\\Music\\hit.mp3', title: 'Hit', playCount: 2 });
    const plan = planRestore(backup, [now], []);
    expect(plan.matchedSongs).toBe(1);
    expect(plan.activity.get(now.id)).toMatchObject({ playCount: 12, favorite: true });
    expect(plan.playlists).toEqual([{ existingId: null, name: 'Mine', description: '', songIds: [] }]);
  });

  it('extends a playlist that already exists instead of duplicating it', () => {
    const a = song({ title: 'A' });
    const b = song({ title: 'B' });
    const backup = buildBackup({
      songs: [a, b],
      customPlaylists: [{ id: 'x', name: 'Mix', type: 'custom', description: '', songIds: [a.id, b.id], updatedAt: 0 }],
      settings,
      appVersion: '1',
    });
    const existing: Playlist = { id: 'mine', name: 'mix', type: 'custom', description: '', songIds: [a.id], updatedAt: 0 };
    const plan = planRestore(backup, [a, b], [existing]);
    expect(plan.playlists[0]).toMatchObject({ existingId: 'mine', songIds: [a.id, b.id] });
  });
});
