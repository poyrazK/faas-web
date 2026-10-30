import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { SummaryRow } from './new-app-summary';

/** The page's heading row: the way back, the title and what the page is for. */
export function NewAppHeader({
  title,
  description,
  back,
}: {
  title: string;
  description: string;
  back: boolean;
}) {
  return (
    <header className="flex flex-col gap-3 lg:col-span-2">
      {back && (
        <Link
          to="/dashboard/apps"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          All apps
        </Link>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
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
      <h2 id="new-app-review" className="text-sm font-medium text-muted-foreground">
        Review
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
