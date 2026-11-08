import type { PublicStatusOverview } from './api/status';

/**
 * The last public status this browser received, for when `/v1/status` cannot
 * answer.
 *
 * The status page is read from apid, so it fails exactly when people come to
 * check it. A visitor who has seen the page before can still be shown the
 * last snapshot, labelled as such, rather than nothing. It is public data, so
 * it is not account-scoped. Older than a day says too little about now and is
 * not shown.
 */

const KEY = 'gregale.status.last-known';

/** How long a stored snapshot may stand in for the live one. */
export const LAST_KNOWN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface LastKnownStatus {
  /** When this browser stored it, ISO 8601. */
  savedAt: string;
  snapshot: PublicStatusOverview;
}

export function saveStatusSnapshot(snapshot: PublicStatusOverview, now = Date.now()) {
  try {
    const value: LastKnownStatus = { savedAt: new Date(now).toISOString(), snapshot };
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage denied or full: the page simply has no fallback.
  }
}

/** The stored snapshot, or null when there is none, it is malformed, or it is too old. */
export function readStatusSnapshot(now = Date.now()): LastKnownStatus | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LastKnownStatus>;
    const saved = typeof value.savedAt === 'string' ? Date.parse(value.savedAt) : NaN;
    const snapshot = value.snapshot;
    if (
      Number.isNaN(saved) ||
      now - saved > LAST_KNOWN_MAX_AGE_MS ||
      !snapshot ||
      typeof snapshot.overall_status !== 'string' ||
      typeof snapshot.updated_at !== 'string' ||
      // The page maps over every one of these; a snapshot missing one would throw.
      ![
        snapshot.components,
        snapshot.indicators,
        snapshot.active_events,
        snapshot.upcoming_maintenance,
        snapshot.resolved_incidents,
      ].every(Array.isArray)
    )
      return null;
    return { savedAt: value.savedAt as string, snapshot: snapshot as PublicStatusOverview };
  } catch {
    return null;
  }
}
