import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubRequest() {
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
}

const account = () =>
  new Response(JSON.stringify({ email: 'owner@example.com', plan: 'free' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

async function mount(client: QueryClient, strict = false) {
  const { AuthProvider, useAuth } = await import('./auth');
  function Status() {
    const { loading, apiReachable } = useAuth();
    return <output>{loading ? 'checking' : apiReachable ? 'reachable' : 'unreachable'}</output>;
  }
  const tree = (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Status />
      </AuthProvider>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

it('does not call the API unreachable when its boot read is cancelled', async () => {
  // Under StrictMode (development) the provider's account observer detaches and
  // reattaches during mount; TanStack cancels the in-flight boot read when its
  // last observer leaves, because the read consumed its abort signal. The read
  // that follows answers, so the API is reachable.
  window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'owner@example.com' }));
  stubRequest();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (req: Request) =>
        new Promise<Response>((resolve, reject) => {
          req.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
          setTimeout(() => resolve(account()), 20);
        })
    )
  );
  await mount(new QueryClient(), true);
  await screen.findByText('reachable');
  expect(screen.queryByText('unreachable')).not.toBeInTheDocument();
});

it('still reports an unreachable API when the boot read fails in transport', async () => {
  window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'owner@example.com' }));
  stubRequest();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    })
  );
  await mount(new QueryClient());
  await screen.findByText('unreachable');
});
