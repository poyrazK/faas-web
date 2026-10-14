import { expect, it } from 'vitest';
import { listDeletedRecords, readDeletedRecord, type DeletedRecord } from './deleted-apps';

it('serves bounded owned metadata, ties and account-bound cursor history', () => {
  const now = Date.parse('2026-10-12T13:00:00Z');
  const records: DeletedRecord[] = [
    {
      app: { id: '00000000-0000-4000-8000-000000000001', slug: 'one' },
      accountId: 'account-a',
      deletedAt: '2026-10-12T12:00:00Z',
      expiresAt: now + 60000,
    },
    {
      app: { id: '00000000-0000-4000-8000-000000000002', slug: 'two' },
      accountId: 'account-a',
      deletedAt: '2026-10-12T12:00:00Z',
      expiresAt: now + 60000,
    },
    {
      app: { id: '00000000-0000-4000-8000-000000000003', slug: 'foreign' },
      accountId: 'account-b',
      deletedAt: '2026-10-12T12:00:00Z',
      expiresAt: now + 60000,
    },
  ];
  const first = listDeletedRecords(records, 'account-a', '', 1, now);
  expect(first.apps.map((row) => row.slug)).toEqual(['two']);
  expect(first.apps[0].restore_eligible).toBe(true);
  expect(readDeletedRecord(records, 'account-a', records[2].app.id, now)).toBeNull();
  expect(() => listDeletedRecords(records, 'account-b', first.next_cursor!, 1, now)).toThrow(
    /cursor/i
  );
  const second = listDeletedRecords(records, 'account-a', first.next_cursor!, 1, now);
  expect(second.apps.map((row) => row.slug)).toEqual(['one']);
  expect(second.next_cursor).toBeUndefined();
  expect(() => listDeletedRecords(records, 'account-a', '', 51, now)).toThrow(/limit/i);
});

it('preserves null metadata and server-evaluated lifecycle blockers', () => {
  const now = Date.parse('2026-10-12T13:00:00Z');
  const records: DeletedRecord[] = [
    {
      app: { id: 'legacy', slug: 'legacy' },
      accountId: 'account-a',
      deletedAt: null,
      expiresAt: null,
    },
    {
      app: { id: 'expired', slug: 'expired' },
      accountId: 'account-a',
      deletedAt: '2026-10-10T12:00:00Z',
      expiresAt: now - 1,
    },
    {
      app: { id: 'purging', slug: 'purging' },
      accountId: 'account-a',
      deletedAt: '2026-10-10T12:00:00Z',
      expiresAt: now - 1,
      purgeStarted: true,
    },
  ];
  expect(
    listDeletedRecords(records, 'account-a', '', 25, now)
      .apps.map((row) => [row.slug, row.restore_blocker])
      .sort()
  ).toEqual([
    ['expired', 'grace_expired'],
    ['legacy', 'metadata_unavailable'],
    ['purging', 'purge_started'],
  ]);
  expect(readDeletedRecord(records, 'account-a', 'legacy', now)?.delete_grace_until).toBeNull();
});
