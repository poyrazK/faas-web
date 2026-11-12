import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, GraphUp, Pause, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useMfaAction } from '@/components/auth/use-mfa-action';
import {
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  usePostgresCapabilities,
  usePostgresOverage,
  usePostgresUsage,
  useSetPostgresOverage,
  type PostgresCapabilities,
  type PostgresUsage as Usage,
} from '@/lib/api/postgres';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import {
  StatusTag,
  TONE,
  cuHours,
  explainPostgres,
  gib,
  transfer,
  type Tone,
} from './postgres-shared';

/**
 * The month's managed PostgreSQL usage, and the compute cap that acts on it
 * (faas ADR-20261025094915, handlers_managed_postgres.go managedPostgresUsageView).
 *
 * Compute is pooled across the workspace's databases. At the ceiling (the
 * allowance, or twice it with overage on) every database is suspended: its
 * data, restore history, bindings and credentials are kept, and it refuses
 * connections until the next UTC month, an upgrade, or overage turned on.
 * That state is the account's, not one database's, so it is said here once
 * and each database row points back to it.
 *
 * Overage is the account's setting (`PUT /v1/postgres/overage`). It needs a
 * paid plan and the `postgres-overage` capability, which ships `internal`:
 * apid answers its route as missing for an account it is not released to,
 * so nothing is read until both hold. Organizations have no overage route,
 * so a company workspace is never offered one. The API reports no overage
 * rate, so none is shown; what it does say is that the most a month can add
 * is one more allowance (the ceiling is twice the allowance).
 */

const CAP: Record<
  NonNullable<Usage['compute_cap_state']>,
  { tone: Tone; icon: typeof CheckCircle; label: string }
> = {
  healthy: { tone: 'good', icon: CheckCircle, label: 'Within the allowance' },
  warning: { tone: 'warning', icon: WarningTriangle, label: 'Nearing the allowance' },
  overage: { tone: 'warning', icon: GraphUp, label: 'In overage' },
  suspended: { tone: 'critical', icon: Pause, label: 'Suspended at the cap' },
};

const utcDay = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** The 1st of the month after the usage period, when compute resumes. */
function nextMonth(periodStart: string): string | null {
  const start = Date.parse(periodStart);
  if (Number.isNaN(start)) return null;
  const at = new Date(start);
  return utcDay.format(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

export function PostgresUsage() {
  const withMfa = useMfaAction();
  const { org, label } = useWorkspaceTarget();
  const { account } = useAuth();
  const usage = usePostgresUsage();
  const capabilities = usePostgresCapabilities();
  const overageAccess = useCapabilityAccess('postgres-overage').access;
  const offered = !org && (account?.plan ?? 'free') !== 'free' && overageAccess === 'on';
  const overage = usePostgresOverage(offered);
  const setOverage = useSetPostgresOverage();
  const confirm = useConfirm();
  const { toast } = useToast();
  const phase = queryPhase({ error: usage.error, loading: usage.isPending });
  const data = usage.data;

  const toggleOverage = async (enabled: boolean) => {
    const allowance =
      overage.data?.compute_allowance_unit_seconds ?? data?.compute_allowance_unit_seconds ?? 0;
    const used = data?.compute_unit_seconds ?? 0;
    const past = allowance > 0 && used >= allowance;
    const ok = await confirm(
      enabled
        ? {
            title: 'Turn compute overage on?',
            description: `Databases keep running past the ${cuHours(allowance)} allowance until ${cuHours(allowance * 2)} this month, then are suspended. Compute above the allowance is billed as overage: at most ${cuHours(allowance)} more a month.`,
            confirmLabel: 'Turn overage on',
          }
        : {
            title: 'Turn compute overage off?',
            description: past
              ? `This month is already past the ${cuHours(allowance)} allowance, so the databases are suspended at the next cap check and stay suspended until next month or an upgrade. They keep their data.`
              : `Databases are suspended once this month reaches the ${cuHours(allowance)} allowance, until next month or an upgrade.`,
            confirmLabel: 'Turn overage off',
            destructive: past,
          }
    );
    if (!ok) return;
    try {
      await withMfa(() => setOverage.mutateAsync(enabled), 'Verify to change compute overage.');
      toast({
        kind: 'success',
        title: enabled ? 'Compute overage is on' : 'Compute overage is off',
        description: enabled
          ? 'Suspended databases resume at the next cap check; a connection then wakes them.'
          : undefined,
      });
    } catch (err) {
      toast(explainPostgres(err));
    }
  };

  const overageOn = overage.data?.enabled ?? data?.overage_enabled ?? false;
  const canTurnOn = offered && overage.data !== undefined && !overageOn;

  return (
    <Panel
      title="Usage this month"
      help={`Pooled across ${org ? `${label}'s` : 'your'} databases. Figures can trail the databases by up to two hours.`}
      actions={
        data?.observed_at ? (
          <span className="text-xs text-muted-foreground">
            Observed <Timestamp value={data.observed_at} />
          </span>
        ) : undefined
      }
    >
      {phase === 'unreachable' ? (
        <UnreachableState onRetry={() => void usage.refetch()} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading usage…" />
      ) : phase === 'error' ? (
        usage.error instanceof ApiError && usage.error.code === 'org_role_forbidden' ? (
          <p role="status" className="text-sm text-muted-foreground">
            Your role in {label} cannot read its Postgres usage.
          </p>
        ) : (
          <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
        )
      ) : data ? (
        <div className="flex flex-col gap-5">
          {data.compute_cap_state === 'suspended' && (
            <CapSuspended
              usage={data}
              who={org ? label : null}
              overageButton={
                canTurnOn ? (
                  <Button
                    size="xs"
                    variant="outline"
                    busy={setOverage.isPending}
                    onClick={() => void toggleOverage(true)}
                  >
                    Turn overage on
                  </Button>
                ) : null
              }
            />
          )}
          <Figures usage={data} />
          {!data.fresh && data.policy_enabled && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <WarningTriangle
                aria-hidden
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: TONE.warning }}
              />
              <span>
                Usage is stale: last observed <Timestamp value={data.observed_at} />. The cap still
                applies, but these figures may be behind it.
              </span>
            </p>
          )}
          {capabilities.data && (
            <PlanFacts
              capabilities={capabilities.data}
              whose={org ? `${label}'s plan` : 'Your plan'}
            />
          )}
          {offered && (
            <section
              aria-label="Compute overage"
              className="flex flex-col gap-2 border-t border-border pt-4"
            >
              <p className="label-mono text-muted-foreground">Compute overage</p>
              {overage.data ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-2xl text-sm text-muted-foreground">
                    {overage.data.enabled ? (
                      <>
                        <span className="font-medium text-foreground">On</span>: databases keep
                        running past the {cuHours(overage.data.compute_allowance_unit_seconds)}{' '}
                        allowance until {cuHours(overage.data.compute_ceiling_unit_seconds)}, then
                        are suspended. Compute above the allowance is billed as overage.
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">Off</span>: databases are
                        suspended when the {cuHours(overage.data.compute_allowance_unit_seconds)}{' '}
                        allowance is used, until next month or an upgrade.
                      </>
                    )}{' '}
                    Suspended databases keep their data.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    busy={setOverage.isPending}
                    onClick={() => void toggleOverage(!overage.data.enabled)}
                  >
                    {overage.data.enabled ? 'Turn overage off' : 'Turn overage on'}
                  </Button>
                </div>
              ) : (
                <InlinePhase
                  phase={queryPhase({ error: overage.error, loading: overage.isPending })}
                  error={overage.error}
                  loadingMessage="Reading the overage setting…"
                  onRetry={() => void overage.refetch()}
                />
              )}
            </section>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function Figures({ usage }: { usage: Usage }) {
  const allowance = usage.compute_allowance_unit_seconds;
  const metered = usage.policy_enabled && allowance !== undefined && allowance > 0;
  const ceiling = usage.compute_ceiling_unit_seconds ?? allowance ?? 0;
  const cap = usage.compute_cap_state ? CAP[usage.compute_cap_state] : undefined;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          term="Compute"
          value={cuHours(usage.compute_unit_seconds)}
          note={
            metered
              ? `of ${cuHours(allowance)} included${ceiling > allowance ? ` · suspends at ${cuHours(ceiling)}` : ''}`
              : undefined
          }
        />
        <Figure
          term="Ready databases"
          value={`${usage.ready_databases} of ${usage.database_limit}`}
          note="a scheduled delete still counts"
        />
        <Figure term="Storage pool" value={gib(usage.storage_limit_bytes)} note="shared" />
        <Figure term="Egress" value={transfer(usage.egress_bytes)} note="this month" />
      </dl>
      {metered ? (
        <div className="flex flex-col items-start gap-2">
          {cap && (
            <StatusTag tone={cap.tone} icon={cap.icon}>
              {cap.label}
            </StatusTag>
          )}
          <ComputeMeter used={usage.compute_unit_seconds} allowance={allowance} ceiling={ceiling} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Compute is not metered on this installation, so there is no allowance or cap to show.
        </p>
      )}
    </div>
  );
}

function Figure({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="label-mono text-muted-foreground">{term}</dt>
      <dd className="text-lg font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
        {value}
      </dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

/**
 * One scalar against its limits: compute used, the allowance, and the
 * ceiling when overage puts it past the allowance. Not a series.
 */
function ComputeMeter({
  used,
  allowance,
  ceiling,
}: {
  used: number;
  allowance: number;
  ceiling: number;
}) {
  const span = Math.max(ceiling, allowance);
  const fill = Math.min(100, (used / span) * 100);
  const mark = (allowance / span) * 100;
  const tone = used >= ceiling ? TONE.critical : used >= allowance * 0.8 ? TONE.warning : TONE.good;
  return (
    <div
      role="meter"
      aria-label="Compute used against the allowance"
      aria-valuemin={0}
      aria-valuemax={Math.round((span / allowance) * 100)}
      aria-valuenow={Math.round((used / allowance) * 100)}
      aria-valuetext={`${cuHours(used)} of ${cuHours(allowance)}`}
      className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-console motion-reduce:transition-none"
        style={{ width: `${fill}%`, background: tone }}
      />
      {mark < 100 && (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-foreground/60"
          style={{ left: `${mark}%` }}
        />
      )}
    </div>
  );
}

function CapSuspended({
  usage,
  who,
  overageButton,
}: {
  usage: Usage;
  /** The organization's name in a company workspace; null for your own. */
  who: string | null;
  overageButton: ReactNode;
}) {
  const resumes = nextMonth(usage.period_start);
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ backgroundColor: `color-mix(in oklab, ${TONE.critical} 14%, transparent)` }}
    >
      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: TONE.critical }}>
        <Pause aria-hidden className="h-4 w-4 shrink-0" />
        {who ? `${who}'s databases are suspended` : 'Your databases are suspended'} at the compute
        cap
      </p>
      <p className="text-sm text-muted-foreground">
        {usage.compute_suspended_at ? (
          <>
            Since <Timestamp value={usage.compute_suspended_at} mode="absolute" />,{' '}
          </>
        ) : null}
        this month&apos;s {cuHours(usage.compute_ceiling_unit_seconds ?? 0)} of compute is used.
        They keep their data, restore history, bindings and credentials, but refuse connections
        until one of these happens:
      </p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          {resumes ? `The month ends: compute resumes on ${resumes} (UTC).` : 'The month ends.'}
        </li>
        <li>
          {who ? `An owner of ${who} upgrades its plan.` : 'You upgrade your plan.'}{' '}
          <Link to="/dashboard/plans" className="text-brand underline-offset-4 hover:underline">
            View plans
          </Link>
        </li>
        {overageButton && (
          <li>
            <span className="inline-flex flex-wrap items-center gap-2">
              Overage is turned on, so they run again up to twice the allowance this month.
              {overageButton}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** What the plan includes, from the capabilities route rather than a copy of the plan table. */
function PlanFacts({ capabilities, whose }: { capabilities: PostgresCapabilities; whose: string }) {
  const facts = [
    `${capabilities.database_limit} database${capabilities.database_limit === 1 ? '' : 's'}`,
    `${gib(capabilities.storage_limit_bytes)} pooled storage`,
    capabilities.service_classes.length
      ? `${capabilities.service_classes.join(', ')} class${capabilities.service_classes.length === 1 ? '' : 'es'}`
      : null,
    capabilities.point_in_time_restore
      ? `${Math.round(capabilities.restore_window_seconds / 86_400)}-day restore window`
      : 'no point-in-time restore',
    capabilities.always_on ? 'always-on compute available' : 'compute suspends when idle',
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        {whose} in {capabilities.region}: {facts.join(' · ')}.
      </p>
      {!capabilities.provisioning_enabled && (
        <p role="status" className="flex items-center gap-2">
          <WarningTriangle
            aria-hidden
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: TONE.warning }}
          />
          New databases are paused in {capabilities.region}; existing ones keep running.
        </p>
      )}
    </div>
  );
}
