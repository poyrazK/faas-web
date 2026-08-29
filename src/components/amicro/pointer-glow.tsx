import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A cursor-following radial glow for interactive surfaces — the button-scale
 * sibling of SpotlightCard's sheen.
 *
 * Adapted from amicro's glow-button (@subhanhq/amicro, MIT): theirs is a
 * styled button with an rgba glow; ours is a bare layer in brand tokens
 * that drops inside any `relative overflow-hidden` element.
 *
 * The layer itself is pointer-transparent and tracks the cursor from its
 * parent element — a glow that swallowed the click sank the overview's
 * search input once, so the decoration must never be the event target.
 */
export function PointerGlow({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const onMove = (e: MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const onEnter = () => setVisible(true);
    const onLeave = () => setVisible(false);
    parent.addEventListener('mousemove', onMove);
    parent.addEventListener('mouseenter', onEnter);
    parent.addEventListener('mouseleave', onLeave);
    return () => {
      parent.removeEventListener('mousemove', onMove);
      parent.removeEventListener('mouseenter', onEnter);
      parent.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 rounded-[inherit]', className)}
    >
      <div
        className="absolute -inset-px rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: visible ? 1 : 0,
          background: `radial-gradient(140px circle at ${coords.x}px ${coords.y}px, color-mix(in oklab, var(--brand-fill) 14%, transparent), transparent 80%)`,
        }}
      />
    </div>
  );
}
