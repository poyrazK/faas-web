import { createFileRoute } from '@tanstack/react-router';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  StatTile,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { useUsageSummary } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/usage')({
  component: UsagePage,
  head: () => consoleHead('usage'),
});

/**
 * Billing-period usage, from `/v1/usage/summary`.
 *
 * The unit that matters is GB-hours: memory multiplied by time, which is how a
 * scale-to-zero platform charges. An idle app costs nothing, so a low number
 * here next to a lot of apps is the platform working as advertised.
 *
 * Plan limits come from `/v1/account` rather than being hardcoded, so a plan
 * change is reflected without a deploy.
 */
function formatNumber(value: number | undefined, digits = 2): string {
  if (value == null) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatMoney(cents: number | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
    cents / 100
  );
}

function UsagePage() {
  const { data, isPending, error, refetch } = useUsageSummary();
  const { account } = useAuth();
  // The shared precedence: an unreachable API is an outage to wait out, not a
  // red error — and never a page of zeros.
  const phase = queryPhase({ error, loading: isPending });

  const used = data?.used_gb_hours ?? 0;
  const included = data?.included_gb_hours ?? 0;
  // Guard the divide: a plan with no included allowance would otherwise render
  // the bar as NaN% wide.
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const over = (data?.overage_gb_hours ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usage"
        description="This billing period. GB-hours are memory × time — a parked app accrues none."
      />

      {phase === 'unreachable' ? (
        <UnreachableState onRetry={() => void refetch()} />
      ) : phase === 'error' ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading usage…" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="GB-hours used" value={formatNumber(used)} />
            <StatTile label="Included" value={formatNumber(included)} />
            <StatTile label="Overage" value={formatNumber(data?.overage_gb_hours)} />
            <StatTile label="Overage cost" value={formatMoney(data?.overage_cents)} />
          </div>

          <Panel title={`Allowance — ${data?.month ?? 'this month'}`}>
            <div className="flex flex-col gap-3">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Included allowance used"
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: over ? 'var(--status-warning)' : 'var(--brand)',
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(used)} of {formatNumber(included)} GB-hours
                {over ? ' — you are into overage for this period.' : '.'}
              </p>
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="CPU hours" value={formatNumber(data?.used_cpu_hours)} />
            <StatTile label="Egress" value={`${formatNumber(data?.used_egress_gb)} GB`} />
            <StatTile label="Ingress" value={`${formatNumber(data?.used_ingress_gb)} GB`} />
            <StatTile label="Apps" value={String(account?.app_count ?? '—')} />
          </div>

          {account?.limits && (
            <p className="text-xs text-muted-foreground">
              On the {account.plan} plan: {account.limits.deployed_apps} apps,{' '}
              {account.limits.ram_mb} MB per app, {account.limits.max_concurrency} concurrent
              instances.
            </p>
          )}
        </>
      )}
    </div>
  );
}
