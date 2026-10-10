import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { animate, useReducedMotion } from 'motion/react';
import { Cube } from 'iconoir-react';

/** Frames to keep looking for the node: React Flow draws it a commit or two late. */
const LOOK_FRAMES = 12;

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/**
 * The wizard card turning into the app node: one glass box, card rect to node
 * rect, with the node's glyph and name surfacing as it lands. The target is
 * read every frame, so a band easing aside or the camera panning cannot leave
 * it landing on stale coordinates. `hold` keeps it on the card while the app
 * is still loading. The page hides the real node until `onDone`, then swaps it
 * in under the box's final rect, so the hand-off has no gap.
 */
export function Morph({
  from,
  to,
  slug,
  hold = false,
  onDone,
}: {
  from: DOMRect;
  to: () => DOMRect | null;
  slug?: string;
  hold?: boolean;
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const latest = useRef({ to, onDone });
  useEffect(() => {
    latest.current = { to, onDone };
  });

  useEffect(() => {
    const el = box.current;
    if (!el || hold) return;
    let frame = 0;
    let tries = 0;
    let stop: (() => void) | undefined;
    const finish = () => latest.current.onDone();

    const fly = (first: DOMRect) => {
      if (reduce) {
        const c = animate(el, { opacity: [1, 0] }, { duration: 0.15 });
        void c.then(finish);
        stop = () => c.stop();
        return;
      }
      let target = first;
      const c = animate(0, 1, {
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (p) => {
          target = latest.current.to() ?? target;
          el.style.left = `${lerp(from.left, target.left, p)}px`;
          el.style.top = `${lerp(from.top, target.top, p)}px`;
          el.style.width = `${lerp(from.width, target.width, p)}px`;
          el.style.height = `${lerp(from.height, target.height, p)}px`;
          el.style.borderRadius = `${lerp(16, 12, p)}px`;
          if (label.current)
            label.current.style.opacity = String(Math.min(1, Math.max(0, (p - 0.35) / 0.5)));
        },
      });
      void c.then(finish);
      stop = () => c.stop();
    };

    const look = () => {
      const r = latest.current.to();
      if (r) return fly(r);
      if (++tries > LOOK_FRAMES) return finish();
      frame = requestAnimationFrame(look);
    };
    look();
    return () => {
      cancelAnimationFrame(frame);
      stop?.();
    };
  }, [from, hold, reduce]);

  return createPortal(
    <div
      ref={box}
      data-morph=""
      aria-hidden
      className="pointer-events-none fixed z-50 flex items-center overflow-hidden border border-canvas-glass-border border-t-brand/50 bg-canvas-glass px-3.5 shadow-elevation-3 backdrop-blur-xl"
      style={{
        left: from.left,
        top: from.top,
        width: from.width,
        height: from.height,
        borderRadius: 16,
      }}
    >
      {slug && (
        <div ref={label} className="flex min-w-0 items-center gap-3" style={{ opacity: 0 }}>
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4"
            style={{
              color: 'var(--cat-compute)',
              background: 'color-mix(in srgb, var(--cat-compute) 16%, transparent)',
            }}
          >
            <Cube />
          </span>
          <span className="truncate text-[14px] font-semibold tracking-[-0.005em] text-foreground">
            {slug}
          </span>
        </div>
      )}
    </div>,
    document.body
  );
}
