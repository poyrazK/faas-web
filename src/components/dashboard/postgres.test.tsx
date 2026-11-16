import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const usePostgresDatabases = vi.fn();
const usePostgresBindings = vi.fn();
const useApps = vi.fn();
const createDb = vi.fn();
const deleteDb = vi.fn();
const restoreDb = vi.fn();
const createBinding = vi.fn();
const deleteBinding = vi.fn();
const rotateBinding = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const usePostgresUsage = vi.fn();
const undeleteDb = vi.fn();
const purgeDb = vi.fn();
const computeAccess = vi.hoisted(() => ({ value: 'on' }));
const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));

vi.mock('@/lib/api/queries', () => ({
  usePostgresDatabases: () => usePostgresDatabases() as unknown,
  usePostgresBindings: (id: string) => usePostgresBindings(id) as unknown,
  useApps: () => useApps() as unknown,
  useCreatePostgresDatabase: () => ({ mutateAsync: createDb, isPending: false }),
  useDeletePostgresDatabase: () => ({ mutateAsync: deleteDb, isPending: false }),
  useRestorePostgresDatabase: () => ({ mutateAsync: restoreDb, isPending: false }),
  useCreatePostgresBinding: () => ({ mutateAsync: createBinding, isPending: false }),
  useDeletePostgresBinding: () => ({ mutateAsync: deleteBinding, isPending: false }),
  useRotatePostgresBinding: () => ({ mutateAsync: rotateBinding, isPending: false }),
}));
vi.mock('@/lib/api/postgres', () => ({
  usePostgresUsage: () => usePostgresUsage() as unknown,
  useUndeletePostgresDatabase: () => ({ mutateAsync: undeleteDb, isPending: false }),
  usePurgePostgresDatabase: () => ({ mutateAsync: purgeDb, isPending: false }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: computeAccess.value }),
}));
// The usage panel and the conditions and connection planning sections have
// their own tests; here they only need to be placed, or not.
vi.mock('./postgres-usage', () => ({ PostgresUsage: () => <p>usage panel</p> }));
vi.mock('./postgres-health', () => ({
  DatabaseConditions: () => <p>conditions section</p>,
  ConnectionBudget: () => <p>connection planning section</p>,
}));
vi.mock('./postgres-live-queries', () => ({
  LiveQueries: () => <p>live queries section</p>,
}));
vi.mock('./postgres-compute', () => ({
  DatabaseCompute: ({
    operation,
    onOperation,
  }: {
    operation?: { id: string };
    onOperation: (op: { kind: 'resize'; id: string }) => void;
  }) => (
    <div>
      <p>compute section following {operation?.id ?? 'nothing'}</p>
      <button type="button" onClick={() => onOperation({ kind: 'resize', id: 'r-1' })}>
        start a change
      </button>
    </div>
  ),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { PostgresDatabases, explainPostgres } = await import('./postgres');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const database = (over: Record<string, unknown> = {}) => ({
  id: 'db1',
  name: 'orders',
  region: 'fra',
  postgres_major: 17,
  service_class: 'production',
  availability: 'high_availability',
  scale_to_zero: false,
  storage_limit_bytes: 10 * 1024 ** 3,
  restore_window_seconds: 7 * 24 * 3600,
  state: 'ready',
  last_error_code: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});
const binding = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  database_id: 'db1',
  app_id: 'app1',
  scope: 'default',
  environment_key: 'DATABASE_URL',
  access: 'read_write',
  credential_generation: 2,
  rotation_pending: false,
  state: 'ready',
  last_error_code: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

const usage = (over: Record<string, unknown> = {}) => ({
  period_start: '2026-11-01T00:00:00Z',
  policy_enabled: true,
  fresh: true,
  guardrail_state: 'healthy',
  ready_databases: 1,
  database_limit: 3,
  compute_unit_seconds: 3600,
  compute_allowance_unit_seconds: 75 * 3600,
  compute_cap_state: 'healthy',
  ...over,
});
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000 + 60_000).toISOString();

beforeEach(() => {
  usePostgresDatabases.mockReset().mockReturnValue(ready({ items: [database()] }));
  usePostgresBindings.mockReset().mockReturnValue(ready({ items: [binding()] }));
  useApps.mockReset().mockReturnValue(ready([{ id: 'app1', slug: 'api-gateway' }]));
  createDb
    .mockReset()
    .mockResolvedValue(database({ id: 'db2', name: 'reports', state: 'provisioning' }));
  deleteDb.mockReset().mockResolvedValue(database({ state: 'deleting' }));
  restoreDb.mockReset().mockResolvedValue(database({ id: 'db3', name: 'orders-restored' }));
  createBinding.mockReset().mockResolvedValue(binding({ id: 'b2' }));
  deleteBinding.mockReset().mockResolvedValue(binding({ state: 'deleting' }));
  rotateBinding
    .mockReset()
    .mockResolvedValue(binding({ credential_generation: 3, rotation_pending: true }));
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  usePostgresUsage.mockReset().mockReturnValue(ready(usage()));
  undeleteDb.mockReset().mockResolvedValue(database());
  purgeDb.mockReset().mockResolvedValue(database({ state: 'deleted' }));
  workspace.org = null;
  workspace.label = 'Personal';
  computeAccess.value = 'on';
});

/** The tile for a database, found by its heading. */
const tile = (name = 'orders') =>
  screen.getByRole('heading', { name, level: 3 }).closest('section') as HTMLElement;
/** The detail's scheduled-deletion notice, where its own restore button lives. */
const notice = () =>
  screen.getByText(/deletion scheduled/i).closest('[role="status"]') as HTMLElement;

describe('explainPostgres', () => {
  it('separates a plan gate, a quota, a conflict and a provider outage', () => {
    const of = (code: string) =>
      explainPostgres(new ApiError({ status: 400, code, title: 't', detail: 'd' }));
    expect(of('managed_postgres_not_in_plan').title).toBe('Not on your plan');
    expect(of('managed_postgres_quota_exceeded').title).toBe('Database limit reached');
    expect(of('managed_postgres_conflict').title).toMatch(/taken/i);
    expect(of('managed_postgres_unavailable')).toEqual(
      expect.objectContaining({
        kind: 'info',
        description: expect.stringContaining('Nothing was changed'),
      })
    );
  });
});

describe('PostgresDatabases', () => {
  it('opens with what the page is and one way to add a database', () => {
    render(<PostgresDatabases />);
    expect(screen.getByRole('heading', { name: 'Databases' })).toBeInTheDocument();
    expect(screen.getByText(/managed postgresql your apps connect to/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /create database/i })).toHaveLength(1);
  });

  it('shows a healthy database as Ready, in one sentence, with no fix to make', () => {
    render(<PostgresDatabases />);
    const card = within(tile());
    expect(card.getByText('Ready')).toBeInTheDocument();
    expect(card.getByText(/apps bound to it can connect/i)).toBeInTheDocument();
    expect(card.queryByRole('button', { name: /upgrade|restore|size|details/i })).toBeNull();
  });

  it('lists the facts as plain chips, keeping the exact terms on hover', () => {
    usePostgresDatabases.mockReturnValue(ready({ items: [database({ scale_to_zero: true })] }));
    render(<PostgresDatabases />);
    const card = within(tile());
    expect(card.getByText('PostgreSQL 17')).toBeInTheDocument();
    expect(card.getByText('Production')).toHaveAttribute('title', 'Service class: production');
    expect(card.getByText('Frankfurt')).toHaveAttribute('title', 'Region: fra');
    expect(card.getByText('10 GB')).toBeInTheDocument();
    expect(card.getByText('Two zones')).toHaveAttribute('title', 'High availability');
    expect(card.getByText('Sleeps when idle')).toHaveAttribute('title', 'Scales to zero');
    expect(card.getByText(/^Created/)).toBeInTheDocument();
  });

  it('says a failed database failed, keeps its own error code on hover, and opens to fix it', async () => {
    usePostgresDatabases.mockReturnValue(
      ready({ items: [database({ state: 'failed', last_error_code: 'provider_capacity' })] })
    );
    render(<PostgresDatabases />);
    const card = within(tile());
    expect(card.getByText('Failed')).toBeInTheDocument();
    expect(card.getByText(/something went wrong setting it up/i)).toHaveAttribute(
      'title',
      'failed · provider_capacity'
    );
    await userEvent.click(card.getByRole('button', { name: 'See details' }));
    expect(await screen.findByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('names a known failure in words', () => {
    usePostgresDatabases.mockReturnValue(
      ready({ items: [database({ state: 'failed', last_error_code: 'provider_failed' })] })
    );
    render(<PostgresDatabases />);
    expect(within(tile()).getByText(/provider reported a failure/i)).toBeInTheDocument();
  });

  it('says a database being set up is starting', () => {
    usePostgresDatabases.mockReturnValue(ready({ items: [database({ state: 'provisioning' })] }));
    render(<PostgresDatabases />);
    expect(within(tile()).getByText('Starting')).toBeInTheDocument();
    expect(within(tile()).getByText(/apps can connect once it’s ready/i)).toBeInTheDocument();
  });

  it('creates a database and says it is provisioning, not ready', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /create database/i }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.type(within(sheet).getByLabelText('Database name'), 'reports');
    await userEvent.click(within(sheet).getByRole('button', { name: /create database/i }));
    await waitFor(() =>
      expect(createDb).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'reports',
          postgres_major: 17,
          availability: 'single_zone',
        })
      )
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'reports is provisioning' })
    );
  });

  it('refuses a name the API would reject', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /create database/i }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.type(within(sheet).getByLabelText('Database name'), '9bad name');
    expect(within(sheet).getByRole('button', { name: /create database/i })).toBeDisabled();
  });

  it('opens a database to its bindings, which name the secret and never a credential', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    expect(await screen.findByText('DATABASE_URL')).toBeInTheDocument();
    expect(screen.getByText(/api-gateway uses it as DATABASE_URL/)).toBeInTheDocument();
    // The credential generation is detail: one click away, not on the row.
    expect(screen.queryByText('credentials v2')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /technical details/i }));
    expect(screen.getByText('credentials v2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /connect an app/i }));
    expect(
      within(await screen.findByRole('dialog')).getByText(/never shown in the console/i)
    ).toBeInTheDocument();
  });

  it('opens a database with its sentence, one primary action, and the restore form tucked away', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    const detail = (await screen.findByRole('heading', { name: 'orders', level: 2 })).closest(
      'section'
    ) as HTMLElement;
    expect(within(detail).getByText(/apps bound to it can connect/i)).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: /connect an app/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Restored database name')).toBeNull();
    expect(screen.queryByText('conditions section')).toBeNull();
    await userEvent.click(within(detail).getByRole('button', { name: /restore a copy/i }));
    expect(
      within(await screen.findByRole('dialog')).getByLabelText('Restored database name')
    ).toBeInTheDocument();
  });

  it('binds an app under the chosen secret name', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /connect an app/i }));
    const sheet = await screen.findByRole('dialog');
    const key = within(sheet).getByLabelText('Environment key');
    await userEvent.clear(key);
    await userEvent.type(key, 'ORDERS_DB_URL');
    await userEvent.click(within(sheet).getByRole('button', { name: /bind app/i }));
    await waitFor(() =>
      expect(createBinding).toHaveBeenCalledWith({
        app_id: 'app1',
        scope: 'default',
        environment_key: 'ORDERS_DB_URL',
        access: 'read_write',
      })
    );
  });

  it('restores into a new database, saying the original is untouched', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /restore a copy/i }));
    await userEvent.type(await screen.findByLabelText('Restored database name'), 'orders-restored');
    const at = screen.getByLabelText('Restore point in time');
    await userEvent.type(at, '2026-09-07T10:30');
    await userEvent.click(screen.getByRole('button', { name: /restore into a new database/i }));
    await waitFor(() =>
      expect(restoreDb).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'db1', name: 'orders-restored' })
      )
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('untouched') })
    );
  });

  it('shows the CLI restore command, with placeholders until the form is filled', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /restore a copy/i }));

    expect(
      await screen.findByText(
        'gregale postgres restore db1 --name <new-name> --point-in-time <RFC3339-time>'
      )
    ).toBeInTheDocument();
  });

  it('names the restore copy button after the database, as a noun', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /restore a copy/i }));

    expect(
      await screen.findByRole('button', { name: 'Copy: restore command for orders' })
    ).toBeInTheDocument();
  });

  it('fills the CLI restore command from the name and time typed in the form', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /restore a copy/i }));
    await userEvent.type(await screen.findByLabelText('Restored database name'), 'orders-restored');
    await userEvent.type(screen.getByLabelText('Restore point in time'), '2026-09-07T10:30');

    // The form submits the local time as UTC ISO; the command carries the same instant.
    const iso = new Date('2026-09-07T10:30').toISOString();
    expect(
      screen.getByText(`gregale postgres restore db1 --name orders-restored --point-in-time ${iso}`)
    ).toBeInTheDocument();
  });

  it('makes deleting a database type its name first', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ typeToConfirm: 'orders' }))
    );
    expect(deleteDb).toHaveBeenCalledWith('db1');
  });

  it('places the usage panel above the databases', () => {
    render(<PostgresDatabases />);
    expect(screen.getByText('usage panel')).toBeInTheDocument();
  });

  describe('deleting, recovering and purging', () => {
    const scheduled = (over: Record<string, unknown> = {}) =>
      database({ state: 'deleting', restorable_until: inDays(6), ...over });
    const openScheduled = async (over: Record<string, unknown> = {}) => {
      usePostgresDatabases.mockReturnValue(ready({ items: [scheduled(over)] }));
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    };

    it('says a ready database is kept for seven days and can be recovered', async () => {
      deleteDb.mockResolvedValue(scheduled());
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
      await waitFor(() => expect(deleteDb).toHaveBeenCalled());
      const asked = confirm.mock.calls[0]![0] as { description: string };
      expect(asked.description).toMatch(/kept for 7 days/i);
      expect(asked.description).toMatch(/recovered/i);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'orders is scheduled for deletion' })
      );
    });

    it('says a database that never became ready is deleted at once', async () => {
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ state: 'failed', last_error_code: 'provider_capacity' })] })
      );
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      const asked = confirm.mock.calls[0]![0] as { description: string };
      expect(asked.description).toMatch(/deleted at once/i);
      expect(asked.description).not.toMatch(/recovered/i);
    });

    it('draws a scheduled delete as an outline that says how long it can come back', () => {
      usePostgresDatabases.mockReturnValue(ready({ items: [scheduled()] }));
      render(<PostgresDatabases />);
      const card = within(tile());
      expect(card.getByText('Being deleted')).toBeInTheDocument();
      expect(card.getByText('6 more days')).toBeInTheDocument();
      expect(card.getByText(/gone for good/i)).toBeInTheDocument();
      expect(tile()).not.toHaveClass('surface');
    });

    it('restores a scheduled delete from its tile, without asking', async () => {
      usePostgresDatabases.mockReturnValue(ready({ items: [scheduled()] }));
      render(<PostgresDatabases />);
      await userEvent.click(within(tile()).getByRole('button', { name: /restore database/i }));
      await waitFor(() =>
        expect(undeleteDb).toHaveBeenCalledWith({
          id: 'db1',
          idempotencyKey: expect.any(String) as string,
        })
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'orders is recovered' })
      );
    });

    it('recovers a scheduled database without asking, and offers no bindings or restore', async () => {
      await openScheduled();
      expect(screen.getByText(/deletion scheduled/i)).toBeInTheDocument();
      expect(screen.queryByLabelText('Environment key')).toBeNull();
      expect(screen.queryByLabelText('Restored database name')).toBeNull();
      await userEvent.click(within(notice()).getByRole('button', { name: /restore database/i }));
      await waitFor(() =>
        expect(undeleteDb).toHaveBeenCalledWith({
          id: 'db1',
          idempotencyKey: expect.any(String) as string,
        })
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'orders is recovered' })
      );
    });

    it('says the window has ended when the API no longer has the database', async () => {
      undeleteDb.mockRejectedValue(
        new ApiError({ status: 404, code: 'managed_postgres_not_found', title: 't', detail: 'd' })
      );
      await openScheduled();
      await userEvent.click(within(notice()).getByRole('button', { name: /restore database/i }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'The recovery window has ended' })
        )
      );
    });

    it('says the plan no longer allows it when undelete fails the plan check', async () => {
      undeleteDb.mockRejectedValue(
        new ApiError({ status: 403, code: 'managed_postgres_not_in_plan', title: 't', detail: 'd' })
      );
      await openScheduled();
      await userEvent.click(within(notice()).getByRole('button', { name: /restore database/i }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Your plan no longer allows this database' })
        )
      );
    });

    it('replays the same key after an unknown outcome, and a new one after a refusal', async () => {
      undeleteDb
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(
          new ApiError({ status: 409, code: 'managed_postgres_conflict', title: 't', detail: 'd' })
        )
        .mockResolvedValue(database());
      await openScheduled();
      const recover = within(notice()).getByRole('button', { name: /restore database/i });
      await userEvent.click(recover);
      await waitFor(() => expect(undeleteDb).toHaveBeenCalledTimes(1));
      await userEvent.click(recover);
      await waitFor(() => expect(undeleteDb).toHaveBeenCalledTimes(2));
      await userEvent.click(recover);
      await waitFor(() => expect(undeleteDb).toHaveBeenCalledTimes(3));
      const keys = undeleteDb.mock.calls.map(
        (c) => (c[0] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[1]);
    });

    it('purges only after the name is typed, and says it cannot be undone', async () => {
      await openScheduled();
      await userEvent.click(screen.getByRole('button', { name: /delete now/i }));
      await waitFor(() => expect(purgeDb).toHaveBeenCalledWith('db1'));
      const asked = confirm.mock.calls[0]![0] as {
        typeToConfirm: string;
        destructive: boolean;
        description: string;
      };
      expect(asked).toMatchObject({ typeToConfirm: 'orders', destructive: true });
      expect(asked.description).toMatch(/cannot be undone/i);
    });

    it('does not purge when the confirm is declined', async () => {
      confirm.mockResolvedValue(false);
      await openScheduled();
      await userEvent.click(screen.getByRole('button', { name: /delete now/i }));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(purgeDb).not.toHaveBeenCalled();
    });

    it('offers no recovery once the window has passed', async () => {
      await openScheduled({ restorable_until: inDays(-1) });
      expect(screen.queryByRole('button', { name: /restore database/i })).toBeNull();
      expect(within(tile()).getByText(/time to get it back has ended/i)).toBeInTheDocument();
      expect(screen.getByText(/recovery window has ended/i)).toBeInTheDocument();
    });
  });

  describe('suspended databases', () => {
    it('reads Paused, not Ready, while the compute cap holds it, and offers the upgrade', async () => {
      usePostgresUsage.mockReturnValue(
        ready(
          usage({ compute_cap_state: 'suspended', compute_suspended_at: '2026-11-02T00:00:00Z' })
        )
      );
      render(withRouter(<PostgresDatabases />));
      await screen.findByRole('heading', { name: 'orders' });
      const card = within(tile());
      expect(card.getByText('Paused')).toBeInTheDocument();
      expect(card.queryByText('Ready')).toBeNull();
      expect(card.getByText(/compute allowance is used up/i)).toHaveAttribute(
        'title',
        'suspended · compute cap'
      );
      expect(card.getByRole('link', { name: 'Upgrade plan' })).toHaveAttribute(
        'href',
        '/dashboard/plans'
      );
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      expect(
        await screen.findByText(/refuses connections until the compute cap lifts/i)
      ).toBeInTheDocument();
    });

    it('says a size the plan leaves out pauses it, and offers both fixes', async () => {
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ plan_excess: 'service_class' })] })
      );
      render(withRouter(<PostgresDatabases />));
      await screen.findByRole('heading', { name: 'orders' });
      const card = within(tile());
      expect(card.getByText('Paused')).toBeInTheDocument();
      expect(
        card.getByText(/paused because its size isn’t included in your plan\. Your data is safe/i)
      ).toBeInTheDocument();
      expect(card.getByRole('link', { name: 'Upgrade plan' })).toHaveAttribute(
        'href',
        '/dashboard/plans'
      );
      // The resize lives in the detail: the button opens it there.
      await userEvent.click(card.getByRole('button', { name: 'Choose another size' }));
      expect(await screen.findByText('compute section following nothing')).toBeInTheDocument();
      expect(screen.getByText(/does not include the production class/i)).toBeInTheDocument();
    });

    it('offers no resize where resize is not available', async () => {
      computeAccess.value = 'off';
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ plan_excess: 'service_class' })] })
      );
      render(withRouter(<PostgresDatabases />));
      await screen.findByRole('heading', { name: 'orders' });
      expect(within(tile()).queryByRole('button', { name: 'Choose another size' })).toBeNull();
      expect(within(tile()).getByRole('link', { name: 'Upgrade plan' })).toBeInTheDocument();
    });

    it('names the company’s plan in a company workspace', async () => {
      workspace.org = 'acme-corp';
      workspace.label = 'Acme';
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ plan_excess: 'service_class' })] })
      );
      render(withRouter(<PostgresDatabases />));
      await screen.findByRole('heading', { name: 'orders' });
      expect(within(tile()).getByText(/isn’t included in Acme’s plan/)).toBeInTheDocument();
    });

    it('explains a database past the plan’s database limit', async () => {
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ plan_excess: 'database_limit' })] })
      );
      render(withRouter(<PostgresDatabases />));
      await screen.findByRole('heading', { name: 'orders' });
      expect(within(tile()).getByText('Paused')).toBeInTheDocument();
      expect(within(tile()).getByText(/allows fewer databases than you have/i)).toBeInTheDocument();
    });

    it('says when a restored copy holds the slot past the database limit', async () => {
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ restore_slot_until: inDays(5) })] })
      );
      render(withRouter(<PostgresDatabases />));
      expect(await screen.findByText('5 more days')).toBeInTheDocument();
      expect(
        within(tile()).getByText(/restored copy past your plan’s database limit/i)
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      expect(await screen.findByText(/past your plan's database limit/i)).toBeInTheDocument();
    });
  });

  describe('resize and compute policy', () => {
    it('keeps following a change while the database is closed and reopened', async () => {
      render(<PostgresDatabases />);
      const row = screen.getByRole('button', { name: /orders/i });
      await userEvent.click(row);
      // Size lives behind its disclosure until a change is being followed.
      await userEvent.click(await screen.findByRole('button', { name: /size and compute/i }));
      expect(await screen.findByText('compute section following nothing')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'start a change' }));
      expect(screen.getByText('compute section following r-1')).toBeInTheDocument();
      await userEvent.click(row);
      expect(screen.queryByText(/compute section/)).toBeNull();
      await userEvent.click(row);
      expect(await screen.findByText('compute section following r-1')).toBeInTheDocument();
    });

    it('offers no change to a database whose delete is scheduled', async () => {
      usePostgresDatabases.mockReturnValue(
        ready({ items: [database({ state: 'deleting', restorable_until: inDays(6) })] })
      );
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      await screen.findByText(/deletion scheduled/i);
      expect(screen.queryByText(/compute section/)).toBeNull();
    });
  });

  describe('conditions and connection planning', () => {
    it('shows both for a personal database', async () => {
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      await userEvent.click(await screen.findByRole('button', { name: /health and connections/i }));
      expect(await screen.findByText('conditions section')).toBeInTheDocument();
      expect(screen.getByText('connection planning section')).toBeInTheDocument();
    });

    it('says the API has no organization route for them in a company workspace', async () => {
      workspace.org = 'acme';
      workspace.label = 'Acme';
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      await userEvent.click(await screen.findByRole('button', { name: /health and connections/i }));
      expect(await screen.findByText(/no organization route/i)).toBeInTheDocument();
      expect(screen.queryByText('conditions section')).toBeNull();
    });
  });

  describe('rotating a binding’s credentials', () => {
    const openBindings = async () => {
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      return screen.findByRole('button', { name: /rotate credentials for api-gateway/i });
    };

    it('asks first, in destructive terms, and says what happens to the old credentials', async () => {
      await userEvent.click(await openBindings());
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      const asked = confirm.mock.calls[0]![0] as {
        destructive: boolean;
        description: string;
        confirmLabel: string;
      };
      expect(asked.destructive).toBe(true);
      expect(asked.confirmLabel).toBe('Rotate credentials');
      expect(asked.description).toMatch(/replacement credential/i);
      expect(asked.description).toMatch(/DATABASE_URL/);
      expect(asked.description).toMatch(/previous credential keeps working until/i);
      expect(rotateBinding).toHaveBeenCalledWith({
        id: 'b1',
        idempotencyKey: expect.any(String) as string,
      });
    });

    it('does nothing when the confirm is declined', async () => {
      confirm.mockResolvedValue(false);
      await userEvent.click(await openBindings());
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(rotateBinding).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });

    it('reports a rotation still in progress as accepted, never as rotated', async () => {
      await userEvent.click(await openBindings());
      await waitFor(() => expect(toast).toHaveBeenCalled());
      const shown = toast.mock.calls[0]![0] as {
        kind: string;
        title: string;
        description?: string;
      };
      // Nothing has succeeded yet, so the toast is not styled as a success.
      expect(shown.kind).toBe('info');
      expect(shown.title).toMatch(/accepted/i);
      expect(shown.description).toMatch(/not finished|has not finished/i);
      expect(`${shown.title} ${shown.description}`).not.toMatch(/\brotated\b/i);
    });

    it('says the new credentials are live when the answer reports no rotation pending', async () => {
      rotateBinding.mockResolvedValue(
        binding({ credential_generation: 3, rotation_pending: false })
      );
      await userEvent.click(await openBindings());
      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Credentials rotated to v3' })
      );
    });

    describe('when the rotation settles', () => {
      const rotated = (over: Record<string, unknown>) => ready({ items: [binding(over)] });

      it('says the credentials rotated once polling sees rotation_pending clear', async () => {
        const view = render(<PostgresDatabases />);
        await userEvent.click(screen.getByRole('button', { name: /orders/i }));
        await userEvent.click(
          await screen.findByRole('button', { name: /rotate credentials for api-gateway/i })
        );
        await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 3, rotation_pending: true })
        );
        view.rerender(<PostgresDatabases />);
        expect(toast).toHaveBeenCalledTimes(1);

        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 3, rotation_pending: false })
        );
        view.rerender(<PostgresDatabases />);
        await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
        expect(toast).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: 'success', title: 'Credentials rotated to v3' })
        );

        // Said once: later polls of the settled binding stay quiet.
        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 3, rotation_pending: false })
        );
        view.rerender(<PostgresDatabases />);
        expect(toast).toHaveBeenCalledTimes(2);
      });

      it('does not take a stale read from before the rotation as it settling', async () => {
        const view = render(<PostgresDatabases />);
        await userEvent.click(screen.getByRole('button', { name: /orders/i }));
        await userEvent.click(
          await screen.findByRole('button', { name: /rotate credentials for api-gateway/i })
        );
        await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

        // A poll that left before the rotation landed: old generation, not pending.
        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 2, rotation_pending: false })
        );
        view.rerender(<PostgresDatabases />);
        expect(toast).toHaveBeenCalledTimes(1);
      });

      it('does not call a binding deleted mid-rotation rotated', async () => {
        const view = render(<PostgresDatabases />);
        await userEvent.click(screen.getByRole('button', { name: /orders/i }));
        await userEvent.click(
          await screen.findByRole('button', { name: /rotate credentials for api-gateway/i })
        );
        await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

        // apid also clears the pending flag when the binding is deleted.
        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 3, rotation_pending: false, state: 'deleting' })
        );
        view.rerender(<PostgresDatabases />);
        await screen.findByText('deleting');
        expect(toast).toHaveBeenCalledTimes(1);
      });

      it('says nothing for a rotation this page did not start', async () => {
        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 3, rotation_pending: true })
        );
        const view = render(<PostgresDatabases />);
        await userEvent.click(screen.getByRole('button', { name: /orders/i }));
        expect(await screen.findByText('rotation pending')).toBeInTheDocument();

        usePostgresBindings.mockReturnValue(
          rotated({ credential_generation: 3, rotation_pending: false })
        );
        view.rerender(<PostgresDatabases />);
        await waitFor(() => expect(screen.queryByText('rotation pending')).toBeNull());
        expect(toast).not.toHaveBeenCalled();
      });
    });

    it('shows a rotation as pending on the binding and does not offer a second one', async () => {
      usePostgresBindings.mockReturnValue(
        ready({ items: [binding({ credential_generation: 3, rotation_pending: true })] })
      );
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      expect(await screen.findByText('rotation pending')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /technical details/i }));
      expect(screen.getByText('credentials v3')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /rotate credentials for api-gateway/i })
      ).toBeDisabled();
    });

    it('explains a refusal with the Postgres error toast', async () => {
      rotateBinding.mockRejectedValue(
        new ApiError({
          status: 409,
          code: 'managed_postgres_conflict',
          title: 't',
          detail: 'binding is deleting',
        })
      );
      await userEvent.click(await openBindings());
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'error', title: 'That name or binding is taken' })
        )
      );
    });

    it('mints a new idempotency key after the API refused, because apid replays a stored refusal', async () => {
      rotateBinding
        .mockRejectedValueOnce(
          new ApiError({
            status: 409,
            code: 'managed_postgres_conflict',
            title: 't',
            detail: 'binding is not ready',
          })
        )
        .mockResolvedValue(binding({ credential_generation: 3, rotation_pending: true }));
      const button = await openBindings();
      await userEvent.click(button);
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
      await userEvent.click(button);
      await waitFor(() => expect(rotateBinding).toHaveBeenCalledTimes(2));
      const [first, second] = rotateBinding.mock.calls.map(
        (c) => (c[0] as { idempotencyKey: string }).idempotencyKey
      );
      expect(second).toEqual(expect.any(String));
      expect(second).not.toBe(first);
    });

    it('reuses the idempotency key when the outcome is unknown (network failure)', async () => {
      rotateBinding.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const button = await openBindings();
      await userEvent.click(button);
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
      await userEvent.click(button);
      await waitFor(() => expect(rotateBinding).toHaveBeenCalledTimes(2));
      const [first, second] = rotateBinding.mock.calls.map(
        (c) => (c[0] as { idempotencyKey: string }).idempotencyKey
      );
      expect(second).toBe(first);
    });
  });

  it('renders the Free-plan gate as the plan panel', async () => {
    usePostgresDatabases.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 403,
        code: 'managed_postgres_not_in_plan',
        title: 'Not in plan',
        detail: 'plan "free": managed PostgreSQL is not included in this plan.',
      }),
      refetch: vi.fn(),
    });
    render(withRouter(<PostgresDatabases />));
    expect(await screen.findByText(/not included in this plan/i)).toBeInTheDocument();
  });
});

describe('IDs for the CLI', () => {
  const dbId = '7b0c9a52-1d3e-4f68-8a2b-5e9d4c1f0a33';
  const bindingId = 'c41d7e90-6a2b-4b85-9f03-2d8e1a7b5c64';
  const sourceId = '0e5a1f7c-93b2-4d68-a4c1-8b7d2e6f9013';

  it('shows the database ID in full with a copy button', async () => {
    usePostgresDatabases.mockReturnValue(ready({ items: [database({ id: dbId })] }));
    usePostgresBindings.mockReturnValue(ready({ items: [] }));
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /technical details/i }));
    expect(await screen.findByText(dbId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Copy: database ID ${dbId}` })).toBeInTheDocument();
  });

  it('shows each binding ID with a copy button carrying the full ID', async () => {
    usePostgresBindings.mockReturnValue(ready({ items: [binding({ id: bindingId })] }));
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /technical details/i }));
    expect(
      await screen.findByRole('button', { name: `Copy: binding ID ${bindingId}` })
    ).toBeInTheDocument();
  });

  it('shows the restore source in full and copyable, not an 8-character slice', async () => {
    usePostgresDatabases.mockReturnValue(
      ready({
        items: [
          database({
            restore_source_database_id: sourceId,
            restore_point_in_time: '2026-09-07T10:30:00Z',
          }),
        ],
      })
    );
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /technical details/i }));
    expect(await screen.findByText(sourceId)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Copy: source database ID ${sourceId}` })
    ).toBeInTheDocument();
  });
});
