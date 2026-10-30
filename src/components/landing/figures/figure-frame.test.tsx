import { Profiler, useEffect } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigureFrame, toFigure, useFigure, type FigureState } from './figure-frame';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => motion.reduced,
}));

const COARSE = '(hover: none), (pointer: coarse)';
let seen: FigureState | null = null;
function Probe() {
  const state = useFigure();
  // Captured after commit: the React Compiler lint forbids writing outer
  // variables during render.
  useEffect(() => {
    seen = state;
  });
  return null;
}

function stubRect(el: HTMLElement, width = 504, height = 200) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function mount() {
  const view = render(
    <div tabIndex={0} data-testid="host">
      <FigureFrame name="probe">
        <Probe />
      </FigureFrame>
    </div>
  );
  const frame = view.container.querySelector<HTMLElement>('[data-figure="probe"]')!;
  stubRect(frame);
  return { ...view, frame, host: view.getByTestId('host') };
}

function setCoarse(on: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: on && query === COARSE,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

beforeEach(() => {
  motion.reduced = false;
  seen = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('toFigure', () => {
  it('maps client points into the 420 × 200 frame under meet, with the letterbox', () => {
    const wide = { left: 0, top: 0, width: 504, height: 200 };
    expect(toFigure(252, 100, wide)).toEqual([210, 100]);
    expect(toFigure(42, 0, wide)).toEqual([0, 0]);
    const tall = { left: 0, top: 0, width: 420, height: 300 };
    expect(toFigure(210, 150, tall)).toEqual([210, 100]);
  });

  it('clamps points outside the frame and refuses an unmeasured box', () => {
    const wide = { left: 0, top: 0, width: 504, height: 200 };
    expect(toFigure(1000, 500, wide)).toEqual([420, 200]);
    expect(toFigure(-50, -50, wide)).toEqual([0, 0]);
    expect(toFigure(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('FigureFrame', () => {
  it('renders a named, decorative SVG frame', () => {
    const { frame } = mount();
    const svg = frame.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 420 200');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('starts at rest in the centre', () => {
    mount();
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.pointer.y.get()).toBe(100);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('follows the pointer while over the frame and lets go when it leaves', () => {
    const { frame } = mount();
    fireEvent.pointerEnter(frame, { clientX: 294, clientY: 50 });
    fireEvent.pointerMove(frame, { clientX: 294, clientY: 50 });
    expect(seen!.pointer.x.get()).toBe(252);
    expect(seen!.pointer.y.get()).toBe(50);
    expect(seen!.pointer.target.get()).toBe(1);
    fireEvent.pointerLeave(frame);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('centres and wakes on keyboard focus of the panel, and rests on blur', () => {
    const { frame, host } = mount();
    fireEvent.pointerMove(frame, { clientX: 294, clientY: 50 });
    fireEvent.focusIn(host);
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.pointer.y.get()).toBe(100);
    expect(seen!.pointer.target.get()).toBe(1);
    fireEvent.focusOut(host);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('stays at rest under reduced motion', () => {
    motion.reduced = true;
    const { frame, host } = mount();
    fireEvent.pointerMove(frame, { clientX: 294, clientY: 50 });
    fireEvent.focusIn(host);
    expect(seen!.pointer.target.get()).toBe(0);
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.reduced).toBe(true);
  });

  it('ignores touch on a coarse pointer and does not drift out of view', async () => {
    setCoarse(true);
    const { frame } = mount();
    fireEvent.pointerMove(frame, { pointerType: 'touch', clientX: 294, clientY: 50 });
    expect(seen!.pointer.x.get()).toBe(210);
    // The setup's IntersectionObserver never intersects: no drift.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(seen!.pointer.x.get()).toBe(210);
    expect(seen!.pointer.target.get()).toBe(0);
  });

  it('drifts on a coarse pointer in view, and stops cleanly when unmounted mid-drift', async () => {
    setCoarse(true);
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.push(callback);
        }
        observe(target: Element) {
          for (const cb of observers)
            cb(
              [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver
            );
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      }
    );
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = mount();
    await waitFor(() => expect(seen!.pointer.target.get()).toBe(1));
    await waitFor(() => expect(seen!.pointer.x.get()).not.toBe(210));
    expect(() => unmount()).not.toThrow();
    expect(cancel).toHaveBeenCalled();
  });

  it('moves without a single React commit', async () => {
    let commits = 0;
    const view = render(
      <Profiler id="figure" onRender={() => (commits += 1)}>
        <FigureFrame name="probe">
          <Probe />
        </FigureFrame>
      </Profiler>
    );
    const frame = view.container.querySelector<HTMLElement>('[data-figure="probe"]')!;
    stubRect(frame);
    await act(async () => {});
    const before = commits;
    fireEvent.pointerEnter(frame, { clientX: 50, clientY: 100 });
    for (let i = 0; i < 50; i++)
      fireEvent.pointerMove(frame, { clientX: 50 + 8 * i, clientY: 100 });
    fireEvent.pointerLeave(frame);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(commits).toBe(before);
  });

  it('refuses useFigure outside a frame', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside a FigureFrame/);
  });
});
