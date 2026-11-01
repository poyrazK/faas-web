import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';
import { useAuth } from '../auth';

export type NotificationChannel = components['schemas']['NotificationChannelResponse'];
export type CreateNotificationChannel = components['schemas']['CreateNotificationChannelRequest'];
export type AlertRule = components['schemas']['AlertRuleResponse'];

/**
 * Account-level alert destinations (faas ADR-749). They belong to the
 * signed-in account whatever the workspace, so callers pass `enabled: false`
 * in a company workspace rather than show personal data there. Keyed under
 * `['account', id]`, which sign-out clears, so the next account in the tab
 * never sees this one's channels.
 */
export const notificationChannelsKey = (accountId: string) =>
  ['account', accountId, 'notification-channels'] as const;

function useChannelsKey() {
  const { account } = useAuth();
  return { accountId: account?.id ?? '', key: notificationChannelsKey(account?.id ?? '') };
}

export function useNotificationChannels(enabled: boolean) {
  const { accountId, key } = useChannelsKey();
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => unwrap(api.GET('/v1/notification-channels', { signal })),
    enabled: enabled && Boolean(accountId),
    retry: retryPolicy,
  });
}

export function useCreateNotificationChannel() {
  const qc = useQueryClient();
  const { key } = useChannelsKey();
  return useMutation({
    mutationFn: (body: CreateNotificationChannel) =>
      unwrap(api.POST('/v1/notification-channels', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** Deleting a channel unbinds it from every rule, so rule lists refresh too. */
export function useDeleteNotificationChannel() {
  const qc = useQueryClient();
  const { key } = useChannelsKey();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/notification-channels/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'apps' && q.queryKey[2] === 'alerts',
      });
    },
  });
}

/** A marked test message; its outcome is recorded on the channel like a delivery. */
export function useTestNotificationChannel() {
  const qc = useQueryClient();
  const { key } = useChannelsKey();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/notification-channels/{id}/test', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** One rule, keyed under the app's rule list so its mutations refresh it. */
export function useAlertRule(slug: string, id: string) {
  return useQuery({
    queryKey: ['apps', slug, 'alerts', id],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/alerts/{id}', { params: { path: { slug, id } }, signal })),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
  });
}

/** The app's SLOs, for an SLO alert's `slo_id`. */
export function useAppSLOs(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['apps', slug, 'slos'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/slos', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

/** The app's synthetic checks, for a check alert's `synthetic_check_id`. */
export function useAppSyntheticChecks(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['apps', slug, 'synthetics'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/synthetics', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}
