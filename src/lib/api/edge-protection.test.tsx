import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attackModeKey,
  attackModeRefetch,
  corsPresetUsers,
  edgeProtectionKey,
  useAttackMode,
  usePreAuthObservations,
  useEdgeProtection,
  useSwitchAttackModeOff,
  useSwitchAttackModeOn,
  useUpdateCorsPreset,
} from './edge-protection';
import { spyApi } from '@/test/api';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const ok = (data: unknown) => ({ data, response: new Response() }) as never;

describe('reads', () => {
  it('reads the edge-protection summary for a range', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ app_id: 'a1', range: '24h' }));
    const { wrapper } = setup();
    const hook = renderHook(() => useEdgeProtection('api', '24h'), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/edge-protection',
      expect.objectContaining({ params: { path: { slug: 'api' }, query: { range: '24h' } } })
    );
  });

  it('reads pre-auth observations for a range', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ app_id: 'a1', policies: [] }));
    const { wrapper } = setup();
    const hook = renderHook(() => usePreAuthObservations('api', '1h'), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/pre-auth-observations',
      expect.objectContaining({ params: { path: { slug: 'api' }, query: { range: '1h' } } })
    );
  });

  it('reads attack mode', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ active: false }));
    const { wrapper } = setup();
    const hook = renderHook(() => useAttackMode('api'), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/edge-protection/attack-mode',
      expect.objectContaining({ params: { path: { slug: 'api' } } })
    );
  });
});

describe('attackModeRefetch', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('does not poll while attack mode is off', () => {
    expect(attackModeRefetch({ active: false }, now)).toBe(false);
    expect(attackModeRefetch(undefined, now)).toBe(false);
  });
  it('re-reads once just after an end that is close', () => {
    expect(attackModeRefetch({ active: true, expires_at: '2026-10-31T12:05:00Z' }, now)).toBe(
      5 * 60_000 + 1_000
    );
  });
  it('stops for good when the end is far away', () => {
    expect(attackModeRefetch({ active: true, expires_at: '2026-10-31T20:00:00Z' }, now)).toBe(
      false
    );
  });
  it('re-reads soon when the end has already passed but the answer still says on', () => {
    expect(attackModeRefetch({ active: true, expires_at: '2026-10-31T11:59:00Z' }, now)).toBe(
      1_000
    );
  });
});

describe('switching attack mode', () => {
  it('switches on for a duration and stores the answer', async () => {
    const status = { active: true, rule_id: 'r1', expires_at: '2026-10-31T13:00:00Z' };
    const put = spyApi('PUT').mockResolvedValue(ok(status));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useSwitchAttackModeOn('api'), { wrapper });
    await act(() => hook.result.current.mutateAsync(3600));
    expect(put).toHaveBeenCalledWith(
      '/v1/apps/{slug}/edge-protection/attack-mode',
      expect.objectContaining({
        params: { path: { slug: 'api' } },
        body: { duration_seconds: 3600 },
      })
    );
    expect(client.getQueryData(attackModeKey('api'))).toEqual(status);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: edgeProtectionKey('api') });
  });

  it('re-reads the switch after a failure, since a 503 may mean saved but not acknowledged', async () => {
    spyApi('PUT').mockResolvedValue({
      error: { status: 503, code: 'capacity_exhausted', title: 'Unavailable' },
      response: new Response(null, { status: 503 }),
    } as never);
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useSwitchAttackModeOn('api'), { wrapper });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(900)).rejects.toThrow();
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: attackModeKey('api') });
  });

  it('switches off', async () => {
    const del = spyApi('DELETE').mockResolvedValue(ok({ active: false }));
    const { client, wrapper } = setup();
    const hook = renderHook(() => useSwitchAttackModeOff('api'), { wrapper });
    await act(() => hook.result.current.mutateAsync());
    expect(del).toHaveBeenCalledWith(
      '/v1/apps/{slug}/edge-protection/attack-mode',
      expect.objectContaining({ params: { path: { slug: 'api' } } })
    );
    expect(client.getQueryData(attackModeKey('api'))).toEqual({ active: false });
  });
});

describe('CORS presets', () => {
  it('patches only the fields given and refreshes presets and edge rules', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(ok({ id: 'p1', name: 'web' }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useUpdateCorsPreset(), { wrapper });
    await act(() => hook.result.current.mutateAsync({ id: 'p1', body: { max_age_seconds: 60 } }));
    expect(patch).toHaveBeenCalledWith(
      '/v1/cors-presets/{id}',
      expect.objectContaining({ params: { path: { id: 'p1' } }, body: { max_age_seconds: 60 } })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cors-presets'] });
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ predicate: expect.any(Function) })
    );
  });

  it('reads the action wrapped by kind, as apid sends it', () => {
    const rules = [
      { id: 'r1', kind: 'cors', action: { kind: 'cors', cors: { cors_preset_id: 'p1' } } },
      { id: 'r2', kind: 'cors', action: { kind: 'cors', cors: { allow_origins: ['*'] } } },
    ];
    expect(corsPresetUsers(rules as never, 'p1').map((r) => r.id)).toEqual(['r1']);
  });

  it('finds the CORS rules that reference a preset', () => {
    const rules = [
      { id: 'r1', kind: 'cors', action: { cors_preset_id: 'p1' } },
      { id: 'r2', kind: 'cors', action: { allow_origins: ['*'] } },
      { id: 'r3', kind: 'cors', action: { cors_preset_id: 'p2' } },
      { id: 'r4', kind: 'route', action: { target_app_slug: 'x' } },
    ];
    expect(corsPresetUsers(rules as never, 'p1').map((r) => r.id)).toEqual(['r1']);
    expect(corsPresetUsers(undefined, 'p1')).toEqual([]);
  });
});
