import { render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LibraryPage from '@/pages/Library';
import { useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types/music';

const song = (id: string, artist: string, album: string): Song =>
  ({
    id,
    title: `Track ${id}`,
    artist,
    album,
    genre: 'Rock',
    duration: 200,
    path: `C:/music/${id}.mp3`,
    source: '',
    filename: `${id}.mp3`,
    favorite: false,
    playCount: 0,
    addedAt: 1,
  }) as unknown as Song;

describe('Library page smoke', () => {
  it('renders every tab without update loops', () => {
    useLibraryStore.setState({
      songs: [song('a', 'Artist 1', 'Album 1'), song('b', 'Artist 2', 'Album 2')],
      initialized: true,
    });
    render(
      <HashRouter>
        <LibraryPage />
      </HashRouter>,
    );
    expect(screen.getByRole('heading', { name: /library/i })).toBeInTheDocument();
    for (const tab of ['Albums', 'Artists', 'Genres', 'Songs']) {
      const button = screen.queryByRole('tab', { name: new RegExp(tab, 'i') });
      if (button) {
        button.click();
      }
    }
  }, 15000);
});
