import { createFileRoute } from '@tanstack/react-router';
import { WarningTriangle } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  StatTile,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { Select } from '@/components/ui/field';
import { Swap } from '@/components/dashboard/motion';
import { useAppMetrics, type MetricsRange } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { PlanGate } from '@/components/dashboard/plan-gate';
import { consoleHead } from '@/lib/seo';

const RANGES: MetricsRange[] = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'];

export const Route = createFileRoute('/dashboard/metrics')({
  component: MetricsPage,
  head: () => consoleHead('metrics'),
  // The window lives in the URL, so a reload keeps it and a pasted link
  // shows the same figures. Optional: the default leaves no query string.
  validateSearch: (search: Record<string, unknown>): { range?: MetricsRange } => ({
    ...(RANGES.includes(search.range as MetricsRange)
      ? { range: search.range as MetricsRange }
      : {}),
  }),
});

/**
 * Per-app metrics, from `/v1/apps/{slug}/metrics`.
 *
 * **There are no charts here, deliberately.** This endpoint returns scalar
 * aggregates over a window — one p50, one p95, one error rate — not a time
 * series. The page it replaced drew smooth line charts from a seeded PRNG; with
 * real data there is nothing to plot, and interpolating a curve between a single
 * pair of numbers would be inventing the shape of an outage.
 *
 * Changing the range re-queries rather than slicing a cached series, because
 * each window is computed server-side by a separate PromQL query.
 */
function formatMs(value: number | undefined): string {
  if (value == null) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function formatPct(value: number | undefined): string {
  return value == null ? '—' : `${value.toFixed(2)}%`;
}

function formatCount(value: number | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat().format(value);
}

function MetricsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  const { account, loading: authLoading } = useAuth();
  const { range = '24h' } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Replace rather than push — flicking through windows is not history.
  const setRange = (next: MetricsRange) =>
    navigate({ search: next === '24h' ? {} : { range: next }, replace: true });
  const paidAccess = account !== null && isPaidPlan(account.plan);
  const { data, isPending, error, refetch } = useAppMetrics(slug, range, {
    enabled: paidAccess,
  });

  // "prometheus" on success; anything else is the documented degraded string.
  const degraded = Boolean(data && data.source !== 'prometheus');
  const phase = queryPhase({ error, loading: isPending });
  // A degraded read returns zeros, which is not the same as no traffic — the
  // tiles say "unknown" rather than printing a figure nobody measured.
  const tile = degraded ? ('unavailable' as const) : ('ready' as const);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Metrics"
        description="Aggregates over the selected window, straight from Prometheus."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AppSelect slug={slug} onSelect={select} apps={apps} />
            <label className="flex items-center gap-2">
              <span className="label-mono text-muted-foreground">Window</span>
              <Select
                value={range}
                onChange={(e) => setRange(e.target.value as MetricsRange)}
                disabled={!paidAccess}
                aria-label="Metrics window"
                className="bg-card px-2.5"
              >
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        }
      />

      <AppScope state={appState} resource="metrics">
        {authLoading || account === null ? (
          <LoadingState message="Checking plan access…" />
        ) : !paidAccess ? (
          <PlanGate
            feature="Per-app metrics"
            description="Request, latency, cold-start, and error aggregates are available on Hobby and above."
          />
        ) : degraded ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)' }}
          >
            <WarningTriangle
              className="mt-px h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--status-warning)' }}
            />
            Metrics are degraded ({data?.source}), so no figures can be read for this window.
          </p>
        ) : null}

        {paidAccess && phase === 'unreachable' ? (
          <UnreachableState onRetry={() => void refetch()} />
        ) : paidAccess && phase === 'error' ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : paidAccess && phase === 'loading' ? (
          <LoadingState message="Querying metrics…" />
        ) : paidAccess ? (
          // Keyed cross-fade: a new window (or app) is a different set of
          // figures, so the block settles in fresh rather than mutating in
          // place — rolling one p95 into another would imply continuity the
          // separate PromQL queries do not have.
          <Swap id={`${slug ?? ''}:${range}`}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile label="Requests" value={formatCount(data?.request_count)} state={tile} />
                <StatTile label="Error rate" value={formatPct(data?.error_rate_pct)} state={tile} />
                <StatTile
                  label="Cold starts"
                  value={formatPct(data?.cold_start_pct)}
                  state={tile}
                />
                <StatTile
                  label="Wake p95 (fleet)"
                  value={formatMs(data?.wake_p95_ms)}
                  state={tile}
                />
              </div>

              <Panel title="Latency (2xx only)">
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatTile label="p50" value={formatMs(data?.latency_p50_ms)} state={tile} />
                  <StatTile label="p95" value={formatMs(data?.latency_p95_ms)} state={tile} />
                  <StatTile label="p99" value={formatMs(data?.latency_p99_ms)} state={tile} />
                </div>
              </Panel>

              <p className="text-xs text-muted-foreground">
                Window {data?.range}. Latency percentiles cover 2xx traffic only; wake p95 is the
                fleet figure, not this app alone.
              </p>
            </div>
          </Swap>
        ) : null}
      </AppScope>
    </div>
  );
}
