import { useEffect } from 'react';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'iconoir-react';
import { CopyButton } from '@/components/docs/copy-button';
import { Markdown } from '@/components/docs/markdown';
import { OnThisPage } from '@/components/docs/toc';
import { DOC_SECTIONS, docNeighbours, findDoc } from '@/lib/docs-manifest';
import { docSource, extractHeadings, readingMinutes, stripTitle } from '@/lib/docs-content';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs/$slug')({
  // Resolved in `loader` rather than in the component so an unknown slug is a
  // real 404 — the router's not-found boundary — instead of a page that renders
  // empty with a 200.
  loader: ({ params }) => {
    const entry = findDoc(params.slug);
    const source = docSource(params.slug);
    if (!entry || !source) throw notFound();
    return { entry, source };
  },
  head: ({ params }) => {
    const entry = findDoc(params.slug);
    return pageHead({ title: entry?.title, description: entry?.summary });
  },
  component: DocPage,
});

const PAGINATION_CARD =
  'group flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-brand/40';

function DocPage() {
  const { entry, source } = Route.useLoaderData();
  const { prev, next } = docNeighbours(entry.slug);
  const section = DOC_SECTIONS.find((s) => s.entries.some((e) => e.slug === entry.slug));

  const body = stripTitle(source);
  const headings = extractHeadings(body);
  const minutes = readingMinutes(body);

  // The router does not manage scroll, so a "Next" click at the foot of one
  // page would otherwise land at the foot of the following one. Instant, so
  // the html-level smooth scrolling never animates a page change; a hash means
  // a deep link to a heading, and the anchor jump wins.
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [entry.slug]);

  return (
    <div className="flex gap-10">
      <article className="min-w-0 max-w-3xl flex-1">
        <header className="border-b border-border pb-6">
          {section && <p className="label-mono text-brand">{section.title}</p>}
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{entry.title}</h1>
          <p className="mt-3 text-balance text-muted-foreground">{entry.summary}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="label-mono text-muted-foreground">~{minutes} min read</span>
            {/* The whole page, title included, one keystroke from a ticket,
                a teammate, or a model's context window. */}
            <CopyButton text={source} label="Copy as Markdown" className="label-mono" />
          </div>
        </header>

        <Markdown source={body} />

        <nav aria-label="Pagination" className="mt-10 grid gap-3 sm:grid-cols-2">
          {prev && (
            <Link to="/docs/$slug" params={{ slug: prev.slug }} className={PAGINATION_CARD}>
              <span className="label-mono flex items-center gap-1.5 text-muted-foreground">
                <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />
                Previous
              </span>
              <span className="text-sm">{prev.title}</span>
            </Link>
          )}
          {next && (
            <Link
              to="/docs/$slug"
              params={{ slug: next.slug }}
              className={`${PAGINATION_CARD} items-end text-right ${prev ? '' : 'sm:col-start-2'}`}
            >
              <span className="label-mono flex items-center gap-1.5 text-muted-foreground">
                Next
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </span>
              <span className="text-sm">{next.title}</span>
            </Link>
          )}
        </nav>

        {/* Feedback channel: the sales/support inbox, now that the source
            repository is no longer public-facing. */}
        <p className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
          Spotted a problem on this page?{' '}
          <a
            href="mailto:support@gregale.dev"
            className="inline-flex items-center gap-1 text-brand underline-offset-4 hover:underline"
          >
            Tell us
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </p>
      </article>

      {/* On-page contents. Hidden below xl: at narrower widths it competes with
          the section sidebar for room the article needs. Keyed by slug so the
          scroll-spy never carries one page's state into the next. */}
      {headings.length > 2 && <OnThisPage key={entry.slug} headings={headings} />}
    </div>
  );
}
