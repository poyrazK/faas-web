import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { queuedDeployments, queuePollInterval, useDeployQueue } from './deploy-queue';
import type { Deployment } from './queries';

const d = (id: string, status: string, created_at: string): Deployment => ({
  id,
  app_id: 'app',
  image_digest: '',
  kind: 'github',
  status,
  created_at,
});
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;

afterEach(() => vi.restoreAllMocks());

describe('queuedDeployments', () => {
  it('keeps the states cancel accepts, oldest first (the builder claims FIFO within a priority)', () => {
    const rows = [
      d('live', 'live', '2026-11-03T10:05:00Z'),
      d('new', 'pending', '2026-11-03T10:04:00Z'),
      d('img', 'imaging', '2026-11-03T10:03:00Z'),
      d('failed', 'failed', '2026-11-03T10:02:00Z'),
      d('old', 'pending', '2026-11-03T10:01:00Z'),
      d('snap', 'snapshotting', '2026-11-03T10:00:30Z'),
      d('build', 'building', '2026-11-03T10:00:00Z'),
    ];
    expect(queuedDeployments(rows).map((r) => r.id)).toEqual([
      'build',
      'snap',
      'old',
      'img',
      'new',
    ]);
  });

  it('polls only while something is queued', () => {
    expect(queuePollInterval([d('a', 'pending', '2026-11-03T10:00:00Z')])).toBe(3_000);
    expect(queuePollInterval([d('a', 'live', '2026-11-03T10:00:00Z')])).toBe(false);
    expect(queuePollInterval(undefined)).toBe(false);
  });
});

describe('useDeployQueue', () => {
  it('reads the account’s newest 200 deployments and answers the queued ones', async () => {
    const get = spyApi('GET').mockResolvedValue(
      ok({
        items: [d('a', 'pending', '2026-11-03T10:00:00Z'), d('b', 'live', '2026-11-03T09:00:00Z')],
        next_before: null,
      })
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {children}
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDeployQueue(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((r) => r.id)).toEqual(['a']);
    expect(get).toHaveBeenCalledWith(
      '/v1/deployments',
      expect.objectContaining({ params: { query: { limit: 200 } } })
    );
  });
});
