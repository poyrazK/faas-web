import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { ApiError } from './errors';
import {
  activityOutcome,
  activityResourceId,
  resolveActivityWorkspace,
  scopedActivity,
  useResourceActivity,
  type ResourceActivity,
} from './resource-activity';

const app = 'a'.repeat(32),
  release = 'b'.repeat(32);
const row = (id: string, appId = app, deploymentId = release): ResourceActivity => ({
  id,
  app_id: appId,
  deployment_id: deploymentId,
  occurred_at: '2026-10-01T12:00:00Z',
  kind: 'deploy.failed',
  summary: 'Build failed',
  actor: { type: 'system', label: 'Build system' },
  resource: { type: 'deployment', label: 'Release' },
  data: {},
});
const reply = (data: unknown) => ({ data, response: new Response() }) as never;
afterEach(() => vi.restoreAllMocks());
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

describe('resource activity contract', () => {
  it('resolves persisted app attribution across personal and shared orgs', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/v1/orgs') return reply({ orgs: [{ slug: 'personal' }, { slug: 'team' }] });
      const slug = (options as { params: { path: { slug: string } } }).params.path.slug;
      return reply({
        apps:
          slug === 'team'
            ? [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]
            : [{ id: 'c'.repeat(32) }],
      });
    });
    expect(await resolveActivityWorkspace(app)).toEqual({ slug: 'team' });
    expect(get).toHaveBeenCalledTimes(3);
  });
  it('never substitutes the personal org when inventory is unavailable', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) =>
      path === '/v1/orgs'
        ? reply({ orgs: [{ slug: 'personal' }] })
        : ({
            error: { status: 403, code: 'org_role_forbidden', title: 'Permission denied' },
            response: new Response(null, { status: 403 }),
          } as never)
    );
    await expect(resolveActivityWorkspace(app)).rejects.toBeInstanceOf(ApiError);
  });
  it('reports absent attribution and rejects conflicting inventories', async () => {
    const get = vi
      .spyOn(api, 'GET')
      .mockResolvedValueOnce(reply({ orgs: [{ slug: 'personal' }] }))
      .mockResolvedValueOnce(reply({ apps: [] }));
    expect(await resolveActivityWorkspace(app)).toBeNull();
    get
      .mockResolvedValueOnce(reply({ orgs: [{ slug: 'personal' }, { slug: 'team' }] }))
      .mockResolvedValue(reply({ apps: [{ id: app }] }));
    await expect(resolveActivityWorkspace(app)).rejects.toThrow('conflicting workspace');
  });
  it('accepts both UUID encodings but rejects other identifiers', () => {
    expect(activityResourceId('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA')).toBe(app);
    expect(activityResourceId('../another-app')).toBeUndefined();
  });
  it('filters all pages to the exact app/release, deduplicating without replacing captured order', () => {
    const rows = scopedActivity(
      [
        { items: [row('3'), row('2', 'c'.repeat(32))] },
        { items: [row('3'), row('1'), row('0', app, 'd'.repeat(32))] },
      ],
      app,
      release
    );
    expect(rows.map((item) => item.id)).toEqual(['3', '1']);
    expect(scopedActivity([{ items: [row('1')] }], app, 'invalid')).toEqual([]);
  });
  it.each([
    ['deploy.requested', 'Requested'],
    ['deploy.failed', 'Failed'],
    ['deploy.rollback_failed', 'Failed'],
    ['deploy.cancelled', 'Cancelled'],
    ['env.set', 'Completed'],
    ['app.config_updated', 'Completed'],
    ['domain.tls_issued', 'Completed'],
    ['future.maybe_failed', 'Recorded — outcome not provided'],
  ])('uses recorded facts for %s outcome', (kind, expected) =>
    expect(activityOutcome(kind)).toBe(expected)
  );
  it('paginates with the opaque cursor and server-side app/kind/actor filters', async () => {
    const get = vi
      .spyOn(api, 'GET')
      .mockResolvedValueOnce(reply({ items: [row('2')], next_before: 'opaque/?+cursor' }))
      .mockResolvedValueOnce(reply({ items: [row('1')] }));
    const { wrapper } = setup();
    const hook = renderHook(
      () => ({
        ...useResourceActivity('account-1', 'team', app, {
          kind_prefix: 'domain.',
          actor_type: 'system',
        }),
      }),
      { wrapper }
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    await act(async () => {
      await hook.result.current.fetchNextPage();
    });
    expect(get).toHaveBeenLastCalledWith(
      '/v1/orgs/{slug}/activity',
      expect.objectContaining({
        params: {
          path: { slug: 'team' },
          query: {
            app_id: app,
            limit: 50,
            before: 'opaque/?+cursor',
            kind_prefix: 'domain.',
            actor_type: 'system',
          },
        },
      })
    );
    await waitFor(() => expect(hook.result.current.hasNextPage).toBe(false));
  });
  it('preserves loaded evidence when an older-page permission read fails', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(reply({ items: [row('2')], next_before: 'older' }))
      .mockRejectedValueOnce(
        new ApiError({ status: 403, code: 'forbidden', title: 'Membership revoked' })
      );
    const { wrapper } = setup();
    const hook = renderHook(() => ({ ...useResourceActivity('account-1', 'team', app, {}) }), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    await act(async () => {
      await hook.result.current.fetchNextPage();
    });
    await waitFor(() => expect(hook.result.current.isFetchNextPageError).toBe(true));
    expect(hook.result.current.data?.pages[0].items[0].id).toBe('2');
  });
  it('isolates accounts and filter histories and stops repeated cursors', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(reply({ items: [row('2')], next_before: 'repeat' }))
      .mockResolvedValueOnce(reply({ items: [row('1')], next_before: 'repeat' }))
      .mockResolvedValue(reply({ items: [row('9')] }));
    const { client, wrapper } = setup();
    const hook = renderHook(
      ({ accountId, filter }) => ({ ...useResourceActivity(accountId, 'team', app, filter) }),
      { wrapper, initialProps: { accountId: 'account-1', filter: {} as { kind_prefix?: string } } }
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    await act(async () => {
      await hook.result.current.fetchNextPage();
    });
    await waitFor(() => expect(hook.result.current.hasNextPage).toBe(false));
    hook.rerender({ accountId: 'account-2', filter: { kind_prefix: 'env.' } });
    await waitFor(() => expect(hook.result.current.data?.pages[0].items[0].id).toBe('9'));
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey[1])
    ).toEqual(['account-1', 'account-2']);
  });
});
