import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api, issueCSRF, unwrap } from './client';
import { ApiError } from './errors';
import type { components } from './schema';

/**
 * Query hooks over the REST surface.
 *
 * Keys are arrays whose first element names the resource, so a mutation can
 * invalidate a whole family (`['apps']`) without enumerating every variant.
 *
 * Nothing here retries a 4xx: a 401, 403, 404, or 422 is a settled answer, and
 * retrying it only delays the error the user needs to see. 429 and 5xx are the
 * retryable cases and `ApiError.isRetryable` is the single place that decides.
 */

export type App = components['schemas']['AppResponse'];
export type Deployment = components['schemas']['DeploymentResponse'];
export type AppMetrics = components['schemas']['AppMetricsResponse'];
export type MetricsRange = AppMetrics['range'];
export type MFAEnrollment = components['schemas']['MFAEnrollResponse'];
export type OperatorRuntimeConfig = components['schemas']['OperatorRuntimeConfig'];
export type OperatorRuntimeConfigOperation =
  components['schemas']['OperatorRuntimeConfigOperation'];
export type OperatorRuntimeConfigRevision = components['schemas']['OperatorRuntimeConfigRevision'];
export type OperatorOverview = components['schemas']['ObsOverviewResponse'];
export type OperatorCapacity = components['schemas']['ObsCapacityResponse'];
export type OperatorTenant = components['schemas']['ObsTenantRow'];
export type OperatorTenant360 = components['schemas']['ObsTenant360Response'];
export type OperatorTenantActivity = components['schemas']['ObsTenantActivityResponse'];
export type OperatorNode = components['schemas']['ObsNodeRow'];
export type OperatorNodeDetail = components['schemas']['ObsNodeDetailResponse'];
export type OperatorAppDetail = components['schemas']['ObsAppDetailResponse'];
export type OperatorInstance = components['schemas']['ObsInstanceRow'];
export type OperatorIntent = components['schemas']['OperatorIntentResponse'];
export type OperatorIntentAccepted = components['schemas']['OperatorIntentAcceptedResponse'];

export const keys = {
  account: ['account'] as const,
  apps: ['apps'] as const,
  app: (slug: string) => ['apps', slug] as const,
  appsMetrics: (range: MetricsRange) => ['apps', 'metrics', range] as const,
  appMetrics: (slug: string, range: MetricsRange) => ['apps', slug, 'metrics', range] as const,
  deployments: ['deployments'] as const,
  appDeployments: (slug: string) => ['apps', slug, 'deployments'] as const,
  domains: ['domains'] as const,
  crons: ['crons'] as const,
  keys: ['keys'] as const,
  invoices: ['invoices'] as const,
  usage: ['usage'] as const,
  usageSummary: ['usage', 'summary'] as const,
  instances: ['instances'] as const,
  invocations: ['invocations'] as const,
  auditLog: ['audit-log'] as const,
  operatorRuntimeConfig: ['operator', 'runtime-config'] as const,
  operatorRuntimeConfigEntry: (key: string) => ['operator', 'runtime-config', key] as const,
  operatorRuntimeConfigRevisions: (key: string) =>
    ['operator', 'runtime-config', key, 'revisions'] as const,
  operatorRuntimeConfigOperation: (id: string) =>
    ['operator', 'runtime-config', 'operations', id] as const,
  operatorOverview: ['operator', 'overview'] as const,
  operatorCapacity: ['operator', 'capacity'] as const,
  operatorTenants: (cursor?: string) => ['operator', 'tenants', cursor ?? 'first'] as const,
  operatorTenant360: (id: string, month: string) =>
    ['operator', 'tenants', id, '360', month] as const,
  operatorTenantActivity: (id: string, limit: number) =>
    ['operator', 'tenants', id, 'activity', limit] as const,
  operatorNodes: (includeInactive: boolean, cursor?: string) =>
    ['operator', 'nodes', includeInactive, cursor ?? 'first'] as const,
  operatorNode: (name: string) => ['operator', 'nodes', name] as const,
  operatorApp: (id: string, range: string) => ['operator', 'apps', id, range] as const,
  operatorIntent: (id: string) => ['operator', 'intents', id] as const,
  appSecrets: (slug: string) => ['apps', slug, 'secrets'] as const,
  appEnv: (slug: string) => ['apps', slug, 'env'] as const,
  appAlerts: (slug: string) => ['apps', slug, 'alerts'] as const,
};

/** Shared policy: never retry a settled 4xx, retry the rest twice. */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
}

type Options<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>;

/* ------------------------------------------------------------------ *
 * Apps
 * ------------------------------------------------------------------ */

export function useApps(options?: Options<App[]>) {
  return useQuery({
    queryKey: keys.apps,
    queryFn: () => unwrap(api.GET('/v1/apps', {})),
    ...options,
  });
}

export function useApp(slug: string, options?: Options<App>) {
  return useQuery({
    queryKey: keys.app(slug),
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}', { params: { path: { slug } } })),
    enabled: Boolean(slug),
    ...options,
  });
}

/**
 * One call for every app's metrics.
 *
 * The per-app endpoint exists, but the rollup costs 6 PromQL round-trips
 * regardless of app count where a per-app fan-out costs 7N — on a list page
 * that difference is the whole page.
 */
export function useAppsMetrics(range: MetricsRange = '24h', options?: Options<AppsMetrics>) {
  return useQuery({
    queryKey: keys.appsMetrics(range),
    queryFn: () => unwrap(api.GET('/v1/apps/metrics', { params: { query: { range } } })),
    ...options,
  });
}

export type AppsMetrics = components['schemas']['AppsMetricsResponse'];

export function useAppMetrics(slug: string, range: MetricsRange = '24h') {
  return useQuery({
    queryKey: keys.appMetrics(slug, range),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/metrics', { params: { path: { slug }, query: { range } } })),
    enabled: Boolean(slug),
  });
}

/**
 * Routes observed on an app, from gatewayd's per-route metrics.
 *
 * `source: 'unavailable'` means route metrics are off for this app — the flag
 * is plan-gated and Free always reads false — so an empty list there means
 * "not measured", not "no routes".
 */
export function useAppRoutes(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'routes'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/routes', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/* ------------------------------------------------------------------ *
 * Deployments
 * ------------------------------------------------------------------ */

export function useDeployments(limit = 50) {
  return useQuery({
    queryKey: [...keys.deployments, limit],
    queryFn: () => unwrap(api.GET('/v1/deployments', { params: { query: { limit } } })),
  });
}

export function useDeployment(id: string) {
  return useQuery({
    queryKey: ['deployments', id],
    queryFn: () => unwrap(api.GET('/v1/deployments/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/* ------------------------------------------------------------------ *
 * Mutations
 *
 * Each invalidates the families its write can affect, rather than patching the
 * cache by hand — the server is the authority on what a deploy did, and a
 * hand-patched cache is how a console starts lying about state.
 * ------------------------------------------------------------------ */

export function useCreateApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateAppRequest']) =>
      unwrap(api.POST('/v1/apps', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apps }),
  });
}

export function useDeleteApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}', { params: { path: { slug } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apps }),
  });
}

/** Wakes a parked app. The platform scales to zero, so this is a real action. */
export function useWakeApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.POST('/v1/apps/{slug}/wake', { params: { path: { slug } } })),
    onSuccess: (_data, slug) => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
    },
  });
}

export function useParkApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.POST('/v1/apps/{slug}/park', { params: { path: { slug } } })),
    onSuccess: (_data, slug) => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
    },
  });
}

/** Partial update of an app's runtime settings — `PATCH /v1/apps/{slug}`. */
export function useUpdateApp(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['UpdateAppRequest']) =>
      unwrap(api.PATCH('/v1/apps/{slug}', { params: { path: { slug } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
    },
  });
}

/** Changes the slug, which is also the subdomain — `POST /v1/apps/{slug}/rename`. */
export function useRenameApp(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (newSlug: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/rename', {
          params: { path: { slug } },
          body: { new_slug: newSlug },
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

/**
 * A new deployment from a Git ref — `POST /v1/apps/{slug}/deployments/source-ref`.
 *
 * The only deploy the console can start on its own: the other constructor
 * wants an image reference, which means a registry the browser has no
 * business holding credentials for.
 */
export function useDeployFromRef(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['SourceRefDeployRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/deployments/source-ref', {
          params: { path: { slug } },
          body,
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

export function useRollback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.POST('/v1/apps/{slug}/rollback', { params: { path: { slug } } })),
    onSuccess: (_data, slug) => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Account-level reads used by more than one page
 * ------------------------------------------------------------------ */

export function useDomains() {
  return useQuery({
    queryKey: keys.domains,
    queryFn: () => unwrap(api.GET('/v1/domains', {})),
  });
}

export function useCrons() {
  return useQuery({
    queryKey: keys.crons,
    queryFn: () => unwrap(api.GET('/v1/crons', {})),
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: keys.keys,
    queryFn: () => unwrap(api.GET('/v1/keys', {})),
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: keys.invoices,
    queryFn: () => unwrap(api.GET('/v1/invoices', {})),
  });
}

export function useUsageSummary() {
  return useQuery({
    queryKey: keys.usageSummary,
    queryFn: () => unwrap(api.GET('/v1/usage/summary', {})),
  });
}

export function useInstances() {
  return useQuery({
    queryKey: keys.instances,
    queryFn: () => unwrap(api.GET('/v1/instances', {})),
  });
}

/* ------------------------------------------------------------------ *
 * Operator fleet and tenant operations
 *
 * These reads are admin-only on apid. They are kept separate from the
 * account-scoped resources above so a missing operator permission is rendered
 * as an access problem instead of an empty customer fleet.
 * ------------------------------------------------------------------ */

export function useOperatorOverview() {
  return useQuery({
    queryKey: keys.operatorOverview,
    queryFn: () => unwrap(api.GET('/v1/admin/obs/overview', {})),
    refetchInterval: 30_000,
  });
}

export function useOperatorCapacity() {
  return useQuery({
    queryKey: keys.operatorCapacity,
    queryFn: () => unwrap(api.GET('/v1/admin/obs/capacity', {})),
    refetchInterval: 30_000,
  });
}

export function useOperatorTenants(limit = 200, cursor?: string) {
  return useQuery({
    queryKey: keys.operatorTenants(cursor),
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/obs/tenants', {
          params: { query: { limit, ...(cursor ? { cursor } : {}) } },
        })
      ),
  });
}

export function useOperatorTenant360(id: string, month: string) {
  return useQuery({
    queryKey: keys.operatorTenant360(id, month),
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/obs/tenants/{id}/360', {
          params: { path: { id }, query: { month } },
        })
      ),
    enabled: Boolean(id),
  });
}

export function useOperatorTenantActivity(id: string, limit = 50) {
  return useQuery({
    queryKey: keys.operatorTenantActivity(id, limit),
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/obs/tenants/{id}/activity', {
          params: { path: { id }, query: { limit } },
        })
      ),
    enabled: Boolean(id),
  });
}

export function useOperatorNodes(includeInactive = true, cursor?: string) {
  return useQuery({
    queryKey: keys.operatorNodes(includeInactive, cursor),
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/obs/nodes', {
          params: {
            query: {
              limit: 500,
              include_inactive: includeInactive ? '1' : '0',
              ...(cursor ? { cursor } : {}),
            },
          },
        })
      ),
    refetchInterval: 30_000,
  });
}

export function useOperatorNodeDetail(name: string) {
  return useQuery({
    queryKey: keys.operatorNode(name),
    queryFn: () =>
      unwrap(api.GET('/v1/admin/obs/nodes/{name}/detail', { params: { path: { name } } })),
    enabled: Boolean(name),
    refetchInterval: name ? 15_000 : false,
  });
}

export function useOperatorAppDetail(id: string, range: MetricsRange = '1h') {
  return useQuery({
    queryKey: keys.operatorApp(id, range),
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/obs/apps/{id}', {
          params: { path: { id }, query: { range } },
        })
      ),
    enabled: Boolean(id),
  });
}

export function useOperatorIntent(id: string) {
  return useQuery({
    queryKey: keys.operatorIntent(id),
    queryFn: () => unwrap(api.GET('/v1/admin/operator-intents/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ['succeeded', 'failed', 'cancelled'].includes(status) ? false : 2_000;
    },
  });
}

type RecoveryReason = { reason: string };

function invalidateOperatorFleet(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: keys.operatorOverview });
  void qc.invalidateQueries({ queryKey: keys.operatorCapacity });
  void qc.invalidateQueries({ queryKey: ['operator', 'nodes'] });
  void qc.invalidateQueries({ queryKey: keys.instances });
}

export function useForceParkInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string } & RecoveryReason) =>
      unwrap(
        api.POST('/v1/admin/instances/{id}/force-park', {
          params: { path: { id }, query: { confirm: 'true', reason } },
        })
      ),
    onSuccess: () => invalidateOperatorFleet(qc),
  });
}

export function useForceRestartInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string } & RecoveryReason) =>
      unwrap(
        api.POST('/v1/admin/instances/{id}/force-restart', {
          params: { path: { id }, query: { confirm: 'true', reason } },
        })
      ),
    onSuccess: () => invalidateOperatorFleet(qc),
  });
}

export function useForceColdBootApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, reason }: { slug: string } & RecoveryReason) =>
      unwrap(
        api.POST('/v1/admin/apps/{slug}/force-cold-boot', {
          params: { path: { slug }, query: { confirm: 'true', reason } },
        })
      ),
    onSuccess: () => invalidateOperatorFleet(qc),
  });
}

/* ------------------------------------------------------------------ *
 * Operator runtime configuration
 *
 * These routes are deliberately separate from customer settings. They are
 * operator-only, versioned writes against the control-plane catalog, and a
 * graceful/rolling change may return a durable operation instead of the
 * applied catalog entry.
 * ------------------------------------------------------------------ */

export function useOperatorRuntimeConfig() {
  return useQuery({
    queryKey: keys.operatorRuntimeConfig,
    queryFn: () => unwrap(api.GET('/v1/admin/config', {})),
  });
}

export function useOperatorRuntimeConfigRevisions(key: string, limit = 50) {
  return useQuery({
    queryKey: [...keys.operatorRuntimeConfigRevisions(key), limit],
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/config/{key}/revisions', {
          params: { path: { key }, query: { limit } },
        })
      ),
    enabled: Boolean(key),
  });
}

export function useOperatorRuntimeConfigOperation(id: string) {
  return useQuery({
    queryKey: keys.operatorRuntimeConfigOperation(id),
    queryFn: () =>
      unwrap(api.GET('/v1/admin/config-operations/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ['succeeded', 'failed', 'blocked', 'cancelled'].includes(status)
        ? false
        : 2_000;
    },
  });
}

export function useUpdateOperatorRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      ...body
    }: {
      key: string;
      value: unknown;
      reason: string;
      expected_version?: number;
    }) => unwrap(api.PATCH('/v1/admin/config/{key}', { params: { path: { key } }, body })),
    onSuccess: (_data, { key }) => {
      void qc.invalidateQueries({ queryKey: keys.operatorRuntimeConfig });
      void qc.invalidateQueries({ queryKey: keys.operatorRuntimeConfigEntry(key) });
      void qc.invalidateQueries({ queryKey: keys.operatorRuntimeConfigRevisions(key) });
    },
  });
}

export function useRollbackOperatorRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      ...body
    }: { key: string } & components['schemas']['RollbackOperatorRuntimeConfigRequest']) =>
      unwrap(api.POST('/v1/admin/config/{key}/rollback', { params: { path: { key } }, body })),
    onSuccess: (_data, { key }) => {
      void qc.invalidateQueries({ queryKey: keys.operatorRuntimeConfig });
      void qc.invalidateQueries({ queryKey: keys.operatorRuntimeConfigEntry(key) });
      void qc.invalidateQueries({ queryKey: keys.operatorRuntimeConfigRevisions(key) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Per-app configuration
 *
 * Secrets and env vars are the same shape with a crucial difference: a secret's
 * value is never echoed back. Both write with PUT keyed by name, so "create"
 * and "update" are one operation.
 * ------------------------------------------------------------------ */

export function useAppSecrets(slug: string) {
  return useQuery({
    queryKey: keys.appSecrets(slug),
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/secrets', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useSetSecret(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/secrets/{key}', {
          params: { path: { slug, key } },
          body: { value },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appSecrets(slug) }),
  });
}

export function useDeleteSecret(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/secrets/{key}', { params: { path: { slug, key } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appSecrets(slug) }),
  });
}

export function useAppEnv(slug: string) {
  return useQuery({
    queryKey: keys.appEnv(slug),
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/env', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useSetEnv(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/env/{key}', { params: { path: { slug, key } }, body: { value } })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appEnv(slug) }),
  });
}

export function useDeleteEnv(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/env/{key}', { params: { path: { slug, key } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appEnv(slug) }),
  });
}

/* ------------------------------------------------------------------ *
 * Domains, crons, keys — account-level CRUD
 * ------------------------------------------------------------------ */

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateCustomDomainRequest']) =>
      unwrap(api.POST('/v1/domains', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.domains }),
  });
}

export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      unwrap(api.DELETE('/v1/domains/{domain}', { params: { path: { domain } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.domains }),
  });
}

export function useCronRuns(id: string) {
  return useQuery({
    queryKey: ['crons', id, 'runs'],
    queryFn: () => unwrap(api.GET('/v1/crons/{id}/runs', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useDeleteCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/v1/crons/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.crons }),
  });
}

/** Fires a scheduled job now, out of band. */
export function useRunCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/crons/{id}/run', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.crons }),
  });
}

/**
 * The plaintext key comes back exactly once, on create. The UI has to show it
 * immediately and warn that it will not be shown again — there is no recovery.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateKeyRequest']) =>
      unwrap(api.POST('/v1/keys', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.keys }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/v1/keys/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.keys }),
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/keys/{id}/rotate', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.keys }),
  });
}

/* ------------------------------------------------------------------ *
 * Observability
 * ------------------------------------------------------------------ */

export function useInvocations(limit = 50) {
  return useQuery({
    queryKey: [...keys.invocations, limit],
    queryFn: () => unwrap(api.GET('/v1/invocations', { params: { query: { limit } } })),
  });
}

export function useInvocation(id: string) {
  return useQuery({
    queryKey: ['invocations', id],
    queryFn: () => unwrap(api.GET('/v1/invocations/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useReplayInvocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/invocations/{id}/replay', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invocations }),
  });
}

export function useTrace(traceId: string) {
  return useQuery({
    queryKey: ['traces', traceId],
    queryFn: () =>
      unwrap(api.GET('/v1/traces/{trace_id}', { params: { path: { trace_id: traceId } } })),
    enabled: Boolean(traceId),
  });
}

export function useAuditLog() {
  return useQuery({
    queryKey: keys.auditLog,
    queryFn: () => unwrap(api.GET('/v1/audit-log', {})),
  });
}

/* ------------------------------------------------------------------ *
 * Alerts and webhooks — both per-app, both signed-payload dispatchers
 * ------------------------------------------------------------------ */

export function useAlerts(slug: string) {
  return useQuery({
    queryKey: keys.appAlerts(slug),
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/alerts', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useDeleteAlert(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/alerts/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appAlerts(slug) }),
  });
}

export function useWebhooks(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'webhooks'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/webhooks', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useWebhookDeliveries(slug: string, id: string) {
  return useQuery({
    queryKey: ['apps', slug, 'webhooks', id, 'deliveries'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/webhooks/{id}/deliveries', { params: { path: { slug, id } } })
      ),
    enabled: Boolean(slug && id),
  });
}

/** Clears a delivery out of `dead` back to `pending` for another attempt. */
export function useRetryDelivery(slug: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (did: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry', {
          params: { path: { slug, id, did } },
        })
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['apps', slug, 'webhooks', id, 'deliveries'] }),
  });
}

/* ------------------------------------------------------------------ *
 * Edge rules and queues
 * ------------------------------------------------------------------ */

export function useEdgeRules(enabled = true) {
  return useQuery({
    queryKey: ['edge-rules'],
    queryFn: () => unwrap(api.GET('/v1/edge-rules', {})),
    enabled,
  });
}

export function useDeleteEdgeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/edge-rules/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edge-rules'] }),
  });
}

export function useQueueState(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'queues', 'state'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/queues/state', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/** Non-destructive read of the head of the queue. `receive` would claim it. */
export function useQueuePeek(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'queues', 'peek'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/queues/peek', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useDeadLetter(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'queues', 'dead_letter'],
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/queues/dead_letter', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/**
 * External services an app talks to, from `/v1/apps/{slug}/upstreams`.
 *
 * Mostly discovered rather than declared — `source: 'inferred'` means the
 * platform observed the egress. Hostnames are only ever returned hashed, so the
 * console can show that an app reaches *a* Postgres without leaking which one.
 */
export function useUpstreams(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'upstreams'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/upstreams', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/* ------------------------------------------------------------------ *
 * Builds and supply chain
 * ------------------------------------------------------------------ */

export function useBuilds() {
  return useQuery({
    queryKey: ['builds'],
    queryFn: () => unwrap(api.GET('/v1/builds', {})),
  });
}

export function useBuildSbom(id: string) {
  return useQuery({
    queryKey: ['builds', id, 'sbom'],
    queryFn: () => unwrap(api.GET('/v1/builds/{id}/sbom', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/** Per-deployment CVE scan. A CRITICAL finding does not block a deploy. */
export function useDeploymentScan(id: string) {
  return useQuery({
    queryKey: ['deployments', id, 'scan'],
    queryFn: () => unwrap(api.GET('/v1/deployments/{id}/scan', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/* ------------------------------------------------------------------ *
 * Usage and billing
 * ------------------------------------------------------------------ */

/** Both of these are a single day's snapshot, not a range — `day` is required. */
export function useUsageDaily(day: string) {
  return useQuery({
    queryKey: ['usage', 'daily', day],
    queryFn: () => unwrap(api.GET('/v1/usage/daily', { params: { query: { day } } })),
    enabled: Boolean(day),
  });
}

export function useStorageUsage(day: string) {
  return useQuery({
    queryKey: ['usage', 'storage', day],
    queryFn: () => unwrap(api.GET('/v1/usage/storage', { params: { query: { day } } })),
    enabled: Boolean(day),
  });
}

/**
 * Returns a URL to the provider's hosted portal rather than a page we render —
 * card details never touch this app.
 */
export function useBillingPortal() {
  return useMutation({
    mutationFn: () => unwrap(api.GET('/v1/billing/portal', {})),
  });
}

/**
 * Switches the billing plan. This changes the subscription server-side and can
 * bill immediately, so callers must confirm before invoking it — a 402 here
 * means payment is required and carries a link to the provider's checkout.
 */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: components['schemas']['ChangePlanRequest']['plan']) =>
      unwrap(api.PATCH('/v1/account/plan', { body: { plan } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.account }),
  });
}

export function useAccountSlo() {
  return useQuery({
    queryKey: ['account', 'slo'],
    queryFn: () => unwrap(api.GET('/v1/account/slo', {})),
  });
}

/* ------------------------------------------------------------------ *
 * Organisations
 * ------------------------------------------------------------------ */

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: () => unwrap(api.GET('/v1/orgs', {})),
  });
}

export function useOrgMembers(slug: string) {
  return useQuery({
    queryKey: ['orgs', slug, 'members'],
    queryFn: () => unwrap(api.GET('/v1/orgs/{slug}/members', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useOrgInvitations(slug: string) {
  return useQuery({
    queryKey: ['orgs', slug, 'invitations'],
    queryFn: () => unwrap(api.GET('/v1/orgs/{slug}/invitations', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/* ------------------------------------------------------------------ *
 * Sessions — the signed-in devices list, and the panic button
 * ------------------------------------------------------------------ */

export function useSessions() {
  return useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => unwrap(api.GET('/v1/auth/sessions', {})),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const csrf_token = await issueCSRF('auth.session.revoke');
      return unwrap(
        api.DELETE('/v1/auth/sessions/{id}', {
          params: { path: { id } },
          body: { csrf_token },
        })
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });
}

export function useRevokeAllSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const csrf_token = await issueCSRF('auth.sessions.revoke_all');
      return unwrap(api.POST('/v1/auth/sessions/revoke_all', { body: { csrf_token } }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });
}

/* ------------------------------------------------------------------ *
 * MFA — the session gate and account security page share these calls.
 * ------------------------------------------------------------------ */

export function enrollMfa() {
  return unwrap(api.POST('/v1/account/mfa/enroll', {}));
}

export async function confirmMfa(totp: string) {
  const csrf_token = await issueCSRF('mfa_confirm');
  return unwrap(api.POST('/v1/account/mfa/confirm', { body: { totp, csrf_token } }));
}

export function verifyMfa(totp: string) {
  return unwrap(api.POST('/v1/account/mfa/verify', { body: { totp } }));
}

export async function recoverMfa(code: string) {
  const csrf_token = await issueCSRF('mfa_recover');
  return unwrap(api.POST('/v1/account/mfa/recover', { body: { code, csrf_token } }));
}

export async function disableMfa(input: { password?: string; recovery_code?: string }) {
  const csrf_token = await issueCSRF('mfa_disable');
  return unwrap(api.POST('/v1/account/mfa/disable', { body: { ...input, csrf_token } }));
}

/* ------------------------------------------------------------------ *
 * Writes the console could not make before. Each list page could delete
 * and nothing else; the API has had create and update the whole time.
 * ------------------------------------------------------------------ */

export function useCreateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateCronRequest']) =>
      unwrap(api.POST('/v1/crons', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.crons }),
  });
}

export function useUpdateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & components['schemas']['UpdateCronRequest']) =>
      unwrap(api.PATCH('/v1/crons/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.crons }),
  });
}

export function useCreateAlert(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateAlertRuleRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/alerts', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appAlerts(slug) }),
  });
}

export function useUpdateAlert(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & components['schemas']['UpdateAlertRuleRequest']) =>
      unwrap(api.PATCH('/v1/apps/{slug}/alerts/{id}', { params: { path: { slug, id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appAlerts(slug) }),
  });
}

export function useRotateAlertSecret(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/alerts/{id}/rotate-secret', {
          params: { path: { slug, id } },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appAlerts(slug) }),
  });
}

const webhookKey = (slug: string) => ['apps', slug, 'webhooks'] as const;

export function useCreateWebhook(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateAppWebhookRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/webhooks', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKey(slug) }),
  });
}

export function useUpdateWebhook(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & components['schemas']['UpdateAppWebhookRequest']) =>
      unwrap(api.PATCH('/v1/apps/{slug}/webhooks/{id}', { params: { path: { slug, id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKey(slug) }),
  });
}

export function useDeleteWebhook(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/webhooks/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKey(slug) }),
  });
}

export function useRotateWebhookSecret(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/webhooks/{id}/rotate-secret', {
          params: { path: { slug, id } },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhookKey(slug) }),
  });
}

const upstreamKey = (slug: string) => ['apps', slug, 'upstreams'] as const;

export function useAddUpstream(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['PutDataUpstreamRequest']) =>
      unwrap(api.PUT('/v1/apps/{slug}/upstreams', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: upstreamKey(slug) }),
  });
}

export function useDeleteUpstream(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/upstreams/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: upstreamKey(slug) }),
  });
}

const orgKey = (slug: string, what: 'members' | 'invitations') => ['orgs', slug, what] as const;

export function useInviteMember(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['InviteMemberRequest']) =>
      unwrap(api.POST('/v1/orgs/{slug}/members', { params: { path: { slug: org } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(org, 'invitations') }),
  });
}

export function useChangeMemberRole(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      role,
    }: { userId: string } & components['schemas']['ChangeMemberRoleRequest']) =>
      unwrap(
        api.PATCH('/v1/orgs/{slug}/members/{user_id}', {
          params: { path: { slug: org, user_id: userId } },
          body: { role },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(org, 'members') }),
  });
}

export function useRemoveMember(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(
        api.DELETE('/v1/orgs/{slug}/members/{user_id}', {
          params: { path: { slug: org, user_id: userId } },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(org, 'members') }),
  });
}

export function useRevokeInvitation(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      unwrap(
        api.DELETE('/v1/orgs/{slug}/invitations/{token}', {
          params: { path: { slug: org, token } },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(org, 'invitations') }),
  });
}

/**
 * Slug-in-variables variants for the create wizard, which does not know the
 * app's slug until `POST /v1/apps` has answered — too late to have called a
 * slug-bound hook at render.
 */
export function useDeployFromRefFor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      ...body
    }: { slug: string } & components['schemas']['SourceRefDeployRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/deployments/source-ref', { params: { path: { slug } }, body })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

export function useUpdateAppFor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, ...body }: { slug: string } & components['schemas']['UpdateAppRequest']) =>
      unwrap(api.PATCH('/v1/apps/{slug}', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apps }),
  });
}

/**
 * The SBOM as a one-shot read, for a download button. A mutation rather than
 * a query for the same reason the billing portal is: it runs on a click,
 * not on render, and nothing should cache a file the browser is about to
 * hand to the user.
 */
export function useFetchBuildSbom() {
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.GET('/v1/builds/{id}/sbom', { params: { path: { id } } })),
  });
}

/* ------------------------------------------------------------------ *
 * Edge rules. List is account-wide or per app; create is per app; update
 * and delete are by id. Kind is immutable on update — the spec says delete
 * and recreate — and `action` replaces whole.
 * ------------------------------------------------------------------ */

export type EdgeRule = components['schemas']['EdgeRuleResponse'];
export type EdgeRuleKind = EdgeRule['kind'];
export type EdgeRuleAction = EdgeRule['action'];

export function useAppEdgeRules(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'edge-rules'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/edge-rules', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useCreateEdgeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      ...body
    }: { slug: string } & components['schemas']['CreateEdgeRuleRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/edge-rules', { params: { path: { slug } }, body })),
    onSuccess: (_rule, { slug }) => {
      void qc.invalidateQueries({ queryKey: ['edge-rules'] });
      void qc.invalidateQueries({ queryKey: ['apps', slug, 'edge-rules'] });
    },
  });
}

export function useUpdateEdgeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & components['schemas']['UpdateEdgeRuleRequest']) =>
      unwrap(api.PATCH('/v1/edge-rules/{id}', { params: { path: { id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edge-rules'] });
      void qc.invalidateQueries({
        queryKey: ['apps'],
        predicate: (q) => q.queryKey.includes('edge-rules'),
      });
    },
  });
}

/**
 * The throttle recommender: observed and suggested rps per route, clamped to
 * the plan ceiling so whatever it suggests is settable. Advice only — it is
 * the person who confirms, by creating the rule.
 */
export function useThrottleSuggestions(slug: string, range: MetricsRange, enabled: boolean) {
  return useQuery({
    queryKey: ['apps', slug, 'throttle-suggestions', range],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/throttle-suggestions', {
          params: { path: { slug }, query: { range } },
        })
      ),
    enabled: enabled && Boolean(slug),
  });
}

/** Instances of one app — the archive reads a single instance's day. */
export function useAppInstances(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'instances'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/instances', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}
