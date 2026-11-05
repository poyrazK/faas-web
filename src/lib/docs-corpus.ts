import { normalizeDocSource } from './docs-content';

/**
 * Every vendored docs page, inlined at build time (~900 KB of markdown).
 *
 * Only the docs search — which the search box imports on first use — and the
 * tests read the whole corpus. Never import this statically from a route or
 * from the docs layout: that put every page on every docs page view, and once
 * on the landing page too. A single page loads through `loadDocSource`.
 */
const FILES = import.meta.glob('/content/docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function docSource(slug: string): string | undefined {
  const raw = FILES[`/content/docs/${slug}.md`];
  return raw === undefined ? undefined : normalizeDocSource(raw);
}
