import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { CopyIconButton } from '@/components/ui/copy-button';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useTemplates, type TemplateView } from '@/lib/api/queries';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/templates')({
  head: () => pageHead({ title: 'Templates' }),
  component: TemplatesPage,
});

/**
 * The starter catalog, from `GET /v1/templates` — the same 13-entry list the
 * CLI's `init --template` and `deploy --template` validate against, so a name
 * here is a name the CLI accepts.
 *
 * A card prefills the new-app wizard with the template's name; the scaffold
 * itself is written by the CLI (`gregale init --template NAME`), which the
 * wizard shows once the app exists. No fake one-click deploy pretending the
 * CLI step does not exist, and no hand-kept copy of the catalog to drift.
 */

const CATEGORY: Record<TemplateView['category'], { label: string; blurb: string }> = {
  hello: { label: 'Hello', blurb: 'First-touch smoke tests: the smallest server per runtime.' },
  function: { label: 'Functions', blurb: 'The function contract per runtime, ready to extend.' },
  'stateless-contract': {
    label: 'Stateless services',
    blurb: 'Workers, receivers and APIs that keep their state in the platform, not the instance.',
  },
  ai: { label: 'AI', blurb: 'Model-backed apps with the platform doing the scaling.' },
};

const CATEGORY_ORDER: TemplateView['category'][] = [
  'hello',
  'function',
  'stateless-contract',
  'ai',
];

function TemplatesPage() {
  const templates = useTemplates();
  const list = templates.data ?? [];
  const phase = queryPhase({
    error: templates.error,
    loading: templates.isPending,
    isEmpty: list.length === 0,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Templates"
        description="Starters the CLI can write for you. Pick one, the wizard is prefilled, the scaffold arrives with `gregale init`."
      />

      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={templates.error}
          loadingMessage="Loading the catalog…"
          emptyMessage="The catalog is empty on this deployment."
        />
      ) : (
        CATEGORY_ORDER.filter((c) => list.some((t) => t.category === c)).map((category) => (
          <section key={category} className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold">{CATEGORY[category].label}</h2>
              <p className="text-xs text-muted-foreground">{CATEGORY[category].blurb}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list
                .filter((t) => t.category === category)
                .map((t) => (
                  <article
                    key={t.name}
                    className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-border-secondary"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-mono text-sm font-semibold">{t.name}</h3>
                      <Pill label={CATEGORY[t.category].label} />
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{t.description}</p>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                      <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        gregale init --template {t.name}
                        <CopyIconButton
                          text={`gregale init --template ${t.name}`}
                          label={`gregale init --template ${t.name}`}
                        />
                      </span>
                      <Link
                        to="/dashboard/workflows/new"
                        search={{ template: t.name }}
                        className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
                      >
                        Use template
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        The catalog is served by the API from the same source the CLI embeds, so every name here is
        one `gregale init --template` accepts.
      </p>
    </div>
  );
}
