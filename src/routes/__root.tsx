import { createRootRoute, HeadContent, Link, Outlet } from '@tanstack/react-router';
import { accentChain } from 'glimm';
import { GlimmProvider } from 'glimm/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { DataProvider } from '@/lib/store';
import { retryPolicy } from '@/lib/api/queries';
import { ToastProvider } from '@/components/ui/toast';
import { MfaProvider } from '@/components/auth/mfa-provider';
import { DevBypassButton } from '@/components/dev-bypass-button';
import { pageHead } from '@/lib/seo';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  // The floor every route overrides. Without it, a route that declares no
  // head of its own would inherit whatever the previous route left behind.
  head: () => pageHead(),
});

/**
 * The sweep palette, fitted to the brand ramp.
 *
 * glimm ships six named palettes and none of them are mint — `mint` exists only
 * in its accent set, which is not what `palette` takes. `accentChain` fits a
 * cosine palette to an arbitrary chain of hexes, so the sweep travels the same
 * three steps of the ramp the rest of the site uses.
 */
const MINT_SWEEP = accentChain(['#d3fae8', '#00ce91', '#006f40']);

/**
 * Created once at module scope rather than per render, so a re-render never
 * throws away the cache.
 *
 * `staleTime` of 30s matches the router's own preload staleness: the console is
 * an operations surface, so data should be fresh when you come back to a tab,
 * but not refetch on every incidental focus change.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: retryPolicy,
      // The metrics rollup is a Prometheus query; refetching it every time the
      // window regains focus is a cost with little payoff at this cadence.
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <MfaProvider>
        <AuthProvider>
          <DataProvider>
            {/* Tuned for a paper page: the sweep now has to read as a darkening
              band rather than a glow, so brightness comes up toward neutral —
              pulling it down was what kept it from blowing out against the old
              near-black surface, and on white that only made it muddy. */}
            <GlimmProvider
              palette={MINT_SWEEP}
              brightness={0.94}
              sweepMs={950}
              outroMs={620}
              easing="easeInOutCubic"
              waveAmount={0.6}
              swellAmount={0.6}
            >
              <ToastProvider>
                {/* Applies each route's `head` to the document. */}
                <HeadContent />
                <Outlet />
                {/* Statically false in production, so the button and its
                  module are dropped from the bundle. */}
                {import.meta.env.DEV && <DevBypassButton />}
              </ToastProvider>
            </GlimmProvider>
          </DataProvider>
        </AuthProvider>
      </MfaProvider>
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <p className="label-mono text-brand">Error 404</p>
      <h1 className="max-w-md text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        This route never booted.
      </h1>
      <p className="max-w-sm text-balance text-muted-foreground">
        The page you asked for does not exist. It may have been moved, or the link may be stale.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Back to home
        </Link>
        <Link
          to="/dashboard"
          className="rounded-full border border-border px-5 py-2 text-sm transition-colors hover:border-border-secondary"
        >
          Open dashboard
        </Link>
      </div>
    </div>
  );
}
