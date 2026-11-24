import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft } from 'iconoir-react';
import { Markdown } from '@/components/docs/markdown';
import { RESEARCH_PUBLICATIONS, RESEARCH_TITLE, researchDate } from '@/lib/research';
import { pageHead } from '@/lib/seo';

const reports = import.meta.glob<string>('../../content/research/*.md', {
  query: '?raw',
  import: 'default',
});

export const Route = createFileRoute('/research/$slug')({
  loader: async ({ params }) => {
    const publication = RESEARCH_PUBLICATIONS.find((entry) => entry.slug === params.slug);
    const load = reports[`../../content/research/${params.slug}.md`];
    if (!publication || !load) throw notFound();
    return { publication, report: await load() };
  },
  head: ({ loaderData }) => {
    const publication = loaderData?.publication;
    return pageHead({ title: publication?.title, description: publication?.summary });
  },
  component: ResearchReport,
});

function ResearchReport() {
  const { publication, report } = Route.useLoaderData();
  return (
    <article className="max-w-3xl">
      <header className="border-b border-border pb-8">
        <Link
          to="/research"
          className="inline-flex items-center gap-2 text-sm text-brand underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {RESEARCH_TITLE}
        </Link>
        <h1 className="mt-6 text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          {publication.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {publication.summary}
        </p>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span>Gregale Engineering</span>
          <span>
            Published{' '}
            <time dateTime={publication.publishedOn}>{researchDate(publication.publishedOn)}</time>
          </span>
          <span>
            Measured{' '}
            <time dateTime={publication.measuredOn}>{researchDate(publication.measuredOn)}</time>
          </span>
        </div>
      </header>
      <Markdown source={report} />
    </article>
  );
}
