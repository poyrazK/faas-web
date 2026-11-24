import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { ARTICLES, ARTICLES_DESCRIPTION, ARTICLES_TITLE, articleDate } from '@/lib/articles';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/articles/')({
  head: () => pageHead({ title: ARTICLES_TITLE, description: ARTICLES_DESCRIPTION }),
  component: ArticlesIndex,
});

function ArticlesIndex() {
  return (
    <>
      <header className="max-w-2xl">
        <h1 className="text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          {ARTICLES_TITLE}
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          {ARTICLES_DESCRIPTION}
        </p>
      </header>
      <ul aria-label="Articles" className="mt-12 grid max-w-3xl gap-4">
        {ARTICLES.map((article) => (
          <li key={article.slug}>
            <Link
              to="/articles/$slug"
              params={{ slug: article.slug }}
              className="group block rounded-2xl border border-border p-5 transition-colors hover:border-brand/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:p-8"
            >
              <time dateTime={article.updatedOn} className="label-mono text-muted-foreground">
                {articleDate(article.updatedOn)}
              </time>
              <div className="mt-3 flex items-start justify-between gap-4">
                <h2 className="text-2xl font-medium tracking-tight">{article.title}</h2>
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
    </>
  );
}
