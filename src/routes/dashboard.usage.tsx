import { ManagedPostgresUsagePanel } from '@/components/dashboard/account-postgres-usage';
import { CostBreakdown, CostBreakdownPersonalOnly } from '@/components/dashboard/billing-costs';
import { ObjectStorageUsagePanel } from '@/components/dashboard/object-storage-usage';
import { OrgUsage } from '@/components/dashboard/org-billing';
import {
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  Panel,
  queryPhase,
  Stats,
  StatTile,
  UnreachableState,
  type QueryPhase,
} from '@/components/dashboard/primitives';
import { SpendCap } from '@/components/dashboard/spend-cap';
import { SpendControl } from '@/components/dashboard/spend-control';
import { DailyUsagePanel } from '@/components/dashboard/usage-daily';
import { Button } from '@/components/ui/button';
import { slugIndex } from '@/lib/api/adapters';
import { ApiError } from '@/lib/api/errors';
import { useAccountUsage, useApps, usePerAppUsage, useUsageSummary } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { formatCents } from '@/lib/money';
import { consoleHead } from '@/lib/seo';
import { formatUsageBytes, formatUsageNumber } from '@/lib/usage-format';
import { createFileRoute } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

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

/**
 * Where the month ends up if the pace holds. A linear projection over the
 * metered figure — arithmetic, not a model, and labelled as such. Renders
 * nothing until the period is the current calendar month and at least a
 * full day has been metered; a projection from an hour of data is noise
 * wearing a number.
 */
/**
 * The allowance and where this month is heading: the solid bar is what has
 * been used, the faint one a straight-line projection to month end (current
 * month only, from day 2).
 */
function AllowancePanel({
  used,
  included,
  month,
}: {
  used: number;
  included: number;
  month: string | undefined;
}) {
  const now = new Date();
  const [y, m] = (month ?? '').split('-').map(Number);
  const dayOfMonth = now.getUTCDate();
  const projecting =
    y === now.getUTCFullYear() && m === now.getUTCMonth() + 1 && used > 0 && dayOfMonth >= 2;
  const daysInMonth = projecting ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 0;
  const projected = projecting ? (used / dayOfMonth) * daysInMonth : used;
  const over = used > included || projected > included;
  // Guard the divide: a plan with no included allowance would otherwise
  // render the bar as NaN% wide.
  const share = (v: number) => (included > 0 ? Math.min(100, (v / included) * 100) : 0);
  const color = over ? 'var(--status-warning)' : 'var(--brand)';

  return (
    <Panel title={`Allowance · ${month ?? 'this month'}`}>
      <div className="flex flex-col gap-2">
        <div
          className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuenow={Math.round(share(used))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Included allowance used"
        >
          {projecting && (
            <div
              className="absolute inset-y-0 left-0 rounded-full opacity-40"
              style={{ width: `${share(projected)}%`, background: color }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${share(used)}%`, background: color }}
          />
        </div>
        <p className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          {formatUsageNumber(used)} of {formatUsageNumber(included)} GB-hours
          {projecting && (
            <>
              {' · '}~{formatUsageNumber(projected)} by month end
              {projected > included && (
                <span style={{ color: 'var(--status-warning)' }}>
                  , {formatUsageNumber(projected - included)} over
                </span>
              )}
            </>
          )}
        </p>
      </div>
    </Panel>
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

  const used = data?.used_gb_hours ?? 0;
  const included = data?.included_gb_hours ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Usage"
        meta={data?.month && <span className="text-xs text-muted-foreground">{data.month}</span>}
        help="GB-hours are memory × time. A parked app accrues none."
      />

      {phase === 'unreachable' ? (
        <UnreachableState onRetry={() => void refetch()} />
      ) : phase === 'error' ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading usage…" />
      ) : (
        <>
          <Stats columns={6}>
            <StatTile
              label="GB-hours used"
              value={formatUsageNumber(used)}
              note={`of ${formatUsageNumber(included)} included`}
            />
            <StatTile
              label="Overage"
              value={formatUsageNumber(data?.overage_gb_hours)}
              unit="GB-h"
            />
            <StatTile label="Overage cost" value={formatMoney(data?.overage_cents)} />
            <StatTile label="CPU hours" value={formatUsageNumber(data?.used_cpu_hours)} />
            <StatTile
              label="Compute egress"
              value={formatUsageBytes((data?.used_egress_gb ?? 0) * 1024 ** 3)}
            />
            <StatTile
              label="Ingress"
              value={formatUsageBytes((data?.used_ingress_gb ?? 0) * 1024 ** 3)}
            />
          </Stats>

          <AllowancePanel used={used} included={included} month={data?.month} />
          <SpendControl overageCents={data?.overage_cents} />
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

          {/* Absent blocks mean the service is not enabled for the account. */}
          {projection?.object_storage && (
            <ObjectStorageUsagePanel data={projection.object_storage} />
          )}
          {projection?.managed_postgres && (
            <ManagedPostgresUsagePanel data={projection.managed_postgres} />
          )}

          <CostBreakdown />
        </>
      )}
    </div>
  );
}
