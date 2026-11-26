import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight } from 'iconoir-react';
import {
  PUBLIC_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATES_DESCRIPTION,
  TEMPLATES_TITLE,
} from '@/lib/public-templates';
import { START_FREE_CTA } from '@/lib/platform-claims';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/templates/')({
  head: () => pageHead({ title: TEMPLATES_TITLE, description: TEMPLATES_DESCRIPTION }),
  component: TemplatesIndex,
});

function TemplatesIndex() {
  return (
    <>
      <header className="max-w-3xl">
        <p className="label-mono text-brand">Open-source starters &amp; integrations</p>
        <h1 className="mt-3 text-balance text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
          {TEMPLATES_TITLE}
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          {TEMPLATES_DESCRIPTION}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
          <Button asChild variant="cta" className="h-10 rounded-full px-5">
            <SweepLink to="/signup">{START_FREE_CTA}</SweepLink>
          </Button>
          <a
            href="https://github.com/gregale-dev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-brand underline-offset-4 hover:underline"
          >
            Browse github.com/gregale-dev
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
          <Link
            to="/features"
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Explore platform features
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </header>

      <div className="mt-14 space-y-14">
        {TEMPLATE_CATEGORIES.map((category) => {
          const items = PUBLIC_TEMPLATES.filter((t) => t.category === category);
          return (
            <section
              key={category}
              aria-labelledby={`cat-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            >
              <h2
                id={`cat-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                className="text-2xl font-medium tracking-tight sm:text-3xl"
              >
                {category}
              </h2>
              <ul className="mt-6 grid gap-5 sm:grid-cols-2">
                {items.map((item) => (
                  <li
                    key={item.slug}
                    className="flex h-full flex-col justify-between rounded-2xl border border-border p-6"
                  >
                    <div>
                      <p className="label-mono text-brand">{item.runtime}</p>
                      <div className="mt-2.5 flex items-start justify-between gap-3">
                        <h3 className="text-xl font-medium tracking-tight">{item.title}</h3>
                        <a
                          href={item.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${item.title} on GitHub`}
                          className="shrink-0 text-brand hover:opacity-80"
                        >
                          <ArrowUpRight aria-hidden="true" className="size-5" />
                        </a>
                      </div>
                      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                        {item.summary}
                      </p>
                      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
                        <code>{item.command}</code>
                      </pre>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3 text-xs">
                      <a
                        href={item.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline"
                      >
                        GitHub repository
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </a>
                      <Link
                        to="/docs/$slug"
                        params={{ slug: item.docSlug }}
                        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Docs
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
