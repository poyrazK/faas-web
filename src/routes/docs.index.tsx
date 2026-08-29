import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight } from 'iconoir-react';
import { DitherGlow } from '@/components/landing/dither-glow';
import { DOC_ENTRIES, DOC_SECTIONS, type DocEntry } from '@/lib/docs-manifest';
import { docSource, readingMinutes } from '@/lib/docs-content';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
  head: () =>
    pageHead({
      title: 'Documentation',
      description:
        'Guides for deploying to one-box FaaS: scale-to-zero behaviour, runtimes, the CLI, and the trust documents.',
    }),
});

const CARD =
  'group relative flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/40';

/** The nav capsule's lit top edge, at card scale — appears on hover. */
function CardHairline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-6 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      style={{
        background:
          'linear-gradient(to right, transparent, color-mix(in oklab, var(--brand-fill) 60%, transparent) 50%, transparent)',
      }}
    />
  );
}

/** A rule line with the section name in the mono label voice — the docs index
    reads as a technical index, and this is its ruling. */
function SectionRule({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="label-mono shrink-0 text-brand">{title}</h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {count !== undefined && <span className="label-mono text-muted-foreground">{count}</span>}
    </div>
  );
}

function DocCard({ entry }: { entry: DocEntry }) {
  const minutes = readingMinutes(docSource(entry.slug) ?? '');
  return (
    <Link to="/docs/$slug" params={{ slug: entry.slug }} className={CARD}>
      <CardHairline />
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {entry.title}
        <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none" />
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{entry.summary}</span>
      <span className="label-mono mt-auto pt-2 text-muted-foreground/70">~{minutes} min</span>
    </Link>
  );
}

/**
 * The docs landing page.
 *
 * Sections carry a blurb rather than only a list, because the titles alone do
 * not tell a first-time reader whether "Storage" means object storage (it does
 * not) or what "Preview environments" gets them. The guide and section counts
 * in the header are real figures from the manifest — figures shown as figures,
 * like everywhere else on this site.
 */
function DocsIndex() {
  return (
    <div className="flex max-w-3xl flex-col gap-12">
      <header className="relative">
        {/* The brand's dither field, CSS only — no canvas on a reference page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 right-0 hidden h-52 w-72 sm:block"
        >
          <DitherGlow className="inset-0" />
        </div>
        <div className="relative">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <p className="label-mono text-brand">Documentation</p>
            <p className="label-mono text-muted-foreground">
              {DOC_ENTRIES.length} guides · {DOC_SECTIONS.length} sections
            </p>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            The manual for the box.
          </h1>
          <p className="mt-4 max-w-xl text-balance text-muted-foreground">
            How the platform behaves, which runtimes it offers, and what it commits to. The API
            contract lives in the{' '}
            <a href="/v1/openapi.yaml" className="text-brand underline-offset-4 hover:underline">
              OpenAPI document
            </a>
            .
          </p>
        </div>
      </header>

      {DOC_SECTIONS.map((section) => (
        <section key={section.title}>
          <SectionRule title={section.title} count={section.entries.length} />
          <p className="mt-2 text-sm text-muted-foreground">{section.blurb}</p>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {section.entries.map((entry) => (
              <li key={entry.slug}>
                <DocCard entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <SectionRule title="Beyond the guides" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a href="/v1/openapi.yaml" className={CARD}>
            <CardHairline />
            <span className="flex items-center gap-1.5 text-sm font-medium">
              API reference
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              The OpenAPI document is the contract — every operation, request shape, and error code
              the API answers with.
            </span>
          </a>
        </div>
      </section>
    </div>
  );
}
