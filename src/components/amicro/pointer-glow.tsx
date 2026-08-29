import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A cursor-following radial glow for interactive surfaces — the button-scale
 * sibling of SpotlightCard's sheen.
 *
 * Adapted from amicro's glow-button (@subhanhq/amicro, MIT): theirs is a
 * styled button with an rgba glow; ours is a bare layer in brand tokens
 * that drops inside any `relative overflow-hidden` element. Pure hover
 * paint — no motion, so there is nothing to reduce.
 */
export function PointerGlow({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);

  return (
    <div
      ref={ref}
      aria-hidden
      // The layer listens on itself: it fills the parent, so its rect and
      // the parent's are the same surface.
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className={cn('absolute inset-0 rounded-[inherit]', className)}
    >
      <div
        className="pointer-events-none absolute -inset-px rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: visible ? 1 : 0,
          background: `radial-gradient(140px circle at ${coords.x}px ${coords.y}px, color-mix(in oklab, var(--brand-fill) 14%, transparent), transparent 80%)`,
        }}
      />
    </div>
  );
}
