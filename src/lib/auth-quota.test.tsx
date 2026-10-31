import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('clears an expired OAuth handoff after the account read returns 401', async () => {
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
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: 'unauthorized', title: 'Sign in again', status: 401 }),
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } }
        )
    )
  );
  const { AuthProvider, useAuth, markOAuthPending, hasOAuthPending } = await import('./auth');
  markOAuthPending();
  function Status() {
    const { loading, account } = useAuth();
    return <output>{loading ? 'checking' : account ? 'signed-in' : 'signed-out'}</output>;
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Status />
      </AuthProvider>
    </QueryClientProvider>
  );
  await screen.findByText('signed-out');
  expect(hasOAuthPending()).toBe(false);
});

it('refreshes the account quota after deleting an app without discarding the current form', async () => {
  window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'owner@example.com' }));
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
  let count = 100;
  let accountReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === '/v1/account') {
        accountReads++;
        return new Response(
          JSON.stringify({
            id: 'owner',
            email: 'owner@example.com',
            plan: 'scale',
            app_count: count,
            limits: { deployed_apps: 100 },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (request.method === 'DELETE' && path === '/v1/apps/old-test') {
        count--;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${request.method} ${path}`);
    })
  );
  const { AuthProvider, useAuth } = await import('./auth');
  const { useDeleteApp } = await import('./api/queries');
  function Form() {
    const { account } = useAuth();
    const deletion = useDeleteApp();
    return (
      <>
        <input aria-label="App draft" defaultValue="imgpipe-gateway" />
        <output aria-label="App count">{account?.app_count ?? 'loading'}</output>
        <button onClick={() => void deletion.mutateAsync('old-test')}>Delete old test</button>
      </>
    );
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }
  render(<Form />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByLabelText('App count')).toHaveTextContent('100'));
  await userEvent.click(screen.getByRole('button', { name: 'Delete old test' }));
  await waitFor(() => expect(screen.getByLabelText('App count')).toHaveTextContent('99'));
  expect(accountReads).toBeGreaterThanOrEqual(2);
  expect(screen.getByLabelText('App draft')).toHaveValue('imgpipe-gateway');
});
