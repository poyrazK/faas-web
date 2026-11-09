import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Word-by-word entrance: each word fades, lifts, and settles on a stagger.
 *
 * Adapted from amicro's word-reveal (@subhanhq/amicro, MIT), with two
 * changes: it animates on mount rather than in-view (the console uses it
 * above the fold), and it takes a `suffix` node revealed after the last
 * word — the overview's brand-coloured full stop rides there. Container
 * and children mount together, so the Stagger late-mount pitfall (see
 * motion.tsx) does not apply. Reduced motion renders the line still.
 */
export function WordReveal({
  text,
  suffix,
  duration = 0.5,
  staggerDelay = 0.05,
  className,
}: {
  text: string;
  /** Revealed last, as part of the stagger — punctuation, a cursor, a badge. */
  suffix?: ReactNode;
  duration?: number;
  staggerDelay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const words = text.split(/\s+/).filter(Boolean);

  if (reduce) {
    return (
      <span className={className}>
        {text}
        {suffix}
      </span>
    );
  }

  const child = {
    hidden: { opacity: 0, y: 14, scale: 0.94 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration, ease: [0.215, 0.61, 0.355, 1] as const },
    },
  };

  return (
    <motion.span
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: staggerDelay } },
      }}
      initial="hidden"
      animate="visible"
      className={cn('inline-flex flex-wrap justify-center gap-x-[0.3em]', className)}
    >
      {words.map((word, index) => (
        <motion.span key={index} variants={child} className="inline-block">
          {word}
          {/* The suffix hugs the last word — punctuation never floats a
              flex-gap away from what it punctuates. */}
          {index === words.length - 1 ? suffix : null}
        </motion.span>
      ))}
    </motion.span>
  );
}
