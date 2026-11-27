import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { FEATURES, FEATURES_DESCRIPTION, FEATURES_TITLE } from '@/lib/features';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { pageHead } from '@/lib/seo';
import { metaDescriptionFor } from '@/lib/meta-descriptions';

export const Route = createFileRoute('/features/')({
  head: () =>
    pageHead({
      title: FEATURES_TITLE,
      description: metaDescriptionFor('/features', FEATURES_DESCRIPTION),
    }),
  component: FeaturesIndex,
});

function FeaturesIndex() {
  return (
    <>
      <header className="max-w-3xl">
        <p className="label-mono text-brand">Platform capabilities</p>
        <h1 className="mt-3 text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          {FEATURES_TITLE}
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          {FEATURES_DESCRIPTION}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
          <Button asChild variant="cta" className="h-10 rounded-full px-5">
            <SweepLink to="/signup">{START_FREE_CTA}</SweepLink>
          </Button>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-1.5 font-medium text-brand underline-offset-4 hover:underline"
          >
            See plans &amp; pricing
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            to="/will-it-run"
            search={{ source: undefined, ref: undefined }}
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Check compatibility
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            to="/research"
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Benchmarks &amp; research
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </header>
      <ul aria-label="Features" className="mt-12 grid gap-5 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <li key={feature.slug}>
            <Link
              to="/features/$slug"
              params={{ slug: feature.slug }}
              className="group flex h-full flex-col justify-between rounded-2xl border border-border p-6 transition-colors hover:border-brand/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:p-8"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="label-mono text-brand">{feature.category}</p>
                  <span className="label-mono rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {feature.maturity}
                  </span>
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <h2 className="text-2xl font-medium tracking-tight">{feature.title}</h2>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0 text-brand transition-transform group-hover:translate-x-1"
                  />
                </div>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {feature.summary}
                </p>
              </div>
              <p className="label-mono mt-6 text-muted-foreground">
                {feature.plans} · {feature.docSlugs.length} docs · {feature.articleSlugs.length}{' '}
                guides
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
