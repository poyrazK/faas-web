import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { Nav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { ANSWER_ARTICLES, alternativesArticle } from '@/lib/articles';
import { COMPARISONS_CHECKED, comparisons, type Comparison } from '@/lib/compare';
import { PLAN_CATALOG } from '@/lib/plan-catalog';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { pageHead } from '@/lib/seo';

const ALL = comparisons(PLAN_CATALOG);
const bySlug = (slug: string) => ALL.find((c) => c.slug === slug);

const CHECKED = new Date(`${COMPARISONS_CHECKED}T00:00:00Z`).toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * One page per competitor, from `src/lib/compare.ts`. Prerendered for each
 * slug in `COMPARISON_SLUGS`; an unknown slug is a 404, not an empty page.
 */
export const Route = createFileRoute('/vs/$slug')({
  loader: ({ params }) => {
    const comparison = bySlug(params.slug);
    if (!comparison) throw notFound();
    return comparison;
  },
  head: ({ params }) => {
    const comparison = bySlug(params.slug);
    return pageHead(
      comparison
        ? { title: `Gregale vs ${comparison.competitor}`, description: comparison.summary }
        : { title: 'Comparison not found' }
    );
  },
  component: ComparisonPage,
});

function ComparisonPage() {
  const comparison = Route.useLoaderData();
  const roundup = alternativesArticle(comparison.slug);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" className="mx-auto max-w-5xl px-4 pb-24 pt-36 sm:px-6 lg:pt-44">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">Compare</p>
        <h1 className="mt-6 text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          Gregale vs {comparison.competitor}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {comparison.summary}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Button asChild variant="cta" className="h-10 rounded-full px-5">
            <SweepLink to="/signup">{START_FREE_CTA}</SweepLink>
          </Button>
          <Button asChild variant="outline" className="h-10 rounded-full px-5">
            <Link to="/docs/$slug" params={{ slug: comparison.migrateDoc }}>
              {comparison.migrateLabel}
            </Link>
          </Button>
        </div>

        <ComparisonTable comparison={comparison} />

        <section aria-labelledby="fit-title" className="mt-16">
          <h2 id="fit-title" className="text-3xl font-medium tracking-tight">
            Which one fits
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <FitList title={`Choose ${comparison.competitor} when`} items={comparison.theyFit} />
            <FitList title="Choose Gregale when" items={comparison.gregaleFits} />
          </div>
        </section>

        <section aria-labelledby="faq-title" className="mt-16 border-t border-border pt-12">
          <h2 id="faq-title" className="text-3xl font-medium tracking-tight">
            Questions
          </h2>
          <dl className="mt-8 space-y-8">
            {comparison.faq.map((entry) => (
              <div key={entry.question}>
                <dt className="text-base font-medium text-foreground">{entry.question}</dt>
                <dd className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="articles-title" className="mt-16 border-t border-border pt-12">
          <h2 id="articles-title" className="text-3xl font-medium tracking-tight">
            How Gregale works
          </h2>
          <ul className="mt-6 space-y-4">
            {ANSWER_ARTICLES.map((article) => (
              <li key={article.slug} className="max-w-3xl">
                <Link
                  to="/articles/$slug"
                  params={{ slug: article.slug }}
                  className="text-base font-medium text-brand underline-offset-4 hover:underline"
                >
                  {article.title}
                </Link>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {article.summary}
                </p>
              </li>
            ))}
          </ul>
          {roundup && (
            <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Weighing more than two options?{' '}
              <Link
                to="/articles/$slug"
                params={{ slug: roundup.slug }}
                className="font-medium text-brand underline-offset-4 hover:underline"
              >
                {roundup.title}
              </Link>{' '}
              compares the main platforms people move to from {comparison.competitor}.
            </p>
          )}
        </section>

        <p className="mt-16 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {comparison.competitor} figures are from{' '}
          {comparison.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 && ' and '}
              <a
                href={source.url}
                rel="noopener noreferrer nofollow"
                target="_blank"
                className="underline underline-offset-4"
              >
                {source.label}
              </a>
            </span>
          ))}
          , checked {CHECKED}. Gregale figures are from{' '}
          <Link to="/pricing" className="underline underline-offset-4">
            current pricing
          </Link>
          . Prices are in US dollars before tax. {comparison.competitor} is a trademark of its
          owner; Gregale is not affiliated with it.
        </p>
      </main>
      <Footer />
    </div>
  );
}

function ComparisonTable({ comparison }: { comparison: Comparison }) {
  return (
    <div className="mt-14 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Gregale and {comparison.competitor} compared, topic by topic
        </caption>
        <thead className="bg-card">
          <tr>
            <th scope="col" className="w-40 px-4 py-3 font-medium text-muted-foreground">
              Topic
            </th>
            <th scope="col" className="px-4 py-3 font-medium text-foreground">
              Gregale
            </th>
            <th scope="col" className="px-4 py-3 font-medium text-foreground">
              {comparison.competitor}
            </th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.topic} className="border-t border-border align-top">
              <th scope="row" className="px-4 py-4 font-medium text-foreground">
                {row.topic}
              </th>
              <td className="px-4 py-4 leading-relaxed text-muted-foreground">{row.gregale}</td>
              <td className="px-4 py-4 leading-relaxed text-muted-foreground">{row.them}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FitList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
