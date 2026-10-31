import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ApiError } from '@/lib/api/errors';
import { spyApi } from '@/test/api';
import { ProjectDangerZone } from './project-danger-zone';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const project = {
  id: 'p1',
  slug: 'shop',
  scan_source: 'compose',
  workload_count: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  workloads: [],
  exclusions: [],
};
const preview = {
  project,
  workloads: [
    { slug: 'shop-api', workload_name: 'api', status: 'active' },
    { slug: 'shop-worker', workload_name: 'worker', status: 'active' },
  ],
  domain_count: 1,
  env_count: 6,
  cron_count: 2,
};
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const gone = () => ({ data: undefined, response: new Response(null, { status: 204 }) }) as never;

let get: ReturnType<typeof spyApi>;
beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
  toast.mockReset();
  get = spyApi('GET').mockResolvedValue(ok(preview));
});
afterEach(() => vi.restoreAllMocks());

function mount() {
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConfirmProvider>
        <ProjectDangerZone accountId="a" project={project} onDeleted={onDeleted} />
      </ConfirmProvider>
    </QueryClientProvider>
  );
  return { onDeleted };
}
const deleteButton = () => screen.getByRole('button', { name: 'Delete project' });

it('says what deleting does to the apps, from the delete preview', async () => {
  // Apps are detached and stay live (apps.project_id ON DELETE SET NULL,
  // faas migration 00074:74); domains, env and crons stay on them
  // (handlers_projects.go:160).
  mount();
  expect(
    await screen.findByText(
      /detaches its 2 apps, shop-api and shop-worker\. They keep running as standalone apps with their 1 domain, 6 environment values and 2 crons\./
    )
  ).toBeInTheDocument();
  expect(screen.getByText(/environments, with their config, secrets/)).toBeInTheDocument();
  expect(screen.getByText(/no restore/)).toBeInTheDocument();
});

it('deletes only after the slug is typed, then hands back', async () => {
  const del = spyApi('DELETE').mockResolvedValue(gone());
  const { onDeleted } = mount();
  await screen.findByText(/detaches its 2 apps/);
  await userEvent.click(deleteButton());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/shop-api and shop-worker keep running/)).toBeInTheDocument();
  const confirmButton = within(dialog).getByRole('button', { name: 'Delete project' });
  expect(confirmButton).toBeDisabled();
  await userEvent.type(within(dialog).getByRole('textbox'), 'shop');
  await userEvent.click(confirmButton);
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(del).toHaveBeenCalledWith(
    '/v1/projects/{slug}',
    expect.objectContaining({ params: { path: { slug: 'shop' } } })
  );
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
});

it('does nothing when the dialog is cancelled', async () => {
  const del = spyApi('DELETE');
  const { onDeleted } = mount();
  await screen.findByText(/detaches its 2 apps/);
  await userEvent.click(deleteButton());
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
  );
  expect(del).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
});

it('still says the apps stay live when the preview cannot be read', async () => {
  get.mockRejectedValue(new ApiError({ status: 403, code: 'forbidden', title: 'Forbidden' }));
  mount();
  expect(await screen.findByText(/Its apps are detached and keep running/)).toBeInTheDocument();
  expect(deleteButton()).toBeEnabled();
});

it("uses the organization's routes for a company's project and names who may delete it", async () => {
  // DELETE needs OrgActionDeleteProject: owner or admin (faas authz/authorize.go:61).
  workspace.org = 'acme-corp';
  workspace.label = 'Acme Corp';
  const del = spyApi('DELETE').mockRejectedValue(
    new ApiError({ status: 403, code: 'org_role_forbidden', title: 'Forbidden' })
  );
  const { onDeleted } = mount();
  await screen.findByText(/detaches its 2 apps/);
  expect(get).toHaveBeenCalledWith(
    '/v1/orgs/{organization}/projects/{slug}/delete-preview',
    expect.anything()
  );
  await userEvent.click(deleteButton());
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox'), 'shop');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Only Acme Corp's owners and admins can delete this project."
  );
  expect(del).toHaveBeenCalledWith('/v1/orgs/{organization}/projects/{slug}', expect.anything());
  expect(onDeleted).not.toHaveBeenCalled();
});

it('names what can hold a project back when the API answers capacity', async () => {
  // A static site (ON DELETE RESTRICT) or an environment clone's database
  // blocks the row delete, and the handler answers ErrCapacity
  // (faas handlers_projects.go:185, pgstore_hosting.go:59).
  spyApi('DELETE').mockRejectedValue(
    new ApiError({ status: 503, code: 'capacity', title: 'Briefly at capacity' })
  );
  mount();
  await screen.findByText(/detaches its 2 apps/);
  await userEvent.click(deleteButton());
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox'), 'shop');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/static site/);
});

it('names the owning company when a personal-list project is refused', async () => {
  const ACME = '11111111-1111-4111-8111-111111111111';
  get.mockImplementation(async (path: string) =>
    path === '/v1/orgs'
      ? ok({ orgs: [{ id: ACME, slug: 'acme-corp', name: 'Acme Corp', personal: false }] })
      : ok(preview)
  );
  spyApi('DELETE').mockRejectedValue(
    new ApiError({ status: 403, code: 'org_role_forbidden', title: 'Forbidden' })
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConfirmProvider>
        <ProjectDangerZone
          accountId="a"
          project={{ ...project, org_id: ACME }}
          onDeleted={vi.fn()}
        />
      </ConfirmProvider>
    </QueryClientProvider>
  );
  await screen.findByText(/detaches its 2 apps/);
  await userEvent.click(deleteButton());
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox'), 'shop');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Only Acme Corp's owners and admins can delete this project."
  );
});
