import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { PageHeader } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { TEMPLATES } from '@/lib/templates';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/templates')({
  head: () => pageHead({ title: 'Templates' }),
  component: TemplatesPage,
});

/**
 * Deploy an example.
 *
 * Each card prefills the new-app wizard with a working configuration; the
 * scaffold and its deploy steps appear once the app exists. The fastest
 * honest path from empty account to a live URL — no fake one-click deploy
 * pretending the CLI step does not exist.
 */
function TemplatesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Templates"
        description="Working examples that follow the platform's function contract. Pick one, the wizard is prefilled, the scaffold arrives with the app."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => (
          // The console's plain card, on purpose: a template is a starting
          // point, not a hero — the quiet surface keeps the gallery scannable.
          <Link
            key={t.slug}
            to="/dashboard/workflows/new"
            search={{ template: t.slug }}
            className="group pressable flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-border-secondary"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold">{t.name}</h2>
              <Pill label={t.runtimeLabel} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t.tagline}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="font-mono text-xs text-muted-foreground">{t.filename}</span>
              <span className="inline-flex items-center gap-1 text-xs text-brand group-hover:text-brand-hover">
                Use template
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Every scaffold is the runtime contract verbatim — the same envelope the runtime docs
        describe — so it runs unmodified on its first deploy.
      </p>
    </div>
  );
}
