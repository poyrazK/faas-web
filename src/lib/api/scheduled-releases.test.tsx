import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import type { Deployment } from './queries';
import {
  pendingSchedule,
  releaseAtProblem,
  scheduleBlocker,
  useDeploymentSchedule,
  useScheduledReleases,
} from './scheduled-releases';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
const dep = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd'.repeat(32),
  app_id: 'app',
  image_digest: '',
  kind: 'github',
  status: 'live',
  created_at: '2026-11-03T10:00:00Z',
  traffic_percent: 0,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('scheduleBlocker', () => {
  it('lets a production release that waits live without traffic be scheduled', () => {
    expect(scheduleBlocker(dep())).toBeUndefined();
  });

  it('says why anything else cannot be, as notSchedulable does', () => {
    expect(scheduleBlocker(dep({ traffic_percent: 100 }))).toMatch(/100% of traffic/);
    expect(scheduleBlocker(dep({ canary_total_steps: 3 }))).toMatch(/canary/);
    expect(scheduleBlocker(dep({ status: 'superseded' }))).toMatch(/superseded/);
    expect(scheduleBlocker(dep({ scope: 'staging' }))).toMatch(/Only production/);
    expect(scheduleBlocker(dep({ status: 'building' }))).toMatch(/still building/);
  });

  it('reads the pending schedule off the deployment', () => {
    const scheduled = dep({
      scheduled_release: {
        id: 's',
        app: 'shop',
        deployment_id: 'd',
        release_at: '2026-11-04T02:00:00Z',
        state: 'scheduled',
        notify_channels: [],
        scheduled_by: 'me',
        created_at: '',
        updated_at: '',
      },
    });
    expect(pendingSchedule(scheduled)?.release_at).toBe('2026-11-04T02:00:00Z');
    expect(pendingSchedule(dep())).toBeUndefined();
  });
});

describe('releaseAtProblem', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  it('accepts a time up to seven days ahead, and a minute of skew', () => {
    expect(releaseAtProblem('2026-11-03T14:00:00Z', now)).toBeUndefined();
    expect(releaseAtProblem('2026-11-03T11:59:30Z', now)).toBeUndefined();
  });
  it('refuses a passed time, one beyond a week, and none', () => {
    expect(releaseAtProblem('2026-11-03T11:00:00Z', now)).toMatch(/passed/);
    expect(releaseAtProblem('2026-11-11T12:00:00Z', now)).toMatch(/7 days/);
    expect(releaseAtProblem(null, now)).toMatch(/Choose/);
  });
});

describe('schedule reads', () => {
  it('lists one app’s schedules through ?app=', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ items: [] }));
    const { result } = renderHook(() => useScheduledReleases('shop'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(get).toHaveBeenCalledWith(
      '/v1/scheduled-releases',
      expect.objectContaining({ params: { query: { app: 'shop' } } })
    );
  });

  it('reads a release that was never scheduled as no schedule, not an error', async () => {
    spyApi('GET').mockRejectedValue(
      new ApiError({
        status: 404,
        code: 'scheduled_release_not_found',
        title: 'No scheduled release',
      })
    );
    const { result } = renderHook(() => useDeploymentSchedule('d1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
