export type DeletedInventorySearch = {
  view?: 'deleted';
  deletedCursor?: string;
  deletedAccount?: string;
};
export function validateDeletedSearch(search: Record<string, unknown>): DeletedInventorySearch {
  if (search.view !== 'deleted')
    return { view: undefined, deletedCursor: undefined, deletedAccount: undefined };
  return {
    view: 'deleted',
    deletedCursor:
      typeof search.deletedCursor === 'string' &&
      search.deletedCursor.length > 0 &&
      search.deletedCursor.length <= 1024
        ? search.deletedCursor
        : undefined,
    deletedAccount:
      typeof search.deletedAccount === 'string' &&
      search.deletedAccount.length > 0 &&
      search.deletedAccount.length <= 128
        ? search.deletedAccount
        : undefined,
  };
}
export function deletedCursorForAccount(
  search: DeletedInventorySearch,
  accountId: string
): { kind: 'ready'; cursor: string } | { kind: 'restart_required' } {
  return search.deletedCursor && search.deletedAccount !== accountId
    ? { kind: 'restart_required' }
    : { kind: 'ready', cursor: search.deletedCursor ?? '' };
}
