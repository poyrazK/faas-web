import { useState } from 'react';
import { Plus, Refresh } from 'iconoir-react';
import { AppSelect } from '@/components/dashboard/app-select';
import { isPlanGate } from '@/components/dashboard/plan-gated';
import { errorMessage } from '@/lib/api/errors';
import { useAppAnalyticsTimeseries, useAppsMetrics } from '@/lib/api/queries';
import {
  AnalyticsGrid,
  chosenCards,
  scalarCards,
  type AnalyticsPoint,
  type AppMetricsRow,
} from './analytics-grid';
import {
  RangePicker,
  rangeHalfLabel,
  rollupWindow,
  ROLLUP_PRESETS,
  type Range,
} from './range-picker';

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

export function AnalyticsSection({
  apps,
  slug,
  onSelectApp,
}: {
  apps: { slug: string }[];
  slug: string;
  onSelectApp: (slug: string) => void;
}) {
  const [range, setRange] = useState<Range>({ kind: 'preset', value: '24h' });
  const [picking, setPicking] = useState(false);
  const since = range.kind === 'preset' ? range.value : range.since;
  const until = range.kind === 'custom' ? range.until : undefined;
  const series = useAppAnalyticsTimeseries(slug, since, until);
  // Free has no hourly series (`DebugTelemetryEnabled`), but it does have the
  // account rollup — same metrics, no history. So the gate costs the charts and
  // the deltas, not the section. The Overview already holds this query, so the
  // fallback is a cache hit rather than a second request.
  const gated = isPlanGate(series.error);
  const rollupRange = rollupWindow(range);
  const rollup = useAppsMetrics(rollupRange, { enabled: gated });
  const row = rollup.data?.apps?.[slug] as AppMetricsRow | undefined;
  const points = (gated ? [] : (series.data?.points ?? [])) as AnalyticsPoint[];
  // The server clamps to what the plan retains. When it does, the control says
  // what was drawn rather than what was asked for — a button still reading
  // "Last 14 days" over three days of data is the console lying about its own
  // chart.
  const drawn: Range =
    series.data?.window_clamped && series.data.since
      ? { kind: 'preset', value: series.data.since }
      : range;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Not "Analytics": the overview already has a section of that name
            carrying the account's scalars. This one is the request series for
            one app, and the picker beside it says which. */}
        <h2 id="analytics-heading" className="text-sm font-semibold">
          Request analytics
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect slug={slug} onSelect={onSelectApp} apps={apps} />
          <RangePicker
            range={drawn}
            onChange={setRange}
            presets={gated ? ROLLUP_PRESETS : undefined}
            allowCustom={!gated}
          />
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label="Add a metric"
            className="pressable rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
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

      {series.error && !gated ? (
        <p className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          {errorMessage(series.error)}
        </p>
      ) : gated && rollup.error ? (
        <p className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          {errorMessage(rollup.error)}
        </p>
      ) : gated && !rollup.isPending && !row ? (
        <p className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          No metrics for this app in this window.
        </p>
      ) : !gated && !series.isPending && points.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          No requests in this window.
        </p>
      ) : (
        <AnalyticsGrid
          points={points}
          build={(chosen) =>
            gated
              ? row
                ? scalarCards(chosen, row)
                : []
              : chosenCards(chosen, points, rangeHalfLabel(drawn))
          }
          loading={gated ? rollup.isPending : series.isPending}
          picking={picking}
          onPicking={setPicking}
        />
      )}

      {gated && (
        <p className="text-xs text-muted-foreground">
          These are the current figures. Hourly history, trends and charts need Hobby or above.
        </p>
      )}

      {series.data?.window_clamped && (
        <p className="text-xs text-muted-foreground">
          Plan retention capped this to {series.data.since}.
        </p>
      )}
    </section>
  );
}
