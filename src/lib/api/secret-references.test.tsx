import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { routeApi } from '@/test/monetization';
import {
  revocationPollInterval,
  useRemoveSecretReference,
  useRevokeSecret,
  useScopedSecretNames,
  useSecretReferences,
  useSetSecretReference,
  type SecretRevocation,
} from './secret-references';

afterEach(() => vi.restoreAllMocks());

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

const revocation = (over: Partial<SecretRevocation> = {}): SecretRevocation => ({
  id: '7b0c2a52-4e7f-4c1e-9d3a-0d2f5e7a9c11',
  scope: 'default',
  key: 'JWT_SIGNING_KEY',
  created_at: '2026-10-31T10:00:00Z',
  status: 'pending',
  target_count: 1,
  acknowledged_count: 0,
  pending_count: 1,
  targets: [
    {
      instance_id: '1f9e7c3a-0b2d-4c5e-8f6a-7b8c9d0e1f2a',
      runtime_state: 'running',
      reload_support: 'enabled',
      status: 'pending',
    },
  ],
  ...over,
});

it('lists references for one named environment', async () => {
  const spies = routeApi({
    'GET /v1/apps/{slug}/secret-references': () => ({
      environment_id: 'e1',
      environment: 'staging',
      references: { DATABASE_URL: 'secret:DATABASE_PRIMARY' },
      count: 3,
      quota: 128,
    }),
  });
  const { wrapper: Wrapper } = wrapper();
  const { result } = renderHook(() => useSecretReferences('api', 'staging'), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(spies.GET).toHaveBeenCalledWith(
    '/v1/apps/{slug}/secret-references',
    expect.objectContaining({
      params: { path: { slug: 'api' }, query: { environment: 'staging' } },
    })
  );
});

it('never asks without an environment, since the API has no default for references', () => {
  const spies = routeApi({});
  const { wrapper: Wrapper } = wrapper();
  renderHook(() => useSecretReferences('api', ''), { wrapper: Wrapper });
  expect(spies.GET).not.toHaveBeenCalled();
});

it('reads source names from the secrets set in that exact scope', async () => {
  const spies = routeApi({
    'GET /v1/apps/{slug}/secrets': () => ({
      secrets: [{ key: 'STRIPE_LIVE_KEY' }, { key: 'DATABASE_PRIMARY' }],
      quota_max: 64,
      count: 2,
    }),
  });
  const { wrapper: Wrapper } = wrapper();
  const { result } = renderHook(() => useScopedSecretNames('api', 'production'), {
    wrapper: Wrapper,
  });
  await waitFor(() => expect(result.current.data).toEqual(['DATABASE_PRIMARY', 'STRIPE_LIVE_KEY']));
  expect(spies.GET).toHaveBeenCalledWith(
    '/v1/apps/{slug}/secrets',
    expect.objectContaining({ params: { path: { slug: 'api' }, query: { scope: 'production' } } })
  );
});

it('sets a reference as secret:SOURCE in the environment, then rereads the list', async () => {
  const spies = routeApi({
    'PUT /v1/apps/{slug}/secret-references/{key}': () => ({
      environment_id: 'e1',
      environment: 'production',
      key: 'DATABASE_URL',
      reference: 'secret:DATABASE_PRIMARY',
    }),
  });
  const { wrapper: Wrapper, client } = wrapper();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useSetSecretReference('api', 'production'), {
    wrapper: Wrapper,
  });
  await act(() => result.current.mutateAsync({ key: 'DATABASE_URL', source: 'DATABASE_PRIMARY' }));
  expect(spies.PUT).toHaveBeenCalledWith('/v1/apps/{slug}/secret-references/{key}', {
    params: { path: { slug: 'api', key: 'DATABASE_URL' }, query: { environment: 'production' } },
    body: { reference: 'secret:DATABASE_PRIMARY' },
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['apps', 'api', 'secret-references', 'production'],
  });
});

it('removes a reference in the environment', async () => {
  const spies = routeApi({ 'DELETE /v1/apps/{slug}/secret-references/{key}': () => undefined });
  const { wrapper: Wrapper } = wrapper();
  const { result } = renderHook(() => useRemoveSecretReference('api', 'production'), {
    wrapper: Wrapper,
  });
  await act(() => result.current.mutateAsync('DATABASE_URL'));
  expect(spies.DELETE).toHaveBeenCalledWith('/v1/apps/{slug}/secret-references/{key}', {
    params: { path: { slug: 'api', key: 'DATABASE_URL' }, query: { environment: 'production' } },
  });
});

it('deletes a secret asking for the revocation receipt, and returns it', async () => {
  const spies = routeApi({ 'DELETE /v1/apps/{slug}/secrets/{key}': () => revocation() });
  const { wrapper: Wrapper } = wrapper();
  const { result } = renderHook(() => useRevokeSecret('api'), { wrapper: Wrapper });
  let out: SecretRevocation | undefined;
  await act(async () => {
    out = await result.current.mutateAsync('JWT_SIGNING_KEY');
  });
  expect(out?.id).toBe(revocation().id);
  expect(spies.DELETE).toHaveBeenCalledWith('/v1/apps/{slug}/secrets/{key}', {
    params: { path: { slug: 'api', key: 'JWT_SIGNING_KEY' } },
    headers: { Prefer: 'return=representation' },
  });
});

it('resolves to nothing when an older server answers the delete with 204', async () => {
  routeApi(
    { 'DELETE /v1/apps/{slug}/secrets/{key}': () => undefined },
    {
      'DELETE /v1/apps/{slug}/secrets/{key}': 204,
    }
  );
  const { wrapper: Wrapper } = wrapper();
  const { result } = renderHook(() => useRevokeSecret('api'), { wrapper: Wrapper });
  let out: SecretRevocation | undefined = revocation();
  await act(async () => {
    out = await result.current.mutateAsync('JWT_SIGNING_KEY');
  });
  expect(out).toBeUndefined();
});

it('polls only while a reload-enabled runtime may still acknowledge', () => {
  expect(revocationPollInterval(revocation())).toBeGreaterThan(0);
  expect(revocationPollInterval(revocation({ status: 'complete', targets: [] }))).toBe(false);
  // A restart-only runtime never acknowledges: blocked is where it stays.
  expect(
    revocationPollInterval(
      revocation({
        status: 'blocked',
        targets: [{ ...revocation().targets[0], reload_support: 'disabled' }],
      })
    )
  ).toBe(false);
  // Blocked, but another runtime can still answer: keep watching it.
  expect(
    revocationPollInterval(
      revocation({
        status: 'blocked',
        targets: [
          { ...revocation().targets[0], reload_support: 'disabled' },
          revocation().targets[0],
        ],
      })
    )
  ).toBeGreaterThan(0);
  expect(revocationPollInterval(undefined)).toBe(false);
});
