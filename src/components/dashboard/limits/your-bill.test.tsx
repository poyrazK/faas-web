import { useState } from 'react';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { withRouter } from '@/test/router';
import { useBillFacts, type BillData } from './use-bill-facts';
import { YourBill } from './your-bill';
import { StatusStrip } from './status-strip';

const h = vi.hoisted(() => ({
  overageCap: vi.fn(),
  orgOverageCap: vi.fn(),
  usageSummary: vi.fn(),
  accountUsage: vi.fn(),
  orgs: vi.fn(),
  egress: vi.fn(),
  orgEgress: vi.fn(),
  orgStorage: vi.fn(),
  setEgress: vi.fn(),
  workspace: vi.fn(),
  access: vi.fn(),
  openMfa: vi.fn(),
  plan: 'pro',
}));
vi.mock('@/lib/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/queries')>()),
  useOverageCap: h.overageCap,
  useUsageSummary: h.usageSummary,
  useAccountUsage: h.accountUsage,
  useOrgs: h.orgs,
}));
vi.mock('@/lib/api/org-billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/org-billing')>()),
  useOrgOverageCap: h.orgOverageCap,
}));
vi.mock('@/lib/api/limits', () => ({
  useEgressOverage: h.egress,
  useOrgEgressOverage: h.orgEgress,
  useOrgObjectStorageUsage: h.orgStorage,
  useSetEgressOverage: () => ({ mutateAsync: h.setEgress, isPending: false }),
}));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: h.workspace,
}));
vi.mock('@/lib/api/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/capabilities')>()),
  useCapabilityAccess: (id: string) => ({ access: h.access(id) }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct', plan: h.plan } }) }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: h.openMfa }) }));
vi.mock('../spend-cap', () => ({ SpendCapEditor: () => <p>Cap editor</p> }));
vi.mock('../spend-control', () => ({
  ForecastLine: () => <p>Forecast</p>,
  CapHistory: () => <p>History</p>,
}));

const GiB = 2 ** 30;
const ok = (data: unknown) => ({
  data,
  error: null,
  isPending: false,
  isSuccess: true,
  refetch: vi.fn(),
});
const failed = () => ({
  data: undefined,
  error: new Error('egress read failed'),
  isPending: false,
  isSuccess: false,
  refetch: vi.fn(),
});
const election = (over: object = {}) => ({
  enabled: false,
  electable: true,
  included_gib: 500,
  billing: 'live',
  price_millicents_per_gib: 3000,
  currency: 'USD',
  ...over,
});
const storage = { usage: { observed_bytes: 19 * GiB }, policy: { max_account_bytes: 250 * GiB } };

beforeEach(() => {
  vi.clearAllMocks();
  h.plan = 'pro';
  h.workspace.mockReturnValue({ org: null, label: 'Personal', ready: true });
  h.access.mockReturnValue('on');
  h.overageCap.mockReturnValue(ok({ overage_cap_cents: 5000 }));
  h.orgOverageCap.mockReturnValue(ok({ overage_cap_cents: 8000 }));
  h.usageSummary.mockReturnValue(
    ok({ overage_cents: 1240, used_egress_gb: 205, included_egress_gb: 500 })
  );
  h.accountUsage.mockReturnValue(ok({ object_storage: storage }));
  h.orgs.mockReturnValue(ok({ orgs: [{ slug: 'acme', plan: 'scale', personal: false }] }));
  h.egress.mockReturnValue(ok(election()));
  h.orgEgress.mockReturnValue(ok(election({ included_gib: 2000 })));
  h.orgStorage.mockReturnValue(ok(storage));
});

function Bill({ onEditCap = vi.fn() }: { onEditCap?: () => void }) {
  const data = useBillFacts();
  return <YourBill data={data} onEditCap={onEditCap} />;
}
async function show(ui: React.ReactNode) {
  render(withRouter(ui));
  await waitFor(() => expect(document.body.textContent).not.toBe(''));
}
const row = (name: string) => screen.getByRole('group', { name });

describe('useBillFacts', () => {
  it('reads the personal subject and builds the facts', () => {
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.settled).toBe(true);
    expect(result.current.facts).toMatchObject({
      workspace: 'personal',
      plan: 'pro',
      cap: { state: 'ready', capCents: 5000, overageCents: 1240 },
      egress: { state: 'ready', enabled: false, electable: true, usedGb: 205, includedGb: 500 },
      storage: { state: 'ready', usedBytes: 19 * GiB, ceilingBytes: 250 * GiB },
    });
  });

  it('never reads personal figures in a company workspace', () => {
    h.workspace.mockReturnValue({ org: 'acme', label: 'Acme', ready: true });
    const { result } = renderHook(() => useBillFacts());
    for (const hook of [h.overageCap, h.usageSummary, h.egress, h.accountUsage])
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(h.orgOverageCap).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ enabled: true })
    );
    expect(result.current.facts).toMatchObject({
      workspace: 'org',
      plan: 'scale',
      cap: { state: 'ready', capCents: 8000 },
      egress: { state: 'ready', includedGb: 2000 },
    });
    expect(result.current.facts.cap).not.toHaveProperty('overageCents');
    expect(result.current.facts.egress).not.toHaveProperty('usedGb');
  });

  it('hides storage when object storage is off', () => {
    h.access.mockImplementation((id: string) => (id === 'object-storage' ? 'off' : 'on'));
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.facts.storage).toEqual({ state: 'hidden' });
    expect(h.accountUsage).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});

describe('useBillFacts review fixes', () => {
  const pending = () => ({
    data: undefined,
    error: null,
    isPending: true,
    isSuccess: false,
    refetch: vi.fn(),
  });

  it('waits for the usage summary before settling', () => {
    h.usageSummary.mockReturnValue(pending());
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.settled).toBe(false);
  });

  it('marks usage unknown when the summary fails', () => {
    h.usageSummary.mockReturnValue(failed());
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.settled).toBe(true);
    expect(result.current.facts.usageUnknown).toBe(true);
  });

  it('knows a saved election does not lift the allowance while egress billing is off', () => {
    h.egress.mockReturnValue(ok(election({ enabled: true, billing: 'off' })));
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.facts.egress).toMatchObject({ enabled: true, billingOff: true });
  });

  it('waits for the capability registry, and counts storage unknown when it fails', () => {
    h.access.mockImplementation((id: string) => (id === 'object-storage' ? 'loading' : 'on'));
    expect(renderHook(() => useBillFacts()).result.current.settled).toBe(false);
    h.access.mockImplementation((id: string) =>
      id === 'object-storage' ? 'registry-error' : 'on'
    );
    expect(renderHook(() => useBillFacts()).result.current.facts.storage).toEqual({
      state: 'unknown',
    });
  });

  it('carries Free compute into the facts', () => {
    h.plan = 'free';
    h.usageSummary.mockReturnValue(
      ok({
        overage_cents: 0,
        used_gb_hours: 100,
        included_gb_hours: 100,
        used_egress_gb: 1,
        included_egress_gb: 10,
      })
    );
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.facts.compute).toEqual({ usedGbHours: 100, includedGbHours: 100 });
  });
});

describe('before the workspace is known', () => {
  it('loads every section instead of drawing empty rows', () => {
    h.workspace.mockReturnValue({ org: null, label: 'Personal', ready: false });
    const { result } = renderHook(() => useBillFacts());
    expect(result.current.settled).toBe(false);
    expect(result.current.sections.cap.phase).toBe('loading');
    expect(result.current.sections.egress.phase).toBe('loading');
  });

  it('shimmers the strip while it waits', async () => {
    h.workspace.mockReturnValue({ org: null, label: 'Personal', ready: false });
    function Strip() {
      return <StatusStrip data={useBillFacts()} onAction={vi.fn()} />;
    }
    await show(<Strip />);
    const strip = screen.getByRole('status', { name: 'Spending limits status' });
    expect(strip).toHaveTextContent('Checking the limits…');
    expect(strip.querySelector('.shimmer')).not.toBeNull();
  });
});

describe('Your bill', () => {
  it('shows the spend cap, egress and storage rows with meters', async () => {
    await show(<Bill />);
    expect(within(row('Spend cap')).getByRole('meter')).toHaveAttribute('aria-valuenow', '25');
    expect(row('Spend cap')).toHaveTextContent(
      'Apps, jobs and databases stop at $50.00 of overage.'
    );
    expect(within(row('Egress')).getByRole('meter')).toHaveAttribute('aria-valuenow', '41');
    expect(row('Egress')).toHaveTextContent('Apps stop at 500 GiB. Or pay for egress beyond it.');
    expect(within(row('Object storage')).getByRole('meter')).toHaveAttribute('aria-valuenow', '8');
    expect(screen.getByText(/Managed Postgres overage counts toward this cap/)).toBeInTheDocument();
  });

  it('opens the cap editor from the spend cap row', async () => {
    const onEditCap = vi.fn();
    await show(<Bill onEditCap={onEditCap} />);
    await userEvent.click(within(row('Spend cap')).getByRole('button', { name: 'Change' }));
    expect(onEditCap).toHaveBeenCalledOnce();
  });

  it('turns on paying beyond the egress allowance, with a step-up and the same key', async () => {
    h.setEgress
      .mockRejectedValueOnce(
        new ApiError({ status: 403, code: 'step_up_required', title: 'Step up' })
      )
      .mockResolvedValueOnce(election({ enabled: true }));
    h.openMfa.mockImplementation((_mode, opts: { onVerified: () => void }) => opts.onVerified());
    await show(<Bill />);
    await userEvent.click(within(row('Egress')).getByRole('button', { name: 'Pay beyond' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Egress above 500 GiB is billed at $0.03 per GiB and counts toward your spend cap.'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(h.openMfa).toHaveBeenCalledOnce();
    expect(h.setEgress).toHaveBeenCalledTimes(2);
    const [first, second] = h.setEgress.mock.calls.map(([arg]) => arg);
    expect(first).toMatchObject({ enabled: true });
    expect(second).toEqual(first);
  });

  it('offers plans instead of the egress choice on Free', async () => {
    h.plan = 'free';
    h.overageCap.mockReturnValue(ok({ overage_cap_cents: null }));
    h.egress.mockReturnValue(ok(election({ electable: false, included_gib: 10 })));
    h.usageSummary.mockReturnValue(
      ok({ overage_cents: 0, used_egress_gb: 2, included_egress_gb: 10 })
    );
    await show(<Bill />);
    expect(within(row('Egress')).queryByRole('button', { name: 'Pay beyond' })).toBeNull();
    expect(within(row('Egress')).getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
    expect(row('Spend cap')).toHaveTextContent(
      'Free stops at its allowance, so there’s no overage to cap.'
    );
  });

  it('shows a company’s cap with no meter and no personal figure', async () => {
    h.workspace.mockReturnValue({ org: 'acme', label: 'Acme', ready: true });
    await show(<Bill />);
    expect(within(row('Spend cap')).queryByRole('meter')).toBeNull();
    expect(row('Spend cap')).toHaveTextContent('$80.00');
    expect(screen.queryByText(/\$12\.40/)).toBeNull();
  });

  it('hides the storage row and the Postgres note when those are off', async () => {
    h.access.mockReturnValue('off');
    await show(<Bill />);
    expect(screen.queryByRole('group', { name: 'Object storage' })).toBeNull();
    expect(screen.queryByText(/Managed Postgres overage/)).toBeNull();
  });

  it('saves the choice for later while egress billing is off', async () => {
    h.egress.mockReturnValue(ok(election({ billing: 'off' })));
    h.setEgress.mockResolvedValueOnce(election({ enabled: true, billing: 'off' }));
    await show(<Bill />);
    expect(within(row('Egress')).queryByRole('button', { name: 'Pay beyond' })).toBeNull();
    await userEvent.click(within(row('Egress')).getByRole('button', { name: 'Choose for later' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Egress billing hasn’t started yet, so this saves the choice. Until it starts, apps still stop at 500 GiB. After that, egress above it is billed at $0.03 per GiB and counts toward your spend cap.'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save choice' }));
    expect(h.setEgress).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('says a saved election waits for egress billing', async () => {
    h.egress.mockReturnValue(ok(election({ enabled: true, billing: 'off' })));
    await show(<Bill />);
    expect(row('Egress')).toHaveTextContent(
      'Saved. Until egress billing starts, apps still stop at 500 GiB.'
    );
  });

  it('shows a company’s $0 cap as stopped', async () => {
    h.workspace.mockReturnValue({ org: 'acme', label: 'Acme', ready: true });
    h.orgOverageCap.mockReturnValue(ok({ overage_cap_cents: 0 }));
    await show(<Bill />);
    expect(row('Spend cap')).toHaveTextContent('A $0 cap pauses every workload');
  });

  it('says when this month’s usage could not be read, with a retry', async () => {
    h.usageSummary.mockReturnValue(failed());
    await show(<Bill />);
    expect(within(row('Spend cap')).queryByRole('meter')).toBeNull();
    expect(row('Spend cap')).toHaveTextContent('This month’s overage couldn’t be read.');
    expect(within(row('Spend cap')).getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows a failed egress read in its own row', async () => {
    h.egress.mockReturnValue(failed());
    await show(<Bill />);
    expect(row('Egress')).toHaveTextContent('egress read failed');
    expect(within(row('Egress')).getByRole('button', { name: /try again|retry/i })).toBeVisible();
  });
});

describe('StatusStrip', () => {
  function Strip() {
    const data: BillData = useBillFacts();
    return <StatusStrip data={data} onAction={vi.fn()} />;
  }
  it('answers first: nothing is stopped', async () => {
    await show(<Strip />);
    expect(screen.getByRole('status', { name: 'Spending limits status' })).toHaveTextContent(
      'Nothing on your bill is stopped'
    );
  });

  it('never says nothing is stopped while egress could not be read', async () => {
    h.egress.mockReturnValue(failed());
    await show(<Strip />);
    const strip = screen.getByRole('status', { name: 'Spending limits status' });
    expect(strip).toHaveTextContent('Nothing reported stopped');
    expect(strip).toHaveTextContent('Egress couldn’t be read.');
  });

  it('never calls a company’s cap fine', async () => {
    h.workspace.mockReturnValue({ org: 'acme', label: 'Acme', ready: true });
    await show(<Strip />);
    expect(screen.getByRole('status', { name: 'Spending limits status' })).toHaveTextContent(
      'Nothing reported stopped'
    );
  });

  it('offers the one action that lifts a stop', async () => {
    h.overageCap.mockReturnValue(ok({ overage_cap_cents: 0 }));
    const onAction = vi.fn();
    function Stopped() {
      return <StatusStrip data={useBillFacts()} onAction={onAction} />;
    }
    await show(<Stopped />);
    await userEvent.click(screen.getByRole('button', { name: 'Change cap' }));
    expect(onAction).toHaveBeenCalledWith('cap');
  });
});

describe('leftovers', () => {
  it('in a company workspace the bill is the organization’s, never “your”', async () => {
    h.workspace.mockReturnValue({ org: 'acme', label: 'Acme', ready: true });
    h.orgOverageCap.mockReturnValue(ok({ overage_cap_cents: 0 }));
    h.orgEgress.mockReturnValue(ok(election({ included_gib: 2000, enabled: true })));
    await show(<Bill />);
    expect(screen.getByRole('heading', { name: 'Acme’s bill' })).toBeInTheDocument();
    for (const name of ['Spend cap', 'Egress', 'Object storage'])
      expect(row(name).textContent).not.toMatch(/\byour\b/i);
  });

  it('the strip keeps one live region, so the settled sentence is announced', async () => {
    function Strip() {
      const [, again] = useState(0);
      return (
        <>
          <button type="button" onClick={() => again((n) => n + 1)}>
            Again
          </button>
          <StatusStrip data={useBillFacts()} onAction={vi.fn()} />
        </>
      );
    }
    h.overageCap.mockReturnValue({ ...ok(undefined), isPending: true, isSuccess: false });
    render(withRouter(<Strip />));
    const before = await screen.findByRole('status', { name: 'Spending limits status' });
    expect(before).toHaveAttribute('aria-live', 'polite');
    expect(before).toHaveTextContent('Checking the limits…');
    h.overageCap.mockReturnValue(ok({ overage_cap_cents: 5000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Again' }));
    await waitFor(() => expect(before).toHaveTextContent('Nothing on your bill is stopped'));
    expect(screen.getByRole('status', { name: 'Spending limits status' })).toBe(before);
  });
});
