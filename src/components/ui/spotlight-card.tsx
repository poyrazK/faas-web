import { useCallback, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A card whose border and surface catch a mint light where the cursor is —
 * our from-scratch cut of the cursor-tracked glow (Magic UI's Magic Card,
 * Aceternity's glowing effect), rebuilt on the console's tokens.
 *
 * The component only writes CSS custom properties (`--spot-x/y/o`) on
 * pointer events; `.spotlight-glow` / `.spotlight-ring` in index.css do the
 * painting, so there is no re-render per mouse move. Touch and keyboard
 * users simply see the resting card — the glow is a hover garnish, never a
 * signal — and coarse pointers never attach the listeners' cost.
 */
export function SpotlightCard({
  children,
  className,
  elevation = 'resting',
}: {
  children: ReactNode;
  className?: string;
  elevation?: 'resting' | 'raised';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--spot-x', `${x}px`);
      el.style.setProperty('--spot-y', `${y}px`);
      el.style.setProperty('--spot-o', '1');
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    ref.current?.style.setProperty('--spot-o', '0');
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        'animate-item-enter relative overflow-hidden rounded-xl border border-border bg-card',
        elevation === 'resting' && 'shadow-elevation-1',
        elevation === 'raised' && 'border-border-secondary shadow-elevation-2',
        className
      )}
    >
      <div aria-hidden className="spotlight-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="spotlight-ring pointer-events-none absolute inset-0 rounded-xl" />
      {children}
    </div>
  );
}
