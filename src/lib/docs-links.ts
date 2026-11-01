import { DOC_ENTRIES } from './docs-manifest.ts';

/**
 * Where a link in vendored markdown points once published.
 *
 * Upstream pages link to each other by repository path (`../domains.md`).
 * A path that is published here becomes that page — `page` decides the
 * form: the HTML route for the site, the Markdown copy for agents. Anything
 * else falls back to the file on GitHub, so a link to an unpublished page
 * still lands somewhere real. Absolute URLs, root-relative paths, anchors and
 * queries are already final and pass through untouched.
 */
export function resolveDocHref(
  href: string,
  sourcePath?: string,
  page: (slug: string) => string = (slug) => `/docs/${slug}`
): string {
  if (!sourcePath || /^(?:[a-z][a-z0-9+.-]*:|[/#?])/i.test(href)) return href;
  const resolved = new URL(href, `https://source.invalid/${sourcePath}`);
  const path = resolved.pathname.slice(1);
  const published = DOC_ENTRIES.find((entry) => entry.source === path);
  return published
    ? `${page(published.slug)}${resolved.search}${resolved.hash}`
    : `https://github.com/poyrazK/faas/blob/main/${path}${resolved.search}${resolved.hash}`;
}
