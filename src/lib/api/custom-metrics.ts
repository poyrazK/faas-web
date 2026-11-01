import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Custom metrics (faas ADR-202, history ADR-745). A metric has no definition
 * apart from its values: the first push of a name creates it, a push of the
 * same name replaces its value, and a delete frees its slot. Each is one
 * fleet-total gauge (or, sent over OTLP, a counter) with no unit or labels.
 */
export type CustomMetric = components['schemas']['CustomMetricResponse'];
export type CustomMetricList = components['schemas']['CustomMetricListResponse'];
export type CustomMetricRange = NonNullable<
  components['schemas']['CustomMetricSeriesResponse']['range']
>;

export const CUSTOM_METRIC_RANGES: CustomMetricRange[] = ['1h', '6h', '24h', '7d', '15d'];
/** apid's `CustomMetricNameMaxBytes` (pkg/api/limits.go). */
export const CUSTOM_METRIC_NAME_MAX = 63;
/** apid's `CustomMetricMaxValue` (pkg/api/limits.go). */
export const CUSTOM_METRIC_MAX_VALUE = 1e12;

const key = (slug: string) => ['apps', slug, 'custom-metrics'] as const;

export function useCustomMetrics(slug: string) {
  return useQuery({
    queryKey: key(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/custom-metrics', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    // Freshness is decided server-side against the clock, so re-read now and
    // then: a row turns stale with no push at all.
    refetchInterval: 60_000,
  });
}

export function usePushCustomMetric(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: number }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/custom-metrics/{name}', {
          params: { path: { slug, name } },
          body: { value },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function useDeleteCustomMetric(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/custom-metrics/{name}', { params: { path: { slug, name } } })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

/**
 * One metric's recorded history — Prometheus range buckets, so it may be
 * charted. `enabled` carries the `custom-metric-history` capability: a hidden
 * capability answers 404, and an installation without the operator flag
 * answers 503 `custom_metric_history_unavailable`, which no retry fixes.
 */
export function useCustomMetricSeries(
  slug: string,
  name: string,
  range: CustomMetricRange,
  { enabled }: { enabled: boolean }
) {
  return useQuery({
    queryKey: [...key(slug), name, 'series', range],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/custom-metrics/{name}/series', {
          params: { path: { slug, name }, query: { range } },
          signal,
        })
      ),
    enabled: enabled && Boolean(slug && name),
    retry: (count, error) =>
      !(error instanceof ApiError && error.code === 'custom_metric_history_unavailable') &&
      retryPolicy(count, error),
  });
}

/** apid's ValidateCustomMetricName: `[a-z][a-z0-9_]{0,62}`. */
export function customMetricNameError(name: string): string | undefined {
  if (!name) return 'Enter a name.';
  if (name.length > CUSTOM_METRIC_NAME_MAX)
    return `Use at most ${CUSTOM_METRIC_NAME_MAX} characters.`;
  if (!/^[a-z]/.test(name)) return 'Start with a lowercase letter.';
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return 'Use lowercase letters, digits and underscores only.';
  return undefined;
}

/** apid's ValidateCustomMetricValue: finite, >= 0, <= 1e12. */
export function customMetricValueError(text: string): string | undefined {
  const value = text.trim() === '' ? NaN : Number(text);
  if (!Number.isFinite(value)) return 'Enter a number.';
  if (value < 0) return 'Use 0 or more: a negative backlog has no meaning.';
  if (value > CUSTOM_METRIC_MAX_VALUE)
    return `Use at most ${CUSTOM_METRIC_MAX_VALUE.toLocaleString('en-US')}.`;
  return undefined;
}
