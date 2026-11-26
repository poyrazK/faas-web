import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'iconoir-react';
import { Markdown } from '@/components/docs/markdown';
import { ARTICLES, articleDate } from '@/lib/articles';
import { RESEARCH_PUBLICATIONS } from '@/lib/research';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { findSolution, SOLUTIONS_TITLE } from '@/lib/solutions';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/solutions/$slug')({
  loader: ({ params }) => {
    const solution = findSolution(params.slug);
    if (!solution) throw notFound();
    const articlesBySlug = new Map(ARTICLES.map((article) => [article.slug, article]));
    const researchBySlug = new Map(RESEARCH_PUBLICATIONS.map((pub) => [pub.slug, pub]));
    return {
      solution,
      articles: solution.articleSlugs
        .map((slug) => articlesBySlug.get(slug))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      research: (solution.researchSlugs ?? [])
        .map((slug) => researchBySlug.get(slug))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    };
  },
  head: ({ loaderData }) => {
    const solution = loaderData?.solution;
    return pageHead({ title: solution?.title, description: solution?.summary });
  },
  component: SolutionPage,
});

function SolutionPage() {
  const { solution, articles, research } = Route.useLoaderData();
  const primaryDoc = solution.docSlugs[0];

  return (
    <article className="max-w-4xl">
      <header className="border-b border-border pb-8">
        <Link
          to="/solutions"
          className="inline-flex items-center gap-2 text-sm text-brand underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {SOLUTIONS_TITLE}
        </Link>
        <p className="label-mono mt-6 text-brand">{solution.kicker}</p>
        <h1 className="mt-2 text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          {solution.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {solution.summary}
        </p>
        <div className="mt-5 text-sm text-muted-foreground">
          Updated <time dateTime={solution.updatedOn}>{articleDate(solution.updatedOn)}</time>
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

      <section aria-labelledby="pain-points-title" className="mt-10">
        <h2 id="pain-points-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          What breaks vs. how Gregale solves it
        </h2>
        <p className="mt-3 text-pretty text-muted-foreground">{solution.problemStatement}</p>
        <div className="mt-6 grid gap-4">
          {solution.painPoints.map((point) => (
            <div
              key={point.before}
              className="grid gap-4 rounded-2xl border border-border p-5 sm:grid-cols-2 sm:p-6"
            >
              <div>
                <p className="label-mono text-muted-foreground">Problem without Gregale</p>
                <p className="mt-2 text-sm leading-relaxed sm:text-base">{point.before}</p>
              </div>
              <div className="border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <p className="label-mono text-brand">How Gregale solves it</p>
                <p className="mt-2 text-sm leading-relaxed sm:text-base">{point.withGregale}</p>
              </div>
            </div>
          ))}
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

      <section aria-labelledby="docs-title" className="mt-12 border-t border-border pt-10">
        <h2 id="docs-title" className="text-2xl font-medium tracking-tight sm:text-3xl">
          Documentation references
        </h2>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {solution.docSlugs.map((doc) => (
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
          {solution.faq.map((entry) => (
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
