import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'motion/react';
import { useEffect, useId, useRef } from 'react';

/**
 * Floor glow — a port of Dia Browser's footer gradient (diabrowser.com).
 *
 * The construction is theirs: N tall, heavily blurred columns arranged in a
 * symmetric bell (short at the edges, tallest in the middle), every column
 * painted with the same vertical gradient over its own height, the whole
 * field anchored to the floor and rising via scaleY(0 → 1). One inline SVG,
 * no per-frame work.
 *
 * What is ours: the stops. Dia runs ember → blue → white → yellow → red →
 * pink; this page has one hue, so the ramp is mint — deep at the floor,
 * through the bright step, a near-paper band, and out to transparent — and
 * every stop is a token, not a literal, so it inverts with the surface.
 *
 * Reveal is on scroll-into-view rather than mount: a footer is never on
 * screen when the page loads, so a mount-time rise would play to nobody.
 *
 * And it is elastic, the way Dia's is: scroll velocity is fed through a
 * loose spring into the field's height, so scrolling down toward the floor
 * stretches it up under tension, and the moment scrolling stops the spring
 * lets go and it snaps back with a wobble. Scrolling up compresses it a
 * little. The rise and the stretch multiply, so neither fights the other.
 */

type Stop = { offset: number; color: string; opacity?: number };

const MINT_STOPS: Stop[] = [
  { offset: 0, color: 'var(--mint-12)' },
  { offset: 0.18, color: 'var(--mint-10)' },
  { offset: 0.3, color: 'var(--mint-8)' },
  { offset: 0.43, color: 'var(--mint-1)' },
  { offset: 0.58, color: 'var(--mint-5)' },
  { offset: 0.7, color: 'var(--mint-8)' },
  { offset: 0.82, color: 'var(--mint-10)' },
  { offset: 1, color: 'var(--mint-10)', opacity: 0 },
];

const VBW = 1271;
const VBH = 599;

/** Dia's height curve: a gentle power falloff, flatter than a cosine bell. */
function bellHeights(n: number, peak: number, valley: number): number[] {
  const out: number[] = [];
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const t = mid === 0 ? 0 : Math.abs(i - mid) / mid;
    const eased = 1 - Math.pow(t, 1.24);
    out.push(peak * VBH * (valley + (1 - valley) * eased));
  }
  return out;
}

export function FloorGlow({
  bars = 9,
  blur = 15,
  peak = 0.98,
  valley = 0.55,
  stops = MINT_STOPS,
  className = '',
}: {
  bars?: number;
  blur?: number;
  peak?: number;
  valley?: number;
  stops?: Stop[];
  className?: string;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const heights = bellHeights(bars, peak, valley);
  const colW = VBW / bars;

  // Rise: 0 → 1 once the (untransformed) wrapper is in view. The observed
  // element must not be the scaled one — a scaleY(0) box has no height and
  // never intersects — so the wrapper is watched and the inner div scales.
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef, { once: true, amount: 0.2 });
  const rise = useMotionValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      rise.set(1);
      return;
    }
    const controls = animate(rise, 1, { type: 'spring', stiffness: 70, damping: 9, mass: 1.1 });
    return () => controls.stop();
  }, [inView, reduceMotion, rise]);

  // Tension: scroll velocity (px/s) → a stretch factor, then a loose spring.
  // Downward scrolling (positive velocity) pulls the field taller by up to
  // ~28%; upward compresses it by up to ~6%. When the velocity returns to 0
  // the spring target is 0 and the field releases. Low damping is the point:
  // it should overshoot on the way back.
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const pull = useTransform(velocity, [-2400, 0, 2400], [-0.06, 0, 0.28], { clamp: true });
  const tension = useSpring(pull, { stiffness: 160, damping: 7, mass: 0.9 });
  const scaleY = useTransform([rise, tension], ([r, t]) =>
    reduceMotion ? 1 : (r as number) * (1 + (t as number))
  );

  return (
    <div ref={wrapRef} aria-hidden className={`pointer-events-none ${className}`}>
      <motion.div
        className="h-full w-full origin-bottom"
        style={{ scaleY, willChange: 'transform' }}
      >
        <svg
          className="h-full w-full"
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="none"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* objectBoundingBox units: the gradient maps to each rect's own box,
              so every bar shows the full ramp over its own height. */}
            <linearGradient id={`${id}-grad`} x1="0" y1="1" x2="0" y2="0">
              {stops.map((s) => (
                <stop
                  key={s.offset}
                  offset={s.offset}
                  style={{ stopColor: s.color, stopOpacity: s.opacity ?? 1 }}
                />
              ))}
            </linearGradient>
            <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={blur} />
            </filter>
          </defs>
          {heights.map((h, i) => (
            <g key={i} filter={`url(#${id}-blur)`}>
              <rect
                x={i * colW}
                y={VBH - h}
                width={colW * 1.23}
                height={h}
                fill={`url(#${id}-grad)`}
              />
            </g>
          ))}
        </svg>
      </motion.div>
    </div>
  );
}
