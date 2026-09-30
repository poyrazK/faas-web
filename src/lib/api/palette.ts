import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError } from './errors';
import type { components } from './schema';

const PAGE_SIZE = 100;
export const RESOURCE_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
export function resourceId(value: unknown): string | undefined {
  return typeof value === 'string' && RESOURCE_ID.test(value) ? value : undefined;
}

type Deployment = components['schemas']['DeploymentResponse'];
type Invocation = components['schemas']['Invocation'];
const deploymentMetadata = (row: Deployment) => ({
  id: row.id,
  appId: row.app_id,
  status: row.status,
  digest: row.image_digest,
});
const invocationMetadata = (row: Invocation) => ({
  id: row.id,
  appId: row.app_id,
  status: row.state,
});

/** Collections are session-scoped and cache only searchable, non-secret metadata. */
export function usePaletteResources(accountId: string | undefined, open: boolean, query: string) {
  const [settledQuery, setSettledQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const enabled = Boolean(accountId && open && query.trim());
  const base = ['palette', accountId];
  const exactId = resourceId(settledQuery);
  // A previous ID must not remain visible while a new query is settling.
  const exactEnabled = enabled && settledQuery === query.trim() && Boolean(exactId);

  const apps = useQuery({
    queryKey: [...base, 'apps'],
    enabled,
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/apps', { signal }))).map((row) => ({
        id: row.id,
        slug: row.slug,
      })),
  });
  const deployments = useInfiniteQuery({
    queryKey: [...base, 'deployments'],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await unwrap(
        api.GET('/v1/deployments', {
          signal,
          params: { query: { limit: PAGE_SIZE, before: pageParam } },
        })
      );
      return { items: page.items.map(deploymentMetadata), next: page.next_before };
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const domains = useQuery({
    queryKey: [...base, 'domains'],
    enabled,
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/domains', { signal }))).map((row) => ({
        hostname: row.domain,
        appId: row.app_id,
        verified: row.verified,
      })),
  });
  const keys = useQuery({
    queryKey: [...base, 'keys'],
    enabled,
    queryFn: async ({ signal }) =>
      (await unwrap(api.GET('/v1/keys', { signal }))).map((row) => ({
        id: row.id,
        label: row.label || row.id,
        scopes: row.scopes,
      })),
  });
  const invocations = useInfiniteQuery({
    queryKey: [...base, 'invocations'],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await unwrap(
        api.GET('/v1/invocations', {
          signal,
          params: { query: { limit: PAGE_SIZE, before: pageParam } },
        })
      );
      return {
        items: page.invocations.map(invocationMetadata),
        next: page.invocations.length === PAGE_SIZE ? page.invocations.at(-1)?.id : undefined,
      };
    },
    getNextPageParam: (page) => page.next,
  });
  const retry = (count: number, error: Error) =>
    !(error instanceof ApiError && error.status < 500) && count < 1;
  const exactDeployment = useQuery({
    queryKey: [...base, 'deployment', exactId],
    enabled: exactEnabled,
    retry,
    queryFn: async ({ signal }) =>
      deploymentMetadata(
        await unwrap(
          api.GET('/v1/deployments/{id}', { signal, params: { path: { id: exactId! } } })
        )
      ),
  });
  const exactInvocation = useQuery({
    queryKey: [...base, 'invocation', exactId],
    enabled: exactEnabled,
    retry,
    queryFn: async ({ signal }) =>
      invocationMetadata(
        await unwrap(
          api.GET('/v1/invocations/{id}', { signal, params: { path: { id: exactId! } } })
        )
      ),
  });
  const byId = <T extends { id: string }>(rows: T[]) => [
    ...new Map(rows.map((row) => [row.id, row])).values(),
  ];
  const accessible = <T>(data: T | undefined, error: unknown, fallback: T): T =>
    enabled && !error ? (data ?? fallback) : fallback;
  const collections = [apps, deployments, domains, keys, invocations];
  const lookups = exactEnabled ? [exactDeployment, exactInvocation] : [];
  const failures = [
    ...collections.filter((item) => item.error),
    ...lookups.filter(
      (item) => item.error && !(item.error instanceof ApiError && item.error.isNotFound)
    ),
  ];
  const names = new Map(accessible(apps.data, apps.error, []).map((app) => [app.id, app.slug]));

  return {
    enabled,
    appName: (id: string) => names.get(id) ?? id,
    deployments: byId([
      ...accessible(
        deployments.data?.pages.flatMap((page) => page.items),
        deployments.error,
        []
      ),
      ...(exactEnabled && exactDeployment.data && !exactDeployment.error
        ? [exactDeployment.data]
        : []),
    ]),
    domains: accessible(domains.data, domains.error, []),
    keys: accessible(keys.data, keys.error, []),
    invocations: byId([
      ...accessible(
        invocations.data?.pages.flatMap((page) => page.items),
        invocations.error,
        []
      ),
      ...(exactEnabled && exactInvocation.data && !exactInvocation.error
        ? [exactInvocation.data]
        : []),
    ]),
    loading: enabled && [...collections, ...lookups].some((item) => item.isFetching),
    errors: enabled ? failures.map((item) => item.error!) : [],
    retry: () => {
      for (const item of failures) void item.refetch();
    },
    moreDeployments: enabled && Boolean(deployments.hasNextPage),
    moreInvocations: enabled && Boolean(invocations.hasNextPage),
    loadDeployments: () => {
      if (!deployments.isFetching) void deployments.fetchNextPage();
    },
    loadInvocations: () => {
      if (!invocations.isFetching) void invocations.fetchNextPage();
    },
  };
}
