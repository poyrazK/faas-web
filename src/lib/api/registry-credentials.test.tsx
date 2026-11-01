import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDeleteAppRegistryCredential } from './queries';
import { spyApi } from '@/test/api';

afterEach(() => vi.restoreAllMocks());

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ok = () => ({ data: undefined, response: new Response(null, { status: 204 }) }) as never;

it.each([
  ['ghcr.io', 'https://ghcr.io'],
  ['registry.example.com:5000', 'https://registry.example.com:5000'],
  ['https://ghcr.io', 'https://ghcr.io'],
])('removes %s by its https:// URL, which apid requires', async (stored, sent) => {
  // The list returns the normalized bare host, but DELETE runs the query
  // through normalizeRegistryHost, which refuses a schemeless value with 400
  // invalid_registry_host (faas handlers_registry_auth.go:66-71, :271).
  const del = spyApi('DELETE').mockResolvedValue(ok());
  const hook = renderHook(() => useDeleteAppRegistryCredential('alpha'), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync(stored);
  });
  expect(del).toHaveBeenCalledWith('/v1/apps/{slug}/registry-credentials', {
    params: { path: { slug: 'alpha' }, query: { registry: sent } },
  });
});
