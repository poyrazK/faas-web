import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { SOLUTIONS, SOLUTIONS_DESCRIPTION, SOLUTIONS_TITLE } from '@/lib/solutions';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/solutions/')({
  head: () => pageHead({ title: SOLUTIONS_TITLE, description: SOLUTIONS_DESCRIPTION }),
  component: SolutionsIndex,
});

function SolutionsIndex() {
  return (
    <>
      <header className="max-w-3xl">
        <p className="label-mono text-brand">Problems Gregale solves</p>
        <h1 className="mt-3 text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          {SOLUTIONS_TITLE}
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          {SOLUTIONS_DESCRIPTION}
        </p>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link
            to="/articles"
            className="inline-flex items-center gap-1.5 font-medium text-brand underline-offset-4 hover:underline"
          >
            Browse all articles by topic
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            to="/research"
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Read benchmarks &amp; research
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </header>
      <ul aria-label="Solutions" className="mt-12 grid gap-5 sm:grid-cols-2">
        {SOLUTIONS.map((solution) => (
          <li key={solution.slug}>
            <Link
              to="/solutions/$slug"
              params={{ slug: solution.slug }}
              className="group flex h-full flex-col justify-between rounded-2xl border border-border p-6 transition-colors hover:border-brand/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:p-8"
            >
              <div>
                <p className="label-mono text-brand">{solution.kicker}</p>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <h2 className="text-2xl font-medium tracking-tight">{solution.title}</h2>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0 text-brand transition-transform group-hover:translate-x-1"
                  />
                </div>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {solution.summary}
                </p>
              </div>
              <p className="mt-6 label-mono text-muted-foreground">
                {solution.articleSlugs.length} guides · {solution.docSlugs.length} docs
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
