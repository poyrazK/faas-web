import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { expect, it, vi } from 'vitest';
import { useConfirm } from '@/components/ui/confirm';
import { Route as OnboardingRoute } from './onboarding';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { email: 'test@example.com' } }),
  readSession: () => ({ email: 'test@example.com' }),
  markOnboarded: vi.fn(),
  beginOnboardingGitHubConnect: vi.fn(),
}));
vi.mock('@/components/sweep-link', () => ({ useSweepNavigate: () => vi.fn() }));
vi.mock('@/components/landing/shaders/pixel-beams', () => ({ PixelBeams: () => null }));
vi.mock('@/components/dashboard/new-app-wizard', () => ({
  NewAppWizard: function RecoveryConfirmation() {
    const confirm = useConfirm();
    return (
      <button
        onClick={() =>
          void confirm({ title: 'Retry this failed deployment?', confirmLabel: 'Retry deployment' })
        }
      >
        Retry original deployment
      </button>
    );
  },
}));

it('provides real recovery confirmation dialogs outside the dashboard shell', async () => {
  const root = createRootRoute({ component: Outlet });
  const onboarding = createRoute({
    getParentRoute: () => root,
    path: '/onboarding',
    component: OnboardingRoute.options.component,
    validateSearch: OnboardingRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([onboarding]),
    history: createMemoryHistory({ initialEntries: ['/onboarding'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Retry original deployment' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Retry this failed deployment?');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry deployment' })).toBeVisible()
  );
});
