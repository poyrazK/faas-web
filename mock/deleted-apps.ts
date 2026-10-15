import type { components } from '../src/lib/api/schema';
export type DeletedRecord = {
  app: { id: string; slug: string };
  accountId: string;
  deletedAt: string | null;
  expiresAt: number | null;
  purgeStarted?: boolean;
};
type Summary = components['schemas']['DeletedAppSummary'];
function summary(record: DeletedRecord, now: number): Summary {
  const blocker = record.purgeStarted
    ? 'purge_started'
    : record.deletedAt === null || record.expiresAt === null
      ? 'metadata_unavailable'
      : record.expiresAt <= now
        ? 'grace_expired'
        : '';
  return {
    account_id: record.accountId,
    id: record.app.id,
    slug: record.app.slug,
    deleted_at: record.deletedAt,
    delete_grace_until: record.expiresAt === null ? null : new Date(record.expiresAt).toISOString(),
    restore_eligible: blocker === '',
    restore_blocker: blocker,
    evaluated_at: new Date(now).toISOString(),
  };
}
export function readDeletedRecord(
  records: DeletedRecord[],
  accountId: string,
  id: string,
  now: number
): Summary | null {
  const row = records.find((record) => record.app.id === id && record.accountId === accountId);
  return row ? summary(row, now) : null;
}
export function listDeletedRecords(
  records: DeletedRecord[],
  accountId: string,
  cursor: string,
  limit: number,
  now: number
): components['schemas']['DeletedAppListResponse'] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be 1..50');
  let before: { accountId: string; at: number; id: string } | null = null;
  if (cursor) {
    try {
      if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      before = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (
        !before ||
        before.accountId !== accountId ||
        !Number.isFinite(before.at) ||
        typeof before.id !== 'string'
      )
        throw new Error();
    } catch {
      throw new Error('invalid account-bound cursor');
    }
  }
  const at = (row: DeletedRecord) => (row.deletedAt ? Date.parse(row.deletedAt) : 0);
  const rows = records
    .filter((row) => row.accountId === accountId)
    .sort((a, b) => at(b) - at(a) || b.app.id.localeCompare(a.app.id))
    .filter(
      (row) => !before || at(row) < before.at || (at(row) === before.at && row.app.id < before.id)
    );
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    account_id: accountId,
    apps: selected.map((row) => summary(row, now)),
    evaluated_at: new Date(now).toISOString(),
    ...(rows.length > limit && last
      ? {
          next_cursor: Buffer.from(
            JSON.stringify({ accountId, at: at(last), id: last.app.id })
          ).toString('base64url'),
        }
      : {}),
  };
}
