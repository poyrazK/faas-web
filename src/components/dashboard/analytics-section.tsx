import { useState } from 'react';
import { Refresh } from 'iconoir-react';
import { AppSelect } from '@/components/dashboard/app-select';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api/errors';
import { useAppAnalyticsTimeseries } from '@/lib/api/queries';
import { AnalyticsGrid, type AnalyticsPoint } from './analytics-grid';

/**
 * Analytics on the overview, scoped to one app.
 *
 * The window is per-app because the series is: `/analytics/timeseries` answers
 * for one app, and the platform has no account-level rollup of it. Summing N
 * apps here would look like the account total it is not — apps on different
 * plans keep different retention, so the earlier end of such a sum would
 * quietly thin out as the shortest retention ran out.
 *
 * Free has no request analytics at all (`DebugTelemetryEnabled`), which is a
 * fact about the plan rather than a failure, so it is said plainly.
 */

const WINDOWS: { value: string; label: string; half: string }[] = [
  { value: '24h', label: 'Last 24 hours', half: 'the 12 hours before' },
  { value: '3d', label: 'Last 3 days', half: 'the 36 hours before' },
  { value: '7d', label: 'Last 7 days', half: 'the 3.5 days before' },
];

export function AnalyticsSection({
  apps,
  slug,
  onSelectApp,
}: {
  apps: { slug: string }[];
  slug: string;
  onSelectApp: (slug: string) => void;
}) {
  const [since, setSince] = useState('24h');
  const window = WINDOWS.find((w) => w.value === since) ?? WINDOWS[0];
  const series = useAppAnalyticsTimeseries(slug, since);
  const points = (series.data?.points ?? []) as AnalyticsPoint[];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="analytics-heading" className="text-sm font-semibold">
          Analytics
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect slug={slug} onSelect={onSelectApp} apps={apps} />
          <Select
            aria-label="Time window"
            value={since}
            onChange={(e) => setSince(e.currentTarget.value)}
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => void series.refetch()}
            aria-label="Refresh analytics"
            className="pressable rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Refresh aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Matched on the problem code, never the status: 402 is also an unpaid
          invoice, and reading one as the other turns "upgrade to use this" into
          "something is broken". PlanGated owns that distinction. */}
      <PlanGated error={series.error} feature="Request analytics">
        {series.error ? (
          <p className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
            {errorMessage(series.error)}
          </p>
        ) : !series.isPending && points.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
            No requests in this window.
          </p>
        ) : (
          <AnalyticsGrid points={points} halfLabel={window.half} loading={series.isPending} />
        )}
      </PlanGated>

      {series.data?.window_clamped && (
        <p className="text-xs text-muted-foreground">
          The window was clamped to the retention this plan keeps.
        </p>
      )}
    </section>
  );
}
