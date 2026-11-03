import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const setCap = vi.fn();
const toast = vi.fn();
const usage = vi.hoisted(() => ({
  rows: [] as { app_id: string; mb_seconds: number; requests: number; cold_boots: number }[],
  projection: {} as Record<string, unknown>,
  breakdown: { isPending: false, error: null as unknown, refetch: (() => {}) as () => void },
  reads: 0,
  compute: {
    month: '2026-08',
    used_gb_hours: 1,
    included_gb_hours: 50,
    overage_gb_hours: 0,
    overage_cents: 0,
  },
}));
const COMPUTE = usage.compute;

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  // Compute stands on the usage summary; the account projection
  // (GET /v1/account/usage) only adds the daily and service breakdown.
  useUsageSummary: () => ({
    data: usage.compute,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAccountUsage: () => {
    usage.reads++;
    return { data: usage.projection, ...usage.breakdown };
  },
  useApps: () => ({ data: [] }),
  usePerAppUsage: () => ({ data: usage.rows, isPending: false, error: null }),
  useSetOverageCap: () => ({ mutateAsync: setCap, isPending: false }),
  useOverageCap: () => ({ data: { overage_cap_cents: null }, isPending: false, error: null }),
  useBillingForecast: () => ({ data: undefined, isPending: true, error: null }),
  useSpendCapHistory: () => ({ data: { events: [] }, isPending: false, error: null }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'hobby', app_count: 1 } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/dashboard/app-capacity', () => ({
  AppCapacity: () => <section aria-label="App capacity" />,
}));
vi.mock('@/components/dashboard/object-storage-usage', () => ({
  ObjectStorageUsagePanel: () => <section aria-label="Object storage" />,
}));
vi.mock('@/components/dashboard/spend-cap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/dashboard/spend-cap')>()),
  SpendCap: () => <p>workspace spend cap</p>,
}));

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/components/dashboard/org-billing', () => ({
  OrgUsage: ({ label }: { label: string }) => <p>org usage for {label}</p>,
}));
// The breakdown's own reads and states are covered in billing-costs.test.tsx.
vi.mock('@/components/dashboard/billing-costs', () => ({
  CostBreakdown: () => <section aria-label="Cost breakdown" />,
  CostBreakdownPersonalOnly: ({ label }: { label: string }) => (
    <p>cost breakdown is personal only, not {label}</p>
  ),
}));

const { Route } = await import('./dashboard.usage');
const UsagePage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  usage.rows = [];
  usage.reads = 0;
  usage.projection = { month: '2026-08', compute: { ...COMPUTE } };
  usage.breakdown = { isPending: false, error: null, refetch: vi.fn() };
  setCap
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ overage_cap_cents: 1250 });
  toast.mockReset();
});

describe('cost breakdown', () => {
  it('shows the personal cost breakdown in the personal workspace', () => {
    render(<UsagePage />);
    expect(screen.getByRole('region', { name: 'Cost breakdown' })).toBeInTheDocument();
    expect(screen.queryByText(/personal only/)).toBeNull();
  });
});

describe('app capacity', () => {
  it('leaves app slots to the Plans page', () => {
    render(<UsagePage />);
    expect(screen.queryByRole('region', { name: 'App capacity' })).not.toBeInTheDocument();
  });
});

describe('usage in a company workspace', () => {
  it('reads no billing at all until the workspace is known', () => {
    // Before the store is bound, a chosen company reads as null; showing the
    // personal allowance then would show the wrong subject's numbers.
    workspace.ready = false;
    try {
      render(<UsagePage />);
      expect(screen.queryByText(/This billing period/)).toBeNull();
      expect(screen.queryByText(/org usage for/)).toBeNull();
      expect(screen.getByText('Usage')).toBeInTheDocument();
    } finally {
      workspace.ready = true;
    }
  });

  it("shows the organization's usage, not the signed-in account's", () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    try {
      render(<UsagePage />);
      expect(screen.getByText('org usage for Acme')).toBeInTheDocument();
      // The personal allowance bar and cap belong to the signed-in account.
      expect(screen.queryByText(/GB-hours by month end/)).toBeNull();
      expect(screen.queryByRole('spinbutton', { name: 'Cap (EUR)' })).toBeNull();
      // The workspace's own cap stands in for the personal spend control, and
      // the account projection is never read.
      expect(screen.getByText('workspace spend cap')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Spend control' })).toBeNull();
      expect(usage.reads).toBe(0);
      // apid has no organization cost route: say so, never the personal report.
      expect(screen.getByText('cost breakdown is personal only, not Acme')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Cost breakdown' })).toBeNull();
    } finally {
      workspace.org = null;
      workspace.label = 'Personal';
    }
  });
});

describe('compact per-app usage', () => {
  it('shows the five largest consumers and expands without changing their share of total usage', async () => {
    usage.rows = Array.from({ length: 7 }, (_, i) => ({
      app_id: `app-${i + 1}`,
      mb_seconds: (i + 1) * 1024 * 3600,
      requests: 1,
      cold_boots: 0,
    }));
    render(<UsagePage />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).queryByText('app-1')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('app-7');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('25%');
    const toggle = screen.getByRole('button', { name: 'Show all 7 apps' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(within(table).getByText('app-1')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('25%');
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(toggle).toHaveFocus();
  });
  it.each([0, 3, 5])('does not offer expansion for %s apps', (count) => {
    usage.rows = Array.from({ length: count }, (_, i) => ({
      app_id: `app-${i}`,
      mb_seconds: 0,
      requests: 0,
      cold_boots: 0,
    }));
    render(<UsagePage />);
    expect(screen.queryByRole('button', { name: /Show all|Show fewer/ })).not.toBeInTheDocument();
    if (count)
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(count + 1);
  });
});

describe('spend-cap validation', () => {
  it('converts decimal euro amounts to exact whole cents', async () => {
    setCap.mockReset().mockResolvedValue({ overage_cap_cents: 110 });
    render(<UsagePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Set a cap' }));
    const cap = screen.getByRole('spinbutton', { name: 'Cap (USD)' });

    await userEvent.type(cap, '0.29{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenLastCalledWith(29));

    await userEvent.clear(cap);
    await userEvent.type(cap, '1.10{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenLastCalledWith(110));
  });

  it('treats zero as a zero-overage ceiling and clears only with null', async () => {
    setCap.mockReset().mockResolvedValue({ overage_cap_cents: 0 });
    render(<UsagePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Set a cap' }));
    const cap = screen.getByRole('spinbutton', { name: 'Cap (USD)' });

    await userEvent.type(cap, '0{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenCalledWith(0));
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Spend cap set to $0.00' })
    );

    setCap.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Clear cap' }));
    await waitFor(() => expect(setCap).toHaveBeenCalledWith(null));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Spend cap cleared' }));
  });

  it('rejects malformed amounts, then preserves the value through API failure and retry', async () => {
    render(<UsagePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Set a cap' }));
    const cap = screen.getByRole('spinbutton', { name: 'Cap (USD)' });

    await userEvent.type(cap, '-1');
    await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
    expect(cap).toHaveAccessibleDescription(
      'Enter zero or a positive amount with no more than two decimal places.'
    );
    expect(setCap).not.toHaveBeenCalled();

    await userEvent.clear(cap);
    await userEvent.type(cap, '12.50{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(cap).toHaveValue(12.5);

    await userEvent.type(cap, '{Enter}');
    await waitFor(() => expect(setCap).toHaveBeenCalledTimes(2));
    expect(setCap).toHaveBeenLastCalledWith(1250);
  });
});

describe('the account usage projection', () => {
  it('draws one bar per day from the daily rollups and names the biggest day', () => {
    usage.projection = {
      month: '2026-08',
      compute: {
        ...COMPUTE,
        daily: [
          { date: '2026-08-01', gb_hours: 0.25 },
          { date: '2026-08-03', gb_hours: 0.5, top_app_slug: 'api', top_app_gb_hours: 0.4 },
        ],
      },
    };
    render(<UsagePage />);
    // Aug 1 to Aug 3: the day without a rollup keeps its place at zero.
    const chart = screen.getByRole('figure', { name: 'Daily compute usage in GB-hours' });
    expect(within(chart).getAllByRole('img')).toHaveLength(3);
    expect(within(chart).getByRole('img', { name: 'Aug 2: 0 GB-h' })).toBeInTheDocument();
    expect(screen.getByText(/Biggest day: Aug 3, 0.5 GB-h, mostly api \(0.4 GB-h\)/)).toBeVisible();
    expect(screen.getByText(/1 day has no rollup and is drawn at zero/)).toBeVisible();
    expect(screen.getByText(/Daily rollups: 0.75 GB-h · live total: 1 GB-h/)).toBeVisible();
  });

  it('says so instead of drawing an empty chart when there are no rollups', () => {
    render(<UsagePage />);
    expect(screen.queryByRole('figure', { name: 'Daily compute usage in GB-hours' })).toBeNull();
    expect(screen.getByText('No daily rollups for this month yet.')).toBeInTheDocument();
  });

  it('shows object storage and managed PostgreSQL only when the account has them', () => {
    render(<UsagePage />);
    expect(screen.queryByRole('region', { name: 'Object storage' })).toBeNull();
    expect(screen.queryByText('Managed PostgreSQL')).toBeNull();
  });

  it('shows managed PostgreSQL as figures with its cap state in words', () => {
    usage.projection = {
      month: '2026-08',
      compute: { ...COMPUTE },
      object_storage: { usage: {}, policy: {}, billing_mode: 'off' },
      managed_postgres: {
        period_start: '2026-08-01T00:00:00Z',
        policy_enabled: true,
        fresh: true,
        guardrail_state: 'healthy',
        ready_databases: 2,
        database_limit: 3,
        storage_limit_bytes: 10 * 2 ** 30,
        compute_unit_seconds: 36_000,
        compute_allowance_unit_seconds: 360_000,
        compute_cap_state: 'healthy',
        storage_byte_seconds: 2 ** 30 * 31 * 24 * 3600,
        storage_byte_seconds_limit: 10 * 2 ** 30 * 31 * 24 * 3600,
        storage_byte_seconds_remaining: 0,
        history_byte_seconds: 0,
        egress_bytes: 0,
      },
    };
    render(<UsagePage />);
    expect(screen.getByRole('region', { name: 'Object storage' })).toBeInTheDocument();
    expect(screen.getByText('Managed PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('10 CU-hours')).toBeInTheDocument();
    expect(screen.getByText('of 100 CU-hours included')).toBeInTheDocument();
    expect(screen.getByText('1 GiB-months')).toBeInTheDocument();
    expect(screen.getByText('Within the compute allowance')).toBeInTheDocument();
  });
});

describe('when the account usage projection fails', () => {
  // apid fails the whole projection when a configured service's accounting
  // fails (handlers_ext.go accountUsage); compute must survive it.
  const fail = (code: string, status: number) => {
    usage.projection = undefined as never;
    usage.breakdown = {
      isPending: false,
      error: new ApiError({ code, status, title: code, detail: `${code} detail` } as never),
      refetch: vi.fn(),
    };
  };

  it('keeps compute, the allowance and overage, and offers a retry for the breakdown', async () => {
    fail('capacity_unavailable', 503);
    render(<UsagePage />);
    // Compute comes from the usage summary, unaffected.
    expect(screen.getByText('GB-hours used')).toBeInTheDocument();
    expect(screen.getByText('Overage cost')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Included allowance used' })).toBeInTheDocument();
    expect(screen.getByText(/1 of 50 GB-hours/)).toBeInTheDocument();
    // The breakdown is replaced by a scoped notice, not a page error.
    expect(
      screen.getByText(
        "A service's usage accounting could not be read, so the daily breakdown and service usage are unavailable. Compute usage above is unaffected."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('capacity_unavailable detail');
    expect(screen.queryByRole('figure', { name: 'Daily compute usage in GB-hours' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Object storage' })).toBeNull();
    expect(screen.queryByText('Managed PostgreSQL')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(usage.breakdown.refetch).toHaveBeenCalled();
  });

  it('names managed PostgreSQL when its accounting is the cause', () => {
    fail('managed_postgres_usage_stale', 503);
    render(<UsagePage />);
    expect(
      screen.getByText(/Managed PostgreSQL usage is stale, so the daily breakdown/)
    ).toBeInTheDocument();
    expect(screen.getByText('GB-hours used')).toBeInTheDocument();
  });

  it('says it is reading the breakdown while compute is already shown', () => {
    usage.projection = undefined as never;
    usage.breakdown = { isPending: true, error: null, refetch: vi.fn() };
    render(<UsagePage />);
    expect(screen.getByText('GB-hours used')).toBeInTheDocument();
    expect(screen.getByText('Reading the daily and service breakdown…')).toBeInTheDocument();
  });
});
