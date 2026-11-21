import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EnvironmentScope } from '@/lib/environment-scope';
import { spyApi } from '@/test/api';

const env = vi.hoisted(() => ({ current: null as unknown as EnvironmentScope }));
vi.mock('@/lib/environment-scope', async (original) => ({
  ...(await original<typeof import('@/lib/environment-scope')>()),
  useEnvironmentScope: () => env.current,
}));
vi.mock('@/lib/project-scope', async (original) => ({
  ...(await original<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => ({
    project: 'shop',
    label: 'shop',
    appSlugs: null,
    settled: true,
    choices: [],
  }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'a' } }) }));

const { EnvironmentSwitcher } = await import('./environment-switcher');

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const environment = (slug: string) =>
  ({
    id: slug,
    project_id: 'p',
    slug,
    protected: slug === 'production',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }) as never;
const state = (name: string, statuses: string[]) => ({
  project_slug: 'shop',
  environment: name,
  generated_at: '2026-11-21T10:00:00Z',
  workloads: statuses.map((status, i) => ({
    workload_slug: `w${i}`,
    workload_name: `w${i}`,
    release: { workload_slug: `w${i}`, workload_name: `w${i}`, status },
  })),
});

function scope(over: Partial<EnvironmentScope> = {}): EnvironmentScope {
  return {
    applies: true,
    environment: 'production',
    kind: 'production',
    name: 'Production',
    choices: [environment('production'), environment('staging')],
    available: true,
    list: { isPending: false, isError: false, refetch: vi.fn() },
    ...over,
  };
}
const staging = (over: Partial<EnvironmentScope> = {}) =>
  scope({ environment: 'staging', kind: 'stage', name: 'Staging', ...over });

function Location() {
  const search = useRouterState({ select: (s) => s.location.search });
  return <pre data-testid="search">{JSON.stringify(search)}</pre>;
}

async function mount(entry = '/dashboard/releases?project=shop') {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '$',
    component: () => (
      <>
        <EnvironmentSwitcher />
        <Location />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  );
  await screen.findByTestId('search');
}
const search = () => JSON.parse(screen.getByTestId('search').textContent ?? '{}');

beforeEach(() => {
  spyApi('GET').mockImplementation(async (_path, init) => {
    const name = (init as { params: { path: { environment: string } } }).params.path.environment;
    return ok(
      name === 'production'
        ? state('production', ['live', 'live', 'live'])
        : state(name, ['not_deployed'])
    );
  });
});
afterEach(() => vi.restoreAllMocks());

it('shows Production with the shield when the URL names no environment', async () => {
  env.current = scope();
  await mount();
  expect(
    screen.getByRole('button', { name: 'Environment: Production. Switch environment' })
  ).toHaveTextContent('Production');
});

it('shows Staging and lists each environment with its status', async () => {
  env.current = staging();
  await mount('/dashboard/releases?project=shop&env=staging');
  await userEvent.click(
    screen.getByRole('button', { name: 'Environment: Staging. Switch environment' })
  );
  const production = await screen.findByRole('menuitem', { name: /Production/ });
  await waitFor(() => expect(production).toHaveTextContent('Protected · 3 live'));
  const stage = screen.getByRole('menuitem', { name: /Staging/ });
  await waitFor(() => expect(stage).toHaveTextContent('Nothing deployed'));
  expect(within(stage).getByText('(current)')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Compare environments' })).toHaveAttribute(
    'href',
    expect.stringContaining('/dashboard/projects/shop?tab=environments')
  );
});

it('choosing Production drops ?env=', async () => {
  env.current = staging();
  await mount('/dashboard/releases?project=shop&env=staging');
  await userEvent.click(screen.getByRole('button', { name: /Switch environment/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /Production/ }));
  await waitFor(() => expect(search()).toEqual({ project: 'shop' }));
});

it('choosing Staging puts it in the URL', async () => {
  env.current = scope();
  await mount();
  await userEvent.click(screen.getByRole('button', { name: /Switch environment/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /Staging/ }));
  await waitFor(() => expect(search()).toEqual({ project: 'shop', env: 'staging' }));
});

it('says an environment the project lacks is not in this project', async () => {
  env.current = scope({ environment: 'gone', kind: 'stage', name: 'Gone', available: false });
  await mount('/dashboard/releases?project=shop&env=gone');
  expect(screen.getByRole('button', { name: /Switch environment/ })).toHaveTextContent(
    'Gone · not in this project'
  );
});

it('says the list is loading instead of guessing one', async () => {
  env.current = staging({
    choices: null,
    available: null,
    list: { isPending: true, isError: false, refetch: vi.fn() },
  });
  await mount('/dashboard/releases?project=shop&env=staging');
  await userEvent.click(screen.getByRole('button', { name: /Switch environment/ }));
  expect(await screen.findByText('Loading environments…')).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /Production/ })).toBeNull();
});

it('says the list could not be read, with a retry', async () => {
  const refetch = vi.fn();
  env.current = staging({
    choices: null,
    available: null,
    list: { isPending: false, isError: true, refetch },
  });
  await mount('/dashboard/releases?project=shop&env=staging');
  await userEvent.click(screen.getByRole('button', { name: /Switch environment/ }));
  expect(await screen.findByText('Environments could not be read')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalled();
});

it('renders nothing where environments do not apply', async () => {
  env.current = scope({ applies: false });
  await mount('/dashboard/usage');
  expect(screen.queryByRole('button', { name: /Switch environment/ })).toBeNull();
});
