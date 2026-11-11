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
import { CARD_CAPTION, CARD_MEANING, trafficSentence } from './app-overview-words';

/**
 * Shared compact history for an app Overview and Account Analytics' selected
 * app. It opens with one sentence from the window's summary, the cards carry
 * short labels, and what each figure means — plus the window's exact UTC
 * bounds and how changes are compared — sits in one tip.
 */
export function AppAnalyticsPreview({
  slug,
  since = '24h',
  onSinceChange,
  storageKey = 'gregale.analytics.app-overview.order',
  heading,
}: {
  slug: string;
  since?: string;
  onSinceChange?: (value: string) => void;
  storageKey?: string;
  /** A section title, when the preview is a section of its own. */
  heading?: string;
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
  const bounds =
    series.data?.from && series.data.until
      ? `${utcLabel(series.data.from)} – ${utcLabel(series.data.until)}`
      : '';
  // A window cut short by the plan's retention is no longer "the last 7 days".
  const sentence = trafficSentence(
    data,
    data?.window_clamped || series.data?.window_clamped ? '' : since
  );
  return (
    <PlanGated error={summary.error ?? series.error} feature="Request analytics">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {heading ? (
              <h2 className="text-base font-medium">{heading}</h2>
            ) : (
              <p className="text-xs text-muted-foreground">Hourly · UTC</p>
            )}
            <HelpTip label="About these figures">
              <span className="flex flex-col gap-2">
                <span>
                  Hourly requests for <span className="text-foreground">{slug}</span>
                  {bounds ? `, ${bounds} UTC` : ', in UTC'}.
                </span>
                {CARD_MEANING.map((item) => (
                  <span key={item.id}>
                    <span className="text-foreground">{item.label}:</span> {item.text}
                  </span>
                ))}
                <span>
                  Changes compare equal groups of complete UTC hours within this window. Partial
                  hours are excluded.
                </span>
              </span>
            </HelpTip>
          </div>
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
            <Button size="xs" variant="ghost" onClick={() => setPicking(!picking)}>
              Add metric
            </Button>
          </div>
        </div>
        {sentence && <p className="text-[15px] leading-6">{sentence}</p>}
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
              if (!data || !isDetailMetric(card.id))
                return {
                  ...card,
                  value: '—',
                  delta: null,
                  caption: CARD_CAPTION[card.id] ?? card.caption,
                };
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
                caption: CARD_CAPTION[card.id] ?? card.caption,
              };
            })
          }
        />
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
