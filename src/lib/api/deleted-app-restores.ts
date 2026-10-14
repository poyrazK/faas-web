import { api, unwrap } from './client';
import { ApiError } from './errors';
import {
  readDeletedApp,
  RestoreReviewError,
  verifyRestoreAccount,
  type DeletedApp,
} from './deleted-apps';
import {
  beginRestoreAttempt,
  clearRestoreAttempt,
  updateRestoreAttempt,
  type RestoreIdentity,
  type RestoreAttempt,
} from '../restore-attempt';

export type RestoreIntent = RestoreIdentity & {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};
export type RestoreAcknowledgment = { id: string; slug: string; status: string };

export function restoreAcknowledgment(raw: RestoreAcknowledgment): RestoreAcknowledgment {
  return { id: raw.id, slug: raw.slug, status: raw.status };
}

export type RestoreInspection =
  | { kind: 'restored'; status: string }
  | { kind: 'retained'; record: DeletedApp }
  | { kind: 'unverified'; reason: string };

export async function inspectRestore(
  attempt: RestoreAttempt,
  signal?: AbortSignal
): Promise<RestoreInspection> {
  let retained: DeletedApp | null = null;
  try {
    retained = await readDeletedApp(attempt.accountId, attempt.appId, signal);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  const result = await api.GET('/v1/apps/{slug}', {
    params: { path: { slug: attempt.slug } },
    signal,
  });
  const current = result.response.status === 404 ? null : await unwrap(Promise.resolve(result));
  await verifyRestoreAccount(attempt.accountId, signal);
  signal?.throwIfAborted();
  if (
    !retained &&
    current?.id === attempt.appId &&
    current.slug === attempt.slug &&
    current.status !== 'deleted'
  )
    return { kind: 'restored', status: current.status };
  if (retained && !current) return { kind: 'retained', record: retained };
  return {
    kind: 'unverified',
    reason:
      current && current.id !== attempt.appId
        ? 'The slug now identifies another app. Inspect this exact retained ID before any new action.'
        : 'The reads do not confirm a restored app. They may be missing or conflicting; refresh both inventories.',
  };
}
function checkContext(intent: RestoreIntent) {
  intent.signal?.throwIfAborted();
  if (intent.isCurrent && !intent.isCurrent())
    throw new RestoreReviewError('The restore context changed. Review again.');
}

export async function restoreReviewedApp(intent: RestoreIntent): Promise<RestoreAcknowledgment> {
  checkContext(intent);
  const row = await readDeletedApp(intent.accountId, intent.appId, intent.signal);
  checkContext(intent);
  if (
    row.slug !== intent.slug ||
    !row.restore_eligible ||
    row.restore_blocker ||
    !row.deleted_at ||
    !row.delete_grace_until ||
    row.deleted_at !== intent.expectedDeletedAt ||
    row.delete_grace_until !== intent.expectedDeadline
  )
    throw new RestoreReviewError(
      'The retained identity, deadline or eligibility changed. Refresh and review again.'
    );
  const attempt = beginRestoreAttempt(intent);
  let sent = false;
  try {
    checkContext(intent);
    sent = true;
    const raw = await unwrap(
      api.POST('/v1/deleted-apps/{id}/restore', {
        params: { path: { id: intent.appId } },
        signal: intent.signal,
      })
    );
    if (raw.id !== intent.appId || raw.slug !== intent.slug || typeof raw.status !== 'string')
      throw new Error(
        'The restore response identity was not confirmed. Inspect before another attempt.'
      );
    updateRestoreAttempt(attempt, 'accepted');
    return restoreAcknowledgment(raw);
  } catch (error) {
    const rejected =
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429;
    if (!sent || rejected) clearRestoreAttempt(attempt);
    else updateRestoreAttempt(attempt, 'uncertain');
    throw error;
  }
}
