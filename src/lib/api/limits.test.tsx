import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  useEgressOverage,
  useOrgEgressOverage,
  useOrgObjectStorageUsage,
  useSetEgressOverage,
} from './limits';

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
afterEach(() => vi.restoreAllMocks());

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const calls = (spy: ReturnType<typeof spyApi>) =>
  (spy.mock.calls as unknown as [string, Record<string, unknown>][]).map(([path, init]) => [
    path,
    init,
  ]);

describe('egress overage', () => {
  it('reads the personal election, and an organization its own', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ enabled: false, electable: true }));
    const personal = renderHook(() => useEgressOverage(), { wrapper: wrapper() });
    const company = renderHook(() => useOrgEgressOverage('acme'), { wrapper: wrapper() });
    await waitFor(() => expect(personal.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(company.result.current.isSuccess).toBe(true));
    expect(calls(get)).toEqual(
      expect.arrayContaining([
        ['/v1/account/egress-overage', expect.anything()],
        [
          '/v1/orgs/{slug}/egress-overage',
          expect.objectContaining({ params: { path: { slug: 'acme' } } }),
        ],
      ])
    );
  });

  it('sets the election with the caller’s idempotency key, for the right subject', async () => {
    const put = spyApi('PUT').mockResolvedValue(ok({ enabled: true, electable: true }));
    const personal = renderHook(() => useSetEgressOverage(null), { wrapper: wrapper() });
    const company = renderHook(() => useSetEgressOverage('acme'), { wrapper: wrapper() });
    await act(() => personal.result.current.mutateAsync({ enabled: true, key: 'k1' }));
    await act(() => company.result.current.mutateAsync({ enabled: false, key: 'k2' }));
    expect(calls(put)).toEqual([
      [
        '/v1/account/egress-overage',
        expect.objectContaining({ body: { enabled: true }, headers: { 'Idempotency-Key': 'k1' } }),
      ],
      [
        '/v1/orgs/{slug}/egress-overage',
        expect.objectContaining({
          params: { path: { slug: 'acme' } },
          body: { enabled: false },
          headers: { 'Idempotency-Key': 'k2' },
        }),
      ],
    ]);
  });
});

describe('organization object storage', () => {
  it('reads the organization’s object storage usage', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ usage: {}, policy: {} }));
    const view = renderHook(() => useOrgObjectStorageUsage('acme'), { wrapper: wrapper() });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(calls(get)).toEqual([
      [
        '/v1/orgs/{organization}/object-storage-usage',
        expect.objectContaining({ params: { path: { organization: 'acme' } } }),
      ],
    ]);
  });
});
