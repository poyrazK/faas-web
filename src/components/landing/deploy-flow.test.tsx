import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduced,
}));

const { DEPLOY_STEPS, DeployFlow, stepState } = await import('./deploy-flow');

let visible: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
beforeEach(() => {
  motion.reduced = false;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: typeof visible) {
        visible = cb;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-state]')];
const counts = () => {
  const s = rows().map((r) => r.dataset.state);
  return {
    done: s.filter((x) => x === 'done').length,
    running: s.filter((x) => x === 'running').length,
  };
};

describe('stepState', () => {
  it('runs three steps at a time, each done three beats after it starts', () => {
    expect([0, 1, 2, 3].map((i) => stepState(2, i))).toEqual([
      'running',
      'running',
      'running',
      'pending',
    ]);
    expect(stepState(3, 0)).toBe('done');
  });
});

describe('DeployFlow', () => {
  it('renders mid-deploy before it moves, so the server frame reads alive', () => {
    render(<DeployFlow />);
    expect(rows()).toHaveLength(DEPLOY_STEPS.length);
    expect(counts()).toEqual({ done: 4, running: 3 });
    expect(screen.getByText('4 of 12 steps done')).toBeInTheDocument();
    expect(screen.getByText('Release 42 · 3 running')).toBeInTheDocument();
  });

  it('only moves while on screen', () => {
    vi.useFakeTimers();
    render(<DeployFlow />);
    act(() => vi.advanceTimersByTime(2000));
    expect(counts().done).toBe(4);
    act(() => visible?.([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(650 * 3));
    expect(counts().done).toBe(7);
    act(() => visible?.([{ isIntersecting: false }]));
    act(() => vi.advanceTimersByTime(650 * 5));
    expect(counts().done).toBe(7);
  });

  it('rests on the finished deploy under reduced motion', () => {
    motion.reduced = true;
    render(<DeployFlow />);
    expect(counts()).toEqual({ done: 12, running: 0 });
    expect(screen.getByText('12 of 12 steps done')).toBeInTheDocument();
  });

  it('hides the animated picture from screen readers and labels it as an example', () => {
    const { container } = render(<DeployFlow />);
    expect(container.querySelector('[aria-hidden="true"].deploy-flow-stage')).not.toBeNull();
    expect(screen.getByText('Example data')).toBeInTheDocument();
  });
});
