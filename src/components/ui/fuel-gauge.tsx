import { cn } from '@/lib/utils';

/**
 * A horizontal fuel tube for one bounded resource — the allowance card's
 * instrument. The liquid fills from the left toward the reading; its
 * leading edge is a live meniscus (two drifting crests, phase-offset,
 * frozen straight under reduced motion). The level extends from empty on
 * first paint via `@starting-style` — stateless, like the odometer — and a
 * blueprint ruler runs beneath with the scale at either end.
 *
 * Shows what is LEFT: a tank is an instrument for remaining fuel.
 * `warning` renders the near-empty alarm state. One real ratio, no series.
 */
export function FuelGauge({
  pct,
  tone = 'brand',
  label,
  scale,
  className,
}: {
  /** Fill level, 0–100 — the share remaining. */
  pct: number;
  tone?: 'brand' | 'warning';
  /** Accessible name for the meter. */
  label: string;
  /** Ruler labels, [empty end, full end] — e.g. ['0', '2,000']. */
  scale: [string, string];
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const warning = tone === 'warning';
  const liquidEdge = warning ? 'var(--status-warning)' : 'var(--mint-7)';

  return (
    <div
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('flex flex-col gap-1.5', className)}
    >
      {/* The vessel. */}
      <div className="relative h-11 w-full overflow-hidden rounded-lg border border-border-secondary bg-background/60">
        <div
          className="fuel-fill-x absolute inset-y-0 left-0"
          style={
            {
              '--fuel-w': `${clamped}%`,
              background: warning
                ? 'linear-gradient(to right, color-mix(in oklab, var(--status-warning) 70%, transparent), var(--status-warning))'
                : 'linear-gradient(to right, var(--brand-fill), var(--mint-7))',
              boxShadow: `0 0 24px -4px color-mix(in oklab, ${
                warning ? 'var(--status-warning)' : 'var(--brand-fill)'
              } 55%, transparent)`,
            } as React.CSSProperties
          }
        >
          {/* The meniscus: two crests drifting vertically along the liquid's
              leading edge, so the fill reads as liquid, not a filled bar. */}
          <svg
            viewBox="0 0 8 200"
            preserveAspectRatio="none"
            className="animate-fuel-meniscus absolute -right-[7px] top-0 h-[200%] w-2"
            style={{ fill: liquidEdge }}
          >
            <path d="M3,0 Q7,12.5 3,25 T3,50 T3,75 T3,100 T3,125 T3,150 T3,175 T3,200 L0,200 L0,0 Z" />
          </svg>
          <svg
            viewBox="0 0 8 200"
            preserveAspectRatio="none"
            className="animate-fuel-meniscus absolute -right-1 top-0 h-[200%] w-2 opacity-60 [animation-delay:-4s] [animation-duration:10s]"
            style={{ fill: liquidEdge }}
          >
            <path d="M3,0 Q6,16 3,33 T3,66 T3,100 T3,133 T3,166 T3,200 L0,200 L0,0 Z" />
          </svg>
        </div>
      </div>

      {/* The ruler: graduations beneath the vessel, scale at the ends. */}
      <div aria-hidden className="flex items-start justify-between px-0.5">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={cn('w-px bg-border', i % 4 === 0 ? 'h-2.5' : 'h-1.5')} />
        ))}
      </div>
      <div aria-hidden className="flex justify-between">
        <span className="label-mono text-muted-foreground/80">{scale[0]}</span>
        <span className="label-mono normal-case text-muted-foreground/80">{scale[1]}</span>
      </div>
    </div>
  );
}
