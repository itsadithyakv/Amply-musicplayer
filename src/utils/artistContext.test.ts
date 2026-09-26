import { describe, expect, it } from 'vitest';
import { getArtistLookupContext } from '@/utils/artists';

const song = (artist: string, title: string, album = 'Unknown Album') => ({ artist, title, album });

describe('getArtistLookupContext', () => {
  it('collects cleaned titles and real albums for the lookup artist', () => {
    const context = getArtistLookupContext(
      [
        song('Berlin', 'Take My Breath Away - 2011 Remaster', 'Top Gun'),
        song('Berlin', 'Take My Breath Away', 'Top Gun'),
        song('Berlin', 'The Metro'),
        song('Nirvana', 'Lithium', 'Nevermind'),
      ],
      'Berlin',
    );
    expect(context.titles).toEqual(['Take My Breath Away', 'The Metro']);
    expect(context.albums).toEqual(['Top Gun']);
  });

  it('falls back to songs the artist is featured on', () => {
    const context = getArtistLookupContext([song('50 Cent, Olivia', 'Candy Shop', 'Best Of 50 Cent')], 'Olivia');
    expect(context.titles).toEqual(['Candy Shop']);
    expect(context.albums).toEqual(['Best Of 50 Cent']);
  });

  it('matches stylised names and ignores other acts', () => {
    const songs = [song('A$AP Rocky', 'Praise The Lord (Da Shine)'), song('Drake Bell', 'Found A Way')];
    expect(getArtistLookupContext(songs, 'ASAP Rocky').titles).toEqual(['Praise The Lord (Da Shine)']);
    expect(getArtistLookupContext(songs, 'Drake').titles).toEqual([]);
  });
});
