import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
import { CountUp } from './motion';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DitherButton,
  Sparkline as DitherSparkline,
  type DitherColor,
} from '@/components/dither-kit';
import { cn } from '@/lib/utils';

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
  const reduce = useReducedMotion();
  // In-flight state breathes gently so it reads as live; every other state
  // (and reduced motion) sits still.
  const pulse = state === 'deploying' && !reduce;
  return (
    <motion.span
      animate={pulse ? { opacity: [1, 0.6, 1] } : { opacity: 1 }}
      transition={pulse ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
      className={cn(
        // Colour eases over a state flip (deploying → live) while the keyed
        // span below cross-fades the icon and label — the moment reads as a
        // change of state, not a repaint.
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-[color,border-color] duration-200 ease-console',
        className
      )}
      style={{
        borderColor: `color-mix(in oklab, ${cfg.color} 35%, transparent)`,
        color: cfg.color,
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          className="inline-flex items-center gap-1.5"
          initial={reduce ? false : { opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 3 }}
          transition={{ duration: 0.15 }}
        >
          <Icon className={cn('h-3 w-3', state === 'deploying' && 'animate-spin')} />
          {cfg.label}
        </motion.span>
      </AnimatePresence>
    </motion.span>
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
 * Stat tile — a single current value with a delta and a sparkline. The
 * right form for one headline number; never a one-bar bar chart.
 * ------------------------------------------------------------------ */

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
  /** Pass a number and the tile rolls to new values instead of jumping —
   *  pair it with `format` when the figure is not a plain integer. A string
   *  renders as-is. */
  value?: string | number;
  /** Turns a numeric `value` into text. Keep it monotone (fixed/compact) so
   *  the width settles. Ignored for string values. */
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
  /** Dither Kit palette colour for the sparkline (and nothing else — the
   * value itself never rests on hue). */
  tone?: DitherColor;
}) {
  const positive = (delta ?? 0) >= 0;
  const good = positive === deltaGood;
  const Arrow = positive ? GraphUp : GraphDown;

  return (
    <div className="animate-item-enter rounded-xl border border-border bg-card p-5">
      <p className="label-mono text-muted-foreground">{label}</p>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          {state === 'loading' ? (
            <Skeleton className="h-[30px] w-20" />
          ) : state === 'unavailable' ? (
            <p
              className="text-3xl leading-none font-semibold tracking-tight text-muted-foreground"
              title="The API did not answer, so this figure is unknown."
            >
              —<span className="sr-only">unavailable</span>
            </p>
          ) : (
            <p className="text-3xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
              {typeof value === 'number' ? <CountUp value={value} format={format} /> : value}
              {unit && <span className="ml-1 text-base text-muted-foreground">{unit}</span>}
            </p>
          )}

          {state === 'ready' && note && (
            <p className="mt-2 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
              {note}
            </p>
          )}

          {state === 'ready' && delta !== undefined && (
            <p
              className="mt-2 flex items-center gap-1 text-xs [font-variant-numeric:tabular-nums]"
              style={{ color: good ? 'var(--status-good)' : 'var(--status-critical)' }}
            >
              <Arrow className="h-3 w-3" />
              {positive ? '+' : ''}
              {delta.toFixed(1)}%<span className="text-muted-foreground">vs prev period</span>
            </p>
          )}
        </div>

        {state === 'ready' && series && series.length > 1 && (
          <DitherSparkline
            data={series}
            color={tone}
            bloom="low"
            bloomOnHover
            className="h-9 w-24 shrink-0"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Layout helpers
 * ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="animate-item-enter flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  lit = false,
  padded = true,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Mint hairline along the top edge, marking the page's primary panel. */
  lit?: boolean;
  /** Off for content that runs to the panel's edges — a list or a table whose
   *  own rows carry the padding and whose dividers should span the full width. */
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        'animate-item-enter relative overflow-hidden rounded-xl border border-border bg-card',
        className
      )}
    >
      {/* The landing's lit edge, brightest at centre. One panel per page at
          most — it marks the thing the page is for. */}
      {lit && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-0 h-px"
          style={{
            background: 'linear-gradient(to right, transparent, var(--brand-fill), transparent)',
          }}
        />
      )}
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            {/* Uppercase mono, the same voice the table headers and stat
                labels use — a panel title is a section label, not a heading
                competing with the page's own. */}
            {title && <h2 className="label-mono text-foreground">{title}</h2>}
            {description && <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn(padded && 'p-5')}>{children}</div>
    </section>
  );
}

/** Segmented time-range control — filters sit in one row above the charts. */
export function RangeSelector<T extends string>({
  value,
  options,
  onChange,
  dither = false,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
  /** Render the segments as Dither Kit buttons — solid mint for the active
   * range, a quiet dotted grey for the rest. */
  dither?: boolean;
}) {
  if (dither) {
    return (
      <div role="group" aria-label="Time range" className="flex gap-1">
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <DitherButton
              key={opt.key}
              aria-pressed={active}
              onClick={() => onChange(opt.key)}
              color={active ? 'green' : 'grey'}
              variant={active ? 'solid' : 'dotted'}
              className={cn(
                'h-8 px-2.5 py-0 text-xs',
                active ? 'text-background' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt.label}
            </DitherButton>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Time range"
      className="flex rounded-md border border-border p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            'pressable rounded px-2.5 py-1 text-xs',
            value === opt.key
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
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
}: {
  phase: QueryPhase;
  error?: unknown;
  loadingMessage?: string;
  emptyMessage?: string;
}) {
  if (phase === 'unreachable') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <CloudXmark className="h-3.5 w-3.5 shrink-0" />
        Could not reach the API.
      </p>
    );
  }
  if (phase === 'error') {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 text-sm"
        style={{ color: 'var(--status-critical)' }}
      >
        <WarningTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {errorMessage(error)}
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
      <RefreshDouble className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
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
