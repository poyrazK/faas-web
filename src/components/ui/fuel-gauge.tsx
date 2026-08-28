import { cn } from '@/lib/utils';

/**
 * A vertical fuel tank for one bounded resource — the allowance card's
 * answer to the default donut. A graduated vessel with a mint liquid whose
 * surface waves gently (two drifting SVG crests, phase-offset), a blueprint
 * ruler down its side, and a level that rises from empty on first paint via
 * `@starting-style` — stateless, like the ring and the odometer.
 *
 * Shows what is LEFT: a tank is an instrument for remaining fuel. `warning`
 * tone renders the near-empty alarm state. One real ratio, no series.
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
  /** Ruler labels top→bottom, e.g. ['2,000', '0']. */
  scale: [string, string];
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const warning = tone === 'warning';
  const liquidTop = warning ? 'var(--status-warning)' : 'var(--mint-7)';

  return (
    <div
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('flex items-stretch gap-2', className)}
    >
      {/* The ruler: graduations on the drawing's side of the vessel. */}
      <div aria-hidden className="flex flex-col justify-between py-0.5 text-right">
        <span className="label-mono normal-case text-muted-foreground/80">{scale[0]}</span>
        <span className="label-mono text-muted-foreground/50">—</span>
        <span className="label-mono text-muted-foreground/80">{scale[1]}</span>
      </div>
      <div aria-hidden className="flex flex-col justify-between py-1.5">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={cn('h-px bg-border', i % 4 === 0 ? 'w-2.5' : 'w-1.5')} />
        ))}
      </div>

      {/* The vessel. */}
      <div className="relative w-14 overflow-hidden rounded-lg border border-border-secondary bg-background/60">
        <div
          className="fuel-fill absolute inset-x-0 bottom-0"
          style={
            {
              '--fuel-h': `${clamped}%`,
              background: warning
                ? 'linear-gradient(to top, color-mix(in oklab, var(--status-warning) 70%, transparent), var(--status-warning))'
                : 'linear-gradient(to top, var(--brand-fill), var(--mint-7))',
              boxShadow: `0 0 24px -4px color-mix(in oklab, ${
                warning ? 'var(--status-warning)' : 'var(--brand-fill)'
              } 55%, transparent)`,
            } as React.CSSProperties
          }
        >
          {/* The surface: two crests drifting at different speeds, so the
              liquid reads as liquid. Frozen flat under reduced motion. */}
          <svg
            viewBox="0 0 200 8"
            preserveAspectRatio="none"
            className="animate-fuel-wave absolute -top-[7px] left-0 h-2 w-[200%]"
            style={{ fill: liquidTop }}
          >
            <path d="M0,5 Q12.5,1 25,5 T50,5 T75,5 T100,5 T125,5 T150,5 T175,5 T200,5 L200,8 L0,8 Z" />
          </svg>
          <svg
            viewBox="0 0 200 8"
            preserveAspectRatio="none"
            className="animate-fuel-wave absolute -top-1 left-0 h-2 w-[200%] opacity-60 [animation-delay:-4s] [animation-duration:10s]"
            style={{ fill: liquidTop }}
          >
            <path d="M0,5 Q16,2 33,5 T66,5 T100,5 T133,5 T166,5 T200,5 L200,8 L0,8 Z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
