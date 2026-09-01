/** The one sentence the user must read after staging deletion. */
export const deletionMessage = (restoreUntil: string) =>
  `Deletion is scheduled. You can sign in and restore it until ${new Date(restoreUntil).toLocaleDateString()}; after that the account and its apps are gone.`;
