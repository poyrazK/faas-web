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

const auth = vi.hoisted(() => ({
  account: { id: 'free-account', email: 'test@example.com', plan: 'free', email_verified: false },
  user: { email: 'test@example.com' },
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => auth,
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

async function openOnboarding(path = '/onboarding') {
  const root = createRootRoute({ component: Outlet });
  const onboarding = createRoute({
    getParentRoute: () => root,
    path: '/onboarding',
    component: OnboardingRoute.options.component,
    validateSearch: OnboardingRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([onboarding]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

it('offers the private Node CLI quickstart immediately for a new Free account', async () => {
  await openOnboarding();
  expect(
    await screen.findByRole('heading', { name: 'Deploy a private Node app from your terminal' })
  ).toBeVisible();
  expect(screen.getByText('Verify email')).toBeVisible();
  expect(screen.getByText('gregale start')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Private Node quickstart' })).toHaveAttribute(
    'href',
    '/docs/quickstart#deploy-a-private-node-app-on-free'
  );
});

it('keeps an explicit repository entry focused on that setup', async () => {
  await openOnboarding('/onboarding?source=git&repo=example%2Fapp');
  expect(await screen.findByRole('button', { name: 'Retry original deployment' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Private Node quickstart' })).not.toBeInTheDocument();
});

it('provides real recovery confirmation dialogs outside the dashboard shell', async () => {
  await openOnboarding();
  await userEvent.click(await screen.findByRole('button', { name: 'Retry original deployment' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Retry this failed deployment?');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry deployment' })).toBeVisible()
  );
});
