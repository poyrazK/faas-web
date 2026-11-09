import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { appAnalyticsTimeseriesQuery } from '@/lib/api/queries';
import { queryPhase, type QueryPhase } from '../primitives';
import type { AppSeries } from './overview-data';

/** The stream and the hour field draw at most this many apps; the rest are counted, not drawn. */
export const MAX_CHARTED_APPS = 8;

export interface OverviewSeries {
  phase: QueryPhase;
  series: AppSeries[];
  /** Apps left out of the drawing because there were more than MAX_CHARTED_APPS. */
  uncharted: number;
  from?: string;
  until?: string;
  /** True when plan retention cut the window short; `since` is then the effective lookback. */
  clamped: boolean;
  since?: string;
  error: unknown;
  refetch: () => Promise<unknown>;
}

/**
 * Every charted app's hourly request series for one window. The busiest apps
 * come first (by the store's 24 h reading); a quiet account charts them all.
 */
export function useOverviewSeries(
  apps: { slug: string; name: string; weight: number }[],
  since: string,
  enabled: boolean
): OverviewSeries {
  const charted = useMemo(
    () => [...apps].sort((a, b) => b.weight - a.weight).slice(0, MAX_CHARTED_APPS),
    [apps]
  );
  const read = useQueries({
    queries: charted.map((app) => ({
      ...appAnalyticsTimeseriesQuery(app.slug, since),
      enabled,
      refetchInterval: 60_000,
    })),
    combine: (results) => ({
      data: results.map((r) => r.data),
      error: results.find((r) => r.error)?.error ?? null,
      pending: results.some((r) => r.isPending),
      refetch: () => Promise.allSettled(results.map((r) => r.refetch())),
    }),
  });

  const series: AppSeries[] = charted.flatMap((app, i) => {
    const data = read.data[i];
    return data ? [{ slug: app.slug, name: app.name, points: data.points }] : [];
  });
  const first = read.data.find(Boolean);

  return {
    phase: queryPhase({
      error: read.error,
      loading: enabled && read.pending,
      isEmpty: charted.length === 0,
    }),
    series,
    uncharted: Math.max(0, apps.length - charted.length),
    from: first?.from,
    until: first?.until,
    clamped: read.data.some((d) => d?.window_clamped),
    since: first?.since,
    error: read.error,
    refetch: read.refetch,
  };
}
