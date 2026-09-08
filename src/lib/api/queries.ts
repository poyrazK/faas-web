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
import type { components, paths } from './schema';

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
  triggers: ['triggers'] as const,
  jobs: ['jobs'] as const,
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

/**
 * Cancel a deployment that is still in flight.
 *
 * The API answers 409 once the deployment has gone live — by then there is
 * nothing to cancel, which is an outcome to explain rather than an error.
 */
export function useCancelDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, id }: { slug: string; id: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/deployments/{id}/cancel', { params: { path: { slug, id } } })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deployments }),
  });
}

/**
 * Retry a failed deployment from a named stage.
 *
 * The API duplicates the row rather than mutating it and answers 202 with a new
 * deployment, so this invalidates the list instead of patching the failed row —
 * the retry is a separate event and the timeline is supposed to show both.
 */
export function useRetryDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, from_stage }: { id: string; from_stage: RetryStage }) =>
      unwrap(
        api.POST('/v1/deployments/{id}/retry', { params: { path: { id } }, body: { from_stage } })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deployments }),
  });
}

/**
 * The closed six-stage summary a deploy leaves behind (ADR-117). The wire is
 * the raw `deployments.stage_state` column, so every field is optional; the
 * 404 for an unknown or cross-account id is the only error branch.
 */
export type DeploymentStages = NonNullable<
  paths['/v1/deployments/{id}/stages']['get']['responses'][200]['content']['application/json']
>;

export function useDeploymentStages(id: string) {
  return useQuery({
    queryKey: ['deployments', id, 'stages'],
    queryFn: () => unwrap(api.GET('/v1/deployments/{id}/stages', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/** Reverse-chronological deployment_audit rows; `limit` is echoed back clamped. */
export function useDeploymentAudit(id: string, limit = 50) {
  return useQuery({
    queryKey: ['deployments', id, 'audit', limit],
    queryFn: () =>
      unwrap(api.GET('/v1/deployments/{id}/audit', { params: { path: { id }, query: { limit } } })),
    enabled: Boolean(id),
  });
}

/**
 * The per-deployment preview host. `alive=false` comes back as a 200 with an
 * empty url, so a closed preview is data, not an error.
 */
export function useDeploymentPreviewUrl(id: string) {
  return useQuery({
    queryKey: ['deployments', id, 'url'],
    queryFn: () => unwrap(api.GET('/v1/deployments/{id}/url', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/**
 * Advance a persisted canary by one stage. The caller sends the step it saw;
 * a stale step answers `409 canary_step_conflict`, which is the API refusing
 * to double-advance, not a failure to act on.
 */
export function useAdvanceCanary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expected_step }: { id: string; expected_step: number }) =>
      unwrap(
        api.POST('/v1/deployments/{id}/canary/advance', {
          params: { path: { id } },
          body: { expected_step },
        })
      ),
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: ['deployments', id] });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

/** Priority of a still-pending deployment: 0 deploys next, 100 is FIFO, 1000 is background. */
export function useReorderDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: number }) =>
      unwrap(
        api.POST('/v1/deployments/{id}/reorder', { params: { path: { id } }, body: { priority } })
      ),
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: ['deployments', id] });
      void qc.invalidateQueries({ queryKey: keys.deployments });
    },
  });
}

/**
 * Soft-delete superseded, failed and cancelled deployments older than the
 * cutoff. The API defaults to 168h; it is sent explicitly so the request says
 * what it does.
 */
export function useClearObsoleteDeployments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, older_than = '168h' }: { slug: string; older_than?: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/deployments/clear-obsolete', {
          params: { path: { slug } },
          body: { older_than },
        })
      ),
    onSettled: (_data, _err, { slug }) => {
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.appDeployments(slug) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Traffic mirroring (ADR-124 / ADR-125)
 * ------------------------------------------------------------------ */

export type MirrorRule = components['schemas']['MirrorRuleResponse'];
export type MirrorWindow = '1h' | '24h' | '7d';

export function useMirrorRules(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'mirrors'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/mirrors', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useCreateMirrorRule(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateMirrorRuleRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/mirrors', { params: { path: { slug } }, body })),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['apps', slug, 'mirrors'] }),
  });
}

export function useUpdateMirrorRule(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & components['schemas']['UpdateMirrorRuleRequest']) =>
      unwrap(api.PATCH('/v1/apps/{slug}/mirrors/{id}', { params: { path: { slug, id } }, body })),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['apps', slug, 'mirrors'] }),
  });
}

export function useDeleteMirrorRule(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/mirrors/{id}', { params: { path: { slug, id } } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['apps', slug, 'mirrors'] }),
  });
}

/**
 * Drift counts over a trailing window. `mean_latency_diff_ms` is signed —
 * positive means the mirror answered slower than the source — so the sign is
 * the finding and the number is its size.
 */
export function useMirrorSummary(slug: string, id: string, window: MirrorWindow) {
  return useQuery({
    queryKey: ['apps', slug, 'mirrors', id, 'summary', window],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/mirrors/{id}/summary', {
          params: { path: { slug, id }, query: { window } },
        })
      ),
    enabled: Boolean(slug && id),
  });
}

/** The closed-6 stage vocabulary the retry endpoint accepts (ADR-117). */
export type RetryStage = components['schemas']['RetryDeploymentRequest']['from_stage'];

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

/**
 * Triggers — the unified event-source primitive (spec §4.10, ADR-100).
 *
 * Account-wide like crons, not per-app, so this page is a sidebar entry
 * rather than an app tab even though every trigger names an app.
 */
export function useTriggers() {
  return useQuery({
    queryKey: keys.triggers,
    queryFn: () => unwrap(api.GET('/v1/triggers', {})),
  });
}

/**
 * Jobs — batch and recurring workloads (spec §14.A), account-wide like
 * triggers rather than per-app.
 *
 * Plan-gated: `ErrPlanJobsNotAllowed` answers `402 jobs_not_allowed` on Free.
 * The spec's prose also mentions a 404 for the same gate; the handler returns
 * 402, so that is what the UI branches on.
 */
export function useJobs() {
  return useQuery({
    queryKey: keys.jobs,
    queryFn: () => unwrap(api.GET('/v1/jobs', {})),
  });
}

export function useJobRuns(name: string | null) {
  return useQuery({
    queryKey: ['jobs', name, 'runs'],
    enabled: name !== null,
    queryFn: () => unwrap(api.GET('/v1/jobs/{name}/runs', { params: { path: { name: name! } } })),
  });
}

export function useJobTasks(name: string | null, runId: string | null) {
  return useQuery({
    queryKey: ['jobs', name, 'runs', runId, 'tasks'],
    enabled: name !== null && runId !== null,
    queryFn: () =>
      unwrap(
        api.GET('/v1/jobs/{name}/runs/{id}/tasks', {
          params: { path: { name: name!, id: runId! } },
        })
      ),
  });
}

/**
 * Tail of one task's log. The response carries `truncated` and `max_bytes`,
 * so a cut log can say it was cut rather than passing for the whole thing.
 */
export function useJobTaskLog(name: string, runId: string, taskIndex: number | null) {
  return useQuery({
    queryKey: ['jobs', name, 'runs', runId, 'tasks', taskIndex, 'logs'],
    enabled: taskIndex !== null,
    queryFn: () =>
      unwrap(
        api.GET('/v1/jobs/{name}/runs/{id}/tasks/{idx}/logs', {
          params: { path: { name, id: runId, idx: taskIndex! } },
        })
      ),
  });
}

/** Cancel an in-flight run. Answers the post-cancel aggregate, not 204. */
export function useCancelJobRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, runId }: { name: string; runId: string }) =>
      unwrap(
        api.POST('/v1/jobs/{name}/runs/{id}/cancel', {
          params: { path: { name, id: runId } },
        })
      ),
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: ['jobs', vars.name] }),
  });
}

export type Job = components['schemas']['JobResponse'];
export type JobRun = components['schemas']['JobRunResponse'];
export type JobTask = components['schemas']['JobTaskResponse'];

/**
 * The production debugger (ADR-127).
 *
 * Plan-gated: `DebugTelemetryEnabled` is false on Free, so every one of these
 * answers `402 plan_feature_gated` there. That is a fact about the plan, not a
 * failure, and the page says so rather than showing an error.
 *
 * The window is clamped server-side to `DebugTelemetryRetentionDays`, so the
 * UI offers only windows the plan actually retains — asking for 7 days on a
 * 3-day plan silently returns 3, and a console that showed "7 days" over that
 * would be lying about what it drew.
 */
export function useDebugRequests(slug: string, since: string) {
  return useQuery({
    queryKey: ['apps', slug, 'debug', 'requests', since],
    enabled: Boolean(slug),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/requests', {
          params: { path: { slug }, query: { since } },
        })
      ),
  });
}

export function useDebugRegressions(slug: string, since: string) {
  return useQuery({
    queryKey: ['apps', slug, 'debug', 'regressions', since],
    enabled: Boolean(slug),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/regressions', {
          params: { path: { slug }, query: { since } },
        })
      ),
  });
}

/**
 * Per-route latency for two deployments over one window.
 *
 * The body calls them `source` and `mirror`, but the handler simply runs the
 * same per-route query against each deployment id — there is no mirror
 * relationship required, so this compares any two deployments. That is what
 * makes it answer "did the last deploy make this route slower?".
 */
export function useCompareDeployments(slug: string) {
  return useMutation({
    mutationFn: (body: components['schemas']['DebugCompareRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/debug/compare', { params: { path: { slug } }, body })),
  });
}

/** The five per-state counts. Scalars, so they stay scalars — no chart. */
export function useTriggerMetrics(id: string | null) {
  return useQuery({
    queryKey: ['triggers', id, 'metrics'],
    enabled: id !== null,
    queryFn: () => unwrap(api.GET('/v1/triggers/{id}/metrics', { params: { path: { id: id! } } })),
  });
}

export function useTriggerRecords(id: string | null, state: TriggerRecordState | '') {
  return useQuery({
    queryKey: ['triggers', id, 'records', state],
    enabled: id !== null,
    queryFn: () =>
      unwrap(
        api.GET('/v1/triggers/{id}/records', {
          params: { path: { id: id! }, query: state ? { state } : {} },
        })
      ),
  });
}

export function useTriggerDeadLetter(id: string | null, reason: TriggerDeadLetterReason | '') {
  return useQuery({
    queryKey: ['triggers', id, 'dlq', reason],
    enabled: id !== null,
    queryFn: () =>
      unwrap(
        api.GET('/v1/triggers/{id}/dlq', {
          params: { path: { id: id! }, query: reason ? { reason } : {} },
        })
      ),
  });
}

/**
 * Pause and resume are the cheapest way to stop a misbehaving trigger, so
 * they live on the row rather than behind a detail view.
 */
export function useSetTriggerEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap(
        enabled
          ? api.POST('/v1/triggers/{id}/resume', { params: { path: { id } } })
          : api.POST('/v1/triggers/{id}/pause', { params: { path: { id } } })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.triggers }),
  });
}

/**
 * Push one record back into the dispatch queue.
 *
 * The API answers 409 `trigger_dlq_retry_failed` when the record's state was
 * neither `retry` nor `dead_letter` — a record that already succeeded, or is
 * mid-flight, has nothing to re-drive. That is a state to explain, not a
 * failure to report.
 *
 * Invalidates the whole trigger family: a retried record leaves the dead-letter
 * list and changes the per-state counts, and seeing both move is the
 * confirmation the action worked.
 */
export function useRetryTriggerRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ triggerId, recordId }: { triggerId: string; recordId: string }) =>
      unwrap(
        api.POST('/v1/triggers/{id}/records/{rid}/retry', {
          params: { path: { id: triggerId, rid: recordId } },
        })
      ),
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: ['triggers', vars.triggerId] }),
  });
}

/** Discard a record without re-firing it. Irreversible, hence the confirm. */
export function useDropTriggerRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ triggerId, recordId }: { triggerId: string; recordId: string }) =>
      unwrap(
        api.POST('/v1/triggers/{id}/records/{rid}/drop', {
          params: { path: { id: triggerId, rid: recordId } },
        })
      ),
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: ['triggers', vars.triggerId] }),
  });
}

export type TriggerRecordState = components['schemas']['TriggerRecordState'];
export type TriggerDeadLetterReason = components['schemas']['TriggerDeadLetterReason'];
export type Trigger = components['schemas']['Trigger'];

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

export function useInstances(options?: Options<components['schemas']['ListInstancesResponse']>) {
  return useQuery({
    queryKey: keys.instances,
    queryFn: () => unwrap(api.GET('/v1/instances', {})),
    ...options,
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

/**
 * Re-run DNS + certificate verification for one domain.
 *
 * The row is refreshed from the server rather than patched optimistically: the
 * point of pressing Verify is to learn what the platform observes, so guessing
 * the outcome locally would defeat it.
 */
export function useVerifyDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      unwrap(api.POST('/v1/domains/{domain}/verify', { params: { path: { domain } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.domains }),
  });
}

/**
 * The five-check domain doctor (ADR-120). Disabled until a domain is selected,
 * because the probe is synchronous server-side when its cache is cold.
 */
export function useDomainDoctor(domain: string | null) {
  return useQuery({
    queryKey: ['domains', domain, 'doctor'],
    enabled: domain !== null,
    // The report is a live probe; a cached one would misreport a DNS change the
    // customer just made, which is precisely when they open this.
    staleTime: 0,
    queryFn: () =>
      unwrap(api.GET('/v1/domains/{domain}/doctor', { params: { path: { domain: domain! } } })),
  });
}

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

/**
 * Recent deliveries for one alert rule — whether it actually reached the
 * webhook, and what came back when it did not.
 *
 * `include_test` defaults to false to match the API: the test-alert button
 * writes delivery rows too, and a customer checking whether a rule fired in
 * production does not want their own test clicks in the answer.
 */
export function useAlertDeliveries(slug: string, ruleId: string, includeTest: boolean) {
  return useQuery({
    queryKey: ['apps', slug, 'alerts', ruleId, 'deliveries', includeTest],
    enabled: Boolean(slug && ruleId),
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/alerts/{id}/deliveries', {
          params: { path: { slug, id: ruleId }, query: { include_test: includeTest } },
        })
      ),
  });
}

/** The system-seeded alert-preset catalog (ADR-123). Read-only for customers. */
export function useAlertPresets() {
  return useQuery({
    queryKey: ['alert-presets'],
    // The catalog is seeded server-side and changes on deploys, not on use.
    staleTime: 5 * 60_000,
    queryFn: () => unwrap(api.GET('/v1/alert-presets', {})),
  });
}

/** Instantiate a preset as a real alert rule on one app. */
export function useEnableAlertPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      name,
      body,
    }: {
      slug: string;
      name: string;
      body: components['schemas']['EnableAlertPresetRequest'];
    }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/alert-presets/{name}/enable', {
          params: { path: { slug, name } },
          body,
        })
      ),
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: ['apps', vars.slug, 'alerts'] }),
  });
}

/**
 * Fire a synthetic alert at the rule this preset instantiated.
 *
 * 404 means the preset was never enabled here — there is no rule to dispatch
 * to, which is a prerequisite to state rather than a failure to report.
 */
export function useTestAlertPreset() {
  return useMutation({
    mutationFn: ({ slug, name }: { slug: string; name: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/alert-presets/{name}/test', {
          params: { path: { slug, name } },
        })
      ),
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

/* ------------------------------------------------------------------ *
 * Tenant surfaces (ADR-100)
 * ------------------------------------------------------------------ */

export type TenantSurface = components['schemas']['TenantSurfaceResponse'];
export type TenantHostname = components['schemas']['TenantHostnameResponse'];

const tenantSurfacesKey = (slug: string) => ['apps', slug, 'tenant-surfaces'] as const;

/** Plan/flag-gated: `402 tenant_surfaces_not_allowed` comes back on the list too. */
export function useTenantSurfaces(slug: string) {
  return useQuery({
    queryKey: tenantSurfacesKey(slug),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/tenant-surfaces', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useCreateTenantSurface(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateTenantSurfaceRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/tenant-surfaces', { params: { path: { slug } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantSurfacesKey(slug) }),
  });
}

export function useDeleteTenantSurface(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/tenant-surfaces/{id}', { params: { path: { slug, id } } })
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantSurfacesKey(slug) }),
  });
}

export function useAddTenantHostname(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hostname }: { id: string; hostname: string }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/tenant-surfaces/{id}/hostnames', {
          params: { path: { slug, id } },
          body: { hostname },
        })
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantSurfacesKey(slug) }),
  });
}

export function useRemoveTenantHostname(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hostname }: { id: string; hostname: string }) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/tenant-surfaces/{id}/hostnames/{hostname}', {
          params: { path: { slug, id, hostname } },
        })
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantSurfacesKey(slug) }),
  });
}

/* ------------------------------------------------------------------ *
 * OpenAPI import (ADR-126) and per-deployment discovery (ADR-122)
 * ------------------------------------------------------------------ */

export type OpenAPISource = 'manual_import' | 'auto';
/** The body the import and dry-run endpoints take: a 3.0 / 3.1 document. */
export type OpenAPIDocument =
  paths['/v1/apps/{slug}/openapi']['post']['requestBody']['content']['application/json'];
export type EdgeRuleSuggestion = components['schemas']['EdgeRuleSuggestion'];

const appOpenAPIKey = (slug: string) => ['apps', slug, 'openapi'] as const;

/**
 * `manual_import` is the customer's own document verbatim and 404s with
 * `not_found` when nothing was imported; `auto` is the platform-merged view
 * (import ∪ observed routes ∪ edge rules) and always answers.
 */
export function useAppOpenAPI(slug: string, source: OpenAPISource) {
  return useQuery({
    queryKey: [...appOpenAPIKey(slug), source],
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/openapi', { params: { path: { slug }, query: { source } } })),
    enabled: Boolean(slug),
    retry: false,
  });
}

/** Read-only: validates the document and lists the edge rules it would suggest. */
export function useDryRunAppOpenAPI(slug: string) {
  return useMutation({
    mutationFn: (body: OpenAPIDocument) =>
      unwrap(api.POST('/v1/apps/{slug}/openapi/dry-run', { params: { path: { slug } }, body })),
  });
}

export function useImportAppOpenAPI(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OpenAPIDocument) =>
      unwrap(api.POST('/v1/apps/{slug}/openapi', { params: { path: { slug } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: appOpenAPIKey(slug) }),
  });
}

export function useDeleteAppOpenAPI(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/v1/apps/{slug}/openapi', { params: { path: { slug } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: appOpenAPIKey(slug) }),
  });
}

/**
 * The document the cold-boot probe captured from the app itself. Paid plans
 * only: Free answers `402 openapi_docs_not_allowed`; `404` means nothing was
 * captured for this deployment.
 */
export function useDeploymentOpenAPIDoc(slug: string, deployment: string) {
  return useQuery({
    queryKey: ['apps', slug, 'deployments', deployment, 'openapi'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/deployments/{deployment}/openapi', {
          params: { path: { slug, deployment } },
        })
      ),
    enabled: Boolean(slug && deployment),
    retry: false,
  });
}

/* ------------------------------------------------------------------ *
 * Per-app singles: wake timeline, usage, env diff, static egress IP,
 * streaming classification
 * ------------------------------------------------------------------ */

export type AppWakeTimeline = components['schemas']['AppWakeTimelineResponse'];
export type AppUsageSummary = components['schemas']['AppUsageSummaryResponse'];
export type EnvDiff = components['schemas']['EnvDiffResponse'];
export type AppStaticEgressIP = components['schemas']['AppStaticEgressIPResponse'];
export type AppStreamingStatus = components['schemas']['AppStreamingStatus'];

/** Where recent wakes spent their time; `402 plan_per_app_metrics_not_allowed` on Free. */
export function useAppWakeTimeline(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'wake-timeline'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/wake-timeline', { params: { path: { slug } } })),
    enabled: Boolean(slug),
    retry: false,
  });
}

/** Trailing-30-day billing usage; `402 plan_app_usage_summary_not_allowed` on Free. */
export function useAppUsage(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'usage'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/usage', { params: { path: { slug } } })),
    enabled: Boolean(slug),
    retry: false,
  });
}

export function useAppEnvDiff(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'env-diff'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/env-diff', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

const staticEgressKey = (slug: string) => ['apps', slug, 'static-egress-ip'] as const;

/** Never gated on read: `plan_allowed=false` is the answer, not an error. */
export function useAppStaticEgressIP(slug: string) {
  return useQuery({
    queryKey: staticEgressKey(slug),
    queryFn: () =>
      unwrap(api.GET('/v1/apps/{slug}/static-egress-ip', { params: { path: { slug } } })),
    enabled: Boolean(slug),
  });
}

export function useSetAppStaticEgressIP(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ip: string) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/static-egress-ip', {
          params: { path: { slug } },
          body: { ip, set: true },
        })
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: staticEgressKey(slug) }),
  });
}

export function useClearAppStaticEgressIP(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.DELETE('/v1/apps/{slug}/static-egress-ip', { params: { path: { slug } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: staticEgressKey(slug) }),
  });
}

/** The probe that decides whether this app's responses stream, and why (ADR-102). */
export function useAppStreamingCap(slug: string) {
  return useQuery({
    queryKey: ['apps', slug, 'streaming-cap'],
    queryFn: () => unwrap(api.GET('/v1/apps/{slug}/streaming-cap', { params: { path: { slug } } })),
    enabled: Boolean(slug),
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

/**
 * Reset one dead-lettered row back to pending.
 *
 * Invalidates the whole queue family, not just the dead-letter list: a replayed
 * row leaves one table and appears in the other, and seeing it move is the
 * confirmation that the action worked.
 */
export function useReplayDeadLetter(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/queues/dead_letter/{id}/replay', {
          params: { path: { slug, id } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ['apps', slug, 'queues'] }),
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

/* ------------------------------------------------------------------ *
 * Small closures: CORS presets, the template catalog, one audit event,
 * preview teardown
 * ------------------------------------------------------------------ */

export type CorsPreset = components['schemas']['CorsPresetResponse'];
export type TemplateView = components['schemas']['TemplateView'];
export type AuditEvent = components['schemas']['AuditEventResponse'];

const corsPresetsKey = ['cors-presets'] as const;

/** Account-wide presets plus, when `appId` is given, that app's scoped ones. */
export function useCorsPresets(appId?: string) {
  return useQuery({
    queryKey: [...corsPresetsKey, appId ?? 'all'],
    queryFn: () =>
      unwrap(api.GET('/v1/cors-presets', { params: { query: appId ? { app_id: appId } : {} } })),
  });
}

export function useCreateCorsPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateCorsPresetRequest']) =>
      unwrap(api.POST('/v1/cors-presets', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: corsPresetsKey }),
  });
}

export function useDeleteCorsPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/cors-presets/{id}', { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: corsPresetsKey }),
  });
}

/** The 13-entry starter catalog the CLI's `init --template` reads from the same source. */
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => unwrap(api.GET('/v1/templates', {})),
    staleTime: 5 * 60_000,
  });
}

/** One auth audit event; cross-account ids read as `not_found`. */
export function useAuditEvent(id: string) {
  return useQuery({
    queryKey: ['audit-events', id],
    queryFn: () => unwrap(api.GET('/v1/audit-events/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/**
 * Tear down a preview app. Distinct from deleting an app: the row is stamped
 * `torn_down` so the janitor skips it, and the audit kind differs. A slug that
 * is not a preview answers `404 preview_not_found`.
 */
export function useDestroyPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.POST('/v1/preview/{slug}/destroy', { params: { path: { slug } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.apps }),
  });
}

/* ------------------------------------------------------------------ *
 * Request analytics, request evidence, app lifecycle, upstream history,
 * rollout recovery, one trigger, a tarball deploy
 * ------------------------------------------------------------------ */

export type RequestAnalytics = components['schemas']['RequestAnalyticsResponse'];
export type RequestAnalyticsTimeseries =
  components['schemas']['RequestAnalyticsTimeseriesResponse'];
export type AnalyticsGroupBy = RequestAnalytics['group_by'];
export type DebugRequestEvidence = components['schemas']['DebugRequestEvidenceResponse'];
export type UpstreamHistory = components['schemas']['DataUpstreamHistoryResponse'];

/** Aggregated request analytics; `402` on Free, like the rest of per-app metrics. */
export function useAppAnalytics(slug: string, since: string, groupBy: AnalyticsGroupBy) {
  return useQuery({
    queryKey: ['apps', slug, 'analytics', since, groupBy],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/analytics', {
          params: { path: { slug }, query: { since, group_by: groupBy } },
        })
      ),
    enabled: Boolean(slug),
    retry: false,
  });
}

/** Hourly buckets, zero-filled by the API — a real series, so a line is honest. */
export function useAppAnalyticsTimeseries(slug: string, since: string) {
  return useQuery({
    queryKey: ['apps', slug, 'analytics', 'timeseries', since],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/analytics/timeseries', {
          params: { path: { slug }, query: { since } },
        })
      ),
    enabled: Boolean(slug),
    retry: false,
  });
}

export function useDebugRequest(slug: string, reqId: string) {
  return useQuery({
    queryKey: ['apps', slug, 'debug', 'requests', reqId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/requests/{req_id}', {
          params: { path: { slug, req_id: reqId } },
        })
      ),
    enabled: Boolean(slug && reqId),
    retry: false,
  });
}

/** The spans behind one request plus the platform's own explanation of it. */
export function useDebugRequestEvidence(slug: string, reqId: string) {
  return useQuery({
    queryKey: ['apps', slug, 'debug', 'requests', reqId, 'evidence'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/requests/{req_id}/evidence', {
          params: { path: { slug, req_id: reqId } },
        })
      ),
    enabled: Boolean(slug && reqId),
    retry: false,
  });
}

/** Purge the edge response cache, optionally under one path glob. */
export function usePurgeAppCache(slug: string) {
  return useMutation({
    mutationFn: (path?: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/cache', {
          params: { path: { slug }, query: path ? { path } : {} },
        })
      ),
  });
}

/** Park every instance, snapshot afresh, and queue one replacement wake. */
export function useRestartApp(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/v1/apps/{slug}/restart', { params: { path: { slug } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
      void qc.invalidateQueries({ queryKey: ['apps', slug, 'wake-timeline'] });
    },
  });
}

/** Undo a delete inside the grace window. */
export function useRestoreApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap(api.POST('/v1/apps/{slug}/restore', { params: { path: { slug } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.apps }),
  });
}

/** Bucketed probe history per declared upstream. */
export function useUpstreamHistory(slug: string, bucket: string) {
  return useQuery({
    queryKey: ['apps', slug, 'upstreams', 'history', bucket],
    queryFn: () =>
      unwrap(
        api.GET('/v1/apps/{slug}/upstreams/history', {
          params: { path: { slug }, query: { bucket } },
        })
      ),
    enabled: Boolean(slug),
  });
}

/**
 * The escape hatch for a rollout that stopped moving: advance one step
 * (refused with `409 rollout_not_stuck` while it is still progressing),
 * promote to 100%, or abort with a reason.
 */
export function useRecoverRollout(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['RecoverRolloutRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/rollouts/recover', { params: { path: { slug } }, body })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.appDeployments(slug) });
    },
  });
}

/** One trigger, for the detail the list cannot carry. */
export function useTrigger(id: string) {
  return useQuery({
    queryKey: ['triggers', id],
    queryFn: () => unwrap(api.GET('/v1/triggers/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/**
 * Deploy a source tarball the customer picked, the console's equivalent of
 * `gregale deploy --tarball`. Multipart: openapi-fetch skips the serializer
 * when `body` is undefined, so the body is passed through as `never`.
 */
export function useDeployTarball(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      file: File;
      sidecar?: components['schemas']['SourceTarballDeployRequest'];
    }) =>
      unwrap(
        api.POST('/v1/apps/{slug}/deployments/source-tarball', {
          params: { path: { slug } },
          body: input as never,
          bodySerializer: () => {
            const form = new FormData();
            form.append('tarball', input.file);
            if (input.sidecar) form.append('sidecar', JSON.stringify(input.sidecar));
            return form;
          },
        })
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.appDeployments(slug) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Managed PostgreSQL
 * ------------------------------------------------------------------ */

export type PostgresDatabase = components['schemas']['ManagedPostgresDatabase'];
export type PostgresBinding = components['schemas']['ManagedPostgresBinding'];

const postgresKey = ['postgres', 'databases'] as const;

export function usePostgresDatabases() {
  return useQuery({
    queryKey: postgresKey,
    queryFn: () => unwrap(api.GET('/v1/postgres/databases', {})),
    // Provisioning finishes on the provider's clock, not the browser's.
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some(
        (d) => d.state === 'provisioning' || d.state === 'deleting'
      )
        ? 5_000
        : false,
  });
}

export function usePostgresDatabase(id: string) {
  return useQuery({
    queryKey: [...postgresKey, id],
    queryFn: () => unwrap(api.GET('/v1/postgres/databases/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useCreatePostgresDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateManagedPostgresDatabaseRequest']) =>
      unwrap(api.POST('/v1/postgres/databases', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postgresKey }),
  });
}

export function useDeletePostgresDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/postgres/databases/{id}', { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postgresKey }),
  });
}

/** Point-in-time restore: always into a new database, never over the old one. */
export function useRestorePostgresDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; point_in_time: string }) =>
      unwrap(api.POST('/v1/postgres/databases/{id}/restore', { params: { path: { id } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postgresKey }),
  });
}

export function usePostgresBindings(id: string) {
  return useQuery({
    queryKey: [...postgresKey, id, 'bindings'],
    queryFn: () =>
      unwrap(api.GET('/v1/postgres/databases/{id}/bindings', { params: { path: { id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some(
        (b) => b.state === 'provisioning' || b.state === 'deleting'
      )
        ? 5_000
        : false,
  });
}

export function usePostgresBinding(id: string) {
  return useQuery({
    queryKey: ['postgres', 'bindings', id],
    queryFn: () => unwrap(api.GET('/v1/postgres/bindings/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

/** Credentials never reach the browser: the app gets them as a secret. */
export function useCreatePostgresBinding(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['CreateManagedPostgresBindingRequest']) =>
      unwrap(
        api.POST('/v1/postgres/databases/{id}/bindings', {
          params: { path: { id: databaseId } },
          body,
        })
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: [...postgresKey, databaseId, 'bindings'] }),
  });
}

export function useDeletePostgresBinding(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/postgres/bindings/{id}', { params: { path: { id } } })),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: [...postgresKey, databaseId, 'bindings'] }),
  });
}
