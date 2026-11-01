import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import {
  COLS,
  ROWS,
  VIEW_H,
  VIEW_W,
  columnAt,
  hourAt,
  hourReadout,
  lastDay,
  rowPaths,
  type HourPoint,
} from './traffic-pillars-geometry';

// Tuned to settle like the landing page's Pillars, the field this one echoes.
const POINTER = { stiffness: 300, damping: 30 };
const ACTIVE = { stiffness: 400, damping: 40 };
const MONO = 'font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground';

/**
 * The last 24 hours of requests as a field of pillars: one column per hour,
 * height from that hour's requests, a red base for its share of errors, and a
 * hollow cap for a cold start. The pointer or the arrow keys rest
 * on an hour, which lifts it and reads its numbers; otherwise the readout is
 * the window's totals. Every mark comes from the hourly series.
 */
export function TrafficPillars({
  points,
  summary,
}: {
  points: readonly HourPoint[];
  /** What the readout says when no hour is selected: the window's totals. */
  summary: string;
}) {
  const day = useMemo(() => lastDay(points), [points]);
  const reduce = Boolean(useReducedMotion());
  const target = useMotionValue((COLS - 1) / 2);
  const on = useMotionValue(0);
  const glide = useSpring(target, POINTER);
  const settle = useSpring(on, ACTIVE);
  const px = reduce ? target : glide;
  const active = reduce ? on : settle;
  const [hour, setHour] = useState<number | null>(null);
  // Mirrors `hour`, so gliding within one hour moves only motion values and
  // re-renders nothing; React renders once per hour crossed.
  const shown = useRef<number | null>(null);
  const show = (next: number | null) => {
    if (shown.current === next) return;
    shown.current = next;
    setHour(next);
  };

  const select = (next: number, at = next) => {
    target.set(at);
    on.set(1);
    show(next);
  };
  const release = () => {
    on.set(0);
    show(null);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!(box.width > 0)) return;
    const x = ((e.clientX - box.left) / box.width) * VIEW_W;
    select(columnAt(x), hourAt(x));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = hour ?? COLS - 1;
    const next =
      e.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : e.key === 'ArrowRight'
          ? Math.min(COLS - 1, current + 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? COLS - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  return (
    <div className="mt-4">
      <p role="status" className="font-mono text-xs text-muted-foreground">
        {hour === null ? summary : hourReadout(day[hour], COLS - 1 - hour)}
      </p>
      <div
        role="group"
        tabIndex={0}
        aria-label="Requests per hour, last 24 hours. Use the arrow keys to read each hour."
        onPointerMove={onPointerMove}
        onPointerLeave={release}
        onBlur={release}
        onKeyDown={onKeyDown}
        className="mt-2 cursor-crosshair rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true" className="block h-auto w-full">
          {/* Back to front, so nearer pillars cover the ones behind them. */}
          {Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i).map((row) => (
            <PillarRow key={row} row={row} day={day} px={px} active={active} />
          ))}
        </svg>
      </div>
      <div className={`mt-1 flex justify-between ${MONO}`} aria-hidden="true">
        <span>24h ago</span>
        <span>12h</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function PillarRow({
  row,
  day,
  px,
  active,
}: {
  row: number;
  day: readonly (HourPoint | null)[];
  px: MotionValue<number>;
  active: MotionValue<number>;
}) {
  const paths = useTransform([px, active], ([x, a]: number[]) => rowPaths(row, day, x, a));
  const bodies = useTransform(paths, (p) => p.bodies);
  const errors = useTransform(paths, (p) => p.errors);
  const caps = useTransform(paths, (p) => p.caps);
  const cold = useTransform(paths, (p) => p.cold);
  return (
    <g>
      <motion.path d={bodies} fill="var(--card)" stroke="var(--brand)" strokeWidth={0.8} />
      <motion.path d={errors} fill="var(--status-critical)" />
      <motion.path d={caps} fill="var(--brand)" />
      <motion.path d={cold} fill="var(--card)" stroke="var(--brand)" strokeWidth={1.2} />
    </g>
  );
}
