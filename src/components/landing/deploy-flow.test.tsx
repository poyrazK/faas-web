import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const motion = { reduced: false };

const { DEPLOY_STEPS, DeployFlow, stepState } = await import('./deploy-flow');

let visible: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
beforeEach(() => {
  motion.reduced = false;
  visible = undefined;
  vi.stubGlobal(
    'matchMedia',
    (q: string) =>
      ({
        matches: q.includes('reduce') ? motion.reduced : false,
        addEventListener() {},
        removeEventListener() {},
      }) as never
  );
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

  it('rests on the finished deploy under reduced motion, and starts nothing', () => {
    vi.useFakeTimers();
    motion.reduced = true;
    render(<DeployFlow />);
    expect(counts()).toEqual({ done: 12, running: 0 });
    expect(screen.getByText('12 of 12 steps done')).toBeInTheDocument();
    expect(visible).toBeUndefined();
    act(() => vi.advanceTimersByTime(650 * 5));
    expect(counts().done).toBe(12);
  });

  it('leaves no timers behind once unmounted', () => {
    vi.useFakeTimers();
    const view = render(<DeployFlow />);
    act(() => visible?.([{ isIntersecting: true }]));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws the five connectors on a wide screen and none on a narrow one', () => {
    const rect = (l: number, t: number, w: number, h: number) =>
      ({
        left: l,
        top: t,
        right: l + w,
        bottom: t + h,
        width: w,
        height: h,
        x: l,
        y: t,
      }) as DOMRect;
    const boxes: Record<string, DOMRect> = {
      agent: rect(60, 70, 368, 120),
      repo: rect(60, 220, 368, 150),
      prompt: rect(60, 430, 368, 120),
      deploy: rect(492, 130, 320, 370),
      url: rect(876, 70, 368, 220),
      preview: rect(876, 320, 368, 260),
    };
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const id = this.dataset.flow;
      return id ? boxes[id] : rect(0, 0, 1280, 640);
    };
    try {
      vi.stubGlobal('innerWidth', 1280);
      const wide = render(<DeployFlow />);
      expect(wide.container.querySelectorAll('.deploy-flow-lines path')).toHaveLength(5);
      wide.unmount();
      vi.stubGlobal('innerWidth', 800);
      const narrow = render(<DeployFlow />);
      expect(narrow.container.querySelectorAll('.deploy-flow-lines path')).toHaveLength(0);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it('hides the animated picture from screen readers behind a plain-text summary', () => {
    const { container } = render(<DeployFlow />);
    expect(container.querySelector('[aria-hidden="true"].deploy-flow-stage')).not.toBeNull();
    expect(screen.queryByText('Example data')).toBeNull();
  });
});
