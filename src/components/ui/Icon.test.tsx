import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, ICON_NAMES } from './Icon';

describe('Icon', () => {
  it.each(ICON_NAMES)('renders "%s" as an <svg> with at least one non-empty <path>', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');

    const paths = Array.from(svg!.querySelectorAll('path'));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.getAttribute('d')?.trim()).toBeTruthy();
    }
  });

  it('exposes a non-empty, duplicate-free ICON_NAMES list', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('defaults to size 16 and honours an explicit size', () => {
    const { container: defaults } = render(<Icon name="play" />);
    const defaultSvg = defaults.querySelector('svg')!;
    expect(defaultSvg).toHaveAttribute('width', '16');
    expect(defaultSvg).toHaveAttribute('height', '16');

    const { container: sized } = render(<Icon name="play" size={24} />);
    const sizedSvg = sized.querySelector('svg')!;
    expect(sizedSvg).toHaveAttribute('width', '24');
    expect(sizedSvg).toHaveAttribute('height', '24');
  });

  it('is aria-hidden without a label and an img with one', () => {
    const { container: hidden } = render(<Icon name="search" />);
    const hiddenSvg = hidden.querySelector('svg')!;
    expect(hiddenSvg).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenSvg).not.toHaveAttribute('role');
    expect(hiddenSvg).not.toHaveAttribute('aria-label');

    const { getByRole } = render(<Icon name="search" label="Search" />);
    const labelled = getByRole('img', { name: 'Search' });
    expect(labelled).toHaveAttribute('aria-label', 'Search');
    expect(labelled).not.toHaveAttribute('aria-hidden');
  });

  it('paints filled icons with currentColor and no stroke on the path', () => {
    const { container } = render(<Icon name="heart-filled" />);
    const path = container.querySelector('path')!;
    expect(path).toHaveAttribute('fill', 'currentColor');
    expect(path).toHaveAttribute('stroke', 'none');
  });

  it('merges className, strokeWidth and passes through extra svg props', () => {
    const { container } = render(<Icon name="close" className="text-red-500" strokeWidth={2} data-testid="x" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveClass('shrink-0', 'text-red-500');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('data-testid', 'x');
  });
});
