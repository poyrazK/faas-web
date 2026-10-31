import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import {
  isRollbackSettled,
  observationPollInterval,
  observationSelector,
  rollbackPollInterval,
  usePromoteDeployment,
  useReleaseDiff,
  useRollbackOperation,
  useRollbackToRelease,
  useRuntimeUpgradePreview,
  useWorkerRolloutObservation,
  type RollbackOperation,
} from './deployment-detail';

const ok = (data: unknown, status = 200) =>
  ({ data, response: new Response(null, { status }) }) as never;

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of [['deployments'], ['deployments', 'dep-1'], ['apps', 'alpha']])
    client.setQueryData(key, { marker: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

afterEach(() => vi.restoreAllMocks());

describe('release diff', () => {
  it('compares with the predecessor unless another release is named', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ summary: 'first release' }));
    const { wrapper } = setup();
    renderHook(() => useReleaseDiff('dep-1'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(get).toHaveBeenCalledWith(
      '/v1/deployments/{id}/diff',
      expect.objectContaining({ params: { path: { id: 'dep-1' } } })
    );
    renderHook(() => useReleaseDiff('dep-1', 'dep-0'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith(
      '/v1/deployments/{id}/diff',
      expect.objectContaining({ params: { path: { id: 'dep-1' }, query: { against: 'dep-0' } } })
    );
  });
});

describe('runtime upgrade preview', () => {
  it('asks nothing until a target runtime release is chosen', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ disposition: 'no_change' }));
    const { wrapper } = setup();
    const { rerender } = renderHook(
      ({ target }: { target: string }) => useRuntimeUpgradePreview('dep-1', target),
      { wrapper, initialProps: { target: '' } }
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(get).not.toHaveBeenCalled();
    rerender({ target: 'a'.repeat(64) });
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(get).toHaveBeenCalledWith(
      '/v1/deployments/{id}/runtime/upgrade-preview',
      expect.objectContaining({
        params: { path: { id: 'dep-1' }, query: { target: 'a'.repeat(64) } },
      })
    );
  });
});

describe('promotion', () => {
  it('uses the ordinary route by default and invalidates deployment reads', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok({ from_percent: 0, to_percent: 100, already_promoted: false })
    );
    const { client, wrapper } = setup();
    const hook = renderHook(() => usePromoteDeployment(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync({ id: 'dep-1', requireApplicationAck: false });
    });
    expect(post).toHaveBeenCalledWith('/v1/deployments/{id}/promote', {
      params: { path: { id: 'dep-1' } },
      body: {},
    });
    expect(client.getQueryState(['deployments', 'dep-1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['apps', 'alpha'])?.isInvalidated).toBe(true);
  });

  it('never falls back from the strict route to the ordinary one', async () => {
    const post = spyApi('POST').mockResolvedValue({
      error: { status: 404, code: 'not_found', title: 'Not found' },
      response: new Response(null, { status: 404 }),
    } as never);
    const { wrapper } = setup();
    const hook = renderHook(() => usePromoteDeployment(), { wrapper });
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ id: 'dep-1', requireApplicationAck: true })
      ).rejects.toMatchObject({ code: 'not_found' });
    });
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/v1/deployments/{id}/promote-with-application-ack', {
      params: { path: { id: 'dep-1' } },
      body: { require_application_ack: true },
    });
  });
});

describe('rollback', () => {
  it('names the target and acknowledges crossed releases only when asked', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ id: 'dep-0' }, 202));
    const { wrapper } = setup();
    const hook = renderHook(() => useRollbackToRelease(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync({ slug: 'alpha', targetDeploymentId: 'dep-0' });
    });
    expect(post).toHaveBeenLastCalledWith('/v1/apps/{slug}/rollback', {
      params: { path: { slug: 'alpha' } },
      body: { target_deployment_id: 'dep-0' },
    });
    await act(async () => {
      await hook.result.current.mutateAsync({
        slug: 'alpha',
        targetDeploymentId: 'dep-0',
        acknowledgeReleases: true,
      });
    });
    expect(post).toHaveBeenLastCalledWith('/v1/apps/{slug}/rollback', {
      params: { path: { slug: 'alpha' } },
      body: { target_deployment_id: 'dep-0', acknowledge_releases: true },
    });
  });

  it('settles only on complete or failed', () => {
    expect(isRollbackSettled('complete')).toBe(true);
    expect(isRollbackSettled('failed')).toBe(true);
    for (const status of ['preparing', 'ready', 'blocked', 'routing'] as const)
      expect(isRollbackSettled(status)).toBe(false);
  });

  it('reads the exact operation for the app', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ id: 'op-1', status: 'complete' }));
    const { wrapper } = setup();
    const hook = renderHook(() => useRollbackOperation('alpha', 'op-1'), { wrapper });
    await waitFor(() => expect(hook.result.current.data?.status).toBe('complete'));
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/rollbacks/{operation}',
      expect.objectContaining({ params: { path: { slug: 'alpha', operation: 'op-1' } } })
    );
  });
});

describe('rollback settling', () => {
  it('refreshes deployment reads once it settles, without re-reading itself in a loop', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ id: 'op-1', status: 'complete' }));
    const { client, wrapper } = setup();
    client.setQueryData(['apps', 'alpha', 'deployments'], { marker: true });
    const accepted = { id: 'op-1', status: 'preparing' } as RollbackOperation;
    const hook = renderHook(() => useRollbackOperation('alpha', 'op-1', accepted), { wrapper });
    await waitFor(() => expect(hook.result.current.data?.status).toBe('complete'));
    await waitFor(() =>
      expect(client.getQueryState(['deployments', 'dep-1'])?.isInvalidated).toBe(true)
    );
    expect(client.getQueryState(['apps', 'alpha', 'deployments'])?.isInvalidated).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(get).toHaveBeenCalledOnce();
    expect(hook.result.current.data?.status).toBe('complete');
  });
});

describe('polling', () => {
  const problem = (status: number, code: string) => new ApiError({ status, code, title: code });

  it('stops polling a rollback once it settles or the API refuses for good', () => {
    expect(rollbackPollInterval({ status: 'preparing' } as RollbackOperation, null)).toBe(5_000);
    expect(rollbackPollInterval({ status: 'complete' } as RollbackOperation, null)).toBe(false);
    expect(rollbackPollInterval(undefined, problem(404, 'not_found'))).toBe(false);
    expect(rollbackPollInterval(undefined, problem(403, 'forbidden'))).toBe(false);
    // A transient failure keeps the watch going.
    expect(rollbackPollInterval(undefined, problem(503, 'capacity_unavailable'))).toBe(5_000);
  });

  it('polls the worker snapshot only for a live release that has not converged', () => {
    expect(observationPollInterval({ generation_converged: false }, true)).toBe(10_000);
    expect(observationPollInterval(undefined, true)).toBe(10_000);
    expect(observationPollInterval({ generation_converged: true }, true)).toBe(false);
    expect(observationPollInterval({ generation_converged: false }, false)).toBe(false);
  });

  it('does not keep polling a rollback the API says is gone', async () => {
    const get = spyApi('GET').mockResolvedValue({
      error: { status: 404, code: 'not_found', title: 'Rollback not found' },
      response: new Response(null, { status: 404 }),
    } as never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { wrapper } = setup();
      const accepted = { id: 'op-1', status: 'preparing' } as RollbackOperation;
      const hook = renderHook(() => useRollbackOperation('alpha', 'op-1', accepted), { wrapper });
      await waitFor(() => expect(hook.result.current.error).toBeTruthy());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(get).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('worker rollout observation', () => {
  it('selects the default scope or the named environment, never both', () => {
    expect(observationSelector(undefined)).toEqual({ scope: 'default' });
    expect(observationSelector(null)).toEqual({ scope: 'default' });
    expect(observationSelector('default')).toEqual({ scope: 'default' });
    expect(observationSelector('staging')).toEqual({ environment: 'staging' });
  });

  it('reads the snapshot for the deployment and its scope', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ running: 1 }));
    const { wrapper } = setup();
    renderHook(() => useWorkerRolloutObservation('alpha', 'dep-1', 'staging', true, true), {
      wrapper,
    });
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/rollouts/{id}/observation',
      expect.objectContaining({
        params: { path: { slug: 'alpha', id: 'dep-1' }, query: { environment: 'staging' } },
      })
    );
  });
});
