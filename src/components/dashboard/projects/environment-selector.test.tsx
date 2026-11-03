import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectEnvironments } from './environment-selector';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
const access = vi.hoisted(() => ({ value: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => {
  vi.restoreAllMocks();
  access.value = 'on';
});
const config = (environment: string) => ({
  project_slug: 'shop',
  environment,
  version: 2,
  config_hash: 'b'.repeat(64),
  values: { LOG_LEVEL: 'info' },
});
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const environments = ['production', 'staging'].map((slug) => ({
  id: slug,
  project_id: 'p',
  slug,
  protected: slug === 'production',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}));
function mount(environment?: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProjectEnvironments
        accountId="a"
        plan="pro"
        projectId="p"
        slug="shop"
        environment={environment}
        onChange={vi.fn()}
        onSelectQueueWorkload={vi.fn()}
      />
    </QueryClientProvider>
  );
}
it('never maps an explicitly invalid or deleted environment to production', async () => {
  const get = spyApi('GET').mockResolvedValue(ok(environments));
  mount('deleted');
  expect(await screen.findByText('Selected environment is unavailable.')).toBeInTheDocument();
  expect(
    (get.mock.calls as unknown as unknown[][]).every(
      (call) => call[0] === '/v1/projects/{slug}/environments'
    )
  ).toBe(true);
});
it('selects production only when registered, and reads its exact state', async () => {
  const get = spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/projects/{slug}/environments') return ok(environments);
    if (path === '/v1/projects/{slug}/environments/{environment}') return ok(environments[0]);
    if (path === '/v1/projects/{slug}/environments/{environment}/release-sets/verification-runs')
      return ok({ runs: [], observed_at: '2026-10-09T10:00:00Z' });
    if (path === '/v1/projects/{slug}/environments/{environment}/config')
      return ok(config('production'));
    if (path === '/v1/projects/{slug}/environments/{environment}/secrets')
      return ok({ project_slug: 'shop', environment: 'production', secrets: [], limit: 50 });
    return ok({
      project_slug: 'shop',
      environment: 'production',
      protected: true,
      configuration: {
        project_slug: 'shop',
        environment: 'production',
        version: 0,
        config_hash: 'a'.repeat(64),
        values: {},
      },
      workloads: [],
      shared_resources: [],
      generated_at: '2026-10-09T10:00:00Z',
    });
  });
  mount();
  expect(await screen.findByLabelText('Environment')).toHaveValue('production');
  await waitFor(() => expect(screen.getByText('Release graph unavailable')).toBeInTheDocument());
  expect(get).toHaveBeenCalledWith(
    '/v1/projects/{slug}/environments/{environment}/state',
    expect.objectContaining({ params: { path: { slug: 'shop', environment: 'production' } } })
  );
  // The environment's project-wide binding verification graphs.
  expect(
    await screen.findByText('No graph verification runs are retained for production.')
  ).toBeInTheDocument();
});
it('does not invent a named environment for an empty registry', async () => {
  const get = spyApi('GET').mockResolvedValue(ok([]));
  mount();
  expect(await screen.findByText('No environments')).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(1);
});

it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
  'reads no environments while the environments capability is %s',
  async (state) => {
    access.value = state;
    const get = spyApi('GET').mockResolvedValue(ok(environments));
    mount();
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /create environment/i })).toBeNull();
  }
);

it("reads a company project's environments under its organization", async () => {
  // Environment routes are account-scoped (ProjectBySlug(acct.ID, slug)), so a
  // company workspace reads /v1/orgs/{organization}/projects/{slug}/environments….
  workspace.org = 'acme';
  workspace.label = 'Acme';
  const get = spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/orgs/{organization}/projects/{slug}/environments') return ok(environments);
    if (path === '/v1/orgs/{organization}/projects/{slug}/environments/{environment}')
      return ok(environments[0]);
    if (path === '/v1/orgs/{organization}/projects/{slug}/environments/{environment}/config')
      return ok(config('production'));
    return ok({
      project_slug: 'shop',
      environment: 'production',
      protected: true,
      configuration: {
        project_slug: 'shop',
        environment: 'production',
        version: 0,
        config_hash: 'a'.repeat(64),
        values: {},
      },
      workloads: [],
      shared_resources: [],
      generated_at: '2026-10-09T10:00:00Z',
    });
  });
  try {
    mount();
    expect(await screen.findByLabelText('Environment')).toHaveValue('production');
    expect(await screen.findByText(/no shared secrets, promotions/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/v1/orgs/{organization}/projects/{slug}/environments/{environment}/state',
      expect.objectContaining({
        params: { path: { organization: 'acme', slug: 'shop', environment: 'production' } },
      })
    );
    const paths = (get.mock.calls as unknown as string[][]).map((call) => call[0]);
    expect(paths.every((path) => path.startsWith('/v1/orgs/'))).toBe(true);
    expect(screen.getByText(/New Acme environments start empty/)).toBeInTheDocument();
  } finally {
    workspace.org = null;
    workspace.label = 'Personal';
  }
});
