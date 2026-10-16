import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * API monetization (ADR-120): app consumers, their keys and plans, durable
 * usage, quotes and statements, and the account-level customers
 * ("platform tenants") that group consumers and surfaces across apps.
 *
 * Every read here is gated by the caller on the `api-monetization`
 * capability, so `enabled` is threaded through rather than assumed — a query
 * that never runs must not be shown as loading (see `queryPhase`).
 *
 * Two writes deliberately bypass `useMutation`: issuing a consumer key returns
 * its plaintext exactly once, and TanStack keeps a mutation's result in its
 * cache. The direct call hands the plaintext to the one-time panel and to
 * nothing else.
 */

type S = components['schemas'];
export type Consumer = S['APIConsumerResponse'];
export type ConsumerKey = S['ConsumerKeyResponse'];
export type ConsumerKeyMetadata = Omit<ConsumerKey, 'key'>;
export type ConsumerKeyScope = S['CreateConsumerKeyRequest']['scopes'][number];
export type ConsumerPlan = S['APIConsumerPlanResponse'];
export type PlanAssignment = S['APIConsumerPlanAssignmentResponse'];
export type ConsumerUsage = S['APIConsumerUsageResponse'];
export type ConsumerQuote = S['APIConsumerUsageQuoteResponse'];
export type UsageAlert = S['APIConsumerUsageAlertResponse'];
export type ConsumerStatement = S['APIConsumerUsageStatementResponse'];
export type ConsumerHandoff = S['APIConsumerUsageStatementHandoffResponse'];
export type PlatformTenant = S['PlatformTenantResponse'];
export type PlatformTenantDetail = S['PlatformTenantDetailResponse'];
export type TenantRateCard = S['PlatformTenantRateCardResponse'];
export type TenantUsage = S['PlatformTenantUsageResponse'];
export type TenantStatement = S['PlatformTenantStatementResponse'];
export type TenantHandoff = S['PlatformTenantStatementHandoffResponse'];
export type TenantCredential = S['PlatformTenantCredentialMetadata'];

/** A half-open UTC window, as RFC3339 strings. */
export interface UsageWindow {
  since: string;
  until: string;
}

export const monetizationKeys = {
  consumers: (slug: string) => ['apps', slug, 'consumers'] as const,
  consumer: (slug: string, id: string) => ['apps', slug, 'consumers', id] as const,
  keys: (slug: string, id: string) => ['apps', slug, 'consumers', id, 'keys'] as const,
  assignments: (slug: string, id: string) =>
    ['apps', slug, 'consumers', id, 'plan-assignments'] as const,
  usage: (slug: string, id: string, w: UsageWindow) =>
    ['apps', slug, 'consumers', id, 'usage', w.since, w.until] as const,
  quote: (slug: string, id: string, w: UsageWindow) =>
    ['apps', slug, 'consumers', id, 'quote', w.since, w.until] as const,
  alerts: (slug: string, id: string) => ['apps', slug, 'consumers', id, 'usage-alerts'] as const,
  statements: (slug: string, id: string) =>
    ['apps', slug, 'consumers', id, 'usage-statements'] as const,
  handoff: (slug: string, id: string, statementId: string) =>
    ['apps', slug, 'consumers', id, 'usage-statements', statementId, 'handoff'] as const,
  plans: (slug: string) => ['apps', slug, 'consumer-plans'] as const,
  tenants: ['platform-tenants'] as const,
  tenantList: ['platform-tenants', 'list'] as const,
  tenant: (id: string) => ['platform-tenants', id] as const,
  rateCards: (id: string) => ['platform-tenants', id, 'rate-cards'] as const,
  tenantUsage: (id: string, w: UsageWindow) =>
    ['platform-tenants', id, 'usage', w.since, w.until] as const,
  tenantStatements: (id: string, w: UsageWindow) =>
    ['platform-tenants', id, 'usage-statements', w.since, w.until] as const,
  tenantHandoff: (id: string, statementId: string) =>
    ['platform-tenants', id, 'usage-statements', statementId, 'handoff'] as const,
  credentials: (id: string) => ['platform-tenants', id, 'credentials'] as const,
};

/** A fresh key per user action; the API stores it for 24h and replays on repeat. */
function idempotencyKey(): string {
  return crypto.randomUUID();
}

// --- App consumers -------------------------------------------------------------

export function useConsumers(slug: string, enabled = true) {
  return useQuery({
    queryKey: monetizationKeys.consumers(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/consumers', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

export function useCreateConsumer(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S['CreateAPIConsumerRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/consumers', { params: { path: { slug } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.consumers(slug) }),
  });
}

export function useRevokeConsumer(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (consumerId: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/consumers/{consumer_id}', {
          params: { path: { slug, consumer_id: consumerId } },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.consumers(slug) }),
  });
}

// --- Consumer keys ---------------------------------------------------------------

/** Strip `key` defensively: the list never carries it, and the cache must not either. */
function keyMetadata(key: ConsumerKey): ConsumerKeyMetadata {
  const { key: plaintext, ...rest } = key;
  void plaintext;
  return rest;
}

export function useConsumerKeys(slug: string, consumerId: string) {
  return useQuery({
    queryKey: monetizationKeys.keys(slug, consumerId),
    queryFn: async ({ signal }) => {
      const result = await unwrap(
        api.GET('/v1/apps/{slug}/consumers/{consumer_id}/keys', {
          params: { path: { slug, consumer_id: consumerId } },
          signal,
        })
      );
      return result.keys.map(keyMetadata);
    },
    enabled: Boolean(slug && consumerId),
    retry: retryPolicy,
  });
}

/** Direct call by design — see the module note. The caller invalidates `keys`. */
export function issueConsumerKey(
  slug: string,
  consumerId: string,
  body: S['CreateConsumerKeyRequest']
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/consumers/{consumer_id}/keys', {
      params: { path: { slug, consumer_id: consumerId } },
      body,
    })
  );
}

export function useRevokeConsumerKey(slug: string, consumerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keyId: string) =>
      keyMetadata(
        await unwrap(
          api.DELETE('/v1/apps/{slug}/consumers/{consumer_id}/keys/{key_id}', {
            params: { path: { slug, consumer_id: consumerId, key_id: keyId } },
          })
        )
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.keys(slug, consumerId) }),
  });
}

// --- Plans and assignments ---------------------------------------------------------

export function useConsumerPlans(slug: string, enabled = true) {
  return useQuery({
    queryKey: monetizationKeys.plans(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/consumer-plans', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

export function useCreateConsumerPlan(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S['CreateAPIConsumerPlanRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/consumer-plans', {
          params: { path: { slug }, header: { 'Idempotency-Key': idempotencyKey() } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.plans(slug) }),
  });
}

export function useUpdateConsumerPlanLimits(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S['UpdateAPIConsumerPlanLimitsRequest'] }) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/consumer-plans/{plan_id}', {
          params: { path: { slug, plan_id: id } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.plans(slug) }),
  });
}

function fetchAssignments(slug: string, consumerId: string, signal?: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/consumers/{consumer_id}/plan-assignments', {
      params: { path: { slug, consumer_id: consumerId } },
      signal,
    })
  ).then((r) => r.assignments);
}

export function usePlanAssignments(slug: string, consumerId: string) {
  return useQuery({
    queryKey: monetizationKeys.assignments(slug, consumerId),
    queryFn: ({ signal }) => fetchAssignments(slug, consumerId, signal),
    enabled: Boolean(slug && consumerId),
    retry: retryPolicy,
  });
}

/**
 * Plan history for the consumers a list shows. The consumer record does not
 * carry its plan, so the list asks per consumer; the cap keeps a large
 * customer base from turning one page view into hundreds of requests.
 */
export const PLAN_LOOKUP_CAP = 50;
export function useAssignmentsFor(slug: string, consumerIds: string[]) {
  return useQueries({
    queries: consumerIds.slice(0, PLAN_LOOKUP_CAP).map((id) => ({
      queryKey: monetizationKeys.assignments(slug, id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAssignments(slug, id, signal),
      retry: retryPolicy,
      staleTime: 60_000,
    })),
  });
}

export function useAssignPlan(slug: string, consumerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S['AssignAPIConsumerPlanRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/consumers/{consumer_id}/plan-assignments', {
          params: {
            path: { slug, consumer_id: consumerId },
            header: { 'Idempotency-Key': idempotencyKey() },
          },
          body,
        })
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: monetizationKeys.assignments(slug, consumerId) }),
  });
}

/** The assignment in force at `now`: the latest one whose minute has started. */
export function currentAssignment(
  assignments: readonly PlanAssignment[],
  now = Date.now()
): PlanAssignment | undefined {
  let current: PlanAssignment | undefined;
  for (const a of assignments) {
    const at = Date.parse(a.effective_from);
    if (at <= now && (!current || at >= Date.parse(current.effective_from))) current = a;
  }
  return current;
}

/** The assignment in force now, and the ones scheduled after it, in order. */
export function planTimeline(assignments: readonly PlanAssignment[], now = Date.now()) {
  return {
    current: currentAssignment(assignments, now),
    scheduled: assignments
      .filter((a) => Date.parse(a.effective_from) > now)
      .sort((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from)),
  };
}

// --- Usage, quotes, alerts -----------------------------------------------------------

export function useConsumerUsage(slug: string, consumerId: string, window: UsageWindow) {
  return useQuery({
    queryKey: monetizationKeys.usage(slug, consumerId, window),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/consumers/{consumer_id}/usage', {
          params: { path: { slug, consumer_id: consumerId }, query: window },
          signal,
        })
      ),
    enabled: Boolean(slug && consumerId),
    retry: retryPolicy,
  });
}

export function useConsumerQuote(slug: string, consumerId: string, window: UsageWindow) {
  return useQuery({
    queryKey: monetizationKeys.quote(slug, consumerId, window),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/consumers/{consumer_id}/usage/quote', {
          params: { path: { slug, consumer_id: consumerId }, query: window },
          signal,
        })
      ),
    enabled: Boolean(slug && consumerId),
    retry: retryPolicy,
  });
}

export function useUsageAlerts(slug: string, consumerId: string) {
  return useQuery({
    queryKey: monetizationKeys.alerts(slug, consumerId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/consumers/{consumer_id}/usage-alerts', {
          params: { path: { slug, consumer_id: consumerId } },
          signal,
        })
      ).then((r) => r.alerts),
    enabled: Boolean(slug && consumerId),
    retry: retryPolicy,
  });
}

// --- Consumer statements --------------------------------------------------------------

export function useConsumerStatements(slug: string, consumerId: string) {
  return useQuery({
    queryKey: monetizationKeys.statements(slug, consumerId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/consumers/{consumer_id}/usage-statements', {
          params: { path: { slug, consumer_id: consumerId } },
          signal,
        })
      ).then((r) => r.statements),
    enabled: Boolean(slug && consumerId),
    retry: retryPolicy,
  });
}

export function useSnapshotStatement(slug: string, consumerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (period: S['CreateAPIConsumerUsageStatementRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/consumers/{consumer_id}/usage-statements', {
          params: {
            path: { slug, consumer_id: consumerId },
            header: { 'Idempotency-Key': idempotencyKey() },
          },
          body: period,
        })
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: monetizationKeys.statements(slug, consumerId) }),
  });
}

export function useFinalizeStatement(slug: string, consumerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (statementId: string) =>
      unwrap(
        api.POST(
          '/v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/finalize',
          {
            params: {
              path: { slug, consumer_id: consumerId, statement_id: statementId },
              header: { 'Idempotency-Key': idempotencyKey() },
            },
          }
        )
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: monetizationKeys.statements(slug, consumerId) }),
  });
}

export function useStatementHandoff(
  slug: string,
  consumerId: string,
  statementId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: monetizationKeys.handoff(slug, consumerId, statementId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/consumers/{consumer_id}/usage-statements/{statement_id}/handoff', {
          params: { path: { slug, consumer_id: consumerId, statement_id: statementId } },
          signal,
        })
      ),
    enabled: enabled && Boolean(slug && consumerId && statementId),
    retry: retryPolicy,
  });
}

// --- Platform tenants (account customers) ---------------------------------------------------

export function usePlatformTenants(enabled = true) {
  return useInfiniteQuery({
    queryKey: monetizationKeys.tenantList,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/account/platform-tenants', {
          params: { query: { limit: 100, ...(pageParam ? { page_token: pageParam } : {}) } },
          signal,
        })
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
    enabled,
    retry: retryPolicy,
  });
}

export function useRegisterTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: S['CreatePlatformTenantRequest']) => {
      const request = api.POST('/v1/account/platform-tenants', { body });
      const tenant = await unwrap(request);
      // 200 replays an existing customer with the same external_ref and name;
      // 201 created one. Both are success, and the UI says which.
      return { tenant, existing: (await request).response.status === 200 };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.tenantList }),
  });
}

export function usePlatformTenant(id: string) {
  return useQuery({
    queryKey: monetizationKeys.tenant(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/account/platform-tenants/{id}', { params: { path: { id } }, signal })),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}

export function useSetTenantStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: PlatformTenant['status']) =>
      unwrap(
        api.PATCH('/v1/account/platform-tenants/{id}', {
          params: { path: { id } },
          body: { status },
        })
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: monetizationKeys.tenant(id) });
      void qc.invalidateQueries({ queryKey: monetizationKeys.tenantList });
    },
  });
}

export function useLinkTenantConsumer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (consumerId: string) =>
      unwrap(
        api.POST('/v1/account/platform-tenants/{id}/consumers', {
          params: { path: { id } },
          body: { consumer_id: consumerId },
        })
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: monetizationKeys.tenant(id) });
      void qc.invalidateQueries({ queryKey: monetizationKeys.credentials(id) });
    },
  });
}

export function useLinkTenantSurface(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (surfaceId: string) =>
      unwrap(
        api.POST('/v1/account/platform-tenants/{id}/surfaces', {
          params: { path: { id } },
          body: { surface_id: surfaceId },
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.tenant(id) }),
  });
}

export function useTenantRateCards(id: string) {
  return useQuery({
    queryKey: monetizationKeys.rateCards(id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/account/platform-tenants/{id}/rate-cards', {
          params: { path: { id } },
          signal,
        })
      ).then((r) => r.rate_cards),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}

export function useSetTenantRateCard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S['CreatePlatformTenantRateCardRequest']) =>
      unwrap(
        api.POST('/v1/account/platform-tenants/{id}/rate-cards', {
          params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey() } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: monetizationKeys.rateCards(id) }),
  });
}

export function useTenantUsage(id: string, window: UsageWindow) {
  return useQuery({
    queryKey: monetizationKeys.tenantUsage(id, window),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/account/platform-tenants/{id}/usage', {
          params: { path: { id }, query: window },
          signal,
        })
      ),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}

/** The tenant list endpoint is per period, so the period is part of the key. */
export function useTenantStatements(id: string, period: UsageWindow) {
  return useQuery({
    queryKey: monetizationKeys.tenantStatements(id, period),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/account/platform-tenants/{id}/usage-statements', {
          params: {
            path: { id },
            query: { period_start: period.since, period_end: period.until },
          },
          signal,
        })
      ).then((r) => r.statements),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}

export function useSnapshotTenantStatement(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (period: S['CreateAPIConsumerUsageStatementRequest']) =>
      unwrap(
        api.POST('/v1/account/platform-tenants/{id}/usage-statements', {
          params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey() } },
          body: period,
        })
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: [...monetizationKeys.tenant(id), 'usage-statements'] }),
  });
}

export function useFinalizeTenantStatement(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (statementId: string) =>
      unwrap(
        api.POST('/v1/account/platform-tenants/{id}/usage-statements/{statement_id}/finalize', {
          params: {
            path: { id, statement_id: statementId },
            header: { 'Idempotency-Key': idempotencyKey() },
          },
        })
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: [...monetizationKeys.tenant(id), 'usage-statements'] }),
  });
}

export function useTenantStatementHandoff(id: string, statementId: string, enabled: boolean) {
  return useQuery({
    queryKey: monetizationKeys.tenantHandoff(id, statementId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/account/platform-tenants/{id}/usage-statements/{statement_id}/handoff', {
          params: { path: { id, statement_id: statementId } },
          signal,
        })
      ),
    enabled: enabled && Boolean(id && statementId),
    retry: retryPolicy,
  });
}

export function useTenantCredentials(id: string) {
  return useQuery({
    queryKey: monetizationKeys.credentials(id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/account/platform-tenants/{id}/credentials', {
          params: { path: { id }, query: { limit: 100 } },
          signal,
        })
      ).then((r) => r.keys),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}
