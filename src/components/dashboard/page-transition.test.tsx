import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsolePageTransition } from './page-transition';

const originalAnimate = Element.prototype.animate;
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }) as unknown as Animation);

beforeEach(() => {
  // jsdom has no compositor. Only the browser animation boundary is replaced;
  // React state, focus, effect cleanup and the rendered content remain real.
  Element.prototype.animate = animate;
  animate.mockClear();
  cancel.mockClear();
});
afterEach(() => {
  Element.prototype.animate = originalAnimate;
  vi.restoreAllMocks();
});

function Draft() {
  const [value, setValue] = useState('');
  return (
    <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
  );
}

describe('ConsolePageTransition', () => {
  it('animates a new page without remounting content on ordinary updates', () => {
    const { rerender } = render(
      <ConsolePageTransition pageKey="/dashboard">
        <Draft />
      </ConsolePageTransition>
    );
    expect(animate).toHaveBeenCalledTimes(1);
    const input = screen.getByRole('textbox', { name: 'Draft' });
    input.focus();
    fireEvent.change(input, { target: { value: 'unfinished' } });
    rerender(
      <ConsolePageTransition pageKey="/dashboard">
        <Draft />
      </ConsolePageTransition>
    );
    expect(animate).toHaveBeenCalledTimes(1);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('unfinished');
    rerender(
      <ConsolePageTransition pageKey="/dashboard/jobs">
        <Draft />
      </ConsolePageTransition>
    );
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toBe(input);
  });

  it('cancels in-flight motion on unmount without hiding late content', () => {
    const { rerender, unmount } = render(
      <ConsolePageTransition pageKey="/dashboard">Loading</ConsolePageTransition>
    );
    rerender(
      <ConsolePageTransition pageKey="/dashboard">
        <button>Loaded later</button>
      </ConsolePageTransition>
    );
    expect(animate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Loaded later' })).toBeVisible();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('renders immediately when reduced motion is requested', () => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...media, matches: true });
    render(
      <ConsolePageTransition pageKey="/dashboard">
        <button>Ready</button>
      </ConsolePageTransition>
    );
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ready' })).toBeVisible();
  });

  it('leaves content visible when the animation API is unavailable', () => {
    Element.prototype.animate = undefined as unknown as typeof originalAnimate;
    render(
      <ConsolePageTransition pageKey="/dashboard">
        <button>Ready</button>
      </ConsolePageTransition>
    );
    expect(screen.getByRole('button', { name: 'Ready' })).toBeVisible();
  });
});
