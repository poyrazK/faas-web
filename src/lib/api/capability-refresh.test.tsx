import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { capabilityKey, useCapabilityAccess } from './capabilities';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct', plan: 'pro' } }) }));
afterEach(() => vi.restoreAllMocks());

const registry = {
  data: {
    registry_version: 1,
    plan: 'pro',
    capabilities: [],
    hidden_capabilities: ['traffic-mirroring'],
  },
  response: new Response(),
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('capability access across a background refresh', () => {
  it('keeps the cached answer while the registry refetches, so gated content stays mounted', async () => {
    const get = spyApi('GET').mockResolvedValue(registry as never);
    const { client, wrapper } = setup();
    const hook = renderHook(
      () => [useCapabilityAccess('production-debugger'), useCapabilityAccess('traffic-mirroring')],
      { wrapper }
    );
    await waitFor(() => expect(hook.result.current[0].access).toBe('on'));
    // A refetch that never answers: the cached registry must keep deciding.
    get.mockImplementation(() => new Promise(() => {}));
    const seen: string[] = [];
    act(() => void client.invalidateQueries({ queryKey: capabilityKey('acct') }));
    for (let i = 0; i < 5; i++) {
      seen.push(hook.result.current[0].access, hook.result.current[1].access);
      await act(() => new Promise((r) => setTimeout(r, 5)));
    }
    expect(new Set(seen)).toEqual(new Set(['on', 'off']));
  });

  it('keeps the cached answer when a background refetch fails', async () => {
    const get = spyApi('GET').mockResolvedValue(registry as never);
    const { client, wrapper } = setup();
    const hook = renderHook(() => useCapabilityAccess('production-debugger'), { wrapper });
    await waitFor(() => expect(hook.result.current.access).toBe('on'));
    get.mockResolvedValue({
      error: { code: 'internal', title: 'x', status: 500 },
      response: new Response(null, { status: 500 }),
    } as never);
    await act(() => client.refetchQueries({ queryKey: capabilityKey('acct') }));
    expect(hook.result.current.access).toBe('on');
  });
});
