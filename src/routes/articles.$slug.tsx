import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft } from 'iconoir-react';
import { Markdown } from '@/components/docs/markdown';
import { ARTICLES, ARTICLES_TITLE, articleDate } from '@/lib/articles';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { pageHead } from '@/lib/seo';

const bodies = import.meta.glob<string>('../../content/articles/*.md', {
  query: '?raw',
  import: 'default',
});

export const Route = createFileRoute('/articles/$slug')({
  loader: async ({ params }) => {
    const article = ARTICLES.find((entry) => entry.slug === params.slug);
    const load = bodies[`../../content/articles/${params.slug}.md`];
    if (!article || !load) throw notFound();
    return { article, body: await load() };
  },
  head: ({ loaderData }) => {
    const article = loaderData?.article;
    return pageHead({ title: article?.title, description: article?.summary });
  },
  component: ArticlePage,
});

function ArticlePage() {
  const { article, body } = Route.useLoaderData();
  return (
    <article className="max-w-3xl">
      <header className="border-b border-border pb-8">
        <Link
          to="/articles"
          className="inline-flex items-center gap-2 text-sm text-brand underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {ARTICLES_TITLE}
        </Link>
        <h1 className="mt-6 text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          {article.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {article.summary}
        </p>
        <div className="mt-5 text-sm text-muted-foreground">
          Updated <time dateTime={article.updatedOn}>{articleDate(article.updatedOn)}</time>
        </div>
      </header>
      {/* Comparison tables scroll on a phone rather than wrap a word per line,
          like the table on the /vs pages. */}
      <div className="[&_table]:min-w-[36rem]">
        <Markdown source={body} />
      </div>
      <section aria-labelledby="faq-title" className="mt-12 border-t border-border pt-10">
        <h2 id="faq-title" className="text-3xl font-medium tracking-tight">
          Questions
        </h2>
        <dl className="mt-6 grid gap-6">
          {article.faq.map((entry) => (
            <div key={entry.question}>
              <dt className="text-lg font-medium">{entry.question}</dt>
              <dd className="mt-1">
                <Markdown source={entry.answer} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="mt-12">
        <Button asChild variant="cta" className="h-10 rounded-full px-5">
          <SweepLink to="/signup">{START_FREE_CTA}</SweepLink>
        </Button>
      </div>
    </article>
  );
}
