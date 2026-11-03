import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { iso } from '@/test/workflows';

const cap = vi.hoisted(() => ({ access: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
  useCapabilityStage: () => 'Beta',
}));

const { WorkflowInsightsBody } = await import('./workflow-insights');

const stats = (over: Record<string, number> = {}) => ({
  sla_at_risk_workflow_count: 1,
  sla_breached_workflow_count: 0,
  sla_unknown_workflow_count: 0,
  awaiting_verification_workflow_count: 0,
  awaiting_verification_resolution_count: 0,
  low_blocker_count: 0,
  normal_blocker_count: 1,
  high_blocker_count: 0,
  urgent_blocker_count: 0,
  unacknowledged_blocker_count: 1,
  follow_up_overdue_blocker_count: 0,
  escalated_workflow_count: 0,
  escalated_blocker_count: 0,
  dependency_workflow_count: 0,
  dependency_count: 0,
  overdue_workflow_count: 0,
  workflow_count: 2,
  blocked_workflow_count: 1,
  stale_workflow_count: 1,
  blocker_count: 1,
  unknown_age_blockers: 0,
  ...over,
});

const wfState = (extra: Record<string, unknown> = {}) => ({
  workflow: 'order-fulfillment',
  instance_id: 'ord_1042',
  state: 'awaiting-payment',
  terminal: false,
  stale: false,
  overdue: false,
  occurred_at: iso(-3_600_000),
  revision: 3,
  contract_version: 2,
  updated_at: iso(-3_600_000),
  ...extra,
});

const attentionPage = {
  evaluated_at: iso(0),
  items: [
    {
      app_id: 'app',
      scope: 'production',
      operation_id: 'op-1',
      subject: { type: 'order', id: 'ord_1042' },
      state: wfState({
        blockers: [
          {
            code: 'payment-pending',
            description: 'Payment confirmation is pending.',
            operation: 'fulfill-order',
            owner: 'billing-team',
            next_action: 'Check the processor.',
          },
        ],
      }),
      reasons: ['blocked', 'sla_at_risk'],
    },
  ],
  next_cursor: 'page-2',
};

const duration = (count: number, p50: number, p95: number) => ({
  workflow_count: count,
  total_seconds: count * p50,
  p50_seconds: p50,
  p95_seconds: p95,
});
const cohort = (matching: number, excluded: number) => ({
  sla_configured_workflow_count: 0,
  sla_evaluated_workflow_count: matching - excluded,
  sla_breached_workflow_count: 1,
  sla_unknown_workflow_count: 0,
  matching_workflow_count: matching,
  sampled_workflow_count: matching,
  complete_history_workflow_count: matching - excluded,
  excluded_incomplete_workflow_count: excluded,
  cohort_truncated: false,
  exclusions: excluded ? [{ reason: 'missing_start', workflow_count: excluded }] : [],
  state_time: duration(matching - excluded, 5400, 86_400),
  blocked_time: duration(matching - excluded, 600, 7200),
  verification_wait: duration(0, 0, 0),
  states: [
    {
      sla_evaluated_visit_count: 0,
      sla_breached_visit_count: 0,
      contract_version: 2,
      state: 'packing',
      duration: duration(5, 3600, 28_800),
    },
  ],
  blockers: [],
  verification_owners: [],
  states_truncated: false,
  blockers_truncated: false,
  verification_owners_truncated: false,
});

type Handler = (init: { params?: { query?: Record<string, unknown> } }) => Answer;
let queries: Record<string, Record<string, unknown>[]>;

function serve(extra: Record<string, Handler> = {}) {
  queries = {};
  const log =
    (name: string, fn: Handler): Handler =>
    (init) => {
      (queries[name] ??= []).push(init.params?.query ?? {});
      return fn(init);
    };
  return routeApi({
    'GET /v1/apps/{slug}/workflow-attention/summary': log('attentionSummary', () => ({
      group_by: 'workflow',
      evaluated_at: iso(0),
      totals: stats(),
      groups: [],
    })),
    'GET /v1/apps/{slug}/workflow-attention': log('attention', (init) =>
      init.params?.query?.cursor
        ? {
            evaluated_at: iso(0),
            items: [
              {
                ...attentionPage.items[0],
                operation_id: 'op-2',
                subject: { type: 'order', id: 'ord_0999' },
                state: wfState({ instance_id: 'ord_0999', state: 'packing', stale: true }),
                reasons: ['stale'],
              },
            ],
          }
        : attentionPage
    ),
    'GET /v1/apps/{slug}/workflow-outcomes/summary': log('outcomeSummary', (init) => ({
      group_by: init.params?.query?.group_by ?? 'outcome',
      evaluated_at: iso(0),
      workflow_count: 7,
      groups:
        init.params?.query?.group_by === 'workflow'
          ? [{ value: 'order-fulfillment', workflow_count: 7 }]
          : [
              { value: 'delivered', workflow_count: 5 },
              { value: 'refunded', workflow_count: 2 },
            ],
    })),
    'GET /v1/apps/{slug}/workflow-outcomes': log('outcomes', () => ({
      evaluated_at: iso(0),
      items: [
        {
          app_id: 'app',
          scope: 'production',
          operation_id: 'op-3',
          subject: { type: 'order', id: 'ord_1001' },
          state: wfState({
            instance_id: 'ord_1001',
            state: 'done',
            terminal: true,
            outcome_code: 'delivered',
            outcome_description: 'Delivered to the customer.',
          }),
        },
      ],
    })),
    ...extra,
  });
}

beforeEach(() => {
  cap.access = 'on';
});
afterEach(() => vi.restoreAllMocks());

describe('Workflow insights', () => {
  it('shows attention as figures and a queue of blocked and stale workflows for one environment', async () => {
    serve();
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    expect(await screen.findByText('Need attention')).toBeInTheDocument();
    expect(await screen.findByText('ord_1042', { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText('Payment confirmation is pending.', { exact: false })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Holds fulfill-order · owner billing-team · next: Check the processor./)
    ).toBeInTheDocument();
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('SLA at risk')).toBeInTheDocument();
    expect(queries.attention[0]).toMatchObject({ scope: 'production', limit: 20 });
  });

  it('filters the queue by reason and pages with the cursor', async () => {
    serve();
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    await screen.findByText('ord_1042', { exact: false });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('order/ord_0999')).toBeInTheDocument();
    expect(queries.attention.at(-1)).toMatchObject({ cursor: 'page-2' });
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Attention reason' })).getByRole('button', {
        name: 'Stale',
      })
    );
    await waitFor(() => expect(queries.attention.at(-1)).toMatchObject({ reason: 'stale' }));
  });

  it('counts outcomes by the chosen dimension and lists the latest', async () => {
    serve();
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    expect(await screen.findByText('7 finished with an outcome')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'delivered' })).toBeInTheDocument();
    expect(await screen.findByText('Delivered to the customer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'By workflow' }));
    await waitFor(() =>
      expect(queries.outcomeSummary.at(-1)).toMatchObject({ group_by: 'workflow' })
    );
  });

  it('asks for a workflow before measuring performance, then shows both cohorts as figures', async () => {
    const spies = serve({
      'GET /v1/apps/{slug}/workflow-performance/summary': () => ({
        cohort_token: 'tok-1',
        evaluated_at: iso(0),
        workflow: 'order-fulfillment',
        cohort_limit: 100,
        completed: cohort(42, 3),
        ongoing: cohort(6, 0),
      }),
    });
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    expect(await screen.findByText(/Name a workflow above/)).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalledWith(
      '/v1/apps/{slug}/workflow-performance/summary',
      expect.anything()
    );
    await userEvent.type(screen.getByLabelText('Workflow'), 'order-fulfillment');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    const finished = await screen.findByRole('region', { name: 'Finished instances' });
    expect(within(finished).getByText('of 42 matching')).toBeInTheDocument();
    expect(within(finished).getByText('1.5 h · 1.0 d')).toBeInTheDocument();
    expect(within(finished).getByText(/Left out: 3 \(3 start not retained\)/)).toBeInTheDocument();
    // Scalars, not series: there is no chart on this page.
    expect(document.querySelector('canvas, svg[role="img"]')).toBeNull();
  });

  it('refuses a workflow name apid would reject, before reading', async () => {
    serve();
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    await userEvent.type(await screen.findByLabelText('Workflow'), 'Order Fulfillment');
    expect(screen.getByText(/lowercase letters, digits and dashes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
  });

  it('asks to measure again when the cohort behind the slowest instances changed', async () => {
    serve({
      'GET /v1/apps/{slug}/workflow-performance/summary': () => ({
        cohort_token: 'tok-1',
        evaluated_at: iso(0),
        workflow: 'order-fulfillment',
        cohort_limit: 100,
        completed: cohort(42, 3),
        ongoing: cohort(6, 0),
      }),
      'GET /v1/apps/{slug}/workflow-performance/instances': () =>
        problem(409, 'workflow_performance_cohort_changed', 'refresh the performance summary'),
    });
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    await userEvent.type(await screen.findByLabelText('Workflow'), 'order-fulfillment');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show slowest instances' }));
    expect(
      await screen.findByText('The instances changed since these figures were measured.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Measure again' })).toBeInTheDocument();
  });

  it('shows a failed read as an error, not as nothing needing attention', async () => {
    serve({
      'GET /v1/apps/{slug}/workflow-attention': () =>
        problem(503, 'capacity', 'workflow attention unavailable'),
    });
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    expect(await screen.findByText('workflow attention unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/needs attention\./)).not.toBeInTheDocument();
  });

  it('reads nothing while the capability is off', async () => {
    cap.access = 'off';
    const spies = serve();
    renderWithProviders(<WorkflowInsightsBody slug="billing" />);
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });
});
