import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Search } from 'iconoir-react';
import { groups, loadSearch } from 'virtual:api-reference';
import { MethodLabel } from '@/components/docs/api-operation';
import type { ApiGroupSummary } from '@/lib/api-reference/build';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs/api/')({
  head: () =>
    pageHead({
      title: 'API reference',
      description:
        'Every operation in the Gregale HTTP API, grouped by what it manages, with parameters, responses and a curl to try each one.',
    }),
  component: ApiReferenceIndex,
});

const TOTAL = groups.reduce((sum, group) => sum + group.count, 0);
const RESULT_LIMIT = 50;

function ApiReferenceIndex() {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<ApiGroupSummary[] | null>(null);

  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // The search list is its own chunk: fetched once someone starts typing.
  useEffect(() => {
    if (!query.trim() || all) return;
    let live = true;
    void loadSearch().then((list) => {
      if (live) setAll(list);
    });
    return () => {
      live = false;
    };
  }, [query, all]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length || !all) return [];
    return all.flatMap((group) =>
      group.operations
        .filter((operation) => {
          const haystack =
            `${operation.method} ${operation.path} ${operation.summary} ${group.title}`.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
        .map((operation) => ({ group, operation }))
    );
  }, [query, all]);

  return (
    <div className="docs-article-layout">
      <article className="docs-article min-w-0 flex-1">
        <header className="border-b border-border pb-6">
          <Link to="/docs" className="docs-breadcrumb">
            Documentation <span aria-hidden="true">/</span> Reference
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">API reference</h1>
          <p className="mt-3 text-balance text-muted-foreground">
            Everything the console and the CLI do goes through this HTTP API. {TOTAL} operations,
            grouped by what they manage.
          </p>
        </header>

        <section aria-labelledby="api-basics" className="mt-8 grid gap-4 sm:grid-cols-2">
          <h2 id="api-basics" className="sr-only">
            Basics
          </h2>
          <Basic title="Base URL">
            <code className="font-mono">https://api.gregale.dev</code>. Every path below starts with{' '}
            <code className="font-mono">/v1</code>.
          </Basic>
          <Basic title="Authentication">
            Send an API key as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
            Create one in the console under Settings → API keys. The CLI reads it from{' '}
            <code className="font-mono">FAAS_TOKEN</code>.
          </Basic>
          <Basic title="Errors">
            Failures are <code className="font-mono">application/problem+json</code> with a stable{' '}
            <code className="font-mono">code</code> to branch on.{' '}
            <Link
              to="/docs/$slug"
              params={{ slug: 'errors' }}
              className="text-brand hover:underline"
            >
              Error codes
            </Link>
          </Basic>
          <Basic title="Retries">
            Operations that list an <code className="font-mono">Idempotency-Key</code> header store
            the response for 24 hours; a retry with the same key gets it back instead of acting
            twice.
          </Basic>
        </section>

        <section aria-labelledby="api-search" className="mt-10">
          <h2 id="api-search" className="text-lg font-semibold tracking-tight">
            Find an operation
          </h2>
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-brand/50">
            <Search aria-hidden="true" width={16} className="text-muted-foreground" />
            <span className="sr-only">Search operations</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Path, method or what it does — e.g. deploy, secrets, DELETE"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          {query.trim() && (
            <div aria-live="polite" className="mt-3">
              {!all ? (
                <p className="text-sm text-muted-foreground">Loading operations…</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No operation matches.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {results.slice(0, RESULT_LIMIT).map(({ group, operation }) => (
                      <li key={`${group.id}-${operation.id}`}>
                        <Link
                          to="/docs/api/$group"
                          params={{ group: group.id }}
                          hash={operation.id}
                          className="flex min-w-0 items-center gap-3 px-3 py-2.5 hover:bg-muted/40"
                        >
                          <MethodLabel method={operation.method} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{operation.summary}</span>
                            <span className="block truncate font-mono text-xs text-muted-foreground">
                              {operation.path}
                            </span>
                          </span>
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                            {group.title}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {results.length > RESULT_LIMIT && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing {RESULT_LIMIT} of {results.length}. Add a word to narrow it.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="api-groups" className="mt-10">
          <h2 id="api-groups" className="text-lg font-semibold tracking-tight">
            By area
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  to="/docs/api/$group"
                  params={{ group: group.id }}
                  className="group flex h-full flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-brand/40"
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {group.title}
                    <ArrowRight
                      aria-hidden="true"
                      width={14}
                      className="text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                  </span>
                  {group.description && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {group.description}
                    </span>
                  )}
                  <span className="label-mono mt-auto pt-1 text-muted-foreground">
                    {group.count} {group.count === 1 ? 'operation' : 'operations'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
          Generating a client? The machine-readable spec is at{' '}
          <a href="/v1/openapi.yaml" className="font-mono text-brand hover:underline">
            /v1/openapi.yaml
          </a>
          .
        </p>
      </article>
    </div>
  );
}

function Basic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
