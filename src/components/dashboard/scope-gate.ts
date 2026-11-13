import { useContext, useMemo } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { projectKeys } from '@/lib/api/projects';
import { STANDALONE, useProjectScope, type ProjectScope } from '@/lib/project-scope';

/**
 * What a project-scoped list needs beyond `useProjectScope`: whether to wait,
 * whether membership failed (so an empty list would be a lie), and the words
 * that name the scope in counts, empty states and account-wide notes.
 */
export function useScopeGate() {
  const scope = useProjectScope();
  // Read softly: a page whose queries are all mocked in a test has no client,
  // and retrying membership is then simply a no-op.
  const client = useContext(QueryClientContext);
  const waiting = Boolean(scope.project) && scope.appSlugs === null;
  const failed = waiting && scope.settled;
  const { project, label } = scope;
  const error = useMemo(
    () =>
      failed
        ? new Error(
            project === STANDALONE
              ? 'Couldn’t tell which apps are standalone, so nothing is shown rather than every app.'
              : `Couldn’t read which apps are in ${label}, so nothing is shown rather than every app.`
          )
        : undefined,
    [failed, project, label]
  );
  return {
    scope,
    /** Membership is still loading: show the page's loading state, never the unscoped list. */
    pending: waiting && !scope.settled,
    /** Membership failed: an error for the page's error state. */
    error,
    retry: () => void client?.invalidateQueries({ queryKey: projectKeys.all }),
  };
}

/** "in acme-shop", "among standalone apps", or "" with no project chosen. */
export function scopedIn(scope: Pick<ProjectScope, 'project' | 'label'>): string {
  if (!scope.project) return '';
  return scope.project === STANDALONE ? 'among standalone apps' : `in ${scope.label}`;
}

/** The quiet line for what the API cannot tie to an app; null with no project chosen. */
export function accountWideNote(scope: Pick<ProjectScope, 'project' | 'label'>): string | null {
  if (!scope.project) return null;
  return `Account-wide — not limited to ${scope.project === STANDALONE ? 'standalone apps' : scope.label}.`;
}

export type ScopeGate = ReturnType<typeof useScopeGate>;

/** "the apps in acme-shop" or "standalone apps": what a freeze on every app also holds. */
export function scopedApps(scope: Pick<ProjectScope, 'project' | 'label'>): string {
  return scope.project === STANDALONE ? 'standalone apps' : `the apps in ${scope.label}`;
}
