import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from './timestamp';

afterEach(() => vi.useRealTimers());

describe('Timestamp', () => {
  it('shows relative text with the exact time on hover', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 20, 12, 0, 0) });
    const iso = '2026-10-20T11:55:00.000Z';
    render(<Timestamp value={iso} className="text-xs" />);

    const el = screen.getByText('5m ago');
    expect(el.tagName).toBe('TIME');
    expect(el).toHaveAttribute('dateTime', iso);
    expect(el).toHaveAttribute('title', expect.stringMatching(/2026/));
    expect(el).toHaveClass('text-xs');
  });

  it('reads a future time as "in …"', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 20, 12, 0, 0) });
    render(<Timestamp value="2026-10-26T12:00:30Z" />);
    expect(screen.getByText('in 6d')).toBeInTheDocument();
  });

  it('can show the absolute time as its text', () => {
    const iso = '2026-10-20T14:03:05.000Z';
    render(<Timestamp value={iso} mode="absolute" />);
    const el = screen.getByRole('time');
    expect(el).toHaveTextContent(/2026/);
    expect(el).toHaveAttribute('title', el.textContent ?? '');
  });

  it.each([undefined, null, '', 'garbage', 0])('renders a dash for %j', (value) => {
    const { container } = render(<Timestamp value={value} />);
    expect(container).toHaveTextContent('—');
    expect(container.querySelector('time')).toBeNull();
  });
});
