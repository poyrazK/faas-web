import { ManagedPostgresUsagePanel } from '@/components/dashboard/account-postgres-usage';
import { CostBreakdown, CostBreakdownPersonalOnly } from '@/components/dashboard/billing-costs';
import { HelpTip } from '@/components/dashboard/kit/help-tip';
import { ObjectStorageUsagePanel } from '@/components/dashboard/object-storage-usage';
import { OrgUsage } from '@/components/dashboard/org-billing';
import {
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  Panel,
  queryPhase,
  UnreachableState,
  type QueryPhase,
} from '@/components/dashboard/primitives';
import { SpendCap } from '@/components/dashboard/spend-cap';
import { SpendControl } from '@/components/dashboard/spend-control';
import { DailyUsagePanel } from '@/components/dashboard/usage-daily';
import {
  computeForecastMillicents,
  projectUsage,
  usageAnswer,
  type UsageTone,
} from '@/components/dashboard/usage-words';
import { Button } from '@/components/ui/button';
import { slugIndex } from '@/lib/api/adapters';
import { monthLabel } from '@/lib/api/billing-costs';
import { ApiError } from '@/lib/api/errors';
import {
  useAccountUsage,
  useApps,
  useBillingForecast,
  useOverageCap,
  usePerAppUsage,
  useUsageSummary,
} from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import { formatCents } from '@/lib/money';
import { consoleHead } from '@/lib/seo';
import { formatUsageBytes, formatUsageNumber } from '@/lib/usage-format';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

type UsageSummary = components['schemas']['UsageSummaryResponse'];

export const Route = createFileRoute('/dashboard/usage')({
  component: UsagePage,
  head: () => consoleHead('usage'),
});

/**
 * Billing-period usage. Compute, the allowance and overage are from
 * `/v1/usage/summary`; the account usage projection (`/v1/account/usage`) adds
 * the daily rollups, object storage and managed PostgreSQL when the account has
 * them, and its failure only replaces that addition with a notice.
 *
 * The unit that matters is GB-hours: memory multiplied by time, which is how a
 * scale-to-zero platform charges. An idle app costs nothing, so a low number
 * here next to a lot of apps is the platform working as advertised.
 *
 * Plan limits come from `/v1/account` rather than being hardcoded, so a plan
 * change is reflected without a deploy.
 */
function formatMoney(cents: number | undefined): string {
  if (cents == null) return '—';
  return formatCents(cents);
}

const TONE_COLOR: Record<UsageTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

/** One small figure in the quiet strip under the answer. */
function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium [font-variant-numeric:tabular-nums]">{value}</dd>
    </div>
  );
}

/**
 * The answer first (docs/console-plain-english.md): one sentence for the
 * month, the allowance as a bar — solid for what has been used, faint for a
 * straight-line projection to month end (current month only, from day 2) —
 * the one action that fits, and the month's figures, smaller, under it.
 * Wording lives in `usage-words.ts`.
 */
function UsageAnswerCard({ data, onRaiseCap }: { data: UsageSummary; onRaiseCap: () => void }) {
  const { account } = useAuth();
  const cap = useOverageCap();
  const forecast = useBillingForecast();
  const used = data.used_gb_hours ?? 0;
  const included = data.included_gb_hours ?? 0;
  const facts = {
    month: data.month,
    used,
    included,
    overageGbHours: data.overage_gb_hours,
    overageCents: data.overage_cents,
  };
  const answer = usageAnswer({
    ...facts,
    // Unread or failed reads leave their part out, never stand in as zero.
    capCents: cap.data ? cap.data.overage_cap_cents : undefined,
    forecastMillicents: computeForecastMillicents(forecast.data?.meters),
    plan: account?.plan,
  });
  const { projecting, projected } = projectUsage(used, data.month);
  const tone = TONE_COLOR[answer.tone];
  // Guard the divide: a plan with no included allowance would otherwise
  // render the bar as NaN% wide.
  const share = (v: number) => (included > 0 ? Math.min(100, (v / included) * 100) : 0);
  const capLabel =
    cap.data === undefined
      ? undefined
      : cap.data.overage_cap_cents === null
        ? 'Set a cap'
        : 'Raise cap';

  return (
    <section
      aria-label="This month"
      className="surface flex flex-col gap-5 rounded-[1.25rem] bg-card p-5 sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="bento-label flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: tone }}
            />
            This month{data.month ? ` · ${monthLabel(data.month)}` : ''}
          </p>
          <p
            role="status"
            aria-label="Usage this month"
            className="max-w-[46rem] text-xl leading-8 font-semibold tracking-[-0.015em] text-balance sm:text-2xl sm:leading-9"
          >
            {answer.sentence}
          </p>
        </div>
        {answer.action && (
          <div className="flex shrink-0 flex-wrap gap-2 lg:pt-7">
            {answer.action === 'upgrade' ? (
              <Button asChild size="sm">
                <Link to="/dashboard/plans">Upgrade plan</Link>
              </Button>
            ) : (
              capLabel && (
                <Button size="sm" aria-haspopup="dialog" onClick={onRaiseCap}>
                  {capLabel}
                </Button>
              )
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuenow={Math.round(share(used))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Included allowance used"
        >
          {projecting && (
            <div
              className="absolute inset-y-0 left-0 rounded-full opacity-35"
              style={{ width: `${share(projected)}%`, background: tone }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${share(used)}%`, background: tone }}
          />
        </div>
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          <span>
            {formatUsageNumber(used)} of {formatUsageNumber(included)} GB-hours included
            {projecting && <> · ~{formatUsageNumber(projected)} by month end if the pace holds</>}
          </span>
          <HelpTip label="About GB-hours">
            Compute is measured in GB-hours: memory multiplied by time. An app that is asleep uses
            none. The faint bar is a straight line from the month so far, not a forecast model.
          </HelpTip>
        </p>
      </div>

      <dl className="well grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-muted/40 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure
          label="Compute used"
          value={`${formatUsageNumber(used)} GB-h`}
          title="GB-hours used"
        />
        <Figure
          label="Over the allowance"
          value={`${formatUsageNumber(data.overage_gb_hours)} GB-h`}
          title="Overage GB-hours"
        />
        <Figure
          label="Overage so far"
          value={formatMoney(data.overage_cents)}
          title="Overage cost"
        />
        <Figure
          label="CPU time"
          value={`${formatUsageNumber(data.used_cpu_hours)} h`}
          title="CPU hours (not billed)"
        />
        <Figure
          label="Data out"
          value={formatUsageBytes((data.used_egress_gb ?? 0) * 1024 ** 3)}
          title="Compute egress"
        />
        <Figure
          label="Data in"
          value={formatUsageBytes((data.used_ingress_gb ?? 0) * 1024 ** 3)}
          title="Ingress (not billed)"
        />
      </dl>
    </section>
  );
}

/** The month, app by app — the detail the roll-up hides. */
function PerAppUsagePanel() {
  const [expanded, setExpanded] = useState(false);
  const tableId = useId();
  const q = usePerAppUsage();
  const { data: apps } = useApps();
  const rows = useMemo(() => {
    const bySlug = slugIndex(apps ?? []);
    return (q.data ?? [])
      .map((u) => ({
        slug: bySlug.get(u.app_id) ?? u.app_id.slice(0, 8),
        gbHours: (u.mb_seconds ?? 0) / 1024 / 3600,
        requests: u.requests ?? 0,
        coldBoots: u.cold_boots ?? 0,
        egressBytes: (u.tx_bytes ?? 0) + (u.net_tx_bytes ?? 0),
      }))
      .sort((a, b) => b.gbHours - a.gbHours);
  }, [q.data, apps]);
  const totalGbHours = useMemo(() => rows.reduce((sum, r) => sum + r.gbHours, 0), [rows]);
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: rows.length === 0 });

  return (
    <Panel
      title="By app"
      padded={phase !== 'ready'}
      actions={
        phase === 'ready' &&
        rows.length > 5 && (
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={tableId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show fewer' : `Show all ${rows.length} apps`}
          </Button>
        )
      }
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading per-app usage…"
          emptyMessage="No usage recorded this period."
        />
      ) : (
        <div className="overflow-x-auto">
          <table id={tableId} className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="label-mono px-5 py-2.5 text-muted-foreground">
                  App
                </th>
                <th scope="col" className="label-mono px-5 py-2.5 text-right text-muted-foreground">
                  GB-hours
                </th>
                <th scope="col" className="label-mono px-5 py-2.5 text-left text-muted-foreground">
                  Share
                </th>
                <th scope="col" className="label-mono px-5 py-2.5 text-right text-muted-foreground">
                  Requests
                </th>
                <th scope="col" className="label-mono px-5 py-2.5 text-right text-muted-foreground">
                  Cold boots
                </th>
                <th scope="col" className="label-mono px-5 py-2.5 text-right text-muted-foreground">
                  Egress
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(expanded ? rows : rows.slice(0, 5)).map((r) => (
                <tr key={r.slug}>
                  <td className="px-5 py-2.5 font-mono text-xs">{r.slug}</td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {formatUsageNumber(r.gbHours)}
                  </td>
                  <td className="px-5 py-2.5">
                    {/* Share of the month's compute — the ranking, visible. */}
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${totalGbHours > 0 ? (r.gbHours / totalGbHours) * 100 : 0}%`,
                            background: 'var(--brand)',
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                        {totalGbHours > 0 ? Math.round((r.gbHours / totalGbHours) * 100) : 0}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.requests.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.coldBoots.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {formatUsageBytes(r.egressBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * In a company workspace the page reads the organization's billing subject:
 * its usage and its own spend cap. The account projection, allowance,
 * forecast and cost breakdown belong to the signed-in account and have no
 * organization variant, so they are not shown there; the cost breakdown says
 * so in place.
 */
function UsagePage() {
  const { org, label, ready } = useWorkspaceTarget();
  // Until the workspace is bound, a chosen company reads as null: wait.
  if (!ready) return <PageHeader title="Usage" />;
  if (!org) return <PersonalUsage />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usage" />
      <OrgUsage org={org} label={label} />
      <SpendCap />
      <CostBreakdownPersonalOnly label={label} />
    </div>
  );
}

/**
 * Why the service breakdown is missing, by code. apid fails the whole account
 * projection when a configured service's accounting fails (faas handlers_ext.go
 * accountUsage: `capacity_unavailable` for object storage, `managed_postgres_*`
 * for PostgreSQL), so compute above, read separately, is never what is lost.
 */
function breakdownNotice(error: unknown): string {
  const unaffected = 'Compute usage above is unaffected.';
  if (error instanceof ApiError) {
    if (error.code === 'managed_postgres_usage_stale')
      return `Managed PostgreSQL usage is stale, so the daily breakdown and service usage cannot be shown yet. ${unaffected}`;
    if (error.code.startsWith('managed_postgres_'))
      return `Managed PostgreSQL usage could not be read, so the daily breakdown and service usage are unavailable. ${unaffected}`;
    if (error.code === 'capacity_unavailable')
      return `A service's usage accounting could not be read, so the daily breakdown and service usage are unavailable. ${unaffected}`;
  }
  return `The daily breakdown and service usage are unavailable. ${unaffected}`;
}

/** Stands in for the daily chart and service panels while the projection is not ready. */
function BreakdownPhase({
  phase,
  error,
  onRetry,
}: {
  phase: QueryPhase;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Panel
      title="Day by day and services"
      help="Daily rollups, object storage and managed PostgreSQL, from the account usage projection."
    >
      {phase === 'loading' ? (
        <InlinePhase phase="loading" loadingMessage="Reading the daily and service breakdown…" />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{breakdownNotice(error)}</p>
          <InlinePhase phase={phase} error={error} onRetry={onRetry} />
        </div>
      )}
    </Panel>
  );
}

function PersonalUsage() {
  // Compute, the allowance and overage come from the usage summary, which
  // stands on its own; the account projection only adds to it.
  const { data, isPending, error, refetch } = useUsageSummary();
  const breakdown = useAccountUsage();
  const breakdownPhase = queryPhase({ error: breakdown.error, loading: breakdown.isPending });
  // A failed refetch keeps stale data; show the notice rather than old figures.
  const projection = breakdownPhase === 'ready' ? breakdown.data : undefined;
  // The shared precedence: an unreachable API is an outage to wait out, not a
  // red error — and never a page of zeros.
  const phase = queryPhase({ error, loading: isPending });
  // The headline's "Raise cap" and the spend control's own button open the
  // same editor.
  const [editingCap, setEditingCap] = useState(false);

  const used = data?.used_gb_hours ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Usage"
        help="What this month has used so far. GB-hours are memory × time; an app that is asleep accrues none."
      />

      {phase === 'unreachable' ? (
        <UnreachableState onRetry={() => void refetch()} />
      ) : phase === 'error' ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : phase === 'loading' || !data ? (
        <LoadingState message="Loading usage…" />
      ) : (
        <>
          <UsageAnswerCard data={data} onRaiseCap={() => setEditingCap(true)} />
          <SpendControl
            overageCents={data.overage_cents}
            editing={editingCap}
            onEditingChange={setEditingCap}
          />
          {projection ? (
            <DailyUsagePanel
              daily={projection.compute.daily}
              month={projection.month}
              usedGbHours={used}
            />
          ) : (
            <BreakdownPhase
              phase={breakdownPhase}
              error={breakdown.error}
              onRetry={() => void breakdown.refetch()}
            />
          )}
          <PerAppUsagePanel />

          {/* Secondary, so grouped and compact. Absent blocks mean the service
              is not enabled for the account. */}
          {(projection?.object_storage || projection?.managed_postgres) && (
            <Panel title="Other services">
              <div className="grid gap-3 md:grid-cols-2">
                {projection.object_storage && (
                  <ObjectStorageUsagePanel data={projection.object_storage} />
                )}
                {projection.managed_postgres && (
                  <ManagedPostgresUsagePanel data={projection.managed_postgres} />
                )}
              </div>
            </Panel>
          )}

          <CostBreakdown />
        </>
      )}
    </div>
  );
}
