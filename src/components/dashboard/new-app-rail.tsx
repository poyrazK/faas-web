import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { SummaryRow } from './new-app-summary';

/**
 * The page's heading row. With no rail, it names the current step and says
 * where it falls ("Step 2 of 3"), and it holds the one way back: to the apps
 * from the first page, or one step back from the others.
 */
export function NewAppHeader({
  step,
  title,
  description,
  back,
}: {
  step?: string;
  title: string;
  description?: string;
  back?: 'apps' | { label: string; onBack: () => void };
}) {
  const backClass =
    'group inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
  return (
    <header className="flex flex-col gap-4">
      {back === 'apps' ? (
        <Link to="/dashboard/apps" className={backClass}>
          <ArrowLeft aria-hidden className="h-4 w-4" />
          All apps
        </Link>
      ) : back ? (
        <button
          type="button"
          onClick={back.onBack}
          aria-label={`Back to ${back.label}`}
          className={backClass}
        >
          <ArrowLeft
            aria-hidden
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none"
          />
          {back.label}
        </button>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {step && <p className="text-xs font-medium text-muted-foreground">{step}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
    </header>
  );
}

/**
 * Review: what will be created, in the source list's language. Name and the
 * public URL lead, large; the rest follow one per row, label and value.
 */
export function NewAppReviewGrid({ rows }: { rows: SummaryRow[] }) {
  const hero = rows.filter((r) => r.key === 'name' || r.key === 'url');
  const rest = rows.filter((r) => r.key !== 'name' && r.key !== 'url');
  return (
    <section aria-labelledby="new-app-review" className="flex flex-col gap-3">
      {/* The page is titled Review; its card is the summary. */}
      <h2 id="new-app-review" className="text-sm font-medium text-muted-foreground">
        Summary
      </h2>
      {/* Two lists in one card: a dl takes only one wrapper level around each
          term, so the lead is a list of its own. */}
      <div className="@container flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {hero.length > 0 && (
          // Side by side when the URL fits, stacked when it does not, so a long
          // URL never breaks mid-word.
          <dl data-hero="" className="flex flex-wrap gap-x-12 gap-y-4 px-4 py-4">
            {hero.map((row) => (
              <div key={row.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
                <dd
                  className={cn(
                    'break-words text-base font-medium text-foreground',
                    row.mono && 'font-mono'
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <dl className="flex flex-col divide-y divide-border">
          {rest.map((row) => (
            <div
              key={row.key}
              className="grid gap-x-8 gap-y-1 px-4 py-3 @xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
            >
              <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
              <dd className={cn('break-words text-sm text-foreground', row.mono && 'font-mono')}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
