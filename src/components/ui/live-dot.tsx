import { cn } from '@/lib/utils';

/**
 * A presence dot: solid centre, soft ping. The ping is `animate-ping`, which
 * the reduced-motion blanket rule stops after one frame — the solid dot
 * still carries the state. Colour comes in as a status token; pair it with
 * text, never alone.
 */
export function LiveDot({ color, className }: { color: string; className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex h-2 w-2', className)}>
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
        style={{ background: color }}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
