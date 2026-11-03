import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, Refresh, ArrowRight } from 'iconoir-react';
import { Select } from '@/components/ui/field';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { useAppAnalyticsTimeseries, useAppsMetrics, type MetricsRange } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';
import { PlanGate } from './plan-gate';
import { WINDOWS } from './app-analytics-search';
import { HelpTip } from './kit/help-tip';
import {
  AnalyticsGrid,
  chosenCards,
  CATALOG,
  type AnalyticsCardSpec,
  type AnalyticsPoint,
} from './analytics-grid';
import {
  RangePicker,
  rangeHalfLabel,
  rangeLabel,
  rollupWindow,
  ROLLUP_PRESETS,
  type Range,
} from './range-picker';

const ACCOUNT_METRICS = [
  { id: 'requests', label: 'Requests' },
  { id: 'errors', label: 'Errors' },
  { id: 'error_rate', label: 'Error rate' },
  { id: 'wake_p95', label: 'Wake p95' },
];

/** One board, one scope, one time window. Account totals have no invented history. */
export function AnalyticsSection({
  apps,
  initialRange = '24h',
  onRangeChange,
  extras = [],
  onRefresh,
}: {
  apps: { slug: string }[];
  initialRange?: MetricsRange;
  onRangeChange?: (range: MetricsRange) => void;
  extras?: AnalyticsCardSpec[];
  onRefresh?: () => void;
}) {
  const id = useId();
  const { account } = useAuth();
  const paid = isPaidPlan(account?.plan);
  const [scope, setScope] = useState('');
  // A deleted app cannot leave the board querying an unreachable selection.
  const slug = apps.some((app) => app.slug === scope) ? scope : '';
  const [range, setRange] = useState<Range>({ kind: 'preset', value: initialRange });
  const [picking, setPicking] = useState(false);
  const since = range.kind === 'preset' ? range.value : range.since;
  const series = useAppAnalyticsTimeseries(paid ? slug : '', since, {
    until: range.kind === 'custom' ? range.until : undefined,
  });
  const rollup = useAppsMetrics(rollupWindow(range), { enabled: paid && !slug });
  const result = slug ? series : rollup;
  const degraded = !slug && rollup.data?.source !== 'prometheus';
  const phase = queryPhase({ error: result.error, loading: paid && result.isPending });
  const points = (series.data?.points ?? []) as AnalyticsPoint[];
  const rows = Object.values(rollup.data?.apps ?? {});
  const requests = rows.reduce((total, row) => total + row.request_count, 0);
  const errors = rows.reduce(
    (total, row) => total + (row.request_count * row.error_rate_pct) / 100,
    0
  );
  const wake = rows.find((row) => row.wake_p95_ms > 0)?.wake_p95_ms;
  const known = paid && phase === 'ready' && !degraded;
  const compact = (value: number) =>
    new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const accountCards: AnalyticsCardSpec[] = [
    {
      id: 'requests',
      label: 'Requests',
      span: 2,
      value: known ? compact(requests) : '—',
      delta: null,
      deltaGood: true,
      caption: `Across ${apps.length} apps · ${rangeLabel(range).toLowerCase()}`,
    },
    {
      id: 'errors',
      label: 'Errors',
      span: 1,
      value: known ? compact(Math.round(errors)) : '—',
      delta: null,
      deltaGood: false,
      caption: 'Derived from traffic-weighted error rates',
    },
    {
      id: 'error_rate',
      label: 'Error rate',
      span: 2,
      value: known ? `${(requests ? (errors / requests) * 100 : 0).toFixed(2)}%` : '—',
      delta: null,
      deltaGood: false,
      caption: 'Weighted by requests across apps',
    },
    {
      id: 'wake_p95',
      label: 'Wake p95',
      span: 1,
      value: known && wake ? `${Math.round(wake)} ms` : '—',
      delta: null,
      deltaGood: false,
      caption: 'Cold-start latency, fleet-wide',
    },
  ];
  const catalog = slug ? CATALOG : [...(paid ? ACCOUNT_METRICS : []), ...extras];
  const defaults = slug
    ? ['requests', 'errors', 'error_rate', 'p95', 'cold_boots']
    : catalog.filter((metric) => metric.id !== 'errors').map((metric) => metric.id);
  const drawn =
    slug && series.data?.window_clamped && series.data.since
      ? { kind: 'preset' as const, value: series.data.since }
      : range;
  const changeRange = (next: Range) => {
    setRange(next);
    if (
      next.kind === 'preset' &&
      ['5m', '15m', '1h', '6h', '24h', '7d', '15d'].includes(next.value)
    )
      onRangeChange?.(next.value as MetricsRange);
  };
  const refresh = () => {
    if (paid) void result.refetch();
    onRefresh?.();
  };
  return (
    <section aria-labelledby={id} className="relative flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id={id} className="text-base font-semibold">
            Analytics
          </h2>
          <HelpTip label="About analytics">
            All apps shows account totals. Choose an app for hourly history. Customize each view;
            your metric choices and order are saved in this browser.
          </HelpTip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Analytics scope"
            value={slug}
            disabled={!paid}
            onChange={(event) => {
              const next = event.target.value;
              setScope(next);
              setPicking(false);
              if (
                !next &&
                (range.kind === 'custom' ||
                  !ROLLUP_PRESETS.some((preset) => preset.value === range.value))
              )
                changeRange({ kind: 'preset', value: '24h' });
            }}
            className="max-w-52"
          >
            <option value="">All apps</option>
            {apps.map((app) => (
              <option key={app.slug} value={app.slug}>
                {app.slug}
              </option>
            ))}
          </Select>
          {paid && (
            <RangePicker
              range={drawn}
              onChange={changeRange}
              presets={slug ? undefined : ROLLUP_PRESETS}
              allowCustom={Boolean(slug)}
            />
          )}
          <button
            type="button"
            aria-label="Add a metric"
            onClick={() => setPicking(!picking)}
            className="pressable rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Refresh analytics"
            onClick={refresh}
            disabled={result.isFetching}
            className="pressable rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Refresh className="size-4" />
          </button>
        </div>
      </div>
      {!paid && (
        <PlanGate
          feature="Metrics"
          description="Request metrics require a paid plan. Your compute usage and resident instances remain available."
        />
      )}
      {paid && (phase === 'error' || phase === 'unreachable') && (
        <InlinePhase phase={phase} error={result.error} onRetry={refresh} />
      )}
      {paid && !slug && phase === 'ready' && degraded && (
        <p role="status" className="text-xs text-muted-foreground">
          Metrics degraded. Figures are unavailable for this window.
        </p>
      )}
      {slug && series.data?.window_clamped && (
        <p role="status" className="text-xs text-muted-foreground">
          Plan retention capped this to {series.data.since}.
        </p>
      )}
      {slug && phase === 'ready' && points.length === 0 ? (
        <InlinePhase phase="empty" emptyMessage="No requests in this window. Try another range." />
      ) : (
        <AnalyticsGrid
          key={`${slug ? 'app' : 'account'}-${paid}`}
          points={slug && phase === 'ready' ? points : []}
          storageKey={
            slug
              ? 'gregale.analytics.order'
              : extras.length
                ? 'gregale.analytics.overview.order'
                : 'gregale.analytics.account.order'
          }
          catalog={catalog}
          defaults={defaults}
          showAddSlot={Boolean(slug)}
          picking={picking}
          onPicking={setPicking}
          loading={paid && phase === 'loading'}
          build={(chosen) =>
            slug
              ? chosenCards(chosen, phase === 'ready' ? points : [], rangeHalfLabel(drawn)).map(
                  (card) => (phase === 'ready' ? card : { ...card, value: '—', delta: null })
                )
              : chosen.flatMap((key) =>
                  [...accountCards, ...extras].filter((card) => card.id === key)
                )
          }
        />
      )}
      {slug && (
        <div className="flex justify-end">
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: slug }}
            search={{ tab: 'Metrics', analyticsSince: WINDOWS.find((window) => window === since) }}
            className="pressable inline-flex items-center gap-1.5 rounded text-xs text-brand"
          >
            Explore {slug}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}
