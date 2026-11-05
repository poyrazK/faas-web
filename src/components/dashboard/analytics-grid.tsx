import { useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { MoreHoriz, Plus, Xmark } from 'iconoir-react';
import { Reorder, useDragControls, useReducedMotion } from 'motion/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TimeChart } from './kit/chart';
import { cn } from '@/lib/utils';
import { compareRequestHalves, utcLabel } from './analytics-data';

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
  const later = sum(points.slice(-mid), key);
  if (earlier === 0) return null;
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
    const latest = [...points].reverse().find((point) => point.requests > 0);
    return {
      value: latest ? `${Math.round(latest[key])} ms` : '—',
      delta: null,
      caption: 'Latest hour with requests',
    };
  };
}

export const CATALOG: MetricDef[] = [
  {
    id: 'requests',
    label: 'Requests',
    span: 1,
    series: 'requests',
    deltaGood: true,
    build: (points) => ({
      value: compact(sum(points, 'requests')),
      delta: halfOverHalf(points, 'requests'),
      caption: 'Total requests in this window',
    }),
    scalar: (row) => ({
      value: compact(row.request_count),
      caption: 'Served in this window',
    }),
  },
  {
    id: 'errors',
    label: 'Errors',
    span: 1,
    series: 'error_requests',
    deltaGood: false,
    build: (points) => ({
      value: compact(sum(points, 'error_requests')),
      delta: halfOverHalf(points, 'error_requests'),
      caption: 'Errored responses in this window',
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
    series: 'error_rate_pct',
    label: 'Error rate',
    span: 1,
    deltaGood: false,
    build: (points) => {
      const requests = sum(points, 'requests');
      const errors = sum(points, 'error_requests');
      return {
        value: requests === 0 ? '—' : `${((errors / requests) * 100).toFixed(2)}%`,
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
    series: 'p50_ms',
    label: 'Latency p50',
    span: 1,
    deltaGood: false,
    build: latencyCard('p50_ms'),
    scalar: (row) => ({ value: `${Math.round(row.latency_p50_ms)} ms`, caption: 'This window' }),
  },
  {
    id: 'p95',
    series: 'p95_ms',
    label: 'Latency p95',
    span: 1,
    deltaGood: false,
    build: latencyCard('p95_ms'),
    scalar: (row) => ({ value: `${Math.round(row.latency_p95_ms)} ms`, caption: 'This window' }),
  },
  {
    id: 'p99',
    series: 'p99_ms',
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
    build: (points) => ({
      value: compact(sum(points, 'cold_boots')),
      delta: halfOverHalf(points, 'cold_boots'),
      caption: 'Starts of parked instances in this window',
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
  halfLabel: string,
  comparison?: { from?: string; until?: string; incomplete?: boolean }
): AnalyticsCardSpec[] {
  return chosen
    .map((id) => CATALOG.find((def) => def.id === id))
    .filter((def): def is MetricDef => !!def)
    .map((def) => {
      const card = buildCard(def, points, halfLabel);
      return comparison
        ? {
            ...card,
            delta: comparison.incomplete
              ? null
              : (compareRequestHalves(points, card.id, comparison.from, comparison.until)?.delta ??
                null),
          }
        : card;
    });
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

export type MetricChoice = Pick<AnalyticsCardSpec, 'id' | 'label'>;
export function availableMetrics(chosen: string[]): MetricDef[] {
  return CATALOG.filter((def) => !chosen.includes(def.id));
}

export function AnalyticsGrid({
  points,
  build,
  onInspect,
  historyState = 'ready',
  loading = false,
  picking = false,
  onPicking,
  catalog = CATALOG,
  defaults = DEFAULT_IDS,
  showAddSlot = true,
  storageKey = 'gregale.analytics.order',
}: {
  points: AnalyticsPoint[];
  onInspect?: (id: string) => void;
  historyState?: 'loading' | 'ready' | 'unavailable';
  build: (chosen: string[]) => AnalyticsCardSpec[];
  loading?: boolean;
  picking?: boolean;
  onPicking: (open: boolean) => void;
  showAddSlot?: boolean;
  catalog?: MetricChoice[];
  defaults?: string[];
  storageKey?: string;
}) {
  const reduce = useReducedMotion();
  const moveHelpId = useId();
  const [chosen, setChosen] = useState<string[]>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (Array.isArray(raw))
        return [...new Set(raw)].filter(
          (id): id is string => typeof id === 'string' && catalog.some((item) => item.id === id)
        );
    } catch {
      /* A private browser can still customize for this visit. */
    }
    return defaults;
  });
  const [announcement, announce] = useState('');
  const cards = build(chosen);
  const available = catalog.filter((item) => !chosen.includes(item.id));
  const commit = (next: string[]) => {
    setChosen(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Session only. */
    }
  };
  const move = (id: string, to: number) => {
    const from = chosen.indexOf(id);
    if (from < 0 || from === to || to < 0 || to >= chosen.length) return;
    const next = chosen.filter((entry) => entry !== id);
    next.splice(to, 0, id);
    commit(next);
    announce(`${catalog.find((item) => item.id === id)?.label} moved to position ${to + 1}`);
  };
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {picking && available.length === 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-xs text-muted-foreground">
          <p>Every available metric is on your board.</p>
          <button
            type="button"
            onClick={() => onPicking(false)}
            className="pressable rounded text-foreground"
          >
            Done
          </button>
        </div>
      )}

      <Reorder.Group
        as="ul"
        axis="xy"
        values={chosen}
        onReorder={commit}
        aria-label="Metric cards"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {cards.map((card, index) => (
          <SortableMetricCard key={card.id} card={card} reduce={Boolean(reduce)}>
            {(startDrag) => (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    // Preserve touch scrolling; the options menu also supports reordering.
                    if (event.pointerType === 'mouse') startDrag(event);
                  }}
                  onClick={() => onInspect?.(card.id)}
                  aria-label={onInspect ? `View ${card.label} details` : `Move ${card.label}`}
                  aria-describedby={moveHelpId}
                  onKeyDown={(event) => {
                    if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
                      event.preventDefault();
                      move(
                        card.id,
                        index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1)
                      );
                    }
                  }}
                  className="absolute inset-0 z-10 touch-pan-y cursor-grab rounded-lg active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
                  <div className="relative z-20 flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`${card.label} options`}
                        className="pressable rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <MoreHoriz aria-hidden className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={index === 0}
                          onSelect={() => move(card.id, index - 1)}
                        >
                          Move earlier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === cards.length - 1}
                          onSelect={() => move(card.id, index + 1)}
                        >
                          Move later
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => commit(chosen.filter((id) => id !== card.id))}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-baseline gap-2">
                  {loading ? (
                    <span className="block h-8 w-24 animate-pulse rounded bg-muted" />
                  ) : (
                    <>
                      <p className="text-[26px] font-semibold leading-none tracking-tight tabular-nums">
                        {card.value}
                      </p>
                      {card.delta !== null && (
                        <span
                          className="text-xs tabular-nums"
                          style={{
                            color:
                              card.delta === 0
                                ? 'var(--muted-foreground)'
                                : card.delta >= 0 === card.deltaGood
                                  ? 'var(--status-good)'
                                  : 'var(--status-critical)',
                          }}
                        >
                          {card.delta === 0
                            ? 'No change'
                            : `${card.delta > 0 ? '↗' : '↘'} ${Math.abs(card.delta).toFixed(1)}%`}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {card.series &&
                  !loading &&
                  (historyState !== 'ready' ? (
                    <div
                      role="status"
                      className="mt-5 flex h-24 items-center justify-center text-xs text-muted-foreground"
                    >
                      {historyState === 'loading' ? 'Loading history…' : 'History unavailable'}
                    </div>
                  ) : points.length > 0 && points.some((point) => point.requests > 0) ? (
                    <TimeChart
                      data={points.map((point) => ({
                        at: utcLabel(point.start),
                        value:
                          (card.series?.endsWith('_ms') || card.id === 'error_rate') &&
                          point.requests === 0
                            ? null
                            : Number(point[card.series!] ?? 0),
                      }))}
                      x="at"
                      series={{
                        value: {
                          label: card.label,
                          color: card.id === 'errors' || card.id === 'error_rate' ? 'red' : 'blue',
                        },
                      }}
                      compact
                      className="mt-5 h-24"
                    />
                  ) : (
                    <div className="mt-5 flex h-24 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                      No requests in this window
                    </div>
                  ))}
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{card.caption}</p>
              </>
            )}
          </SortableMetricCard>
        ))}
        {available.length > 0 && (showAddSlot || picking) && (
          <li className="min-h-36 rounded-xl border border-dashed border-border">
            {picking ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-xs font-medium">Add metric</p>
                  <button
                    type="button"
                    aria-label="Cancel adding a metric"
                    onClick={() => onPicking(false)}
                    className="pressable rounded p-1"
                  >
                    <Xmark className="size-4" />
                  </button>
                </div>
                <ul className="max-h-56 overflow-y-auto pb-2">
                  {available.map((metric) => (
                    <li key={metric.id}>
                      <button
                        type="button"
                        className="pressable w-full px-4 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                        onClick={() => {
                          commit([...chosen, metric.id]);
                          onPicking(false);
                          announce(`${metric.label} added`);
                        }}
                      >
                        {metric.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <button
                type="button"
                aria-label="Add a metric"
                onClick={() => onPicking(true)}
                className="pressable flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
              >
                <Plus className="size-5" />
                <span className="text-xs">Add metric</span>
              </button>
            )}
          </li>
        )}
      </Reorder.Group>
      <p id={moveHelpId} className="sr-only">
        Drag a card to arrange. Click to explore. Use arrow keys or the options menu to move it.
      </p>
    </div>
  );
}

/** Motion owns pointer tracking and grid reflow, so the card stays under the hand. */
function SortableMetricCard({
  card,
  reduce,
  children,
}: {
  card: AnalyticsCardSpec;
  reduce: boolean;
  children: (start: (event: PointerEvent<HTMLButtonElement>) => void) => ReactNode;
}) {
  const controls = useDragControls();
  const dragged = useRef(false);
  return (
    <Reorder.Item
      as="li"
      value={card.id}
      tabIndex={-1}
      data-metric-id={card.id}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      layout="position"
      transition={
        reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 35, mass: 0.8 }
      }
      whileDrag={{ boxShadow: 'var(--elevation-3)', cursor: 'grabbing' }}
      onPointerDownCapture={() => {
        dragged.current = false;
      }}
      onDragStart={() => {
        dragged.current = true;
      }}
      onClickCapture={(event) => {
        // Even a drag that returns to its starting slot must not open details.
        if (dragged.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={cn(
        'group relative min-w-0 rounded-lg border border-border bg-card p-4 transition-colors has-[:focus-visible]:border-brand hover:border-border-secondary',
        card.span === 2 && 'xl:col-span-2'
      )}
    >
      {children((event) => {
        if (event.button === 0) controls.start(event);
      })}
    </Reorder.Item>
  );
}
