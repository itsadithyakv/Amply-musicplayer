import { describe, expect, it } from 'vitest';
import { getDisplayTitleRepair, getMetadataLookupParts } from '@/utils/artists';
import { isUploadNoise, isVersionQualifier, stripForLookup, stripUploadNoise } from '@/utils/titles';

describe('display repair', () => {
  // Every case here was a real title in the library that the old substring cleaner broke.
  it.each([
    ['Black Sabbath', 'War Pigs - 2009 Remaster'],
    ['Black Sabbath', 'Iron Man (2012 Remaster)'],
    ['Eagles', 'Hotel California - 2013 Remaster'],
    ['Frank Sinatra', 'My Way - 2008 Remastered'],
    ['A$AP Rocky', '29 Intro'],
    ['Radiohead', 'Let Down - Choir Outro'],
    ['Future', 'Bunce Road Blues (with Future & Tems)'],
    ['John Denver', 'Take Me Home, Country Roads (Original Version) [Remastered]'],
    ['Katy Perry', 'Birthday'],
    ['Eminem', "Cleanin' Out My Closet"],
    ['Clean Bandit', 'Rather Be'],
    // Trailing periods are part of these names.
    ['Kendrick Lamar', 'HUMBLE.'],
    ['Gorillaz', 'Feel Good Inc.'],
    ['AC/DC', 'T.N.T.'],
  ])('leaves "%s - %s" as tagged', (artist, title) => {
    expect(getDisplayTitleRepair(artist, title)).toBeNull();
  });

  it('removes upload junk and a matching artist prefix', () => {
    expect(getDisplayTitleRepair('Daft Punk', 'Daft Punk - Around the World (Official Audio)')).toBe('Around the World');
    expect(getDisplayTitleRepair('Skrillex', 'Bangarang [FREE DL]')).toBe('Bangarang');
    expect(getDisplayTitleRepair('Kanye West', 'Kanye West - Never See Me Again - High Quality Vocals + Orchestral Intro - TheFloridaMan')).toBe(
      'Never See Me Again',
    );
    expect(getDisplayTitleRepair('Metro Boomin', 'Superhero (prod. Metro Boomin) [HD]')).toBe('Superhero');
  });

  it('never leaves a dangling bracket', () => {
    expect(stripUploadNoise('Around the World (Official Audio)')).toBe('Around the World');
    expect(stripUploadNoise('Song (Lyrics) [4K]')).toBe('Song');
  });
});

describe('upload noise', () => {
  it('matches junk segments only', () => {
    expect(isUploadNoise('Official Music Video')).toBe(true);
    expect(isUploadNoise('HD')).toBe(true);
    expect(isUploadNoise('prod. Metro Boomin')).toBe(true);
    expect(isUploadNoise('Clean')).toBe(true);
    expect(isUploadNoise('Clean Bandit Remix')).toBe(false);
    expect(isUploadNoise("Backstreet's Back")).toBe(false);
  });
});

describe('version qualifiers', () => {
  it.each([
    '2009 Remaster',
    'Remastered 2025',
    'Radio Edit',
    'Album Version (Edited)',
    'Single Version',
    'Original Version',
    'From "Bangalore Days"',
    'From "Shrek 2" Soundtrack',
    'Music From The Motion Picture Baby Driver',
    'feat. Pitbull',
    'with The Royal Philharmonic Orchestra',
    'Nightcore Version',
    'Sped Up',
    '2012',
    'Take 1',
    'Remix',
    'Skrillex Remix',
    'Live',
    'Live at Wembley',
  ])('"%s" is a version', (segment) => {
    expect(isVersionQualifier(segment)).toBe(true);
  });

  it.each(['Pt. 2', 'Part 1', 'Reprise', 'Interlude', 'Mixtape', 'Liver', 'Choir Outro', "Backstreet's Back", 'Wish Death', 'Put a Ring on It', ''])(
    '"%s" is part of the name',
    (segment) => {
      expect(isVersionQualifier(segment)).toBe(false);
    },
  );
});

describe('lookup cleaning', () => {
  it('finds the song behind version suffixes', () => {
    expect(stripForLookup('War Pigs - 2009 Remaster')).toBe('War Pigs');
    expect(stripForLookup('Many Men (Wish Death) - Album Version (Edited)')).toBe('Many Men (Wish Death)');
    expect(stripForLookup('Maangalyam - From "Bangalore Days"')).toBe('Maangalyam');
    expect(stripForLookup('Everybody (Backstreet\'s Back) - Radio Edit')).toBe("Everybody (Backstreet's Back)");
    expect(stripForLookup('Mmm Yeah - feat. Pitbull')).toBe('Mmm Yeah');
    expect(stripForLookup('29 Intro')).toBe('29 Intro');
  });

  it('keeps the tagged artist and reads a version suffix as a version, not an artist', () => {
    expect(getMetadataLookupParts('Black Sabbath', 'War Pigs - 2009 Remaster')).toEqual({ artist: 'Black Sabbath', title: 'War Pigs' });
    expect(getMetadataLookupParts('Unknown Artist', 'War Pigs - 2009 Remaster').title).toBe('War Pigs');
    expect(getMetadataLookupParts('Unknown Artist', 'Daft Punk - Around the World')).toEqual({ artist: 'Daft Punk', title: 'Around the World' });
  });
});
