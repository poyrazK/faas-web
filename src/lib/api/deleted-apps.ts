import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type DeletedApp = components['schemas']['DeletedAppSummary'];
export type DeletedAppsPage = components['schemas']['DeletedAppListResponse'];

export const deletedAppsKey = (accountId: string, cursor = '') =>
  ['account', accountId, 'deleted-apps', cursor] as const;

export class RestoreReviewError extends Error {}

export async function verifyRestoreAccount(accountId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const account = await unwrap(api.GET('/v1/account', { signal }));
  signal?.throwIfAborted();
  if (!accountId || account.id !== accountId)
    throw new RestoreReviewError('The account changed. Read this account’s inventory again.');
}

function metadata(row: DeletedApp, accountId: string): DeletedApp {
  if (!row || row.account_id !== accountId)
    throw new RestoreReviewError('The returned account context changed. Read the inventory again.');
  if (
    typeof row.id !== 'string' ||
    typeof row.slug !== 'string' ||
    typeof row.restore_eligible !== 'boolean' ||
    typeof row.restore_blocker !== 'string' ||
    !Number.isFinite(Date.parse(row.evaluated_at)) ||
    (row.deleted_at !== null && !Number.isFinite(Date.parse(row.deleted_at))) ||
    (row.delete_grace_until !== null && !Number.isFinite(Date.parse(row.delete_grace_until)))
  )
    throw new RestoreReviewError('Deleted-app lifecycle metadata is unavailable.');
  // Project before returning to Query or a review. Unexpected credentials or
  // other fields must not reach cache, persisted recovery identity, or the UI.
  return {
    account_id: row.account_id,
    id: row.id,
    slug: row.slug,
    deleted_at: row.deleted_at,
    delete_grace_until: row.delete_grace_until,
    restore_eligible: row.restore_eligible,
    restore_blocker: row.restore_blocker,
    evaluated_at: row.evaluated_at,
  };
}

export async function readDeletedApps(
  accountId: string,
  cursor = '',
  signal?: AbortSignal
): Promise<DeletedAppsPage> {
  await verifyRestoreAccount(accountId, signal);
  const page = await unwrap(
    api.GET('/v1/deleted-apps', {
      params: { query: { limit: 25, ...(cursor ? { cursor } : {}) } },
      signal,
    })
  );
  signal?.throwIfAborted();
  if (!page || page.account_id !== accountId)
    throw new RestoreReviewError('The returned account context changed. Read the inventory again.');
  if (
    !Array.isArray(page.apps) ||
    page.apps.length > 25 ||
    !Number.isFinite(Date.parse(page.evaluated_at)) ||
    (page.next_cursor !== undefined &&
      (typeof page.next_cursor !== 'string' || page.next_cursor.length > 1024))
  )
    throw new RestoreReviewError('The deleted-app inventory response is unavailable.');
  return {
    account_id: page.account_id,
    apps: page.apps.map((row) => metadata(row, accountId)),
    evaluated_at: page.evaluated_at,
    ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),
  };
}

export async function readDeletedApp(
  accountId: string,
  id: string,
  signal?: AbortSignal
): Promise<DeletedApp> {
  await verifyRestoreAccount(accountId, signal);
  const row = metadata(
    await unwrap(api.GET('/v1/deleted-apps/{id}', { params: { path: { id } }, signal })),
    accountId
  );
  signal?.throwIfAborted();
  if (row.id !== id)
    throw new RestoreReviewError('The retained app identity changed. Review again.');
  return row;
}

export function useDeletedApps(accountId: string, cursor = '') {
  return useQuery({
    queryKey: deletedAppsKey(accountId, cursor),
    queryFn: ({ signal }) => readDeletedApps(accountId, cursor, signal),
    enabled: Boolean(accountId),
    retry: false,
    staleTime: 0,
  });
}
