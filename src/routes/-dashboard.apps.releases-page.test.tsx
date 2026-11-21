import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as ReleasePageRoute } from './dashboard.apps.$appSlug_.releases.$deploymentId';
import { spyApi } from '@/test/api';

const fixtures = vi.hoisted(() => ({
  app: { id: 'app-1', slug: 'alpha' },
  deployment: {} as Record<string, unknown>,
  build: {
    id: 'build-1',
    deployment_id: 'dep-1',
    kind: 'github',
    source_bytes: 2048,
    status: 'succeeded',
    duration_seconds: 42,
    enqueued_at: '2026-11-21T10:00:00Z',
  } as Record<string, unknown>,
}));

vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => ({ project: null, label: '', appSlugs: null, settled: true, choices: [] }),
}));
vi.mock('@/lib/api/capabilities', async (original) => ({
  ...(await original<typeof import('@/lib/api/capabilities')>()),
  useCapabilityRegistry: () => ({ query: { data: undefined }, phase: 'loading' }),
  useCapabilityAccess: () => ({ access: 'on', refresh: () => {} }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'pro' }, loading: false }) }));
vi.mock('@/lib/api/queries', async (original) => {
  const actual = await original<object>();
  const ok = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
  return {
    ...actual,
    useApp: () => ok(fixtures.app),
    useApps: () => ok([fixtures.app]),
    useBuild: (id: string) => ok(id ? fixtures.build : undefined),
    useDeploymentSummary: () => ok(undefined),
    useDeploymentPreviewUrl: () => ok({ url: '' }),
  };
});

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    app_id: 'app-1',
    revision: 14,
    kind: 'github',
    status: 'active',
    traffic_percent: 100,
    build_id: 'build-1',
    image_digest: 'sha256:aaaa',
    created_at: '2026-11-21T10:00:00Z',
    min_instances: 0,
    ...overrides,
  };
}

async function mount(entry = '/dashboard/apps/alpha/releases/dep-1') {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const page = createRoute({
    getParentRoute: () => dashboard,
    path: 'apps/$appSlug/releases/$deploymentId',
    component: ReleasePageRoute.options.component,
    validateSearch: ReleasePageRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([page])]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return router;
}

beforeEach(() => {
  fixtures.app = { id: 'app-1', slug: 'alpha' };
  fixtures.deployment = deployment();
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    }
  );
  spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/deployments/{id}')
      return { data: fixtures.deployment, response: new Response() } as never;
    return { data: undefined, response: new Response(null, { status: 404 }) } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Release page', () => {
  it('renders the release name, status and traffic', async () => {
    await mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'v14' })).toBeInTheDocument();
    expect(screen.getByText('Live · 100% of traffic')).toBeInTheDocument();
  });

  it('polls while deploying and keeps an open popup open', async () => {
    fixtures.deployment = deployment({ status: 'building', traffic_percent: 0 });
    await mount('/dashboard/apps/alpha/releases/dep-1?panel=details');
    expect(await screen.findByRole('dialog', { name: 'All details' })).toBeInTheDocument();
    expect(screen.getByText('Updating')).toBeInTheDocument();
    fixtures.deployment = deployment();
    await waitFor(() => expect(screen.getByText('Live · 100% of traffic')).toBeInTheDocument(), {
      timeout: 4_000,
    });
    expect(screen.getByRole('dialog', { name: 'All details' })).toBeInTheDocument();
    expect(screen.queryByText('Updating')).not.toBeInTheDocument();
  });

  it('refuses a release from another app', async () => {
    fixtures.deployment = deployment({ app_id: 'other-app' });
    await mount();
    expect(await screen.findByText('This release is not part of this app.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Release tiles' })).not.toBeInTheDocument();
    expect(screen.queryByText('Live · 100% of traffic')).not.toBeInTheDocument();
  });

  it('shows the failure card first', async () => {
    fixtures.deployment = deployment({
      status: 'failed',
      traffic_percent: 0,
      error_why: 'Port 8080 never opened.',
    });
    await mount();
    const failure = await screen.findByRole('region', { name: 'Failure explanation' });
    const process = screen.getByRole('region', { name: 'Process' });
    expect(within(failure).getByText('Port 8080 never opened.')).toBeInTheDocument();
    expect(
      failure.compareDocumentPosition(process) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('copies full IDs from the facts strip and opens all details', async () => {
    const router = await mount();
    const facts = await screen.findByRole('region', { name: 'Release facts' });
    expect(within(facts).getByRole('button', { name: /deployment ID dep-1/ })).toBeInTheDocument();
    expect(within(facts).getByRole('button', { name: /build ID build-1/ })).toBeInTheDocument();
    expect(
      within(facts).getByRole('button', { name: /image digest sha256:aaaa/ })
    ).toBeInTheDocument();
    await userEvent.click(within(facts).getByRole('button', { name: 'All details' }));
    const dialog = await screen.findByRole('dialog', { name: 'All details' });
    for (const label of ['Kind', 'Error code', 'Build status', 'Source size'])
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ panel: 'details' });
  });

  it('drops a popup the release does not have', async () => {
    const router = await mount('/dashboard/apps/alpha/releases/dep-1?panel=canary');
    await screen.findByRole('heading', { level: 1, name: 'v14' });
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('panel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
