import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';
import { projectKeys, validEnvironment } from './projects';

/**
 * Managing a project's environments (faas handlers_projects.go:331-640,
 * handlers_project_environment_config.go, ADR-1139 shared secrets,
 * handlers_project_environment_promotion.go).
 *
 * A company project is addressed under `/v1/orgs/{organization}/projects…`
 * (org_project_routes.go). That family has create, protection, delete and
 * configuration, but the spec this console is built from has no shared
 * secrets, approvals or promote under it, so those stay personal here.
 */

export type EnvironmentConfig = components['schemas']['ProjectEnvironmentConfigResponse'];
export type SharedSecrets = components['schemas']['ProjectEnvironmentSharedSecretsResponse'];
export type SharedSecret = components['schemas']['ProjectEnvironmentSharedSecret'];
export type CreateEnvironment = components['schemas']['CreateProjectEnvironmentRequest'];
export type PromotionResult = components['schemas']['ProjectEnvironmentPromotionResponse'];

/** The identity of the project an environment belongs to: whose route family to call. */
export interface ProjectScope {
  accountId: string;
  slug: string;
  /** The company organization in a company workspace; null for the personal account. */
  org: string | null;
}

const scopeKey = (scope: ProjectScope) => [
  ...projectKeys.detail(scope.accountId, scope.slug),
  'environments',
  ...(scope.org ? ['org', scope.org] : []),
];
const idempotencyKey = () => crypto.randomUUID();
/**
 * Every environment write changes what the environment reads, so the whole
 * project's environment cache goes stale, personal and company alike.
 */
const invalidate = (qc: ReturnType<typeof useQueryClient>, scope: ProjectScope) =>
  qc.invalidateQueries({ queryKey: projectKeys.detail(scope.accountId, scope.slug) });

export function useCreateEnvironment(scope: ProjectScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key = idempotencyKey() }: { body: CreateEnvironment; key?: string }) => {
      const headers = { 'Idempotency-Key': key };
      return scope.org
        ? unwrap(
            api.POST('/v1/orgs/{organization}/projects/{slug}/environments', {
              params: { path: { organization: scope.org, slug: scope.slug } },
              body,
              headers,
            })
          )
        : unwrap(
            api.POST('/v1/projects/{slug}/environments', {
              params: { path: { slug: scope.slug } },
              body,
              headers,
            })
          );
    },
    onSettled: () => invalidate(qc, scope),
  });
}

export function useProtectEnvironment(scope: ProjectScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ environment, protect }: { environment: string; protect: boolean }) =>
      scope.org
        ? unwrap(
            api.PATCH('/v1/orgs/{organization}/projects/{slug}/environments/{environment}', {
              params: { path: { organization: scope.org, slug: scope.slug, environment } },
              body: { protected: protect },
            })
          )
        : unwrap(
            api.PATCH('/v1/projects/{slug}/environments/{environment}', {
              params: { path: { slug: scope.slug, environment } },
              body: { protected: protect },
            })
          ),
    onSettled: () => invalidate(qc, scope),
  });
}

export function useDeleteEnvironment(scope: ProjectScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      environment,
      key = idempotencyKey(),
    }: {
      environment: string;
      key?: string;
    }) => {
      const header = { 'Idempotency-Key': key };
      const result = scope.org
        ? await api.DELETE('/v1/orgs/{organization}/projects/{slug}/environments/{environment}', {
            params: { path: { organization: scope.org, slug: scope.slug, environment }, header },
          })
        : await api.DELETE('/v1/projects/{slug}/environments/{environment}', {
            params: { path: { slug: scope.slug, environment }, header },
          });
      await unwrap(Promise.resolve(result));
      // 202: deleted, with managed-resource cleanup queued for retry.
      return { cleanupPending: result.response.status === 202 };
    },
    onSettled: () => invalidate(qc, scope),
  });
}

export function useEnvironmentConfig(scope: ProjectScope, environment: string) {
  return useQuery({
    queryKey: [...scopeKey(scope), environment, 'config'],
    queryFn: ({ signal }) =>
      scope.org
        ? unwrap(
            api.GET('/v1/orgs/{organization}/projects/{slug}/environments/{environment}/config', {
              params: { path: { organization: scope.org, slug: scope.slug, environment } },
              signal,
            })
          )
        : unwrap(
            api.GET('/v1/projects/{slug}/environments/{environment}/config', {
              params: { path: { slug: scope.slug, environment } },
              signal,
            })
          ),
    enabled: Boolean(scope.accountId && scope.slug && validEnvironment(environment)),
    retry: retryPolicy,
    staleTime: 15_000,
  });
}

/** `config set` replaces the whole document (faas docs/env.md "Shared project configuration"). */
export function useUpdateEnvironmentConfig(scope: ProjectScope, environment: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      scope.org
        ? unwrap(
            api.PUT('/v1/orgs/{organization}/projects/{slug}/environments/{environment}/config', {
              params: { path: { organization: scope.org, slug: scope.slug, environment } },
              body: { values },
              headers: { 'Idempotency-Key': idempotencyKey() },
            })
          )
        : unwrap(
            api.PUT('/v1/projects/{slug}/environments/{environment}/config', {
              params: { path: { slug: scope.slug, environment } },
              body: { values },
              headers: { 'Idempotency-Key': idempotencyKey() },
            })
          ),
    onSettled: () => invalidate(qc, scope),
  });
}

export function useEnvironmentSecrets(scope: ProjectScope, environment: string) {
  return useQuery({
    queryKey: [...scopeKey(scope), environment, 'secrets'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/projects/{slug}/environments/{environment}/secrets', {
          params: { path: { slug: scope.slug, environment } },
          signal,
        })
      ),
    enabled: Boolean(!scope.org && scope.accountId && scope.slug && validEnvironment(environment)),
    retry: retryPolicy,
    staleTime: 15_000,
  });
}

/**
 * Values go straight to the API and nowhere else: the mutation variables are
 * not kept once it settles (`gcTime: 0`), and the response is metadata only.
 */
export function useWriteEnvironmentSecret(scope: ProjectScope, environment: string) {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ key, value, rotate }: { key: string; value: string; rotate: boolean }) =>
      rotate
        ? unwrap(
            api.POST('/v1/projects/{slug}/environments/{environment}/secrets/{key}/rotate', {
              params: { path: { slug: scope.slug, environment, key } },
              body: { value },
            })
          )
        : unwrap(
            api.PUT('/v1/projects/{slug}/environments/{environment}/secrets/{key}', {
              params: { path: { slug: scope.slug, environment, key } },
              body: { value },
            })
          ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: [...scopeKey(scope), environment, 'secrets'] }),
  });
}

export function useDeleteEnvironmentSecret(scope: ProjectScope, environment: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      unwrap(
        api.DELETE('/v1/projects/{slug}/environments/{environment}/secrets/{key}', {
          params: { path: { slug: scope.slug, environment, key } },
        })
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: [...scopeKey(scope), environment, 'secrets'] }),
  });
}

/**
 * Promote the exact preview the person reviewed. A protected target needs an
 * approval of that same promotion token first (handlers_project_environment_
 * approvals.go:21); the short-lived approval credential is used once, here,
 * and never stored in a cache. A retry with the same Idempotency-Key resumes
 * the same operation rather than starting another (promotion.go:636-700).
 */
export function usePromoteEnvironment(scope: ProjectScope, target: string) {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({
      source,
      promotionToken,
      approve,
      key,
    }: {
      source: string;
      promotionToken: string;
      approve: boolean;
      key: string;
    }) => {
      const approval = approve
        ? await unwrap(
            api.POST('/v1/projects/{slug}/environments/{environment}/approvals', {
              params: { path: { slug: scope.slug, environment: target } },
              body: { promotion_token: promotionToken },
            })
          )
        : undefined;
      return unwrap(
        api.POST('/v1/projects/{slug}/environments/{environment}/promote', {
          params: {
            path: { slug: scope.slug, environment: target },
            header: { 'Idempotency-Key': key },
          },
          body: {
            from_environment: source,
            promotion_token: promotionToken,
            ...(approval ? { approval_token: approval.approval_token } : {}),
          },
        })
      );
    },
    onSettled: () =>
      qc
        .invalidateQueries({ queryKey: ['account', scope.accountId, 'project'] })
        .then(() => invalidate(qc, scope)),
  });
}

/**
 * Restore each workload to the deployment it had before the promotion; the
 * API refuses to overwrite a target changed since (promotion.go:873).
 */
export function useRollbackPromotion(scope: ProjectScope, target: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ promotion, key = idempotencyKey() }: { promotion: string; key?: string }) =>
      unwrap(
        api.POST('/v1/projects/{slug}/environments/{environment}/promotions/{promotion}/rollback', {
          params: {
            path: { slug: scope.slug, environment: target, promotion },
            header: { 'Idempotency-Key': key },
          },
        })
      ),
    onSettled: () =>
      qc
        .invalidateQueries({ queryKey: ['account', scope.accountId, 'project'] })
        .then(() => invalidate(qc, scope)),
  });
}
