import { renderToString } from 'react-dom/server';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * Build-time renderer, compiled separately by `vite build --ssr` and driven by
 * `scripts/prerender.mjs`. Never part of the browser bundle.
 */

export interface Rendered {
  /** Markup for `#root`. */
  html: string;
  /** The route's resolved head tags, for the document `<head>`. */
  meta: Record<string, unknown>[];
  /** Route-specific resource hints and stylesheets. */
  links: Record<string, unknown>[];
}

export async function render(url: string): Promise<Rendered> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  });

  await router.load();
  const html = renderToString(<RouterProvider router={router} />);

  // Meta is collected from every match, shallowest first, so a leaf route's
  // title overrides the root's fallback rather than the other way round.
  const meta = router.state.matches.flatMap(
    (match) => (match.meta ?? []) as Record<string, unknown>[]
  );
  const links = router.state.matches.flatMap(
    (match) => (match.links ?? []) as Record<string, unknown>[]
  );

  return { html, meta, links };
}
