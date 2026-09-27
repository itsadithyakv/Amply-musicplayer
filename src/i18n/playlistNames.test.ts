import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { localizedPlaylistDescription, localizedPlaylistName } from '@/i18n/playlistNames';
import { CORE_MIXES, genreMixDefinition, moodMixDefinition } from '@/services/mixEngine/score';
import { MOODS } from '@/services/mixEngine/moods';
import type { Playlist } from '@/types/music';

afterEach(async () => {
  await setLanguage('en');
});

type Named = Pick<Playlist, 'id' | 'name' | 'description' | 'type'>;

const engineMixes: Named[] = [
  ...CORE_MIXES,
  ...MOODS.map((mood) => moodMixDefinition(mood, 1000)),
  genreMixDefinition('Hip-Hop', 1000),
].map(({ id, name, description, type }) => ({ id, name, description, type }));

describe('localized playlist names', () => {
  it('match the engine’s English text for every mix it names', () => {
    for (const mix of engineMixes) {
      expect([mix.id, localizedPlaylistName(mix)]).toEqual([mix.id, mix.name]);
      expect([mix.id, localizedPlaylistDescription(mix)]).toEqual([mix.id, mix.description]);
    }
  });

  it('translate every engine mix by id', async () => {
    await setLanguage('fr');
    for (const mix of engineMixes) {
      expect([mix.id, localizedPlaylistName(mix)]).not.toEqual([mix.id, mix.name]);
    }
    const daily = engineMixes.find((mix) => mix.id === 'smart_daily_mix')!;
    expect(localizedPlaylistName(daily)).toBe('Mix du jour');
  });

  it('keep the genre value untranslated inside genre mixes', async () => {
    const genre = genreMixDefinition('Hip-Hop', 1000);
    await setLanguage('es');
    expect(localizedPlaylistName(genre)).toBe('Mix de Hip-Hop');
    expect(localizedPlaylistDescription(genre)).toBe('Mix basado en tus canciones de Hip-Hop.');
  });

  it('leave custom playlists and unknown ids as stored', async () => {
    await setLanguage('zh-CN');
    const custom: Named = { id: 'custom_1', name: 'Daily Mix', description: 'Road songs', type: 'custom' };
    expect(localizedPlaylistName(custom)).toBe('Daily Mix');
    expect(localizedPlaylistDescription(custom)).toBe('Road songs');
    const unknown: Named = { id: 'smart_future_mix', name: 'Future Mix', description: 'Something new.', type: 'smart' };
    expect(localizedPlaylistName(unknown)).toBe('Future Mix');
    expect(localizedPlaylistDescription(unknown)).toBe('Something new.');
  });

  it('treat legacy placeholder descriptions of custom playlists as empty', () => {
    expect(localizedPlaylistDescription({ id: 'custom_2', description: 'Custom playlist', type: 'custom' })).toBe('');
    expect(localizedPlaylistDescription({ id: 'custom_3', description: 'User playlist', type: 'custom' })).toBe('');
  });
});
