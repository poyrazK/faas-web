import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/components/auth/auth-layout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/landing/nav', () => ({ Nav: () => <p>Landing navigation</p> }));
vi.mock('@/components/landing/hero', () => ({ Hero: () => <p>Landing page</p> }));
vi.mock('@/components/landing/how-it-works', () => ({ HowItWorks: () => null }));
vi.mock('@/components/landing/process', () => ({ Process: () => null }));
vi.mock('@/components/landing/feature-explorer', () => ({ FeatureExplorer: () => null }));
vi.mock('@/components/landing/practical-questions', () => ({ PracticalQuestions: () => null }));
vi.mock('@/components/landing/pricing', () => ({ Pricing: () => null }));
vi.mock('@/components/landing/footer', () => ({ Footer: () => null }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function reproduce(status: number, strict: boolean, retry = false, next?: string) {
  let responseStatus = status;
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
  const requests: string[] = [];
  let aborted = 0;
  let delivered = 0;
  const fetch = vi.fn(
    (req: Request) =>
      new Promise<Response>((resolve, reject) => {
        requests.push(new URL(req.url).pathname);
        if (req.signal.aborted) {
          aborted++;
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        req.signal.addEventListener('abort', () => {
          aborted++;
          reject(new DOMException('aborted', 'AbortError'));
        });
        setTimeout(() => {
          if (req.signal.aborted) return;
          delivered++;
          resolve(
            new Response(
              responseStatus === 200
                ? JSON.stringify({ id: 'test-account', email: 'owner@example.test', plan: 'pro' })
                : '<html><title>Just a moment...</title></html>',
              {
                status: responseStatus,
                headers: {
                  'Content-Type': responseStatus === 200 ? 'application/json' : 'text/html',
                  ...(responseStatus === 403 ? { 'cf-mitigated': 'challenge' } : {}),
                },
              }
            )
          );
        }, 30);
      })
  );
  vi.stubGlobal('fetch', fetch);
  const { AuthProvider, useAuth, markOAuthPending, hasOAuthPending, readSession } =
    await import('@/lib/auth');
  const { Route } = await import('./index');
  markOAuthPending(next);
  function State() {
    const { loading, user, apiReachable } = useAuth();
    return (
      <output data-testid="auth-state">
        {JSON.stringify({ loading, user: !!user, apiReachable })}
      </output>
    );
  }
  const root = createRootRoute({ component: Outlet });
  const landing = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: Route.options.component,
  });
  const onboard = createRoute({
    getParentRoute: () => root,
    path: '/onboarding',
    component: () => <p>Onboarding page</p>,
  });
  const dash = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => <p>Console page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([landing, onboard, dash]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <State />
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
  await act(async () => {
    render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  });
  await waitFor(() =>
    expect(screen.getByTestId('auth-state')).toHaveTextContent('"loading":false')
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  if (retry) {
    responseStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Retry sign-in check' }));
    await screen.findByText('Onboarding page');
  }
  const result = {
    status,
    strict,
    path: router.state.location.pathname,
    auth: JSON.parse(screen.getByTestId('auth-state').textContent!),
    pending: hasOAuthPending(),
    hint: !!readSession(),
    requests: requests.length,
    aborted,
    delivered,
  };
  return result;
}

it('control: a successful production account read finishes OAuth', async () => {
  expect((await reproduce(200, false)).path).toBe('/onboarding');
});
it('preserves the OAuth destination and offers retry on an upstream challenge', async () => {
  const r = await reproduce(403, false);
  expect(r.path).toBe('/');
  expect(r.auth.user).toBe(false);
  expect(r.pending).toBe(true);
});
it('replaces the cancelled StrictMode OAuth boot read and completes sign-in', async () => {
  const r = await reproduce(200, true);
  expect(r.aborted).toBe(1);
  expect(r.delivered).toBe(1);
  expect(r.path).toBe('/onboarding');
  expect(r.auth.user).toBe(true);
  expect(r.pending).toBe(false);
});

it('recovers a challenged account check on explicit retry without starting OAuth again', async () => {
  const r = await reproduce(403, true, true);
  expect(r.path).toBe('/onboarding');
  expect(r.auth.user).toBe(true);
  expect(r.pending).toBe(false);
});
it('keeps a validated CLI authorization destination across a failed account check', async () => {
  await reproduce(403, false, false, '/cli/authorize?code=example');
  const { readOAuthReturnTo } = await import('@/lib/auth');
  expect(readOAuthReturnTo()).toBe('/cli/authorize?code=example');
  expect(screen.getByRole('button', { name: 'Retry sign-in check' })).toBeVisible();
});
