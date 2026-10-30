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
 * Review: the summary at full size, on a hairline grid. Name and
 * the public URL lead as the hero cell; the rest follow two to a row.
 */
export function NewAppReviewGrid({ rows }: { rows: SummaryRow[] }) {
  const hero = rows.filter((r) => r.key === 'name' || r.key === 'url');
  const rest = rows.filter((r) => r.key !== 'name' && r.key !== 'url');
  const cell = (row: SummaryRow, wide: boolean) => (
    <div
      key={row.key}
      className={cn('flex min-w-0 flex-col gap-1 bg-card p-4', wide && 'sm:col-span-2')}
    >
      <dt className="text-xs text-muted-foreground">{row.label}</dt>
      <dd className={cn('break-words text-sm text-foreground', row.mono && 'font-mono')}>
        {row.value}
      </dd>
    </div>
  );
  return (
    <>
      <h2 className="mb-3 text-base font-medium">Review</h2>
      {/* Two lists in one hairline grid: a dl takes only one wrapper level
          around each term, so the hero is a list of its own. */}
      <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
        {hero.length > 0 && (
          // One wide cell: side by side when the URL fits, stacked when it does
          // not, so a long URL never breaks mid-word in a half-width column.
          <dl data-hero="" className="flex flex-wrap gap-x-12 gap-y-4 bg-card p-5 sm:col-span-2">
            {hero.map((row) => (
              <div key={row.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
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
        <dl className="contents">
          {rest.map((row, i) => cell(row, i === rest.length - 1 && rest.length % 2 === 1))}
        </dl>
      </div>
    </>
  );
}
