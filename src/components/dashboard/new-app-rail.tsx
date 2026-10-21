import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { SummaryRow } from './new-app-summary';

const STEPS = ['Source', 'Configure', 'Review'] as const;

function Item({ row }: { row: SummaryRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
      <dd className={cn('break-words text-[13px] text-foreground', row.mono && 'font-mono')}>
        {row.value}
      </dd>
    </div>
  );
}

/**
 * The New app rail: where you are and what you are making. Sticky beside the
 * step on wide screens, stacked above it on narrow ones. Its summary fills in
 * as the person goes; Review shows the same rows in full, so the wizard passes
 * an empty list there and the rail shows only the steps.
 */
export function NewAppRail({
  title,
  description,
  back,
  step,
  rows,
}: {
  title: string;
  description: string;
  back: boolean;
  step?: 0 | 1 | 2;
  rows: SummaryRow[];
}) {
  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-20">
      <div className="flex flex-col gap-3">
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
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {step !== undefined && (
        <ol aria-label="App creation steps" className="flex flex-col gap-1 border-l border-border">
          {STEPS.map((label, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'upcoming';
            return (
              <li
                key={label}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  '-ml-px flex items-center gap-3 border-l py-1.5 pl-4 text-sm transition-colors',
                  state === 'current'
                    ? 'border-brand text-foreground'
                    : 'border-transparent text-muted-foreground'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-5 font-mono text-[11px]',
                    state === 'current' ? 'text-brand' : 'text-muted-foreground'
                  )}
                >
                  {state === 'done' ? (
                    <Check className="h-3.5 w-3.5 text-[color:var(--status-good)]" />
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            What you'll get
          </p>
          <dl className="flex flex-col gap-3">
            {rows.map((row) => (
              <Item key={row.key} row={row} />
            ))}
          </dl>
        </div>
      )}
    </aside>
  );
}

/**
 * Review: the summary at full size, on the bento's hairline grid. Name and
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
    <dl className="grid gap-px border border-border bg-border sm:grid-cols-2">
      {hero.length > 0 && (
        <div className="grid gap-px bg-border sm:col-span-2 sm:grid-cols-2">
          {hero.map((row) => (
            <div key={row.key} className="flex min-w-0 flex-col gap-1 bg-card p-5">
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
        </div>
      )}
      {rest.map((row, i) => cell(row, i === rest.length - 1 && rest.length % 2 === 1))}
    </dl>
  );
}
