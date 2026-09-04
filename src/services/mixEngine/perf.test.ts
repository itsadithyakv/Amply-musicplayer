import { describe, expect, it } from 'vitest';
import { baseInput, buildLibrary } from './fixtures';
import { generateMixes, generateMixesLite } from './index';

describe('mix engine performance', () => {
  const library = buildLibrary({ songs: 10_000, artists: 600, albumsPerArtist: 4, withEvents: true, seed: 3 });
  const input = baseInput(library.songs, { events: library.events });

  it('generates every mix for 10k songs in under 1500 ms', () => {
    generateMixes(input); // warm up JIT and genre cache
    const started = performance.now();
    const result = generateMixes(input);
    const elapsed = performance.now() - started;
    expect(result.playlists.length).toBeGreaterThan(20);
    expect(elapsed).toBeLessThan(1500);
  });

  it('generates the lite set for 10k songs in under 400 ms', () => {
    generateMixesLite(input);
    const started = performance.now();
    generateMixesLite(input);
    expect(performance.now() - started).toBeLessThan(400);
  });
});
