import { useState } from 'react';
import { useAppAnalytics, useAppAnalyticsTimeseries } from '@/lib/api/queries';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { AnalyticsGrid, chosenCards, type AnalyticsPoint } from './analytics-grid';
import { metricValue, incompleteTelemetry, METRIC_SERIES, utcLabel } from './analytics-data';
import { isDetailMetric } from './metric-detail-search';
import { useMetricInspector } from './metric-inspector';
import { InlinePhase, queryPhase } from './primitives';
import { PlanGated } from './plan-gated';
import { WINDOWS } from './app-analytics-search';
import { rangeHalfLabel } from './range-picker';
import { HelpTip } from './kit/help-tip';

/** Shared compact history for an app Overview and Account Analytics' selected app. */
export function AppAnalyticsPreview({
  slug,
  since = '24h',
  onSinceChange,
  storageKey = 'gregale.analytics.app-overview.order',
}: {
  slug: string;
  since?: string;
  onSinceChange?: (value: string) => void;
  storageKey?: string;
}) {
  const inspect = useMetricInspector();
  const summary = useAppAnalytics(slug, since, 'route');
  const series = useAppAnalyticsTimeseries(slug, since);
  const [picking, setPicking] = useState(false);
  const phase = queryPhase({
    error: summary.error,
    loading: summary.isPending,
    isEmpty: !summary.data,
  });
  const historyPhase = queryPhase({ error: series.error, loading: series.isPending });
  const data = phase === 'ready' ? summary.data : undefined;
  const points = (historyPhase === 'ready' ? (series.data?.points ?? []) : []) as AnalyticsPoint[];
  return (
    <PlanGated error={summary.error ?? series.error} feature="Request analytics">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Hourly requests for <span className="text-foreground">{slug}</span> · UTC
          </p>
          <div className="flex items-center gap-2">
            {onSinceChange && (
              <Select
                aria-label="Traffic time range"
                value={since}
                onChange={(event) => onSinceChange(event.target.value)}
              >
                {WINDOWS.map((window) => (
                  <option key={window} value={window}>
                    Last {window}
                  </option>
                ))}
              </Select>
            )}
            <Button size="xs" variant="outline" onClick={() => setPicking(!picking)}>
              Add metric
            </Button>
          </div>
        </div>
        {phase === 'loading' && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading traffic signals…
          </p>
        )}
        {(phase === 'empty' || phase === 'error' || phase === 'unreachable') && (
          <p className="text-xs text-muted-foreground">Traffic metrics are unavailable.</p>
        )}
        {phase !== 'ready' && phase !== 'loading' && (
          <InlinePhase phase={phase} error={summary.error} onRetry={() => void summary.refetch()} />
        )}
        {historyPhase !== 'ready' && historyPhase !== 'loading' && (
          <InlinePhase
            phase={historyPhase}
            error={series.error}
            onRetry={() => void series.refetch()}
          />
        )}
        <AnalyticsGrid
          points={points}
          storageKey={storageKey}
          defaults={['requests', 'error_rate', 'p95', 'cold_boots']}
          picking={picking}
          onPicking={setPicking}
          showAddSlot={false}
          loading={phase === 'loading'}
          historyState={
            historyPhase === 'loading'
              ? 'loading'
              : historyPhase === 'ready'
                ? 'ready'
                : 'unavailable'
          }
          onInspect={(metric) => {
            if (isDetailMetric(metric))
              inspect({
                metric,
                app: slug,
                since: series.data?.from ?? since,
                until: series.data?.until,
              });
          }}
          build={(chosen) =>
            chosenCards(chosen, points, rangeHalfLabel({ kind: 'preset', value: since }), {
              from: series.data?.from,
              until: series.data?.until,
              incomplete: incompleteTelemetry(series.data) || incompleteTelemetry(data),
            }).map((card) => {
              if (!data || !isDetailMetric(card.id)) return { ...card, value: '—', delta: null };
              const key = METRIC_SERIES[card.id];
              const value = key ? Number(data[key as keyof typeof data]) : null;
              const latency = ['p50', 'p95', 'p99'].includes(card.id);
              return {
                ...card,
                value: metricValue(
                  card.id,
                  !data.requests && (latency || card.id === 'error_rate') ? null : value,
                  true
                ),
                caption: latency ? 'Percentile of recorded responses in this window' : card.caption,
              };
            })
          }
        />
        <p className="flex flex-wrap items-center gap-1 text-xs leading-relaxed text-muted-foreground">
          {series.data?.from && series.data.until
            ? `${utcLabel(series.data.from)} – ${utcLabel(series.data.until)} UTC`
            : ''}
          <HelpTip label="About these changes">
            Changes compare equal groups of complete UTC hours within this window. Partial hours are
            excluded.
          </HelpTip>
        </p>
        {series.data?.window_clamped && (
          <p role="status" className="text-xs text-muted-foreground">
            This window is limited to your plan’s retained history.
          </p>
        )}
        {(incompleteTelemetry(summary.data) || incompleteTelemetry(series.data)) && (
          <p role="status" className="text-xs text-status-warning">
            Some request records are missing. These figures may be incomplete.
          </p>
        )}
      </div>
    </PlanGated>
  );
}
