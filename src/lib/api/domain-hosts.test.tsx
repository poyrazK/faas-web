import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOSTS_MAX,
  domainHostsKey,
  parseHostNames,
  probeHost,
  useClearDomainHosts,
  useDomainHosts,
  useSetDomainHosts,
} from './domain-hosts';
import { spyApi } from '@/test/api';

afterEach(() => vi.restoreAllMocks());
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('parseHostNames', () => {
  // faas state.NormalizeWildcardHostNames: lower-cased, the suffix trimmed,
  // sorted and de-duplicated, every name a valid host once joined to the suffix.
  it('accepts names or full hosts, one per line or comma-separated, sorted and de-duplicated', () => {
    expect(parseHostNames('*.example.com', 'API\n eu.shop.example.com , app\napi\n\n')).toEqual({
      names: ['api', 'app', 'eu.shop'],
      invalid: [],
    });
  });

  it('names what is not a name below the wildcard', () => {
    expect(parseHostNames('*.example.com', 'ok\n-bad\nx..y\n*.deep\nexample.com')).toEqual({
      names: ['example.com', 'ok'],
      invalid: ['-bad', 'x..y', '*.deep'],
    });
  });

  it('refuses a label over 63 bytes and a host over 253', () => {
    const long = 'a'.repeat(64);
    const deep = Array.from({ length: 30 }, () => 'abcdefgh').join('.');
    expect(parseHostNames('*.example.com', `${long}\n${deep}`).invalid).toEqual([long, deep]);
  });

  it('names the probe host the doctor dials, which every allowlist admits', () => {
    expect(probeHost('*.example.com')).toBe('gregale-wildcard-check.example.com');
    expect(HOSTS_MAX).toBe(100);
  });
});

describe('domain host allowlist hooks', () => {
  it('reads the allowlist under the domain', async () => {
    const get = spyApi('GET').mockResolvedValue(
      ok({ domain: '*.example.com', names: ['api'], restricted: true })
    );
    const { wrapper } = setup();
    const hook = renderHook(() => useDomainHosts('*.example.com'), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/v1/domains/{domain}/hosts', {
      params: { path: { domain: '*.example.com' } },
      signal: expect.any(AbortSignal),
    });
    expect(domainHostsKey('*.example.com')).toEqual(['domains', '*.example.com', 'hosts']);
  });

  it('replaces the list with PUT and caches what the API saved', async () => {
    const saved = { domain: '*.example.com', names: ['api', 'eu.shop'], restricted: true };
    const put = spyApi('PUT').mockResolvedValue(ok(saved));
    const { client, wrapper } = setup();
    const hook = renderHook(() => useSetDomainHosts('*.example.com'), { wrapper });
    await act(() => hook.result.current.mutateAsync(['api', 'eu.shop']));
    expect(put).toHaveBeenCalledWith('/v1/domains/{domain}/hosts', {
      params: { path: { domain: '*.example.com' } },
      body: { names: ['api', 'eu.shop'] },
    });
    expect(client.getQueryData(domainHostsKey('*.example.com'))).toEqual(saved);
  });

  it('removes the list with DELETE and caches every name as allowed', async () => {
    const del = spyApi('DELETE').mockResolvedValue({ response: new Response() } as never);
    const { client, wrapper } = setup();
    const hook = renderHook(() => useClearDomainHosts('*.example.com'), { wrapper });
    await act(() => hook.result.current.mutateAsync());
    expect(del).toHaveBeenCalledWith('/v1/domains/{domain}/hosts', {
      params: { path: { domain: '*.example.com' } },
    });
    expect(client.getQueryData(domainHostsKey('*.example.com'))).toEqual({
      domain: '*.example.com',
      names: [],
      restricted: false,
    });
  });
});
