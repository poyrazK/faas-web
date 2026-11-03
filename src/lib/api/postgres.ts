import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { useWorkspaceTarget } from './workspace-apps';

/**
 * Managed PostgreSQL beyond the database list in queries.ts: the month's
 * usage and compute cap, the plan's capabilities, compute overage, a
 * database's conditions and connection planning, and undelete and purge
 * (faas ADR-20261031091607, docs/postgres.md).
 *
 * **The workspace decides the route.** A company workspace reads and writes
 * under `/v1/orgs/{organization}/postgres/…` (faas org_postgres_routes.go),
 * and never falls back to the account's own numbers. The organization routes
 * have usage, capabilities, undelete and purge, but no overage setting, no
 * conditions and no connection budget: those three are read for the personal
 * workspace only, and the page says so in a company one.
 */

export type PostgresUsage = components['schemas']['ManagedPostgresUsageResponse'];
export type PostgresCapabilities = components['schemas']['ManagedPostgresCapabilities'];
export type PostgresOverage = components['schemas']['ManagedPostgresOverage'];
export type PostgresStatus = components['schemas']['ResourceStatus'];
export type PostgresCondition = components['schemas']['Condition'];
export type PostgresConnectionBudget = components['schemas']['ManagedPostgresConnectionBudget'];
type Database = components['schemas']['ManagedPostgresDatabase'];

/** Everything Postgres for one workspace sits under this prefix. */
const scope = (org: string | null) => ['postgres', org ?? 'personal'] as const;
export const postgresKey = (org: string | null) => [...scope(org), 'databases'] as const;
const usageKey = (org: string | null) => [...scope(org), 'usage'] as const;
const overageKey = [...scope(null), 'overage'] as const;

/**
 * Whether the list should poll: a database the provider is still working on.
 * A scheduled delete is `deleting` for its whole seven-day window, so it is
 * left out, or the page would poll for a week.
 */
export function postgresDatabasesSettling(items: readonly Database[]): boolean {
  return items.some(
    (d) =>
      d.state === 'provisioning' ||
      d.state === 'updating' ||
      (d.state === 'deleting' && !d.restorable_until)
  );
}

/**
 * The current UTC month: compute against the allowance, the cap state, and
 * the plan's database and storage limits. It can trail the databases by up
 * to two hours (docs/postgres.md § Usage and limits).
 */
export function usePostgresUsage() {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: usageKey(org),
    queryFn: ({ signal }) =>
      org
        ? unwrap(
            api.GET('/v1/orgs/{organization}/postgres/usage', {
              params: { path: { organization: org } },
              signal,
            })
          )
        : unwrap(api.GET('/v1/account/managed-postgres-usage', { signal })),
    enabled: ready,
  });
}

/** What the plan and region support, without any provider call. */
export function usePostgresCapabilities(region?: string) {
  const { org, ready } = useWorkspaceTarget();
  const query = region ? { region } : undefined;
  return useQuery({
    queryKey: [...scope(org), 'capabilities', region ?? ''],
    queryFn: ({ signal }) =>
      org
        ? unwrap(
            api.GET('/v1/orgs/{organization}/postgres/capabilities', {
              params: { path: { organization: org }, ...(query ? { query } : {}) },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/postgres/capabilities', {
              ...(query ? { params: { query } } : {}),
              signal,
            })
          ),
    enabled: ready,
    staleTime: 5 * 60_000,
  });
}

/**
 * The account's overage setting. `offered` is the caller's gate: the
 * `postgres-overage` capability ships `internal`, and apid answers its route
 * as missing for an account it is not released to.
 */
export function usePostgresOverage(offered: boolean) {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: overageKey,
    queryFn: ({ signal }) => unwrap(api.GET('/v1/postgres/overage', { signal })),
    enabled: offered && ready && !org,
  });
}

/** A PUT of the value, so a retry sets the same thing again. */
export function useSetPostgresOverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(api.PUT('/v1/postgres/overage', { body: { enabled } })),
    onSuccess: (data) => {
      qc.setQueryData(overageKey, data);
      void qc.invalidateQueries({ queryKey: usageKey(null) });
    },
  });
}

/**
 * Ready, Progressing and Degraded, derived when read (resource-conditions,
 * preview). Polls while something is in progress, except a scheduled delete,
 * which stays in progress for its whole window.
 */
export function usePostgresStatus(id: string, enabled: boolean) {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: [...postgresKey(null), id, 'status'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/postgres/databases/{id}/status', { params: { path: { id } }, signal })),
    enabled: enabled && ready && !org && Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.conditions.some(
        (c) => c.type === 'Progressing' && c.status === 'True' && c.reason !== 'deleting'
      )
        ? 5_000
        : false,
  });
}

/** Planning metadata only: it wakes nothing and reserves nothing. */
export function usePostgresConnectionBudget(id: string) {
  const { org, ready } = useWorkspaceTarget();
  return useQuery({
    queryKey: [...postgresKey(null), id, 'connection-budget'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/postgres/databases/{id}/connection-budget', {
          params: { path: { id } },
          signal,
        })
      ),
    enabled: ready && !org && Boolean(id),
  });
}

/**
 * Returns a database whose delete is scheduled to ready, while
 * `restorable_until` is in the future. `idempotencyKey` is the caller's per
 * intent: apid answers a second undelete of a ready database with 404, so a
 * retry after a lost response must replay the first answer instead.
 */
export function useUndeletePostgresDatabase() {
  const qc = useQueryClient();
  const { org } = useWorkspaceTarget();
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: { id: string; idempotencyKey: string }) => {
      const header = { 'Idempotency-Key': idempotencyKey };
      return org
        ? unwrap(
            api.POST('/v1/orgs/{organization}/postgres/databases/{id}/undelete', {
              params: { path: { organization: org, id }, header },
            })
          )
        : unwrap(
            api.POST('/v1/postgres/databases/{id}/undelete', { params: { path: { id }, header } })
          );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postgresKey(org) });
      void qc.invalidateQueries({ queryKey: usageKey(org) });
    },
  });
}

/** Deletes at once, including a database whose delete is scheduled. Final. */
export function usePurgePostgresDatabase() {
  const qc = useQueryClient();
  const { org } = useWorkspaceTarget();
  return useMutation({
    mutationFn: (id: string) =>
      org
        ? unwrap(
            api.DELETE('/v1/orgs/{organization}/postgres/databases/{id}', {
              params: { path: { organization: org, id }, query: { purge: true } },
            })
          )
        : unwrap(
            api.DELETE('/v1/postgres/databases/{id}', {
              params: { path: { id }, query: { purge: true } },
            })
          ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postgresKey(org) });
      void qc.invalidateQueries({ queryKey: usageKey(org) });
    },
  });
}
