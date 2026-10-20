import { render, screen, waitFor } from '@testing-library/react';
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
});

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
  it('lists a database with the facts that decide whether it can serve', () => {
    render(<PostgresDatabases />);
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('HA')).toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL 17 · production · fra/)).toBeInTheDocument();
  });

  it('shows a failed database’s own error code rather than just "failed"', () => {
    usePostgresDatabases.mockReturnValue(
      ready({ items: [database({ state: 'failed', last_error_code: 'provider_capacity' })] })
    );
    render(<PostgresDatabases />);
    expect(screen.getByText('provider_capacity')).toBeInTheDocument();
  });

  it('creates a database and says it is provisioning, not ready', async () => {
    render(<PostgresDatabases />);
    await userEvent.type(screen.getByLabelText('Database name'), 'reports');
    await userEvent.click(screen.getByRole('button', { name: /create database/i }));
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
    await userEvent.type(screen.getByLabelText('Database name'), '9bad name');
    expect(screen.getByRole('button', { name: /create database/i })).toBeDisabled();
  });

  it('opens a database to its bindings, which name the secret and never a credential', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    expect(await screen.findByText('DATABASE_URL')).toBeInTheDocument();
    expect(screen.getByText('credentials v2')).toBeInTheDocument();
    expect(screen.getByText(/never shown in the console/i)).toBeInTheDocument();
  });

  it('binds an app under the chosen secret name', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    const key = await screen.findByLabelText('Environment key');
    await userEvent.clear(key);
    await userEvent.type(key, 'ORDERS_DB_URL');
    await userEvent.click(screen.getByRole('button', { name: /bind app/i }));
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

  it('makes deleting a database type its name first', async () => {
    render(<PostgresDatabases />);
    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ typeToConfirm: 'orders' }))
    );
    expect(deleteDb).toHaveBeenCalledWith('db1');
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
      const shown = toast.mock.calls[0]![0] as { title: string; description?: string };
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

    it('shows a rotation as pending on the binding and does not offer a second one', async () => {
      usePostgresBindings.mockReturnValue(
        ready({ items: [binding({ credential_generation: 3, rotation_pending: true })] })
      );
      render(<PostgresDatabases />);
      await userEvent.click(screen.getByRole('button', { name: /orders/i }));
      expect(await screen.findByText('rotation pending')).toBeInTheDocument();
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
