import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The gregale, made visible: curved ribbons of mint light flowing from the
 * northeast, with a bright pulse travelling each curve. Built from scratch
 * (the flowing-beam pattern the Gemini surfaces popularised), redrawn in the
 * console's ramp and locked to the console's wind direction.
 *
 * Pure SVG: three bezier ribbons, each rendered twice — a blurred, static
 * stroke as atmosphere and a `pathLength`-normalised dash pulse riding the
 * same geometry (`.wind-pulse` in index.css). One blur, transform-free
 * animation, so it composites cheaply. Decorative and `aria-hidden`; the
 * pulses stop under reduced motion, the still ribbons remain as light.
 *
 * Drop inside a `relative overflow-hidden` container, one per page.
 */

const RIBBONS: { d: string; width: number; duration: number; delay: number; opacity: number }[] = [
  // Drawn in a 1200×360 space, entering top-right, exhaling to bottom-left.
  {
    d: 'M1240,-40 C960,60 780,40 560,150 C380,240 220,230 -60,320',
    width: 90,
    duration: 11,
    delay: 0,
    opacity: 0.5,
  },
  {
    d: 'M1260,80 C1000,140 840,120 640,210 C460,290 300,280 -40,380',
    width: 56,
    duration: 9,
    delay: -3.2,
    opacity: 0.38,
  },
  {
    d: 'M1220,-120 C980,-30 820,-40 620,60 C440,150 260,150 -40,240',
    width: 40,
    duration: 13,
    delay: -6.5,
    opacity: 0.3,
  },
];

export function WindBeams({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 360"
      preserveAspectRatio="xMidYMid slice"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    >
      <defs>
        <linearGradient id={`${id}-ribbon`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--mint-7)" stopOpacity="0.9" />
          <stop offset="0.45" stopColor="var(--brand-fill)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--brand-fill)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-pulse`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--mint-6)" />
          <stop offset="1" stopColor="var(--brand-fill)" />
        </linearGradient>
      </defs>

      {RIBBONS.map((r, i) => (
        <g key={i} style={{ opacity: r.opacity }}>
          <path
            d={r.d}
            className="wind-ribbon"
            fill="none"
            stroke={`url(#${id}-ribbon)`}
            strokeWidth={r.width}
            strokeLinecap="round"
          />
          <path
            d={r.d}
            className="wind-pulse"
            pathLength={1000}
            fill="none"
            stroke={`url(#${id}-pulse)`}
            strokeWidth={2.5}
            strokeLinecap="round"
            style={
              {
                '--wind-duration': `${r.duration}s`,
                '--wind-delay': `${r.delay}s`,
              } as React.CSSProperties
            }
          />
        </g>
      ))}
    </svg>
  );
}
