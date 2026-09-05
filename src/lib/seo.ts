import { useEffect } from 'react';
import { SECTION_LABELS } from './section-labels';

/**
 * Document metadata, in one place.
 *
 * Every route previously inherited the single `<title>` in `index.html`, so
 * all 25 of them reported the same string to browser tabs, history entries,
 * and bookmarks. Routes now declare their own through the router's `head`
 * option, rendered by `<HeadContent />` in the root layout.
 */

export const SITE_NAME = 'Gregale';
export const SITE_TAGLINE = 'Serverless on real microVMs';
export const SITE_DESCRIPTION =
  'Open-source serverless on Firecracker microVMs. Functions scale to zero when idle and wake from a snapshot in under 350 ms.';

/** Brand last, so the distinguishing half survives a truncated tab. */
function withSiteName(title?: string): string {
  return title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — ${SITE_TAGLINE}`;
}

/**
 * Head fragment for a route. Pass no title for the landing page, which owns
 * the bare brand string.
 *
 * `og:title` and `og:description` are restated per route rather than left to
 * the static ones in `index.html`.
 *
 * Note what that does and does not buy, since the app is client-rendered with
 * no SSR or prerender step: tabs, history, and bookmarks are correct, and
 * crawlers that execute JS (Googlebot does) see the per-route values. Social
 * unfurlers — Slack, Twitter, Facebook — generally do not run JS, so they
 * still read the static tags in `index.html`. Fixing that needs prerendering,
 * not more meta tags.
 */
export function pageHead({ title, description }: { title?: string; description?: string } = {}) {
  const full = withSiteName(title);
  const desc = description ?? SITE_DESCRIPTION;

  return {
    meta: [
      { title: full },
      { name: 'description', content: desc },
      { property: 'og:title', content: full },
      { property: 'og:description', content: desc },
      // Names the source in a preview card, so a shared link reads as coming
      // from Gregale rather than from a bare URL.
      { property: 'og:site_name', content: SITE_NAME },
    ],
  };
}

/**
 * Head for a console page, keyed by its URL segment. The label is read from
 * the nav config — the same source the sidebar and breadcrumb use — so a
 * renamed nav item cannot leave a stale title behind.
 */
export function consoleHead(segment: string, description?: string) {
  return pageHead({ title: SECTION_LABELS[segment] ?? segment, description });
}

/**
 * Refines the title once data the router could not know has resolved.
 *
 * `head` runs outside React and has only the route params, so a workflow page
 * can name the id but not the workflow. This lets the component replace the
 * placeholder with the real name after the store resolves it, and restores
 * whatever the route declared on the way out.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = withSiteName(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}
