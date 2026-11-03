import { useEffect } from 'react';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { WarningTriangle, Undo } from 'iconoir-react';
import { featureFlags } from '@/lib/feature-flags';
import { reportError } from '@/lib/error-reporting';

/**
 * Router-wide error and pending states.
 *
 * Wired as `defaultErrorComponent` / `defaultPendingComponent` in `main.tsx`,
 * so they cover every route rather than only the ones that remembered to opt
 * in. Both are written in tokens, so they read correctly on the light
 * marketing surface and inside the dark `.console` shell without branching.
 */

/**
 * Without this, a component that throws takes the whole app down to a blank
 * white document with the stack only in the console. Now the failure stays
 * scoped to the route: the shell, nav, and everything around it survive, and
 * the user gets a way out that is not "reload and hope".
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error);

  // The router catches these, so the window listeners never see them.
  useEffect(() => {
    if (featureFlags.errorReporting) reportError('route', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-20 text-center"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: 'color-mix(in oklab, var(--status-critical) 15%, transparent)' }}
      >
        <WarningTriangle className="h-5 w-5" style={{ color: 'var(--status-critical)' }} />
      </span>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">This page hit an error.</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The rest of the app is still running — retrying only reloads this view.
        </p>
      </div>

      {/* The message is the one thing that makes a bug report actionable, so
          it is shown rather than swallowed — but folded away by default so a
          stack trace is not the loudest thing on the page. */}
      {message && (
        <details className="w-full text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
            Error details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-card p-3 text-left font-mono text-xs leading-relaxed text-muted-foreground">
            {message}
          </pre>
        </details>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            // Invalidate first: `reset` alone re-renders the same failed
            // state if the route's loader was what threw.
            router.invalidate();
            reset();
          }}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Undo className="h-3.5 w-3.5" />
          Try again
        </button>
        <Link
          to="/dashboard"
          className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-border-secondary"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

/**
 * Shown while a code-split route chunk is in flight. Deliberately quiet — a
 * skeleton that mimics the page would be a lie about what is coming, and a
 * spinner that flashes for 40ms is worse than nothing, so the router's
 * `defaultPendingMs` holds this back until the wait is real.
 */
export function RoutePending() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <span className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="route-pending-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
