import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

/**
 * Dev-mock answers for App › Automate › Workflow insights: the business
 * workflow attention queue, outcomes and performance cohorts that apps report
 * through Operations (faas pkg/apid/operation/attention.go, outcomes.go,
 * performance.go, performance_instances.go).
 *
 * Only the `production` environment has reports: three workflows needing
 * attention, eleven finished ones with outcomes, and `order-fulfillment`
 * cohorts with history exclusions. Any other environment answers empty.
 * A cohort token minted more than five minutes ago answers
 * `workflow_performance_cohort_changed`, as a changed cohort does upstream.
 */

type S = components['schemas'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  req: IncomingMessage;
}
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const TENANT = '0d6f2a4e-7b1c-4e8a-9a51-3c2f8e6b1d70';

function state(
  workflow: string,
  instance: string,
  name: string,
  ageMs: number,
  extra: Partial<S['OperationWorkflowState']> = {}
): S['OperationWorkflowState'] {
  return {
    workflow,
    instance_id: instance,
    state: name,
    terminal: false,
    stale: false,
    overdue: false,
    occurred_at: iso(db.NOW - ageMs),
    revision: 3,
    contract_version: 2,
    updated_at: iso(db.NOW - ageMs),
    ...extra,
  };
}

function attentionFor(app: (typeof db.apps)[number]): S['OperationWorkflowAttentionEntry'][] {
  const base = { app_id: app.id, scope: 'production', operation_id: randomUUID() };
  return [
    {
      ...base,
      subject: { type: 'order', id: 'ord_1042' },
      platform_tenant_id: TENANT,
      state: state('order-fulfillment', 'ord_1042', 'awaiting-payment', 50 * MIN, {
        blockers: [
          {
            code: 'payment-pending',
            description: 'Payment confirmation is pending.',
            operation: 'fulfill-order',
            owner: 'billing-team',
            next_action: 'Check the card processor for a late webhook.',
          },
        ],
      }),
      reasons: ['blocked', 'sla_at_risk'],
    },
    {
      ...base,
      operation_id: randomUUID(),
      subject: { type: 'order', id: 'ord_1038' },
      state: state('order-fulfillment', 'ord_1038', 'packing', 9 * HOUR, {
        stale: true,
        stale_after_seconds: 4 * 3600,
      }),
      reasons: ['stale'],
    },
    {
      ...base,
      operation_id: randomUUID(),
      subject: { type: 'customer', id: 'cus_77' },
      state: state('onboarding', 'cus_77', 'kyc-review', 30 * HOUR, {
        overdue: true,
        overdue_seconds: 6 * 3600,
        deadline_at: iso(db.NOW - 6 * HOUR),
        blockers: [
          {
            code: 'kyc-manual',
            description: 'Identity documents need a manual check.',
            operation: 'activate-account',
            priority: 'high',
          },
        ],
      }),
      reasons: ['overdue', 'escalated'],
    },
  ];
}

function outcomesFor(app: (typeof db.apps)[number]): S['OperationWorkflowOutcomeEntry'][] {
  const rows: [string, string, string, string][] = [
    ['order-fulfillment', 'ord_1001', 'delivered', 'Delivered to the customer.'],
    ['order-fulfillment', 'ord_1002', 'delivered', 'Delivered to the customer.'],
    ['order-fulfillment', 'ord_1004', 'delivered', 'Delivered to the customer.'],
    ['order-fulfillment', 'ord_1007', 'refunded', 'Refunded after a failed delivery.'],
    ['order-fulfillment', 'ord_1009', 'delivered', 'Delivered to the customer.'],
    ['order-fulfillment', 'ord_1011', 'cancelled', 'Cancelled by the customer.'],
    ['order-fulfillment', 'ord_1013', 'delivered', 'Delivered to the customer.'],
    ['order-fulfillment', 'ord_1015', 'refunded', 'Refunded after a damaged parcel.'],
    ['onboarding', 'cus_61', 'activated', 'Account activated.'],
    ['onboarding', 'cus_64', 'activated', 'Account activated.'],
    ['onboarding', 'cus_70', 'activated', 'Account activated.'],
  ];
  return rows.map(([workflow, id, code, description], i) => ({
    app_id: app.id,
    scope: 'production',
    platform_tenant_id: i % 3 === 0 ? TENANT : undefined,
    subject: { type: workflow === 'onboarding' ? 'customer' : 'order', id },
    operation_id: randomUUID(),
    state: state(workflow, id, code === 'cancelled' ? 'cancelled' : 'done', (i + 1) * 3 * HOUR, {
      terminal: true,
      outcome_code: code,
      outcome_description: description,
    }),
  }));
}

const attention = new Map<string, S['OperationWorkflowAttentionEntry'][]>();
const outcomes = new Map<string, S['OperationWorkflowOutcomeEntry'][]>();
for (const app of db.apps) {
  attention.set(app.slug, db.EMPTY ? [] : attentionFor(app));
  outcomes.set(app.slug, db.EMPTY ? [] : outcomesFor(app));
}

const duration = (
  count: number,
  p50: number,
  p95: number
): S['OperationWorkflowDurationDistribution'] => ({
  workflow_count: count,
  total_seconds: count * p50,
  p50_seconds: count ? p50 : 0,
  p95_seconds: count ? p95 : 0,
});

function cohort(
  matching: number,
  excluded: number,
  stateP50: number,
  blockedP50: number
): S['OperationWorkflowPerformanceCohort'] {
  const complete = matching - excluded;
  return {
    sla_configured_workflow_count: complete,
    sla_evaluated_workflow_count: complete,
    sla_breached_workflow_count: Math.floor(complete / 10),
    sla_unknown_workflow_count: 0,
    matching_workflow_count: matching,
    sampled_workflow_count: Math.min(matching, 100),
    complete_history_workflow_count: complete,
    excluded_incomplete_workflow_count: excluded,
    cohort_truncated: matching > 100,
    exclusions: excluded
      ? [
          { reason: 'missing_start', workflow_count: excluded - 1 },
          { reason: 'revision_gap', workflow_count: 1 },
        ]
      : [],
    state_time: duration(complete, stateP50, stateP50 * 12),
    blocked_time: duration(complete, blockedP50, blockedP50 * 10),
    verification_wait: duration(0, 0, 0),
    states: [
      {
        sla_evaluated_visit_count: complete,
        sla_breached_visit_count: 2,
        contract_version: 2,
        state: 'awaiting-payment',
        duration: duration(complete, 900, 7200),
      },
      {
        sla_evaluated_visit_count: complete,
        sla_breached_visit_count: 1,
        contract_version: 2,
        state: 'packing',
        duration: duration(complete, 3600, 28_800),
      },
      {
        sla_evaluated_visit_count: 0,
        sla_breached_visit_count: 0,
        contract_version: 2,
        state: 'shipped',
        duration: duration(complete, stateP50, stateP50 * 6),
      },
    ],
    blockers: [
      {
        contract_version: 2,
        operation: 'fulfill-order',
        code: 'payment-pending',
        owner: 'billing-team',
        duration: duration(Math.ceil(complete / 3), blockedP50, blockedP50 * 8),
      },
    ],
    verification_owners: [],
    states_truncated: false,
    blockers_truncated: false,
    verification_owners_truncated: false,
  };
}

export function workflowInsightHandlers(Problem: ProblemCtor) {
  const app = (slug: string) => {
    const found = db.appBySlug(slug);
    if (!found) throw new Problem(404, 'app_not_found', 'app not found');
    return found;
  };
  const scoped = <T extends { scope: string; state: { workflow: string } }>(
    rows: T[],
    query: URLSearchParams
  ) => {
    const scope = query.get('scope');
    if (!scope) throw new Problem(400, 'validation_failed', 'scope is required');
    const workflow = query.get('workflow');
    return rows.filter((r) => r.scope === scope && (!workflow || r.state.workflow === workflow));
  };
  /** Cursor = index of the next item; a stand-in for apid's opaque cursor. */
  const page = <T>(rows: T[], query: URLSearchParams) => {
    const limit = Number(query.get('limit') ?? 20);
    const start = Number(query.get('cursor') ?? 0);
    const items = rows.slice(start, start + limit);
    return {
      items,
      ...(start + limit < rows.length ? { next_cursor: String(start + limit) } : {}),
    };
  };
  const stats = (
    rows: S['OperationWorkflowAttentionEntry'][]
  ): S['OperationWorkflowAttentionStats'] => {
    const has = (r: string) => rows.filter((e) => e.reasons.includes(r as never)).length;
    const blockers = rows.flatMap((e) => e.state.blockers ?? []);
    return {
      sla_at_risk_workflow_count: has('sla_at_risk'),
      sla_breached_workflow_count: has('sla_breached'),
      sla_unknown_workflow_count: 0,
      awaiting_verification_workflow_count: 0,
      awaiting_verification_resolution_count: 0,
      low_blocker_count: blockers.filter((b) => b.priority === 'low').length,
      normal_blocker_count: blockers.filter((b) => !b.priority || b.priority === 'normal').length,
      high_blocker_count: blockers.filter((b) => b.priority === 'high').length,
      urgent_blocker_count: blockers.filter((b) => b.priority === 'urgent').length,
      unacknowledged_blocker_count: blockers.length,
      follow_up_overdue_blocker_count: 0,
      escalated_workflow_count: has('escalated'),
      escalated_blocker_count: has('escalated'),
      dependency_workflow_count: 0,
      dependency_count: 0,
      overdue_workflow_count: has('overdue'),
      longest_overdue_seconds: Math.max(0, ...rows.map((e) => e.state.overdue_seconds ?? 0)),
      workflow_count: rows.length,
      blocked_workflow_count: has('blocked'),
      stale_workflow_count: has('stale'),
      blocker_count: blockers.length,
      unknown_age_blockers: blockers.length,
    };
  };
  const tokens = new Map<string, number>();

  return {
    attention: ({ params, query }: MockCtx) => {
      app(params.slug);
      const reason = query.get('reason');
      const rows = scoped(attention.get(params.slug) ?? [], query).filter(
        (e) => !reason || e.reasons.includes(reason as never)
      );
      return { ...page(rows, query), evaluated_at: new Date().toISOString() };
    },

    attentionSummary: ({ params, query }: MockCtx) => {
      app(params.slug);
      const rows = scoped(attention.get(params.slug) ?? [], query);
      const workflows = [...new Set(rows.map((e) => e.state.workflow))].sort();
      return {
        group_by: 'workflow',
        evaluated_at: new Date().toISOString(),
        totals: stats(rows),
        groups: workflows.map((w) => ({
          value: w,
          stats: stats(rows.filter((e) => e.state.workflow === w)),
        })),
      } satisfies S['OperationWorkflowAttentionSummary'];
    },

    outcomes: ({ params, query }: MockCtx) => {
      app(params.slug);
      const code = query.get('code');
      const rows = scoped(outcomes.get(params.slug) ?? [], query).filter(
        (o) => !code || o.state.outcome_code === code
      );
      return { ...page(rows, query), evaluated_at: new Date().toISOString() };
    },

    outcomeSummary: ({ params, query }: MockCtx) => {
      app(params.slug);
      const groupBy = (query.get('group_by') ??
        'outcome') as S['OperationWorkflowOutcomeSummary']['group_by'];
      const rows = scoped(outcomes.get(params.slug) ?? [], query);
      const value = (o: S['OperationWorkflowOutcomeEntry']) =>
        groupBy === 'workflow'
          ? o.state.workflow
          : groupBy === 'customer'
            ? (o.platform_tenant_id ?? '')
            : (o.state.outcome_code ?? '');
      const counts = new Map<string, number>();
      for (const o of rows) counts.set(value(o), (counts.get(value(o)) ?? 0) + 1);
      return {
        group_by: groupBy,
        evaluated_at: new Date().toISOString(),
        workflow_count: rows.length,
        groups: [...counts]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([v, n]) => ({ value: v, workflow_count: n })),
      } satisfies S['OperationWorkflowOutcomeSummary'];
    },

    performance: ({ params, query }: MockCtx) => {
      app(params.slug);
      const workflow = query.get('workflow') ?? '';
      if (!workflow || !query.get('scope'))
        throw new Problem(400, 'validation_failed', 'scope and workflow are required');
      const known =
        query.get('scope') === 'production' && workflow === 'order-fulfillment' && !db.EMPTY;
      const token = `mock-cohort-${randomUUID()}`;
      tokens.set(token, Date.now());
      return {
        cohort_token: token,
        evaluated_at: new Date().toISOString(),
        workflow,
        cohort_limit: 100,
        completed: known ? cohort(42, 3, 5400, 600) : cohort(0, 0, 0, 0),
        ongoing: known ? cohort(6, 0, 2400, 900) : cohort(0, 0, 0, 0),
      } satisfies S['OperationWorkflowPerformanceSummary'];
    },

    instances: ({ params, query }: MockCtx) => {
      app(params.slug);
      const token = query.get('cohort_token') ?? '';
      const minted = tokens.get(token);
      if (token && (!minted || Date.now() - minted > 5 * MIN))
        throw new Problem(
          409,
          'workflow_performance_cohort_changed',
          'refresh the performance summary before opening its contributors'
        );
      const cohortName = (query.get('cohort') ?? 'completed') as 'completed' | 'ongoing';
      const dimension = query.get('dimension') ?? 'state_time';
      const workflow = query.get('workflow') ?? '';
      const known =
        query.get('scope') === 'production' && workflow === 'order-fulfillment' && !db.EMPTY;
      const n = known ? (cohortName === 'completed' ? 5 : 3) : 0;
      const items = Array.from({ length: n }, (_, i) => ({
        subject: { type: 'order', id: `ord_${1100 + i}` },
        operation_id: randomUUID(),
        state: state(
          workflow,
          `ord_${1100 + i}`,
          cohortName === 'completed' ? 'done' : 'packing',
          (i + 2) * HOUR,
          {
            terminal: cohortName === 'completed',
          }
        ),
        observed_seconds: (dimension === 'blocked_time' ? 7200 : 86_400) - i * 3600,
        resolution_verifications: [],
        awaiting_verification_count: 0,
        resolution_verification_count: 0,
      }));
      return {
        evaluated_at: new Date().toISOString(),
        cohort_token: token || `mock-cohort-${randomUUID()}`,
        workflow,
        cohort: cohortName,
        group: { dimension: dimension as S['OperationWorkflowPerformanceGroup']['dimension'] },
        matching_workflow_count: n,
        sampled_workflow_count: n,
        complete_history_workflow_count: n,
        excluded_incomplete_workflow_count: 0,
        cohort_truncated: false,
        exclusions: [],
        duration: duration(n, 43_200, 86_400),
        items,
      } satisfies S['OperationWorkflowPerformanceInstancesResponse'];
    },
  };
}
