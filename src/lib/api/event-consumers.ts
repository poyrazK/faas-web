import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components, paths } from './schema';
import { retryPolicy } from './queries';

/**
 * One app's side of the event router: the subscriptions its deployment
 * declared (`event_triggers` in gregale.yaml), the live delivery controls an
 * operator holds over each, the invocations those subscriptions produced, and
 * each delivery's acknowledgment lease.
 *
 * Subscriptions are read-only here because they are in the API: a deploy
 * creates, changes and disables them (faas docs/events.md § Subscription
 * limits and removal). Pause and resume are separate operator controls that
 * survive deploys. Acknowledgment writes carry the consumer's secret delivery
 * token, which the console never has, so it reads the lease and leaves the
 * callback to the handler.
 */

type S = components['schemas'];
export type EventSubscription = S['EventSubscriptionResponse'];
export type DeliveryControl = S['EventSubscriptionDeliveryControl'];
export type EventDelivery = S['EventDeliveryResponse'];
/** The states the list can filter by; a row can also read cancelled, superseded or expired. */
export type EventDeliveryFilter = NonNullable<
  NonNullable<paths['/v1/apps/{slug}/event-deliveries']['get']['parameters']['query']>['state']
>;
export type EventFanoutFailure = S['EventFanoutFailureResponse'];
export type AcknowledgmentStatus = S['EventAcknowledgmentStatus'];

/** Pacing apid applies when a resume names no rate (EventSubscriptionResumeRequest default). */
export const DEFAULT_RESUME_RATE = 10;
export const MAX_RESUME_RATE = 100;
export const DELIVERY_PAGE = 50;

const consumersKey = (slug: string) => ['apps', slug, 'event-consumers'] as const;
const controlKey = (slug: string, id: string) => [...consumersKey(slug), 'control', id] as const;

export function useEventSubscriptions(slug: string) {
  return useQuery({
    queryKey: [...consumersKey(slug), 'subscriptions'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/event-subscriptions', { params: { path: { slug } }, signal })
      ),
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}

/** Pause state, pacing and backlog for one subscription; no-store on the server. */
export function useDeliveryControl(slug: string, subscriptionId: string) {
  return useQuery({
    queryKey: controlKey(slug, subscriptionId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control', {
          params: { path: { slug, subscriptionID: subscriptionId } },
          signal,
        })
      ),
    enabled: Boolean(slug && subscriptionId),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}

export function usePauseSubscription(slug: string, subscriptionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control/pause', {
          params: { path: { slug, subscriptionID: subscriptionId } },
        })
      ),
    onSuccess: (control) => qc.setQueryData(controlKey(slug, subscriptionId), control),
    onSettled: () => qc.invalidateQueries({ queryKey: controlKey(slug, subscriptionId) }),
  });
}

/** `rate` 0 removes pacing; omitted, apid paces at ten admissions a second. */
export function useResumeSubscription(slug: string, subscriptionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rate: number) =>
      unwrap(
        api.POST('/v1/apps/{slug}/event-subscriptions/{subscriptionID}/delivery-control/resume', {
          params: { path: { slug, subscriptionID: subscriptionId } },
          body: { rate_per_second: rate },
        })
      ),
    onSuccess: (control) => qc.setQueryData(controlKey(slug, subscriptionId), control),
    onSettled: () => qc.invalidateQueries({ queryKey: controlKey(slug, subscriptionId) }),
  });
}

/** Event invocations newest first; `state` narrows server-side, before paging. */
export function useEventDeliveries(slug: string, state: EventDeliveryFilter | '') {
  return useInfiniteQuery({
    queryKey: [...consumersKey(slug), 'deliveries', state],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/event-deliveries', {
          params: {
            path: { slug },
            query: {
              limit: DELIVERY_PAGE,
              ...(state ? { state } : {}),
              ...(pageParam ? { before: pageParam } : {}),
            },
          },
          signal,
        })
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_before || undefined,
    enabled: Boolean(slug),
    retry: retryPolicy,
    staleTime: 10_000,
  });
}

/** The delivery's processing lease, without its token. */
export function useAcknowledgment(slug: string, invocationId: string) {
  return useQuery({
    queryKey: [...consumersKey(slug), 'acknowledgment', invocationId],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/event-deliveries/{invocationID}/acknowledgment', {
          params: { path: { slug, invocationID: invocationId } },
          signal,
        })
      ),
    enabled: Boolean(slug && invocationId),
    retry: retryPolicy,
    staleTime: 5_000,
  });
}
