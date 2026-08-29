import { useCallback, type ComponentProps } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useGlimm, type SweepOptions } from 'glimm/react';

/**
 * Navigation wrapped in a glimm sweep.
 *
 * Deliberately opt-in per destination rather than intercepting every link:
 * the sweep is worth a beat on the big context switches (marketing → auth →
 * onboarding → app) and is friction on routine in-app navigation.
 */

/** Destinations that warrant a sweep. Keeps TanStack's typed `to` happy. */
export type SweepTo =
  | '/'
  | '/login'
  | '/signup'
  | '/dashboard'
  // Onboarding can hand off straight into the new-app wizard — the same
  // setup-to-console switch as '/dashboard', landing one page deeper.
  | '/dashboard/workflows/new'
  | '/onboarding';

type SweepLinkProps = Omit<ComponentProps<typeof Link>, 'to'> & {
  to: SweepTo;
  sweepOptions?: SweepOptions;
};

export function SweepLink({ to, sweepOptions, children, onClick, ...rest }: SweepLinkProps) {
  const { sweep } = useGlimm();
  const navigate = useNavigate();

  return (
    // Still a real <a> with an href, so middle-click, cmd-click, "open in new
    // tab", and crawlers all behave normally.
    <Link
      to={to}
      {...rest}
      onClick={(e) => {
        // Callers use this for side effects like closing a menu.
        onClick?.(e);
        // Let the browser handle modified clicks itself.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        sweep(() => navigate({ to }), sweepOptions);
      }}
    >
      {children}
    </Link>
  );
}

/** Programmatic equivalent, for navigation that follows an async action. */
export function useSweepNavigate() {
  const { sweep } = useGlimm();
  const navigate = useNavigate();

  return useCallback(
    (to: SweepTo, sweepOptions?: SweepOptions) => sweep(() => navigate({ to }), sweepOptions),
    [sweep, navigate]
  );
}
