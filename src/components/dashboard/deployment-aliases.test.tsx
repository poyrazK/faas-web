import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import type { DeploymentAlias } from '@/lib/api/deployment-aliases';

const set = vi.fn();
const remove = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const list = vi.fn();
const access = vi.fn();

vi.mock('@/lib/api/deployment-aliases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/deployment-aliases')>()),
  useDeploymentAliases: (slug: string) => list(slug),
  useSetDeploymentAlias: () => ({ mutateAsync: set, isPending: false }),
  useDeleteDeploymentAlias: () => ({ mutateAsync: remove, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => access(id),
}));
vi.mock('@/lib/api/queries', () => ({
  useAppDeployments: () => ({
    data: { pages: [{ items: deployments }] },
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { DeploymentAliasesPanel, DeploymentAliasesHere } = await import('./deployment-aliases');

function deployment(over: Partial<Deployment>): Deployment {
  return {
    id: 'd0',
    app_id: 'a1',
    image_digest: 'sha256:abc',
    kind: 'github',
    status: 'live',
    created_at: '2026-10-30T10:00:00Z',
    ...over,
  };
}
const deployments: Deployment[] = [
  deployment({ id: 'd3', revision: 3, status: 'live' }),
  deployment({ id: 'd2', revision: 2, status: 'superseded' }),
  deployment({ id: 'd1', revision: 1, status: 'failed' }),
  deployment({ id: 'd4', revision: 4, status: 'building' }),
];
const HOST = 'tag-canary-0123456789abcdef0123456789abcdef.gregale.app';
function alias(over: Partial<DeploymentAlias> = {}): DeploymentAlias {
  return {
    name: 'canary',
    deployment_id: 'd3',
    revision: 3,
    deployment_status: 'live',
    host: HOST,
    url: `https://${HOST}`,
    created_at: '2026-10-30T10:00:00Z',
    updated_at: '2026-10-30T10:00:00Z',
    ...over,
  };
}
const listed = (items: DeploymentAlias[]) =>
  list.mockReturnValue({ data: items, isPending: false, error: null, refetch: vi.fn() });

beforeEach(() => {
  set
    .mockReset()
    .mockImplementation(async ({ name, deploymentId }) =>
      alias({ name, deployment_id: deploymentId, revision: Number(deploymentId.slice(1)) })
    );
  remove.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  list.mockReset();
  listed([alias()]);
  access.mockReset().mockReturnValue({
    access: 'on',
    capability: { key: 'deployment-aliases', maturity: 'beta' },
    refresh: vi.fn(),
  });
});

describe('DeploymentAliasesPanel', () => {
  it('lists each alias with its release, URL and whether it serves', () => {
    listed([
      alias(),
      alias({ name: 'old', deployment_id: 'd2', revision: 2, deployment_status: 'superseded' }),
    ]);
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('canary')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/serving v3/i)).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: HOST })).toHaveAttribute(
      'href',
      `https://${HOST}`
    );
    expect(within(rows[1]).getByText(/not serving: v2 is superseded/i)).toBeInTheDocument();
  });

  it('labels the surface from the capability maturity, not a constant', () => {
    const { unmount } = render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    unmount();
    access.mockReturnValue({
      access: 'on',
      capability: { key: 'deployment-aliases', maturity: 'ga' },
      refresh: vi.fn(),
    });
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('explains the off state and never reads the aliases', () => {
    access.mockReturnValue({ access: 'off', capability: undefined, refresh: vi.fn() });
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    expect(screen.getByText(/not enabled for this account/i)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('says what an alias is for when there are none, with the CLI equivalent', () => {
    listed([]);
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    expect(screen.getByText(/no aliases yet/i)).toBeInTheDocument();
    expect(
      screen.getByText('gregale release alias set --app api --name canary --release v3')
    ).toBeInTheDocument();
  });

  it('opens the release an alias points at', async () => {
    const open = vi.fn();
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={open} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open release v3' }));
    expect(open).toHaveBeenCalledWith('d3');
  });

  it('offers only releases apid accepts as a target', () => {
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    const options = within(screen.getByRole('combobox', { name: 'Release' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith('v3'))).toBe(true);
    expect(options.some((o) => o?.startsWith('v4'))).toBe(true);
    expect(options.some((o) => o?.startsWith('v2'))).toBe(false);
    expect(options.some((o) => o?.startsWith('v1'))).toBe(false);
  });

  it('creates a new alias without asking', async () => {
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'staging');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Release' }), 'd4');
    await userEvent.click(screen.getByRole('button', { name: 'Set alias' }));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ name: 'staging', deploymentId: 'd4' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'staging now points at v4' })
    );
  });

  it('asks before moving an alias, naming the URL and both releases', async () => {
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'canary');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Release' }), 'd4');
    await userEvent.click(screen.getByRole('button', { name: 'Move alias' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const asked = confirm.mock.calls[0][0];
    expect(asked.title).toBe('Move canary from v3 to v4?');
    expect(asked.description).toContain(`https://${HOST}`);
    expect(asked.description).toMatch(/production traffic does not change/i);
    expect(set).toHaveBeenCalledWith({ name: 'canary', deploymentId: 'd4' });
  });

  it('leaves the alias where it is when the move is declined', async () => {
    confirm.mockResolvedValue(false);
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'canary');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Release' }), 'd4');
    await userEvent.click(screen.getByRole('button', { name: 'Move alias' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses a name apid would refuse, before sending it', async () => {
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'Canary');
    await userEvent.click(screen.getByRole('button', { name: 'Set alias' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/lowercase/i);
    expect(set).not.toHaveBeenCalled();
  });

  it('shows apid’s reason when the target cannot take an alias', async () => {
    set.mockRejectedValue(
      new ApiError({
        status: 404,
        code: 'not_found',
        title: 'Not found',
        detail:
          'deployment v4 is failed; an alias can point only at a live or in-progress deployment',
      })
    );
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'staging');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Release' }), 'd4');
    await userEvent.click(screen.getByRole('button', { name: 'Set alias' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/v4 is failed/);
  });

  it('asks before removing, saying the URL stops and production is untouched', async () => {
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove alias canary' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('canary'));
    const asked = confirm.mock.calls[0][0];
    expect(asked.destructive).toBe(true);
    expect(asked.title).toBe('Remove alias canary?');
    expect(asked.description).toContain(`https://${HOST} stops serving v3`);
    expect(asked.description).toMatch(/production traffic/i);
  });

  it('treats an alias someone else already removed as removed', async () => {
    remove.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', title: 'Not found' }));
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove alias canary' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'canary was already removed' })
      )
    );
  });

  it('reports any other removal failure as an error', async () => {
    remove.mockRejectedValue(
      new ApiError({ status: 503, code: 'capacity_unavailable', title: 'Briefly at capacity' })
    );
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove alias canary' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
  });

  it('says so when the installation has no apps domain', () => {
    listed([alias({ host: undefined, url: undefined })]);
    render(<DeploymentAliasesPanel slug="api" onOpenDeployment={vi.fn()} />);
    expect(screen.getByText(/no public url on this installation/i)).toBeInTheDocument();
  });
});

describe('DeploymentAliasesHere', () => {
  it('renders nothing while the capability is not on', () => {
    access.mockReturnValue({ access: 'loading', capability: undefined, refresh: vi.fn() });
    const { container } = render(<DeploymentAliasesHere slug="api" deployment={deployments[0]} />);
    expect(container).toBeEmptyDOMElement();
    expect(list).not.toHaveBeenCalled();
  });

  it('lists the aliases that point at this release', () => {
    listed([alias(), alias({ name: 'other', deployment_id: 'd4', revision: 4 })]);
    render(<DeploymentAliasesHere slug="api" deployment={deployments[0]} />);
    const region = screen.getByRole('region', { name: 'Aliases' });
    expect(within(region).getByText('canary')).toBeInTheDocument();
    expect(within(region).queryByText('other')).not.toBeInTheDocument();
    expect(within(region).getByText('Beta')).toBeInTheDocument();
  });

  it('points a new alias at this release', async () => {
    listed([]);
    render(<DeploymentAliasesHere slug="api" deployment={deployments[0]} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'stable');
    await userEvent.click(screen.getByRole('button', { name: 'Point alias here' }));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ name: 'stable', deploymentId: 'd3' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before pulling an alias over from another release', async () => {
    listed([alias({ name: 'canary', deployment_id: 'd4', revision: 4 })]);
    render(<DeploymentAliasesHere slug="api" deployment={deployments[0]} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Alias name' }), 'canary');
    await userEvent.click(screen.getByRole('button', { name: 'Point alias here' }));
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].title).toBe('Move canary from v4 to v3?');
  });

  it('says why a superseded release cannot take an alias', () => {
    listed([]);
    render(<DeploymentAliasesHere slug="api" deployment={deployments[1]} />);
    expect(screen.queryByRole('textbox', { name: 'Alias name' })).not.toBeInTheDocument();
    expect(screen.getByText(/only a live or in-progress release/i)).toBeInTheDocument();
  });
});
