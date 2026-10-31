import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { useRunDiagnostics } from './binding-verification';

const DIAG = '/v1/apps/{slug}/bindings/verification-runs/{run}/diagnostics';

let get: ReturnType<typeof spyApi>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  get = spyApi('GET').mockImplementation(async () => ({
    data: { run_id: 'r', blockers: [], changes: [], recovery: [] },
    response: new Response(null, { status: 200 }),
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const calls = () => get.mock.calls.filter(([path]) => path === DIAG).length;

it('polls diagnostics with a pending run and stops when the run stops', async () => {
  const { rerender } = renderHook(
    ({ live }: { live: boolean }) => useRunDiagnostics('acct-1', 'api', 'r', live),
    { wrapper, initialProps: { live: true } }
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(calls()).toBe(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(calls()).toBe(2);

  rerender({ live: false });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(calls()).toBe(2);
});
