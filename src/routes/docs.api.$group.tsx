import { useEffect } from 'react';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ApiOperationSection } from '@/components/docs/api-operation';
import { OnThisPage } from '@/components/docs/toc';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs/api/$group')({
  // Loaded here, not in the component, so an unknown group is the router's
  // real 404 and a prerendered page carries the operations in its markup.
  // The reference is imported here, not at the top: loaders stay in the main
  // bundle, and the spec-derived index must not ride along on every page.
  loader: async ({ params }) => {
    const { loadGroup } = await import('virtual:api-reference');
    const group = await loadGroup(params.group);
    if (!group) throw notFound();
    return { group };
  },
  head: ({ loaderData }) =>
    pageHead({
      title: loaderData ? `${loaderData.group.title} API` : 'API reference',
      description: loaderData?.group.description ?? 'Operations in the Gregale HTTP API.',
    }),
  component: ApiGroupPage,
});

function ApiGroupPage() {
  const { group } = Route.useLoaderData();

  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [group.id]);

  const headings = group.operations.map((operation) => ({
    id: operation.id,
    text: operation.summary,
    level: 2,
  }));

  return (
    <div className="docs-article-layout">
      <article className="docs-article min-w-0 flex-1">
        <header className="border-b border-border pb-6">
          <Link to="/docs/api" className="docs-breadcrumb">
            Documentation <span aria-hidden="true">/</span> API reference
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{group.title}</h1>
          {group.description && (
            <p className="mt-3 text-balance text-muted-foreground">{group.description}</p>
          )}
          <p className="label-mono mt-5 text-muted-foreground">
            {group.operations.length} {group.operations.length === 1 ? 'operation' : 'operations'}
          </p>
        </header>

        <div className="mt-8 flex flex-col gap-10">
          {group.operations.map((operation) => (
            <ApiOperationSection key={operation.id} operation={operation} />
          ))}
        </div>
      </article>
      {headings.length > 2 && <OnThisPage key={group.id} headings={headings} />}
    </div>
  );
}
