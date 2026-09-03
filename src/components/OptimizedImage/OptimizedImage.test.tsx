// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptimizedImage } from './OptimizedImage';

afterEach(cleanup);

describe('OptimizedImage', () => {
  it('keeps data-url artwork lazy unless the caller marks it eager', () => {
    render(<OptimizedImage src="data:image/jpeg;base64,bGF6eQ==" alt="Lazy cover" />);

    const image = screen.getByRole('img', { name: 'Lazy cover' });
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('fetchpriority')).toBe('auto');
  });

  it('gives explicitly eager artwork high fetch priority', () => {
    render(
      <OptimizedImage
        src="data:image/jpeg;base64,ZWFnbGU="
        alt="Current cover"
        loading="eager"
      />,
    );

    const image = screen.getByRole('img', { name: 'Current cover' });
    expect(image.getAttribute('loading')).toBe('eager');
    expect(image.getAttribute('fetchpriority')).toBe('high');
  });

  it('reveals artwork and notifies once when loading completes', () => {
    const onLoad = vi.fn();
    render(
      <OptimizedImage
        src="data:image/jpeg;base64,bG9hZGVk"
        alt="Loaded cover"
        onLoad={onLoad}
      />,
    );

    const image = screen.getByRole('img', { name: 'Loaded cover' });
    expect(image.className).toContain('opacity-0');

    fireEvent.load(image);
    fireEvent.load(image);

    expect(image.className).toContain('opacity-100');
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
