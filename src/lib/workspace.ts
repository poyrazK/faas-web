import { useSyncExternalStore } from 'react';

/**
 * The organization the console is working in.
 *
 * apid scopes a request to an organization when it carries
 * `X-Active-Org: <slug>` (header wins over `?org=`; ADR-061). The session
 * itself never binds one — the client chooses per request — so the choice is
 * kept here, per account, and the API client attaches it. No choice means the
 * personal organization, which is also what apid assumes without a header.
 *
 * `/v1/apps` and `/v1/projects` stay account-scoped whatever the header says;
 * the switcher says so rather than implying the lists are filtered. Apps reach
 * a workspace through its URL instead: `POST /v1/orgs/{slug}/apps` attributes a
 * new app to it and `GET /v1/orgs/{slug}/apps` lists what it has
 * (`lib/api/workspace-apps.ts`).
 */

const KEY = (accountId: string) => `gregale.active-org.${accountId}`;
const listeners = new Set<() => void>();
let bound: { accountId: string; slug: string | null } = { accountId: '', slug: null };

function read(accountId: string): string | null {
  if (!accountId || typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY(accountId))?.trim() || null;
}

function emit() {
  for (const listener of listeners) listener();
}

/** Point the store at the signed-in account; another account's choice never leaks. */
export function bindWorkspaceAccount(accountId: string) {
  if (bound.accountId === accountId) return;
  bound = { accountId, slug: read(accountId) };
  emit();
}

/** Select an organization by slug, or null for the personal one. */
export function setActiveOrg(slug: string | null) {
  if (!bound.accountId) return;
  bound = { ...bound, slug };
  if (slug) window.localStorage.setItem(KEY(bound.accountId), slug);
  else window.localStorage.removeItem(KEY(bound.accountId));
  emit();
}

/** The header value for the current request, if a non-personal org is chosen. */
export function activeOrgHeader(): string | null {
  return bound.slug;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveOrg(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => bound.slug,
    () => null
  );
}

/**
 * Whether the store is bound to the signed-in account yet. Until it is, the
 * active org reads as null even when a company is chosen, so a page that shows
 * the personal account's numbers must wait for this rather than read null as
 * "personal".
 */
export function workspaceBound(): boolean {
  return bound.accountId !== '';
}

export function useWorkspaceBound(): boolean {
  return useSyncExternalStore(subscribe, workspaceBound, () => false);
}
