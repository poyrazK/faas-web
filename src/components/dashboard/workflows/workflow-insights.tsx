import { useId, useMemo, useState } from 'react';
import {
  Clock,
  Hourglass,
  Link as LinkIcon,
  ShieldAlert,
  User,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { InlinePhase, Panel, StatTile, queryPhase } from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  useAttentionQueue,
  useAttentionSummary,
  useOutcomeSummary,
  useOutcomes,
  usePerformanceInstances,
  usePerformanceSummary,
  type AttentionEntry,
  type AttentionReason,
  type Duration,
  type OutcomeGroupBy,
  type OverallDimension,
  type PerformanceCohort,
} from '@/lib/api/workflow-insights';
import { formatSeconds } from './workflow-run-detail';

/**
 * App › Automate › Workflow insights (capability `workflow-insights`, beta).
 *
 * These are the business workflows an app reports through Operation
 * milestones — an order's fulfilment, a customer's onboarding — not the
 * durable runs on the Workflows page. Each read is for one environment.
 * Nothing here is a time series, so it is figures and tables only.
 */
export function WorkflowInsightsBody({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="workflow-insights" title="Workflow insights">
      <Insights slug={slug} />
    </CapabilityGate>
  );
}

/** Workflow names are lowercase slugs (OperationMilestone workflow selectors). */
const WORKFLOW = /^[a-z][a-z0-9-]{0,62}$/;
const SCOPE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

function Insights({ slug }: { slug: string }) {
  const id = useId();
  const stage = useCapabilityStage('workflow-insights');
  const [scopeInput, setScopeInput] = useState('production');
  const [workflowInput, setWorkflowInput] = useState('');
  const [scope, setScope] = useState('production');
  const [workflow, setWorkflow] = useState('');
  const scopeError = SCOPE.test(scopeInput.trim())
    ? undefined
    : 'Use the environment name, such as production.';
  const workflowError =
    !workflowInput.trim() || WORKFLOW.test(workflowInput.trim())
      ? undefined
      : 'Workflow names are lowercase letters, digits and dashes.';

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Workflow insights"
        description={`${stage ? `${stage} · ` : ''}What your app reports about its business workflows through Operations: which need attention, how they ended and how long they take. Separate from the durable runs on the Workflows page.`}
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (scopeError || workflowError) return;
            setScope(scopeInput.trim());
            setWorkflow(workflowInput.trim());
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-scope`} className="text-xs text-muted-foreground">
              Environment
            </label>
            <Input
              id={`${id}-scope`}
              value={scopeInput}
              onChange={(e) => setScopeInput(e.target.value)}
              className="w-44"
              spellCheck={false}
              aria-invalid={scopeError ? true : undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-workflow`} className="text-xs text-muted-foreground">
              Workflow
            </label>
            <Input
              id={`${id}-workflow`}
              value={workflowInput}
              onChange={(e) => setWorkflowInput(e.target.value)}
              placeholder="All workflows"
              className="w-56"
              spellCheck={false}
              aria-invalid={workflowError ? true : undefined}
            />
          </div>
          <Button size="sm" type="submit" disabled={Boolean(scopeError || workflowError)}>
            Show
          </Button>
          {(scopeError || workflowError) && (
            <p className="basis-full text-xs" style={{ color: 'var(--status-critical)' }}>
              {scopeError ?? workflowError}
            </p>
          )}
        </form>
      </Panel>
      <Attention slug={slug} scope={scope} workflow={workflow} />
      <Outcomes slug={slug} scope={scope} workflow={workflow} />
      <Performance slug={slug} scope={scope} workflow={workflow} />
    </div>
  );
}

/* --- Attention -------------------------------------------------------------- */

const REASONS: Record<AttentionReason, { label: string; color: string; icon: typeof Clock }> = {
  blocked: { label: 'Blocked', color: 'var(--status-warning)', icon: ShieldAlert },
  stale: { label: 'Stale', color: 'var(--status-warning)', icon: Hourglass },
  overdue: { label: 'Overdue', color: 'var(--status-critical)', icon: Clock },
  dependency: {
    label: 'Waiting on another workflow',
    color: 'var(--status-warning)',
    icon: LinkIcon,
  },
  escalated: { label: 'Escalated', color: 'var(--status-critical)', icon: WarningTriangle },
  unacknowledged: { label: 'Unacknowledged', color: 'var(--status-warning)', icon: User },
  follow_up_overdue: { label: 'Follow-up overdue', color: 'var(--status-critical)', icon: Clock },
  awaiting_verification: {
    label: 'Awaiting verification',
    color: 'var(--chart-muted)',
    icon: Hourglass,
  },
  sla_breached: { label: 'SLA breached', color: 'var(--status-critical)', icon: WarningTriangle },
  sla_at_risk: { label: 'SLA at risk', color: 'var(--status-warning)', icon: Clock },
};

const REASON_FILTERS: { key: AttentionReason | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'stale', label: 'Stale' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'sla_breached', label: 'SLA breached' },
];

function ReasonBadge({ reason }: { reason: AttentionReason }) {
  const cfg = REASONS[reason] ?? { label: reason, color: 'var(--chart-muted)', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{
        borderColor: `color-mix(in oklab, ${cfg.color} 35%, transparent)`,
        color: cfg.color,
      }}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

const subjectOf = (e: { subject: { type: string; id: string } }) =>
  `${e.subject.type}/${e.subject.id}`;

function Attention({ slug, scope, workflow }: { slug: string; scope: string; workflow: string }) {
  const [reason, setReason] = useState<AttentionReason | ''>('');
  const summary = useAttentionSummary(slug, scope, workflow);
  const queue = useAttentionQueue(slug, scope, workflow, reason);
  const items = useMemo(() => queue.data?.pages.flatMap((p) => p.items) ?? [], [queue.data]);
  const t = summary.data?.totals;
  return (
    <Panel
      title="Needs attention"
      description={`Workflows in ${scope} with blockers, stale or overdue states, or broken SLAs, as last reported. A live queue: entries move as reports arrive.`}
    >
      <div className="flex flex-col gap-5">
        {!t ? (
          <InlinePhase
            phase={queryPhase({ loading: summary.isPending, error: summary.error })}
            error={summary.error}
            onRetry={() => void summary.refetch()}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Need attention" value={t.workflow_count} />
            <StatTile
              label="Blocked"
              value={t.blocked_workflow_count}
              note={`${t.blocker_count} ${t.blocker_count === 1 ? 'blocker' : 'blockers'}`}
            />
            <StatTile label="Stale" value={t.stale_workflow_count} />
            <StatTile
              label="Overdue"
              value={t.overdue_workflow_count}
              note={
                t.longest_overdue_seconds
                  ? `longest ${formatSeconds(t.longest_overdue_seconds)}`
                  : undefined
              }
            />
            <StatTile
              label="SLA breached"
              value={t.sla_breached_workflow_count}
              note={`${t.sla_at_risk_workflow_count} at risk`}
            />
          </div>
        )}
        <SegmentedControl
          label="Attention reason"
          value={reason}
          options={REASON_FILTERS}
          onChange={setReason}
        />
        <InlinePhase
          phase={queryPhase({
            loading: queue.isPending,
            error: items.length ? undefined : queue.error,
            isEmpty: items.length === 0,
          })}
          error={queue.error}
          emptyMessage={`Nothing in ${scope} needs attention${reason ? ' for this reason' : ''}.`}
          onRetry={() => void queue.refetch()}
        />
        {items.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {items.map((e) => (
              <AttentionItem
                key={`${e.operation_id}:${e.state.workflow}:${e.state.instance_id}`}
                entry={e}
              />
            ))}
          </ul>
        )}
        {queue.hasNextPage && (
          <div>
            <Button
              size="sm"
              variant="outline"
              busy={queue.isFetchingNextPage}
              onClick={() => void queue.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function AttentionItem({ entry }: { entry: AttentionEntry }) {
  const s = entry.state;
  return (
    <li className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs [overflow-wrap:anywhere]">{subjectOf(entry)}</span>
        <span className="text-muted-foreground">
          {s.workflow} · <span className="font-mono text-xs">{s.state}</span>
        </span>
        {entry.reasons.map((r) => (
          <ReasonBadge key={r} reason={r} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Reported <Timestamp value={s.updated_at} />
        </span>
        {s.deadline_at && (
          <span>
            Due <Timestamp value={s.deadline_at} />
          </span>
        )}
        {entry.platform_tenant_id && (
          <span className="inline-flex items-center gap-1">
            Customer{' '}
            <CopyableId value={entry.platform_tenant_id} label="Customer ID" displayLength={8} />
          </span>
        )}
      </div>
      {(s.blockers?.length ?? 0) > 0 && (
        <ul className="flex flex-col gap-1.5 border-l border-border pl-3">
          {s.blockers!.map((b) => (
            <li key={`${b.operation}:${b.code}`} className="flex flex-col gap-0.5">
              <span>
                <span className="font-mono text-xs">{b.code}</span>
                {b.priority && b.priority !== 'normal' && (
                  <span
                    className="ml-2 text-xs"
                    style={{
                      color: b.priority === 'low' ? 'var(--chart-muted)' : 'var(--status-warning)',
                    }}
                  >
                    {b.priority}
                  </span>
                )}{' '}
                {b.description}
              </span>
              <span className="text-xs text-muted-foreground">
                Holds {b.operation} · {b.owner ? `owner ${b.owner}` : 'unassigned'}
                {b.next_action ? ` · next: ${b.next_action}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* --- Outcomes --------------------------------------------------------------- */

const GROUP_BY: { key: OutcomeGroupBy; label: string }[] = [
  { key: 'outcome', label: 'By outcome' },
  { key: 'workflow', label: 'By workflow' },
  { key: 'customer', label: 'By customer' },
];

function Outcomes({ slug, scope, workflow }: { slug: string; scope: string; workflow: string }) {
  const [groupBy, setGroupBy] = useState<OutcomeGroupBy>('outcome');
  const summary = useOutcomeSummary(slug, scope, workflow, groupBy);
  const recent = useOutcomes(slug, scope, workflow);
  const items = useMemo(() => recent.data?.pages.flatMap((p) => p.items) ?? [], [recent.data]);
  const rows = (summary.data?.groups ?? []).map((g) => ({
    id: g.value || '(none)',
    value: g.value,
    count: g.workflow_count,
  }));
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'value',
      label: GROUP_BY.find((g) => g.key === groupBy)!.label.replace('By ', ''),
      render: (r) =>
        groupBy === 'customer' && r.value ? (
          <CopyableId value={r.value} label="Customer ID" />
        ) : (
          <span className="font-mono text-xs">{r.value || '—'}</span>
        ),
    },
    { key: 'count', label: 'Workflows', numeric: true },
  ];
  return (
    <Panel
      title="Outcomes"
      description="Finished workflows that reported a business result, each counted once by its latest report. Finishing alone is not an outcome."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Group outcomes"
            value={groupBy}
            options={GROUP_BY}
            onChange={setGroupBy}
          />
          {summary.data && (
            <span className="text-sm text-muted-foreground">
              {summary.data.workflow_count} finished with an outcome
            </span>
          )}
        </div>
        <ResourceTable
          rows={rows}
          columns={columns}
          loading={summary.isPending}
          error={summary.error}
          onRetry={() => void summary.refetch()}
          initialSort={{ key: 'count', dir: 'desc' }}
          minWidth="min-w-0"
          emptyMessage={`No finished workflow in ${scope} reported an outcome.`}
        />
        {items.length > 0 && (
          <section aria-label="Latest outcomes" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Latest outcomes</h3>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
              {items.map((o) => (
                <li
                  key={`${o.operation_id}:${o.state.workflow}:${o.state.instance_id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
                >
                  <span className="font-mono text-xs [overflow-wrap:anywhere]">{subjectOf(o)}</span>
                  <span className="text-muted-foreground">{o.state.workflow}</span>
                  <span className="font-mono text-xs">{o.state.outcome_code ?? o.state.state}</span>
                  {o.state.outcome_description && (
                    <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                      {o.state.outcome_description}
                    </span>
                  )}
                  <Timestamp
                    value={o.state.updated_at}
                    className="ml-auto text-xs text-muted-foreground"
                  />
                </li>
              ))}
            </ul>
            {recent.hasNextPage && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  busy={recent.isFetchingNextPage}
                  onClick={() => void recent.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            )}
          </section>
        )}
        {!items.length && recent.error && (
          <InlinePhase
            phase={queryPhase({ error: recent.error })}
            error={recent.error}
            onRetry={() => void recent.refetch()}
          />
        )}
      </div>
    </Panel>
  );
}

/* --- Performance ------------------------------------------------------------ */

const EXCLUSION: Record<string, string> = {
  missing_start: 'start not retained',
  missing_latest: 'latest report missing',
  revision_gap: 'a revision is missing',
  duplicate_revision: 'a revision repeats',
  out_of_order_time: 'times out of order',
  future_observation: 'a report from the future',
  contract_changed: 'contract changed mid-way',
  state_discontinuity: 'states do not chain',
  history_window_truncated: 'history window truncated',
  verification_start_missing: 'verification start missing',
};

const pct = (d: Duration | undefined) =>
  d && d.workflow_count > 0
    ? `${formatSeconds(d.p50_seconds)} · ${formatSeconds(d.p95_seconds)}`
    : '—';

function Performance({ slug, scope, workflow }: { slug: string; scope: string; workflow: string }) {
  const q = usePerformanceSummary(slug, scope, workflow);
  return (
    <Panel
      title="Performance"
      description="How long the latest 100 finished and 100 ongoing instances spend in each state and blocked, as p50 · p95. Instances with gaps in their history are left out and counted."
    >
      {!workflow ? (
        <p className="text-sm text-muted-foreground">
          Name a workflow above to compare its instances.
        </p>
      ) : !q.data ? (
        <InlinePhase
          phase={queryPhase({ loading: q.isPending, error: q.error })}
          error={q.error}
          loadingMessage="Measuring the cohorts…"
          onRetry={() => void q.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <CohortFigures title="Finished" cohort={q.data.completed} />
            <CohortFigures title="Ongoing" cohort={q.data.ongoing} />
          </div>
          <Slowest
            slug={slug}
            scope={scope}
            workflow={workflow}
            token={q.data.cohort_token}
            onStale={() => void q.refetch()}
          />
        </div>
      )}
    </Panel>
  );
}

function CohortFigures({ title, cohort }: { title: string; cohort: PerformanceCohort }) {
  const states = cohort.states ?? [];
  const blockers = cohort.blockers ?? [];
  return (
    <section aria-label={`${title} instances`} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Measured"
          value={cohort.complete_history_workflow_count}
          note={`of ${cohort.matching_workflow_count} matching${cohort.cohort_truncated ? `, latest ${cohort.sampled_workflow_count}` : ''}`}
        />
        <StatTile
          label="SLA breached"
          value={cohort.sla_breached_workflow_count}
          note={`of ${cohort.sla_evaluated_workflow_count} with an SLA`}
        />
        <StatTile label="Time in states" value={pct(cohort.state_time)} note="p50 · p95" />
        <StatTile label="Time blocked" value={pct(cohort.blocked_time)} note="p50 · p95" />
      </div>
      {cohort.excluded_incomplete_workflow_count > 0 && (
        <p className="text-xs text-muted-foreground">
          Left out: {cohort.excluded_incomplete_workflow_count} (
          {(cohort.exclusions ?? [])
            .map((e) => `${e.workflow_count} ${EXCLUSION[e.reason] ?? e.reason}`)
            .join(', ')}
          ).
        </p>
      )}
      {states.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}: time by state</caption>
          <thead>
            <tr className="label-mono text-left text-muted-foreground">
              <th className="py-1.5 font-normal">State</th>
              <th className="py-1.5 text-right font-normal">Instances</th>
              <th className="py-1.5 text-right font-normal">p50 · p95</th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={`${s.contract_version}:${s.state}`} className="border-t border-border">
                <td className="py-1.5 font-mono text-xs">
                  {s.state} <span className="text-muted-foreground">v{s.contract_version}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{s.duration.workflow_count}</td>
                <td className="py-1.5 text-right tabular-nums">{pct(s.duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {blockers.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}: time blocked by blocker</caption>
          <thead>
            <tr className="label-mono text-left text-muted-foreground">
              <th className="py-1.5 font-normal">Blocker</th>
              <th className="py-1.5 text-right font-normal">p50 · p95</th>
            </tr>
          </thead>
          <tbody>
            {blockers.map((b) => (
              <tr
                key={`${b.contract_version}:${b.operation}:${b.code}:${b.owner}`}
                className="border-t border-border"
              >
                <td className="py-1.5">
                  <span className="font-mono text-xs">{b.code}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    holds {b.operation} · {b.owner || 'unassigned'}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{pct(b.duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const DIMENSIONS: { key: OverallDimension; label: string }[] = [
  { key: 'state_time', label: 'Time in states' },
  { key: 'blocked_time', label: 'Time blocked' },
  { key: 'verification_wait', label: 'Waiting for verification' },
];

function Slowest({
  slug,
  scope,
  workflow,
  token,
  onStale,
}: {
  slug: string;
  scope: string;
  workflow: string;
  token: string;
  onStale: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [cohort, setCohort] = useState<'completed' | 'ongoing'>('completed');
  const [dimension, setDimension] = useState<OverallDimension>('state_time');
  const q = usePerformanceInstances(
    slug,
    scope,
    workflow,
    cohort,
    dimension,
    open ? token : undefined
  );
  const stale =
    q.error instanceof ApiError && q.error.code === 'workflow_performance_cohort_changed';
  return (
    <section aria-label="Slowest instances" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-cohort`} className="text-xs text-muted-foreground">
            Instances
          </label>
          <Select
            id={`${id}-cohort`}
            value={cohort}
            onChange={(e) => setCohort(e.target.value as 'completed' | 'ongoing')}
          >
            <option value="completed">Finished</option>
            <option value="ongoing">Ongoing</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-dimension`} className="text-xs text-muted-foreground">
            Ranked by
          </label>
          <Select
            id={`${id}-dimension`}
            value={dimension}
            onChange={(e) => setDimension(e.target.value as OverallDimension)}
          >
            {DIMENSIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={open && q.isFetching}
        >
          Show slowest instances
        </Button>
      </div>
      {open &&
        (stale ? (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
            <span style={{ color: 'var(--status-warning)' }}>
              The instances changed since these figures were measured.
            </span>
            <Button size="sm" variant="ghost" onClick={onStale}>
              Measure again
            </Button>
          </p>
        ) : !q.data ? (
          <InlinePhase
            phase={queryPhase({ loading: q.isPending, error: q.error })}
            error={q.error}
            onRetry={() => void q.refetch()}
          />
        ) : q.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No measured instance contributes to this.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {q.data.items.map((i) => (
              <li
                key={`${i.operation_id}:${i.state.instance_id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
              >
                <span className="font-mono text-xs [overflow-wrap:anywhere]">{subjectOf(i)}</span>
                <span className="font-mono text-xs text-muted-foreground">{i.state.state}</span>
                <span className="ml-auto tabular-nums">{formatSeconds(i.observed_seconds)}</span>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
