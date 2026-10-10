import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { panToShow, useCamera } from './camera';

describe('useCamera', () => {
  it('does not re-render its caller on unrelated store changes', () => {
    let renders = 0;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ReactFlowProvider>{children}</ReactFlowProvider>
    );
    const { result } = renderHook(
      () => {
        renders += 1;
        return { camera: useCamera(), store: useStoreApi() };
      },
      { wrapper }
    );
    const before = renders;
    act(() => result.current.store.setState({ minZoom: 0.42 }));
    act(() => result.current.store.setState({ maxZoom: 1.9 }));
    expect(renders).toBe(before);
  });
});

describe('panToShow', () => {
  const view = { x: 0, y: 0, width: 1000, height: 600 };

  it('does not move for a box already in view', () => {
    expect(panToShow({ x: 100, y: 100, width: 248, height: 120 }, view, 48)).toEqual({
      fits: true,
      dx: 0,
      dy: 0,
    });
  });

  it('pans just far enough to clear the right and bottom edges', () => {
    expect(panToShow({ x: 900, y: 550, width: 248, height: 120 }, view, 48)).toEqual({
      fits: true,
      dx: 900 + 248 + 48 - 1000,
      dy: 550 + 120 + 48 - 600,
    });
  });

  it('pans the other way for a box off the top left', () => {
    const r = panToShow({ x: -300, y: -40, width: 248, height: 120 }, view, 48);
    expect(r).toEqual({ fits: true, dx: -348, dy: -88 });
  });

  it('says when only zooming out will do', () => {
    expect(panToShow({ x: 0, y: 0, width: 1200, height: 100 }, view, 48).fits).toBe(false);
  });
});
