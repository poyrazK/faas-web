/**
 * Spring presets for micro-interactions.
 *
 * Vendored from amicro (@subhanhq/amicro, MIT) and kept verbatim — these
 * are tuning numbers, not styles. Named by feel; reach for `smooth` unless
 * the interaction has a reason to be something else.
 */
export const SPRING = {
  /** Ultra-responsive, crisp snappy feel. */
  snappy: { type: 'spring', stiffness: 400, damping: 28, mass: 0.8 },
  /** Bouncy, playful overshoot. */
  bouncy: { type: 'spring', stiffness: 300, damping: 15, mass: 1 },
  /** Smooth, elegant default. */
  smooth: { type: 'spring', stiffness: 220, damping: 24, mass: 1 },
  /** Gentle, low-speed movement. */
  gentle: { type: 'spring', stiffness: 120, damping: 14, mass: 1 },
  /** Stiff, high-tension movement. */
  stiff: { type: 'spring', stiffness: 500, damping: 40, mass: 0.5 },
} as const;
