// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OverlayPage from './index';

type OverlayListener = (event: { payload: unknown }) => void;

const tauri = vi.hoisted(() => ({ enabled: false }));
const overlayListeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock('@/services/storageService', () => ({ isTauri: () => tauri.enabled }));
vi.mock('@/components/ArtworkImage/ArtworkImage', () => ({
  ArtworkImage: ({ alt = '' }: { alt?: string }) => <div role="img" aria-label={alt} />,
}));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async (name: string, handler: OverlayListener) => {
    overlayListeners.set(name, handler);
    return () => overlayListeners.delete(name);
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  getCurrentWindow: () => ({
    setBackgroundColor: vi.fn(async () => undefined),
    setSize: vi.fn(async () => undefined),
    startDragging: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  tauri.enabled = false;
  overlayListeners.clear();
  delete document.documentElement.dataset.theme;
});

describe('OverlayPage', () => {
  it('keeps playback controls mounted for instant expansion', () => {
    render(<OverlayPage />);
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move overlay' })).toBeTruthy();
  });

  it('collapses to artwork and play at rest and expands on hover', () => {
    render(<OverlayPage />);
    const surface = screen.getByTestId('overlay-surface');
    const details = screen.getByTestId('overlay-details');
    expect(surface.dataset.state).toBe('collapsed');
    expect(details.getAttribute('aria-hidden')).toBe('true');

    fireEvent.pointerEnter(surface);
    expect(surface.dataset.state).toBe('expanded');
    expect(details.getAttribute('aria-hidden')).toBe('false');

    fireEvent.pointerLeave(surface);
    expect(surface.dataset.state).toBe('collapsed');
    expect(details.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows paused record artwork until playback starts', () => {
    render(<OverlayPage />);
    const artwork = screen.getByTestId('overlay-artwork');
    expect(artwork.className).toContain('rounded-full');
    expect(artwork.style.animationPlayState).toBe('paused');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(artwork.style.animationPlayState).toBe('running');
  });

  it('updates play state optimistically', () => {
    render(<OverlayPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('applies the theme carried by the overlay state payload', async () => {
    tauri.enabled = true;
    render(<OverlayPage />);
    await act(async () => {
      await Promise.resolve();
    });
    const handler = overlayListeners.get('amply://overlay-state');
    expect(handler).toBeTypeOf('function');

    act(() => {
      handler?.({
        payload: { title: 'Song', artist: 'Artist', albumArt: null, isPlaying: true, spinningArtwork: true, theme: 'dark' },
      });
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
});
