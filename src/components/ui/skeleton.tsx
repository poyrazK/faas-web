import { cn } from '@/lib/utils';

/** A shimmering bar standing in for text that has not arrived. Lives in
 * `ui/` — it is a primitive, not dashboard chrome; `dashboard/primitives`
 * re-exports it for its existing consumers. Styles: `.shimmer` in index.css. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('shimmer block rounded', className)} />;
}
