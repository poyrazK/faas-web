import { useEffect, useRef, type PointerEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { Plus } from 'iconoir-react';

/** The foil drifts independently; only its highlights follow the pointer. */
export function NewAppButton() {
  const ref = useRef<HTMLAnchorElement>(null);
  const frame = useRef(0);
  const light = useRef({ x: 50, y: 50, targetX: 50, targetY: 50 });
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (reduce) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      light.current = { x: 50, y: 50, targetX: 50, targetY: 50 };
      for (const property of ['--pointer-x', '--glare-x', '--glare-y', '--shine-angle']) {
        el?.style.removeProperty(property);
      }
    }
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [reduce]);

  function moveLight(x: number, y: number) {
    if (reduce) return;
    light.current.targetX = x;
    light.current.targetY = y;
    if (frame.current) return;

    let previous = performance.now();
    const tick = (now: number) => {
      const el = ref.current;
      if (!el) {
        frame.current = 0;
        return;
      }
      const point = light.current;
      const ease = 1 - Math.exp(-(now - previous) / 60);
      previous = now;
      point.x += (point.targetX - point.x) * ease;
      point.y += (point.targetY - point.y) * ease;
      const settled = Math.hypot(point.targetX - point.x, point.targetY - point.y) < 0.1;
      if (settled) {
        point.x = point.targetX;
        point.y = point.targetY;
      }
      el.style.setProperty('--pointer-x', `${point.x}%`);
      el.style.setProperty('--glare-x', `${point.x}%`);
      el.style.setProperty('--glare-y', `${point.y}%`);
      el.style.setProperty('--shine-angle', `${135 + (point.x - 50) * 0.6}deg`);
      frame.current = settled ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  function onPointerMove(event: PointerEvent<HTMLAnchorElement>) {
    if (event.pointerType !== 'mouse' || reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    moveLight(
      clamp(((event.clientX - rect.left) / rect.width) * 100),
      clamp(((event.clientY - rect.top) / rect.height) * 100)
    );
  }

  return (
    <Link
      ref={ref}
      to="/dashboard/workflows/new"
      aria-label="New app"
      className="depth-btn depth-foil"
      onPointerMove={onPointerMove}
      onPointerLeave={() => moveLight(50, 50)}
      onPointerCancel={() => moveLight(50, 50)}
    >
      <span aria-hidden="true" className="depth-foil-l depth-foil-base" />
      <span aria-hidden="true" className="depth-foil-l depth-foil-film" />
      <span aria-hidden="true" className="depth-foil-l depth-foil-pearl" />
      <span className="depth-label">
        <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">New app</span>
      </span>
      <span aria-hidden="true" className="depth-foil-l depth-foil-shine" />
      <span aria-hidden="true" className="depth-foil-l depth-foil-glare" />
    </Link>
  );
}
