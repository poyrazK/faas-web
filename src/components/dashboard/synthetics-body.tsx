import { useState, type FormEvent } from 'react';
import {
  CheckCircle,
  Circle,
  Pause,
  PauseSolid,
  Play,
  Plus,
  Trash,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useAppSyntheticChecks } from '@/lib/api/alert-rules';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAlerts } from '@/lib/api/queries';
import {
  useCreateSyntheticCheck,
  useDeleteSyntheticCheck,
  useSetSyntheticCheckEnabled,
  useSyntheticResults,
  type CreateSyntheticCheck,
  type SyntheticCheck,
  type SyntheticResults,
  type SyntheticRun,
} from '@/lib/api/synthetics';
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

/** apid's bounds (faas pkg/api/synthetic_checks.go:81-104; limits.go MaxSyntheticChecksPerApp). */
export const CHECK_LIMIT = 5;
const NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const PATH = /^\/([^/\s\\][^\s\\]*)?$/;
type Interval = CreateSyntheticCheck['interval_seconds'];
const INTERVALS: { value: Interval; label: string }[] = [
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 3600, label: 'Every 60 minutes' },
];

export function everyLabel(seconds: number): string {
  return `every ${Math.round(seconds / 60)} minutes`;
}

export function expectation(check: Pick<SyntheticCheck, 'expected_status'>): string {
  return check.expected_status ? `expecting ${check.expected_status}` : 'expecting any 2xx';
}

const FAILURE: Record<NonNullable<SyntheticRun['error_class']>, string> = {
  status: 'unexpected status',
  timeout: 'timed out',
  dns: 'DNS failed',
  connect: 'could not connect',
  tls: 'TLS failed',
  other: 'failed',
};

/** One run in words: "OK" or why it failed (docs/synthetic-checks.md § See results). */
export function runLabel(run: SyntheticRun): string {
  if (run.ok) return 'OK';
  return `Failed: ${run.error_class ? FAILURE[run.error_class] : 'failed'}`;
}

/** The check's state from what it last did; a paused check says so first. */
export function checkState(
  check: Pick<SyntheticCheck, 'enabled'>,
  results: SyntheticResults | undefined
): { tone: Tone; label: string } {
  if (!check.enabled) return { tone: 'muted', label: 'Paused' };
  if (!results) return { tone: 'muted', label: 'Reading results' };
  const last = results.recent[0];
  if (!last) return { tone: 'muted', label: 'No runs yet' };
  return last.ok ? { tone: 'good', label: 'Passing' } : { tone: 'critical', label: runLabel(last) };
}

export function formatUptime(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(2)}%`;
}

const TONE_ICON = {
  good: CheckCircle,
  warning: WarningTriangle,
  critical: WarningTriangle,
  muted: Circle,
} as const;

function StateTag({ tone, label }: { tone: Tone; label: string }) {
  const Icon = label === 'Paused' ? PauseSolid : TONE_ICON[tone];
  return (
    <StatusTag tone={tone} icon={Icon}>
      {label}
    </StatusTag>
  );
}

/** A create failure in words, branched on apid's codes (pkg/api/synthetic_checks.go, handlers). */
export function explainCheckError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'synthetic_check_limit_reached':
      return `This app already has ${CHECK_LIMIT} checks. Delete one to add another.`;
    case 'synthetic_check_invalid':
      return err.status === 409
        ? 'This app already has a check with that name.'
        : (err.detail ?? err.message);
    case 'plan_per_app_metrics_not_allowed':
      return 'Synthetic checks are available on Hobby and above.';
    default:
      return errorMessage(err);
  }
}

/**
 * An app's synthetic checks (faas ADR-748, docs/synthetic-checks.md): a GET
 * or HEAD to a path on the app's own hostname every 5, 15 or 60 minutes,
 * through DNS, TLS, the public edge and a wake, with uptime, p95 latency and
 * the last runs. The tab is gated on `synthetic-checks`.
 *
 * Uptime and p95 are scalars over fixed windows, and the last 20 runs are a
 * table; nothing is charted.
 */
export function SyntheticsBody({ slug }: { slug: string }) {
  const { capability } = useCapability('synthetic-checks');
  const list = useAppSyntheticChecks(slug, true);
  const checks = list.data ?? [];
  const results = useSyntheticResults(
    slug,
    checks.map((c) => c.id)
  );
  const [selectedId, setSelectedId] = useState<string>();
  const found = checks.findIndex((c) => c.id === selectedId);
  const index = found >= 0 ? found : 0;
  const selected = checks[index];
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: checks.length === 0,
  });

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label="Synthetic checks">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Synthetic checks <MaturityLabel capability={capability} />
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A check requests a path on {slug} on a schedule, from outside, the way a user’s request
          goes: DNS, TLS, the public edge, and a wake if the app is parked. It catches what traffic
          metrics cannot, such as an app nobody has called for an hour that a bad deploy broke.
        </p>
      </div>

      <PlanGated error={list.error} feature="Synthetic checks">
        <Panel title="Checks" padded={phase !== 'ready'}>
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground px-4 pt-4">{`Uptime and p95 latency over 24 hours, and the last result. ${checks.length} of ${CHECK_LIMIT} defined.`}</p>

          {phase === 'unreachable' ? (
            <UnreachableState onRetry={() => void list.refetch()} />
          ) : phase === 'error' ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : phase === 'loading' ? (
            <LoadingState message="Reading checks…" />
          ) : phase === 'empty' ? (
            <EmptyState message={`${slug} has no synthetic checks yet. Create one below.`} />
          ) : (
            <ul className="divide-y divide-border">
              {checks.map((check, i) => {
                const read = results[i];
                const data = read?.data?.results;
                const current = i === index;
                return (
                  <li key={check.id}>
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => setSelectedId(check.id)}
                      className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-left transition-colors hover:bg-muted/40 ${current ? 'bg-muted/40' : ''}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{check.name}</span>
                        <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {check.method} {check.path} · {everyLabel(check.interval_seconds)} ·{' '}
                          {expectation(check)}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-3 text-xs">
                        {read?.error ? (
                          <span style={{ color: 'var(--status-critical)' }}>
                            Results unavailable
                          </span>
                        ) : (
                          <>
                            {data?.uptime_24h_pct != null && (
                              <span className="font-mono [font-variant-numeric:tabular-nums]">
                                {formatUptime(data.uptime_24h_pct)} up (24h)
                              </span>
                            )}
                            <StateTag {...checkState(check, read?.isPending ? undefined : data)} />
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
          <CheckDetail
            key={selected.id}
            slug={slug}
            check={selected}
            read={results[index]}
            onDeleted={() => setSelectedId(undefined)}
          />
        )}

        <Panel title="Create a check">
          <CheckForm
            slug={slug}
            full={checks.length >= CHECK_LIMIT}
            onCreated={(check) => setSelectedId(check.id)}
          />
        </Panel>
      </PlanGated>
    </section>
  );
}

function CheckDetail({
  slug,
  check,
  read,
  onDeleted,
}: {
  slug: string;
  check: SyntheticCheck;
  read: ReturnType<typeof useSyntheticResults>[number] | undefined;
  onDeleted: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const remove = useDeleteSyntheticCheck(slug);
  const toggle = useSetSyntheticCheckEnabled(slug);
  const results = read?.data?.results;
  const phase = queryPhase({ error: read?.error, loading: !read || read.isPending });

  const onToggle = async () => {
    const enabled = !check.enabled;
    try {
      await toggle.mutateAsync({ id: check.id, enabled });
      toast({ kind: 'success', title: enabled ? `${check.name} resumed` : `${check.name} paused` });
    } catch (err) {
      toast({
        kind: 'error',
        title: enabled ? 'Could not resume the check' : 'Could not pause the check',
        error: err,
      });
    }
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete check ${check.name}?`,
        description:
          'Its run history goes with it, and so does every alert rule that watches it. Release gates that probe with this check must be removed first.',
        confirmLabel: 'Delete check',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(check.id);
      toast({ kind: 'success', title: `Deleted ${check.name}` });
      onDeleted();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete the check', error: err });
    }
  };

  return (
    <Panel
      title={check.name}
      actions={
        <span className="flex flex-wrap items-center gap-3">
          <CopyableId value={check.id} label="check ID" />
          <Button
            variant="outline"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => void onToggle()}
          >
            {check.enabled ? (
              <Pause aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <Play aria-hidden className="h-3.5 w-3.5" />
            )}
            {check.enabled ? 'Pause' : 'Resume'}
          </Button>
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
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`${check.method} ${check.url} ${everyLabel(check.interval_seconds)}, ${expectation(check)}, timeout ${check.timeout_ms.toLocaleString()} ms`}</p>

      <div className="flex flex-col gap-5">
        {!check.enabled && (
          <p role="status" className="text-sm text-muted-foreground">
            Paused: the check does not run, so it neither wakes the app nor records results.
          </p>
        )}
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={read?.error}
            loadingMessage="Reading results…"
            onRetry={() => void read?.refetch()}
          />
        ) : !results ? (
          <p role="status" className="text-sm text-muted-foreground">
            Results could not be read just now; the check itself is unchanged.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Uptime, 24h"
                value={formatUptime(results.uptime_24h_pct)}
                note={`${results.runs_24h.toLocaleString()} runs`}
              />
              <StatTile label="Uptime, 7d" value={formatUptime(results.uptime_7d_pct)} />
              <StatTile
                label="p95 latency, 24h"
                value={
                  results.p95_latency_ms_24h > 0
                    ? `${Math.round(results.p95_latency_ms_24h)} ms`
                    : '—'
                }
                note={
                  results.p95_latency_ms_24h > 0
                    ? 'Successful runs, including any wake'
                    : 'No successful run in 24 hours'
                }
              />
            </div>
            <RecentRuns runs={results.recent} />
          </>
        )}
        <CapabilityGate capability="alerts" title="Alerts on this check">
          <CheckAlerts slug={slug} check={check} />
        </CapabilityGate>
      </div>
    </Panel>
  );
}

function RecentRuns({ runs }: { runs: SyntheticRun[] }) {
  return (
    <section aria-label="Recent runs" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Recent runs</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No runs yet. A new check runs within one interval.
        </p>
      ) : (
        <ul className="divide-y divide-border well rounded-xl bg-muted/40">
          {runs.map((run) => (
            <li
              key={run.started_at}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-xs"
            >
              <Timestamp value={run.started_at} className="text-muted-foreground" />
              <span className="flex items-center gap-3 font-mono [font-variant-numeric:tabular-nums]">
                <span>{run.status_code ?? '—'}</span>
                <span>{run.latency_ms.toLocaleString()} ms</span>
                <StateTag tone={run.ok ? 'good' : 'critical'} label={runLabel(run)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Runs are kept for 7 days. Latency is end to end, so a run that woke the app includes the
        wake.
      </p>
    </section>
  );
}

/**
 * The rules that name this check (`synthetic_check_id`) and a form already
 * pointed at it, starting from the documented "two failed runs in a row"
 * rule (docs/synthetic-checks.md § Alert on a check).
 */
function CheckAlerts({ slug, check }: { slug: string; check: SyntheticCheck }) {
  const alerts = useAlerts(slug);
  const rules = (alerts.data ?? []).filter((rule) => rule.synthetic_check_id === check.id);
  const [adding, setAdding] = useState(false);
  const phase = queryPhase({
    error: alerts.error,
    loading: alerts.isPending,
    isEmpty: rules.length === 0,
  });
  return (
    <section aria-label="Alerts on this check" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Alerts on this check</h3>
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
          emptyMessage="No alert rule watches this check. Deleting the check deletes its rules."
          onRetry={() => void alerts.refetch()}
        />
      )}
      {adding && (
        <div className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">
            Starts as two failed runs in a row, which ignores a single blip; the window is ignored.
            For slowness, pick the p95 latency metric and set it above the app’s wake time, since
            runs include wakes. A check with no runs yet leaves the rule unknown.
          </p>
          <AlertRuleForm
            slug={slug}
            initial={{
              metric: 'synthetic_check_consecutive_failures',
              comparison: 'gte',
              threshold: '2',
              checkId: check.id,
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

type Field = 'name' | 'path' | 'expected' | 'timeout';

/** The create checks apid makes, so a typo is caught before the round trip. */
export function checkFormErrors(v: {
  name: string;
  path: string;
  expected: string;
  timeout: string;
}): Record<Field, string | undefined> {
  const expected = Number(v.expected);
  const timeout = Number(v.timeout);
  return {
    name: NAME.test(v.name)
      ? undefined
      : 'Start with a lowercase letter; then lowercase letters, digits, - or _ (63 at most).',
    path:
      PATH.test(v.path) && new TextEncoder().encode(v.path).length <= 512
        ? undefined
        : 'Start with a single /, with no spaces or backslashes (512 bytes at most). The host is always the app’s own.',
    expected:
      v.expected.trim() === '' || (Number.isInteger(expected) && expected >= 100 && expected <= 599)
        ? undefined
        : 'Enter one status from 100 to 599, or leave it empty for any 2xx.',
    timeout:
      Number.isInteger(timeout) && timeout >= 1000 && timeout <= 30000
        ? undefined
        : 'Enter milliseconds from 1,000 to 30,000.',
  };
}

function CheckForm({
  slug,
  full,
  onCreated,
}: {
  slug: string;
  full: boolean;
  onCreated: (check: SyntheticCheck) => void;
}) {
  const { toast } = useToast();
  const create = useCreateSyntheticCheck(slug);
  const [name, setName] = useState('');
  const [method, setMethod] = useState<NonNullable<CreateSyntheticCheck['method']>>('GET');
  const [path, setPath] = useState('/healthz');
  const [expected, setExpected] = useState('');
  const [timeout, setTimeoutMs] = useState('10000');
  const [interval, setIntervalSeconds] = useState<Interval>(900);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = checkFormErrors({ name, path, expected, timeout });
  const shown = (field: Field) => (attempted ? errors[field] : undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || create.isPending || full) return;
    setFailure(undefined);
    const body: CreateSyntheticCheck = {
      name,
      method,
      path,
      timeout_ms: Number(timeout),
      interval_seconds: interval,
      ...(expected.trim() ? { expected_status: Number(expected) } : {}),
    };
    try {
      const check = await create.mutateAsync(body);
      toast({
        kind: 'success',
        title: `Created ${check.name}`,
        description: 'It runs within one interval.',
      });
      setName('');
      setAttempted(false);
      onCreated(check);
    } catch (err) {
      setFailure(err);
    }
  };

  if (isPlanGate(failure))
    return (
      <PlanGated error={failure} feature="Synthetic checks">
        {null}
      </PlanGated>
    );

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="label-mono text-muted-foreground">Name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="health"
            maxLength={63}
            className={`${FIELD} font-mono`}
            {...fieldErrorProps(shown('name'), 'check-name-error')}
          />
          {shown('name') && <FieldError id="check-name-error">{shown('name')}</FieldError>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Method</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'GET' | 'HEAD')}
            className={`${FIELD} font-mono`}
          >
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-1 lg:col-span-3">
          <span className="label-mono text-muted-foreground">Path</span>
          <input
            name="path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/healthz"
            maxLength={512}
            className={`${FIELD} font-mono`}
            {...fieldErrorProps(shown('path'), 'check-path-error')}
          />
          {shown('path') && <FieldError id="check-path-error">{shown('path')}</FieldError>}
        </label>
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="label-mono text-muted-foreground">Interval</span>
          <select
            value={interval}
            onChange={(e) => setIntervalSeconds(Number(e.target.value) as Interval)}
            className={FIELD}
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="label-mono text-muted-foreground">Expected status</span>
          <input
            name="expected"
            aria-label="Expected status"
            type="number"
            min={100}
            max={599}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            placeholder="Any 2xx"
            className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
            {...fieldErrorProps(shown('expected'), 'check-expected-error')}
          />
          {shown('expected') ? (
            <FieldError id="check-expected-error">{shown('expected')}</FieldError>
          ) : (
            <span className="text-xs text-muted-foreground">
              Redirects are not followed, so a 301 is reported as a 301.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="label-mono text-muted-foreground">Timeout (ms)</span>
          <input
            name="timeout"
            aria-label="Timeout (ms)"
            type="number"
            min={1000}
            max={30000}
            step={1000}
            value={timeout}
            onChange={(e) => setTimeoutMs(e.target.value)}
            className={`${FIELD} font-mono [font-variant-numeric:tabular-nums]`}
            {...fieldErrorProps(shown('timeout'), 'check-timeout-error')}
          />
          {shown('timeout') ? (
            <FieldError id="check-timeout-error">{shown('timeout')}</FieldError>
          ) : (
            <span className="text-xs text-muted-foreground">
              Includes any wake of a parked app.
            </span>
          )}
        </label>
      </div>

      <ProbeCostNote />

      {failure !== undefined && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--status-critical)' }}>{explainCheckError(failure)}</span>
          <ProblemHelp error={failure} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={create.isPending || full}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {create.isPending ? 'Creating…' : 'Create check'}
        </Button>
        {full && (
          <span className="text-xs text-muted-foreground">
            An app can have {CHECK_LIMIT} checks; delete one to add another.
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * What a probe costs, quoted from docs/synthetic-checks.md § Probes are
 * traffic and § What checks cost. The GB-hour table stays in the docs rather
 * than being restated here.
 */
function ProbeCostNote() {
  return (
    <div
      role="note"
      aria-label="Probes are billed traffic"
      className="flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs"
      style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 35%, transparent)' }}
    >
      <WarningTriangle
        aria-hidden
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        style={{ color: 'var(--status-warning)' }}
      />
      <div className="flex flex-col gap-1.5 text-muted-foreground">
        <p className="font-medium text-foreground">Probes are billed traffic</p>
        <p>
          A probe is an ordinary request and is billed like one. If your app is already running
          because of real traffic, a probe adds nothing. If the app is parked, the probe wakes it,
          and it stays up for your plan’s idle timeout before parking again.
        </p>
        <p>
          On Pro and Scale, a check at or below the idle timeout keeps the app warm continuously,
          which also removes cold starts for real users. Choose a longer interval for an app that
          should park.
        </p>
        <p>
          Probes also count toward request analytics, error-rate and latency alerts, and
          availability and latency SLOs.{' '}
          <a
            href="/docs/synthetic-checks"
            target="_blank"
            rel="noopener"
            className="text-brand underline underline-offset-4"
          >
            What checks cost
          </a>
        </p>
      </div>
    </div>
  );
}
