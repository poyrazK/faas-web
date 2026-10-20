import catalog from '../../content/customer-pages.json';
import { DOC_ENTRIES, findDoc } from './docs-manifest.ts';

/**
 * The upstream contract for documentation URLs.
 *
 * `poyrazK/faas` keeps `docs/customer-pages.json`: every path a CLI help
 * line or an RFC 7807 `docs_url` may point at, with the markdown source each
 * one means. Its CI rejects a new docs URL that is not in the catalog, so
 * this file is the complete list of what the API can send a customer to.
 *
 * Vendored by `npm run docs:pull` next to the markdown. Two things are
 * derived from it here, and `docs.test.ts` holds the third:
 *
 * - `DOC_ALIASES` — catalog paths whose source is published under another
 *   slug (`orgs` and `account.md` → `/docs/account`). The docs route
 *   redirects them, and `vercel.json` / `_redirects` do the same at the edge
 *   so the link never reaches the SPA as a soft 404.
 * - `UNPUBLISHED_DOCS` — catalog paths with no page yet, each with the reason.
 *   The test fails when upstream adds a path that is in neither list, which
 *   is the moment someone has to decide whether it ships.
 */

interface CatalogRoute {
  path: string;
  source?: string;
  external?: boolean;
}

export const CATALOG_ROUTES: CatalogRoute[] = (catalog as { routes: CatalogRoute[] }).routes;

/**
 * Aliases the catalog cannot express by source: `sidecars.md` is a one-line
 * stub upstream that says the feature is now called companions.
 */
const MANUAL_ALIASES: Record<string, string> = { sidecars: 'companions' };

/** Alias path → published slug. */
export const DOC_ALIASES: Record<string, string> = {
  ...Object.fromEntries(
    CATALOG_ROUTES.filter((route) => !route.external && route.path && !findDoc(route.path))
      .map((route) => [
        route.path,
        DOC_ENTRIES.find((entry) => entry.source === route.source)?.slug,
      ])
      .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
  ),
  ...MANUAL_ALIASES,
};

/**
 * Catalog paths that resolve to no page, and why. Each reason is a decision
 * someone made, not an oversight; the test keeps the list honest in both
 * directions (a path that is now published must leave it).
 */
export const UNPUBLISHED_DOCS: Record<string, string> = {
  alerts: 'upstream page carries Prometheus and migration notes; needs upstream cut first',
  'api-hosting': 'internal roadmap, not a customer document',
  apps: 'upstream page carries a roadmap paragraph and an operator-gated note',
  automations: 'upstream page interleaves platform migration and rollout steps',
  auth: 'upstream page documents operator OAuth and apid configuration',
  billing: 'upstream page carries provider internals and a remaining-gaps section',
  'change-timeline': 'feature is an internal preview',
  crons: 'alias of event-driven',
  'data-api': 'upstream page carries operator enablement and staging qualification notes',
  'data-api-onboarding': 'upstream page ends with an internal pilot plan',
  'data-pipelines': 'feature is staging-only and the page is mostly operator procedure',
  datadog: 'feature is an internal preview',
  'durable-entity-development': 'feature gates are off in production',
  errors: 'upstream page gives operator remedies for several codes',
  'event-driven': 'operator rollout notes from line 687 on; the first part is clean',
  'exclusive-operations': 'upstream page carries an open release gate and implementation notes',
  functions: 'upstream page links ops acceptance docs; the rest is customer content',
  issues: 'upstream page carries a staging hostname and operator Slack/Linear setup',
  jobs: 'upstream intro exposes daemons, storage layout, and control-plane flags',
  'managed-postgres': 'operator preview; no contiguous customer section',
  mcp: 'operator thresholds and runbook links throughout; also too long for one page',
  networking: 'first 160 lines describe internal network design',
  operations: 'feature is internal and not launched',
  postgres: 'alias of managed-postgres',
  profiling: 'feature is internal',
  realtime: 'page hands off to an operator guide for limits and recovery',
  secrets: 'upstream page carries fleet topology and vmmd upgrade order',
  'service-map': 'feature is an internal preview',
};

/**
 * Where a docs path leads. The catalog's child paths (`domains/verify`,
 * `auth/reset`) mean "the parent guide", so an unknown path collapses to its
 * first segment before giving up.
 */
export function resolveDocPath(path: string): { slug: string } | { alias: string } | undefined {
  const clean = path.replace(/^\/+|\/+$/g, '');
  if (!clean) return undefined;
  if (findDoc(clean)) return { slug: clean };
  if (DOC_ALIASES[clean]) return { alias: DOC_ALIASES[clean] };
  const [head] = clean.split('/');
  if (head !== clean) return resolveDocPath(head);
  return undefined;
}
