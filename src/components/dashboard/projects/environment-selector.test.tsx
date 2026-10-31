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
afterEach(() => vi.restoreAllMocks());
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
});
it('does not invent a named environment for an empty registry', async () => {
  const get = spyApi('GET').mockResolvedValue(ok([]));
  mount();
  expect(await screen.findByText('No environments')).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(1);
});

it("reads no environments for a company's project, and says why", async () => {
  // Environment routes are account-scoped (ProjectBySlug(acct.ID, slug)): in a
  // company workspace they would show a same-named personal project's
  // environments. Org environments are Wave 3 (A20).
  workspace.org = 'acme';
  workspace.label = 'Acme';
  const get = spyApi('GET').mockResolvedValue(ok(environments));
  try {
    mount();
    expect(
      await screen.findByText(
        /Environments for Acme's projects are not available in the console yet/
      )
    ).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  } finally {
    workspace.org = null;
    workspace.label = 'Personal';
  }
});
