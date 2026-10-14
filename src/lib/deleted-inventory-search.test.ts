import { expect, it } from 'vitest';
import { deletedCursorForAccount, validateDeletedSearch } from './deleted-inventory-search';

it('preserves the opaque cursor and binds reloaded history to its original account', () => {
  const search = validateDeletedSearch({
    view: 'deleted',
    deletedCursor: 'opaque+/=',
    deletedAccount: 'account-a',
  });
  expect(search).toEqual({
    view: 'deleted',
    deletedCursor: 'opaque+/=',
    deletedAccount: 'account-a',
  });
  expect(deletedCursorForAccount(search, 'account-a')).toEqual({
    kind: 'ready',
    cursor: 'opaque+/=',
  });
  expect(deletedCursorForAccount(search, 'account-b')).toEqual({ kind: 'restart_required' });
});

it('keeps active inventory as the default and bounds unexpected URL inputs', () => {
  expect(
    validateDeletedSearch({ view: 'invalid', deletedCursor: 'old', deletedAccount: 'account-a' })
  ).toEqual({ view: undefined, deletedCursor: undefined, deletedAccount: undefined });
  expect(
    validateDeletedSearch({ view: 'deleted', deletedCursor: 'x'.repeat(1025) }).deletedCursor
  ).toBeUndefined();
  expect(deletedCursorForAccount(validateDeletedSearch({ view: 'deleted' }), 'account-b')).toEqual({
    kind: 'ready',
    cursor: '',
  });
});
