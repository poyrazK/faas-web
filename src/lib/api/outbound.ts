import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * Managed outbound integrations: the fixed HTTPS destinations apps call
 * through the gateway, with a sealed provider credential, a daily budget, and
 * an admission policy. The AI gateway rides on the same integrations.
 *
 * Kept apart from `events.ts` because it is a different API tag with its own
 * lifecycle; both are account-scoped and keyed by account id.
 *
 * **Credentials are write-only.** The API never returns one, and the console
 * never keeps one: `putOutboundCredentialOnce` is a direct call rather than a
 * TanStack mutation, because a mutation retains its variables in the cache.
 */

type S = components['schemas'];
export type OutboundIntegration = S['OutboundIntegrationOffer'];
export type OutboundRequestPolicy = S['OutboundRequestPolicy'];
export type OutboundUsage = S['OutboundIntegrationUsageResponse'];
export type OutboundProbePolicy = S['OutboundBindingProbePolicy'];
export type CreateOutboundIntegration = S['CreateOutboundIntegrationRequest'];
export type OutboundAIUsage = S['OutboundAIUsageResponse'];
export type OutboundAIUsageItem = S['OutboundAIUsageItem'];
export type OutboundAIAlert = S['OutboundAIBudgetAlert'];
export type OutboundAIRoute = S['OutboundAIRoute'];
export type AIProvider = NonNullable<OutboundIntegration['ai_provider']>;

export const AI_PROVIDERS: readonly AIProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'azure_openai',
  'bedrock',
  'vertex',
];
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const outboundKey = (accountId: string) => ['account', accountId, 'outbound'] as const;
const listKey = (accountId: string) => [...outboundKey(accountId), 'integrations'] as const;
const usageKey = (accountId: string, id: string) =>
  [...outboundKey(accountId), 'usage', id] as const;
const probeKey = (accountId: string, id: string) =>
  [...outboundKey(accountId), 'probe', id] as const;

export function useOutboundIntegrations(accountId: string) {
  return useQuery({
    queryKey: listKey(accountId),
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/outbound/integrations', { signal }))).items,
    enabled: Boolean(accountId),
    retry: retryPolicy,
  });
}

function fetchUsage(id: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/outbound/integrations/{integration}/usage', {
      params: { path: { integration: id } },
      signal,
    })
  );
}

export function useOutboundUsage(accountId: string, id: string) {
  return useQuery({
    queryKey: usageKey(accountId, id),
    queryFn: ({ signal }) => fetchUsage(id, signal),
    enabled: Boolean(accountId && id),
    retry: retryPolicy,
    staleTime: 15_000,
  });
}

/** Today's usage for every listed integration; the list has no usage of its own. */
export function useOutboundUsages(accountId: string, ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: usageKey(accountId, id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchUsage(id, signal),
      enabled: Boolean(accountId),
      retry: retryPolicy,
      staleTime: 15_000,
    })),
  });
}

function useInvalidateOutbound(accountId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: outboundKey(accountId) });
}

export function useCreateOutboundIntegration(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: (body: CreateOutboundIntegration) =>
      unwrap(api.POST('/v1/outbound/integrations', { body })),
    onSettled: invalidate,
  });
}

export function useDeleteOutboundIntegration(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/outbound/integrations/{integration}', {
          params: { path: { integration: id } },
        })
      ),
    onSettled: invalidate,
  });
}

/**
 * Sets or rotates the provider Authorization value. Direct call by design:
 * nothing about the value outlives this promise, and the 204 carries no body.
 * Callers invalidate `outboundKey` afterwards so `credential_configured` updates.
 */
export function putOutboundCredentialOnce(id: string, authorization: string) {
  return unwrap(
    api.PUT('/v1/outbound/integrations/{integration}/credential', {
      params: { path: { integration: id } },
      body: { authorization },
    })
  );
}

export function useRevokeOutboundCredential(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/outbound/integrations/{integration}/credential', {
          params: { path: { integration: id } },
        })
      ),
    onSettled: invalidate,
  });
}

export function useSetOutboundBudget(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: ({ id, limit }: { id: string; limit: number | null }) =>
      unwrap(
        api.PUT('/v1/outbound/integrations/{integration}/budget', {
          params: { path: { integration: id } },
          body: { daily_request_limit: limit },
        })
      ),
    onSettled: invalidate,
  });
}

export function useSetOutboundRequestPolicy(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: ({ id, policy }: { id: string; policy: OutboundRequestPolicy }) =>
      unwrap(
        api.PUT('/v1/outbound/integrations/{integration}/request-policy', {
          params: { path: { integration: id } },
          body: { request_policy: policy },
        })
      ),
    onSettled: invalidate,
  });
}

/** The configured probe, or `null` when none is configured (`not_found`). */
export function useOutboundProbePolicy(accountId: string, id: string, enabled = true) {
  return useQuery({
    queryKey: probeKey(accountId, id),
    queryFn: async ({ signal }): Promise<OutboundProbePolicy | null> => {
      try {
        return await unwrap(
          api.GET('/v1/outbound/integrations/{integration}/probe-policy', {
            params: { path: { integration: id } },
            signal,
          })
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === 'not_found') return null;
        throw error;
      }
    },
    enabled: Boolean(accountId && id && enabled),
    retry: retryPolicy,
  });
}

export function useSetOutboundProbePolicy(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: ({ id, policy }: { id: string; policy: OutboundProbePolicy }) =>
      unwrap(
        api.PUT('/v1/outbound/integrations/{integration}/probe-policy', {
          params: { path: { integration: id } },
          body: policy,
        })
      ),
    onSettled: invalidate,
  });
}

export function useDeleteOutboundProbePolicy(accountId: string) {
  const invalidate = useInvalidateOutbound(accountId);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/outbound/integrations/{integration}/probe-policy', {
          params: { path: { integration: id } },
        })
      ),
    onSettled: invalidate,
  });
}

/* --- AI gateway (capability `ai-gateway`) ------------------------------- */

/** One UTC day of token usage by caller and model. `date` is YYYY-MM-DD; empty means today. */
export function useOutboundAIUsage(accountId: string, id: string, date: string, enabled = true) {
  return useQuery({
    queryKey: [...outboundKey(accountId), 'ai-usage', id, date],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/outbound/integrations/{integration}/ai-usage', {
          params: { path: { integration: id }, query: date ? { date } : {} },
          signal,
        })
      ),
    enabled: Boolean(accountId && id && enabled),
    retry: retryPolicy,
  });
}

export function useOutboundAIAlerts(accountId: string, id: string, enabled = true) {
  return useQuery({
    queryKey: [...outboundKey(accountId), 'ai-alerts', id],
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/outbound/integrations/{integration}/ai-alerts', {
            params: { path: { integration: id }, query: { limit: 50 } },
            signal,
          })
        )
      ).items,
    enabled: Boolean(accountId && id && enabled),
    retry: retryPolicy,
  });
}

export function useOutboundAIRoutes(accountId: string, enabled = true) {
  return useQuery({
    queryKey: [...outboundKey(accountId), 'ai-routes'],
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/outbound/ai-routes', { signal }))).items,
    enabled: Boolean(accountId && enabled),
    retry: retryPolicy,
  });
}
