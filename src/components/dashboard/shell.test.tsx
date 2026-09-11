import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardShell } from './shell';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    activeOptions: _activeOptions,
    activeProps: _activeProps,
    params: _params,
    search: _search,
    ...props
  }: {
    to: string;
    children: ReactNode | ((state: { isActive: boolean }) => ReactNode);
    activeOptions?: unknown;
    activeProps?: unknown;
    params?: unknown;
    search?: unknown;
  }) => (
    <a href={to} {...props}>
      {typeof children === 'function' ? children({ isActive: false }) : children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard' } }),
}));

vi.mock('@/lib/store', () => ({
  useData: () => ({ workflows: [] }),
}));

vi.mock('@/lib/auth', () => ({
  readWorkspace: () => 'acme-corp',
  useAuth: () => ({
    apiReachable: true,
    refreshAccount: vi.fn(),
    signOut: vi.fn(),
    user: {
      email: 'operator@example.com',
      initials: 'OP',
      name: 'Operator',
    },
  }),
}));

vi.mock('@/components/sweep-link', () => ({
  useSweepNavigate: () => vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('DashboardShell', () => {
  it('offers the existing new-app flow from the global top bar', () => {
    render(
      <DashboardShell>
        <p>Current page</p>
      </DashboardShell>
    );

    expect(screen.getByRole('link', { name: 'New app' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/new'
    );
  });
});
