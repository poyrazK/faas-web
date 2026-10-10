import { useCallback, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  postgresBindingsOptions,
  useApps,
  useAppsMetrics,
  useCrons,
  useDomains,
  usePostgresDatabases,
} from '@/lib/api/queries';
import { bucketListOptions } from '@/lib/api/object-storage';
import { ApiError } from '@/lib/api/errors';
import { queryPhase, type QueryPhase } from '@/components/dashboard/primitives';
import {
  buildTopology,
  type PostgresBinding,
  type PostgresDatabase,
  type Read,
  type Topology,
} from './topology';

type QueryLike<T> = { data?: T; error: unknown; isPending: boolean; fetchStatus: string };

/** A disabled query reports `isPending` forever; only a fetching one is loading. */
export function toRead<T>(q: QueryLike<T>): Read<T> {
  if (q.data !== undefined) return { status: 'ready', data: q.data };
  if (q.error) return { status: 'error', error: q.error };
  return { status: 'loading' };
}

/**
 * Managed Postgres is an internal capability. An account without it answers
 * 403 or 404, which is "there is no Postgres here", not a failure to draw.
 */
export function postgresRead(
  databases: QueryLike<{ items: PostgresDatabase[] }>,
  bindings: QueryLike<{ items: PostgresBinding[] }>[]
): Read<{ databases: PostgresDatabase[]; bindings: PostgresBinding[]; failedBindings: string[] }> {
  if (
    databases.error instanceof ApiError &&
    (databases.error.isForbidden || databases.error.isNotFound)
  ) {
    return { status: 'ready', data: { databases: [], bindings: [], failedBindings: [] } };
  }
  const dbs = toRead(databases);
  if (dbs.status !== 'ready') return dbs;
  const reads = bindings.map(toRead);
  if (reads.some((r) => r.status === 'loading')) return { status: 'loading' };
  // One database's unreadable bindings must not hide the others: keep every
  // database, keep the bindings that did load, and name the ones that did not.
  return {
    status: 'ready',
    data: {
      databases: dbs.data.items,
      bindings: reads.flatMap((r) => (r.status === 'ready' ? r.data.items : [])),
      failedBindings: dbs.data.items
        .filter((_, i) => reads[i]?.status === 'error')
        .map((d) => d.id),
    },
  };
}

/**
 * Narrows each `useQueries` result to the fields a read needs. Module-level
 * on purpose: TanStack re-runs a stable `combine` only when a result changes,
 * so the array keeps its identity across unrelated re-renders.
 */
function pickReads<T>(results: QueryLike<T>[]): QueryLike<T>[] {
  return results.map(({ data, error, isPending, fetchStatus }) => ({
    data,
    error,
    isPending,
    fetchStatus,
  }));
}

/** Every query family the canvas draws from, for Retry. */
const FAMILIES = ['apps', 'domains', 'crons', 'object-buckets', 'postgres'] as const;

export function useTopology(): {
  phase: QueryPhase;
  error: unknown;
  topology: Topology;
  retry: () => void;
  /** Re-reads one app's per-app connections. */
  retryApp: (slug: string) => void;
  /** Every per-app and Postgres read has answered, so the graph is complete. */
  settled: boolean;
} {
  const qc = useQueryClient();
  const apps = useApps();
  const domains = useDomains();
  const crons = useCrons();
  const metrics = useAppsMetrics('24h', { retry: false });
  const databases = usePostgresDatabases();

  const slugs = useMemo(() => (apps.data ?? []).map((a) => a.slug), [apps.data]);
  // Per-app reads wait for the app list, so none of them is a disabled
  // query masquerading as loading.
  const buckets = useQueries({
    queries: slugs.map((slug) => bucketListOptions(slug)),
    combine: pickReads,
  });
  const bindings = useQueries({
    queries: (databases.data?.items ?? []).map((db) => postgresBindingsOptions(db.id)),
    combine: pickReads,
  });

  // Query results are fresh objects every render; key the reads on the data
  // and error they carry so the topology, layout and flow keep their identity
  // until something actually changed. React Flow re-measures every node it
  // is handed as new.
  const metricsRead = useMemo(
    () => toRead({ data: metrics.data, error: metrics.error, isPending: false, fetchStatus: '' }),
    [metrics.data, metrics.error]
  );
  const postgres = useMemo(
    () =>
      postgresRead(
        { data: databases.data, error: databases.error, isPending: false, fetchStatus: '' },
        bindings
      ),
    [databases.data, databases.error, bindings]
  );

  const error = apps.error ?? domains.error ?? crons.error;
  const phase = queryPhase({
    error,
    loading: apps.isPending || domains.isPending || crons.isPending,
    isEmpty: apps.data?.length === 0,
  });

  const topology = useMemo(
    () =>
      buildTopology({
        apps: apps.data ?? [],
        domains: domains.data ?? [],
        crons: crons.data ?? [],
        metrics: metricsRead,
        buckets: Object.fromEntries(slugs.map((slug, i) => [slug, toRead(buckets[i])])),
        postgres,
      }),
    [apps.data, domains.data, crons.data, metricsRead, slugs, buckets, postgres]
  );

  const settled =
    !apps.isPending && buckets.every((b) => !b.isPending) && postgres.status !== 'loading';
  // Stable identities: these flow into node data, and a new function per
  // render would rebuild every node and re-trigger React Flow's store sync.
  const retryApp = useCallback(
    (slug: string) => void qc.invalidateQueries({ queryKey: ['object-buckets', slug] }),
    [qc]
  );
  const retry = useCallback(() => {
    for (const family of FAMILIES) void qc.invalidateQueries({ queryKey: [family] });
  }, [qc]);

  return { phase, error, topology, retry, retryApp, settled };
}
