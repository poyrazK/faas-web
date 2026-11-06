import '@/test/mfa';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
const auth = vi.hoisted(() => ({ plan: 'pro' }));
const access = vi.hoisted(() => ({ overage: 'on' }));
const usePostgresUsage = vi.fn();
const usePostgresCapabilities = vi.fn();
const usePostgresOverage = vi.fn();
const setOverage = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: auth.plan } }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: id === 'postgres-overage' ? access.overage : 'on',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/postgres', () => ({
  usePostgresUsage: () => usePostgresUsage() as unknown,
  usePostgresCapabilities: () => usePostgresCapabilities() as unknown,
  usePostgresOverage: (offered: boolean) => usePostgresOverage(offered) as unknown,
  useSetPostgresOverage: () => ({ mutateAsync: setOverage, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { PostgresUsage } = await import('./postgres-usage');

const HOUR = 3600;
const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const usage = (over: Record<string, unknown> = {}) => ({
  period_start: '2026-11-01T00:00:00Z',
  observed_at: '2026-11-03T08:00:00Z',
  policy_enabled: true,
  fresh: true,
  guardrail_state: 'healthy',
  ready_databases: 2,
  database_limit: 3,
  storage_limit_bytes: 5 * 1024 ** 3,
  compute_unit_seconds: 30 * HOUR,
  storage_byte_seconds: 0,
  storage_byte_seconds_limit: 0,
  storage_byte_seconds_remaining: 0,
  history_byte_seconds: 0,
  egress_bytes: 1_200_000_000,
  compute_allowance_unit_seconds: 75 * HOUR,
  compute_ceiling_unit_seconds: 75 * HOUR,
  compute_cap_state: 'healthy',
  overage_enabled: false,
  ...over,
});
const capabilities = {
  contract_version: 1,
  region: 'fra',
  provisioning_enabled: true,
  database_limit: 3,
  postgres_majors: [15, 16, 17],
  service_classes: ['burstable', 'development'],
  availability: ['single_zone'],
  credential_access: ['read_write'],
  scale_to_zero: true,
  always_on: false,
  pooled_connections: true,
  point_in_time_restore: true,
  class_resize: true,
  scale_to_zero_update: true,
  storage_limit_bytes: 5 * 1024 ** 3,
  restore_window_seconds: 7 * 24 * HOUR,
};
const overage = (enabled = false) =>
  ready({
    enabled,
    compute_allowance_unit_seconds: 75 * HOUR,
    compute_ceiling_unit_seconds: (enabled ? 150 : 75) * HOUR,
  });

beforeEach(() => {
  workspace.org = null;
  workspace.label = 'Personal';
  auth.plan = 'pro';
  access.overage = 'on';
  usePostgresUsage.mockReset().mockReturnValue(ready(usage()));
  usePostgresCapabilities.mockReset().mockReturnValue(ready(capabilities));
  usePostgresOverage.mockReset().mockReturnValue(overage());
  setOverage.mockReset().mockResolvedValue(overage(true).data);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('PostgresUsage', () => {
  it('shows compute against the allowance, with the cap state as icon, colour and words', () => {
    render(<PostgresUsage />);
    expect(screen.getByText('30 CU-h')).toBeInTheDocument();
    expect(screen.getByText(/of 75 CU-h included/)).toBeInTheDocument();
    expect(screen.getByText('Within the allowance')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /compute used/i })).toHaveAttribute(
      'aria-valuenow',
      '40'
    );
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('5 GiB')).toBeInTheDocument();
  });

  it('warns at 80% of the allowance, before anything stops', () => {
    usePostgresUsage.mockReturnValue(
      ready(usage({ compute_unit_seconds: 61 * HOUR, compute_cap_state: 'warning' }))
    );
    render(<PostgresUsage />);
    expect(screen.getByText('Nearing the allowance')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('when the compute cap has suspended the databases', () => {
    const suspended = (over: Record<string, unknown> = {}) =>
      ready(
        usage({
          compute_unit_seconds: 75 * HOUR,
          compute_cap_state: 'suspended',
          compute_suspended_at: '2026-11-02T14:00:00Z',
          ...over,
        })
      );

    it('says so plainly, that nothing is lost, and when they come back', () => {
      usePostgresUsage.mockReturnValue(suspended());
      render(withRouter(<PostgresUsage />));
      return screen.findByRole('alert').then((alert) => {
        expect(alert).toHaveTextContent(/databases are suspended/i);
        expect(alert).toHaveTextContent(/keep their data/i);
        expect(alert).toHaveTextContent(/Dec 1, 2026/);
        expect(within(alert).getByRole('link', { name: /view plans/i })).toHaveAttribute(
          'href',
          '/dashboard/plans'
        );
      });
    });

    it('offers overage as a way back on a paid plan, and turns it on after asking', async () => {
      usePostgresUsage.mockReturnValue(suspended());
      render(withRouter(<PostgresUsage />));
      const alert = await screen.findByRole('alert');
      await userEvent.click(within(alert).getByRole('button', { name: /turn overage on/i }));
      await waitFor(() => expect(setOverage).toHaveBeenCalledWith(true));
      const asked = confirm.mock.calls[0]![0] as { description: string };
      expect(asked.description).toMatch(/150 CU-h/);
      expect(asked.description).toMatch(/billed as overage/i);
    });

    it('does not offer overage on Free, which stops at its allowance', async () => {
      auth.plan = 'free';
      usePostgresUsage.mockReturnValue(suspended({ compute_allowance_unit_seconds: 5 * HOUR }));
      render(withRouter(<PostgresUsage />));
      const alert = await screen.findByRole('alert');
      expect(within(alert).queryByRole('button', { name: /overage/i })).toBeNull();
      expect(usePostgresOverage).toHaveBeenLastCalledWith(false);
    });

    it('names the organization in a company workspace and offers no overage, which it lacks', async () => {
      workspace.org = 'acme';
      workspace.label = 'Acme';
      usePostgresUsage.mockReturnValue(suspended());
      render(withRouter(<PostgresUsage />));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/Acme/);
      expect(within(alert).queryByRole('button', { name: /overage/i })).toBeNull();
      expect(usePostgresOverage).toHaveBeenLastCalledWith(false);
    });
  });

  describe('compute overage', () => {
    it('shows the setting with its allowance and ceiling', () => {
      render(<PostgresUsage />);
      const section = screen.getByRole('region', { name: 'Compute overage' });
      expect(section).toHaveTextContent(/off/i);
      expect(section).toHaveTextContent(/75 CU-h/);
    });

    it('turns it off with a warning when the month is already past the allowance', async () => {
      usePostgresOverage.mockReturnValue(overage(true));
      usePostgresUsage.mockReturnValue(
        ready(
          usage({
            compute_unit_seconds: 90 * HOUR,
            compute_cap_state: 'overage',
            overage_enabled: true,
            compute_ceiling_unit_seconds: 150 * HOUR,
          })
        )
      );
      setOverage.mockResolvedValue(overage(false).data);
      render(<PostgresUsage />);
      expect(screen.getByText('In overage')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /turn overage off/i }));
      await waitFor(() => expect(setOverage).toHaveBeenCalledWith(false));
      const asked = confirm.mock.calls[0]![0] as { description: string; destructive: boolean };
      expect(asked.destructive).toBe(true);
      expect(asked.description).toMatch(/suspended at the next cap check/i);
    });

    it('does nothing when the confirm is declined', async () => {
      confirm.mockResolvedValue(false);
      render(<PostgresUsage />);
      await userEvent.click(screen.getByRole('button', { name: /turn overage on/i }));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(setOverage).not.toHaveBeenCalled();
    });

    it('is neither shown nor read while its capability is off for the account', () => {
      access.overage = 'off';
      render(<PostgresUsage />);
      expect(screen.queryByRole('region', { name: 'Compute overage' })).toBeNull();
      expect(usePostgresOverage).toHaveBeenLastCalledWith(false);
    });

    it('explains a refusal from the API', async () => {
      setOverage.mockRejectedValue(
        new ApiError({ status: 403, code: 'managed_postgres_not_in_plan', title: 't', detail: 'd' })
      );
      render(<PostgresUsage />);
      await userEvent.click(screen.getByRole('button', { name: /turn overage on/i }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not on your plan' }))
      );
    });
  });

  it('says when the figures are stale rather than presenting them as current', () => {
    usePostgresUsage.mockReturnValue(ready(usage({ fresh: false, guardrail_state: 'stale' })));
    render(<PostgresUsage />);
    expect(screen.getByText(/usage is stale/i)).toBeInTheDocument();
  });

  it('says compute is not metered when the installation has the usage ledger off', () => {
    usePostgresUsage.mockReturnValue(
      ready(
        usage({
          policy_enabled: false,
          guardrail_state: 'disabled',
          compute_allowance_unit_seconds: undefined,
          compute_ceiling_unit_seconds: undefined,
          compute_cap_state: undefined,
        })
      )
    );
    render(<PostgresUsage />);
    expect(screen.getByText(/not metered on this installation/i)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('notes when new databases are paused in the region', () => {
    usePostgresCapabilities.mockReturnValue(
      ready({ ...capabilities, provisioning_enabled: false })
    );
    render(<PostgresUsage />);
    expect(screen.getByText(/new databases are paused/i)).toBeInTheDocument();
  });

  it('names the organization when a member’s role cannot read its usage', () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    usePostgresUsage.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 403, code: 'org_role_forbidden', title: 't', detail: 'd' }),
      refetch: vi.fn(),
    });
    render(<PostgresUsage />);
    expect(screen.getByText(/your role in Acme/i)).toBeInTheDocument();
  });

  it('keeps loading, error and unreachable apart', () => {
    usePostgresUsage.mockReturnValue({ data: undefined, isPending: true, error: null });
    const { unmount } = render(<PostgresUsage />);
    expect(screen.getByText(/loading usage/i)).toBeInTheDocument();
    unmount();
    usePostgresUsage.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 502, code: 'http_502', title: 't' }),
      refetch: vi.fn(),
    });
    render(<PostgresUsage />);
    expect(screen.getByText(/could not reach the api/i)).toBeInTheDocument();
  });
});
