import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A circular gauge for one bounded scalar — allowance used, quota consumed.
 * SVG, tokens only, rounded caps. The arc sweeps in on first paint via CSS
 * `@starting-style` (no state, no effect): the browser transitions from the
 * empty ring to the value on insertion, and later value changes glide on the
 * same transition. Where `@starting-style` is unsupported, the ring simply
 * appears at its value. Reduced motion gets the value immediately.
 *
 * A ring, not a chart: it renders a single real ratio, so it stays inside
 * the console's no-fabricated-series rule.
 */
export function ProgressRing({
  value,
  size = 148,
  strokeWidth = 9,
  tone = 'brand',
  label,
  children,
  className,
}: {
  /** 0–100. Clamped. */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** `warning` once the measured thing is over its line. */
  tone?: 'brand' | 'warning';
  /** Accessible name for the meter. */
  label: string;
  /** Centre content — the figure, not a repeat of the label. */
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('relative inline-flex items-center justify-center', className)}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={strokeWidth}
        />
        <circle
          key={id}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone === 'warning' ? 'var(--status-warning)' : 'var(--brand)'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          className="ring-sweep"
          style={
            {
              '--ring-circ': circumference,
              '--ring-off': circumference * (1 - clamped / 100),
              filter:
                tone === 'brand'
                  ? 'drop-shadow(0 0 6px color-mix(in oklab, var(--brand-fill) 35%, transparent))'
                  : undefined,
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
