import { useState, type ReactNode } from 'react';
import {
  Bell,
  CheckCircle,
  Clock,
  EditPencil,
  Hourglass,
  Prohibition,
  RefreshDouble,
  Trash,
  WarningTriangle,
  Xmark,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useBudget,
  useBudgetChannels,
  useBudgetRevisions,
  useOperationKey,
  useSetBudgetChannels,
} from '@/lib/api/budgets';
import { useApps } from '@/lib/api/queries';
import {
  BUDGET_LIMITS,
  LEVELS,
  METERS,
  budgetLevel,
  budgetRefusal,
  reasonText,
  type Budget,
  type BudgetAlert,
  type BudgetStop,
} from '@/lib/budgets';
import { ACCOUNT_CURRENCY, formatMillicents } from '@/lib/money';
import { CliCommand } from '../cli-command';
import { ChannelPicker, ChannelStatus, channelKindLabel } from '../notification-channels';
import { InlinePhase, Panel, queryPhase } from '../primitives';
import { ProblemHelp } from '../problem-help';
import {
  BudgetStatus,
  Fact,
  LevelLabel,
  SpendMeter,
  ToneLabel,
  type ScopeLabel,
} from './budget-bits';
import { BudgetForm } from './budget-form';
import { useBudgetSave } from './use-budget-save';

const GOOD = 'var(--status-good)';
const WARN = 'var(--status-warning)';
const BAD = 'var(--status-critical)';
const MUTED = 'var(--muted-foreground)';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <h3 className="label-mono text-foreground">{title}</h3>
      {children}
    </section>
  );
}

const ALERT_STATE = {
  pending: { label: 'Pending', color: MUTED, icon: Clock },
  sending: { label: 'Sending', color: WARN, icon: RefreshDouble },
  retrying: { label: 'Retrying', color: WARN, icon: RefreshDouble },
  delivered: { label: 'Delivered', color: GOOD, icon: CheckCircle },
} as const;

/** One threshold or projected-overrun alert and its email delivery. */
function AlertRow({ alert }: { alert: BudgetAlert }) {
  const state = ALERT_STATE[alert.state] ?? ALERT_STATE.pending;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-col">
        <span className="[font-variant-numeric:tabular-nums]">
          {alert.kind === 'projection'
            ? `Projected to pass ${formatMillicents(alert.threshold_millicents)}`
            : `Passed ${formatMillicents(alert.threshold_millicents)}`}
        </span>
        <span className="text-xs text-muted-foreground">
          {alert.evaluation.known_millicents !== undefined &&
            `${formatMillicents(alert.evaluation.known_millicents)} known`}
          {!alert.evaluation.coverage_complete && ' · partial coverage'}
          {alert.kind === 'projection' && ' · an estimate; it never stops anything'}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 text-xs">
        <ToneLabel tone={state} />
        <span className="text-muted-foreground">
          {alert.state === 'delivered' ? (
            <Timestamp value={alert.delivered_at} />
          ) : (
            <>
              {alert.attempts} attempt{alert.attempts === 1 ? '' : 's'} · next{' '}
              <Timestamp value={alert.next_attempt_at} />
            </>
          )}
        </span>
        {alert.last_error && (
          <span style={{ color: BAD }}>
            {alert.last_error === 'mail_delivery_failed'
              ? 'Email delivery failed'
              : alert.last_error}
          </span>
        )}
      </span>
    </li>
  );
}

const TARGET_STATE = {
  requested: { label: 'Requested', color: WARN, icon: Clock },
  draining: { label: 'Draining', color: WARN, icon: Hourglass },
  enforced: { label: 'Stopped', color: GOOD, icon: CheckCircle },
  failed: { label: 'Failed', color: BAD, icon: WarningTriangle },
  unavailable: { label: 'Unknown', color: MUTED, icon: Clock },
} as const;

const TARGET_ERROR: Record<string, string> = {
  runtime_identity_unavailable: 'Its runtime identity could not be read.',
  vm_teardown_failed: 'Tearing down its VM failed; it is retried.',
  instance_settlement_failed: 'Its instances could not be settled.',
  scheduler_observation_stale: 'The scheduler has not reported on it recently.',
};

/**
 * A recorded automatic stop and what the scheduler has confirmed for each
 * preview. A decision or an email alone is not proof of shutdown: only
 * `enforced` is (docs/billing.md "Monitored preview stopping").
 */
function StopSection({ stop }: { stop: BudgetStop }) {
  const apps = useApps();
  const slug = (id: string) => apps.data?.find((app) => app.id === id)?.slug ?? id.slice(0, 8);
  return (
    <Section title="Automatic stop">
      <p className="text-sm">
        Recorded <Timestamp value={stop.requested_at} /> at{' '}
        {stop.evaluation.known_millicents !== undefined
          ? formatMillicents(stop.evaluation.known_millicents)
          : 'an unknown amount'}{' '}
        known. New requests to these previews are refused; the drain ended{' '}
        <Timestamp value={stop.drain_deadline} />.{' '}
        {stop.resume_rule === 'next_period'
          ? 'It lifts at the start of the next UTC month.'
          : 'It stays until this budget is edited, turned off or deleted.'}
      </p>
      {stop.targets.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {stop.targets.map((target) => {
            const state = TARGET_STATE[target.state] ?? TARGET_STATE.unavailable;
            return (
              <li
                key={`${target.app_id}-${target.environment_id ?? ''}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="min-w-0 font-mono break-all">{slug(target.app_id)}</span>
                <span className="flex flex-col items-end gap-0.5 text-xs">
                  <ToneLabel tone={state} />
                  <span className="text-muted-foreground">
                    {target.resident_count} resident · <Timestamp value={target.observed_at} />
                  </span>
                  {target.last_error && (
                    <span style={{ color: target.state === 'failed' ? BAD : MUTED }}>
                      {TARGET_ERROR[target.last_error] ?? target.last_error}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No preview has reported yet. A decision alone is not proof that anything stopped.
        </p>
      )}
    </Section>
  );
}

function ComputeSection({ budget }: { budget: Budget }) {
  const compute = budget.runtime?.compute;
  if (!compute) return null;
  return (
    <Section title="Funding this month">
      <p className="text-xs text-muted-foreground">
        A conservative admission ledger, not an invoice: commitments include startup and round up,
        so they can run ahead of billed compute.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Committed">{formatMillicents(compute.committed_millicents)}</Fact>
        <Fact label="Reserved">{formatMillicents(compute.reserved_millicents)}</Fact>
        <Fact label="Remaining">{formatMillicents(compute.remaining_millicents)}</Fact>
        <Fact label="State">
          {compute.held ? (
            <ToneLabel tone={{ label: 'Held', color: BAD, icon: Prohibition }} />
          ) : compute.initialized ? (
            <ToneLabel tone={{ label: 'Funding', color: GOOD, icon: CheckCircle }} />
          ) : (
            <ToneLabel tone={{ label: 'Not started', color: MUTED, icon: Clock }} />
          )}
        </Fact>
      </dl>
      {compute.egress && (
        <p className="text-xs text-muted-foreground">
          Egress: {formatMillicents(compute.egress.committed_millicents)} committed,{' '}
          {formatMillicents(compute.egress.reserved_millicents)} reserved.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {compute.unconfirmed_leases} unconfirmed VM attempt
        {compute.unconfirmed_leases === 1 ? '' : 's'} · observed{' '}
        <Timestamp value={compute.observed_at} />
      </p>
    </Section>
  );
}

/**
 * The notification channels a budget's alerts also go to. They are not part
 * of the spec, so a change is not a revision (ADR-20261019193500).
 */
function BudgetChannels({ accountId, budget }: { accountId: string; budget: Budget }) {
  const channels = useBudgetChannels(accountId, budget.id);
  const set = useSetBudgetChannels(accountId);
  const { keyFor, settle } = useOperationKey();
  const { toast } = useToast();
  const [editing, setEditing] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const list = channels.data ?? [];
  const phase = queryPhase({
    error: channels.error,
    loading: channels.isPending,
    isEmpty: !list.length,
  });
  const strict = budget.spec.mode === 'strict';

  const save = async () => {
    if (!editing) return;
    setFailure(null);
    try {
      await set.mutateAsync({
        id: budget.id,
        channelIds: editing,
        key: keyFor(JSON.stringify([budget.id, [...editing].sort()])),
      });
      settle();
      setEditing(null);
      toast({ kind: 'success', title: 'Alert channels saved' });
    } catch (error) {
      settle(error);
      setFailure(error);
    }
  };

  return (
    <Section title="Alert channels">
      <p className="text-xs text-muted-foreground">
        {strict
          ? 'A strict cap sends no alerts, so channels here receive nothing unless it becomes an alerting budget.'
          : 'Alerts always go to the account email. Channels here get each threshold and projected overrun too, retried with backoff for up to 12 attempts.'}
      </p>
      {editing ? (
        <div className="flex flex-col gap-3">
          <ChannelPicker
            value={editing}
            onChange={setEditing}
            idPrefix={`budget-${budget.id}`}
            limitNote={`A budget delivers to at most ${BUDGET_LIMITS.channels} channels.`}
          />
          {failure !== null && (
            <div role="alert" className="flex flex-col gap-1 text-xs">
              <span style={{ color: BAD }}>{budgetRefusal(failure, undefined).message}</span>
              <ProblemHelp error={failure} className="[&_code]:break-all" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" busy={set.isPending} onClick={() => void save()}>
              Save channels
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : phase !== 'ready' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <InlinePhase
            phase={phase}
            error={channels.error}
            loadingMessage="Reading channels…"
            emptyMessage="Only the account email."
            onRetry={() => void channels.refetch()}
          />
          {phase === 'empty' && (
            <Button size="xs" variant="outline" className="gap-1" onClick={() => setEditing([])}>
              <Bell className="h-3.5 w-3.5" />
              Add channels
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul
            aria-label="Budget alert channels"
            className="flex flex-col divide-y divide-border rounded-md border border-border"
          >
            {list.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
              >
                <span className="flex min-w-0 items-baseline gap-2 text-sm">
                  <span className="font-mono">{channel.name}</span>
                  <span className="label-mono text-muted-foreground">
                    {channelKindLabel(channel.kind)}
                  </span>
                </span>
                <ChannelStatus channel={channel} />
              </li>
            ))}
          </ul>
          <div>
            <Button
              size="xs"
              variant="outline"
              className="gap-1"
              onClick={() => setEditing(list.map((c) => c.id))}
            >
              <EditPencil className="h-3.5 w-3.5" />
              Change channels
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

const MUTATION = { created: 'Created', updated: 'Updated', deleted: 'Deleted' } as const;

function BudgetHistory({ accountId, id }: { accountId: string; id: string }) {
  const history = useBudgetRevisions(accountId, id);
  const rows = history.data?.pages.flatMap((page) => page.revisions) ?? [];
  const phase = queryPhase({
    error: history.error,
    loading: history.isPending,
    isEmpty: !rows.length,
  });
  return (
    <Section title="History">
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={history.error}
          loadingMessage="Reading revisions…"
          emptyMessage="No revisions recorded."
          onRetry={() => void history.refetch()}
        />
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
            {rows.map((row) => {
              const level = budgetLevel(row.spec);
              return (
                <li
                  key={row.revision}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span>
                      Revision {row.revision} · {MUTATION[row.mutation] ?? row.mutation}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {level === 'api' ? row.spec.action.replace(/_/g, ' ') : LEVELS[level].label} ·{' '}
                      {formatMillicents(row.spec.limit_millicents)} ·{' '}
                      {row.spec.enabled ? 'on' : 'draft'}
                    </span>
                  </span>
                  <span className="flex flex-col items-end text-xs text-muted-foreground">
                    <Timestamp value={row.recorded_at} />
                    <span className="font-mono break-all">{row.actor}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {history.hasNextPage && (
            <div>
              <Button
                size="xs"
                variant="outline"
                busy={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                Load later revisions
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const meterNames = (meters: string[]) =>
  meters.map((m) => METERS.find((x) => x.meter === m)?.label ?? m).join(', ');

/**
 * One budget in full: intent, readiness, this month's evaluation, alerts and
 * their delivery, a recorded stop or the strict funding book, channels and
 * history. Read from `GET /v1/billing/budgets/{id}`, which also answers for a
 * deleted budget, so its tombstone and history stay readable here.
 */
export function BudgetDetail({
  accountId,
  id,
  scopeLabel,
  strictRefused,
  onStrictRefused,
  onDelete,
  onClose,
}: {
  accountId: string;
  id: string;
  scopeLabel: ScopeLabel;
  strictRefused: boolean;
  onStrictRefused: () => void;
  onDelete: (budget: Budget) => void;
  onClose: () => void;
}) {
  const query = useBudget(accountId, id);
  const { save, pending } = useBudgetSave(accountId, scopeLabel);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; message: string } | null>(null);
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  const budget = query.data;

  if (phase !== 'ready' || !budget)
    return (
      <Panel title="Budget">
        <InlinePhase
          phase={phase}
          error={query.error}
          loadingMessage="Reading the budget…"
          onRetry={() => void query.refetch()}
        />
      </Panel>
    );

  const spec = budget.spec;
  const level = budgetLevel(spec);
  const deleted = budget.status === 'deleted';
  const evaluation = budget.runtime?.evaluation;
  const alerts = [
    ...(budget.runtime?.alerts ?? []),
    ...(budget.runtime?.projection ? [budget.runtime.projection] : []),
  ];
  // Turning on is offered only where apid can activate: never an API-only
  // intent, and never a strict cap apid has refused for this account.
  const canTurnOn = !spec.enabled && level !== 'api' && !(level === 'strict' && strictRefused);

  const toggle = async () => {
    setFailure(null);
    const outcome = await save({ ...spec, enabled: !spec.enabled }, budget);
    if (outcome.kind === 'refused') {
      if (outcome.strictNotReleased) onStrictRefused();
      setFailure(outcome);
    } else if (outcome.kind === 'saved')
      toast({
        kind: 'success',
        title: outcome.budget.spec.enabled ? `${spec.name} turned on` : `${spec.name} turned off`,
        description: outcome.budget.spec.enabled
          ? undefined
          : 'A stop it placed is released; a teardown already under way may finish.',
      });
  };

  return (
    <Panel
      title={spec.name}
      description={`${scopeLabel(spec.scope)} · revision ${budget.revision}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {!deleted && !editing && (
            <>
              {level !== 'api' && (
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setEditing(true)}
                >
                  <EditPencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
              {(spec.enabled || canTurnOn) && (
                <Button size="xs" variant="outline" busy={pending} onClick={() => void toggle()}>
                  {spec.enabled ? 'Turn off' : 'Turn on'}
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                className="gap-1"
                onClick={() => onDelete(budget)}
              >
                <Trash className="h-3.5 w-3.5" />
                Delete
              </Button>
            </>
          )}
          <button
            type="button"
            aria-label="Close budget details"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Xmark className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BudgetStatus budget={budget} />
          <LevelLabel spec={spec} />
          <CopyableId value={budget.id} label="budget ID" />
          {deleted && (
            <span className="text-xs text-muted-foreground">
              Deleted <Timestamp value={budget.deleted_at} />. Its history is kept.
            </span>
          )}
        </div>

        {failure && (
          <div role="alert" className="flex flex-col gap-1 text-sm">
            <span style={{ color: BAD }}>{failure.message}</span>
            <ProblemHelp error={failure.error} className="[&_code]:break-all" />
          </div>
        )}

        {editing ? (
          <BudgetForm
            accountId={accountId}
            budget={budget}
            scopeLabel={scopeLabel}
            strictRefused={strictRefused}
            onStrictRefused={onStrictRefused}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Fact label="Response">
                {level === 'api' ? 'Set through the API' : LEVELS[level].label}
              </Fact>
              <Fact label="Limit">{formatMillicents(spec.limit_millicents)} a month</Fact>
              <Fact label="Alerts at">
                {spec.mode === 'strict'
                  ? 'None: strict caps send no alerts'
                  : [...new Set([...spec.notify_millicents, spec.limit_millicents])]
                      .sort((a, b) => a - b)
                      .map(formatMillicents)
                      .join(', ')}
              </Fact>
              <Fact label="Meters">{meterNames(spec.meters)}</Fact>
              <Fact label="Counts">
                {spec.basis === 'net_usage' ? 'After the allowance' : 'Before the allowance'}
              </Fact>
              {level !== 'alert' && (
                <Fact label="Lifts">
                  {spec.resume_rule === 'next_period' ? 'Next UTC month' : 'When changed'}
                  {spec.action === 'stop_previews' && ` · ${spec.drain_seconds}s drain`}
                </Fact>
              )}
            </dl>
            {spec.currency !== ACCOUNT_CURRENCY && (
              <p className="text-xs text-muted-foreground">
                Recorded in {spec.currency}; amounts are shown as stored, not converted.
              </p>
            )}
            {level === 'api' && (
              <CliCommand
                label="This response is authored through the API or CLI, and apid keeps it as a draft."
                command={`gregale billing budgets get ${budget.id}`}
                copyLabel={`get command for ${spec.name}`}
              />
            )}
          </>
        )}

        {!deleted && (
          <>
            <Section title="This month">
              {evaluation ? (
                <>
                  <SpendMeter
                    known={evaluation.known_millicents}
                    limit={spec.limit_millicents}
                    projected={evaluation.projected_millicents}
                    label={`${spec.name}: known spending against the limit`}
                  />
                  <p className="text-xs text-muted-foreground">
                    {evaluation.projected_millicents !== undefined
                      ? `Projected month end: ${formatMillicents(evaluation.projected_millicents)} at this month's rate. An estimate, not an invoice.`
                      : `No projection yet${evaluation.projection_reason ? `: ${reasonText(evaluation.projection_reason).toLowerCase()}` : ''}.`}{' '}
                    {evaluation.coverage_complete
                      ? ''
                      : 'Coverage is partial, so the total may be higher. '}
                    {evaluation.fresh ? '' : 'The evidence is stale. '}
                    Evaluated <Timestamp value={evaluation.evaluated_at} />.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {spec.enabled
                    ? 'Not evaluated yet this month.'
                    : 'A draft is not evaluated. Turn it on, or preview it, to see this month.'}
                </p>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <ToneLabel
                  tone={
                    budget.notification_ready
                      ? { label: 'Alerts ready', color: GOOD, icon: CheckCircle }
                      : { label: 'Alerts off', color: MUTED, icon: Bell }
                  }
                />
                {level !== 'alert' && (
                  <ToneLabel
                    tone={
                      budget.enforcement_ready
                        ? { label: 'Stopping ready', color: GOOD, icon: CheckCircle }
                        : { label: 'Stopping not ready', color: MUTED, icon: Clock }
                    }
                  />
                )}
              </div>
              {budget.reasons.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
                  {budget.reasons.map((reason) => (
                    <li key={reason}>{reasonText(reason)}</li>
                  ))}
                </ul>
              )}
            </Section>

            {spec.mode !== 'strict' && (
              <Section title="Alerts this month">
                {alerts.length ? (
                  <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {alerts.map((alert) => (
                      <AlertRow key={alert.id} alert={alert} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No threshold passed this month for revision {budget.revision}.
                  </p>
                )}
              </Section>
            )}

            {budget.runtime?.stops?.map((stop) => (
              <StopSection key={stop.id} stop={stop} />
            ))}
            <ComputeSection budget={budget} />
            <BudgetChannels accountId={accountId} budget={budget} />
          </>
        )}
        <BudgetHistory accountId={accountId} id={budget.id} />
      </div>
    </Panel>
  );
}
