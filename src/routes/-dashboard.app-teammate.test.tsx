import { act, cleanup, render, screen } from '@testing-library/react';
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
import { Route as AppRoute } from './dashboard.apps.$appSlug';
import { ApiError } from '@/lib/api/errors';
import type { App } from '@/lib/api/queries';

/**
 * A company member opening a teammate's app: `/v1/apps` (the store) lists only
 * the signed-in account's own apps, so the page must read the app directly
 * before deciding it does not exist.
 */

const fixtures = vi.hoisted(() => ({
  direct: {} as {
    data?: unknown;
    isFetching: boolean;
    error: unknown;
    refetch: () => void;
  },
  directOptions: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: 'free' }, loading: false }),
}));
vi.mock('@/lib/api/logs', async (original) => ({
  ...(await original<object>()),
  useLogStream: () => ({
    lines: [],
    status: 'streaming',
    truncated: false,
    canRetry: false,
    clear: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The signed-in account owns nothing: the teammate's app is not in its list.
vi.mock('@/lib/store', () => ({
  useData: () => ({
    getWorkflow: () => undefined,
    loading: false,
    error: null,
    refresh: vi.fn(),
    redeploy: vi.fn(),
  }),
}));
vi.mock('@/components/dashboard/stateless-contract', () => ({
  StatelessContract: () => null,
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useApp: (_slug: string, options: unknown) => {
    fixtures.directOptions.push(options);
    return fixtures.direct;
  },
  useAppInstances: () => ({ data: [] }),
  useAppDeployments: () => ({
    data: { pages: [{ items: [] }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
  }),
  useBuildRecords: () => [],
  useAppMetrics: () => ({ data: undefined, isPending: false, error: null, refetch: vi.fn() }),
}));

const teammateApp = {
  id: 'app-theirs',
  slug: 'theirs',
  type: 'app',
  runtime: 'node24',
  ram_mb: 256,
  status: 'active',
  url: 'https://theirs.example.test',
} as App;

async function mount() {
  const root = createRootRoute({ component: Outlet });
  const app = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/apps/$appSlug',
    component: AppRoute.options.component,
    validateSearch: AppRoute.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([app]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/apps/theirs'] }),
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
}

beforeEach(() => {
  fixtures.direct = { data: undefined, isFetching: false, error: null, refetch: vi.fn() };
  fixtures.directOptions = [];
});
afterEach(cleanup);

describe("a teammate's company app", () => {
  it('opens from a direct read when the account list does not have it', async () => {
    fixtures.direct = { ...fixtures.direct, data: teammateApp };
    await mount();
    expect(screen.queryByRole('heading', { name: 'App not found' })).not.toBeInTheDocument();
    // The tab strip renders only once the page has an app to show.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // The page's own direct read (other panels call useApp too).
    expect(fixtures.directOptions).toContainEqual({ enabled: true, retry: false });
  });

  it('waits for the direct read before saying the app is missing', async () => {
    fixtures.direct = { ...fixtures.direct, isFetching: true };
    await mount();
    expect(screen.queryByRole('heading', { name: 'App not found' })).not.toBeInTheDocument();
  });

  it('says not found when apid answers 404', async () => {
    fixtures.direct = {
      ...fixtures.direct,
      error: new ApiError({ status: 404, code: 'app_not_found', title: 'Not found' }),
    };
    await mount();
    expect(screen.getByRole('heading', { name: 'App not found' })).toBeInTheDocument();
  });

  it('shows any other failure as an error to retry, not as a missing app', async () => {
    const refetch = vi.fn();
    fixtures.direct = {
      ...fixtures.direct,
      error: new ApiError({ status: 503, code: 'unavailable', title: 'Service unavailable' }),
      refetch,
    };
    await mount();
    expect(screen.queryByRole('heading', { name: 'App not found' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'theirs' })).toBeInTheDocument();
  });
});
