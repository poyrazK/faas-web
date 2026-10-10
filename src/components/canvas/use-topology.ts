import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
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
): Read<{ databases: PostgresDatabase[]; bindings: PostgresBinding[] }> {
  if (
    databases.error instanceof ApiError &&
    (databases.error.isForbidden || databases.error.isNotFound)
  ) {
    return { status: 'ready', data: { databases: [], bindings: [] } };
  }
  const dbs = toRead(databases);
  if (dbs.status !== 'ready') return dbs;
  const reads = bindings.map(toRead);
  const failed = reads.find((r) => r.status === 'error');
  if (failed) return failed;
  if (reads.some((r) => r.status === 'loading')) return { status: 'loading' };
  return {
    status: 'ready',
    data: {
      databases: dbs.data.items,
      bindings: reads.flatMap((r) => (r.status === 'ready' ? r.data.items : [])),
    },
  };
}

export function useTopology(): {
  phase: QueryPhase;
  error: unknown;
  topology: Topology;
  retry: () => void;
} {
  const apps = useApps();
  const domains = useDomains();
  const crons = useCrons();
  const metrics = useAppsMetrics('24h', { retry: false });
  const databases = usePostgresDatabases();

  const slugs = useMemo(() => (apps.data ?? []).map((a) => a.slug), [apps.data]);
  // Per-app reads wait for the app list, so none of them is a disabled
  // query masquerading as loading.
  const buckets = useQueries({ queries: slugs.map((slug) => bucketListOptions(slug)) });
  const bindings = useQueries({
    queries: (databases.data?.items ?? []).map((db) => postgresBindingsOptions(db.id)),
  });

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
        metrics: toRead(metrics),
        buckets: Object.fromEntries(slugs.map((slug, i) => [slug, toRead(buckets[i])])),
        postgres: postgresRead(databases, bindings),
      }),
    [apps.data, domains.data, crons.data, metrics, slugs, buckets, databases, bindings]
  );

  const retry = () => {
    void apps.refetch();
    void domains.refetch();
    void crons.refetch();
  };

  return { phase, error, topology, retry };
}
