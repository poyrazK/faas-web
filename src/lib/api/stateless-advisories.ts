import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * The stateless contract as faas observes it at runtime (ADR-047). Guest init
 * watches a fixed set of state-shaped directories with fanotify; each debounced
 * batch of writes becomes one `stateless.advisory` audit row, attributed to the
 * app (not to a deployment) through `data.app_id`
 * (faas pkg/apid/apidserver/advisory_receiver.go:80). The rows are stored, so
 * reading them costs nothing and nothing is re-run here. Observation only: the
 * app keeps running, and writes outside the watched set are never reported.
 *
 * The deploy-time half of the contract (VOLUME, stateful base images, data/ and
 * db/ directories) fails the deployment with `stateless_only_violation`, which
 * the release drawer's failure panel already shows from the deployment row.
 */

export type AuditEvent = components['schemas']['AuditEventResponse'];

export const ADVISORY_KIND = 'stateless.advisory';
/** The handler's ceiling (faas handlers_audit.go:65); a noisy app fills it fast. */
export const ADVISORY_LIMIT = 100;

/** `GET /v1/audit-events?kind_prefix=stateless.advisory&app_id=…`, indexed per app. */
export function useStatelessAdvisories(appId: string) {
  return useQuery({
    queryKey: ['audit-events', ADVISORY_KIND, appId],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/audit-events', {
          params: { query: { kind_prefix: ADVISORY_KIND, app_id: appId, limit: ADVISORY_LIMIT } },
          signal,
        })
      ),
    enabled: Boolean(appId),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}

/**
 * The watched directories (faas guest/init/stateless_advisory_linux.go:77) and
 * what to use instead. `high` mirrors advisory_receiver.go:239; every other
 * watched path is `warn`. The daemon hints are faas pkg/statefuldenylist's,
 * and the generic one is ErrStatelessOnlyViolation's (pkg/api/errors.go:3390).
 */
const GENERIC_FIX =
  'Use a managed service (S3, R2, Neon, Upstash, MongoDB Atlas) for anything that must survive a park.';
const WATCHED: { root: string; severity: 'high' | 'warn'; fix: string }[] = [
  { root: '/data', severity: 'high', fix: GENERIC_FIX },
  { root: '/db', severity: 'high', fix: GENERIC_FIX },
  { root: '/var/lib/postgresql', severity: 'high', fix: 'Use Neon or Supabase Postgres.' },
  { root: '/var/lib/mysql', severity: 'high', fix: 'Use PlanetScale.' },
  { root: '/var/lib/redis', severity: 'warn', fix: 'Use Upstash Redis.' },
  { root: '/var/lib/mongodb', severity: 'warn', fix: 'Use MongoDB Atlas.' },
  { root: '/var/lib/mongo', severity: 'warn', fix: 'Use MongoDB Atlas.' },
  { root: '/var/lib/cockroach', severity: 'warn', fix: 'Use CockroachDB Cloud.' },
  { root: '/var/lib/cassandra', severity: 'warn', fix: 'Use Astra DB.' },
  { root: '/var/lib/clickhouse', severity: 'warn', fix: 'Use ClickHouse Cloud.' },
];

export interface StatelessFinding {
  /** The watched directory written under. */
  root: string;
  severity: 'high' | 'warn';
  /** Distinct paths written, first seen first. */
  paths: string[];
  /** The fanotify verbs seen: create, modify, move, access, delete, other. */
  operations: string[];
  /** Advisory batches that touched this directory. */
  batches: number;
  /** Individual writes across those batches. */
  writes: number;
  lastSeen: string;
  instances: string[];
  fix: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function watchedRoot(path: string) {
  return WATCHED.find(({ root }) => path === root || path.startsWith(`${root}/`));
}

/** Newest-first audit rows → one finding per watched directory, high first. */
export function statelessFindings(events: AuditEvent[]): StatelessFinding[] {
  const byRoot = new Map<string, StatelessFinding & { seenIn: Set<string> }>();
  for (const event of events) {
    if (event.kind !== ADVISORY_KIND) continue;
    const writes = Array.isArray(event.data.events) ? event.data.events : [];
    const instance = text(event.data.instance);
    for (const write of writes as Record<string, unknown>[]) {
      const path = text(write?.path);
      if (!path) continue;
      const watched = watchedRoot(path);
      const root = watched?.root ?? path;
      let finding = byRoot.get(root);
      if (!finding) {
        finding = {
          root,
          severity: watched?.severity ?? 'warn',
          paths: [],
          operations: [],
          batches: 0,
          writes: 0,
          lastSeen: event.at,
          instances: [],
          fix: watched?.fix ?? GENERIC_FIX,
          seenIn: new Set(),
        };
        byRoot.set(root, finding);
      }
      finding.writes += 1;
      if (!finding.seenIn.has(event.id)) {
        finding.seenIn.add(event.id);
        finding.batches += 1;
      }
      if (!finding.paths.includes(path)) finding.paths.push(path);
      for (const verb of text(write.mask).split(',').filter(Boolean))
        if (!finding.operations.includes(verb)) finding.operations.push(verb);
      if (instance && !finding.instances.includes(instance)) finding.instances.push(instance);
      if (Date.parse(event.at) > Date.parse(finding.lastSeen)) finding.lastSeen = event.at;
    }
  }
  return [...byRoot.values()]
    .map(({ seenIn: _seenIn, ...finding }) => finding)
    .sort(
      (a, b) =>
        Number(b.severity === 'high') - Number(a.severity === 'high') ||
        Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
    );
}
