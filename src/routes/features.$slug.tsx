import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'iconoir-react';
import { Markdown } from '@/components/docs/markdown';
import { ARTICLES, articleDate } from '@/lib/articles';
import { findFeature, FEATURES_TITLE } from '@/lib/features';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { RESEARCH_PUBLICATIONS } from '@/lib/research';
import { templatesForFeature } from '@/lib/public-templates';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/features/$slug')({
  loader: ({ params }) => {
    const feature = findFeature(params.slug);
    if (!feature) throw notFound();
    const articlesBySlug = new Map(ARTICLES.map((article) => [article.slug, article]));
    const researchBySlug = new Map(RESEARCH_PUBLICATIONS.map((pub) => [pub.slug, pub]));
    return {
      feature,
      articles: feature.articleSlugs
        .map((slug) => articlesBySlug.get(slug))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      research: (feature.researchSlugs ?? [])
        .map((slug) => researchBySlug.get(slug))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    };
  },
  head: ({ loaderData }) => {
    const feature = loaderData?.feature;
    return pageHead({ title: feature?.title, description: feature?.summary });
  },
  component: FeaturePage,
});

function FeaturePage() {
  const { feature, articles, research } = Route.useLoaderData();
  const primaryDoc = feature.docSlugs[0];
  const starters = templatesForFeature(feature.slug);
  const codeBlock = `\`\`\`${feature.codeLanguage}\n${feature.codeSnippet}\n\`\`\``;

  return (
    <article className="max-w-4xl">
      <header className="border-b border-border pb-8">
        <Link
          to="/features"
          className="inline-flex items-center gap-2 text-sm text-brand underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {FEATURES_TITLE}
        </Link>
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <p className="label-mono text-brand">{feature.category}</p>
          <span className="label-mono rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
            {feature.maturity}
          </span>
          <span className="label-mono rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
            {feature.plans}
          </span>
        </div>
        <h1 className="mt-3 text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          {feature.headline}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {feature.summary}
        </p>
        <div className="mt-5 text-sm text-muted-foreground">
          Updated <time dateTime={feature.updatedOn}>{articleDate(feature.updatedOn)}</time>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild variant="cta" className="h-10 rounded-full px-5">
            <SweepLink to="/signup">{START_FREE_CTA}</SweepLink>
          </Button>
          {primaryDoc && (
            <Link
              to="/docs/$slug"
              params={{ slug: primaryDoc.slug }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
            >
              Read {primaryDoc.label} docs
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          )}
        </div>
      </header>

      <section aria-labelledby="overview-title" className="mt-10">
        <h2 id="overview-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          {feature.codeTitle}
        </h2>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{feature.overview}</p>
        <div className="mt-5">
          <Markdown source={codeBlock} />
        </div>
      </section>

      <section aria-labelledby="highlights-title" className="mt-12 border-t border-border pt-10">
        <h2 id="highlights-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          Key capabilities
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {feature.highlights.map((item) => (
            <div key={item.title} className="rounded-2xl border border-border p-5 sm:p-6">
              <h3 className="text-lg font-medium tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="comparison-title" className="mt-12 border-t border-border pt-10">
        <h2 id="comparison-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          Typical PaaS vs. Gregale
        </h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm sm:text-base">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3.5 font-medium">Capability</th>
                <th className="px-5 py-3.5 font-medium text-muted-foreground">Typical PaaS</th>
                <th className="px-5 py-3.5 font-medium text-brand">Gregale</th>
              </tr>
            </thead>
            <tbody>
              {feature.comparison.map((row) => (
                <tr key={row.capability} className="border-b border-border last:border-b-0">
                  <td className="px-5 py-4 font-medium">{row.capability}</td>
                  <td className="px-5 py-4 text-muted-foreground">{row.typicalPaas}</td>
                  <td className="px-5 py-4">{row.gregale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="guides-title" className="mt-12 border-t border-border pt-10">
        <h2 id="guides-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          Deep-dive guides ({articles.length})
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {articles.map((article) => (
            <li key={article.slug}>
              <Link
                to="/articles/$slug"
                params={{ slug: article.slug }}
                className="group flex h-full flex-col justify-between rounded-2xl border border-border p-5 transition-colors hover:border-brand/60"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-medium tracking-tight">{article.title}</h3>
                    <ArrowRight
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-brand transition-transform group-hover:translate-x-1"
                    />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {article.summary}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {research.length > 0 && (
        <section aria-labelledby="research-title" className="mt-12 border-t border-border pt-10">
          <h2 id="research-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
            Related benchmarks &amp; studies
          </h2>
          <ul className="mt-6 grid gap-4">
            {research.map((item) => (
              <li key={item.slug}>
                <Link
                  to="/research/$slug"
                  params={{ slug: item.slug }}
                  className="group block rounded-2xl border border-border p-5 transition-colors hover:border-brand/60"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-lg font-medium tracking-tight">{item.title}</h3>
                    <ArrowRight
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-brand transition-transform group-hover:translate-x-1"
                    />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {starters.length > 0 && (
        <section aria-labelledby="starters-title" className="mt-12 border-t border-border pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="starters-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
              Runnable starters &amp; integrations ({starters.length})
            </h2>
            <Link
              to="/templates"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              Browse all templates
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {starters.map((starter) => (
              <li key={starter.slug}>
                <a
                  href={starter.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full flex-col justify-between rounded-2xl border border-border p-5 transition-colors hover:border-brand/60"
                >
                  <div>
                    <p className="label-mono text-brand">{starter.runtime}</p>
                    <div className="mt-2 flex items-start justify-between gap-3">
                      <h3 className="text-lg font-medium tracking-tight">{starter.title}</h3>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="mt-1 size-4 shrink-0 text-brand"
                      />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {starter.summary}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="docs-title" className="mt-12 border-t border-border pt-10">
        <h2 id="docs-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          Documentation references
        </h2>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {feature.docSlugs.map((doc) => (
            <Link
              key={doc.slug}
              to="/docs/$slug"
              params={{ slug: doc.slug }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-brand/60 hover:text-brand"
            >
              {doc.label}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mt-12 border-t border-border pt-10">
        <h2 id="faq-title" className="text-3xl font-medium tracking-tight">
          Questions
        </h2>
        <dl className="mt-6 grid gap-6">
          {feature.faq.map((entry) => (
            <div key={entry.question}>
              <dt className="text-lg font-medium">{entry.question}</dt>
              <dd className="mt-1">
                <Markdown source={entry.answer} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}
