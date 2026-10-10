import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route as CheckerRoute } from './will-it-run';
import { Route as SignupRoute } from './signup';
import { Route as LoginRoute } from './login';
import { Route as DashboardRoute } from './dashboard';
import { Route as OnboardingRoute } from './onboarding';
import { CompatibilityEntry } from '@/components/landing/compatibility-entry';
import { api } from '@/lib/api/client';
import { markOAuthPending } from '@/lib/auth';

afterEach(() => vi.restoreAllMocks());

async function mount(path: string, level = 'green') {
  const sha = 'b'.repeat(40);
  vi.spyOn(api, 'GET').mockImplementation(
    async () =>
      ({
        data: {
          source: { owner: 'team', repo: 'api', ref: 'release/v2' },
          commit_sha: sha,
          verdict: { level, profile: { framework: 'node', port: 8080 }, findings: [] },
          plan_budgets: [],
          checked_at: '2026-10-11T00:00:00Z',
        },
        response: new Response(null, { status: 200 }),
      }) as never
  );
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: CompatibilityEntry,
  });
  const checker = createRoute({
    getParentRoute: () => root,
    path: '/will-it-run',
    validateSearch: CheckerRoute.options.validateSearch,
    component: CheckerRoute.options.component,
  });
  const signup = createRoute({
    getParentRoute: () => root,
    path: '/signup',
    validateSearch: SignupRoute.options.validateSearch,
    component: () => <p>Create account</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, checker, signup]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe('compatibility to deployment', () => {
  it('takes a repository from the landing form through a check to signup with the exact checked commit', async () => {
    const router = await mount('/');
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText('Public GitHub repository'),
      'https://github.com/team/api'
    );
    await user.click(screen.getByRole('button', { name: 'Will it run?' }));
    expect(router.state.location.pathname).toBe('/will-it-run');
    expect(router.state.location.search.source).toBe('https://github.com/team/api');
    await user.click(
      await screen.findByRole('link', { name: 'Deploy this commit' }, { timeout: 3000 })
    );
    expect(router.state.location.pathname).toBe('/signup');
    expect(router.state.location.search.next).toBe(
      `/dashboard/workflows/new?source=git&repo=team%2Fapi&ref=${'b'.repeat(40)}`
    );
  });

  it.each(['red', 'amber'])(
    'does not encourage deploying an unresolved %s result',
    async (level) => {
      await mount('/will-it-run?source=team%2Fapi', level);
      await screen.findByText(
        /This (won't run here|runs, with a change or two)/,
        {},
        { timeout: 3000 }
      );
      expect(screen.queryByRole('link', { name: 'Deploy this commit' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    }
  );
});

async function guardRedirect(
  route: typeof SignupRoute | typeof LoginRoute | typeof DashboardRoute | typeof OnboardingRoute,
  path: string,
  search: Record<string, unknown> = {}
) {
  let thrown: unknown;
  await act(async () => {
    try {
      await route.options.beforeLoad?.({
        search,
        location: { pathname: path.split('?')[0], href: path, search },
      } as never);
    } catch (error) {
      thrown = error;
    }
  });
  return (thrown as { options: Record<string, unknown> })?.options;
}

describe('authentication journey guards', () => {
  const next = '/dashboard/workflows/new?source=git&repo=team%2Fapi&ref=release%2Fv2';
  it('allows the OAuth callback to restore its saved destination even when a session hint already exists', async () => {
    window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'user@example.com' }));
    markOAuthPending(next);
    expect(await guardRedirect(LoginRoute, '/login')).toBeUndefined();
  });

  it.each([SignupRoute, LoginRoute])(
    'honors the destination for an already signed-in visitor',
    async (route) => {
      window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'user@example.com' }));
      expect(await guardRedirect(route, '/signup', { next })).toMatchObject({ href: next });
    }
  );

  it('keeps an unauthenticated deployment deep link through login', async () => {
    expect(
      await guardRedirect(DashboardRoute, next, {
        source: 'git',
        repo: 'team/api',
        ref: 'release/v2',
      })
    ).toMatchObject({ to: '/login', search: { next } });
  });

  it('carries the repository into onboarding for a new account', async () => {
    window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'user@example.com' }));
    expect(
      await guardRedirect(DashboardRoute, next, {
        source: 'git',
        repo: 'team/api',
        ref: 'release/v2',
      })
    ).toMatchObject({
      to: '/onboarding',
      search: { source: 'git', repo: 'team/api', ref: 'release/v2' },
    });
  });
});
