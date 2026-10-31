import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type PrewarmIntent = components['schemas']['PrewarmIntentResponse'];

const key = (slug: string) => ['apps', slug, 'prewarms'] as const;

export function usePrewarms(slug: string) {
  return useQuery({
    queryKey: key(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/prewarms', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    refetchInterval: 30_000,
  });
}

export function useSchedulePrewarm(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['PrewarmRequest']) =>
      unwrap(api.POST('/v1/apps/{slug}/prewarm', { params: { path: { slug } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function useCancelPrewarm(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/apps/{slug}/prewarms/{id}', { params: { path: { slug, id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(slug) }),
  });
}
