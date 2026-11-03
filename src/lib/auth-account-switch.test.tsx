import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useAuth as UseAuth } from './auth';

/**
 * Two people, one browser tab. Sign-out and an expired session both leave the
 * query cache behind, and its lists stay fresh for 30 s, so whoever signs in
 * next must not be shown the previous account's reads or browser state.
 */

let serverAccount = '';

beforeEach(() => {
  serverAccount = '';
  const NativeRequest = Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input,
          init
        );
      }
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const { pathname } = new URL(request.url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (pathname === '/login' && request.method === 'POST') {
        serverAccount = ((await request.json()) as { email: string }).email;
        return json({});
      }
      if (pathname === '/v1/account') {
        return serverAccount
          ? json({ email: serverAccount, plan: 'free' })
          : json({ code: 'unauthorized', title: 'Sign in', status: 401 }, 401);
      }
      if (pathname === '/v1/auth/csrf') return json({ csrf_token: 'token' });
      if (pathname === '/v1/auth/logout') {
        serverAccount = '';
        return json({});
      }
      if (pathname === '/v1/apps') {
        return json({ code: 'session_expired', title: 'Sign in again', status: 401 }, 401);
      }
      return json({ code: 'not_found', title: 'Not found', status: 404 }, 404);
    })
  );
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

let auth: ReturnType<typeof UseAuth>;
/** The typed client, imported after the stubs so it builds requests with them. */
let api: (typeof import('./api/client'))['api'];

async function mount() {
  // openapi-fetch captures `Request` when its module loads, so the modules are
  // imported only once the stubs above are in place.
  ({ api } = await import('./api/client'));
  const { AuthProvider, useAuth } = await import('./auth');
  function Probe() {
    auth = useAuth();
    return <output>{auth.user?.email ?? 'signed-out'}</output>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>
  );
  return client;
}

async function signIn(client: QueryClient, email: string) {
  await act(() => auth.signIn(email, 'correct-horse-battery'));
  await screen.findByText(email);
  await waitFor(() => expect(client.getQueryData(['account'])).toMatchObject({ email }));
}

/** What a signed-in console leaves behind: a cached read and a Recents entry. */
function leaveTraces(client: QueryClient, slug: string) {
  client.setQueryData(['apps'], [{ slug }]);
  window.localStorage.setItem(
    'gregale.recents',
    JSON.stringify([{ path: `/dashboard/apps/${slug}`, at: 1 }])
  );
}

describe('signing in after another account', () => {
  it('drops the previous account’s cached reads and browser state', async () => {
    const client = await mount();
    await signIn(client, 'alice@example.com');
    leaveTraces(client, 'alice-private-api');

    await act(() => auth.signOut());
    await screen.findByText('signed-out');
    await signIn(client, 'bob@example.com');

    expect(client.getQueryData(['apps'])).toBeUndefined();
    expect(window.localStorage.getItem('gregale.recents')).toBeNull();
  });

  it('does the same after the session expired instead of signing out', async () => {
    const client = await mount();
    await signIn(client, 'alice@example.com');
    leaveTraces(client, 'alice-private-api');

    // Any 401 ends the session in the console without a sign-out.
    await act(() => api.GET('/v1/apps').then(() => undefined));
    await screen.findByText('signed-out');
    await signIn(client, 'bob@example.com');

    expect(client.getQueryData(['apps'])).toBeUndefined();
    expect(window.localStorage.getItem('gregale.recents')).toBeNull();
  });

  it('keeps the cache and browser state when the same account signs back in', async () => {
    const client = await mount();
    await signIn(client, 'alice@example.com');
    leaveTraces(client, 'alice-private-api');

    await act(() => auth.signOut());
    await screen.findByText('signed-out');
    await signIn(client, 'alice@example.com');

    expect(client.getQueryData(['apps'])).toEqual([{ slug: 'alice-private-api' }]);
    expect(window.localStorage.getItem('gregale.recents')).toContain('alice-private-api');
  });
});
