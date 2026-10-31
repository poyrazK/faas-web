import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBlocker, useDomainDetail, useSetDefaultDomain } from './domain-detail';
import { spyApi } from '@/test/api';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const row = (over: Record<string, unknown> = {}) => ({
  domain: 'api.example.com',
  app_id: 'app-1',
  verified: true,
  ...over,
});

describe('useDomainDetail', () => {
  it('reads the one domain by hostname', async () => {
    const get = spyApi('GET').mockResolvedValue({
      data: row({ cert_status: 'issued' }),
      response: new Response(),
    } as never);
    const { wrapper } = setup();
    const hook = renderHook(() => useDomainDetail('api.example.com'), { wrapper });
    await waitFor(() => expect(hook.result.current.data?.cert_status).toBe('issued'));
    expect(get).toHaveBeenCalledWith(
      '/v1/domains/{domain}',
      expect.objectContaining({ params: { path: { domain: 'api.example.com' } } })
    );
  });

  it('does not read while no domain is chosen', () => {
    const get = spyApi('GET');
    const { wrapper } = setup();
    renderHook(() => useDomainDetail(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useSetDefaultDomain', () => {
  it('posts to /default and refreshes the domains and the apps', async () => {
    const post = spyApi('POST').mockResolvedValue({
      data: row({ default: true }),
      response: new Response(),
    } as never);
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useSetDefaultDomain(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync('api.example.com');
    });
    expect(post).toHaveBeenCalledWith(
      '/v1/domains/{domain}/default',
      expect.objectContaining({ params: { path: { domain: 'api.example.com' } } })
    );
    // The previous default loses its flag, and the app's canonical URL moves.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['domains'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps'] });
  });
});

describe('defaultBlocker', () => {
  it('allows a verified, application-wide, concrete domain', () => {
    expect(defaultBlocker(row())).toBeNull();
  });

  it('allows nothing for the domain that already is the default', () => {
    expect(defaultBlocker(row({ default: true }))).toBe('already');
  });

  it('asks for verification first', () => {
    expect(defaultBlocker(row({ verified: false }))).toBe('unverified');
  });

  it('refuses an environment-bound domain', () => {
    expect(defaultBlocker(row({ environment: 'staging' }))).toBe('environment');
  });

  it('refuses a wildcard', () => {
    expect(defaultBlocker(row({ domain: '*.example.com' }))).toBe('wildcard');
  });
});
