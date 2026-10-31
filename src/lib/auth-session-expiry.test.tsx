import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, it, vi } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubApi(status: number) {
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
        new Response(JSON.stringify({ code: 'unauthorized', title: 'Sign in again', status }), {
          status,
          headers: { 'Content-Type': 'application/problem+json' },
        })
    )
  );
}

async function mountStatus() {
  const { AuthProvider, useAuth } = await import('./auth');
  function Status() {
    const { loading, sessionExpired } = useAuth();
    return <output>{loading ? 'checking' : sessionExpired ? 'expired' : 'not-expired'}</output>;
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Status />
      </AuthProvider>
    </QueryClientProvider>
  );
}

it('reports an expired session when a signed-in session is rejected', async () => {
  window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'owner@example.com' }));
  stubApi(401);
  await mountStatus();
  await screen.findByText('expired');
});

it('does not call a visitor who never signed in expired', async () => {
  stubApi(401);
  await mountStatus();
  await screen.findByText('not-expired');
});
