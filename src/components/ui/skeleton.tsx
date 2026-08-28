import { cn } from '@/lib/utils';

/** A grey bar standing in for text that has not arrived. Lives in `ui/` —
 * it is a primitive, not dashboard chrome; `dashboard/primitives` re-exports
 * it for its existing consumers. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('block rounded bg-muted-foreground/15 motion-safe:animate-pulse', className)}
    />
  );
}
