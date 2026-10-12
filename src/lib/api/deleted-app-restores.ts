import { api, unwrap } from './client';
import { ApiError } from './errors';
import { readDeletedApp, RestoreReviewError } from './deleted-apps';
import {
  beginRestoreAttempt,
  clearRestoreAttempt,
  updateRestoreAttempt,
  type RestoreIdentity,
} from '../restore-attempt';

export type RestoreIntent = RestoreIdentity & {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};
export type RestoreAcknowledgment = { id: string; slug: string; status: string };

export function restoreAcknowledgment(raw: RestoreAcknowledgment): RestoreAcknowledgment {
  return { id: raw.id, slug: raw.slug, status: raw.status };
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
