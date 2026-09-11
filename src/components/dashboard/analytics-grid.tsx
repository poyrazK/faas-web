import { useCallback, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Area, AreaChart } from '@/components/dither-kit';
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

/** The cards, in their default order. The reader's order overrides it. */
export function buildCards(points: AnalyticsPoint[], halfLabel: string): AnalyticsCardSpec[] {
  const latest = points[points.length - 1];
  const requests = sum(points, 'requests');
  const errors = sum(points, 'error_requests');
  return [
    {
      id: 'requests',
      label: 'Requests',
      span: 2,
      value: compact(requests),
      delta: halfOverHalf(points, 'requests'),
      deltaGood: true,
      series: 'requests',
      caption: `Served this window, against ${halfLabel}`,
    },
    {
      id: 'errors',
      label: 'Errors',
      span: 2,
      value: compact(errors),
      delta: halfOverHalf(points, 'error_requests'),
      deltaGood: false,
      series: 'error_requests',
      caption: `Errored responses, against ${halfLabel}`,
    },
    {
      id: 'error_rate',
      label: 'Error rate',
      span: 1,
      value: `${requests === 0 ? '0.00' : ((errors / requests) * 100).toFixed(2)}%`,
      delta: null,
      deltaGood: false,
      caption: 'Errored share of the window',
    },
    {
      id: 'p95',
      label: 'Latency p95',
      span: 1,
      value: latest ? `${Math.round(latest.p95_ms)} ms` : '—',
      delta: null,
      deltaGood: false,
      caption: 'Most recent hour, weighted',
    },
    {
      id: 'p50',
      label: 'Latency p50',
      span: 1,
      value: latest ? `${Math.round(latest.p50_ms)} ms` : '—',
      delta: null,
      deltaGood: false,
      caption: 'Most recent hour, weighted',
    },
    {
      id: 'cold_boots',
      label: 'Cold boots',
      span: 1,
      value: compact(sum(points, 'cold_boots')),
      delta: halfOverHalf(points, 'cold_boots'),
      deltaGood: false,
      caption: `Wakes from a parked app, against ${halfLabel}`,
    },
  ];
}

function readOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Apply a stored order without letting it decide membership.
 *
 * A stored id that no longer exists is dropped and a new card the reader has
 * never seen is appended, so adding a card ships it to everyone rather than
 * only to people with no saved order.
 */
export function applyOrder(cards: AnalyticsCardSpec[], order: string[]): AnalyticsCardSpec[] {
  const known = new Map(cards.map((card) => [card.id, card]));
  const ordered = order
    .map((id) => known.get(id))
    .filter((card): card is AnalyticsCardSpec => !!card);
  const seen = new Set(ordered.map((card) => card.id));
  return [...ordered, ...cards.filter((card) => !seen.has(card.id))];
}

/** Move an item, returning a new array. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function AnalyticsGrid({
  cards,
  points,
  loading = false,
}: {
  cards: AnalyticsCardSpec[];
  points: AnalyticsPoint[];
  loading?: boolean;
}) {
  const reduce = useReducedMotion();
  const [order, setOrder] = useState<string[]>(readOrder);
  const nodes = useRef(new Map<string, HTMLElement>());
  // The card we last swapped with, held until the pointer leaves it.
  //
  // Without this the grid oscillates: onDrag fires on every pointer move and
  // hit-tests with getBoundingClientRect, which during a layout animation
  // returns the in-flight rect. The card we just swapped with spends the next
  // ~250ms travelling out from under a stationary pointer, and every frame of
  // that journey looks like a fresh reason to swap back.
  const lastPartner = useRef<string | null>(null);
  const ordered = applyOrder(cards, order);

  const persist = useCallback((next: string[]) => {
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the order still holds for this visit.
    }
  }, []);

  // Reorder on the card the pointer is actually over, not on a drag distance.
  // Cards differ in width, so a threshold that feels right against a 1-column
  // card overshoots a 2-column one; the pointer is the only measure that reads
  // the same at both sizes.
  const onDrag = useCallback(
    (id: string, clientX: number, clientY: number) => {
      let over: string | null = null;
      for (const [otherId, el] of nodes.current) {
        if (otherId === id) continue;
        const r = el.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom)
          continue;
        over = otherId;
        break;
      }
      // Off every sibling — the pointer is over the dragged card's own slot,
      // which is where a completed swap leaves it. Release the guard so the
      // next card met is a fresh partner.
      if (over === null) {
        lastPartner.current = null;
        return;
      }
      if (over === lastPartner.current) return;
      lastPartner.current = over;
      setOrder((previous) => {
        const current = applyOrder(cards, previous).map((card) => card.id);
        const next = move(current, current.indexOf(id), current.indexOf(over));
        if (next === current) return previous;
        persist(next);
        return next;
      });
    },
    [cards, persist]
  );

  return (
    <LayoutGroup>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ordered.map((card) => (
          <motion.li
            key={card.id}
            ref={(el: HTMLLIElement | null) => {
              if (el) nodes.current.set(card.id, el);
              else nodes.current.delete(card.id);
            }}
            layout={reduce ? false : 'position'}
            transition={REFLOW}
            drag={reduce ? false : true}
            dragSnapToOrigin
            // No elastic: the card must sit under the pointer exactly, because
            // the pointer is what decides the drop. Rubber-banding would make
            // the card and the decision disagree at the edges.
            dragElastic={0}
            dragMomentum={false}
            onDrag={(event) => {
              const point =
                'touches' in event && event.touches.length > 0
                  ? event.touches[0]
                  : (event as PointerEvent);
              onDrag(card.id, point.clientX, point.clientY);
            }}
            onDragEnd={() => {
              lastPartner.current = null;
            }}
            whileDrag={{ scale: 1.015, zIndex: 30, cursor: 'grabbing' }}
            className={cn(
              'relative touch-none rounded-xl border border-border bg-card p-5',
              card.span === 2 && 'lg:col-span-2'
            )}
          >
            <AnalyticsCard card={card} points={points} loading={loading} />
          </motion.li>
        ))}
      </ul>
    </LayoutGroup>
  );
}

function AnalyticsCard({
  card,
  points,
  loading,
}: {
  card: AnalyticsCardSpec;
  points: AnalyticsPoint[];
  loading: boolean;
}) {
  const chart = card.series && points.length > 1;
  return (
    <>
      <p className="text-xs text-muted-foreground">{card.label}</p>
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
