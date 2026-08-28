import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryFilters,
  type UseQueryOptions,
} from '@tanstack/react-query';
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
export type AppSLOWindow = components['schemas']['AppSLOResponse']['window'];
export type MFAEnrollment = components['schemas']['MFAEnrollResponse'];

export const keys = {
  account: ['account'] as const,
  apps: ['apps'] as const,
  app: (slug: string) => ['apps', slug] as const,
  appsMetrics: (range: MetricsRange) => ['apps', 'metrics', range] as const,
  appMetrics: (slug: string, range: MetricsRange) => ['apps', slug, 'metrics', range] as const,
  appSlo: (slug: string, window: AppSLOWindow) => ['apps', slug, 'slo', window] as const,
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
  appSecrets: (slug: string) => ['apps', slug, 'secrets'] as const,
  appEnv: (slug: string) => ['apps', slug, 'env'] as const,
  appAlerts: (slug: string) => ['apps', slug, 'alerts'] as const,
  appRegistryCredentials: (slug: string) => ['apps', slug, 'registry-credentials'] as const,
};

/** Shared policy: never retry a settled 4xx, retry the rest twice. */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
}

/**
 * The optimistic-write pattern, once: cancel in-flight reads so they cannot
 * overwrite the prediction, snapshot, apply `update` to every cached entry
 * matching `filters`, and hand `onError` a rollback. `onSettled` must still
 * invalidate — the server stays the source of truth.
 *
 * Only mutations whose outcome the client can predict exactly use this: a
 * toggle flips, a deleted row disappears. Creates stay pessimistic, because
 * the server mints ids and defaults the client cannot invent.
 */
async function applyOptimistic<T>(
  qc: QueryClient,
  filters: QueryFilters,
  update: (old: T) => T
): Promise<() => void> {
  await qc.cancelQueries(filters);
  const previous = qc.getQueriesData<T>(filters);
  qc.setQueriesData<T>(filters, (old) => (old === undefined ? old : update(old)));
  return () => {
    for (const [key, data] of previous) qc.setQueryData(key, data);
  };
}

type Options<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>;

/* ------------------------------------------------------------------ *
 * GitHub installation — the repos it can actually see
 * ------------------------------------------------------------------ */

/** The repos the GitHub App installation can reach — so pickers can list
 * real repos instead of trusting a typed owner/name. */
export function useInstallRepos(installationId: number | null) {
  return useQuery({
    queryKey: ['install', 'repos', installationId],
    queryFn: () =>
      unwrap(
        api.POST('/v1/install/repos/list', {
          body: { installation_id: installationId ?? 0, repo_full_name: '', production_branch: '' },
        })
      ),
    enabled: installationId !== null && installationId > 0,
    staleTime: 5 * 60_000,
  });
}

/** Persist the (account, app, installation, repo, branch) binding. */
export function useBindRepo(slug: string) {
  return useMutation({
    mutationFn: (input: { installationId: number; repo: string; branch: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/install/bind', {
          params: { path: { slug } },
          body: {
            installation_id: input.installationId,
            repo_full_name: input.repo,
            production_branch: input.branch,
          },
        })
      ),
  });
}

/* ------------------------------------------------------------------ *
 * Organisations — identity, seats, ownership, org-scoped keys
 * ------------------------------------------------------------------ */

export function useOrg(slug: string) {
  return useQuery({
    queryKey: ['orgs', slug],
    queryFn: () => unwrap(api.GET('/v1/orgs/{slug}', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function usePatchOrg(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['PatchOrgRequest']) =>
      unwrap(api.PATCH('/v1/orgs/{slug}', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useDeleteOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.DELETE('/v1/orgs/{slug}', { params: { path: { slug } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useSeatUsage(slug: string) {
  return useQuery({
    queryKey: ['orgs', slug, 'seats'],
    queryFn: () => unwrap(api.GET('/v1/orgs/{slug}/seat_usage', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useTransferOwnership(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (newOwnerAccountId: string) =>
      unwrap(
        api.POST('/v1/orgs/{slug}/transfer_ownership', {
          params: { path: { slug } },
          body: { new_owner_account_id: newOwnerAccountId },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useOrgKeys(slug: string) {
  return useQuery({
    queryKey: ['orgs', slug, 'keys'],
    queryFn: () => unwrap(api.GET('/v1/orgs/{slug}/keys', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useCreateOrgKey(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateOrgAPIKeyRequest']) =>
      unwrap(api.POST('/v1/orgs/{slug}/keys', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs', slug, 'keys'] }),
  });
}

export function useDeleteOrgKey(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/orgs/{slug}/keys/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs', slug, 'keys'] }),
  });
}

export function useRotateOrgKey(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/orgs/{slug}/keys/{id}/rotate', {
          params: { path: { slug, id } },
          body: {},
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs', slug, 'keys'] }),
  });
}

/* ------------------------------------------------------------------ *
 * Invitations — peek and accept by token
 * ------------------------------------------------------------------ */

export function useInvitation(token: string) {
  return useQuery({
    queryKey: ['invitations', token],
    queryFn: () => unwrap(api.GET('/v1/invitations/{token}', { params: { path: { token } } })),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      unwrap(api.POST('/v1/invitations/{token}/accept', { params: { path: { token } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

/* ------------------------------------------------------------------ *
 * Billing & account controls
 * ------------------------------------------------------------------ */

/** Set (or clear with 0) a hard ceiling on monthly overage spend. */
export function useSetOverageCap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (capCents: number) =>
      unwrap(api.POST('/v1/account/overage-cap', { body: { overage_cap_cents: capCents } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.account }),
  });
}

/** Cancel at period end — the account stays active until then. */
export function useCancelBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/v1/billing/cancel', {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.account }),
  });
}

/** Retry the latest unpaid invoice/transaction. */
export function useRetryBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/v1/billing/retry', {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.account }),
  });
}

/** The full GDPR export bundle, as JSON the caller hands to the browser. */
export function useAccountExport() {
  return useMutation({
    mutationFn: () => unwrap(api.GET('/v1/account/export', {})),
  });
}

/** Bring a deleted_pending account back inside the 30-day window. */
export function useRestoreAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/v1/account/restore', {})),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Key-rotation grace window: how long the old key keeps working. */
export function useGraceWindow() {
  return useQuery({
    queryKey: ['account', 'grace-window'],
    queryFn: () => unwrap(api.GET('/v1/account/keys/grace_window_days', {})),
  });
}

export function useSetGraceWindow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) =>
      unwrap(api.PATCH('/v1/account/keys/grace_window_days', { body: { days } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account', 'grace-window'] }),
  });
}

/** Egress-allowlist extra budget: entries beyond the plan cap. */
export function useEgressExtra() {
  return useQuery({
    queryKey: ['account', 'egress-extra'],
    queryFn: () => unwrap(api.GET('/v1/account/egress_allowlist_extra', {})),
  });
}

export function useSetEgressExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (extra: number) =>
      unwrap(api.PATCH('/v1/account/egress_allowlist_extra', { body: { extra } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account', 'egress-extra'] }),
  });
}

/** Per-app monthly usage rows — the detail under the account roll-up. */
export function usePerAppUsage() {
  return useQuery({
    queryKey: ['usage', 'per-app'],
    queryFn: () => unwrap(api.GET('/v1/usage', {})),
  });
}

/* ------------------------------------------------------------------ *
 * Supply chain & secrets hygiene
 * ------------------------------------------------------------------ */

/** Toggle signed-deploy enforcement for an app. Admin + MFA server-side —
 * the MFA provider handles the step-up when it is demanded. */
export function useSetAppSecurity(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (require_signed: boolean) =>
      unwrap(
        api.PATCH('/v1/apps/{slug}/security', {
          params: { path: { slug } },
          body: { require_signed },
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
      void qc.invalidateQueries({ queryKey: keys.apps });
    },
  });
}

export function useTrustedSigners(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'trusted-signers'],
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/trusted_signers', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function usePutTrustedSigner(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; publicKeyPem: string }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/trusted_signers/{name}', {
          params: { path: { slug, name: input.name } },
          body: { public_key_pem: input.publicKeyPem },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps', slug, 'trusted-signers'] }),
  });
}

export function useDeleteTrustedSigner(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/trusted_signers/{name}', {
          params: { path: { slug, name } },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps', slug, 'trusted-signers'] }),
  });
}

/** Re-seal a secret under the current host identity — the value crosses the
 * wire once, exactly like create, and is never echoed back. */
export function useRotateSecret(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/secrets/{key}/rotate', {
          params: { path: { slug, key: input.key } },
          body: { value: input.value },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appSecrets(slug) }),
  });
}

/** Every sealed secret across the account — the hygiene inventory. */
export function useAccountSecrets() {
  return useQuery({
    queryKey: ['secrets'],
    queryFn: () => unwrap(api.GET('/v1/secrets', {})),
  });
}

/* ------------------------------------------------------------------ *
 * Scheduling — delayed one-shot tasks, and the fate of a fired cron
 * ------------------------------------------------------------------ */

export type DelayedTask = components['schemas']['DelayedTaskResponse'];

/** Schedule a one-shot task to fire at a future time. */
export function useScheduleDelayedTask(slug: string) {
  return useMutation({
    mutationFn: (input: { scheduledAt: string; payload: Record<string, unknown> }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/delayed-tasks', {
          params: { path: { slug } },
          body: { scheduled_at: input.scheduledAt, payload: input.payload },
        })
      ),
  });
}

/** One delayed task's state. The API reads tasks by id only — there is no
 * list endpoint — so the console tracks the ids it created. */
export function useDelayedTask(id: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: ['delayed-tasks', id],
    queryFn: () => unwrap(api.GET('/v1/delayed-tasks/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
    refetchInterval: options?.poll
      ? (query) => (query.state.data?.state === 'pending' ? 5_000 : false)
      : undefined,
  });
}

export function useCancelDelayedTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/delayed-tasks/{id}', { params: { path: { id } } })),
    onSuccess: (_d, id) => void qc.invalidateQueries({ queryKey: ['delayed-tasks', id] }),
  });
}

/** The state of one fire-now request — polled after "Run now" until it
 * settles, so the button's toast can report what actually happened. */
export function useFireNowRequest(requestId: string) {
  return useQuery({
    queryKey: ['cron-fire-now', requestId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/cron-fire-now-requests/{request_id}', {
          params: { path: { request_id: requestId } },
        })
      ),
    enabled: Boolean(requestId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && status !== 'pending' && status !== 'running' ? false : 2_000;
    },
  });
}

/* ------------------------------------------------------------------ *
 * Observability — error groups, wake anatomy, build provenance, deploy
 * preview, auth audit trail
 * ------------------------------------------------------------------ */

/** Automatic error grouping for one app (ADR-096): fingerprints with
 * counts, routes, and a sample message. */
export function useAppErrors(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'errors'],
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/errors/summary', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

/** Recent requests behind one fingerprint. */
export function useAppErrorRequests(slug: string, fingerprint: string) {
  return useQuery({
    queryKey: ['apps', slug, 'errors', fingerprint],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/errors/{fingerprint}', {
          params: { path: { slug, fingerprint } },
        })
      ),
    enabled: Boolean(slug && fingerprint),
  });
}

/** The oldest sample for a fingerprint — message plus redacted headers. */
export function useAppErrorSample(slug: string, fingerprint: string) {
  return useQuery({
    queryKey: ['apps', slug, 'errors', fingerprint, 'first'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/errors/{fingerprint}/first', {
          params: { path: { slug, fingerprint } },
        })
      ),
    enabled: Boolean(slug && fingerprint),
  });
}

/** Frame-by-frame anatomy of one wake attempt. */
export function useWakeTimeline(slug: string, wakeId: string) {
  return useQuery({
    queryKey: ['apps', slug, 'wakes', wakeId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/wakes/{wake_id}/timeline', {
          params: { path: { slug, wake_id: wakeId } },
        })
      ),
    enabled: Boolean(slug && wakeId),
  });
}

/** Read-only preview of what a config change would do — the CLI's
 * `deploy --diff`, wired to the console's config form. A mutation shape
 * because it POSTs a proposed config, but it writes nothing. */
export function useAppDiff(slug: string) {
  return useMutation({
    mutationFn: (app_config: Record<string, unknown>) =>
      unwrap(
        api.POST('/v1/apps/{slug}/diff', { params: { path: { slug } }, body: { app_config } })
      ),
  });
}

/** One build's record — status, timings, failure class. */
export function useBuild(id: string) {
  return useQuery({
    queryKey: ['builds', id],
    queryFn: () => unwrap(api.GET('/v1/builds/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/** The build's provenance: toolchain versions, digests, source identity. */
export function useBuildProvenance(id: string) {
  return useQuery({
    queryKey: ['builds', id, 'provenance'],
    queryFn: () => unwrap(api.GET('/v1/builds/{id}/provenance', { params: { path: { id } } })),
    enabled: Boolean(id),
    retry: false,
  });
}

/** Per-deploy image-layer secret scan. */
export function useDeploymentSecretScan(id: string) {
  return useQuery({
    queryKey: ['deployments', id, 'secret-scan'],
    queryFn: () =>
      unwrap(api.GET('/v1/deployments/{id}/secret-scan', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/** The account's auth audit trail — sign-ins, key mints, MFA events. */
export function useAuthAuditEvents() {
  return useQuery({
    queryKey: ['audit-events'],
    queryFn: () => unwrap(api.GET('/v1/audit-events', {})),
  });
}

/* ------------------------------------------------------------------ *
 * Project import — scan a repo tarball into a deploy plan, then apply it
 * ------------------------------------------------------------------ */

export type ProjectPlan = components['schemas']['PlanResponse'];

/** Multipart body shared by scan and apply. */
function projectForm(input: { file: File; slug?: string; branch?: string }): FormData {
  const fd = new FormData();
  fd.append('source', input.file);
  if (input.slug?.trim()) fd.append('project_slug', input.slug.trim());
  if (input.branch?.trim()) fd.append('production_branch', input.branch.trim());
  return fd;
}

/** Dry-run: upload the tarball, get the plan (workloads, managed services,
 * crons, quota verdict, and the plan_token apply echoes back). */
export function useProjectScan() {
  return useMutation({
    mutationFn: (input: { file: File; slug?: string; branch?: string }) =>
      unwrap(
        api.POST('/v1/projects/scan', {
          // The typed body is JSON-shaped; the endpoint takes multipart. The
          // serializer override is openapi-fetch's sanctioned escape hatch.
          body: undefined as never,
          bodySerializer: () => projectForm(input),
        })
      ),
  });
}

/** Apply the plan in one transaction. Echoes the dry-run's plan_token so the
 * server can skip the second extract. */
export function useProjectApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; slug?: string; branch?: string; planToken: string }) =>
      unwrap(
        api.POST('/v1/projects', {
          params: { query: { plan_token: input.planToken } },
          body: undefined as never,
          bodySerializer: () => projectForm(input),
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps });
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.crons });
    },
  });
}

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
    // Prometheus fan-out — the one family that does not refetch on focus.
    refetchOnWindowFocus: false,
    ...options,
  });
}

export type AppsMetrics = components['schemas']['AppsMetricsResponse'];

export function useAppMetrics(
  slug: string,
  range: MetricsRange = '24h',
  options?: Options<AppMetrics>
) {
  return useQuery({
    queryKey: keys.appMetrics(slug, range),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/metrics', { params: { path: { slug }, query: { range } } })),
    // Prometheus fan-out — the one family that does not refetch on focus.
    refetchOnWindowFocus: false,
    ...options,
    enabled: Boolean(slug) && options?.enabled !== false,
  });
}

export function useAppSlo(
  slug: string,
  window: AppSLOWindow = '24h',
  options?: Options<components['schemas']['AppSLOResponse']>
) {
  return useQuery({
    queryKey: keys.appSlo(slug, window),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/slo', { params: { path: { slug }, query: { window } } })),
    // Prometheus fan-out — the one family that does not refetch on focus.
    refetchOnWindowFocus: false,
    ...options,
    enabled: Boolean(slug) && options?.enabled !== false,
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

export function useDeployments(
  limit = 50,
  options?: Options<components['schemas']['DeploymentListResponse']>
) {
  return useQuery({
    queryKey: [...keys.deployments, limit],
    queryFn: () => unwrap(api.GET('/v1/deployments', { params: { query: { limit } } })),
    ...options,
  });
}

export function useDeployment(id: string, options?: Options<Deployment>) {
  return useQuery({
    queryKey: ['deployments', id],
    queryFn: () => unwrap(api.GET('/v1/deployments/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
    ...options,
  });
}

export function useUpdateDeploymentMinInstances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, min_instances }: { id: string; min_instances: number }) =>
      unwrap(
        api.PATCH('/v1/deployments/{id}', {
          params: { path: { id } },
          body: { min_instances },
        })
      ),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['deployments', id] });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

export function useUpdateDeploymentTraffic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, traffic_percent }: { id: string; traffic_percent: number }) =>
      unwrap(
        api.PATCH('/v1/deployments/{id}/traffic', {
          params: { path: { id } },
          body: { traffic_percent },
        })
      ),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['deployments', id] });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
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
    // A settings toggle moves the moment it is flipped; a rejected PATCH
    // rolls it back alongside the error toast.
    onMutate: (body) =>
      applyOptimistic<App>(qc, { queryKey: keys.app(slug), exact: true }, (old) => ({
        ...old,
        ...(body as Partial<App>),
      })),
    onError: (_err, _body, rollback) => rollback?.(),
    onSettled: () => {
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
    onMutate: (key) =>
      applyOptimistic<SecretsList>(qc, { queryKey: keys.appSecrets(slug) }, (old) => ({
        ...old,
        secrets: old.secrets?.filter((s) => s.key !== key),
      })),
    onError: (_err, _key, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.appSecrets(slug) }),
  });
}

type SecretsList = NonNullable<ReturnType<typeof useAppSecrets>['data']>;

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
    onMutate: (key) =>
      applyOptimistic<EnvList>(qc, { queryKey: keys.appEnv(slug) }, (old) => ({
        ...old,
        env: old.env?.filter((v) => v.key !== key),
      })),
    onError: (_err, _key, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.appEnv(slug) }),
  });
}

type EnvList = NonNullable<ReturnType<typeof useAppEnv>['data']>;

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
    onMutate: (domain) =>
      applyOptimistic<DomainsList>(qc, { queryKey: keys.domains }, (old) =>
        old.filter((d) => d.domain !== domain)
      ),
    onError: (_err, _domain, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.domains }),
  });
}

type DomainsList = NonNullable<ReturnType<typeof useDomains>['data']>;

export function useInvokeApp() {
  return useMutation({
    mutationFn: ({ slug, ...body }: { slug: string } & components['schemas']['InvokeRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/invoke', { params: { path: { slug } }, body })),
  });
}

export function useInvokeAppAsync() {
  return useMutation({
    mutationFn: ({ slug, ...body }: { slug: string } & components['schemas']['InvokeRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/invoke/async', { params: { path: { slug } }, body })),
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
    onMutate: (id) =>
      applyOptimistic<CronsList>(qc, { queryKey: keys.crons }, (old) =>
        old.filter((c) => c.id !== id)
      ),
    onError: (_err, _id, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.crons }),
  });
}

type CronsList = NonNullable<ReturnType<typeof useCrons>['data']>;

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
    onMutate: (id) =>
      applyOptimistic<ApiKeysList>(qc, { queryKey: keys.keys }, (old) =>
        old.filter((k) => k.id !== id)
      ),
    onError: (_err, _id, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.keys }),
  });
}

type ApiKeysList = NonNullable<ReturnType<typeof useApiKeys>['data']>;

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

export function useInvocation(id: string, poll = false) {
  return useQuery({
    queryKey: ['invocations', id],
    queryFn: () => unwrap(api.GET('/v1/invocations/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      if (!poll) return false;
      const state = query.state.data?.state;
      return state && ['completed', 'failed', 'cancelled', 'dead_letter'].includes(state)
        ? false
        : 2_000;
    },
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

/** Every cache entry holding edge rules — the account list and each per-app
 * list — so an optimistic write cannot leave the two disagreeing. */
const edgeRuleFilters: QueryFilters = {
  predicate: (q) => q.queryKey.includes('edge-rules'),
};

export function useDeleteEdgeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/edge-rules/{id}', { params: { path: { id } } })),
    onMutate: (id) =>
      applyOptimistic<EdgeRule[]>(qc, edgeRuleFilters, (old) => old.filter((r) => r.id !== id)),
    onError: (_err, _id, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries(edgeRuleFilters),
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

export function useQueueSend(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['QueueSendRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/queues/send', { params: { path: { slug } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apps', slug, 'queues'] });
    },
  });
}

export function useAppRegistryCredentials(slug: string) {
  return useQuery({
    queryKey: keys.appRegistryCredentials(slug),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/registry-credentials', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useSetAppRegistryCredential(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['PutAppRegistryCredentialRequest']) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/registry-credentials', {
          params: { path: { slug } },
          body,
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appRegistryCredentials(slug) }),
  });
}

export function useDeleteAppRegistryCredential(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registry: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/registry-credentials', {
          params: { path: { slug }, query: { registry } },
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.appRegistryCredentials(slug) }),
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

export function useBuilds(options?: Options<components['schemas']['BuildListResponse']>) {
  return useQuery({
    queryKey: ['builds'],
    queryFn: () => unwrap(api.GET('/v1/builds', {})),
    ...options,
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
    // The enable/disable switch answers immediately instead of after a
    // round-trip-plus-refetch; a rejected PATCH flips it back with the toast.
    onMutate: ({ id, ...patch }) =>
      applyOptimistic<EdgeRule[]>(qc, edgeRuleFilters, (old) =>
        old.map((r) => (r.id === id ? ({ ...r, ...patch } as EdgeRule) : r))
      ),
    onError: (_err, _vars, rollback) => rollback?.(),
    onSettled: () => qc.invalidateQueries(edgeRuleFilters),
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
