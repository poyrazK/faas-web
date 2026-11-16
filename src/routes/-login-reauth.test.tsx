import { render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { Route } from './login';
import { markOAuthPending } from '@/lib/auth';

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({ sessionError: null }),
}));
vi.mock('@/components/auth/auth-layout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/auth/password-flow', () => ({
  PasswordFlow: ({ description }: { description?: string }) => (
    <form aria-label="Sign in">
      <p>{description}</p>
      <label>
        Email
        <input type="email" />
      </label>
    </form>
  ),
}));
vi.mock('@/components/auth/oauth-handoff', () => ({
  OAuthHandoff: () => <p>Finishing old sign-in</p>,
}));

const next = '/cli-auth?code=MCPR-fixture&return=mcp';
const validate = Route.options.validateSearch as (search: Record<string, unknown>) => {
  next?: string;
  reauth?: 1;
};

async function guard(search: Record<string, unknown>) {
  return Route.options.beforeLoad?.({ search } as never);
}

describe('fresh sign-in before agent authorization', () => {
  it.each(['1', 1, true])('honors reauth=%s despite a stored session hint', async (reauth) => {
    window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'user@example.com' }));
    const search = validate({ next, reauth });
    expect(search).toEqual({ next, reauth: 1 });
    await expect(guard(search)).resolves.toBeUndefined();
  });

  it('keeps the ordinary signed-in redirect when fresh sign-in was not requested', async () => {
    window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'user@example.com' }));
    await expect(guard(validate({ next }))).rejects.toMatchObject({
      options: { href: next, reloadDocument: true },
    });
  });

  it('still rejects an external return URL during reauthentication', () => {
    expect(validate({ next: 'https://attacker.example/steal', reauth: '1' })).toEqual({
      next: undefined,
      reauth: 1,
    });
  });

  it('renders fresh sign-in instead of resuming an old OAuth marker', async () => {
    window.localStorage.setItem('gregale.session', JSON.stringify({ email: 'user@example.com' }));
    markOAuthPending(next);
    const root = createRootRoute({ component: Outlet });
    const login = createRoute({
      getParentRoute: () => root,
      path: '/login',
      validateSearch: Route.options.validateSearch,
      beforeLoad: (context) => Route.options.beforeLoad?.(context as never),
      component: Route.options.component,
    });
    const router = createRouter({
      routeTree: root.addChildren([login]),
      history: createMemoryHistory({
        initialEntries: [`/login?reauth=1&next=${encodeURIComponent(next)}`],
      }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.getByText('Sign in again to continue authorizing your connection.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Finishing old sign-in')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search.next).toBe(next);
    // The server recognizes exactly reauth=1, including after a reload.
    expect(new URLSearchParams(router.state.location.searchStr).get('reauth')).toBe('1');
  });
});
