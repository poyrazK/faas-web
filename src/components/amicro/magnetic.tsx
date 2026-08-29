import { useRef, type ReactNode } from 'react';
import { motion, useReducedMotion, useSpring } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Magnetic pull — the wrapped element leans toward the cursor while it is
 * near, and springs home when it leaves.
 *
 * Adapted from amicro's magnetic-button (@subhanhq/amicro, MIT): theirs is
 * a styled button; ours is an unstyled wrapper so the design system's own
 * Button (or anything else) keeps its look and merely gains the pull.
 * Reduced motion renders the child still.
 */
export function Magnetic({
  children,
  range = 70,
  strength = 0.25,
  className,
}: {
  children: ReactNode;
  /** Cursor distance (px) at which the pull engages. */
  range?: number;
  /** Fraction of the cursor offset the element follows. */
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const springConfig = { stiffness: 150, damping: 15, mass: 0.6 };
  const x = useSpring(0, springConfig);
  const y = useSpring(0, springConfig);

  const onMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || reduce) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    if (dist < range) {
      x.set((e.clientX - centerX) * strength);
      y.set((e.clientY - centerY) * strength);
    } else {
      x.set(0);
      y.set(0);
    }
  };

  const settle = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={settle}
      style={reduce ? undefined : { x, y }}
      className={cn('inline-flex', className)}
    >
      {children}
    </motion.div>
  );
}
