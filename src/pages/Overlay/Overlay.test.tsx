// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OverlayPage from './index';

vi.mock('@/services/storageService', () => ({ isTauri: () => false }));
vi.mock('@/components/ArtworkImage/ArtworkImage', () => ({
  ArtworkImage: ({ alt = '' }: { alt?: string }) => <div role="img" aria-label={alt} />,
}));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setBackgroundColor: vi.fn(),
    startDragging: vi.fn(),
  }),
}));

afterEach(cleanup);

describe('OverlayPage', () => {
  it('keeps playback controls mounted for instant expansion', () => {
    render(<OverlayPage />);
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move overlay' })).toBeTruthy();
  });

  it('collapses to artwork and play while staying barely visible at rest', () => {
    render(<OverlayPage />);
    const surface = screen.getByTestId('overlay-surface');
    const details = screen.getByTestId('overlay-details');
    expect(surface.className).toContain('w-[104px]');
    expect(surface.className).toContain('hover:w-[324px]');
    expect(surface.className).toContain('bg-[#171513]/10');
    expect(surface.className).toContain('hover:bg-[rgba(23,21,19,0.96)]');
    expect(surface.className).not.toContain('shadow');
    expect(details.className).toContain('invisible');
    expect(details.className).toContain('group-hover:visible');
  });

  it('shows paused record artwork until playback starts', () => {
    render(<OverlayPage />);
    const artwork = screen.getByTestId('overlay-artwork');
    expect(artwork.className).toContain('rounded-full');
    expect(artwork.className).toContain('animate-[spin_8s_linear_infinite]');
    expect(artwork.style.animationPlayState).toBe('paused');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(artwork.style.animationPlayState).toBe('running');
  });

  it('updates play state optimistically', () => {
    render(<OverlayPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
});
