import { useState, type FormEvent } from 'react';
import { CheckCircle, Circle, Plus, Trash, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useAppSLOs } from '@/lib/api/alert-rules';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAlerts } from '@/lib/api/queries';
import {
  useCreateSLO,
  useDeleteSLO,
  useSLOStatuses,
  type CreateSLO,
  type SLO,
  type SLOStatus,
} from '@/lib/api/slos';
import { AlertState } from './alert-detail';
import { describeCondition } from './alert-metrics';
import { AlertRuleForm } from './alert-rule-form';
import { CapabilityGate } from './capability-gate';
import { MaturityLabel } from './maturity-label';
import { PlanGated, isPlanGate } from './plan-gated';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  StatTile,
  UnreachableState,
  queryPhase,
} from './primitives';
import { ProblemHelp } from './problem-help';
import { StatusTag, type Tone } from './postgres-shared';

/** apid's closed sets and bounds (faas pkg/api/slos.go:21, 92-116; limits.go MaxSLOsPerApp). */
export const SLO_LIMIT = 10;
type Threshold = NonNullable<CreateSLO['latency_threshold_ms']>;
export const LATENCY_THRESHOLDS_MS: Threshold[] = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000,
];
const NAME = /^[a-z][a-z0-9_-]{0,62}$/;

/** "99.9% available" or "99.5% within 250 ms", the CLI's wording (commands_slos_status.go:42). */
export function describeObjective(
  slo: Pick<SLO, 'sli' | 'objective_pct' | 'latency_threshold_ms'>
) {
  return slo.sli === 'latency'
    ? `${slo.objective_pct}% within ${slo.latency_threshold_ms ?? '?'} ms`
    : `${slo.objective_pct}% available`;
}

/** A percentage as the CLI prints it, or why there is none (commands_slos_status.go:62-67). */
export function formatPct(value: number | null | undefined): string {
  return value == null ? 'No traffic' : `${value.toFixed(3)}%`;
}

/** A burn rate as the CLI prints it: 1× spends exactly the budget over the window. */
export function formatBurn(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(2)}×`;
}

/**
 * No hour of the window has closed yet. meterd records each hour after it
 * ends, so until then the totals are zero although the app may be serving
 * traffic; "no traffic" would misread that (faas pkg/api/slos.go:63-85).
 */
export function pendingWindow(status: SLOStatus): string | undefined {
  if (status.hours_recorded > 0) return undefined;
  const start = Date.parse(status.window_start);
  if (Number.isNaN(start)) return undefined;
  const closes = new Date(start + 3_600_000).toISOString().slice(11, 16);
  return status.hours_expected > 0
    ? `The first hour closed at ${closes} UTC and is being recorded.`
    : `The first hour closes at ${closes} UTC.`;
}

/**
 * Where the budget stands, from the figures alone (docs/slos.md § Check the
 * error budget): 100% when nothing failed, 0% when it is spent, negative once
 * the objective is missed. A burn rate above 1× spends the budget before the
 * window ends.
 */
export function budgetState(status: SLOStatus | undefined): { tone: Tone; label: string } {
  if (!status) return { tone: 'muted', label: 'Reading budget' };
  if (pendingWindow(status)) return { tone: 'muted', label: 'First hour pending' };
  const left = status.budget_remaining_pct;
  if (left == null) return { tone: 'muted', label: 'No traffic' };
  if (left < 0) return { tone: 'critical', label: 'Objective missed' };
  if (left === 0) return { tone: 'critical', label: 'Budget spent' };
  if ((status.burn_rate_1h ?? 0) > 1 && (status.burn_rate_6h ?? 0) > 1)
    return { tone: 'warning', label: 'Burning faster than budget' };
  return { tone: 'good', label: 'Within budget' };
}

const TONE_ICON = {
  good: CheckCircle,
  warning: WarningTriangle,
  critical: WarningTriangle,
  muted: Circle,
} as const;

function BudgetTag({ status }: { status: SLOStatus | undefined }) {
  const { tone, label } = budgetState(status);
  return (
    <StatusTag tone={tone} icon={TONE_ICON[tone]}>
      {label}
    </StatusTag>
  );
}

/** A create failure in words, branched on apid's codes (faas pkg/api/slos.go, handlers_slos.go). */
export function explainSLOError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'slo_limit_reached':
      return `This app already has ${SLO_LIMIT} SLOs. Delete one to add another.`;
    case 'slo_invalid':
      return err.status === 409
        ? 'This app already has an SLO with that name.'
        : (err.detail ?? err.message);
    case 'plan_per_app_metrics_not_allowed':
      return 'SLOs are available on Hobby and above.';
    default:
      return errorMessage(err);
  }
}

/**
 * An app's SLOs and error budgets (faas ADR-747, docs/slos.md): availability
 * or latency objectives over a rolling 7- or 30-day window, each with the
 * budget left and its live burn rate, the alert rules that watch it, and the
 * form that defines a new one. The tab is gated on `custom-slos`.
 *
 * Every figure is a scalar from GET /v1/apps/{slug}/slos/{id}; the API keeps
 * no budget series, so nothing here is charted.
 */
export function SlosBody({ slug }: { slug: string }) {
  const { capability } = useCapability('custom-slos');
  const list = useAppSLOs(slug, true);
  const slos = list.data ?? [];
  const statuses = useSLOStatuses(
    slug,
    slos.map((s) => s.id)
  );
  const [selectedId, setSelectedId] = useState<string>();
  const selectedIndex = slos.findIndex((s) => s.id === selectedId);
  const index = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = slos[index];
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: slos.length === 0,
  });

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label="SLOs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            SLOs <MaturityLabel capability={capability} />
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            An objective for how reliable {slug} should be, and the error budget it leaves: the
            failures you can afford before the objective is missed. Every app also keeps the fixed
            99.5% availability panel on its Metrics tab; define your own for a different target, a
            latency goal or a 30-day budget.
          </p>
        </div>
      </div>

      <PlanGated error={list.error} feature="SLOs">
        <Panel
          title="Your SLOs"
          description={`Budget left over each SLO’s window and its current burn rate. ${slos.length} of ${SLO_LIMIT} defined.`}
          padded={phase !== 'ready'}
        >
          {phase === 'unreachable' ? (
            <UnreachableState onRetry={() => void list.refetch()} />
          ) : phase === 'error' ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : phase === 'loading' ? (
            <LoadingState message="Reading SLOs…" />
          ) : phase === 'empty' ? (
            <EmptyState message={`${slug} has no SLOs yet. Define one below.`} />
          ) : (
            <ul className="divide-y divide-border">
              {slos.map((slo, i) => {
                const status = statuses[i]?.data?.status;
                const read = statuses[i];
                const current = i === index;
                return (
                  <li key={slo.id}>
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => setSelectedId(slo.id)}
                      className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-left transition-colors hover:bg-muted/40 ${current ? 'bg-muted/40' : ''}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{slo.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {describeObjective(slo)} over {slo.window_days} days
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-3 text-xs">
                        {read?.error ? (
                          <span style={{ color: 'var(--status-critical)' }}>
                            Status unavailable
                          </span>
                        ) : (
                          <>
                            <span className="font-mono [font-variant-numeric:tabular-nums]">
                              {status && !pendingWindow(status)
                                ? `${formatPct(status.budget_remaining_pct)} left`
                                : ''}
                            </span>
                            <span className="font-mono text-muted-foreground [font-variant-numeric:tabular-nums]">
                              {status ? `${formatBurn(status.burn_rate_1h)} (1h)` : ''}
                            </span>
                            <BudgetTag status={status} />
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {selected && (
          <SloDetail
            key={selected.id}
            slug={slug}
            slo={selected}
            read={statuses[index]}
            onDeleted={() => setSelectedId(undefined)}
          />
        )}

        <Panel
          lit
          title="Define an SLO"
          description="Availability counts non-5xx responses among 2xx and 5xx (a 4xx is the client’s error and does not count). Latency counts requests that finish within the threshold."
        >
          <SloForm
            slug={slug}
            full={slos.length >= SLO_LIMIT}
            onCreated={(slo) => setSelectedId(slo.id)}
          />
        </Panel>
      </PlanGated>
    </section>
  );
}

function SloDetail({
  slug,
  slo,
  read,
  onDeleted,
}: {
  slug: string;
  slo: SLO;
  read: ReturnType<typeof useSLOStatuses>[number] | undefined;
  onDeleted: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const remove = useDeleteSLO(slug);
  const status = read?.data?.status;
  const pending = status ? pendingWindow(status) : undefined;
  const degraded = status && status.source !== 'prometheus' ? status.source : undefined;
  const phase = queryPhase({ error: read?.error, loading: !read || read.isPending });

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete SLO ${slo.name}?`,
        description:
          'Its budget history goes with it, and so does every alert rule that watches it. Release gates that judge this SLO must be removed first.',
        confirmLabel: 'Delete SLO',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(slo.id);
      toast({ kind: 'success', title: `Deleted ${slo.name}` });
      onDeleted();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete the SLO', error: err });
    }
  };

  return (
    <Panel
      title={slo.name}
      description={`${describeObjective(slo)} over ${slo.window_days} days`}
      actions={
        <span className="flex items-center gap-3">
          <CopyableId value={slo.id} label="SLO ID" />
          <Button
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => void onDelete()}
          >
            <Trash aria-hidden className="h-3.5 w-3.5" />
            Delete
          </Button>
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        {phase !== 'ready' || !status ? (
          <InlinePhase
            phase={phase === 'ready' ? 'loading' : phase}
            error={read?.error}
            loadingMessage="Reading the error budget…"
            onRetry={() => void read?.refetch()}
          />
        ) : (
          <>
            {pending && (
              <p role="status" className="text-sm text-muted-foreground">
                {pending} Budget figures start once it is recorded; the burn rates are live.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Attained"
                value={pending ? 'Pending' : formatPct(status.attainment_pct)}
                note={
                  pending
                    ? undefined
                    : `${status.good.toLocaleString()} of ${status.total.toLocaleString()} requests`
                }
              />
              <StatTile
                label="Budget remaining"
                value={pending ? 'Pending' : formatPct(status.budget_remaining_pct)}
              />
              <StatTile
                label="Burn rate, 1h"
                value={formatBurn(status.burn_rate_1h)}
                note="1× spends the budget exactly over the window"
              />
              <StatTile label="Burn rate, 6h" value={formatBurn(status.burn_rate_6h)} />
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <BudgetTag status={status} />
              <span>
                History: {status.hours_recorded} of {status.hours_expected} hours since{' '}
                <Timestamp value={status.window_start} mode="absolute" />.
              </span>
              {status.hours_recorded < status.hours_expected && !pending && (
                <span>
                  Missing hours are recovered for up to 14 days; older gaps are left out, not
                  guessed.
                </span>
              )}
            </p>
            {degraded && (
              <p role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
                <WarningTriangle
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: 'var(--status-warning)' }}
                />
                Telemetry: <span className="font-mono">{degraded}</span>
              </p>
            )}
          </>
        )}
        <CapabilityGate capability="alerts" title="Alerts on this SLO">
          <SloAlerts slug={slug} slo={slo} />
        </CapabilityGate>
      </div>
    </Panel>
  );
}

/**
 * The rules that name this SLO (`slo_id`, faas #300) and a form already
 * pointed at it. The fast-burn page is the documented starting point
 * (docs/slos.md § Alert on an SLO): both the last hour and the last six hours
 * at 14.4× the sustainable rate.
 */
function SloAlerts({ slug, slo }: { slug: string; slo: SLO }) {
  const alerts = useAlerts(slug);
  const rules = (alerts.data ?? []).filter((rule) => rule.slo_id === slo.id);
  const [adding, setAdding] = useState(false);
  const phase = queryPhase({
    error: alerts.error,
    loading: alerts.isPending,
    isEmpty: rules.length === 0,
  });
  return (
    <section aria-label="Alerts on this SLO" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Alerts on this SLO</h3>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add an alert
          </Button>
        )}
      </div>
      {phase === 'ready' ? (
        <ul className="flex flex-col gap-1.5">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{rule.name}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {describeCondition(rule)}
                </span>
                <AlertState state={rule.state} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <InlinePhase
          phase={phase}
          error={alerts.error}
          loadingMessage="Reading alert rules…"
          emptyMessage="No alert rule watches this SLO. Deleting the SLO deletes its rules."
          onRetry={() => void alerts.refetch()}
        />
      )}
      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">
            Starts as the fast-burn page: it fires only when both the last hour and the last six
            hours burn at more than 14.4× the sustainable rate. For a slow leak, pick “SLO budget
            remaining” below 25 instead. The window is ignored; the SLO sets it.
          </p>
          <AlertRuleForm
            slug={slug}
            initial={{
              metric: 'slo_budget_burn',
              comparison: 'gt',
              threshold: '14.4',
              sloId: slo.id,
            }}
            onCreated={() => setAdding(false)}
          />
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}

type Field = 'name' | 'objective';

/** The create checks apid makes, so a typo is caught before the round trip (pkg/api/slos.go:92-116). */
export function sloFormErrors(name: string, objective: string): Record<Field, string | undefined> {
  const value = Number(objective);
  const bp = Math.round(value * 100);
  return {
    name: NAME.test(name)
      ? undefined
      : 'Start with a lowercase letter; then lowercase letters, digits, - or _ (63 at most).',
    objective:
      objective.trim() === '' ||
      !Number.isFinite(value) ||
      Math.abs(bp - value * 100) > 1e-6 ||
      bp < 9000 ||
      bp > 9999
        ? 'Enter a percentage from 90 to 99.99, with at most two decimals.'
        : undefined,
  };
}

function SloForm({
  slug,
  full,
  onCreated,
}: {
  slug: string;
  full: boolean;
  onCreated: (slo: SLO) => void;
}) {
  const { toast } = useToast();
  const create = useCreateSLO(slug);
  const [name, setName] = useState('');
  const [sli, setSli] = useState<CreateSLO['sli']>('availability');
  const [threshold, setThreshold] = useState<Threshold>(250);
  const [objective, setObjective] = useState('99.9');
  const [windowDays, setWindowDays] = useState<CreateSLO['window_days']>(30);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = sloFormErrors(name, objective);
  const shown = (field: Field) => (attempted ? errors[field] : undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (errors.name || errors.objective || create.isPending || full) return;
    setFailure(undefined);
    const body: CreateSLO = {
      name,
      sli,
      objective_pct: Number(objective),
      window_days: windowDays,
      ...(sli === 'latency' ? { latency_threshold_ms: threshold } : {}),
    };
    try {
      const slo = await create.mutateAsync(body);
      toast({ kind: 'success', title: `Defined ${slo.name}` });
      setName('');
      setAttempted(false);
      onCreated(slo);
    } catch (err) {
      setFailure(err);
    }
  };

  if (isPlanGate(failure))
    return (
      <PlanGated error={failure} feature="SLOs">
        {null}
      </PlanGated>
    );

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <span className="label-mono text-muted-foreground">Name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="checkout"
            maxLength={63}
            className={`${FIELD} font-mono`}
            {...fieldErrorProps(shown('name'), 'slo-name-error')}
          />
          {shown('name') && <FieldError id="slo-name-error">{shown('name')}</FieldError>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Indicator</span>
          <select
            value={sli}
            onChange={(e) => setSli(e.target.value as CreateSLO['sli'])}
            className={FIELD}
          >
            <option value="availability">Availability</option>
            <option value="latency">Latency</option>
          </select>
        </label>
        {sli === 'latency' && (
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Within</span>
              <select
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) as Threshold)}
                className={`${FIELD} font-mono`}
                aria-describedby="slo-threshold-help"
              >
                {LATENCY_THRESHOLDS_MS.map((ms) => (
                  <option key={ms} value={ms}>
                    {ms} ms
                  </option>
                ))}
              </select>
            </label>
            <span id="slo-threshold-help" className="text-xs text-muted-foreground">
              The gateway’s histogram buckets, so attainment is exact.
            </span>
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Objective (%)</span>
          <input
            name="objective"
            type="number"
            min={90}
            max={99.99}
            step={0.01}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
            {...fieldErrorProps(shown('objective'), 'slo-objective-error')}
          />
          {shown('objective') && (
            <FieldError id="slo-objective-error">{shown('objective')}</FieldError>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Window</span>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) as CreateSLO['window_days'])}
            className={FIELD}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
      </div>
      {failure !== undefined && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--status-critical)' }}>{explainSLOError(failure)}</span>
          <ProblemHelp error={failure} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={create.isPending || full}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {create.isPending ? 'Defining…' : 'Define SLO'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {full
            ? `An app can hold ${SLO_LIMIT} SLOs; delete one to add another.`
            : 'A new SLO’s window starts at the hour it is created and grows to the full window.'}
        </span>
      </div>
    </form>
  );
}
