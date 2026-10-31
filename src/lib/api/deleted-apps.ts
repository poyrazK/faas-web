import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { ApiError, errorMessage } from './errors';
import { keys } from './queries';
import type { components } from './schema';

/**
 * Recently deleted apps (faas `pkg/apid/apprecovery/handlers.go`).
 *
 * A deleted app is a tombstone the account can bring back, by exact ID, until
 * its `delete_grace_until`. The inventory is the signed-in account's own and
 * ignores the active workspace, like `/v1/apps`.
 */
export type DeletedApp = components['schemas']['DeletedAppSummary'];

/**
 * The restore window, in days. apid does not report it, so this mirrors
 * `AppDeleteGraceDays` (faas `pkg/api/limits.go:2416`) for the copy that has no
 * row to read it from. Each row's own `delete_grace_until` stays authoritative.
 */
export const APP_DELETE_GRACE_DAYS = 7;

/** Under `account`, so the delete mutation's account invalidation refreshes it too. */
export const deletedAppsKey = ['account', 'deleted-apps'] as const;

const PAGE = 25;

export function useDeletedApps(accountId: string) {
  return useInfiniteQuery({
    queryKey: [...deletedAppsKey, accountId],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/v1/deleted-apps', {
          params: { query: { limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) } },
          signal,
        })
      ),
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: Boolean(accountId),
  });
}

/**
 * Restore one tombstone by its exact ID. Never retried: the route keeps no
 * replay receipt, so after any failure the inventory is read again instead
 * (docs/apps.md#retained-deleted-apps). Only `id`, `slug` and `status` are
 * kept from the response.
 */
export function useRestoreDeletedApp() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: deletedAppsKey });
    void qc.invalidateQueries({ queryKey: keys.apps });
  };
  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const app = await unwrap(
        api.POST('/v1/deleted-apps/{id}/restore', { params: { path: { id } } })
      );
      return { id: app.id, slug: app.slug, status: app.status };
    },
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: refresh,
  });
}

/**
 * What a failed restore means for the person who asked, by `code`. The codes
 * are every one the route and its middleware answer with: the handler, the
 * quota and traffic-policy mappers it calls, and appaccess for a shared
 * workspace's app.
 */
export function restoreErrorMessage(error: unknown, slug: string): string {
  if (!(error instanceof ApiError) || error.isUnreachable)
    return `${errorMessage(error)} The restore may have gone through; check the list before trying again.`;
  switch (error.code) {
    case 'not_found':
      return `${slug} is no longer in your recently deleted apps. It may have been restored already or removed for good; check your apps list.`;
    case 'app_not_restorable':
      return `${slug} can no longer be restored: its restore window has closed or permanent removal has started.`;
    case 'conflict':
      return `Another app now uses the name ${slug}, or this record changed since the list loaded. Rename or delete that app, then try again from the refreshed list.`;
    case 'plan_limit_apps':
      return 'Your plan’s app limit is reached. Delete an app you no longer use or upgrade your plan, then restore again.';
    case 'plan_limit_developer_apps':
      return 'Your plan’s developer environment limit is reached. Stop an unused environment with `gregale dev --stop`, then restore again.';
    case 'org_role_forbidden':
      return 'Only the app’s creator can restore it, while they are an owner or admin of an active workspace. Ask a workspace owner to check your role.';
    case 'insufficient_scope':
      return 'This sign-in cannot restore apps. If your account or the app’s workspace is inactive or scheduled for deletion, reactivate it first.';
    case 'mfa_required':
      return 'Finish two-factor verification, then restore again.';
    case 'billing_past_due':
      return 'Your account is suspended for an unpaid invoice. Settle it in Billing, then restore again.';
    case 'capacity_unavailable':
      return 'The platform could not confirm the restore. It may have gone through; check the list before trying again.';
    case 'api_rate_limited':
    case 'rate_limited':
      return 'Too many requests. Wait a minute, then try again.';
    case 'traffic_policy_too_large':
    case 'traffic_policy_too_complex':
      return 'Restoring this app would push your traffic policy past platform limits. Remove routing rules you no longer need, then try again.';
    case 'validation_failed':
      return 'The console sent a request the API did not accept. Refresh the page and try again.';
    default:
      return errorMessage(error);
  }
}
