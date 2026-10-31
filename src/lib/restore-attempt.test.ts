import { beforeEach, expect, it } from 'vitest';
import {
  beginRestoreAttempt,
  clearRestoreAttempt,
  listRestoreAttempts,
  readRestoreAttempt,
  updateRestoreAttempt,
} from './restore-attempt';

const intent = {
  accountId: 'account-a',
  appId: '00000000-0000-4000-8000-000000000001',
  slug: 'retained-app',
  expectedDeletedAt: '2026-10-12T12:00:00Z',
  expectedDeadline: '2026-10-19T12:00:00Z',
};
beforeEach(() => window.sessionStorage.clear());

it('retains safe account-owned identity and fences updates from an older attempt', () => {
  const first = beginRestoreAttempt({ ...intent, token: 'must-not-retain' } as never);
  expect(readRestoreAttempt('account-b', intent.appId)).toBeNull();
  expect(listRestoreAttempts('account-a')).toEqual([first]);
  expect(JSON.stringify(window.sessionStorage)).not.toContain('must-not-retain');
  expect(() => beginRestoreAttempt(intent)).toThrow(/inspect/i);
  clearRestoreAttempt(first);
  const second = beginRestoreAttempt(intent);
  updateRestoreAttempt(first, 'accepted');
  clearRestoreAttempt(first);
  expect(readRestoreAttempt('account-a', intent.appId)?.attemptId).toBe(second.attemptId);
});

it('does not interpret corrupted browser storage as verified restoration', () => {
  const record = beginRestoreAttempt(intent);
  const key = Object.keys(window.sessionStorage)[0];
  window.sessionStorage.setItem(
    key,
    JSON.stringify({ ...record, phase: 'healthy', endpoint_url: 'must-not-retain' })
  );
  expect(listRestoreAttempts('account-a')).toEqual([]);
});
