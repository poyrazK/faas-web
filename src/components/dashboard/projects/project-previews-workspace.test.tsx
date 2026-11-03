import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectPreviews } from './preview-workload-set';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => workspace,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
});
afterEach(() => vi.restoreAllMocks());
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const problem = (status: number, code: string) =>
  ({
    error: { status, code, title: code, detail: code },
    response: new Response(null, { status }),
  }) as never;
const PROJECT = '3f2b8c1e-6a4d-4e5f-9b7a-1c2d3e4f5a6b';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const summary = (slug: string, project_id?: string) => ({
  id: `id-${slug}`,
  slug,
  type: 'app',
  project_id,
  status: 'active',
  created_at: '2026-10-01T00:00:00Z',
});
function mount(selected?: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProjectPreviews
        accountId="a"
        projectId={PROJECT}
        projectSlug="shop"
        parents={['api']}
        selected={selected}
        onSelect={vi.fn()}
      />
    </QueryClientProvider>
  );
}
function stubCompany() {
  return spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/orgs/{slug}/apps')
      return ok({
        apps: [
          summary('api', PROJECT),
          summary('pr-3-api', PROJECT),
          // Another project's preview, and a standalone app's.
          summary('pr-4-billing', OTHER),
          summary('pr-9-solo'),
        ],
      });
    if (path === '/v1/apps/{slug}')
      return ok({
        slug: 'pr-3-api',
        preview_of_slug: 'api',
        preview_pr_number: 3,
        preview_pr_state: 'open',
      });
    if (path === '/v1/preview/{slug}/environment') return problem(403, 'org_role_forbidden');
    throw new Error(`unexpected GET ${path}`);
  });
}

it("lists a company project's previews from the organization's inventory", async () => {
  // GET /v1/apps is the signed-in account's own apps; a company's previews
  // carry its organization and project (faas handlers_preview_create.go:211,
  // :216), so they are in GET /v1/orgs/{slug}/apps under the project's id.
  workspace.org = 'acme';
  workspace.label = 'Acme';
  const get = stubCompany();
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Browse previews' }));
  const list = await screen.findByRole('list', { name: 'Previews of shop' });
  expect(
    within(list)
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['pr-3-api · PR #3 of api']);
  expect(get).toHaveBeenCalledWith('/v1/orgs/{slug}/apps', expect.anything());
  expect(get).not.toHaveBeenCalledWith('/v1/apps', expect.anything());
});

it('reads a selected company preview, and says who may read its workload set', async () => {
  // GET /v1/apps/{slug} is a reviewed read (appaccess/routes.go:28); the
  // preview environment is not (indirect.go:107-109, access.go:263-270).
  workspace.org = 'acme';
  workspace.label = 'Acme';
  stubCompany();
  mount('pr-3-api');
  expect(await screen.findByText(/PR #3 · app lifecycle open/)).toBeInTheDocument();
  expect(
    await screen.findByText(
      /Only the member who created api, while an owner or admin of Acme, can read this preview’s workload set/
    )
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('says so when a selected slug is not one of the project’s previews', async () => {
  workspace.org = 'acme';
  workspace.label = 'Acme';
  stubCompany();
  mount('pr-4-billing');
  expect(
    await screen.findByText('Selected preview is unavailable in this project.')
  ).toBeInTheDocument();
});

it('still discovers previews in the personal workspace', async () => {
  const get = spyApi('GET').mockResolvedValue(ok([]));
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Browse previews' }));
  expect(await screen.findByText('No project preview apps reported.')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/v1/apps', expect.anything());
});
