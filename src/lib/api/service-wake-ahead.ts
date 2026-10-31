import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type ServiceWakeAhead = components['schemas']['ServiceWakeAheadResponse'];
export type ServiceWakeAheadTarget = components['schemas']['ServiceWakeAheadTarget'];

export const serviceWakeAheadKey = (accountId: string, slug: string) =>
  ['account', accountId, 'app', slug, 'service-wake-ahead'] as const;

/** The effective setting (default included) and what the gateways measured. */
export function useServiceWakeAhead(accountId: string, slug: string) {
  return useQuery({
    queryKey: serviceWakeAheadKey(accountId, slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/service-wake-ahead', { params: { path: { slug } }, signal })),
    enabled: Boolean(accountId && slug),
    retry: retryPolicy,
  });
}

export function useSetServiceWakeAhead(accountId: string, slug: string) {
  const client = useQueryClient();
  const key = serviceWakeAheadKey(accountId, slug);
  return useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(
        api.PUT('/v1/apps/{slug}/service-wake-ahead', {
          params: { path: { slug } },
          body: { enabled },
        })
      ),
    onSuccess: (next) => {
      // The PUT answer has no `learned` block; keep the measurements already
      // on screen rather than blanking them until the refetch lands.
      client.setQueryData<ServiceWakeAhead>(key, (prev) => ({ ...next, learned: prev?.learned }));
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
