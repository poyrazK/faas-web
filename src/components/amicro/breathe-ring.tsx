import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * A ring that breathes — swelling as its stroke thins, the console's own
 * pulse as a loading indicator.
 *
 * Adapted from amicro's breathe-ring (@subhanhq/amicro, MIT): colours move
 * to tokens, the cadence matches the design system's 3.4s breath, and
 * reduced motion holds a still ring.
 */
export function BreatheRing({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className={cn('h-9 w-9 rounded-full', className)}
      style={{ border: '4px solid var(--brand-fill)' }}
      animate={reduce ? undefined : { scale: [0.82, 1.08, 0.82], borderWidth: [6, 2, 6] }}
      transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
