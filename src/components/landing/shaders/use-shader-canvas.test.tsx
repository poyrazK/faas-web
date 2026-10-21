import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShaderCanvas } from './use-shader-canvas';

let draws = 0;
let rafs: FrameRequestCallback[] = [];

function fakeGl() {
  const fn = () => () => undefined;
  const special: Record<string, unknown> = {
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isContextLost: () => false,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    drawArrays: () => {
      draws += 1;
    },
  };
  return new Proxy({}, { get: (_, k: string) => (k in special ? special[k] : fn()) });
}

beforeEach(() => {
  draws = 0;
  rafs = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeGl() as never);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafs.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
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
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe({ active, onRedraw }: { active: boolean; onRedraw?: (r: () => void) => void }) {
  const { hostRef, canvasRef, redraw } = useShaderCanvas({
    frag: 'void main(){}',
    label: 't',
    active,
  });
  onRedraw?.(redraw);
  return (
    <div ref={hostRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

describe('useShaderCanvas active', () => {
  it('runs its loop when active, as before', () => {
    render(<Probe active />);
    expect(rafs.length).toBeGreaterThan(0);
  });

  // Every visibility sync repaints the still frame (the observer reports on
  // observe), so count "drew, and scheduled nothing", not an exact number.
  it('draws a still frame and schedules nothing when inactive', () => {
    render(<Probe active={false} />);
    expect(draws).toBeGreaterThanOrEqual(1);
    expect(rafs).toHaveLength(0);
  });

  it('starts when it becomes active and holds a still frame when it stops', () => {
    const { rerender } = render(<Probe active={false} />);
    rerender(<Probe active />);
    expect(rafs.length).toBeGreaterThan(0);
    const before = draws;
    rerender(<Probe active={false} />);
    expect(draws).toBe(before + 1);
  });

  it('repaints a still frame on redraw (a theme change)', () => {
    let redraw: () => void = () => undefined;
    render(<Probe active={false} onRedraw={(r) => (redraw = r)} />);
    const before = draws;
    redraw();
    expect(draws).toBe(before + 1);
  });
});
