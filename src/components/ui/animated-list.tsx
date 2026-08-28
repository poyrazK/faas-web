import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE } from '@/components/dashboard/motion';
import { cn } from '@/lib/utils';

/**
 * A feed whose rows settle in from the northeast and reflow when entries
 * arrive or leave — our cut of the "animated list" pattern, on the console's
 * wind. Rows are keyed, so a refetch that prepends an item animates exactly
 * that item while the rest glide down; nothing re-animates on re-render.
 */
export function AnimatedList<T extends { id: string }>({
  items,
  render,
  className,
  itemClassName,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  className?: string;
  itemClassName?: string | ((item: T) => string | undefined);
}) {
  const reduce = useReducedMotion();
  return (
    <ul className={cn('flex flex-col', className)}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={item.id}
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, x: 12, y: -8 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -12 }}
            transition={{ duration: 0.3, ease: EASE }}
            className={cn(
              typeof itemClassName === 'function' ? itemClassName(item) : itemClassName
            )}
          >
            {render(item)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
