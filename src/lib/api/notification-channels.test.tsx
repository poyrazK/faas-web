import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useAlertRule,
  useAppSLOs,
  useAppSyntheticChecks,
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useTestNotificationChannel,
} from './notification-channels';
import { spyApi } from '@/test/api';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1' } }) }));
const channelsKey = ['account', 'acct-1', 'notification-channels'];

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const channel = {
  id: 'c1',
  name: 'ops-slack',
  kind: 'slack',
  target: 'hooks.slack.com/T0/B0/…',
  created_at: '2026-10-30T10:00:00Z',
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

afterEach(() => vi.restoreAllMocks());

describe('useNotificationChannels', () => {
  it('reads the account channels', async () => {
    const get = spyApi('GET').mockResolvedValue(ok([channel]));
    const { wrapper } = setup();
    const { result } = renderHook(() => useNotificationChannels(true), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([channel]));
    expect(get).toHaveBeenCalledWith('/v1/notification-channels', expect.anything());
  });

  it("caches under the account, so sign-out's ['account'] clear drops it", async () => {
    spyApi('GET').mockResolvedValue(ok([channel]));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useNotificationChannels(true), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([channel]));
    expect(client.getQueryData(channelsKey)).toEqual([channel]);
    client.removeQueries({ queryKey: ['account'] });
    expect(client.getQueryData(channelsKey)).toBeUndefined();
  });

  it('does not ask when disabled (a company workspace)', () => {
    const get = spyApi('GET').mockResolvedValue(ok([]));
    const { wrapper } = setup();
    renderHook(() => useNotificationChannels(false), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('channel mutations', () => {
  it('creates, then refreshes the list', async () => {
    spyApi('GET').mockResolvedValue(ok([]));
    const post = spyApi('POST').mockResolvedValue(ok(channel));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateNotificationChannel(), { wrapper });
    const body = { name: 'ops-slack', kind: 'slack' as const, slack_webhook_url: 'https://x' };
    await act(() => result.current.mutateAsync(body));
    expect(post).toHaveBeenCalledWith('/v1/notification-channels', { body });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: channelsKey });
  });

  it('deletes, then refreshes channels and every app rule list (bindings went with it)', async () => {
    const del = spyApi('DELETE').mockResolvedValue(ok(undefined));
    const { client, wrapper } = setup();
    client.setQueryData(['apps', 'shop', 'alerts'], []);
    client.setQueryData(['apps', 'shop', 'secrets'], []);
    const { result } = renderHook(() => useDeleteNotificationChannel(), { wrapper });
    await act(() => result.current.mutateAsync('c1'));
    expect(del).toHaveBeenCalledWith('/v1/notification-channels/{id}', {
      params: { path: { id: 'c1' } },
    });
    expect(client.getQueryState(['apps', 'shop', 'alerts'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['apps', 'shop', 'secrets'])?.isInvalidated).toBe(false);
  });

  it('tests a channel and refreshes its last delivery either way', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ delivered: false, error: 'HTTP 404' }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTestNotificationChannel(), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync('c1');
    });
    expect(out).toEqual({ delivered: false, error: 'HTTP 404' });
    expect(post).toHaveBeenCalledWith('/v1/notification-channels/{id}/test', {
      params: { path: { id: 'c1' } },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: channelsKey });
  });
});

describe('rule detail and selectors', () => {
  it('reads one rule under the app rule key, so rule mutations refresh it', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ id: 'r1' }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useAlertRule('shop', 'r1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ id: 'r1' }));
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/alerts/{id}', {
      params: { path: { slug: 'shop', id: 'r1' } },
      signal: expect.anything(),
    });
    await client.invalidateQueries({ queryKey: ['apps', 'shop', 'alerts'] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('lists SLOs and synthetic checks only when asked', async () => {
    const get = spyApi('GET').mockResolvedValue(ok([]));
    const { wrapper } = setup();
    renderHook(() => useAppSLOs('shop', false), { wrapper });
    renderHook(() => useAppSyntheticChecks('shop', false), { wrapper });
    expect(get).not.toHaveBeenCalled();
    renderHook(() => useAppSLOs('shop', true), { wrapper });
    renderHook(() => useAppSyntheticChecks('shop', true), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/slos', expect.anything());
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/synthetics', expect.anything());
  });
});
