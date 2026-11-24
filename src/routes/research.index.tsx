import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import {
  RESEARCH_DESCRIPTION,
  RESEARCH_PUBLICATIONS,
  RESEARCH_TITLE,
  researchDate,
} from '@/lib/research';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/research/')({
  head: () => pageHead({ title: RESEARCH_TITLE, description: RESEARCH_DESCRIPTION }),
  component: ResearchIndex,
});

function ResearchIndex() {
  return (
    <>
      <header className="max-w-2xl">
        <h1 className="text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          {RESEARCH_TITLE}
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          {RESEARCH_DESCRIPTION}
        </p>
      </header>
      <ul aria-label="Publications" className="mt-12 grid max-w-3xl gap-4">
        {RESEARCH_PUBLICATIONS.map((publication) => (
          <li key={publication.slug}>
            <Link
              to="/research/$slug"
              params={{ slug: publication.slug }}
              className="group block rounded-2xl border border-border p-5 transition-colors hover:border-brand/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:p-8"
            >
              <time dateTime={publication.publishedOn} className="label-mono text-muted-foreground">
                {researchDate(publication.publishedOn)}
              </time>
              <div className="mt-3 flex items-start justify-between gap-4">
                <h2 className="text-2xl font-medium tracking-tight">{publication.title}</h2>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-1 size-5 shrink-0 text-brand transition-transform group-hover:translate-x-1"
                />
              </div>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                {publication.summary}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
