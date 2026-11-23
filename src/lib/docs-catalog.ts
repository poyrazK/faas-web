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
 * - `UNPUBLISHED_DOCS` — catalog paths with no page yet, each with the reason:
 *   upstream's `unpublished` mark, plus any `LOCAL_HOLDS`. The test fails when
 *   upstream adds a path that is in neither, which is the moment someone has
 *   to decide whether it ships.
 */

interface CatalogRoute {
  path: string;
  source?: string;
  external?: boolean;
  /** Why upstream does not publish this page (a preview or internal capability). */
  unpublished?: string;
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
/**
 * Pages faas-web holds back although upstream would publish them, each with
 * the reason. Upstream's own reasons come from the catalog below.
 */
const LOCAL_HOLDS: Record<string, string> = {};

/**
 * Catalog paths that resolve to no page, and why. Upstream marks a page
 * `unpublished` only when it documents preview or internal capabilities; its
 * `docs-links-check` refuses that mark on a GA or beta capability's page
 * (poyrazK/faas#5709). The test keeps the list honest in both directions (a
 * path that is now published must leave it).
 */
export const UNPUBLISHED_DOCS: Record<string, string> = {
  ...Object.fromEntries(
    CATALOG_ROUTES.filter((route) => !route.external && route.unpublished).map((route) => [
      route.path,
      route.unpublished as string,
    ])
  ),
  ...LOCAL_HOLDS,
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
