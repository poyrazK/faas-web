import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, it, vi } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('does not report the API unreachable when the account check is cancelled', async () => {
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ email: 'owner@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );

  const { AuthProvider, useAuth } = await import('./auth');
  function Status() {
    const { loading, apiReachable } = useAuth();
    return <output>{loading ? 'checking' : apiReachable ? 'reachable' : 'unreachable'}</output>;
  }
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Status />
      </AuthProvider>
    </QueryClientProvider>
  );
  // What a superseding fetch of the same key does to the one in flight.
  await client.cancelQueries({ queryKey: ['account'] });

  await screen.findByText('reachable');
});
