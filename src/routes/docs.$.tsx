import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { resolveDocPath } from '@/lib/docs-catalog';

/**
 * Catch-all under /docs for the paths the API and CLI may emit that are not
 * a published slug: catalog aliases (`/docs/orgs`), nested catalog paths
 * (`/docs/build/source-ref`), and the "child routes use the parent guide"
 * convention (`/docs/domains/verify`). Each becomes a redirect to the page
 * that exists; anything else is the router's real not-found.
 *
 * The edge does the same with 308s in `vercel.json` and `_redirects`, so a
 * cold link never hits this route in production. This is for `npm run dev`
 * and for in-app navigation, and it keeps the two in step via `docs.test.ts`.
 */
export const Route = createFileRoute('/docs/$')({
  loader: ({ params }) => {
    const target = resolveDocPath(params._splat ?? '');
    if (!target) throw notFound();
    const slug = 'slug' in target ? target.slug : target.alias;
    throw redirect({ to: '/docs/$slug', params: { slug }, replace: true });
  },
  component: () => null,
});
