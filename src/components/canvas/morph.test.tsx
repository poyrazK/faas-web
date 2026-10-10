import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Morph } from './morph';

const rect = (x: number, y: number, w: number, h: number) =>
  ({
    x,
    y,
    width: w,
    height: h,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  }) as DOMRect;

describe('Morph', () => {
  it('starts on the card and finishes on the node', async () => {
    const onDone = vi.fn();
    render(
      <Morph from={rect(100, 100, 440, 320)} to={() => rect(300, 200, 248, 96)} onDone={onDone} />
    );
    // Portalled to the body: a transformed ancestor would trap `position: fixed`.
    const box = document.querySelector('[data-morph]') as HTMLElement;
    expect(box.style.width).toBe('440px');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 1500 });
  });

  it('finishes immediately when the node cannot be found', async () => {
    const onDone = vi.fn();
    render(<Morph from={rect(0, 0, 10, 10)} to={() => null} onDone={onDone} />);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('holds on the card while the app is still loading', async () => {
    const onDone = vi.fn();
    const to = vi.fn(() => rect(300, 200, 248, 96));
    const { rerender } = render(<Morph from={rect(0, 0, 10, 10)} to={to} hold onDone={onDone} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(to).not.toHaveBeenCalled();
    rerender(<Morph from={rect(0, 0, 10, 10)} to={to} onDone={onDone} />);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 1500 });
  });
});
