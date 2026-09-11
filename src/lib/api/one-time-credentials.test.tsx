import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateApiKey,
  useCreateOrgKey,
  useRotateApiKey,
  useRotateOrgKey,
  useInviteMember,
} from './queries';

const post = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { POST: post } }));
const key = {
  id: 'k1',
  prefix: 'fp_test',
  label: 'CI',
  scopes: ['apps:read'],
  created_at: '2026-09-11T00:00:00Z',
  status: 'active',
};
const created = { ...key, plaintext: 'secret-one-time' };
const rotated = {
  key,
  key_plaintext: 'secret-one-time',
  old_key_id: 'old',
  old_key_expires_at: '2026-09-18T00:00:00Z',
};
const invitation = {
  id: 'i1',
  email: 'dev@example.com',
  role: 'developer',
  token: 'secret-one-time',
  expires_at: '2026-09-18T00:00:00Z',
};

beforeEach(() => {
  post.mockReset();
});

describe.each([
  {
    name: 'personal create',
    useOperation: useCreateApiKey,
    input: { label: 'CI', scopes: ['apps:read'] },
    response: created,
    path: '/v1/keys',
    options: { body: { label: 'CI', scopes: ['apps:read'] } },
  },
  {
    name: 'personal rotate',
    useOperation: useRotateApiKey,
    input: 'old',
    response: rotated,
    path: '/v1/keys/{id}/rotate',
    options: { params: { path: { id: 'old' } } },
  },
  {
    name: 'org create',
    useOperation: () => useCreateOrgKey('acme'),
    input: { label: 'CI', scopes: ['apps:read'] },
    response: created,
    path: '/v1/orgs/{slug}/keys',
    options: { params: { path: { slug: 'acme' } }, body: { label: 'CI', scopes: ['apps:read'] } },
  },
  {
    name: 'org rotate',
    useOperation: () => useRotateOrgKey('acme'),
    input: 'old',
    response: rotated,
    path: '/v1/orgs/{slug}/keys/{id}/rotate',
    options: { params: { path: { slug: 'acme', id: 'old' } }, body: {} },
  },
  {
    name: 'invitation',
    useOperation: () => useInviteMember('acme'),
    input: { email: 'dev@example.com', role: 'developer' },
    response: invitation,
    path: '/v1/orgs/{slug}/members',
    options: {
      params: { path: { slug: 'acme' } },
      body: { email: 'dev@example.com', role: 'developer' },
    },
  },
])('$name credential lifetime', ({ useOperation, input, response, path, options }) => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const view = renderHook(() => useOperation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    return { ...view, client };
  }
  it('delivers the one-time result using the existing payload then removes it after reset', async () => {
    post.mockResolvedValue({ data: response, response: new Response() });
    const { result, client } = setup();
    await act(async () => {
      expect(await result.current.mutateAsync(input as never)).toEqual(response);
      result.current.reset();
    });
    expect(post).toHaveBeenCalledWith(path, options);
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
  it('does not retain completed plaintext after the surface unmounts', async () => {
    post.mockResolvedValue({ data: response, response: new Response() });
    const { result, client, unmount } = setup();
    await act(async () => {
      await result.current.mutateAsync(input as never);
    });
    unmount();
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
  it('removes a result that arrives after its surface unmounts', async () => {
    let resolve!: (value: unknown) => void;
    post.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { result, client, unmount } = setup();
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync(input as never);
    });
    await waitFor(() => expect(post).toHaveBeenCalled());
    unmount();
    await act(async () => {
      resolve({ data: response, response: new Response() });
      await pending;
    });
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});
