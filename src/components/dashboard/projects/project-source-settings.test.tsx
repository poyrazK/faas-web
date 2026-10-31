import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ApiError } from '@/lib/api/errors';
import { spyApi } from '@/test/api';
import { ProjectSourceSettings } from './project-source-settings';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const ACME = '11111111-1111-4111-8111-111111111111';
const PERSONAL = '22222222-2222-4222-8222-222222222222';
const orgs = [
  { id: ACME, slug: 'acme-corp', name: 'Acme Corp', personal: false },
  { id: PERSONAL, slug: 'u-abc', name: 'me', personal: true },
];
const project = {
  id: 'p1',
  slug: 'shop',
  scan_source: 'compose',
  workload_count: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  repo_full_name: 'team/shop',
  production_branch: 'main',
  workloads: [],
  exclusions: [],
};
const ok = (data: unknown) => ({ data, response: new Response() }) as never;

beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
  toast.mockReset();
  spyApi('GET').mockImplementation(async (path: string) =>
    path === '/v1/orgs' ? ok({ orgs }) : ok({})
  );
});
afterEach(() => vi.restoreAllMocks());

function mount(overrides: Partial<typeof project> & { org_id?: string } = {}) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConfirmProvider>
        <ProjectSourceSettings accountId="a" project={{ ...project, ...overrides }} />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
const branch = () => screen.getByRole('textbox', { name: 'Production branch' });
const repository = () => screen.getByRole('textbox', { name: 'Repository' });
const save = () => screen.getByRole('button', { name: 'Save source settings' });

it('sends only the field that changed', async () => {
  const patch = spyApi('PATCH').mockResolvedValue(ok({ ...project, production_branch: 'release' }));
  mount();
  expect(save()).toBeDisabled();
  await userEvent.clear(branch());
  await userEvent.type(branch(), 'release');
  await userEvent.click(save());
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch).toHaveBeenCalledWith(
    '/v1/projects/{slug}',
    expect.objectContaining({ body: { production_branch: 'release' } })
  );
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
});

it('refuses a branch or repository the API would reject, before sending', async () => {
  // validProjectBranch (faas handlers_projects.go:274), validProjectRepoFullName (scan_service.go:141).
  const patch = spyApi('PATCH');
  mount();
  await userEvent.clear(branch());
  await userEvent.type(branch(), 'feature..x');
  expect(screen.getByText(/not a valid Git branch name/)).toBeInTheDocument();
  expect(save()).toBeDisabled();
  await userEvent.clear(branch());
  await userEvent.type(branch(), 'main');
  await userEvent.clear(repository());
  await userEvent.type(repository(), 'not a repo');
  expect(screen.getByText(/owner\/name/)).toBeInTheDocument();
  expect(save()).toBeDisabled();
  expect(patch).not.toHaveBeenCalled();
});

it('asks before disconnecting the repository, then sends the empty binding', async () => {
  // An empty repo_full_name unbinds (faas handlers_projects.go:97).
  const patch = spyApi('PATCH').mockResolvedValue(ok({ ...project, repo_full_name: undefined }));
  mount();
  await userEvent.clear(repository());
  await userEvent.click(save());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Disconnect team\/shop\?/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Pushes to team\/shop stop deploying/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      '/v1/projects/{slug}',
      expect.objectContaining({ body: { repo_full_name: '' } })
    )
  );
});

it("keeps a company project's repository read-only and changes the branch under the organization", async () => {
  // A shared project refuses a repository change with 409 conflict
  // (faas handlers_projects.go:82).
  workspace.org = 'acme-corp';
  workspace.label = 'Acme Corp';
  const patch = spyApi('PATCH').mockResolvedValue(ok(project));
  mount({ org_id: ACME });
  expect(screen.queryByRole('textbox', { name: 'Repository' })).not.toBeInTheDocument();
  expect(screen.getByText('team/shop')).toBeInTheDocument();
  expect(screen.getByText(/can be disconnected but not moved/)).toBeInTheDocument();
  // The workspace already names the company; no ownership line repeats it.
  expect(screen.queryByText(/Belongs to/)).not.toBeInTheDocument();
  await userEvent.clear(branch());
  await userEvent.type(branch(), 'release');
  await userEvent.click(save());
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      '/v1/orgs/{organization}/projects/{slug}',
      expect.objectContaining({ body: { production_branch: 'release' } })
    )
  );
});

it('names the company a personal-list project belongs to, and treats its repository as fixed', async () => {
  mount({ org_id: ACME });
  expect(await screen.findByText(/Belongs to Acme Corp/)).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Repository' })).not.toBeInTheDocument();
});

it('says nothing about ownership for a project in the personal organization', async () => {
  mount({ org_id: PERSONAL });
  await screen.findByRole('textbox', { name: 'Repository' });
  expect(screen.queryByText(/Belongs to/)).not.toBeInTheDocument();
});

it('names who may change a company project when the role is refused', async () => {
  // PATCH needs OrgActionManageProjectSecurity: owner or admin (faas authz/authorize.go:58).
  workspace.org = 'acme-corp';
  workspace.label = 'Acme Corp';
  spyApi('PATCH').mockRejectedValue(
    new ApiError({ status: 403, code: 'org_role_forbidden', title: 'Forbidden' })
  );
  mount({ org_id: ACME });
  await userEvent.clear(branch());
  await userEvent.type(branch(), 'release');
  await userEvent.click(save());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Only Acme Corp's owners and admins can change this project."
  );
});

it('explains a refused repository move on a project that turns out to be shared', async () => {
  spyApi('PATCH').mockRejectedValue(
    new ApiError({
      status: 409,
      code: 'conflict',
      title: 'Repository ownership migration required',
    })
  );
  mount();
  await userEvent.clear(repository());
  await userEvent.type(repository(), 'team/other');
  await userEvent.click(save());
  expect(await screen.findByRole('alert')).toHaveTextContent(/belongs to a company/);
});

it('says which settings the repository owns', () => {
  mount();
  expect(screen.getByText(/Workloads, their names and the services they call/)).toBeInTheDocument();
});

it("offers to disconnect a company project's repository, though not to change it", async () => {
  // A shared project refuses only a non-empty repository (faas
  // handlers_projects.go:82); an empty one unbinds it.
  workspace.org = 'acme-corp';
  workspace.label = 'Acme Corp';
  const patch = spyApi('PATCH').mockResolvedValue(ok({ ...project, repo_full_name: undefined }));
  mount({ org_id: ACME });
  expect(screen.queryByRole('textbox', { name: 'Repository' })).not.toBeInTheDocument();
  expect(screen.getByText(/can be disconnected but not moved/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect repository' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Pushes to team\/shop stop deploying/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      '/v1/orgs/{organization}/projects/{slug}',
      expect.objectContaining({ body: { repo_full_name: '' } })
    )
  );
});

it('offers no disconnect for a company project without a repository', () => {
  workspace.org = 'acme-corp';
  workspace.label = 'Acme Corp';
  mount({ org_id: ACME, repo_full_name: undefined } as never);
  expect(screen.queryByRole('button', { name: 'Disconnect repository' })).not.toBeInTheDocument();
});
