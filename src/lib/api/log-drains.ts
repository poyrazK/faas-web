import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type LogDrain = components['schemas']['AppLogDrainResponse'];
export type LogDrainKind = components['schemas']['CreateAppLogDrainRequest']['kind'];
export type LogDrainWindow = '1h' | '24h' | '7d' | '30d';
export type CreateLogDrain = components['schemas']['CreateAppLogDrainRequest'];
export type UpdateLogDrain = components['schemas']['UpdateAppLogDrainRequest'];

const key = (slug: string) => ['apps', slug, 'log-drains'] as const;

export function useLogDrains(slug: string) {
  return useQuery({
    queryKey: key(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/log-drains', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

export function useCreateLogDrain(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLogDrain) =>
      unwrap(api.POST('/v1/apps/{slug}/log-drains', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function useUpdateLogDrain(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLogDrain }) =>
      unwrap(
        api.PATCH('/v1/apps/{slug}/log-drains/{id}', { params: { path: { slug, id } }, body })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function useDeleteLogDrain(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/log-drains/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

/** Durable delivery counters and the queue, refreshed while open. */
export function useLogDrainHealth(slug: string, id: string) {
  return useQuery({
    queryKey: [...key(slug), id, 'health'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/log-drains/{id}/health', {
          params: { path: { slug, id } },
          signal,
        })
      ),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
    refetchInterval: 30_000,
  });
}

/** Bucketed delivery history — a real series, so it may be charted. */
export function useLogDrainAnalytics(slug: string, id: string, window: LogDrainWindow) {
  return useQuery({
    queryKey: [...key(slug), id, 'analytics', window],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/log-drains/{id}/analytics', {
          params: { path: { slug, id }, query: { window } },
          signal,
        })
      ),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
  });
}
