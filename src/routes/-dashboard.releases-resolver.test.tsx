import { act, cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
  useSearch,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Resolver } from './dashboard.releases_.$deploymentId';

const APP_ID = '0123456789ab4def8123456789abcdef';

const f = vi.hoisted(() => ({
  personal: [] as { id: string; slug: string }[],
  org: null as string | null,
  orgApps: [] as { id: string; slug: string }[],
  deployment: 'ready' as 'ready' | 'missing',
  orgError: null as Error | null,
}));

vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useApps: () => ({ data: f.personal, isPending: false, error: null, refetch: vi.fn() }),
  useDeployment: () =>
    f.deployment === 'ready'
      ? { data: { id: 'dep-1', app_id: APP_ID }, isPending: false, error: null, refetch: vi.fn() }
      : {
          data: undefined,
          isPending: false,
          error: Object.assign(new Error('Not found'), { code: 'not_found', status: 404 }),
          refetch: vi.fn(),
        },
}));
vi.mock('@/lib/api/workspace-apps', async (original) => ({
  ...(await original<object>()),
  useWorkspaceTarget: () => ({ org: f.org, label: f.org ?? 'Personal', ready: true }),
  // A disabled query reports pending forever; the resolver must not wait on it.
  useOrgApps: (org: string | null) =>
    !org
      ? { data: undefined, isPending: true, error: null, refetch: vi.fn() }
      : f.orgError
        ? { data: undefined, isPending: false, error: f.orgError, refetch: vi.fn() }
        : { data: { apps: f.orgApps }, isPending: false, error: null, refetch: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct' }, loading: false }) }));

function CanonicalStub() {
  const { appSlug, deploymentId } = useParams({ strict: false }) as Record<string, string>;
  const search = useSearch({ strict: false }) as { panel?: string };
  return (
    <p>
      release page {appSlug} {deploymentId} {search.panel ?? 'no panel'}
    </p>
  );
}

async function mount(entry: string) {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      dashboard.addChildren([
        createRoute({
          getParentRoute: () => dashboard,
          path: 'releases/$deploymentId',
          component: Resolver.options.component,
          validateSearch: Resolver.options.validateSearch,
        }),
        createRoute({
          getParentRoute: () => dashboard,
          path: 'apps/$appSlug/releases/$deploymentId',
          component: CanonicalStub,
        }),
        createRoute({
          getParentRoute: () => dashboard,
          path: 'releases',
          component: () => <p>Releases list</p>,
        }),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

beforeEach(() => {
  f.personal = [];
  f.org = null;
  f.orgApps = [];
  f.deployment = 'ready';
  f.orgError = null;
});
afterEach(cleanup);

describe('the release shortcut', () => {
  it('sends a personal app’s release to its page, keeping the popup', async () => {
    f.personal = [{ id: APP_ID, slug: 'alpha' }];
    const router = await mount('/dashboard/releases/dep-1?panel=security');
    expect(await screen.findByText('release page alpha dep-1 security')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard/apps/alpha/releases/dep-1');
  });

  it('finds an organization app in the active workspace', async () => {
    f.org = 'acme';
    f.orgApps = [{ id: '01234567-89ab-4def-8123-456789abcdef', slug: 'shared' }];
    await mount('/dashboard/releases/dep-1');
    expect(await screen.findByText('release page shared dep-1 no panel')).toBeInTheDocument();
  });

  it('says so when the app is outside this workspace', async () => {
    await mount('/dashboard/releases/dep-1');
    expect(
      await screen.findByText('This release belongs to an app outside this workspace.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Releases' })).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it('shows the error when the release cannot be read', async () => {
    f.deployment = 'missing';
    await mount('/dashboard/releases/dep-1');
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });

  it('shows the error, not a wrong answer, when the workspace’s apps cannot be read', async () => {
    f.org = 'acme';
    f.orgError = new Error('Organization apps failed');
    await mount('/dashboard/releases/dep-1');
    expect(await screen.findByText('Organization apps failed')).toBeInTheDocument();
    expect(screen.queryByText(/outside this workspace/)).not.toBeInTheDocument();
  });
});
