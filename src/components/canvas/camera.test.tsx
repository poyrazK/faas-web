import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { useCamera } from './camera';

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
