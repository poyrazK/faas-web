import { useCallback, useState } from 'react';
import { MoreHoriz, Plus, Xmark } from 'iconoir-react';
import { Reorder, useReducedMotion } from 'motion/react';
import { Area, AreaChart } from '@/components/dither-kit';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * The analytics grid: a set of cards the reader can put in their own order.
 *
 * Every figure here comes from one call to `/analytics/timeseries`, which
 * returns zero-filled hourly buckets — a real series, drawn as one. Nothing on
 * this grid is derived from a scalar and dressed up as a trend.
 *
 * The order is the reader's, not ours. Which number matters most differs by
 * who is looking and what broke this morning, and a fixed order makes everyone
 * but its author scroll past two cards to reach the one they came for.
 */

const ORDER_KEY = 'gregale.analytics.order';

/** A spring, not a curve.
 *
 * Reflow during a drag is not an entrance: it answers a hand that is still
 * moving, and it has to stay answerable while the hand changes direction. A
 * duration curve commits to an endpoint and plays to it, so a reversal reads
 * as the grid finishing its old idea before starting the new one. A spring is
 * interruptible by construction — retarget it mid-flight and it carries its
 * velocity into the new destination, which is the whole difference between
 * "smooth" and "smooth while you are watching it".
 *
 * Stiff and well-damped: 400/35 settles in ~250ms with no visible overshoot.
 * Cards are large objects and a bouncy grid reads as a toy.
 */
const REFLOW = { type: 'spring' as const, stiffness: 400, damping: 35, mass: 0.8 };

export interface AnalyticsPoint {
  start: string;
  requests: number;
  error_requests: number;
  error_rate_pct: number;
  cold_boots: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

export interface AnalyticsCardSpec {
  id: string;
  label: string;
  /** Columns the card spans on the 4-column grid. */
  span: 1 | 2;
  value: string;
  /** Percentage change against the first half of the same window, or null when
   *  the window is too short to halve or the earlier half was empty. */
  delta: number | null;
  /** Whether a rising delta is the good direction. */
  deltaGood: boolean;
  /** The series key drawn beneath the figure, if this card draws one. */
  series?: keyof AnalyticsPoint;
  caption: string;
}

function sum(points: AnalyticsPoint[], key: keyof AnalyticsPoint): number {
  return points.reduce((total, point) => total + Number(point[key] ?? 0), 0);
}

/**
 * Change against the first half of the returned window.
 *
 * Stated rather than implied: the caption on every card carrying a delta says
 * what it is measured against, because "+100%" with no denominator is the kind
 * of number a dashboard shows when it wants to look busy.
 */
function halfOverHalf(points: AnalyticsPoint[], key: keyof AnalyticsPoint): number | null {
  if (points.length < 4) return null;
  const mid = Math.floor(points.length / 2);
  const earlier = sum(points.slice(0, mid), key);
  const later = sum(points.slice(mid), key);
  if (earlier === 0) return later === 0 ? null : 100;
  return ((later - earlier) / earlier) * 100;
}

function compact(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/**
 * Every metric the series can answer for, whether or not it is on the grid.
 *
 * The catalog is what makes the grid the reader's: the platform decides what
 * *can* be shown, and the reader decides what is. A metric added here becomes
 * available to everyone without appearing uninvited on a grid someone has
 * already arranged.
 */
/**
 * The per-app row of `/v1/apps/metrics` — the account rollup.
 *
 * Not plan-gated, unlike the hourly series, which is what lets a Free account
 * see these figures at all. `wake_p95_ms` is deliberately absent: the spec says
 * the underlying histogram is unlabeled, so it is the FLEET p95 and cannot
 * appear on a card about one app.
 */
export interface AppMetricsRow {
  request_count: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  error_rate_pct: number;
  cold_start_pct: number;
}

export interface MetricDef {
  id: string;
  label: string;
  span: 1 | 2;
  series?: keyof AnalyticsPoint;
  deltaGood: boolean;
  build: (
    points: AnalyticsPoint[],
    halfLabel: string
  ) => { value: string; delta: number | null; caption: string };
  /**
   * The same metric from the rollup, for accounts without the series.
   *
   * May rename the card: the rollup answers some questions in a different unit
   * (cold starts as a share, not a count), and a card that keeps its label while
   * changing its unit is worse than one that says what it is now showing.
   * Returning null means the metric has no honest scalar form.
   */
  scalar?: (row: AppMetricsRow) => { label?: string; value: string; caption: string } | null;
}

function latencyCard(key: 'p50_ms' | 'p95_ms' | 'p99_ms') {
  return (points: AnalyticsPoint[]) => {
    const latest = points[points.length - 1];
    return {
      value: latest ? `${Math.round(latest[key])} ms` : '—',
      delta: null,
      caption: 'Most recent hour, weighted',
    };
  };
}

export const CATALOG: MetricDef[] = [
  {
    id: 'requests',
    label: 'Requests',
    span: 2,
    series: 'requests',
    deltaGood: true,
    build: (points, halfLabel) => ({
      value: compact(sum(points, 'requests')),
      delta: halfOverHalf(points, 'requests'),
      caption: `Served this window, against ${halfLabel}`,
    }),
    scalar: (row) => ({
      value: compact(row.request_count),
      caption: 'Served in this window',
    }),
  },
  {
    id: 'errors',
    label: 'Errors',
    span: 2,
    series: 'error_requests',
    deltaGood: false,
    build: (points, halfLabel) => ({
      value: compact(sum(points, 'error_requests')),
      delta: halfOverHalf(points, 'error_requests'),
      caption: `Errored responses, against ${halfLabel}`,
    }),
    scalar: (row) => ({
      value: compact(Math.round((row.request_count * row.error_rate_pct) / 100)),
      // Said plainly: the rollup returns a rate, not a count, so this figure is
      // arithmetic on two numbers it did return rather than one it reported.
      caption: 'Derived from the error rate',
    }),
  },
  {
    id: 'error_rate',
    label: 'Error rate',
    span: 1,
    deltaGood: false,
    build: (points) => {
      const requests = sum(points, 'requests');
      const errors = sum(points, 'error_requests');
      return {
        value: `${requests === 0 ? '0.00' : ((errors / requests) * 100).toFixed(2)}%`,
        delta: null,
        caption: 'Errored share of the window',
      };
    },
    scalar: (row) => ({
      value: `${row.error_rate_pct.toFixed(2)}%`,
      caption: 'Errored share of the window',
    }),
  },
  {
    id: 'p50',
    label: 'Latency p50',
    span: 1,
    deltaGood: false,
    build: latencyCard('p50_ms'),
    scalar: (row) => ({ value: `${Math.round(row.latency_p50_ms)} ms`, caption: 'This window' }),
  },
  {
    id: 'p95',
    label: 'Latency p95',
    span: 1,
    deltaGood: false,
    build: latencyCard('p95_ms'),
    scalar: (row) => ({ value: `${Math.round(row.latency_p95_ms)} ms`, caption: 'This window' }),
  },
  {
    id: 'p99',
    label: 'Latency p99',
    span: 1,
    deltaGood: false,
    build: latencyCard('p99_ms'),
    scalar: (row) => ({ value: `${Math.round(row.latency_p99_ms)} ms`, caption: 'This window' }),
  },
  {
    id: 'cold_boots',
    label: 'Cold boots',
    span: 1,
    series: 'cold_boots',
    deltaGood: false,
    build: (points, halfLabel) => ({
      value: compact(sum(points, 'cold_boots')),
      delta: halfOverHalf(points, 'cold_boots'),
      caption: `Wakes from a parked app, against ${halfLabel}`,
    }),
    // The series counts wakes; the rollup reports the share of requests that
    // caused one. Different question, so a different name on the card.
    scalar: (row) => ({
      label: 'Cold starts',
      value: `${row.cold_start_pct.toFixed(1)}%`,
      caption: 'Share of requests that woke a parked app',
    }),
  },
];

/** What a grid nobody has arranged yet shows. */
export const DEFAULT_IDS = ['requests', 'errors', 'error_rate', 'p95', 'cold_boots'];

export function buildCard(
  def: MetricDef,
  points: AnalyticsPoint[],
  halfLabel: string
): AnalyticsCardSpec {
  const { value, delta, caption } = def.build(points, halfLabel);
  return {
    id: def.id,
    label: def.label,
    span: def.span,
    series: def.series,
    deltaGood: def.deltaGood,
    value,
    delta,
    caption,
  };
}

/** The chosen metrics, in the reader's order, skipping ids we no longer ship. */
export function chosenCards(
  chosen: string[],
  points: AnalyticsPoint[],
  halfLabel: string
): AnalyticsCardSpec[] {
  return chosen
    .map((id) => CATALOG.find((def) => def.id === id))
    .filter((def): def is MetricDef => !!def)
    .map((def) => buildCard(def, points, halfLabel));
}

/**
 * The chosen metrics as scalars, for an account without the series.
 *
 * A metric with no honest scalar form is dropped rather than approximated —
 * the grid gets shorter, which is the correct way to be missing something.
 */
export function scalarCards(chosen: string[], row: AppMetricsRow): AnalyticsCardSpec[] {
  return chosen
    .map((id) => CATALOG.find((def) => def.id === id))
    .filter((def): def is MetricDef => !!def)
    .flatMap((def) => {
      const built = def.scalar?.(row);
      if (!built) return [];
      return [
        {
          id: def.id,
          label: built.label ?? def.label,
          span: def.span,
          deltaGood: def.deltaGood,
          value: built.value,
          // No series, so no period-over-period: a delta needs two halves of
          // one, and inventing a baseline is how a dashboard starts lying.
          delta: null,
          caption: built.caption,
        },
      ];
    });
}

/** Catalog entries not currently on the grid — what the picker offers. */
export function availableMetrics(chosen: string[]): MetricDef[] {
  const on = new Set(chosen);
  return CATALOG.filter((def) => !on.has(def.id));
}

/**
 * The reader's grid, or null when they have never arranged one.
 *
 * Null and empty are different answers: empty is a grid someone deliberately
 * cleared, and defaulting it back to five cards would undo that on every
 * reload.
 */
function readChosen(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

export function AnalyticsGrid({
  points,
  build,
  loading = false,
  picking: pickingProp,
  onPicking,
}: {
  /** Drawn beneath any card that names a series. Empty on the scalar path, so
   *  the charts simply do not appear rather than being suppressed. */
  points: AnalyticsPoint[];
  /** Where the figures come from — the hourly series, or the rollup. The grid
   *  owns which metrics are shown and in what order; not what they read. */
  build: (chosen: string[]) => AnalyticsCardSpec[];
  loading?: boolean;
  /** Controlled by the section header's + when it is passed. */
  picking?: boolean;
  onPicking?: (open: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const [stored, setStored] = useState<string[] | null>(readChosen);
  const [ownPicking, setOwnPicking] = useState(false);
  const picking = pickingProp ?? ownPicking;
  const setPicking = onPicking ?? setOwnPicking;
  const chosen = stored ?? DEFAULT_IDS;
  const cards = build(chosen);
  const available = availableMetrics(chosen);

  const commit = useCallback((next: string[]) => {
    setStored(next);
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the grid still holds for this visit.
    }
  }, []);

  const add = useCallback(
    (id: string) => {
      commit([...(readChosen() ?? DEFAULT_IDS), id]);
      setPicking(false);
    },
    // setPicking is onPicking when the section drives the picker, so it is a
    // prop and can change — not the stable setState the shorter list assumed.
    [commit, setPicking]
  );
  const remove = useCallback(
    (id: string) => commit((readChosen() ?? DEFAULT_IDS).filter((entry) => entry !== id)),
    [commit]
  );

  const grid = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4';
  const cardClass = (card: AnalyticsCardSpec) =>
    cn('relative rounded-xl border border-border bg-card p-5', card.span === 2 && 'lg:col-span-2');

  const slot =
    available.length > 0 ? (
      <li className="lg:col-span-1">
        <AddMetricSlot
          open={picking}
          available={available}
          onOpen={() => setPicking(true)}
          onClose={() => setPicking(false)}
          onAdd={add}
        />
      </li>
    ) : null;

  const body = cards.map((card) => (
    <AnalyticsCard key={card.id} card={card} points={points} loading={loading} onRemove={remove} />
  ));

  // No drag under reduced motion: the reorder is a nicety, and a gesture whose
  // whole feedback channel is movement has nothing to say without it.
  if (reduce) {
    return (
      <ul className={grid}>
        {cards.map((card, i) => (
          <li key={card.id} className={cardClass(card)}>
            {body[i]}
          </li>
        ))}
        {slot}
      </ul>
    );
  }

  return (
    <Reorder.Group
      as="ul"
      axis="xy"
      values={chosen}
      onReorder={commit}
      className={grid}
      // The add slot is not reorderable and must not be dragged into the
      // sequence, so it sits outside the Group's values as a plain child.
      layoutScroll
    >
      {cards.map((card, i) => (
        <Reorder.Item
          key={card.id}
          value={card.id}
          // Position only. A reorder moves cards; it does not resize them, and
          // animating size across a one-column/two-column swap stretches the
          // card — and the canvas inside it — through the whole transition.
          layout="position"
          transition={REFLOW}
          // Elevation rather than scale: a transform on a layout-animated card
          // distorts its children, and the shadow is what reads as "lifted"
          // anyway.
          whileDrag={{ boxShadow: 'var(--elevation-3)', cursor: 'grabbing' }}
          className={cn(cardClass(card), 'touch-none')}
        >
          {body[i]}
        </Reorder.Item>
      ))}
      {slot}
    </Reorder.Group>
  );
}

/**
 * The empty cell, and the picker it becomes.
 *
 * The slot turns into the list in place rather than opening a dialog, so the
 * card's destination is visible while it is chosen — the answer to "where will
 * this land" is simply "here".
 */
function AddMetricSlot({
  open,
  available,
  onOpen,
  onClose,
  onAdd,
}: {
  open: boolean;
  available: MetricDef[];
  onOpen: () => void;
  onClose: () => void;
  onAdd: (id: string) => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="pressable flex h-full min-h-40 w-full items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Plus aria-hidden="true" className="h-5 w-5" />
        <span className="sr-only">Add a metric</span>
      </button>
    );
  }
  return (
    <div className="flex h-full min-h-40 flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-xs text-muted-foreground">Add metric</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel adding a metric"
          className="pressable rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Xmark aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto pb-2">
        {available.map((def) => (
          <li key={def.id}>
            <button
              type="button"
              onClick={() => onAdd(def.id)}
              className="pressable w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              {def.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalyticsCard({
  card,
  points,
  loading,
  onRemove,
}: {
  card: AnalyticsCardSpec;
  points: AnalyticsPoint[];
  loading: boolean;
  onRemove: (id: string) => void;
}) {
  const chart = card.series && points.length > 1;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{card.label}</p>
        {/* Bubble phase, on a wrapper — never capture, and never on the
            trigger itself. Radix opens this menu on pointerdown; stopping the
            event in the capture phase halts it before the target phase, so the
            trigger's own handler never runs and the menu cannot open. Here the
            event reaches the trigger first, then stops on its way out, before
            the card's drag gesture reads it as the start of a drag. */}
        <span onPointerDown={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${card.label} options`}
              className="pressable -mr-1 -mt-1 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <MoreHoriz aria-hidden="true" className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onRemove(card.id)}>Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {loading ? (
          <span className="block h-8 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <p className="text-[26px] leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
              {card.value}
            </p>
            {card.delta !== null && (
              <span
                className="text-xs [font-variant-numeric:tabular-nums]"
                style={{
                  color:
                    card.delta >= 0 === card.deltaGood
                      ? 'var(--status-good)'
                      : 'var(--status-critical)',
                }}
              >
                {card.delta >= 0 ? '↗' : '↘'} {Math.abs(card.delta).toFixed(1)}%
              </span>
            )}
          </>
        )}
      </div>
      {chart && !loading && (
        <div className="mt-4 -mx-1">
          <AreaChart
            data={points.map((p) => ({ at: p.start, v: Number(p[card.series!] ?? 0) }))}
            config={{ v: { label: card.label, color: 'green' as const } }}
            className="h-24 w-full"
          >
            <Area dataKey="v" />
          </AreaChart>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{card.caption}</p>
    </>
  );
}
