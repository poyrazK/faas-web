import type { ReactNode } from 'react';
import { act, renderHook as render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaunches } from './use-launches';

const qc = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const renderHook = <T,>(hook: () => T) => render(hook, { wrapper });

beforeEach(() => sessionStorage.clear());

describe('useLaunches', () => {
  it('remembers a launch across a reload of the tab', () => {
    const first = renderHook(() => useLaunches());
    act(() => first.result.current.seed({ slug: 'api', source: 'cli' }));
    first.unmount();
    const second = renderHook(() => useLaunches());
    expect(second.result.current.seeds).toEqual({ api: { slug: 'api', source: 'cli' } });
  });

  it('forgets a launch once it is live, but keeps its last state', () => {
    const { result } = renderHook(() => useLaunches());
    act(() => result.current.seed({ slug: 'api', source: 'git', repo: 'a/b' }));
    act(() => result.current.onChange({ slug: 'api', source: 'git', stage: 'live', step: 4 }));
    expect(result.current.seeds).toEqual({});
    expect(result.current.launches.api?.stage).toBe('live');
    expect(renderHook(() => useLaunches()).result.current.seeds).toEqual({});
  });

  it('refreshes the app list once a launch is live', () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useLaunches());
    act(() => result.current.onChange({ slug: 'api', source: 'cli', stage: 'building', step: 2 }));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => result.current.onChange({ slug: 'api', source: 'cli', stage: 'live', step: 4 }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps'] });
  });

  it('survives storage that is unreadable', () => {
    sessionStorage.setItem('gregale.canvas.launches', '{not json');
    expect(renderHook(() => useLaunches()).result.current.seeds).toEqual({});
  });
});
