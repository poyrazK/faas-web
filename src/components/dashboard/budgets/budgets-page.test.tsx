import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import type { Budget, BudgetSpec } from '@/lib/budgets';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: 'acct',
    capability: { maturity: 'beta' },
    state: 'available',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', email: 'me@example.com', plan: 'pro' } }),
}));

const { BudgetsPage } = await import('./budgets-page');

const APP = { id: '22222222-2222-4222-8222-222222222222', slug: 'api' };
const PREVIEW_APP = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'pr-42-api',
  preview_of_slug: 'api',
};
const SLACK = {
  id: '6a1f5b2e-0c1d-4e2f-8a9b-0c1d2e3f4a5b',
  name: 'ops-slack',
  kind: 'slack',
  target: 'hooks.slack.com · T04ABCD/B07WXYZ',
  last_delivered_at: '2026-11-03T08:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
};

const SPEC: BudgetSpec = {
  name: 'Monthly compute',
  scope: { kind: 'account' },
  currency: 'USD',
  meters: ['compute'],
  basis: 'net_usage',
  limit_millicents: 2_500_000,
  notify_millicents: [1_000_000],
  mode: 'monitored',
  action: 'notify',
  drain_seconds: 0,
  resume_rule: 'next_period',
  enabled: true,
};
const EVALUATION = {
  period_start: '2026-11-01T00:00:00Z',
  period_end: '2026-12-01T00:00:00Z',
  as_of: '2026-11-03T09:58:00Z',
  evaluated_at: '2026-11-03T09:59:00Z',
  evidence_through_id: 1,
  known_millicents: 1_460_000,
  coverage_complete: true,
  fresh: true,
  reasons: [],
  projected_millicents: 3_100_000,
};
const MONTHLY: Budget = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: 'acct',
  revision: 2,
  spec: SPEC,
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
  status: 'active',
  notification_ready: true,
  enforcement_ready: false,
  reasons: ['notification_only_workloads_continue'],
  runtime: {
    evaluation: EVALUATION,
    alerts: [
      {
        id: 'a1',
        policy_revision: 2,
        threshold_millicents: 1_000_000,
        evaluation: EVALUATION,
        state: 'delivered',
        attempts: 1,
        next_attempt_at: '2026-11-03T09:59:00Z',
        delivered_at: '2026-11-03T09:59:00Z',
      },
    ],
  },
};
const STOPPING: Budget = {
  ...MONTHLY,
  id: '44444444-4444-4444-8444-444444444444',
  revision: 1,
  spec: {
    ...SPEC,
    name: 'Preview spending',
    action: 'stop_previews',
    drain_seconds: 30,
    limit_millicents: 200_000,
    notify_millicents: [],
  },
  enforcement_ready: true,
  runtime: {
    evaluation: EVALUATION,
    alerts: [],
    stops: [
      {
        id: 's1',
        policy_id: '44444444-4444-4444-8444-444444444444',
        revision: 1,
        period_start: EVALUATION.period_start,
        period_end: EVALUATION.period_end,
        requested_at: '2026-11-03T09:00:00Z',
        drain_deadline: '2026-11-03T09:00:30Z',
        resume_rule: 'manual',
        evaluation: EVALUATION,
        targets: [
          {
            app_id: PREVIEW_APP.id,
            state: 'enforced',
            observed_at: '2026-11-03T09:58:00Z',
            resident_count: 0,
          },
        ],
      },
    ],
  },
};

let budgets: Budget[];
let boundChannels: unknown[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/billing/budgets': () => ({ budgets }),
    'GET /v1/billing/budgets/{id}': ({ params }) => budgets.find((b) => b.id === params?.path?.id),
    'GET /v1/billing/budgets/{id}/revisions': ({ params }) => ({
      revisions: [
        {
          policy_id: params?.path?.id,
          revision: 1,
          actor: 'account:acct',
          mutation: 'created',
          spec: SPEC,
          recorded_at: '2026-10-25T00:00:00Z',
        },
      ],
    }),
    'GET /v1/billing/budgets/{id}/channels': ({ params }) => ({
      policy_id: params?.path?.id,
      channels: boundChannels,
    }),
    'GET /v1/apps': () => [APP, PREVIEW_APP],
    'GET /v1/notification-channels': () => [SLACK],
    'POST /v1/billing/budgets/preview': (init) => {
      const spec = (init.body as { spec: BudgetSpec }).spec;
      const stops = spec.action !== 'notify';
      return {
        spec,
        period_start: EVALUATION.period_start,
        period_end: EVALUATION.period_end,
        as_of: EVALUATION.as_of,
        known_millicents: 1_460_000,
        known_limit_reached: false,
        coverage_complete: false,
        fresh: true,
        reasons: ['compute:missing_scope_attribution'],
        enforcement_ready: spec.action === 'stop_previews',
        guarantee: 'monitored_after_retained_evidence; delayed_sources_and_drain_can_exceed_limit',
        targets: stops
          ? [
              {
                kind: 'app',
                id: PREVIEW_APP.id,
                name: PREVIEW_APP.slug,
                effect: 'block_traffic_and_wakes_then_stop_at_drain_deadline',
              },
            ]
          : [],
        continuing_targets: [
          { kind: 'app', id: APP.id, name: APP.slug, effect: 'compute_can_continue' },
        ],
      };
    },
    ...extra,
  });
}

beforeEach(() => {
  budgets = [MONTHLY, STOPPING];
  boundChannels = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  workspace.org = null;
  workspace.label = 'Personal';
});

/** The create form waits behind the page's primary action. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'New budget' }));
  return screen.getByRole('form', { name: 'New budget' });
}

/** Opens a row's ⋯ menu and picks an item. */
async function pick(user: ReturnType<typeof userEvent.setup>, budget: string, item: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${budget}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function fillNew(user: ReturnType<typeof userEvent.setup>, name: string, limit: string) {
  const form = await openForm(user);
  await user.type(within(form).getByLabelText('Name'), name);
  await user.type(within(form).getByLabelText('Limit (USD a month)'), limit);
  return form;
}

describe('BudgetsPage in a company workspace', () => {
  it('says budgets are personal and reads none of them', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme Corp';
    const spies = api();
    renderWithProviders(<BudgetsPage />);
    expect(screen.getByRole('status')).toHaveTextContent(
      /Budgets belong to your personal account.*Acme Corp has no budgets/
    );
    expect(screen.queryByRole('form', { name: 'New budget' })).not.toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
    expect(spies.POST).not.toHaveBeenCalled();
  });
});

describe('BudgetsPage', () => {
  it('opens with what the budgets are doing now, most urgent first', async () => {
    api();
    renderWithProviders(<BudgetsPage />);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Budgets status' })).toHaveTextContent(
        '“Preview spending” is stopping previews. Production keeps running.'
      )
    );
    // The long create form waits behind the primary action.
    expect(screen.queryByRole('form', { name: 'New budget' })).not.toBeInTheDocument();
    await openForm(userEvent.setup());
    expect(screen.queryByRole('button', { name: 'New budget' })).not.toBeInTheDocument();
  });

  it('says there are none yet when the account has no budgets', async () => {
    budgets = [];
    api();
    renderWithProviders(<BudgetsPage />);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Budgets status' })).toHaveTextContent(
        /^You have no budgets yet\./
      )
    );
  });

  it('lists budgets with their response and status, labelled beta', async () => {
    api();
    renderWithProviders(<BudgetsPage />);
    expect(await screen.findByText('Monthly compute')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    const row = screen.getByText('Preview spending').closest('tr')!;
    expect(within(row).getByText('Stop previews')).toBeInTheDocument();
    expect(within(row).getByText('Stopping previews')).toBeInTheDocument();
    const monthly = screen.getByText('Monthly compute').closest('tr')!;
    expect(within(monthly).getByText('Active')).toBeInTheDocument();
    expect(within(monthly).getByText('$14.60')).toBeInTheDocument();
    expect(within(monthly).getByText(/\$31\.00 projected/)).toBeInTheDocument();
  });

  it('previews a spec without saving, then creates an alert with an Idempotency-Key', async () => {
    const created: unknown[] = [];
    const spies = api({
      'POST /v1/billing/budgets': (init) => {
        created.push(init);
        return { ...MONTHLY, id: 'new', spec: (init.body as { spec: BudgetSpec }).spec };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsPage />);
    const form = await fillNew(user, 'Ops alerts', '30');
    await user.type(within(form).getByLabelText(/Earlier alerts/), '10, 20');
    await user.click(within(form).getByRole('button', { name: 'Preview this month' }));
    const preview = await within(form).findByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('$14.60')).toBeInTheDocument();
    expect(within(preview).getByText(/Partial: the total may be higher/)).toBeInTheDocument();
    expect(within(preview).getByText(/some usage could not be attributed/)).toBeInTheDocument();
    expect(created).toHaveLength(0);
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      params: { header: { 'Idempotency-Key': expect.stringMatching(/\S/) } },
      body: {
        spec: {
          name: 'Ops alerts',
          scope: { kind: 'account' },
          limit_millicents: 3_000_000,
          notify_millicents: [1_000_000, 2_000_000],
          mode: 'monitored',
          action: 'notify',
          enabled: true,
        },
      },
    });
    // An alert stops nothing, so nothing was confirmed.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledTimes(2);
  });

  it('confirms a preview stop naming what stops and what keeps running', async () => {
    const created: unknown[] = [];
    api({
      'POST /v1/billing/budgets': (init) => {
        created.push(init);
        return { ...STOPPING, id: 'new' };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsPage />);
    const form = await fillNew(user, 'Previews', '5');
    await user.click(within(form).getByRole('radio', { name: /Stop previews/ }));
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/pr-42-api/);
    expect(dialog).toHaveTextContent(/api keeps running/);
    expect(dialog).toHaveTextContent(/next UTC month/);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(created).toHaveLength(0);
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Turn on preview stop',
      })
    );
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      body: { spec: { action: 'stop_previews', meters: ['compute'] } },
    });
  });

  it('shows strict budgets as not released, saves a draft instead, and stops offering to turn one on', async () => {
    const created: { body: { spec: BudgetSpec } }[] = [];
    api({
      'POST /v1/billing/budgets': (init) => {
        const body = init.body as { spec: BudgetSpec };
        created.push({ body });
        if (body.spec.enabled)
          return problem(
            422,
            'financial_budget_activation_unavailable',
            'Strict budgets not released'
          );
        return { ...MONTHLY, id: 'strict', status: 'draft', spec: body.spec };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsPage />);
    const form = await fillNew(user, 'api cap', '40');
    await user.click(within(form).getByRole('radio', { name: /Strict cap/ }));
    expect(within(form).queryByLabelText(/Earlier alerts/)).not.toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('Scope'), 'app');
    await user.selectOptions(await within(form).findByLabelText('App'), APP.id);
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on strict cap' })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(/not released to this account/i);
    expect(created[0].body.spec).toMatchObject({
      mode: 'strict',
      action: 'suspend_workloads',
      basis: 'gross_usage',
      notify_millicents: [],
      drain_seconds: 0,
      scope: { kind: 'app', id: APP.id },
    });
    await user.click(within(alert).getByRole('button', { name: 'Save as a draft instead' }));
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[1].body.spec.enabled).toBe(false);
    // From here on the page does not offer what apid refused.
    const again = await openForm(user);
    await user.click(within(again).getByRole('radio', { name: /Strict cap/ }));
    expect(within(again).getByRole('checkbox', { name: /Turn on now/ })).toBeDisabled();
    expect(within(again).getByText(/Not released to this account: draft only/)).toBeInTheDocument();
  });

  it('shows a recorded stop and attaches an alert channel', async () => {
    const puts: unknown[] = [];
    api({
      'PUT /v1/billing/budgets/{id}/channels': (init) => {
        puts.push(init);
        boundChannels = [SLACK];
        return { policy_id: MONTHLY.id, channels: [SLACK] };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsPage />);
    await pick(user, 'Preview spending', 'Show details');
    const stop = await screen.findByRole('region', { name: 'Automatic stop' });
    expect(within(stop).getByText('pr-42-api')).toBeInTheDocument();
    expect(within(stop).getByText('Stopped')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close budget details' }));

    await pick(user, 'Monthly compute', 'Show details');
    const channels = await screen.findByRole('region', { name: 'Alert channels' });
    expect(within(channels).getByText(/Only the account email/)).toBeInTheDocument();
    await user.click(within(channels).getByRole('button', { name: 'Add channels' }));
    await user.click(await within(channels).findByRole('checkbox', { name: /ops-slack/ }));
    await user.click(within(channels).getByRole('button', { name: 'Save channels' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      params: { path: { id: MONTHLY.id }, header: { 'Idempotency-Key': expect.any(String) } },
      body: { channel_ids: [SLACK.id] },
    });
    expect(
      await within(channels).findByRole('list', { name: 'Budget alert channels' })
    ).toHaveTextContent('ops-slack');
  });

  it('deletes at the current revision after a confirm that says what changes', async () => {
    const deletes: unknown[] = [];
    api({
      'DELETE /v1/billing/budgets/{id}': (init) => {
        deletes.push(init);
        return { ...STOPPING, status: 'deleted', deleted_at: '2026-11-03T10:00:00Z', revision: 2 };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BudgetsPage />);
    await pick(user, 'Preview spending', 'Delete budget');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/stop it placed on previews is released/);
    expect(dialog).toHaveTextContent(/history stays readable/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete budget' }));
    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toMatchObject({
      params: { path: { id: STOPPING.id }, header: { 'Idempotency-Key': expect.any(String) } },
      body: { expected_revision: 1 },
    });
  });
});
