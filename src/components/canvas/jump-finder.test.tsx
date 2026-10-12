import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JumpFinder } from './jump-finder';

const items = [
  { id: 'app:api-gateway', title: 'api-gateway', kind: 'app' as const },
  { id: 'domain:api.acme.dev', title: 'api.acme.dev', kind: 'domain' as const },
  { id: 'bucket:a/uploads', title: 'uploads', kind: 'bucket' as const },
];

describe('JumpFinder', () => {
  it('filters as you type and jumps on enter', () => {
    const onPick = vi.fn();
    render(<JumpFinder items={items} onPick={onPick} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Jump to a node' });
    fireEvent.change(input, { target: { value: 'upl' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('uploads'),
    ]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('bucket:a/uploads');
  });

  it('moves with arrow keys', () => {
    const onPick = vi.fn();
    render(<JumpFinder items={items} onPick={onPick} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Jump to a node' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('domain:api.acme.dev');
  });

  it('closes on escape and says when nothing matches', () => {
    const onClose = vi.fn();
    render(<JumpFinder items={items} onPick={vi.fn()} onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Jump to a node' });
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByText('No node matches')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Esc to itself, so the page and wizard do not also act on it', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<JumpFinder items={items} onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Jump to a node' }), { key: 'Escape' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('announces the highlighted option as the arrows move', () => {
    render(<JumpFinder items={items} onPick={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Jump to a node' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const id = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(id!)).toHaveAttribute('aria-selected', 'true');
  });

  it('closes when focus goes elsewhere', () => {
    const onClose = vi.fn();
    render(<JumpFinder items={items} onPick={vi.fn()} onClose={onClose} />);
    fireEvent.blur(screen.getByRole('combobox', { name: 'Jump to a node' }));
    expect(onClose).toHaveBeenCalled();
  });
});
