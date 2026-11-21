import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import type { ProjectScope } from './project-scope';

const scope = vi.hoisted(() => ({ current: null as unknown as ProjectScope }));
const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('./project-scope', async (original) => ({
  ...(await original<typeof import('./project-scope')>()),
  useProjectScope: () => scope.current,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'a' } }) }));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

const { useEnvironmentScope } = await import('./environment-scope');

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const environment = (slug: string) => ({
  id: slug,
  project_id: 'p',
  slug,
  protected: slug === 'production',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

function Probe() {
  const env = useEnvironmentScope();
  return (
    <pre data-testid="scope">
      {JSON.stringify({
        applies: env.applies,
        environment: env.environment,
        kind: env.kind,
        name: env.name,
        available: env.available,
        choices: env.choices?.map((c) => c.slug) ?? null,
      })}
    </pre>
  );
}

async function mount(entry: string, project: string | null = 'shop') {
  scope.current = { project, label: project ?? '', appSlugs: null, settled: true, choices: [] };
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '$', component: Probe });
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
}
const read = () => JSON.parse(screen.getByTestId('scope').textContent ?? '{}');

let get: ReturnType<typeof spyApi>;
beforeEach(() => {
  get = spyApi('GET').mockResolvedValue(ok(['staging', 'production'].map(environment)));
});
afterEach(() => {
  vi.restoreAllMocks();
  workspace.org = null;
});

it('is production when the URL names no environment', async () => {
  await mount('/dashboard/releases?project=shop');
  await waitFor(() => expect(read().choices).toEqual(['production', 'staging']));
  expect(read()).toMatchObject({
    applies: true,
    environment: 'production',
    kind: 'production',
    name: 'Production',
    available: true,
  });
});

it('reads ?env= and checks it against the project', async () => {
  await mount('/dashboard/releases?project=shop&env=staging');
  await waitFor(() => expect(read().available).toBe(true));
  expect(read()).toMatchObject({ environment: 'staging', kind: 'stage', name: 'Staging' });
  expect(get).toHaveBeenCalledWith(
    '/v1/projects/{slug}/environments',
    expect.objectContaining({ params: { path: { slug: 'shop' } } })
  );
});

it('marks an environment the project lacks as unavailable, never production', async () => {
  await mount('/dashboard/releases?project=shop&env=gone');
  await waitFor(() => expect(read().available).toBe(false));
  expect(read()).toMatchObject({ environment: 'gone', name: 'Gone' });
});

it('does not apply, and reads nothing, on account pages or for standalone apps', async () => {
  await mount('/dashboard/usage?env=staging', null);
  expect(read().applies).toBe(false);
  await mount('/dashboard/apps?project=_standalone&env=staging', '_standalone');
  expect(
    screen.getAllByTestId('scope').map((n) => JSON.parse(n.textContent ?? '{}').applies)
  ).toEqual([false, false]);
  expect(get).not.toHaveBeenCalled();
});

it('does not apply in a company workspace', async () => {
  workspace.org = 'acme';
  await mount('/dashboard/releases?project=shop&env=staging');
  expect(read().applies).toBe(false);
  expect(get).not.toHaveBeenCalled();
});
