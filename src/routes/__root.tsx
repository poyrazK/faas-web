import { createRootRoute, HeadContent, Link, Outlet } from '@tanstack/react-router';
import { hexToRgb, type Palette } from 'glimm';
import { GlimmProvider } from 'glimm/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { DataProvider } from '@/lib/store';
import { retryPolicy } from '@/lib/api/queries';
import { ToastProvider } from '@/components/ui/toast';
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
 * The sweep palette, built by hand rather than fitted.
 *
 * glimm ships six named palettes and none of them are mint, so this was
 * `accentChain(['#d3fae8', '#00ce91', '#006f40'])` — a least-squares cosine
 * fit through three ramp steps. The fit has a trap: the shader's hue
 * coordinate drifts (a random 0–0.4 per-session shift plus 0.04/s of session
 * time), and the fitted curve's extrapolated half-period is grey-brown and
 * dusty pink — so sweeps later in a session slid visibly off-brand.
 *
 * A cosine palette with *equal phases* has no off-curve half: every channel
 * peaks together, so every hue-coordinate value — drifted or not — lands on
 * the straight RGB segment between the two anchors. The drift still animates
 * the band, but it can only slide along the ramp. The pale `#d3fae8` anchor
 * is gone on purpose: the band has to read as a darkening band on paper (see
 * the brightness note below), and a near-white stop fought that; the shader's
 * own specular highlights supply the light sparkle instead.
 */
function rampSegment(hexA: string, hexB: string): Palette {
  const A = hexToRgb(hexA);
  const B = hexToRgb(hexB);
  const mid = (i: number) => (A[i] + B[i]) / 2;
  const half = (i: number) => (A[i] - B[i]) / 2;
  return {
    a: [mid(0), mid(1), mid(2)], // centre of the segment
    b: [half(0), half(1), half(2)], // amplitude: t=0 → hexA, t=1 → hexB
    c: [0.5, 0.5, 0.5],
    d: [0, 0, 0], // equal phases — the property the whole comment is about
  };
}

const MINT_SWEEP = rampSegment('#00ce91', '#006f40');

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
