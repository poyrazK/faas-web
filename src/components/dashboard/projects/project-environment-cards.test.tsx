import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const env = vi.hoisted(() => ({ environment: 'production' }));
vi.mock('@/lib/environment-scope', async (original) => ({
  ...(await original<typeof import('@/lib/environment-scope')>()),
  useEnvironmentScope: () => ({ environment: env.environment }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: null, label: 'Personal', ready: true }),
}));

const { ProjectEnvironmentCards } = await import('./project-overview');

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const environment = (slug: string) => ({
  id: slug,
  project_id: 'p',
  slug,
  protected: slug === 'production',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

async function mount() {
  spyApi('GET').mockResolvedValue(ok(['production', 'staging'].map(environment)));
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '$',
    component: () => <ProjectEnvironmentCards accountId="a" projectId="p" slug="shop" />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/projects/shop'] }),
  });
  await router.load();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  env.environment = 'production';
});

it('an environment card switches the scope, and production clears it', async () => {
  await mount();
  const staging = await screen.findByRole('link', { name: /Open staging/ });
  expect(staging.getAttribute('href')).toContain('env=staging');
  expect(staging.getAttribute('href')).toContain('tab=environments');
  expect(screen.getByRole('link', { name: /Open production/ }).getAttribute('href')).not.toContain(
    'env='
  );
});

it('marks the card for the environment the top bar is in', async () => {
  env.environment = 'staging';
  await mount();
  expect(await screen.findByRole('link', { name: /Open staging/ })).toHaveAttribute(
    'aria-current',
    'true'
  );
  expect(screen.getByRole('link', { name: /Open production/ })).not.toHaveAttribute('aria-current');
  expect(screen.getByText('Current')).toBeInTheDocument();
});
