import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';

describe('Button / IconButton', () => {
  it('renders variants, icons and loading state', () => {
    const { rerender } = render(
      <Button variant="primary" icon="play">
        Play
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button.className).toContain('neu-accent');
    expect(button.querySelector('svg')).not.toBeNull();
    rerender(
      <Button loading pressed>
        Save
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('IconButton always has an accessible name', () => {
    render(<IconButton name="trash" label="Delete song" variant="danger" />);
    const button = screen.getByRole('button', { name: 'Delete song' });
    expect(button).toHaveAttribute('title', 'Delete song');
    expect(button.className).toContain('neu-danger');
  });
});

describe('Toggle', () => {
  it('is a switch and reports changes', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Dark mode" description="Switch themes" />);
    const input = screen.getByRole('switch', { name: /dark mode/i });
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Slider', () => {
  it('exposes fill, clamps and commits', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Slider value={150} min={0} max={100} ariaLabel="Volume" onChange={onChange} onCommit={onCommit} formatValue={(v) => `${v}%`} />);
    const input = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    expect(input.value).toBe('100');
    expect(input.style.getPropertyValue('--fill')).toBe('100%');
    expect(input).toHaveAttribute('aria-valuetext', '100%');
    fireEvent.change(input, { target: { value: '40' } });
    expect(onChange).toHaveBeenCalledWith(40);
    fireEvent.keyUp(input, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalled();
  });
});

describe('SegmentedTabs', () => {
  it('supports arrow-key navigation', () => {
    const Harness = () => {
      const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
      return (
        <SegmentedTabs
          tabs={[
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
            { label: 'C', value: 'c' },
          ]}
          value={value}
          onChange={setValue}
          ariaLabel="Views"
        />
      );
    };
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Views' });
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Modal / ConfirmDialog', () => {
  it('closes on Escape, traps Tab and labels itself', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Pick a playlist" description="Choose one">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Pick a playlist' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Choose one');
    const second = screen.getByRole('button', { name: 'Second' });
    second.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed and confirms', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<ConfirmDialog open={false} onClose={() => {}} onConfirm={onConfirm} title="Delete?" body="Gone forever." danger />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(<ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="Delete?" body="Gone forever." danger confirmLabel="Delete" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
