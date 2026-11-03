import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

/**
 * Alert notification channels (faas ADR-749): Slack, PagerDuty or email
 * destinations an account adds once and alert rules deliver to by id.
 *
 * The destination of a Slack or PagerDuty channel is a credential: apid seals
 * it on create and only ever returns a non-secret hint in `target`
 * (handlers_notification_channels.go:88-123,166-178). There is no update, so a
 * changed URL or key is a new channel.
 */
export type NotificationChannel = components['schemas']['NotificationChannelResponse'];
export type CreateNotificationChannel = components['schemas']['CreateNotificationChannelRequest'];
export type ChannelTestResult = components['schemas']['TestNotificationChannelResponse'];

export const notificationChannelsKey = ['notification-channels'] as const;

export function useNotificationChannels(enabled = true) {
  return useQuery({
    queryKey: notificationChannelsKey,
    queryFn: ({ signal }) => unwrap(api.GET('/v1/notification-channels', { signal })),
    enabled,
    retry: retryPolicy,
  });
}

/**
 * Creates a channel. A direct call by design, as with the outbound credential
 * (outbound.ts:122): the body carries the Slack URL or PagerDuty key, and a
 * TanStack mutation would keep it as `variables` in the mutation cache after
 * the request settled. Nothing about the value outlives this promise; the
 * caller invalidates the list.
 */
export function createNotificationChannelOnce(body: CreateNotificationChannel) {
  return unwrap(api.POST('/v1/notification-channels', { body }));
}

export function useDeleteNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/notification-channels/{id}', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationChannelsKey }),
  });
}

/**
 * Sends a marked test message. 200 whether or not the destination took it;
 * `delivered` and `error` say which, and apid records the outcome on the
 * channel, so the list is refetched either way.
 */
export function useTestNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/notification-channels/{id}/test', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationChannelsKey }),
  });
}
