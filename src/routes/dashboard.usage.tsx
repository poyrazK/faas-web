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
import { useUsageSummary, useApps, usePerAppUsage, useSetOverageCap } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { InlinePhase } from '@/components/dashboard/primitives';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { slugIndex } from '@/lib/api/adapters';
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

/** A hard ceiling on monthly overage spend (issue #561). 0 clears it. */
function SpendCapPanel() {
  const { toast } = useToast();
  const setCap = useSetOverageCap();
  const [euros, setEuros] = useState('');
  return (
    <Panel
      title="Spend cap"
      description="A hard ceiling on this month's overage. Once reached, requests beyond the included allowance are refused rather than billed. Zero clears the cap."
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Cap (EUR)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={euros}
            onChange={(e) => setEuros(e.target.value)}
            placeholder="10.00"
            className={`${FIELD} w-36 [font-variant-numeric:tabular-nums]`}
          />
        </label>
        <Button
          size="sm"
          disabled={euros === ''}
          busy={setCap.isPending}
          onClick={() =>
            void setCap
              .mutateAsync(Math.round(Number(euros) * 100))
              .then(() =>
                toast({
                  kind: 'success',
                  title:
                    Number(euros) === 0
                      ? 'Spend cap cleared'
                      : `Spend cap set to €${Number(euros).toFixed(2)}`,
                })
              )
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not set cap', description: errorMessage(err) })
              )
          }
        >
          Set cap
        </Button>
      </div>
    </Panel>
  );
}

/** The month, app by app — the detail the roll-up hides. */
function PerAppUsagePanel() {
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
        egressGb: ((u.tx_bytes ?? 0) + (u.net_tx_bytes ?? 0)) / 1e9,
      }))
      .sort((a, b) => b.gbHours - a.gbHours);
  }, [q.data, apps]);
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: rows.length === 0 });

  return (
    <Panel title="By app" description="This billing period, per app." padded={phase !== 'ready'}>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading per-app usage…"
          emptyMessage="No usage recorded this period."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="label-mono px-5 py-2.5 text-muted-foreground">
                  App
                </th>
                <th scope="col" className="label-mono px-5 py-2.5 text-right text-muted-foreground">
                  GB-hours
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
              {rows.map((r) => (
                <tr key={r.slug}>
                  <td className="px-5 py-2.5 font-mono text-xs">{r.slug}</td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.gbHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.requests.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.coldBoots.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.egressGb.toLocaleString(undefined, { maximumFractionDigits: 2 })} GB
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

          <PerAppUsagePanel />
          <SpendCapPanel />

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
