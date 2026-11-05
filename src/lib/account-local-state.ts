/**
 * Browser storage that belongs to whoever is signed in.
 *
 * A few console conveniences live in localStorage: the Overview's Recents, the
 * palette's recent commands, the remembered app, saved log views and the
 * onboarding flag. None of them is keyed by account, and a browser can be
 * shared, so without this the next person to sign in would be shown the
 * previous account's app names, routes and saved log queries.
 *
 * Wiping them on every sign-out would cost one person their own saved views
 * each time. Instead the browser records which account owns them, and they are
 * cleared when a *different* account signs in. The in-memory query cache
 * follows the same rule; see `adoptSession` in `auth.tsx`.
 */

export const ONBOARDED_KEY = 'gregale.onboarded';

const OWNER_KEY = 'gregale.local-owner';

/**
 * Keys whose contents describe one account's resources. Each stays defined
 * where it is read; `account-local-state.test.ts` fails if one of these is no
 * longer used anywhere, so a rename cannot silently drop it from the list.
 */
export const ACCOUNT_LOCAL_KEYS = [
  'gregale.recents',
  'gregale.palette.recent',
  'gregale.selectedApp',
  'gregale.logs.views',
  ONBOARDED_KEY,
] as const;

/** Account identity as the console compares it: the address, case-folded. */
export function accountIdentity(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Records `email` as the owner of this browser's account-local state, clearing
 * that state first when it belonged to another account. Returns whether it
 * cleared anything.
 *
 * A browser with no owner recorded (state written before this existed) is
 * adopted, not cleared, so the upgrade does not cost anyone their saved views.
 */
export function claimAccountLocalState(email: string): boolean {
  if (typeof window === 'undefined') return false;
  const next = accountIdentity(email);
  try {
    const owner = window.localStorage.getItem(OWNER_KEY);
    const changed = owner !== null && owner !== next;
    if (changed) for (const key of ACCOUNT_LOCAL_KEYS) window.localStorage.removeItem(key);
    window.localStorage.setItem(OWNER_KEY, next);
    return changed;
  } catch {
    // Storage denied (private modes): nothing was kept, so nothing can leak.
    return false;
  }
}
