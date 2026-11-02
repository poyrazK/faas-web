import { createContext, useContext, type ReactNode } from 'react';
import {
  WarningTriangle,
  CheckCircle,
  Circle,
  CloudXmark,
  RefreshDouble,
  GraphDown,
  GraphUp,
} from 'iconoir-react';
import type { LogLevel, RunState } from '@/lib/mock-data';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { SegmentedControl } from './tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline, type ChartColor } from './kit/chart';
import { HelpTip } from './kit/help-tip';
import { cn } from '@/lib/utils';
import { ProblemHelp } from './problem-help';

/* ------------------------------------------------------------------ *
 * Status — color is always paired with an icon and a text label, so state
 * never rests on hue alone.
 * ------------------------------------------------------------------ */

const STATE_CONFIG: Record<RunState, { label: string; color: string; icon: typeof CheckCircle }> = {
  running: { label: 'Running', color: 'var(--status-good)', icon: CheckCircle },
  idle: { label: 'Idle', color: 'var(--chart-muted)', icon: Circle },
  error: { label: 'Error', color: 'var(--status-critical)', icon: WarningTriangle },
  deploying: { label: 'Deploying', color: 'var(--status-warning)', icon: RefreshDouble },
  undeployed: { label: 'Undeployed', color: 'var(--chart-muted)', icon: Circle },
};

export function StateBadge({ state, className }: { state: RunState; className?: string }) {
  const cfg = STATE_CONFIG[state];
  const Icon = cfg.icon;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium', className)}
      style={{ color: cfg.color }}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'h-3 w-3 shrink-0',
          state === 'deploying' && 'animate-spin motion-reduce:animate-none'
        )}
      />
      {cfg.label}
    </span>
  );
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'var(--chart-muted)',
  debug: 'var(--chart-muted)',
  warn: 'var(--status-warning)',
  error: 'var(--status-critical)',
};

export function LevelTag({ level }: { level: LogLevel }) {
  return (
    <span
      className="label-mono inline-flex w-14 shrink-0 items-center gap-1"
      style={{ color: LEVEL_COLOR[level] }}
    >
      {level === 'error' && <WarningTriangle className="h-3 w-3" />}
      {level}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Stats — headline numbers. One strip of cells divided by hairlines, not a
 * grid of separate cards: a row of figures reads as one set.
 * ------------------------------------------------------------------ */

const InStats = createContext(false);

/**
 * True inside an unpadded `Panel`: content there runs to the panel's edges,
 * so a table drops its own frame instead of drawing a box inside a box.
 */
export const FlushContext = createContext(false);

/**
 * A strip of `StatTile`s. Cells wrap on narrow screens and the hairlines
 * follow, because the dividers are the strip's own background showing
 * through a 1px gap.
 */
export function Stats({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  /** Cells per row on wide screens. */
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  // Inside an unpadded panel the panel is the frame; a second border would
  // be a box inside a box.
  const flush = useContext(FlushContext);
  return (
    <InStats.Provider value>
      <div
        className={cn(
          'grid grid-cols-2 gap-px overflow-hidden bg-border',
          !flush && 'rounded-lg border border-border',
          {
            2: 'sm:grid-cols-2',
            3: 'sm:grid-cols-3',
            4: 'sm:grid-cols-2 lg:grid-cols-4',
            5: 'sm:grid-cols-3 lg:grid-cols-5',
            6: 'sm:grid-cols-3 lg:grid-cols-6',
          }[columns],
          className
        )}
      >
        {children}
      </div>
    </InStats.Provider>
  );
}

/** One headline figure, with an optional context line, delta and trend. */
export function StatTile({
  label,
  value,
  format,
  state = 'ready',
  unit,
  note,
  delta,
  deltaGood = true,
  series,
  tone = 'green',
}: {
  label: string;
  /** A number is formatted with `format` (or the locale); a string renders as-is. */
  value?: string | number;
  /** Turns a numeric `value` into text. Ignored for string values. */
  format?: (v: number) => string;
  /**
   * Whether the figure is known.
   *
   * A tile fed straight from a query renders `0` for a failed read, which is a
   * number the server never confirmed — the one thing a console must not do.
   * `unavailable` says so instead, and `loading` holds the space.
   */
  state?: 'ready' | 'loading' | 'unavailable';
  unit?: string;
  /** A second scalar for context — "of 2,000 included". Never a computed
   *  trend: the API returns points, not series. */
  note?: string;
  delta?: number;
  /** Whether a rising delta is a good thing (invocations) or bad (errors). */
  deltaGood?: boolean;
  series?: number[];
  /** Colour of the trend line only — the value itself never rests on hue. */
  tone?: ChartColor;
}) {
  const inStats = useContext(InStats);
  const positive = (delta ?? 0) >= 0;
  const good = positive === deltaGood;
  const Arrow = positive ? GraphUp : GraphDown;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 bg-card px-4 py-3',
        !inStats && 'rounded-lg border border-border'
      )}
    >
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <div className="flex items-end justify-between gap-3">
        {state === 'loading' ? (
          <Skeleton className="h-7 w-16" />
        ) : state === 'unavailable' ? (
          <p
            className="text-xl leading-7 font-semibold text-muted-foreground"
            title="The API did not answer, so this figure is unknown."
          >
            —<span className="sr-only">unavailable</span>
          </p>
        ) : (
          <p className="truncate text-xl leading-7 font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
            {typeof value === 'number' ? (format ? format(value) : value.toLocaleString()) : value}
            {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
          </p>
        )}
        {state === 'ready' && series && series.length > 1 && (
          <Sparkline data={series} color={tone} className="mb-1 h-6 w-16 shrink-0" />
        )}
      </div>
      {state === 'ready' && delta !== undefined && (
        <p
          className="flex items-center gap-1 text-xs [font-variant-numeric:tabular-nums]"
          style={{ color: good ? 'var(--status-good)' : 'var(--status-critical)' }}
        >
          <Arrow aria-hidden="true" className="h-3 w-3" />
          {positive ? '+' : ''}
          {delta.toFixed(1)}%<span className="text-muted-foreground">vs prev period</span>
        </p>
      )}
      {state === 'ready' && note && (
        <p className="truncate text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          {note}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Layout helpers
 * ------------------------------------------------------------------ */

export function PageHeader({
  title,
  help,
  meta,
  actions,
}: {
  title: string;
  /** Explanation behind a "?" beside the title, for whoever needs it. A page
   *  has no subtitle. */
  help?: ReactNode;
  /** Inline facts after the title: a status, a count. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {help && <HelpTip label={`About ${title}`}>{help}</HelpTip>}
          </div>
          {meta}
        </div>
      </div>
      {actions && (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function Panel({
  title,
  help,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: string;
  /** Explanation behind a "?" beside the title, for whoever needs it. A
   *  panel has a title and no description. */
  help?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Off for content that runs to the panel's edges — a list or a table whose
   *  own rows carry the padding and whose dividers should span the full width. */
  padded?: boolean;
}) {
  return (
    <section
      className={cn('relative overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">{title}</h2>
                {help && <HelpTip label={`About ${title}`}>{help}</HelpTip>}
              </div>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <FlushContext.Provider value={!padded}>
        <div className={cn(padded && 'p-4')}>{children}</div>
      </FlushContext.Provider>
    </section>
  );
}

/** Segmented time-range control — filters sit in one row above the charts. */
export function RangeSelector<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      label="Time range"
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Read states
 * ------------------------------------------------------------------ */

/**
 * The four ways a networked panel can be, in the order they must be checked.
 *
 * Precedence lives here and nowhere else: a failed read is not an empty list,
 * and neither is a read still in flight. Collapsing them is how a broken
 * console ends up looking like a working one with no data.
 *
 * **Never pass `loading` for a disabled query.** TanStack reports `isPending`
 * for a query that is gated off and has therefore never run, so a page that
 * forwards it renders a spinner nothing will ever resolve — which is exactly
 * what the per-app pages did before `AppScope` gated them on having an app.
 */
export type QueryPhase = 'unreachable' | 'error' | 'loading' | 'empty' | 'ready';

export function queryPhase({
  error,
  loading,
  isEmpty,
}: {
  error?: unknown;
  loading?: boolean;
  isEmpty?: boolean;
}): QueryPhase {
  if (error) return error instanceof ApiError && error.isUnreachable ? 'unreachable' : 'error';
  if (loading) return 'loading';
  return isEmpty ? 'empty' : 'ready';
}

export { Skeleton } from '@/components/ui/skeleton';

/**
 * Compact one-line rendering of the read phases, for modals and panel
 * corners where the full dashed-box states would shout. Same precedence as
 * `queryPhase` — including the unreachable/error distinction the bespoke
 * `<p>Loading…</p>` lines it replaces always dropped. Renders nothing for
 * `ready`; renders `emptyMessage` (if given) for `empty`.
 */
export function InlinePhase({
  phase,
  error,
  loadingMessage = 'Loading…',
  emptyMessage,
  onRetry,
}: {
  phase: QueryPhase;
  error?: unknown;
  loadingMessage?: string;
  emptyMessage?: string;
  onRetry?: () => void;
}) {
  const retry = onRetry && (
    <button
      type="button"
      onClick={onRetry}
      className="shrink-0 text-xs text-brand underline underline-offset-4"
    >
      Try again
    </button>
  );
  if (phase === 'unreachable') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <CloudXmark className="h-3.5 w-3.5 shrink-0" />
        Could not reach the API.
        {retry}
      </p>
    );
  }
  if (phase === 'error') {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm">
        <WarningTriangle
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          style={{ color: 'var(--status-critical)' }}
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span style={{ color: 'var(--status-critical)' }}>{errorMessage(error)}</span>
          <ProblemHelp error={error} />
        </span>
        {retry}
      </p>
    );
  }
  if (phase === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshDouble className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        {loadingMessage}
      </p>
    );
  }
  if (phase === 'empty' && emptyMessage) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return null;
}

export function EmptyState({
  message,
  action,
  className,
}: {
  message: string;
  /** A way out of the empty state — usually "create the first one". */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center',
        className
      )}
    >
      <Circle className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

/**
 * Nothing answered. Deliberately quieter than `ErrorState` — an unreachable
 * API is an outage to wait out, not a fault the reader can act on, and
 * painting it red on every panel of every page reads as catastrophe.
 */
export function UnreachableState({
  onRetry,
  className,
}: {
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center',
        className
      )}
    >
      <CloudXmark className="h-5 w-5 text-muted-foreground" />
      <p className="max-w-sm text-sm text-muted-foreground">
        Could not reach the API. Nothing is shown rather than something stale.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-brand transition-colors hover:text-brand-hover"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * The in-flight state for a panel whose data comes over the network.
 *
 * Deliberately the same box as `EmptyState` so a list does not jump when the
 * response lands and one replaces the other.
 */
export function LoadingState({
  message = 'Loading…',
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center',
        className
      )}
    >
      <RefreshDouble
        aria-hidden="true"
        className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none"
      />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * A failed read. Distinct from empty on purpose — "no functions yet" and "we
 * could not reach the API" are opposite situations and used to look identical.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center',
        className
      )}
      style={{ borderColor: 'color-mix(in oklab, var(--status-critical) 35%, transparent)' }}
    >
      <WarningTriangle className="h-5 w-5" style={{ color: 'var(--status-critical)' }} />
      <p className="max-w-sm text-sm text-muted-foreground">{errorMessage(error)}</p>
      <ProblemHelp error={error} className="items-center" />
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-brand transition-colors hover:text-brand-hover"
        >
          Try again
        </button>
      )}
    </div>
  );
}
