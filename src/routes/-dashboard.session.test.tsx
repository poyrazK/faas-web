import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  sessionExpired: false,
  session: null as null | { email: string },
}));

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Outlet: () => null,
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { href: '/dashboard/apps/alpha?tab=Logs' } }),
}));
vi.mock('@/components/dashboard/shell', () => ({
  DashboardShell: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/auth', () => ({
  readSession: () => mocks.session,
  hasOnboarded: () => true,
  hasOnboardingGitHubReturn: () => false,
  useAuth: () => ({ sessionExpired: mocks.sessionExpired }),
}));

const { Route } = await import('./dashboard');

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.toast.mockReset();
  mocks.sessionExpired = false;
  mocks.session = null;
});

describe('Dashboard session', () => {
  it('returns a signed-out visitor to the page they asked for after sign-in', () => {
    const location = {
      pathname: '/dashboard/apps/alpha',
      search: {},
      href: '/dashboard/apps/alpha?tab=Logs',
    };
    let thrown: unknown;
    try {
      Route.options.beforeLoad?.({ location } as never);
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string; search: unknown } }).options).toMatchObject({
      to: '/login',
      search: { next: '/dashboard/apps/alpha?tab=Logs' },
    });
  });

  it('sends a session that expires mid-use to sign in, keeping the current page', async () => {
    mocks.sessionExpired = true;
    const Layout = Route.options.component!;
    render(<Layout />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/login',
        search: { next: '/dashboard/apps/alpha?tab=Logs' },
      })
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/session expired/i) })
    );
  });
});
