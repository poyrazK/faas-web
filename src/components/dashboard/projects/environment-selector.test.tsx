import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
function mount(environment = 'production') {
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
  // No picker here: the top bar chose production (no ?env=).
  expect(screen.queryByRole('group', { name: 'Environment' })).not.toBeInTheDocument();
  // The answer for the environment comes first, from what the API returned.
  expect(await screen.findByText('production is protected.')).toBeInTheDocument();
  expect(screen.getByText('No apps in this environment.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/release set unavailable/)).toBeInTheDocument());
  expect(get).toHaveBeenCalledWith(
    '/v1/projects/{slug}/environments/{environment}/state',
    expect.objectContaining({ params: { path: { slug: 'shop', environment: 'production' } } })
  );
  // Release tooling is read only once someone opens it.
  expect(get).not.toHaveBeenCalledWith(
    '/v1/projects/{slug}/environments/{environment}/release-sets/verification-runs',
    expect.anything()
  );
  await userEvent.click(screen.getByRole('button', { name: /Promotions and verification/ }));
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

/** Answers every environment read for shop, with each environment's own slug. */
function answerEnvironments(list = environments) {
  return spyApi('GET').mockImplementation(async (path, init) => {
    const name = (init as { params?: { path?: { environment?: string } } })?.params?.path
      ?.environment;
    const query = (init as { params?: { query?: { from?: string; source?: string } } })?.params
      ?.query;
    if (path === '/v1/projects/{slug}/environments') return ok(list);
    if (path === '/v1/projects/{slug}/environments/{environment}')
      return ok(list.find((e) => e.slug === name));
    if (path === '/v1/projects/{slug}/environments/{environment}/diff')
      return ok({
        project_slug: 'shop',
        from_environment: query?.from ?? query?.source,
        to_environment: name,
        generated_at: '2026-10-09T10:00:00Z',
        configuration: {
          project_slug: 'shop',
          from_environment: query?.from ?? query?.source,
          to_environment: name,
          from_version: 1,
          to_version: 1,
          from_hash: 'a'.repeat(64),
          to_hash: 'a'.repeat(64),
          changes: [],
        },
        workloads: [],
        shared_resources: [],
      });
    if (path === '/v1/projects/{slug}/environments/{environment}/release-sets/verification-runs')
      return ok({ runs: [], observed_at: '2026-10-09T10:00:00Z' });
    return ok({
      project_slug: 'shop',
      environment: name,
      protected: name === 'production',
      configuration: {
        project_slug: 'shop',
        environment: name,
        version: 0,
        config_hash: 'a'.repeat(64),
        values: {},
      },
      workloads: [],
      shared_resources: [],
      generated_at: '2026-10-09T10:00:00Z',
    });
  });
}

it('compares production against staging by default when staging is selected', async () => {
  answerEnvironments();
  mount('staging');
  expect(await screen.findByText('Production compared with Staging')).toBeInTheDocument();
});

it('shows no comparison for a project with one environment', async () => {
  answerEnvironments([environments[0]]);
  mount('production');
  await screen.findByText(/production is protected/i);
  expect(screen.queryByText(/compared with/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Compare from')).not.toBeInTheDocument();
});

it('shows the environment the URL is in, with no picker of its own', async () => {
  answerEnvironments();
  mount('staging');
  expect(await screen.findByText(/staging is not protected/i)).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup', { name: 'Environment' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Environment')).not.toBeInTheDocument();
});
