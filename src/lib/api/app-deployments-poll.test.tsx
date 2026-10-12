import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('./client', async (o) => ({ ...(await o<object>()), api }));
const { useAppDeployments } = await import('./queries');

afterEach(() => vi.useRealTimers());

describe('useAppDeployments polling', () => {
  it('polls an app with no deployments when asked to, and not otherwise', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.GET.mockResolvedValue({ data: { items: [], next_before: null }, response: new Response() });
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const polling = renderHook(() => useAppDeployments('a', 1, { pollWhileEmpty: true }), {
      wrapper: wrap,
    });
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));

    polling.unmount();
    api.GET.mockClear();
    renderHook(() => useAppDeployments('b', 1), { wrapper: wrap });
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3_100);
    expect(api.GET).toHaveBeenCalledTimes(1);
  });
});
