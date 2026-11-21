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
  hiddenCapabilities: [] as string[],
  summary: undefined as Record<string, unknown> | undefined,
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
  useCapabilityAccess: (capability: string) => ({
    access: fixtures.hiddenCapabilities.includes(capability) ? 'hidden' : 'on',
    refresh: () => {},
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'pro' }, loading: false }) }));
vi.mock('@/lib/api/queries', async (original) => {
  const actual = await original<object>();
  const ok = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
  return {
    ...actual,
    useApp: () => ok(fixtures.app),
    useApps: () => ok([fixtures.app]),
    useBuild: (id: string) => ok(id ? fixtures.build : undefined),
    useDeploymentSummary: () => ok(fixtures.summary),
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
  fixtures.summary = undefined;
  fixtures.hiddenCapabilities = [];
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    }
  );
  routes.clear();
  spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/deployments/{id}')
      return { data: fixtures.deployment, response: new Response() } as never;
    if (routes.has(path)) return { data: routes.get(path), response: new Response() } as never;
    return {
      error: { code: 'not_found', status: 404, title: 'Not found' },
      response: new Response(null, { status: 404 }),
    } as never;
  });
});

/** Answers for the reads behind the tiles; anything unlisted is a 404. */
const routes = new Map<string, unknown>();

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
    const streams = vi.fn();
    vi.stubGlobal(
      'EventSource',
      class {
        constructor() {
          streams();
        }
        addEventListener() {}
        close() {}
      }
    );
    await mount();
    expect(await screen.findByText('This release is not part of this app.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Release tiles' })).not.toBeInTheDocument();
    expect(screen.queryByText('Live · 100% of traffic')).not.toBeInTheDocument();
    // Another app's build log is never opened.
    expect(streams).not.toHaveBeenCalled();
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

describe('Release tiles', () => {
  function tile(name: string) {
    return screen.getByRole('group', { name });
  }

  it('says Not scanned on a 404 and still renders the other tiles', async () => {
    routes.set('/v1/deployments/{id}/diff', { summary: 'new code, 2 config keys' });
    await mount();
    await waitFor(() =>
      expect(within(tile('Security')).getByText('Not scanned')).toBeInTheDocument()
    );
    expect(within(tile('What changed')).getByText('new code, 2 config keys')).toBeInTheDocument();
    for (const name of ['Build output', 'Traffic & rollout', 'Runtime', 'Activity'])
      expect(tile(name)).toBeInTheDocument();
  });

  it('counts critical and high findings and found secrets', async () => {
    routes.set('/v1/deployments/{id}/scan', {
      status: 'complete',
      severity_counts: { critical: 0, high: 1, medium: 0, low: 2, unknown: 0 },
    });
    routes.set('/v1/deployments/{id}/secret-scan', {
      status: 'complete',
      findings: [{ severity: 'high' }, { severity: 'low' }],
    });
    await mount();
    const security = await screen.findByRole('group', { name: 'Security' });
    await waitFor(() => expect(within(security).getByText('0 critical')).toBeInTheDocument());
    expect(within(security).getByText('1 high · 2 secrets found')).toBeInTheDocument();
  });

  it('shows the commit and SBOM, and never claims a signature', async () => {
    routes.set('/v1/builds/{id}/provenance', {
      commit_sha: 'abcdef0123456789',
      sbom_storage_key: 'sbom/build-1.json',
    });
    await mount();
    const provenance = await screen.findByRole('group', { name: 'Provenance' });
    await waitFor(() => expect(within(provenance).getByText('abcdef0')).toBeInTheDocument());
    expect(within(provenance).getByText('SBOM ready')).toBeInTheDocument();
    expect(screen.queryByText(/signed/i)).not.toBeInTheDocument();
  });

  it('leaves out the release command and canary tiles when the release has neither', async () => {
    await mount();
    await screen.findByRole('group', { name: 'Security' });
    expect(screen.queryByRole('group', { name: 'Release command' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Canary health' })).not.toBeInTheDocument();
  });

  it('shows the release command and canary tiles when the release has them', async () => {
    fixtures.deployment = deployment({
      canary_total_steps: 4,
      canary_step: 2,
      release: {
        status: 'succeeded',
        started_at: '2026-11-21T10:00:00Z',
        finished_at: '2026-11-21T10:00:04Z',
      },
    });
    await mount();
    expect(await screen.findByRole('group', { name: 'Canary health' })).toHaveTextContent(
      'Step 2 of 4'
    );
    expect(screen.getByRole('group', { name: 'Release command' })).toHaveTextContent('4s');
  });

  it('says there is nothing to compare when the diff has no summary', async () => {
    routes.set('/v1/deployments/{id}/diff', { summary: '' });
    await mount();
    await waitFor(() =>
      expect(
        within(tile('What changed')).getByText('No earlier release to compare')
      ).toBeInTheDocument()
    );
  });

  it('opens a tile’s popup through the URL', async () => {
    const router = await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Security' }));
    expect(await screen.findByRole('dialog', { name: 'Security' })).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ panel: 'security' });
  });

  it('names the latest audit event on the Activity tile', async () => {
    routes.set('/v1/deployments/{id}/audit', {
      items: [{ kind: 'deploy.created', actor: 'ada@example.test', at: '2026-11-21T10:00:00Z' }],
      limit: 1,
    });
    await mount();
    await waitFor(() => expect(tile('Activity')).toHaveTextContent('Created by ada@example.test'));
  });
});

describe('Release main action and rollout', () => {
  it('leads with one rollback that the What changed popup does not repeat', async () => {
    fixtures.summary = {
      deployment: fixtures.deployment,
      previous: null,
      changes: [],
      rollback_target_id: 'dep-0',
      rollback_target_revision: 13,
    };
    await mount('/dashboard/apps/alpha/releases/dep-1?panel=changes');
    await screen.findByRole('dialog', { name: 'What changed' });
    expect(screen.getAllByRole('button', { name: 'Roll back to v13' })).toHaveLength(1);
  });

  it('leads a failed release with Retry, which opens the recovery controls', async () => {
    fixtures.deployment = deployment({ status: 'failed', traffic_percent: 0 });
    const router = await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    const dialog = await screen.findByRole('dialog', { name: 'Traffic & rollout' });
    expect(within(dialog).getByRole('heading', { name: 'Recover' })).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ panel: 'rollout' });
  });

  it('groups the rollout controls under plain headings, in order', async () => {
    await mount('/dashboard/apps/alpha/releases/dep-1?panel=rollout');
    const dialog = await screen.findByRole('dialog', { name: 'Traffic & rollout' });
    const headings = within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Now', 'Move traffic', 'Approval', 'Recover', 'Stages', 'Aliases']);
  });

  it('leaves out Approval when release approvals are hidden for the account', async () => {
    fixtures.hiddenCapabilities = ['release-approvals'];
    await mount('/dashboard/apps/alpha/releases/dep-1?panel=rollout');
    const dialog = await screen.findByRole('dialog', { name: 'Traffic & rollout' });
    expect(within(dialog).queryByRole('heading', { name: 'Approval' })).not.toBeInTheDocument();
  });

  it('opens the rollout popup from More', async () => {
    await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    expect(await screen.findByRole('dialog', { name: 'Traffic & rollout' })).toBeInTheDocument();
  });
});
