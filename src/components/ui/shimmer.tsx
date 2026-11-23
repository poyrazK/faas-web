import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Work in progress as a shimmering label ("Deploying", "Saving") instead of a
 * spinning icon. The label keeps its own colour; reduced motion shows it
 * plain. Styles: `.shimmer-text` in index.css.
 */
export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('shimmer-text', className)}>{children}</span>;
}
