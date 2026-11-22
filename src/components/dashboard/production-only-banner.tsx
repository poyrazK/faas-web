import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { ShieldCheck } from 'iconoir-react';
import { useEnvironmentScope } from '@/lib/environment-scope';

type BannerScope = { applies: boolean; environment: string; name: string };
const OUTSIDE: BannerScope = { applies: false, environment: 'production', name: 'Production' };
const BannerScopeContext = createContext<BannerScope>(OUTSIDE);

/**
 * Computes the banner's environment once, in the dashboard shell. A page
 * rendered outside the shell (a test, a public route) gets no banner and
 * needs neither the router nor auth.
 */
export function EnvironmentBannerProvider({ children }: { children: ReactNode }) {
  const env = useEnvironmentScope();
  return (
    <BannerScopeContext.Provider
      value={{ applies: env.applies, environment: env.environment, name: env.name }}
    >
      {children}
    </BannerScopeContext.Provider>
  );
}

/**
 * The note on a page whose API has no environment yet, shown only outside
 * production: what you see is production's, and changes made here apply to
 * production. faas is moving features to per-environment one at a time
 * (ADR-20261104120000); when one lands, its page drops this and follows the
 * environment instead, like Variables, Secrets, crons and routes.
 */
export function ProductionOnlyBanner({ what }: { what: string }) {
  const env = useContext(BannerScopeContext);
  if (!env.applies || env.environment === 'production') return null;
  return (
    <p
      role="note"
      className="flex items-center gap-2 rounded-xl bg-status-warning/10 px-3.5 py-2.5 text-[13px] text-status-warning ring-1 ring-status-warning/25"
    >
      <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>
        This shows production. Changes here apply to production, and this page can’t show {env.name}
        ’s {what} yet.
      </span>
    </p>
  );
}

/** True outside production, where app-wide actions act on production. */
export function useShowsProduction(): boolean {
  const env = useContext(BannerScopeContext);
  return env.applies && env.environment !== 'production';
}

/** A route component with the banner above it. */
export function withProductionBanner<P extends object>(what: string, Page: ComponentType<P>) {
  function WithProductionBanner(props: P) {
    return (
      <div className="flex flex-col gap-4">
        <ProductionOnlyBanner what={what} />
        <Page {...props} />
      </div>
    );
  }
  return WithProductionBanner;
}

/** The app tabs that already follow the environment (slices 3a–3c). */
const SCOPED_APP_TABS = new Set(['Environment', 'Routes', 'Upstreams']);

/** Whether an app tab shows production's data outside production. */
export function appTabShowsProduction(tab: string): boolean {
  return !SCOPED_APP_TABS.has(tab);
}

/** Tabs whose name isn't a plain plural noun, or keeps an acronym. */
const NOUNS: Record<string, string> = {
  General: 'settings',
  'Health and releases': 'health checks',
  MCP: 'MCP setup',
  SLOs: 'SLOs',
  OpenAPI: 'OpenAPI spec',
  'TCP listeners': 'TCP listeners',
  'UDP listeners': 'UDP listeners',
};

/** The page's noun for the banner: "Edge rules" → "edge rules". */
export const productionNoun = (tab: string) => NOUNS[tab] ?? tab.toLowerCase();
