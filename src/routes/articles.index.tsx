import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import {
  ARTICLES,
  ARTICLES_DESCRIPTION,
  ARTICLES_TITLE,
  articleDate,
  groupedArticles,
} from '@/lib/articles';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/articles/')({
  head: () => pageHead({ title: ARTICLES_TITLE, description: ARTICLES_DESCRIPTION }),
  component: ArticlesIndex,
});

function ArticlesIndex() {
  const topics = groupedArticles();

  return (
    <>
      <header className="max-w-3xl">
        <h1 className="text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          {ARTICLES_TITLE}
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          {ARTICLES_DESCRIPTION}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Looking for an overview by pain point?{' '}
          <Link
            to="/solutions"
            className="inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline"
          >
            Browse Solutions
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </p>
      </header>

      <nav aria-label="Article topics" className="mt-10 flex flex-wrap gap-2">
        {topics.map((topic) => (
          <a
            key={topic.id}
            href={`#${topic.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
          >
            <span>{topic.title}</span>
            <span className="label-mono text-xs text-brand">({topic.articles.length})</span>
          </a>
        ))}
      </nav>

      <p className="label-mono mt-6 text-muted-foreground">
        {ARTICLES.length} articles across {topics.length} topics
      </p>

      <div className="mt-10 grid gap-14">
        {topics.map((topic) => (
          <section
            key={topic.id}
            id={topic.id}
            aria-labelledby={`${topic.id}-heading`}
            className="scroll-mt-28 border-t border-border pt-10 first:border-t-0 first:pt-0"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <h2
                  id={`${topic.id}-heading`}
                  className="text-2xl font-medium tracking-tight sm:text-3xl"
                >
                  {topic.title}
                </h2>
                <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {topic.description}
                </p>
              </div>
              {topic.solutionSlug && (
                <Link
                  to="/solutions/$slug"
                  params={{ slug: topic.solutionSlug }}
                  className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
                >
                  Solution overview
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              )}
            </div>

            <ul aria-label={topic.title} className="mt-6 grid max-w-3xl gap-4">
              {topic.articles.map((article) => (
                <li key={article.slug}>
                  <Link
                    to="/articles/$slug"
                    params={{ slug: article.slug }}
                    className="group block rounded-2xl border border-border p-5 transition-colors hover:border-brand/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:p-7"
                  >
                    <time dateTime={article.updatedOn} className="label-mono text-muted-foreground">
                      {articleDate(article.updatedOn)}
                    </time>
                    <div className="mt-3 flex items-start justify-between gap-4">
                      <h3 className="text-xl font-medium tracking-tight sm:text-2xl">
                        {article.title}
                      </h3>
                      <ArrowRight
                        aria-hidden="true"
                        className="mt-1 size-5 shrink-0 text-brand transition-transform group-hover:translate-x-1"
                      />
                    </div>
                    <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {article.summary}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
