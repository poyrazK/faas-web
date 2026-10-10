import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const app = { id: 'id-a', slug: 'a', status: 'active', url: 'https://a.gregale.app' };
const ok = <T,>(key: string[], data: T) => ({ queryKey: key, queryFn: async () => data });

vi.mock('@/lib/api/queries', () => ({
  useApps: () => useQuery(ok(['apps'], [app])),
  useDomains: () => useQuery(ok(['domains'], [])),
  useCrons: () => useQuery(ok(['crons'], [])),
  useAppsMetrics: () => useQuery(ok(['apps', 'metrics', '24h'], { apps: {} })),
  usePostgresDatabases: () =>
    useQuery(
      ok(['postgres', 'databases'], { items: [{ id: 'db1', name: 'main', state: 'ready' }] })
    ),
  postgresBindingsOptions: (id: string) =>
    ok(['postgres', 'databases', id, 'bindings'], { items: [] }),
}));
vi.mock('@/lib/api/object-storage', () => ({
  bucketListOptions: (slug: string) =>
    ok(['object-buckets', slug], {
      items: [],
      enabled: true,
      regions: [],
      default_region: 'eu',
      max_upload_bytes: 1,
      max_buckets_per_app: 5,
    }),
}));

const { useTopology } = await import('./use-topology');

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useTopology(), { wrapper }) };
}

describe('useTopology', () => {
  it('keeps the same topology across re-renders when no data changed', async () => {
    const { result, rerender } = setup();
    await waitFor(() =>
      expect(result.current.topology.nodes.some((n) => n.id === 'postgres:db1')).toBe(true)
    );
    await waitFor(() =>
      expect(result.current.topology.nodes.find((n) => n.id === 'app:a')?.data).toMatchObject({
        connections: 'ready',
      })
    );
    const before = result.current.topology;
    rerender();
    rerender();
    expect(result.current.topology).toBe(before);
  });

  it('retries every read the canvas draws from, not just the account lists', async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => result.current.retry());
    const families = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
    expect(families).toEqual(
      expect.arrayContaining(['apps', 'domains', 'crons', 'object-buckets', 'postgres'])
    );
  });
});
